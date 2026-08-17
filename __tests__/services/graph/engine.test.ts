import { updateGraphForEntry, rebuildGraph, type SupportCounter } from '@/services/graph/engine'
import { type SqliteDatabase, setDb } from '@/services/storage/db'
import {
  upsertNode,
  upsertEdge,
  findNodeByLabel,
  loadDismissedNodeKeys,
} from '@/services/storage/graph'
import { listEntitiesForEntry } from '@/services/storage/entities'
import { type Entry } from '@/services/storage/entries'
import { ok } from '@/types/result'

jest.mock('@/services/storage/graph', () => ({
  upsertNode: jest.fn(),
  upsertEdge: jest.fn(),
  findNodeByLabel: jest.fn(),
  loadDismissedNodeKeys: jest.fn(),
  // real impl — the engine keys its skip checks on this
  nodeDismissalKey: (type: string, label: string) => `${type}:${label}`.toLowerCase(),
}))
jest.mock('@/services/storage/entities', () => ({
  listEntitiesForEntry: jest.fn(),
  countEntriesForEntity: jest.fn(async () => ({ success: true, data: 5 })),
  effectiveLabel: (e: { label: string; canonical_label?: string | null }) => {
    const canon = (e.canonical_label ?? '').trim()
    return canon.length > 0 ? canon : e.label
  },
}))

const mockUpsertNode = upsertNode as jest.Mock
const mockUpsertEdge = upsertEdge as jest.Mock
const mockFindNode = findNodeByLabel as jest.Mock
const mockLoadDismissed = loadDismissedNodeKeys as jest.Mock
const mockListEntities = listEntitiesForEntry as jest.Mock

// Every label is well-corroborated by default — keeps the existing derivation
// assertions about WHICH nodes/edges are built independent of the recurrence
// gate (which has its own tests below).
const HIGH: SupportCounter = async () => 5

const entry = (over: Partial<Entry> = {}): Entry => ({
  id: 'e1',
  created_at: 0,
  mood: 2,
  situation: 's',
  thought: 't',
  behavior: null,
  closing_note: null,
  emotion: 'anxiety',
  named_emotion: null,
  energy: null,
  distortion: 'catastrophizing',
  mood_score: 0.2,
  topic: null,
  topic2: null,
  tagged_at: 1,
  wiki_indexed_at: null,
  graph_indexed_at: null,
  raw_text: null,
  source: 'journal',
  ...over,
})

