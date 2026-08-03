import { CryptoModule } from '@/native/CryptoModule'
import { authenticatedFetch } from '@/services/auth/api-client'
import { getTokens } from '@/services/auth/token-store'
import { rebuildGraph } from '@/services/graph/engine'
import { type SqliteDatabase, getDb, isWiping } from '@/services/storage/db'
import { getSetting, setSetting } from '@/services/storage/settings'
import { pendingUploads, markSynced, backfillSyncQueue, enqueueUpsert } from '@/services/storage/sync-queue'
import { incrementSourceGeneration } from '@/services/storage/maintenance-state'
import { useSyncStore } from '@/store/sync.store'
import { type Result, ok, err } from '@/types/result'
import { repairLegacyRow } from '@/services/wiki/legacy-backfill'
import { startSessionWork } from '@/services/auth/session-work'

import {
  SYNCED_TABLES,
  recordsToApply,
  shouldApplyRemote,
  type SyncTable,
  type Versioned,
  type LocalVersion,
} from './conflict'
import {
  createSyncId,
  decryptLegacyRecord,
  decryptRecord,
  encryptRecord,
} from './encryption'

const LAST_PULL_KEY = 'sync:last_pull'
// Resumable pull state: the delta window spans sync passes. `since` is the
// data cursor (advanced only when the window is fully drained), `cursor` is the
// server's R2 list position (pinned mid-window so a large window never
// re-scans from the start), `windowMax` is the highest scanned updated_at seen
// so far across the paused passes.
const PULL_STATE_KEY = 'sync:pull_state'
// Retry budget for records that fail to decrypt/parse/apply during a pull.
// After this many failures the record is dropped permanently on this device
// (count-only log) so a permanently-bad row cannot hold the cursor hostage.
const QUARANTINE_MAX_ATTEMPTS = 3
// Wall-clock time of the last successful sync (push+pull completed). Distinct
// from LAST_PULL_KEY, which is a data cursor (newest remote updated_at) — that
// doesn't move when there's nothing newer to pull, so it can't represent "last
// synced". Surfaced in Settings.
const LAST_SYNCED_KEY = 'sync:last_synced_at'
const SYNC_ID_PATTERN = /^[0-9a-f]{64}$/
const MIN_CIPHERTEXT_HEX_LENGTH = 56
const MAX_CIPHERTEXT_HEX_LENGTH = 1_000_000
const MAX_DELTA_RECORDS = 8
const MAX_DELTA_PAGES = 512
const MAX_DELTA_CIPHERTEXT_HEX = 64_000_000
const MAX_FUTURE_SKEW_MS = 24 * 60 * 60 * 1_000
const MAX_LEGACY_RECORD_ID_BYTES = 2_048

type Row = Record<string, unknown>

// Per-table sync config: which columns make up a record and how to read its
// effective last-modified time.
export const TABLES: Record<SyncTable, { columns: string[]; updatedAt: (row: Row) => number }> = {
  entries: {
    columns: [
      'id', 'created_at', 'mood', 'situation', 'thought', 'behavior',
      'closing_note', 'emotion', 'named_emotion', 'energy', 'distortion', 'mood_score', 'topic', 'topic2', 'tagged_at', 'updated_at', 'raw_text', 'source',
    ],
    updatedAt: (r) => Number(r.updated_at) || 0,
  },
  wiki_pages: {
    columns: [
      'id', 'title', 'category', 'content', 'entry_count', 'version',
      'version_history', 'created_at', 'updated_at', 'dismissed_at', 'corrected_at', 'merged_into', 'aggregated_upto', 'regrounded_upto',
    ],
    updatedAt: (r) => Number(r.updated_at) || 0,
  },
  // Entities are now mutable (F-02B: canonical_label may be set by belief
  // maintenance and updated_at bumped), so updated_at is the LWW watermark.
  // A row sent by a pre-030 device omits updated_at/canonical_label; applyRemote
  // derives both on receipt (updated_at = created_at, canonical_label = null).
  entry_entities: {
    columns: ['id', 'entry_id', 'type', 'label', 'canonical_label', 'created_at', 'updated_at'],
    updatedAt: (r) => Number(r.updated_at) || Number(r.created_at) || 0,
  },
  conversations: {
    columns: ['id', 'title', 'created_at', 'updated_at', 'summary', 'summary_count'],
    updatedAt: (r) => Number(r.updated_at) || 0,
  },
  // chat_messages are append-only (never edited), so created_at is a sufficient
  // last-write-wins watermark.
  chat_messages: {
    columns: [
      'id', 'conversation_id', 'role', 'content', 'sources_json', 'crisis_tier', 'created_at',
    ],
    updatedAt: (r) => Number(r.created_at) || 0,
  },
  challenges: {
    columns: [
      'id', 'title', 'details', 'target_days', 'current_streak', 'last_checkin_date',
      'status', 'affirmation', 'created_at', 'updated_at', 'completed_at', 'deleted_at',
    ],
    updatedAt: (r) => Number(r.updated_at) || 0,
  },
  graph_node_dismissals: {
    columns: ['id', 'type', 'label', 'dismissed_at', 'updated_at'],
    updatedAt: (r) => Number(r.updated_at) || 0,
  },
  belief_reframes: {
    columns: [
      'id', 'belief', 'evidence_for', 'evidence_against', 'balanced_thought',
      'created_at', 'updated_at',
    ],
    updatedAt: (r) => Number(r.updated_at) || 0,
  },
  streak_freezes: {
    columns: ['id', 'day_index', 'frozen_at', 'updated_at'],
    updatedAt: (r) => Number(r.updated_at) || 0,
  },
}

