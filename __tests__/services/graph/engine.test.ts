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
  })

  it('upserts a node per tag and an edge per co-occurring pair', async () => {
    await updateGraphForEntry(entry(), 'Work', undefined, HIGH) // emotion + distortion + theme = 3 nodes

    expect(mockUpsertNode).toHaveBeenCalledWith('emotion', 'anxiety')
    expect(mockUpsertNode).toHaveBeenCalledWith('distortion', 'catastrophizing')
    expect(mockUpsertNode).toHaveBeenCalledWith('situation', 'Work')
    // 3 nodes -> 3 unique pairs
    expect(mockUpsertEdge).toHaveBeenCalledTimes(3)
  })

  it('skips distortion "none" and makes no edge for a single node', async () => {
    await updateGraphForEntry(entry({ distortion: 'none' }), undefined, undefined, HIGH) // only emotion (no topic)

    expect(mockUpsertNode).toHaveBeenCalledTimes(1)
    expect(mockUpsertNode).toHaveBeenCalledWith('emotion', 'anxiety')
    expect(mockUpsertEdge).not.toHaveBeenCalled()
  })

  it('does nothing for an untagged entry', async () => {
    await updateGraphForEntry(entry({ emotion: null, distortion: null }), undefined, undefined, HIGH)
    expect(mockUpsertNode).not.toHaveBeenCalled()
  })

  it('skips a theme node that just repeats the emotion (case-insensitive)', async () => {
    await updateGraphForEntry(entry({ emotion: 'loneliness', distortion: 'none' }), 'Loneliness', undefined, HIGH)

    // only the emotion node — no duplicate "situation" node for the same word
    expect(mockUpsertNode).toHaveBeenCalledTimes(1)
    expect(mockUpsertNode).toHaveBeenCalledWith('emotion', 'loneliness')
    expect(mockUpsertNode).not.toHaveBeenCalledWith('situation', 'Loneliness')
  })

  it('attaches a theme to an existing same-label node instead of duplicating it', async () => {
    // A "Work" place node already exists from a prior entry.
    mockFindNode.mockResolvedValue(ok({ id: 'wk', type: 'place', label: 'Work', frequency: 3 }))
    await updateGraphForEntry(entry({ distortion: 'none' }), 'Work', undefined, HIGH) // emotion + theme "Work"

    // the theme reuses the existing place node — no second "situation" node
    expect(mockUpsertNode).toHaveBeenCalledWith('place', 'Work')
    expect(mockUpsertNode).not.toHaveBeenCalledWith('situation', 'Work')
  })

  it('skips a theme that repeats one of this entry\'s own entities', async () => {
    mockListEntities.mockResolvedValue(
      ok([{ id: 'x1', entry_id: 'e1', type: 'place', label: 'Gym', created_at: 0 }])
    )
    await updateGraphForEntry(entry({ distortion: 'none' }), 'gym', undefined, HIGH) // theme echoes the place

    expect(mockUpsertNode).toHaveBeenCalledWith('place', 'Gym')
    expect(mockUpsertNode).not.toHaveBeenCalledWith('situation', 'gym')
    expect(mockFindNode).not.toHaveBeenCalled() // resolved in-entry, no DB lookup needed
  })

  it('skips a dropped node (and any edge to it) when deriving from an entry', async () => {
    // emotion "anxiety" was dropped — only the distortion node should be built.
    await updateGraphForEntry(entry(), null, new Set(['emotion:anxiety']), HIGH)

    expect(mockUpsertNode).toHaveBeenCalledTimes(1)
    expect(mockUpsertNode).toHaveBeenCalledWith('distortion', 'catastrophizing')
    expect(mockUpsertNode).not.toHaveBeenCalledWith('emotion', 'anxiety')
    expect(mockUpsertEdge).not.toHaveBeenCalled() // single surviving node → no pair
  })

  it('adds person/place/activity nodes from the entry entities', async () => {
    mockListEntities.mockResolvedValue(
      ok([
        { id: 'x1', entry_id: 'e1', type: 'person', label: 'Sarah', created_at: 0 },
        { id: 'x2', entry_id: 'e1', type: 'place', label: 'Office', created_at: 0 },
      ])
    )
    await updateGraphForEntry(entry({ distortion: 'none' }), null, undefined, HIGH) // emotion + 2 entities = 3 nodes

    expect(mockUpsertNode).toHaveBeenCalledWith('emotion', 'anxiety')
    expect(mockUpsertNode).toHaveBeenCalledWith('person', 'Sarah')
    expect(mockUpsertNode).toHaveBeenCalledWith('place', 'Office')
    expect(mockUpsertEdge).toHaveBeenCalledTimes(3) // 3 nodes -> 3 pairs
  })

  describe('recurrence gate', () => {
    it('creates no node when a signal appears in only one entry', async () => {
      const ONCE: SupportCounter = async () => 1
      await updateGraphForEntry(entry(), 'Work', undefined, ONCE)
      expect(mockUpsertNode).not.toHaveBeenCalled() // emotion, distortion, theme all uncorroborated
      expect(mockUpsertEdge).not.toHaveBeenCalled()
    })

    it('materializes only the signals corroborated by >=2 entries', async () => {
      // Emotion recurs; the distortion + theme are one-offs.
      const sup: SupportCounter = async (type) => (type === 'emotion' ? 2 : 1)
      await updateGraphForEntry(entry(), 'Work', undefined, sup)

      expect(mockUpsertNode).toHaveBeenCalledTimes(1)
      expect(mockUpsertNode).toHaveBeenCalledWith('emotion', 'anxiety')
      expect(mockUpsertNode).not.toHaveBeenCalledWith('distortion', 'catastrophizing')
      expect(mockUpsertNode).not.toHaveBeenCalledWith('situation', 'Work')
      expect(mockUpsertEdge).not.toHaveBeenCalled() // one node → no pair
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
    if (/GROUP BY topic/.test(sql)) return { rows: [], rowsAffected: 0 }
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
    expect(mockUpsertNode).toHaveBeenCalledWith('emotion', 'anxiety')
    expect(mockUpsertNode).toHaveBeenCalledWith('distortion', 'catastrophizing')
    expect(mockUpsertNode).toHaveBeenCalledWith('emotion', 'calm')
    expect(mockUpsertEdge).toHaveBeenCalledTimes(1) // e1: 2 nodes→1 edge; e2: 1 node→0
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
    expect(mockUpsertNode).not.toHaveBeenCalledWith('emotion', 'anxiety')
    expect(mockUpsertNode).toHaveBeenCalledWith('distortion', 'catastrophizing')
    expect(mockUpsertNode).toHaveBeenCalledWith('emotion', 'calm')
  })
})
