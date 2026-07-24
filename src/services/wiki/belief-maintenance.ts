import { type Result, ok, err } from '@/types/result'
import type { SqliteDatabase } from '@/services/storage/db'
import { getDb } from '@/services/storage/db'
import { getMaintenanceState } from '@/services/storage/maintenance-state'
import { listEntityEmbeddings, type EntityEmbedding } from '@/services/storage/entity-embeddings'
import { cosine } from './search'
import { stripBeliefFrame, isPolarityCollision } from './belief-match'
import type { WikiPage, WikiPageVersion } from '@/services/storage/wiki'

// ── Algorithm identity ───────────────────────────────────────────────────
// Bump when cluster geometry / threshold / polarity guard rules change.
// Changing this forces one rerun: maintenance checks the persisted value
// against this constant and re-processes when they differ.
export const MAINTENANCE_ALGORITHM_VERSION = 1

// ── Dry-run report — never persisted; rendered to dev UI only ────────────
// Every text field is a raw label string. The report is handed to a dev-only
// screen; nothing is logged, nothing persists to the DB. Production UI code
// never sees label text from the report (maintenance runs only in dev builds).
export interface AliasCluster {
  /** The canonical identity chosen for this cluster. Undefined when the
   *  cluster was deferred (multiple corrected pages, or page-resolution
   *  ambiguous before F-01 guarded-write exists — i.e. dry-run mode defers
   *  all but the most trivial case). */
  canonical: string | undefined
  /** Raw labels in this cluster, including the one chosen as canonical. */
  aliases: string[]
  /** Raw labels that would lose their independent entity-embedding row and
   *  bear a canonical_label pointing to the canonical identity. Count-only
   *  in repair mode; listed here for dry-run visibility. */
  effectiveAliases: string[]
  /** Whether the cluster was deferred to review-hard-ambiguity status. */
  deferred: boolean
  /** How many corrected wiki pages exist in this cluster. 0 = no corrected
   *  page; 1 = clean; >1 = deferred. */
  correctedPageCount: number
}

export interface DryRunReport {
  clusters: AliasCluster[]
  /** Total distinct raw belief labels scanned. */
  totalLabels: number
  /** Distinct effective canonical identities after dry-run clustering. */
  wouldRemain: number
  /** Raw labels that would be marked as aliases (merged into canonical). */
  wouldAlias: number
  /** Clusters deferred due to ambiguity. */
  deferredClusters: number
  /** Source generation at start of analysis. Captured by caller. */
  sourceGeneration: number
  /** True if the algorithm version changed since last run. */
  versionChanged: boolean
}

// ── In-memory raw label metadata ────────────────────────────────────────
interface RawBeliefLabel {
  id: string
  label: string
  canonical_label: string | null
  /** Earliest created_at among entry_entities rows with this type+label. */
  earliestTimestamp: number
  /** Distinct entry count for this type+label across all rows. */
  entryCount: number
}

// ── Cluster builder (pure, no side effects) ──────────────────────────────

/**
 * Query all raw belief labels from entry_entities with their metadata, plus
 * existing stored belief embeddings and wiki pages. Returns the raw label rows,
 * the embedding map keyed by label, and the page map keyed by title.
 */
export async function readBeliefLandscape(
  db: SqliteDatabase = getDb()
): Promise<
  Result<{
    labels: RawBeliefLabel[]
    embeddings: Map<string, EntityEmbedding>
    pages: Map<string, WikiPage>
  }>