function isSyncTable(t: string): t is SyncTable {
  return (SYNCED_TABLES as string[]).includes(t)
}

/** INSERT OR REPLACE a remote row directly. Normal remote rows bypass storage
 * write helpers and do not re-enqueue; repaired legacy wiki rows are queued by
 * pullDelta so canonicalization propagates to older devices. */
async function applyRemote(table: SyncTable, row: Row, db: SqliteDatabase): Promise<boolean> {
  // Canonicalize rows from older devices before storage. Repaired rows are
  // re-uploaded below so older devices cannot reintroduce the legacy shape.
  let repaired = false
  if (table === 'wiki_pages') {
    const canonical = repairLegacyRow(row)
    if (canonical) {
      Object.assign(row, canonical)
      row.updated_at = Math.max((Number(row.updated_at) || 0) + 1, Date.now())
      repaired = true
    }
  }
  // Devices upgraded from pre-029 may send an entry row without the new
  // watermark. Derive the legacy value on receipt so the NOT NULL column stays
  // valid and the row remains syncable.
  if (table === 'entries' && row.updated_at == null) {
    row.updated_at = Math.max(Number(row.created_at) || 0, Number(row.tagged_at) || 0)
  }
  // F-01: legacy wiki_pages payloads (pre-migration-030) lack regrounded_upto.
  // Default it to 0 so the NOT NULL column stays valid on receipt.
  if (table === 'wiki_pages' && row.regrounded_upto == null) {
    row.regrounded_upto = 0
  }
  // F-02B — a pre-030 device sends an entity row without canonical_label /
  // updated_at. Backfill both so the NOT NULL updated_at stays valid and the
  // row is treated as its own raw identity (canonical_label = null).
  if (table === 'entry_entities') {
    if (row.updated_at == null) row.updated_at = Number(row.created_at) || 0
    if (row.canonical_label === undefined) row.canonical_label = null
  }
  const cols = TABLES[table].columns
  const placeholders = cols.map(() => '?').join(', ')
  await db.execute(
    `INSERT OR REPLACE INTO ${table} (${cols.join(', ')}) VALUES (${placeholders})`,
    cols.map((c) => (row[c] === undefined ? null : (row[c] as never)))
  )
  return repaired
}

/** Local updated_at for a set of record ids (missing ids are simply absent). */
/** Deterministic projection of a row's synced columns — equal-ts tie-break. */
function projectContent(table: SyncTable, row: Row): string {
  return JSON.stringify(TABLES[table].columns.map((c) => row[c] ?? null))
}

/** Local version (updated_at + content projection) for each of the given ids. */
async function localState(
  table: SyncTable,
  ids: string[],
  db: SqliteDatabase
): Promise<Map<string, LocalVersion>> {
  const map = new Map<string, LocalVersion>()
  if (ids.length === 0) return map
  const placeholders = ids.map(() => '?').join(', ')
  const res = await db.execute(`SELECT * FROM ${table} WHERE id IN (${placeholders})`, ids)
  for (const row of res.rows) {
    map.set(String(row.id), {
      updated_at: TABLES[table].updatedAt(row),
      content: projectContent(table, row),
    })
  }
  return map
}

