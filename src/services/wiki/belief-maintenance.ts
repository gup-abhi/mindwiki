import { type Result, ok, err } from '@/types/result'
import type { SqliteDatabase } from '@/services/storage/db'
import { getDb } from '@/services/storage/db'
import { getMaintenanceState, updateMaintenanceState } from '@/services/storage/maintenance-state'
import { listEntityEmbeddings, type EntityEmbedding } from '@/services/storage/entity-embeddings'
import { getSetting } from '@/services/storage/settings'
import { rebuildGraph as defaultRebuildGraph } from '@/services/graph/engine'
import { cosine } from './search'
import { stripBeliefFrame, isPolarityCollision } from './belief-match'
import type { WikiPage, WikiPageVersion } from '@/services/storage/wiki'

// ── Algorithm identity ───────────────────────────────────────────────────
// Bump when cluster geometry / threshold / polarity guard rules change.
// Changing this forces one rerun: maintenance checks the persisted value
// against this constant and re-processes when they differ.
export const MAINTENANCE_ALGORITHM_VERSION = 1

// ── Self-trigger loop prevention contract ──────────────────────────────
// These paths BUMP source_generation in maintenance-state.ts. They are
// OUTSIDE maintenance: raw belief/reframe ingests + sync remote applies.
// Maintenance's own rewrites (setCanonicalLabel, retargetReframeBelief) are
// INTENTIONALLY ABSENT from this list — maintenance commits never produce a
// pending pass, which is what prevents an infinite self-trigger loop.
// Increment the generation directly (via incrementSourceGeneration) on every
// row produced by these paths so an idempotent historical-repair pass can
// eventually catch up.
export const MAINTENANCE_SOURCE_KEYS = [
  'setEntitiesForEntry',
  'createReframe',
  'applyRemote',
] as const

// ── Durable graph-rebuild repair marker ─────────────────────────────────
// Settings key that records a pending graph rebuild (1 = pending) after a
// maintenance source-cluster commit. App dies between source repair and
// graph rebuild leaves this set; startup calls retryBeliefMaintenanceGraphRebuild
// which clears it once rebuildGraph succeeds.
export const MAINTENANCE_GRAPH_PENDING_KEY = 'mw_belief_repair_graph_pending'

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

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
    regrounded_upto: row.regrounded_upto == null ? 0 : Number(row.regrounded_upto),
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
 * Consolidate wiki pages under a cluster's canonical identity.
 * Called after source repair for an approved cluster. Best-effort: failure
 * logs but doesn't fail the cluster — source repair is the critical path.
 *
 * - 0 corrected pages: pick richest AI page as survivor, mark losers merged_into
 * - 1 corrected page: preserve corrected page, mark AI losers merged_into,
 *                     set entry_count/regrounded_upto so maintenance doesn't
 *                     immediately overwrite correction
 * - >1 corrected pages: no-op (deferred cluster — already skipped upstream)
 */