describe('updateGraphForEntry', () => {
  beforeEach(() => {
    mockUpsertNode.mockReset()
    mockUpsertEdge.mockReset()
    mockListEntities.mockReset()
    mockListEntities.mockResolvedValue(ok([]))
    mockFindNode.mockReset()
    mockFindNode.mockResolvedValue(ok(null)) // no pre-existing same-label node by default
    mockLoadDismissed.mockReset()
    mockLoadDismissed.mockResolvedValue(new Set()) // nothing dropped by default
    let n = 0
    mockUpsertNode.mockImplementation(async (type, label) =>
      ok({ id: `id-${++n}`, type, label, frequency: 1 })
    )
    mockUpsertEdge.mockResolvedValue(ok({}))
    // Stub so getDb() (called by the public updateGraphForEntry to supply db to
    // the impl) doesn't throw — all real DB calls are mocked via jest.mock anyway.
    setDb({ execute: jest.fn(), transaction: jest.fn(), close: jest.fn() } as unknown as SqliteDatabase)
  })
  afterEach(() => setDb(null))

  it('upserts a node per tag and an edge per co-occurring pair', async () => {
    await updateGraphForEntry(entry(), ['Work'], undefined, HIGH) // emotion + distortion + theme = 3 nodes

    expect(mockUpsertNode).toHaveBeenCalledWith('emotion', 'anxiety', expect.anything())
    expect(mockUpsertNode).toHaveBeenCalledWith('distortion', 'catastrophizing', expect.anything())
    expect(mockUpsertNode).toHaveBeenCalledWith('situation', 'Work', expect.anything())
    // 3 nodes -> 3 unique pairs
    expect(mockUpsertEdge).toHaveBeenCalledTimes(3)
  })

  it('skips distortion "none" and makes no edge for a single node', async () => {
    await updateGraphForEntry(entry({ distortion: 'none' }), undefined, undefined, HIGH) // only emotion

    expect(mockUpsertNode).toHaveBeenCalledTimes(1)
    expect(mockUpsertNode).toHaveBeenCalledWith('emotion', 'anxiety', expect.anything())
    expect(mockUpsertEdge).not.toHaveBeenCalled()
  })

  it('does nothing for an untagged entry', async () => {
    await updateGraphForEntry(entry({ emotion: null, distortion: null }), undefined, undefined, HIGH)
    expect(mockUpsertNode).not.toHaveBeenCalled()
  })

  it('skips a theme node that just repeats the emotion (case-insensitive)', async () => {
    await updateGraphForEntry(entry({ emotion: 'loneliness', distortion: 'none' }), ['Loneliness'], undefined, HIGH)

    // only the emotion node — no duplicate "situation" node for the same word
    expect(mockUpsertNode).toHaveBeenCalledTimes(1)
    expect(mockUpsertNode).toHaveBeenCalledWith('emotion', 'loneliness', expect.anything())
    expect(mockUpsertNode).not.toHaveBeenCalledWith('situation', 'Loneliness', expect.anything())
  })

  it('attaches a theme to an existing same-label node instead of duplicating it', async () => {
    // A "Work" place node already exists from a prior entry.
    mockFindNode.mockResolvedValue(ok({ id: 'wk', type: 'place', label: 'Work', frequency: 3 }))
    await updateGraphForEntry(entry({ distortion: 'none' }), ['Work'], undefined, HIGH) // emotion + theme "Work"

    // the theme reuses the existing place node — no second "situation" node
    expect(mockUpsertNode).toHaveBeenCalledWith('place', 'Work', expect.anything())
    expect(mockUpsertNode).not.toHaveBeenCalledWith('situation', 'Work', expect.anything())
  })

  it('skips a theme that repeats one of this entry\'s own entities', async () => {
    mockListEntities.mockResolvedValue(
      ok([{ id: 'x1', entry_id: 'e1', type: 'place', label: 'Gym', created_at: 0 }])
    )
    await updateGraphForEntry(entry({ distortion: 'none' }), ['gym'], undefined, HIGH) // theme echoes the place

    expect(mockUpsertNode).toHaveBeenCalledWith('place', 'Gym', expect.anything())
    expect(mockUpsertNode).not.toHaveBeenCalledWith('situation', 'gym', expect.anything())
    expect(mockFindNode).not.toHaveBeenCalled() // resolved in-entry, no DB lookup needed
  })

  it('skips a dropped node (and any edge to it) when deriving from an entry', async () => {
    // emotion "anxiety" was dropped — only the distortion node should be built.
    await updateGraphForEntry(entry(), undefined, new Set(['emotion:anxiety']), HIGH)

    expect(mockUpsertNode).toHaveBeenCalledTimes(1)
    expect(mockUpsertNode).toHaveBeenCalledWith('distortion', 'catastrophizing', expect.anything())
    expect(mockUpsertNode).not.toHaveBeenCalledWith('emotion', 'anxiety', expect.anything())
    expect(mockUpsertEdge).not.toHaveBeenCalled() // single surviving node → no pair
  })

  it('keeps dismissal exact to (type,label), allowing another type with the same label', async () => {
    // Product decision: dropping place:Work does not suppress situation:Work.
    // Once the place node is gone, a recurring Work theme may become its own node.
    await updateGraphForEntry(
      entry({ emotion: '', distortion: 'none' }),
      ['Work'],
      new Set(['place:work']),
      HIGH
    )

    expect(mockUpsertNode).toHaveBeenCalledTimes(1)
    expect(mockUpsertNode).toHaveBeenCalledWith('situation', 'Work', expect.anything())
  })

  it('adds person/place/activity nodes from the entry entities', async () => {
    mockListEntities.mockResolvedValue(
      ok([
        { id: 'x1', entry_id: 'e1', type: 'person', label: 'Sarah', created_at: 0 },
        { id: 'x2', entry_id: 'e1', type: 'place', label: 'Office', created_at: 0 },
      ])
    )
    await updateGraphForEntry(entry({ distortion: 'none' }), undefined, undefined, HIGH) // emotion + 2 entities = 3 nodes

    expect(mockUpsertNode).toHaveBeenCalledWith('emotion', 'anxiety', expect.anything())
    expect(mockUpsertNode).toHaveBeenCalledWith('person', 'Sarah', expect.anything())
    expect(mockUpsertNode).toHaveBeenCalledWith('place', 'Office', expect.anything())
    expect(mockUpsertEdge).toHaveBeenCalledTimes(3) // 3 nodes -> 3 pairs
  })

  describe('recurrence gate', () => {
    it('creates no node when a signal appears in only one entry', async () => {
      const ONCE: SupportCounter = async () => 1
      await updateGraphForEntry(entry(), ['Work'], undefined, ONCE)
      expect(mockUpsertNode).not.toHaveBeenCalled() // emotion, distortion, theme all uncorroborated
      expect(mockUpsertEdge).not.toHaveBeenCalled()
    })

    it('materializes only the signals corroborated by >=2 entries', async () => {
      // Emotion recurs; the distortion + theme are one-offs.
      const sup: SupportCounter = async (type) => (type === 'emotion' ? 2 : 1)
      await updateGraphForEntry(entry(), ['Work'], undefined, sup)

      expect(mockUpsertNode).toHaveBeenCalledTimes(1)
      expect(mockUpsertNode).toHaveBeenCalledWith('emotion', 'anxiety', expect.anything())
      expect(mockUpsertNode).not.toHaveBeenCalledWith('distortion', 'catastrophizing', expect.anything())
      expect(mockUpsertNode).not.toHaveBeenCalledWith('situation', 'Work', expect.anything())
      expect(mockUpsertEdge).not.toHaveBeenCalled() // one node → no pair
      // Gate-trip entry contributes once, so live frequency starts at 1 even
      // though support is already 2. Full rebuild later backfills both entries.
      const created = await mockUpsertNode.mock.results[0].value
      expect(created.success && created.data.frequency).toBe(1)
    })
  })
})