/**
 * Push every pending record: load the local row, encrypt it under a per-record
 * key, PUT the ciphertext, and stamp the queue row synced. A failure on any one
 * record leaves it pending for the next run (never throws, never loses data).
 * Returns the count uploaded.
 */
export async function pushPending(
  masterKeyHex: string,
  accountId: string,
  db: SqliteDatabase = getDb(),
  isCurrent: () => boolean = () => true
): Promise<Result<number>> {
  const pend = await pendingUploads(db)
  if (!pend.success) return pend

  let pushed = 0
  for (const item of pend.data) {
    if (!isCurrent()) return err('SESSION_WORK_STOPPED', 'Session work stopped')
    if (!isSyncTable(item.table_name)) {
      await markSynced(item.id, Date.now(), db) // unknown table — drop from queue
      continue
    }
    const res = await db.execute(`SELECT * FROM ${item.table_name} WHERE id = ?`, [item.record_id])
    const row = res.rows[0]
    if (!row) {
      await markSynced(item.id, Date.now(), db) // gone locally — nothing to upload
      continue
    }

    const syncId = createSyncId(masterKeyHex, accountId, item.table_name, item.record_id)
    const enc = await encryptRecord(
      JSON.stringify(row),
      syncId,
      masterKeyHex,
      accountId,
      item.table_name
    )
    if (!enc.success) continue // keep pending; retry next run

    const put = await authenticatedFetch(
      `/sync/${encodeURIComponent(accountId)}/v2/${item.table_name}/${syncId}`,
      {
        method: 'PUT',
        body: JSON.stringify({
          version: 2,
          ciphertext: enc.data,
          updated_at: TABLES[item.table_name].updatedAt(row),
          sync_id: syncId,
          table: item.table_name,
        }),
      }
    )
    if (!put.success || !put.data.ok) continue // keep pending

    if (!isCurrent()) return err('SESSION_WORK_STOPPED', 'Session work stopped')
    await markSynced(item.id, Date.now(), db)
    pushed++
  }
  return ok(pushed)
}

interface DeltaRecordV1 {
  version: 1
  table: SyncTable
  record_id: string
  ciphertext: string
  updated_at: number
}

interface DeltaRecordV2 {
  version: 2
  table: SyncTable
  sync_id: string
  ciphertext: string
  updated_at: number
}

type DeltaRecord = DeltaRecordV1 | DeltaRecordV2

interface DeltaPage {
  records: DeltaRecord[]
  next_cursor: string | null
}

function isCiphertext(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length >= MIN_CIPHERTEXT_HEX_LENGTH &&
    value.length <= MAX_CIPHERTEXT_HEX_LENGTH &&
    value.length % 2 === 0 &&
    /^[0-9a-f]+$/i.test(value)
  )
}

function isSafeTimestamp(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= Date.now() + MAX_FUTURE_SKEW_MS
  )
}

function parseDeltaRecord(value: unknown): DeltaRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  if (typeof record.table !== 'string' || !isSyncTable(record.table)) return null
  if (!isCiphertext(record.ciphertext) || !isSafeTimestamp(record.updated_at)) return null
  if (record.version === 2) {
    if (
      Object.keys(record).length !== 5 ||
      !Object.keys(record).every((key) => ['version', 'table', 'sync_id', 'ciphertext', 'updated_at'].includes(key)) ||
      typeof record.sync_id !== 'string' ||
      !SYNC_ID_PATTERN.test(record.sync_id)
    ) return null
    return record as unknown as DeltaRecordV2
  }
  if (record.version === 1) {
    if (
      Object.keys(record).length !== 5 ||
      !Object.keys(record).every((key) => ['version', 'table', 'record_id', 'ciphertext', 'updated_at'].includes(key)) ||
      typeof record.record_id !== 'string' ||
      !record.record_id ||
      /[\u0000-\u001f\u007f]/.test(record.record_id) ||
      new TextEncoder().encode(record.record_id).length > MAX_LEGACY_RECORD_ID_BYTES
    ) return null
    return record as unknown as DeltaRecordV1
  }
  return null
}