> {
  try {
    // Distinct belief labels with earliest timestamp and distinct entry count.
    const labelRes = await db.execute(
      `SELECT label,
              MIN(created_at) AS first_seen,
              COUNT(DISTINCT entry_id) AS entry_count
         FROM entry_entities WHERE type = 'belief'
         GROUP BY label COLLATE NOCASE
         ORDER BY label COLLATE NOCASE`,
      []
    )
    const labels: RawBeliefLabel[] = labelRes.rows.map((r) => ({
      id: `belief:${String(r.label).toLowerCase()}`,
      label: String(r.label),
      canonical_label: null, // raw perspective — the maintenance pass further
      // annotates this from existing canonical_label data
      earliestTimestamp: Number(r.first_seen) ?? 0,
      entryCount: Number(r.entry_count) ?? 0,
    }))

    // Existing canonical metadata: read every raw row that HAS a canonical_label
    // so we re-embed from the canonical perspective and don't re-cluster a label
    // that already has a canonical mapping.
    const canonRes = await db.execute(
      "SELECT label, canonical_label FROM entry_entities WHERE type = 'belief' AND canonical_label IS NOT NULL",
      []
    )
    // Build a canonical map from raw label → effective canonical label.
    const rawToCanon = new Map<string, string>()
    for (const r of canonRes.rows) {
      const raw = String(r.label)
      const canon: string | null = r.canonical_label == null ? null : String(r.canonical_label)
      if (canon) rawToCanon.set(raw.toLowerCase(), canon)
    }
    // Stamp existing canonical onto our label rows (first row per label wins).
    for (const l of labels) {
      const canon = rawToCanon.get(l.label.toLowerCase())
      if (canon) l.canonical_label = canon
    }

    // Existing belief embeddings for frame-stripped labels.
    const embRes = await listEntityEmbeddings('belief', db)
    const embeddings: Map<string, EntityEmbedding> = embRes.success ? embRes.data : new Map()

    // All belief category wiki pages keyed by title (case-insensitive).
    const pageRes = await db.execute(
      "SELECT * FROM wiki_pages WHERE category = 'belief'",
      []
    )
    const pages = new Map<string, WikiPage>()
    for (const row of pageRes.rows) {
      // Pages may have been merged into a survivor and now only exist in the
      // merged_into target. The raw row still exists; we map by trimmed title.
      const title = String(row.title).trim()
      if (title) pages.set(title.toLowerCase(), rowToPageFromRow(row))
    }

    return ok({ labels, embeddings, pages })
  } catch (e) {
    return err('BELIEF_LANDSCAPE_FAILED', 'Failed to read belief landscape', e)
  }
}

function rowToPageFromRow(row: Record<string, unknown>): WikiPage {
  let versionHistory: WikiPageVersion[] = []
  try {
    const parsed = JSON.parse(String(row.version_history ?? '[]'))
    if (Array.isArray(parsed)) versionHistory = parsed as WikiPageVersion[]
  } catch { /* malformed stays empty */ }
  return {
    id: String(row.id),
    title: String(row.title),
    category: String(row.category) as WikiPage['category'],
    content: String(row.content ?? ''),
    entry_count: Number(row.entry_count) || 0,
    version: Number(row.version) || 0,
    version_history: versionHistory,
    created_at: Number(row.created_at) || 0,
    updated_at: Number(row.updated_at) || 0,
    dismissed_at: row.dismissed_at == null ? null : Number(row.dismissed_at),
    corrected_at: row.corrected_at == null ? null : Number(row.corrected_at),
    merged_into: row.merged_into == null ? null : String(row.merged_into),
    aggregated_upto: row.aggregated_upto == null ? 0 : Number(row.aggregated_upto),
  }
}

/** Determine whether two labels belong in the same alias cluster. Uses the
 *  same frame-stripped embedding geometry and threshold as
 *  snapBeliefSemantic, with the same polarity guard. Pure — no I/O. */