describe('rebuildGraph', () => {
  beforeEach(() => {
    mockUpsertNode.mockReset()
    mockUpsertEdge.mockReset()
    mockListEntities.mockReset()
    mockListEntities.mockResolvedValue(ok([]))
    mockFindNode.mockReset()
    mockFindNode.mockResolvedValue(ok(null)) // no pre-existing same-label node by default
    mockLoadDismissed.mockReset()
    mockLoadDismissed.mockResolvedValue(new Set()) // nothing dropped by default
    let n = 0
    mockUpsertNode.mockImplementation(async (type, label) =>
      ok({ id: `id-${++n}`, type, label, frequency: 1 })
    )
    mockUpsertEdge.mockResolvedValue(ok({}))
  })
  afterEach(() => setDb(null))

  // Precomputed support maps come from GROUP BY queries; return all test labels
  // as well-corroborated (>=2) so rebuild assertions cover derivation, not the
  // gate (which is unit-tested above).
  const groupBy = (sql: string): { rows: Record<string, unknown>[]; rowsAffected: number } | null => {
    if (/GROUP BY emotion/.test(sql)) return { rows: [{ k: 'anxiety', n: 2 }, { k: 'calm', n: 2 }], rowsAffected: 0 }
    if (/GROUP BY distortion/.test(sql)) return { rows: [{ k: 'catastrophizing', n: 2 }], rowsAffected: 0 }
    if (/COUNT\(DISTINCT eid\)/.test(sql)) return { rows: [], rowsAffected: 0 } // topic UNION support
    if (/FROM entry_entities GROUP BY/.test(sql)) return { rows: [], rowsAffected: 0 }
    return null
  }

  it('clears the graph then rebuilds emotion/distortion nodes from all entries', async () => {
    const rows = [
      entry({ id: 'e1', emotion: 'anxiety', distortion: 'catastrophizing' }),
      entry({ id: 'e2', emotion: 'calm', distortion: 'none' }),
    ]
    const deletes: string[] = []
    const fakeDb = {
      async execute(sql: string) {
        if (/^DELETE FROM/.test(sql)) {
          deletes.push(sql)
          return { rows: [], rowsAffected: 0 }
        }
        const g = groupBy(sql)
        if (g) return g
        if (/^SELECT \* FROM entries/.test(sql)) return { rows, rowsAffected: 0 }
        // rebuildGraph stamps the graph-heal backlog on success.
        if (/^UPDATE entries SET graph_indexed_at/.test(sql)) return { rows: [], rowsAffected: 0 }
        throw new Error(`unhandled SQL: ${sql}`)
      },
      async transaction(fn: (tx: SqliteDatabase) => Promise<void>) {
        await fn(fakeDb)
      },
      close() {},
    } as unknown as SqliteDatabase
    setDb(fakeDb)

    const res = await rebuildGraph()

    expect(res.success).toBe(true)
    expect(deletes).toHaveLength(2) // edges + nodes cleared first
    expect(mockUpsertNode).toHaveBeenCalledWith('emotion', 'anxiety', expect.anything())
    expect(mockUpsertNode).toHaveBeenCalledWith('distortion', 'catastrophizing', expect.anything())
    expect(mockUpsertNode).toHaveBeenCalledWith('emotion', 'calm', expect.anything())
    expect(mockUpsertEdge).toHaveBeenCalledTimes(1) // e1: 2 nodes→1 edge; e2: 1 node→0
  })

  it('rebuild backfills exact recurring node frequency and edge weight', async () => {
    const rows = [
      entry({ id: 'e1', emotion: 'anxiety', distortion: 'catastrophizing' }),
      entry({ id: 'e2', emotion: 'anxiety', distortion: 'catastrophizing' }),
    ]
    const nodeCounts = new Map<string, number>()
    const edgeCounts = new Map<string, number>()
    mockUpsertNode.mockImplementation(async (type, label) => {
      const key = `${type}:${label}`
      const frequency = (nodeCounts.get(key) ?? 0) + 1
      nodeCounts.set(key, frequency)
      return ok({ id: key, type, label, frequency })
    })
    mockUpsertEdge.mockImplementation(async (a, b) => {
      const key = [a, b].sort().join('|')
      const weight = (edgeCounts.get(key) ?? 0) + 1
      edgeCounts.set(key, weight)
      return ok({ id: key, source_id: a, target_id: b, weight })
    })
    const fakeDb = {
      async execute(sql: string) {
        if (/^DELETE FROM/.test(sql)) return { rows: [], rowsAffected: 0 }
        const g = groupBy(sql)
        if (g) return g
        if (/^SELECT \* FROM entries/.test(sql)) return { rows, rowsAffected: 0 }
        if (/^UPDATE entries SET graph_indexed_at/.test(sql)) return { rows: [], rowsAffected: 0 }
        throw new Error(`unhandled SQL: ${sql}`)
      },
      async transaction(fn: (tx: SqliteDatabase) => Promise<void>) {
        await fn(fakeDb)
      },
      close() {},
    } as unknown as SqliteDatabase
    setDb(fakeDb)

    const res = await rebuildGraph()

    expect(res.success).toBe(true)
    expect(nodeCounts.get('emotion:anxiety')).toBe(2)
    expect(nodeCounts.get('distortion:catastrophizing')).toBe(2)
    expect(edgeCounts.get('distortion:catastrophizing|emotion:anxiety')).toBe(2)
  })

  it('does NOT stamp the graph backlog when one entry\'s update fails', async () => {
    // listEntitiesForEntry throwing makes that entry's updateGraphForEntry return
    // err — the rebuild must then leave graph_indexed_at unset so catch-up retries,
    // instead of marking every entry healed with the failed one's signals missing.
    mockListEntities.mockRejectedValueOnce(new Error('bad row'))
    const rows = [
      entry({ id: 'e1', emotion: 'anxiety', distortion: 'catastrophizing' }),
      entry({ id: 'e2', emotion: 'calm', distortion: 'none' }),
    ]
    let stamped = false
    const fakeDb = {
      async execute(sql: string) {
        if (/^DELETE FROM/.test(sql)) return { rows: [], rowsAffected: 0 }
        const g = groupBy(sql)
        if (g) return g
        if (/^SELECT \* FROM entries/.test(sql)) return { rows, rowsAffected: 0 }
        if (/^UPDATE entries SET graph_indexed_at/.test(sql)) {
          stamped = true
          return { rows: [], rowsAffected: 0 }
        }
        throw new Error(`unhandled SQL: ${sql}`)
      },
      async transaction(fn: (tx: SqliteDatabase) => Promise<void>) {
        await fn(fakeDb)
      },
      close() {},
    } as unknown as SqliteDatabase
    setDb(fakeDb)

    const res = await rebuildGraph()

    expect(res.success).toBe(true) // best-effort — the rebuild itself doesn't fail
    expect(stamped).toBe(false) // backlog left for the next launch's catch-up
  })

  it('does not stamp after a later page fails, then heals on a complete retry', async () => {
    const firstPage = Array.from({ length: 501 }, (_, index) =>
      entry({ id: `e${index}`, created_at: 10000 - index, emotion: null, distortion: null })
    )
    let rebuildAttempt = 0
    let pageReads = 0
    let stamped = 0
    const fakeDb = {
      async execute(sql: string) {
        if (/^DELETE FROM/.test(sql)) return { rows: [], rowsAffected: 0 }
        const g = groupBy(sql)
        if (g) return g
        if (/^SELECT \* FROM entries WHERE 1 = 1/.test(sql)) {
          pageReads++
          if (pageReads === 2 && rebuildAttempt === 1) throw new Error('later page unavailable')
          if (pageReads === 1 || pageReads === 3) return { rows: firstPage, rowsAffected: 0 }
          return { rows: [], rowsAffected: 0 }
        }
        if (/^UPDATE entries SET graph_indexed_at/.test(sql)) {
          stamped++
          return { rows: [], rowsAffected: firstPage.length }
        }
        throw new Error(`unhandled SQL: ${sql}`)
      },
      async transaction(fn: (tx: SqliteDatabase) => Promise<void>) {
        rebuildAttempt++
        await fn(fakeDb)
      },
      close() {},
    } as unknown as SqliteDatabase
    setDb(fakeDb)

    const failed = await rebuildGraph()
    expect(failed.success).toBe(false)
    expect(stamped).toBe(0)

    const retried = await rebuildGraph()
    expect(retried.success).toBe(true)
    expect(stamped).toBe(1)
  })

  it('serializes a live update against a rebuild (no interleaving)', async () => {
    // Record the order DELETE (rebuild) and the live entry's entity read happen.
    // With the mutex, the whole rebuild completes before the live update starts —
    // its DELETEs are never interleaved between the live update's node upserts.
    const order: string[] = []
    mockListEntities.mockImplementation(async (entryId: string) => {
      order.push(entryId === 'live' ? 'live-entities-read' : 'rebuild-entities-read')
      return ok([])
    })
    const rows = [entry({ id: 'e1', emotion: 'anxiety', distortion: 'none' })]
    const fakeDb = {
      async execute(sql: string) {
        if (/^DELETE FROM/.test(sql)) {
          order.push('rebuild-delete')
          return { rows: [], rowsAffected: 0 }
        }
        const g = groupBy(sql)
        if (g) return g
        if (/^SELECT \* FROM entries/.test(sql)) return { rows, rowsAffected: 0 }
        if (/^UPDATE entries SET graph_indexed_at/.test(sql)) return { rows: [], rowsAffected: 0 }
        throw new Error(`unhandled SQL: ${sql}`)
      },
      async transaction(fn: (tx: SqliteDatabase) => Promise<void>) {
        await fn(fakeDb)
      },
      close() {},
    } as unknown as SqliteDatabase
    setDb(fakeDb)

    // Kick off a rebuild and a live update together; the lock must run them
    // one-after-another, not interleaved.
    await Promise.all([
      rebuildGraph(),
      updateGraphForEntry(entry({ id: 'live', emotion: 'calm', distortion: 'none' }), [], undefined, HIGH),
    ])

    // Both rebuild DELETEs land before the live update reads its entities —
    // the rebuild finished entirely before the live update began.
    const liveIdx = order.indexOf('live-entities-read')
    const lastDelete = order.lastIndexOf('rebuild-delete')
    expect(lastDelete).toBeGreaterThanOrEqual(0)
    expect(liveIdx).toBeGreaterThan(lastDelete)
  })

  it('loads dropped nodes once and excludes them from the whole rebuild', async () => {
    mockLoadDismissed.mockResolvedValue(new Set(['emotion:anxiety']))
    const rows = [
      entry({ id: 'e1', emotion: 'anxiety', distortion: 'catastrophizing' }),
      entry({ id: 'e2', emotion: 'calm', distortion: 'none' }),
    ]
    const fakeDb = {
      async execute(sql: string) {
        if (/^DELETE FROM/.test(sql)) return { rows: [], rowsAffected: 0 }
        const g = groupBy(sql)
        if (g) return g
        if (/^SELECT \* FROM entries/.test(sql)) return { rows, rowsAffected: 0 }
        // rebuildGraph stamps the graph-heal backlog on success.
        if (/^UPDATE entries SET graph_indexed_at/.test(sql)) return { rows: [], rowsAffected: 0 }
        throw new Error(`unhandled SQL: ${sql}`)
      },
      async transaction(fn: (tx: SqliteDatabase) => Promise<void>) {
        await fn(fakeDb)
      },
      close() {},
    } as unknown as SqliteDatabase
    setDb(fakeDb)

    await rebuildGraph()

    expect(mockLoadDismissed).toHaveBeenCalledTimes(1) // once for the rebuild, not per entry
    expect(mockUpsertNode).not.toHaveBeenCalledWith('emotion', 'anxiety', expect.anything())
    expect(mockUpsertNode).toHaveBeenCalledWith('distortion', 'catastrophizing', expect.anything())
    expect(mockUpsertNode).toHaveBeenCalledWith('emotion', 'calm', expect.anything())
  })
})