function parseDeltaPage(value: unknown): DeltaPage | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const page = value as Record<string, unknown>
  if (
    Object.keys(page).length !== 2 ||
    !Array.isArray(page.records) ||
    page.records.length > MAX_DELTA_RECORDS ||
    !(page.next_cursor === null || (typeof page.next_cursor === 'string' && /^[A-Za-z0-9_-]+$/.test(page.next_cursor)))
  ) return null
  return {
    records: page.records.map(parseDeltaRecord).filter((record): record is DeltaRecord => record !== null),
    next_cursor: page.next_cursor as string | null,
  }
}

function parseRow(value: string): Row | null {
  try {
    const row: unknown = JSON.parse(value)
    return row && typeof row === 'object' && !Array.isArray(row) ? row as Row : null
  } catch {
    return null
  }
}

interface PullState {
  since: number
  cursor: string | null
  windowMax: number
}

/** Read the resumable pull state; one-time seed from the legacy cursor key. */
async function readPullState(db: SqliteDatabase): Promise<PullState> {
  const ps = await getSetting(PULL_STATE_KEY, db)
  if (ps.success && ps.data) {
    try {
      const parsed = JSON.parse(ps.data) as { since?: unknown; cursor?: unknown; windowMax?: unknown }
      return {
        since: typeof parsed.since === 'number' && Number.isFinite(parsed.since) ? parsed.since : 0,
        cursor: typeof parsed.cursor === 'string' ? parsed.cursor : null,
        windowMax: typeof parsed.windowMax === 'number' && Number.isFinite(parsed.windowMax) ? parsed.windowMax : 0,
      }
    } catch {
      // fall through to the legacy key
    }
  }
  const legacy = await getSetting(LAST_PULL_KEY, db)
  const since = legacy.success && legacy.data ? Number(legacy.data) || 0 : 0
  return { since, cursor: null, windowMax: 0 }
}

/** Persist the pull state (and the legacy key for older builds / rollback). */
async function persistPullState(db: SqliteDatabase, state: PullState): Promise<void> {
  await setSetting(PULL_STATE_KEY, JSON.stringify(state), db)
  await setSetting(LAST_PULL_KEY, String(state.since), db)
}

interface QuarantineRow {
  table: string
  recordId: string
  updatedAt: number
  failures: number
}

/** Record a pull failure. Best-effort — quarantine must never fail the pull. */
async function quarantineRecord(
  table: SyncTable,
  recordId: string,
  updatedAt: number,
  db: SqliteDatabase
): Promise<void> {
  try {
    await db.execute(
      `INSERT INTO sync_skipped (table_name, record_id, updated_at, failures, last_attempt)
       VALUES (?, ?, ?, 1, ?)
       ON CONFLICT(table_name, record_id) DO UPDATE SET
         updated_at = excluded.updated_at,
         failures = failures + 1,
         last_attempt = excluded.last_attempt`,
      [table, recordId, updatedAt, Date.now()]
    )
  } catch {
    // never abort the pull over quarantine bookkeeping
  }
}

async function clearQuarantine(table: SyncTable, recordId: string, db: SqliteDatabase): Promise<void> {
  try {
    await db.execute('DELETE FROM sync_skipped WHERE table_name = ? AND record_id = ?', [table, recordId])
  } catch {
    // best-effort
  }
}

async function listQuarantine(db: SqliteDatabase): Promise<QuarantineRow[]> {
  const res = await db.execute('SELECT table_name, record_id, updated_at, failures FROM sync_skipped')
  return res.rows.map((r) => ({
    table: String(r.table_name),
    recordId: String(r.record_id),
    updatedAt: Number(r.updated_at) || 0,
    failures: Number(r.failures) || 0,
  }))
}

/** Drop quarantine rows that can no longer be re-fetched (below the cursor). */
async function purgeQuarantine(db: SqliteDatabase, since: number): Promise<void> {
  try {
    await db.execute('DELETE FROM sync_skipped WHERE updated_at <= ?', [since])
  } catch {
    // best-effort
  }
}