export function areBeliefsMergeable(
  a: string,
  b: string,
  embeddings: Map<string, EntityEmbedding>
): boolean {
  // Polarity guard: a negated belief and its non-negated counterpart must
  // NOT cluster even if the frame-stripped text overlaps.
  if (isPolarityCollision(a, b)) return false

  // If both have stored vectors, check similarity threshold.
  const va = embeddings.get(a)?.vector
  const vb = embeddings.get(b)?.vector
  if (va && vb) {
    return cosine(va, vb) >= 0.78 // matches BELIEF_COSINE_THRESHOLD
  }

  // Without vectors, fall back to exact match on the frame-stripped canonical.
  // This catches labels that were canonicalized pre-sync but haven't been
  // re-embedded yet.
  if (!va && !vb) {
    return stripBeliefFrame(a).toLowerCase() === stripBeliefFrame(b).toLowerCase()
  }
  return false
}

// Determine deterministic canonical label for a cluster.
export function chooseCanonicalLabel(
  aliases: string[],
  pages: Map<string, WikiPage>,
  labelMeta: Map<string, RawBeliefLabel>
): { canonical: string; correctedPageCount: number } {
  // Priority 1: a corrected wiki page title that exists in this set.
  // Dry-run: corrected pages that appear as raw labels get priority.
  const corrected: string[] = []
  for (const alias of aliases) {
    const page = pages.get(alias.toLowerCase())
    if (page && page.corrected_at != null && page.merged_into == null) {
      corrected.push(alias)
    }
  }
  if (corrected.length > 1) {
    // Multiple corrected pages in same cluster → deferred.
    return { canonical: aliases[0], correctedPageCount: corrected.length }
  }
  if (corrected.length === 1) {
    return { canonical: corrected[0], correctedPageCount: 1 }
  }

  // Priority 2: active page with most distinct raw supporting entries.
  let best = aliases[0]
  let bestScore = labelMeta.get(best.toLowerCase())?.entryCount ?? 0
  for (let i = 1; i < aliases.length; i++) {
    const a = aliases[i]
    const score = labelMeta.get(a.toLowerCase())?.entryCount ?? 0
    if (score > bestScore) {
      best = a
      bestScore = score
    } else if (score === bestScore) {
      // Tiebreak 3: earliest source timestamp.
      const tA = labelMeta.get(a.toLowerCase())?.earliestTimestamp ?? Infinity
      const tB = labelMeta.get(best.toLowerCase())?.earliestTimestamp ?? Infinity
      if (tA < tB) {
        best = a
        bestScore = score
      } else if (tA === tB) {
        // Tiebreak 4: normalized label (lowercased string comparison).
        if (a.toLowerCase() < best.toLowerCase()) {
          best = a
        } else if (a.toLowerCase() === best.toLowerCase()) {
          // Tiebreak 5: original label string comparison.
          if (a < best) best = a
        }
      }
    }
  }

  return { canonical: best, correctedPageCount: 0 }
}

/**
 * Build alias clusters from the raw label list. Each label starts in its own
 * cluster; mergeable pairs are folded together using union-find. The result
 * is an array of clusters, each with a chosen canonical identity. Clusters
 * with multiple corrected pages are flagged deferred.
 *
 * Pure — no I/O. Deterministic.
 */