export async function consolidateClusterPages(
  cluster: AliasCluster,
  pages: Map<string, WikiPage>,
  db: SqliteDatabase
): Promise<Result<{ survivorId: string }>> {
  if (cluster.deferred || cluster.canonical == null) {
    return ok({ survivorId: '' })
  }

  // Find all wiki pages whose title matches any alias in the cluster.
  const matches: WikiPage[] = []
  const seen = new Set<string>()
  for (const alias of cluster.aliases) {
    const page = pages.get(alias.toLowerCase())
    if (page && !seen.has(page.id) && page.merged_into == null) {
      seen.add(page.id)
      matches.push(page)
    }
  }
  if (matches.length === 0) return ok({ survivorId: '' })

  const corrected = matches.filter((p) => p.corrected_at != null)
  const aiPages = matches.filter((p) => p.corrected_at == null)

  if (corrected.length > 1) {
    // Deferred cluster (should be skipped upstream, but guard here too).
    return ok({ survivorId: '' })
  }

  try {
    if (corrected.length === 1) {
      // ONE corrected page — preserve byte-for-byte, mark AI losers.
      const survivor = corrected[0]
      const losers = aiPages.filter((p) => p.id !== survivor.id)
      if (losers.length === 0) return ok({ survivorId: survivor.id })

      // Compute approximate total distinct entry count.
      let totalEntryCount = survivor.entry_count
      for (const p of losers) totalEntryCount += p.entry_count

      const now = Date.now()
      await db.transaction(async (tx) => {
        // Mark each loser merged_into survivor.
        for (const p of losers) {
          await tx.execute(
            'UPDATE wiki_pages SET merged_into = ?, updated_at = MAX(updated_at + 1, ?) WHERE id = ?',
            [survivor.id, now, p.id]
          )
          await tx.execute(
            `INSERT OR REPLACE INTO sync_queue (id, table_name, record_id, operation, created_at)
             VALUES (?, ?, ?, 'upsert', ?)`,
            [`sq:wiki_pages:${p.id}`, 'wiki_pages', p.id, now]
          )
        }
        // Set survivor's entry_count and regrounded_upto so maintenance
        // doesn't immediately overwrite the corrected content.
        await tx.execute(
          'UPDATE wiki_pages SET entry_count = ?, regrounded_upto = ?, updated_at = MAX(updated_at + 1, ?) WHERE id = ?',
          [totalEntryCount, totalEntryCount, now, survivor.id]
        )
        await tx.execute(
          `INSERT OR REPLACE INTO sync_queue (id, table_name, record_id, operation, created_at)
           VALUES (?, ?, ?, 'upsert', ?)`,
          [`sq:wiki_pages:${survivor.id}`, 'wiki_pages', survivor.id, now]
        )
      })

      return ok({ survivorId: survivor.id })
    } else {
      // 0 corrected pages — the canonical-title page always wins. If it does
      // not exist, retain the richest AI page but rename it to canonical so
      // future effective-label routing cannot create a second lineage.
      aiPages.sort((a, b) => {
        if (b.entry_count !== a.entry_count) return b.entry_count - a.entry_count
        return (a.updated_at ?? 0) - (b.updated_at ?? 0)
      })
      const survivor = matches.find((p) => p.title.toLowerCase() === cluster.canonical!.toLowerCase()) ?? aiPages[0]
      if (!survivor) return ok({ survivorId: '' })
      const losers = aiPages.filter((p) => p.id !== survivor.id)
      const needsRename = survivor.title.toLowerCase() !== cluster.canonical.toLowerCase()
      if (losers.length === 0 && !needsRename) return ok({ survivorId: survivor.id })

      const canonicalTitle = cluster.canonical
      if (!canonicalTitle) return ok({ survivorId: survivor.id })
      const now = Date.now()
      await db.transaction(async (tx) => {
        if (needsRename) {
          await tx.execute(
            'UPDATE wiki_pages SET title = ?, updated_at = MAX(updated_at + 1, ?) WHERE id = ?',
            [canonicalTitle, now, survivor.id]
          )
        }
        for (const p of losers) {
          await tx.execute(
            'UPDATE wiki_pages SET merged_into = ?, updated_at = MAX(updated_at + 1, ?) WHERE id = ?',
            [survivor.id, now, p.id]
          )
          await tx.execute(
            `INSERT OR REPLACE INTO sync_queue (id, table_name, record_id, operation, created_at)
             VALUES (?, ?, ?, 'upsert', ?)`,
            [`sq:wiki_pages:${p.id}`, 'wiki_pages', p.id, now]
          )
        }
        // Enqueue survivor after rename/merge so remote devices converge on
        // canonical title and merged lineage together.
        await tx.execute(
          `INSERT OR REPLACE INTO sync_queue (id, table_name, record_id, operation, created_at)
           VALUES (?, ?, ?, 'upsert', ?)`,
          [`sq:wiki_pages:${survivor.id}`, 'wiki_pages', survivor.id, now]
        )
      })

      return ok({ survivorId: survivor.id })
    }
  } catch {
    return err('CONSOLIDATION_FAILED', 'Failed to consolidate cluster pages')
  }
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

// ── F-02C historical belief maintenance ──────────────────────────────────

export interface MaintenanceRunOptions {
  /** Overrides the graph-rebuild entrypoint (TEST ONLY). Default reuses the
   *  shared graph mutex + rebuildGraph impl. Injecting a fake here lets tests
   *  simulate a rebuild failure without monkey-patching the engine. */
  rebuildGraph?: (db: SqliteDatabase) => Promise<Result<void>>
}

/** Per-pass counters returned to callers via the result type. */

/**
 * Run the idempotent historical belief-maintenance pass:
 *
 *   1. read state; no-op if (algorithm_version == current AND
 *      processed_generation == source_generation) — same-version/same-gen idle
 *   2. capture source_generation (BEFORE analysis) so concurrent raw writes
 *      during the pass arrive with a higher generation and force another pass
 *   3. read landscape + build clusters using the same geometry as the dry-run
 *   4. for each APPROVED cluster: ONE transaction writes canonical_label on
 *      matching belief entity rows + retargets reframes + enqueues each changed
 *      row + sets the graph-rebuild marker — atomic rollback on any throw
 *   5. cluster with multiple corrected pages → DEFERRED, mutate no rows,
 *      accumulate count-only `deferred_clusters`
 *   6. after ALL clusters: if the marker was set, rebuild graph ONCE; clear
 *      marker on success; on failure LEAVE marker (startup retries)
 *   7. set processed_generation = captured source_generation AND algorithm_version
 *      = MAINTENANCE_ALGORITHM_VERSION AND status='idle' ONLY when both:
 *      every approved cluster settled AND graph rebuild succeeded. Otherwise:
 *      status='needs-graph-rebuild' / 'error' and processed_generation stays
 *      unchanged so the pass remains pending for retry.
 *
 * The pass never throws; every failure degrades to a Result error or a status
 * row. Page consolidation is disabled in this slice (slice 8, gated on F-01).
 */
export async function runBeliefMaintenance(
  db: SqliteDatabase = getDb(),
  options: MaintenanceRunOptions = {}
): Promise<Result<{ repairedClusters: number; deferredClusters: number; consolidatedClusters: number; status: string }>> {
  const rebuild = options.rebuildGraph ?? ((_: SqliteDatabase) => defaultRebuildGraph())

  try {
    // 1) State read
    const stateRes = await getMaintenanceState('belief', db)
    if (!stateRes.success) return stateRes
    const state = stateRes.data

    const markerRes = await getSetting(MAINTENANCE_GRAPH_PENDING_KEY, db)
    const markerPending = markerRes.success && markerRes.data === '1'
    if (markerPending || state.status === 'needs-graph-rebuild') {
      const retry = await retryBeliefMaintenanceGraphRebuild(db, options)
      if (!retry.success) return retry
      const settled = await getMaintenanceState('belief', db)
      if (!settled.success) return settled
      return ok({
        repairedClusters: settled.data.repaired_clusters,
        deferredClusters: settled.data.deferred_clusters,
        consolidatedClusters: settled.data.consolidated_clusters,
        status: settled.data.status,
      })
    }

    // Rerun gate: algorithm_version mismatch OR source_generation >
    // processed_generation. A same-version/same-processed pass is a no-op.
    const versionChanged = state.algorithm_version !== MAINTENANCE_ALGORITHM_VERSION
    const pendingDelta = state.source_generation > state.processed_generation
    if (!versionChanged && !pendingDelta) {
      return ok({ repairedClusters: state.repaired_clusters, deferredClusters: state.deferred_clusters, consolidatedClusters: state.consolidated_clusters, status: state.status })
    }

    // 2) Capture source_generation BEFORE analysis.
    const capturedGeneration = state.source_generation

    let deferred = 0
    let repaired = 0
    let consolidated = 0
    let sourceChanged = false
    let firstError: { code: string; message: string } | undefined

    {
      // 3) Read landscape + build clusters
      const landRes = await readBeliefLandscape(db)
      if (!landRes.success) return landRes
      const { labels, embeddings, pages } = landRes.data
      const clusters = buildAliasClusters(labels, embeddings, pages)

      for (const cluster of clusters) {
        if (cluster.deferred || cluster.canonical == null) {
          // 5) Deferred cluster — mutate no rows, count-only.
          deferred++
          continue
        }
        // Skip single-label clusters with no aliases — a no-op for source rows.
        if (cluster.effectiveAliases.length === 0) continue

        const canonical = cluster.canonical
        // 4) ONE transaction per approved cluster:
        let clusterCommitted = false
        try {
          await db.transaction(async (tx: SqliteDatabase) => {
            // For each alias to retire: write canonical_label + bumped updated_at
            // on every belief entity row whose label matches this alias.
            for (const alias of cluster.effectiveAliases) {
              // Find every matching belief entity row (by label, case-insensitive).
              // We can issue a single UPDATE WHERE LOWER(label) IN (...) to batch.
              // Using setCanonicalLabel per row keeps the storage helper contract
              // (one enqueue per row, best-effort). Both paths must enqueue in-tx.
              const rows = await tx.execute(
                "SELECT id FROM entry_entities WHERE type = 'belief' AND LOWER(label) = ?",
                [alias.toLowerCase()]
              )
              for (const r of rows.rows) {
                const rowId = String(r.id)
                await tx.execute(
                  'UPDATE entry_entities SET canonical_label = ?, updated_at = MAX(updated_at, ?) WHERE id = ?',
                  [canonical, Date.now(), rowId]
                )
                // Enqueue inside the same tx so a rollback unrolls the enqueue too.
                await tx.execute(
                  `INSERT OR REPLACE INTO sync_queue (id, table_name, record_id, operation, created_at)
                   VALUES (?, ?, ?, 'upsert', ?)`,
                  [`sq:entry_entities:${rowId}`, 'entry_entities', rowId, Date.now()]
                )
              }
            }
            // Retarget any reframe rows under a retired alias to the canonical.
            for (const alias of cluster.effectiveAliases) {
              const now = Date.now()
              const upd = await tx.execute(
                'UPDATE belief_reframes SET belief = ?, updated_at = ? WHERE belief = ? COLLATE NOCASE',
                [canonical, now, alias]
              )
              const n = Number(upd.rowsAffected ?? 0)
              if (n > 0) {
                // Enqueue the retargeted reframes (read-after-write by belief=canonical
                // — same as the storage helper).
                const re = await tx.execute(
                  'SELECT id FROM belief_reframes WHERE belief = ? COLLATE NOCASE',
                  [canonical]
                )
                for (const r of re.rows) {
                  const rid = String(r.id)
                  await tx.execute(
                    `INSERT OR REPLACE INTO sync_queue (id, table_name, record_id, operation, created_at)
                     VALUES (?, ?, ?, 'upsert', ?)`,
                    [`sq:belief_reframes:${rid}`, 'belief_reframes', rid, Date.now()]
                  )
                }
              }
            }
            // Set the graph-rebuild marker IN the same transaction — survives
            // crash and (together with the source writes) is unrolled if tx fails.
            await tx.execute(
              `INSERT INTO settings (key, value) VALUES (?, ?)
                 ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
              [MAINTENANCE_GRAPH_PENDING_KEY, '1']
            )
          })
          repaired++
          clusterCommitted = true
          sourceChanged = true
        } catch (e: unknown) {
          // Tx rolled back: NO canonical_label leak for this cluster.
          if (!firstError) firstError = { code: 'BELIEF_MAINTENANCE_TX_FAILED', message: errorMessage(e) }
          // Continue with other clusters (one failed tx doesn't abort others).
        }

        // Page consolidation — best-effort, only after this cluster's source
        // repair committed. A rolled-back cluster must keep its separate pages.
        if (clusterCommitted) {
          try {
            const consRes = await consolidateClusterPages(cluster, pages, db)
            if (consRes.success && consRes.data.survivorId) {
              consolidated++
            }
          } catch {
            // Best-effort — next pass retries consolidation.
          }
        }
      }
    }

    // 6) After ALL source-cluster transactions: rebuild graph ONCE if any source
    // wrote committed.
    let graphOk = true
    if (sourceChanged) {
      let r: Result<void>
      try {
        r = await rebuild(db)
      } catch (e: unknown) {
        // Inject hooks may throw (test simulates a broken rebuild); treat as
        // a failed Result rather than propagating out — the durable marker
        // stays set so startup retry can redo the rebuild.
        r = err('BELIEF_MAINTENANCE_GRAPH_FAILED', errorMessage(e), e)
      }
      if (!r.success) {
        graphOk = false
      } else {
        // Clear the durable marker on success. Use DELETE so getSetting returns
        // null sentinel ('1' → marker unset). A '0' string is also a valid clear
        // but null matches the read boundary the maintenance runner uses.
        await db.execute('DELETE FROM settings WHERE key = ?', [MAINTENANCE_GRAPH_PENDING_KEY])
      }
    }

    // 7) State settle: only advance processed_generation when every approved
    // cluster settled AND graph rebuild succeeded. A failure leaves the pass
    // pending so launch retry / next pass resumes.
    const allSettled = !firstError && graphOk
    const newStatus = !graphOk
      ? 'needs-graph-rebuild'
      : firstError
        ? 'error'
        : 'idle'
    const newProcessed = allSettled ? capturedGeneration : state.processed_generation

    await updateMaintenanceState(
      {
        algorithm_version: MAINTENANCE_ALGORITHM_VERSION,
        processed_generation: newProcessed,
        status: newStatus,
        last_run_at: Date.now(),
        repaired_clusters: repaired,
        deferred_clusters: deferred,
        consolidated_clusters: consolidated,
        run_count: state.run_count + 1,
      },
      'belief',
      db
    )

    if (firstError || !graphOk) {
      return err(
        firstError?.code ?? 'BELIEF_MAINTENANCE_GRAPH_FAILED',
        firstError?.message ?? 'graph rebuild failed — marker left pending'
      )
    }
    return ok({ repairedClusters: repaired, deferredClusters: deferred, consolidatedClusters: consolidated, status: newStatus })
  } catch (e) {
    return err('BELIEF_MAINTENANCE_FAILED', 'Failed to run belief maintenance', e)
  }
}

/**
 * Retry a previously-interrupted graph rebuild. Startup hook: if the
 * maintenance state is `needs-graph-rebuild` (or the marker setting is set),
 * call this after device boot. On success it clears the marker and settles
 * processed_generation to the captured source_generation that was already
 * advanced at the time the marker was set — since source repair already
 * committed, only the graph remains to redo.
 *
 * Idempotent: clears the marker only on a successful rebuild.
 */
export async function retryBeliefMaintenanceGraphRebuild(
  db: SqliteDatabase = getDb(),
  options: MaintenanceRunOptions = {}
): Promise<Result<void>> {
  const rebuild = options.rebuildGraph ?? ((_: SqliteDatabase) => defaultRebuildGraph())
  try {
    const markerRes = await getSetting(MAINTENANCE_GRAPH_PENDING_KEY, db)
    const marker = markerRes.success ? markerRes.data : null
    if (marker !== '1') return ok(undefined)

    let r: Result<void>
    try {
      r = await rebuild(db)
    } catch (e: unknown) {
      // Injected hook may throw (test simulates a broken rebuild). Treat as a
      // failed Result — the durable marker stays set so a later retry can redo.
      r = err('BELIEF_MAINTENANCE_GRAPH_FAILED', errorMessage(e), e)
    }
    if (!r.success) return r
    await db.execute('DELETE FROM settings WHERE key = ?', [MAINTENANCE_GRAPH_PENDING_KEY])

    // If source repair already completed and we just now finished the graph,
    // advance processed_generation to the captured source_generation that
    // was current at label-settle time. Re-read state and settle.
    const stateRes = await getMaintenanceState('belief', db)
    if (stateRes.success) {
      const state = stateRes.data
      if (state.status === 'needs-graph-rebuild') {
        await updateMaintenanceState(
          {
            status: 'idle',
            processed_generation: state.source_generation,
            last_run_at: Date.now(),
            run_count: state.run_count + 1,
          },
          'belief',
          db
        )
      }
    }
    return ok(undefined)
  } catch (e) {
    return err('BELIEF_MAINTENANCE_RETRY_FAILED', 'Failed to retry graph rebuild', e)
  }
}