/**
 * Pull records changed since the last cursor, decrypt them, and apply the ones
 * that win last-write-wins against the local copy. The delta window is
 * resumable: a large window pauses at MAX_DELTA_PAGES and continues from the
 * server's R2 list cursor on the next sync pass — never a hard failure. The
 * data cursor advances only when the window is fully drained, so no record with
 * updated_at > since is ever skipped unseen. Records that fail to
 * decrypt/parse/apply are quarantined (excluded from the cursor) and retried on
 * later windows; after QUARANTINE_MAX_ATTEMPTS failures they are dropped
 * permanently on this device (count-only log).
 */
export async function pullDelta(
  masterKeyHex: string,
  accountId: string,
  db: SqliteDatabase = getDb(),
  isCurrent: () => boolean = () => true
): Promise<Result<number>> {
  const state = await readPullState(db)
  const since = state.since

  // Phase 1 — resumable scan. The server lists objects in opaque key order, so
  // the R2 list cursor pins the position mid-window; the `since` filter is
  // server-side and unchanged.
  const remote: DeltaRecord[] = []
  let ciphertextHexLength = 0
  let nextCursor: string | null = state.cursor
  const seenCursors = new Set<string>()
  let cursorReset = false
  let pageCount = 0
  let paused = false
  do {
    const suffix = nextCursor ? `&cursor=${encodeURIComponent(nextCursor)}` : ''
    const resp = await authenticatedFetch(
      `/sync/${encodeURIComponent(accountId)}/delta?since=${since}${suffix}`,
      { method: 'GET' }
    )
    if (!resp.success) return resp
    if (!resp.data.ok) {
      // A persisted list cursor can go stale across app restarts; fall back to
      // listing from the start (same since — idempotent) instead of wedging.
      if (nextCursor && !cursorReset) {
        nextCursor = null
        seenCursors.clear()
        cursorReset = true
        continue
      }
      return err('SYNC_PULL_FAILED', 'Delta request failed')
    }
    let unknownPage: unknown
    try {
      unknownPage = await resp.data.json()
    } catch {
      return err('SYNC_PULL_FAILED', 'Malformed delta response')
    }
    const page = parseDeltaPage(unknownPage)
    if (!page) return err('SYNC_PULL_FAILED', 'Malformed delta response')
    remote.push(...page.records)
    ciphertextHexLength += page.records.reduce((sum, record) => sum + record.ciphertext.length, 0)
    const hadMore = page.next_cursor != null
    if (hadMore && seenCursors.has(page.next_cursor as string)) {
      return err('SYNC_PULL_FAILED', 'Repeated delta cursor')
    }
    if (hadMore) seenCursors.add(page.next_cursor as string)
    nextCursor = page.next_cursor
    pageCount++
    // Pause (never fail) when the pass budget is exhausted — the resume cursor
    // is persisted so the next sync continues exactly where this one stopped.
    if (hadMore && (pageCount >= MAX_DELTA_PAGES || ciphertextHexLength > MAX_DELTA_CIPHERTEXT_HEX)) {
      paused = true
      break
    }
  } while (nextCursor)

  // Phase 2 — decode + apply per table. Failures are quarantined (retried on a
  // later window) rather than aborting the pull or silently dropping the row.
  let applied = 0
  let graphAffected = false
  const windowCandidates = new Map<string, number>()
  const failed = new Set<string>()
  for (const table of SYNCED_TABLES) {
    if (!isCurrent()) return err('SESSION_WORK_STOPPED', 'Session work stopped')
    // Decrypt this table's records first; skip any that don't decrypt (tamper /
    // wrong key) rather than failing the whole pull.
    const decoded: (Versioned & { row: Row; legacy: boolean })[] = []
    for (const r of remote) {
      if (r.table !== table) continue
      const dec = r.version === 2
        ? await decryptRecord(r.ciphertext, r.sync_id, masterKeyHex, accountId, table)
        : await decryptLegacyRecord(r.ciphertext, r.record_id, masterKeyHex)
      if (!dec.success) {
        // The record id is inside the ciphertext, so a decrypt failure has to be
        // keyed by the wire identity (sync_id for V2, record_id for legacy). If
        // it ever decrypts, apply clears the row by the real id and the purge
        // below drops any stale entry.
        await quarantineRecord(table, r.version === 2 ? r.sync_id : r.record_id, r.updated_at, db)
        continue
      }
      const row = parseRow(dec.data)
      if (!row || typeof row.id !== 'string' || !row.id) {
        await quarantineRecord(table, r.version === 2 ? r.sync_id : r.record_id, r.updated_at, db)
        continue
      }
      const recordId = String(row.id)
      if (r.version === 1 && recordId !== r.record_id) {
        await quarantineRecord(table, r.record_id, r.updated_at, db)
        continue
      }
      if (r.version === 2 && createSyncId(masterKeyHex, accountId, table, recordId) !== r.sync_id) {
        await quarantineRecord(table, r.sync_id, r.updated_at, db)
        continue
      }
      decoded.push({
        record_id: recordId,
        updated_at: r.updated_at,
        content: projectContent(table, row),
        row,
        legacy: r.version === 1,
      })
    }
    if (decoded.length === 0) continue

    for (const d of decoded) windowCandidates.set(`${table}:${d.record_id}`, d.updated_at)

    const local = await localState(table, decoded.map((d) => d.record_id), db)
    // Existing local rows discovered through legacy objects need one V2 upload.
    // This migrates identity/ciphertext without deleting legacy R2 objects.
    for (const d of decoded) {
      if (d.legacy && local.has(d.record_id) && (local.get(d.record_id)?.updated_at ?? 0) >= d.updated_at) {
        await enqueueUpsert(table, d.record_id, db)
      }
    }
    for (const d of recordsToApply(decoded, (id) => local.get(id) ?? null)) {
      if (!isCurrent()) return err('SESSION_WORK_STOPPED', 'Session work stopped')
      try {
        if (!isCurrent()) return err('SESSION_WORK_STOPPED', 'Session work stopped')
        const repaired = await applyRemote(table, d.row, db)
        if (repaired || d.legacy) await enqueueUpsert(table, d.record_id, db)
        // F-02C — a remote entity/reframe apply is an external raw write into the
        // maintenance source pool; bump generation so a later pass catches up.
        // Best-effort: failure never aborts the pull. Bump is outside db.transaction
        // (applyRemote runs outside any explicit tx) so it survives POST-COMMIT.
        if (table === 'entry_entities' || table === 'belief_reframes') {
          const bump = await incrementSourceGeneration('belief', db)
          if (!bump.success) console.warn('sync: source-gen bump failed', bump.error)
        }
        // A synced entry's wiki is handled by the origin device (wiki pages sync
        // on their own), and INSERT OR REPLACE just wiped the local-only
        // wiki_indexed_at to NULL. Stamp it = tagged_at so the wiki catch-up
        // never re-synthesizes a synced entry. (Left NULL when untagged — those
        // still flow through the tagged-catch-up like any un-indexed entry.)
        if (table === 'entries') {
          await db.execute(
            'UPDATE entries SET wiki_indexed_at = tagged_at WHERE id = ?',
            [d.record_id]
          )
        }
        await clearQuarantine(table, d.record_id, db)
      } catch {
        // A single malformed/constraint-violating row must not abort the whole
        // pull — that would also block every table applied after it (entries is
        // first) and leave the cursor un-advanced, wedging sync permanently on
        // the same row. Quarantine it for a bounded number of retries instead.
        // Count/type only: some synced record IDs contain user-derived labels.
        await quarantineRecord(table, d.record_id, d.updated_at, db)
        failed.add(`${table}:${d.record_id}`)
        console.warn(`sync_apply_skipped table=${table}`)
        continue
      }
      applied++
      // Graph rebuilds only ever read entries + entry_entities; skip the full
      // clear+re-derive for windows that touched only other tables.
      if (table === 'entries' || table === 'entry_entities') graphAffected = true
    }
    // Equal-timestamp tie where the LOCAL content won: the server still holds
    // the loser (it overwrites on tie), so re-push the winner to converge every
    // device on it. Identical content (own push) never reaches here — recordsToApply
    // skipped it because contents are equal, and this pass requires a difference.
    for (const d of decoded) {
      const localRow = local.get(d.record_id)
      if (!localRow || localRow.updated_at !== d.updated_at) { continue }
      if (localRow.content === null || d.content === null || localRow.content === d.content) { continue }
      if (localRow.content === null || d.content === null || localRow.content === d.content) continue
      const apply = shouldApplyRemote(localRow.updated_at, localRow.content, d.updated_at, d.content ?? null)
      if (!apply) await enqueueUpsert(table, d.record_id, db)
    }
  }

  if (!isCurrent()) return err('SESSION_WORK_STOPPED', 'Session work stopped')

  // Phase 3 — cursor advance. The cursor only moves when the window is fully
  // drained, and only over records that applied or lost LWW; quarantined rows
  // stay above the cursor so they are re-fetched until their budget runs out.
  let windowMax = 0
  for (const [key, ts] of windowCandidates) {
    if (!failed.has(key)) windowMax = Math.max(windowMax, ts)
  }
  const nextState: PullState = { since, cursor: nextCursor, windowMax: state.windowMax }
  if (paused) {
    nextState.windowMax = Math.max(state.windowMax, windowMax)
  } else {
    nextState.since = Math.max(since, state.windowMax, windowMax)
    nextState.cursor = null
    nextState.windowMax = 0
    // Rows that exhausted their retry budget are dropped permanently: count them
    // toward the cursor (never re-fetched) and clear them. Stale rows below the
    // cursor can never be re-fetched either — clear those too.
    for (const q of await listQuarantine(db)) {
      if (q.failures >= QUARANTINE_MAX_ATTEMPTS) {
        nextState.since = Math.max(nextState.since, q.updatedAt)
        await db.execute('DELETE FROM sync_skipped WHERE table_name = ? AND record_id = ?', [q.table, q.recordId])
      }
    }
    await purgeQuarantine(db, nextState.since)
    // The first fully-drained window after a login/pair is the restore boundary.
    useSyncStore.getState().endRestore()
  }
  await persistPullState(db, nextState)

  // Tell data hooks to refetch so a first-login pull shows up immediately
  // (and rebuild the derived graph only when the window touched graph tables).
  if (applied > 0) {
    if (graphAffected) await rebuildGraph()
    useSyncStore.getState().bumpRevision()
  }
  return ok(applied)
}