export function buildAliasClusters(
  labels: RawBeliefLabel[],
  embeddings: Map<string, EntityEmbedding>,
  pages: Map<string, WikiPage>
): AliasCluster[] {
  // Build lookup by normalized (lowercased) label.
  const labelMeta = new Map<string, RawBeliefLabel>()
  for (const l of labels) labelMeta.set(l.label.toLowerCase(), l)

  // Union-find over labels.
  const parent = new Map<string, string>()
  function find(x: string): string {
    // Path halving + advance pointer to root.
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    while (parent.get(x) !== x) {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const grand = parent.get(parent.get(x)!)!
      parent.set(x, grand)
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      x = grand
    }
    return x
  }
  function union(a: string, b: string): void {
    const ra = find(a)
    const rb = find(b)
    if (ra !== rb) parent.set(ra, rb)
  }

  const labelKeys = labels.map((l) => l.label.toLowerCase())
  for (const k of labelKeys) parent.set(k, k)

  // Merge pairwise using areBeliefsMergeable.
  for (let i = 0; i < labelKeys.length; i++) {
    for (let j = i + 1; j < labelKeys.length; j++) {
      const a = labelKeys[i]
      const b = labelKeys[j]
      // Quick skip: exact lowercased string match (dedup edge) is identity.
      if (a === b) continue
      // Already merged downstream.
      if (find(a) === find(b)) continue
      // Fetch raw labels for the mergeable check.
      const rawA = labelMeta.get(a)?.label ?? a
      const rawB = labelMeta.get(b)?.label ?? b
      if (areBeliefsMergeable(rawA, rawB, embeddings)) {
        union(a, b)
      }
    }
  }

  // Collect clusters.
  const clusters = new Map<string, string[]>()
  for (const k of labelKeys) {
    const root = find(k)
    const list = clusters.get(root)
    if (list) list.push(k)
    else clusters.set(root, [k])
  }

  // Resolve each cluster to an AliasCluster.
  const result: AliasCluster[] = []
  for (const [, rawKeys] of clusters) {
    const aliases = rawKeys
      .map((k) => labelMeta.get(k)?.label ?? k)
      // Stable sort by raw label string (deterministic).
      .sort()

    // Fetch pages for the cluster.
    const { canonical, correctedPageCount } = chooseCanonicalLabel(aliases, pages, labelMeta)

    const effectiveAliases = aliases.filter((a) => a.toLowerCase() !== canonical.toLowerCase())
    const deferred = correctedPageCount > 1
    result.push({
      canonical: deferred ? undefined : canonical,
      aliases,
      effectiveAliases,
      deferred,
      correctedPageCount,
    })
  }

  // Stable sort by canonical or first alias for deterministic output.
  result.sort((a, b) => {
    const aKey = a.canonical?.toLowerCase() ?? a.aliases[0]?.toLowerCase() ?? ''
    const bKey = b.canonical?.toLowerCase() ?? b.aliases[0]?.toLowerCase() ?? ''
    if (aKey < bKey) return -1
    if (aKey > bKey) return 1
    return 0
  })

  return result
}

/**
 * Run a dry-run of belief maintenance: read the current belief landscape,
 * build alias clusters, produce a report. Never mutates any DB row. Never
 * logs label text. Returns the report for dev-only UI rendering.
 *
 * The caller must check that the embedding model is available before calling
 * this — the method reads NO model state; it only reads stored embedding
 * vectors from entity_embeddings. If a label has no vector yet, it falls
 * back to exact frame-stripped matching (no false positives from a hot model,
 * only potential missed merges from a cold one). The repair pass (F-02C
 * repair) runs backfillEntityEmbeddings first to warm the vectors.
 */
export async function runBeliefMaintenanceDryRun(
  db: SqliteDatabase = getDb()
): Promise<Result<DryRunReport>> {
  try {
    // Read current state (generation tracked even in dry-run so the caller
    // can compare after an actual repair pass).
    const stateRes = await getMaintenanceState('belief', db)
    const state = stateRes.success ? stateRes.data : null

    // Read landscape
    const landRes = await readBeliefLandscape(db)
    if (!landRes.success) return landRes
    const { labels, embeddings, pages } = landRes.data

    // Build clusters
    const clusters = buildAliasClusters(labels, embeddings, pages)

    const wouldAlias = clusters.reduce((s, c) => s + c.effectiveAliases.length, 0)
    const wouldRemain = clusters.length
    const deferredClusters = clusters.filter((c) => c.deferred).length

    return ok({
      clusters,
      totalLabels: labels.length,
      wouldRemain,
      wouldAlias,
      deferredClusters,
      sourceGeneration: state?.source_generation ?? 0,
      versionChanged: false, // not persisted yet; caller handles
    })
  } catch (e) {
    return err('BELIEF_DRYRUN_FAILED', 'Failed to run belief maintenance dry-run', e)
  }
}
