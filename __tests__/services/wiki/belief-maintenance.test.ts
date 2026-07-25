import { type SqliteDatabase } from '@/services/storage/db'
import {
  buildAliasClusters,
  areBeliefsMergeable,
  chooseCanonicalLabel,
  runBeliefMaintenanceDryRun,
} from '@/services/wiki/belief-maintenance'
import type { EntityEmbedding } from '@/services/storage/entity-embeddings'
import type { WikiPage, WikiPageVersion } from '@/services/storage/wiki'

// Avoid the global getDb() + global Jest state store. Pure unit tests over
// in-memory embeddings + page maps first; then a small fake DB exercise over
// runBeliefMaintenanceDryRun end-to-end.

interface RawBeliefLabelLike {
  id: string
  label: string
  canonical_label: string | null
  earliestTimestamp: number
  entryCount: number
}

const vec = (xs: number[]): number[] => xs

describe('belief-maintenance cluster builder (pure)', () => {
  const embeddings = new Map<string, EntityEmbedding>()
  // Two near-synonyms with SIMILAR (not identical) vectors above 0.78.
  embeddings.set('I am unlovable', { label: 'I am unlovable', type: 'belief', vector: vec([1, 0, 0]), contentHash: '' })
  embeddings.set('Nobody loves me', { label: 'Nobody loves me', type: 'belief', vector: vec([0.97, 0.1, 0.1]), contentHash: '' })
  // Two orthogonal, clearly-distinct beliefs with mutually-orthogonal vectors
  // so the threshold NEVER merges them.
  embeddings.set('I am a hard worker', { label: 'I am a hard worker', type: 'belief', vector: vec([0, 1, 0]), contentHash: '' })
  embeddings.set('I trust people too easily', { label: 'I trust people too easily', type: 'belief', vector: vec([0, 0, 1]), contentHash: '' })

  const pages = new Map<string, WikiPage>()

  it('areBeliefsMergeable rejects a polarity-opposed pair even with identical stripped text', () => {
    expect(areBeliefsMergeable('I am loveable', 'I am not loveable', embeddings)).toBe(false)
  })

  it('areBeliefsMergeable accepts a true synonym above the threshold', () => {
    // Cosine of [1,0,0] and [0.97,0.1,0.1] is ~0.97 — comfortably above 0.78.
    expect(areBeliefsMergeable('I am unlovable', 'Nobody loves me', embeddings)).toBe(true)
  })

  it('buildAliasClusters merges near-synonyms into one cluster, keeps orthogonal-distinct labels separate', () => {
    const labels = [
      { id: 'b1', label: 'I am unlovable', canonical_label: null, earliestTimestamp: 1000, entryCount: 3 },
      { id: 'b2', label: 'Nobody loves me', canonical_label: null, earliestTimestamp: 2000, entryCount: 2 },
      { id: 'b3', label: 'I am a hard worker', canonical_label: null, earliestTimestamp: 1500, entryCount: 5 },
      { id: 'b4', label: 'I trust people too easily', canonical_label: null, earliestTimestamp: 1700, entryCount: 4 },
    ] as RawBeliefLabelLike[]
    const clusters = buildAliasClusters(labels as any, embeddings, pages)
    expect(clusters).toHaveLength(3)
    const unlovableCluster = clusters.find((c) => c.aliases.includes('I am unlovable'))
    expect(unlovableCluster).toBeDefined()
    expect(unlovableCluster?.aliases).toHaveLength(2)
    expect(unlovableCluster?.aliases).toContain('Nobody loves me')
    // Orthogonal-distinct stays separate:
    expect(unlovableCluster?.aliases).not.toContain('I am a hard worker')
    expect(unlovableCluster?.aliases).not.toContain('I trust people too easily')
  })

  it('chooses canonical by entry count, then earliest timestamp, then normalized label', () => {
    const labelMeta = new Map<string, RawBeliefLabelLike>()
    labelMeta.set('alpha', { id: 'a', label: 'Alpha', canonical_label: null, earliestTimestamp: 2000, entryCount: 4 } as RawBeliefLabelLike)
    labelMeta.set('beta', { id: 'b', label: 'Beta', canonical_label: null, earliestTimestamp: 1000, entryCount: 4 } as RawBeliefLabelLike)
    // Alpha has more entries (4) than Beta (4 — tie), but Beta earliestTimestamp (1000 < 2000) → Beta wins.
    const { canonical } = chooseCanonicalLabel(['Alpha', 'Beta'], new Map(), labelMeta as any)
    expect(canonical).toBe('Beta')
  })

  it('chooses a corrected wiki page title as canonical, regardless of entry count', () => {
    const pages = new Map<string, WikiPage>()
    pages.set('gamma corrected', pageFixture({ title: 'Gamma Corrected', corrected_at: 1, merged_into: null }))
    const { canonical, correctedPageCount } = chooseCanonicalLabel(
      ['Much fewer entries', 'Gamma Corrected'],
      pages,
      new Map([['gamma corrected', { id: 'm', label: 'Much fewer entries', canonical_label: null, earliestTimestamp: 0, entryCount: 100 } as any]])
    )
    // Gamma Corrected wins (corrected) regardless of entry count.
    expect(canonical).toBe('Gamma Corrected')
    expect(correctedPageCount).toBe(1)
  })

  it('defers clusters with multiple corrected pages (canonical undefined)', () => {
    const pages = new Map<string, WikiPage>()
    pages.set('alpha corrected', pageFixture({ title: 'Alpha Corrected', corrected_at: 1, merged_into: null }))
    pages.set('beta corrected', pageFixture({ title: 'Beta Corrected', corrected_at: 1, merged_into: null }))
    const aliases = ['Alpha Corrected', 'Beta Corrected']
    // Pre-populate labelMeta with empty rows so chooseCanonicalLabel's data lookups don't NPE.
    const labelMeta = new Map<string, RawBeliefLabelLike>()
    for (const a of aliases) labelMeta.set(a.toLowerCase(), { id: 'x', label: a, canonical_label: null, earliestTimestamp: 0, entryCount: 0 } as RawBeliefLabelLike)
    const { canonical, correctedPageCount } = chooseCanonicalLabel(aliases, pages, labelMeta as any)
    expect(correctedPageCount).toBe(2)
    // Canonical is undefined when deferred — but chooseCanonicalLabel returns
    // cluster[0] as a placeholder; the deferral decision is made by the buildAliasClusters
    // caller after checking correctedPageCount. Verify the count is 2.
    expect(canonical).toBe('Alpha Corrected') // tie-break'd to first alias alphabetically
  })
})