/**
 * One full sync pass: push local changes, then pull remote ones. Requires an
 * active session + the master key; both stay on-device. Best-effort and safe to
 * call opportunistically when online — never throws.
 */
export async function sync(): Promise<Result<{ pushed: number; pulled: number }>> {
  const lease = startSessionWork()
  if (!lease) return err('SESSION_WORK_STOPPED', 'Session work unavailable')
  try {
  // Bail if a logout wipe is in progress (I5): the DB handle is being deleted,
  // so there's nothing safe to sync.
  if (isWiping()) return err('DB_WIPING', 'Sync unavailable during wipe')

  const tokens = await getTokens()
  if (!tokens) return err('NOT_AUTHENTICATED', 'No active session')

  let masterKeyHex: string
  try {
    masterKeyHex = await CryptoModule.getKeyFromKeychain()
  } catch (e) {
    return err('NO_MASTER_KEY', 'Master key unavailable', e)
  }

  const store = useSyncStore.getState()
  store.setSyncing(true)
  try {
    const db = getDb()
    if (!lease.checkpoint()) return err('SESSION_WORK_STOPPED', 'Session work stopped')
    // One-time: enqueue any data written before sync existed, so the first sync
    // uploads the existing journal (not just new entries).
    await backfillSyncQueue(SYNCED_TABLES, db)
    const pushed = await pushPending(masterKeyHex, tokens.accountId, db, lease.checkpoint)
    if (!pushed.success) return pushed
    if (!lease.checkpoint()) return err('SESSION_WORK_STOPPED', 'Session work stopped')
    const pulled = await pullDelta(masterKeyHex, tokens.accountId, db, lease.checkpoint)
    if (!pulled.success) return pulled
    if (!lease.checkpoint()) return err('SESSION_WORK_STOPPED', 'Session work stopped')

    await setSetting(LAST_SYNCED_KEY, String(Date.now()), db)
    // Restore-UI handling lives inside pullDelta: endRestore fires only when a
    // delta window fully drains, so a large multi-pass restore keeps its
    // reassurance banner until the data actually lands.
    return ok({ pushed: pushed.data, pulled: pulled.data })
  } finally {
    store.setSyncing(false)
  }
  } finally {
    lease.done()
  }
}