describe('F-02B: effective-label dedup in graph derivation', () => {
  beforeEach(() => {
    mockUpsertNode.mockReset()
    mockUpsertEdge.mockReset()
    mockListEntities.mockReset()
    mockFindNode.mockReset()
    mockLoadDismissed.mockReset()
    mockFindNode.mockResolvedValue(ok(null))
    mockLoadDismissed.mockResolvedValue(new Set())
    let n = 0
    mockUpsertNode.mockImplementation(async (type, label) =>
      ok({ id: `id-${++n}`, type, label, frequency: 1 })
    )
    mockUpsertEdge.mockResolvedValue(ok({}))
    setDb({ execute: jest.fn(), transaction: jest.fn(), close: jest.fn() } as unknown as SqliteDatabase)
  })
  afterEach(() => setDb(null))

  it('two raw belief aliases on one entry with the same canonical contribute ONE node and no self-edge', async () => {
    // Two raw labels snapped to the same canonical identity by belief maintenance.
    mockListEntities.mockResolvedValue(
      ok([
        { id: 'x1', entry_id: 'e1', type: 'belief', label: 'I am unlovable', canonical_label: 'I am unworthy', created_at: 0, updated_at: 0 },
        { id: 'x2', entry_id: 'e1', type: 'belief', label: 'I am bad', canonical_label: 'I am unworthy', created_at: 0, updated_at: 0 },
      ])
    )

    // Only the belief entity (no emotion/theme/distortion) → just one node, no
    // edges, and crucially no second node=alias, no self-pair edge from the brawl.
    await updateGraphForEntry(entry({ emotion: '', distortion: 'none' }), undefined, undefined, HIGH)

    const beliefCalls = mockUpsertNode.mock.calls.filter((c) => c[0] === 'belief')
    expect(beliefCalls.length).toBe(1)
    expect(beliefCalls[0][1]).toBe('I am unworthy')
    // No edge at all — only the canonical belief node was created.
    expect(mockUpsertEdge).not.toHaveBeenCalled()
  })

  it('a raw alias with no canonical is upserted under its raw label (no canonical leakage)', async () => {
    // Fresh un-canonicalized entity — effective label is the raw one.
    mockListEntities.mockResolvedValue(
      ok([{ id: 'x1', entry_id: 'e1', type: 'belief', label: 'I am unlovable', canonical_label: null, created_at: 0, updated_at: 0 }])
    )

    await updateGraphForEntry(entry({ emotion: '', distortion: 'none' }), undefined, undefined, HIGH)

    const beliefCalls = mockUpsertNode.mock.calls.filter((c) => c[0] === 'belief')
    expect(beliefCalls.length).toBe(1)
    expect(beliefCalls[0][1]).toBe('I am unlovable')
  })
})