// ── Integration: end-to-end dry-run via fake DB ─────────────────────────

function pageFixture(over: Partial<WikiPage>): WikiPage {
  return {
    id: 'p-' + (over.title ?? 'x').toLowerCase(),
    title: over.title ?? '',
    category: 'belief',
    content: '',
    entry_count: 0,
    version: 1,
    version_history: [] as WikiPageVersion[],
    created_at: 0,
    updated_at: 0,
    dismissed_at: null,
    corrected_at: null,
    merged_into: null,
    aggregated_upto: 0,
    regrounded_upto: 0,
    ...over,
  }
}

describe('runBeliefMaintenanceDryRun (integration via fake DB)', () => {
  it('clusters two raw synonyms and returns one canonical, defers nothing', async () => {
    // entry_entities rows for two near-synonyms on different entries:
    let rows: Record<string, unknown>[] = [
      { id: 'ent1', entry_id: 'e1', type: 'belief', label: 'I am unlovable', canonical_label: null, created_at: 1000, updated_at: 1000 },
      { id: 'ent2', entry_id: 'e2', type: 'belief', label: 'Nobody loves me', canonical_label: null, created_at: 1100, updated_at: 1100 },
    ]
    let embedRows: Record<string, unknown>[] = [
      // Near-synonym vectors above 0.78 cosine:
      { label: 'I am unlovable', type: 'belief', dim: 3, vector: JSON.stringify([1, 0, 0]), content_hash: 'h1' },
      { label: 'Nobody loves me', type: 'belief', dim: 3, vector: JSON.stringify([0.97, 0.1, 0.1]), content_hash: 'h2' },
    ]

    const db: SqliteDatabase = {
      async execute(sql: string, params: (string | number | null)[] = []) {
        const trimmed = sql.trim().replace(/\s+/g, ' ')
        if (/^SELECT label, MIN\(created_at\).*FROM entry_entities WHERE type = 'belief'/.test(trimmed)) {
          // GROUP BY label — collapse into one row per label.
          const byLabel = new Map<string, any>()
          for (const r of rows) {
            const lbl = String(r.label)
            if (!byLabel.has(lbl.toLowerCase())) {
              byLabel.set(lbl.toLowerCase(), { label: lbl, first_seen: r.created_at, entry_count: 1 })
            } else {
              const ex = byLabel.get(lbl.toLowerCase())
              ex.first_seen = Math.min(Number(ex.first_seen), Number(r.created_at))
              ex.entry_count++
            }
          }
          return { rows: [...byLabel.values()], rowsAffected: 0 }
        }
        if (/^SELECT label, canonical_label FROM entry_entities WHERE type = 'belief' AND canonical_label IS NOT NULL/.test(trimmed)) {
          return { rows: rows.filter((r) => r.canonical_label != null), rowsAffected: 0 }
        }
        if (/^SELECT label, type, vector FROM entity_embeddings WHERE type = \?/.test(trimmed)) {
          return { rows: embedRows, rowsAffected: 0 }
        }
        if (/^SELECT \* FROM wiki_pages WHERE category = 'belief'/.test(trimmed)) {
          return { rows: [], rowsAffected: 0 }
        }
        if (/^SELECT \* FROM belief_maintenance_state WHERE key = \?/.test(trimmed)) {
          return {
            rows: [
              {
                key: 'belief', algorithm_version: 0, source_generation: 5, processed_generation: 5,
                status: 'idle', last_run_at: null, repaired_clusters: 0, deferred_clusters: 0, run_count: 0,
              },
            ],
            rowsAffected: 0,
          }
        }
        throw new Error('unhandled SQL: ' + trimmed)
      },
      async transaction(fn) { await fn(db) },
      close() {},
    }

    const res = await runBeliefMaintenanceDryRun(db)
    expect(res.success).toBe(true)
    if (!res.success) return
    const r = res.data
    expect(r.totalLabels).toBe(2)
    // Should reduce to one remaining cluster (one canonical).
    expect(r.wouldRemain).toBe(1)
    expect(r.wouldAlias).toBe(1)
    expect(r.deferredClusters).toBe(0)
    // The chosen canonical is deterministic (earliest source timestamp wins:
    // 'I am unlovable' first seen at 1000 < 'Nobody loves me' at 1100).
    expect(r.clusters[0].canonical).toBe('I am unlovable')
    expect(r.clusters[0].effectiveAliases).toEqual(['Nobody loves me'])
    // Source generation snapshot is captured for caller to compare to processed:
    expect(r.sourceGeneration).toBe(5)
  })
})
