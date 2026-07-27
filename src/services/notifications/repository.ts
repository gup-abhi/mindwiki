import { randomUUID } from 'expo-crypto'

import { type Result, ok, err } from '@/types/result'
import { type SqliteDatabase, getDb } from '@/services/storage/db'
import { type NotificationCandidate, type NotificationEvent, type NotificationEventType, type NotificationKind, type NotificationCandidateStatus } from './types'

export async function upsertCandidate(candidate: NotificationCandidate, db: SqliteDatabase = getDb()): Promise<Result<void>> {
  try {
    await db.execute(
      `INSERT INTO notification_candidates
       (id, kind, dedupe_key, target_route, eligible_at, expires_at, scheduled_for, status, reason_code, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(dedupe_key) DO UPDATE SET
         target_route = excluded.target_route, eligible_at = excluded.eligible_at,
         expires_at = excluded.expires_at, scheduled_for = excluded.scheduled_for,
         status = CASE
           WHEN notification_candidates.status IN ('opened','cancelled','expired') THEN notification_candidates.status
           WHEN notification_candidates.status = 'scheduled' AND excluded.status = 'eligible' THEN 'scheduled'
           ELSE excluded.status
         END,
         reason_code = excluded.reason_code,
         updated_at = excluded.updated_at`,
      [candidate.id, candidate.kind, candidate.dedupeKey, candidate.targetRoute, candidate.eligibleAt,
        candidate.expiresAt, candidate.scheduledFor ?? null, candidate.status ?? 'eligible', candidate.reasonCode ?? null,
        Date.now(), Date.now()]
    )
    return ok(undefined)
  } catch (e) { return err('NOTIF_CANDIDATE_WRITE_FAILED', 'Failed to store notification candidate', e) }
}

function priorityFor(kind: NotificationKind): number {
  if (kind === 'insight') return 90
  if (kind === 'momentum') return 50
  if (kind === 'pattern') return 40
  if (kind === 'digest') return 80
  if (kind === 'challenge') return 60
  if (kind === 'journal') return 30
  return 20
}

function rowToCandidate(row: Record<string, unknown>): NotificationCandidate {
  const kind = String(row.kind) as NotificationKind
  return {
    id: String(row.id), kind, dedupeKey: String(row.dedupe_key), targetRoute: String(row.target_route),
    eligibleAt: Number(row.eligible_at), expiresAt: Number(row.expires_at),
    scheduledFor: row.scheduled_for == null ? undefined : Number(row.scheduled_for),
    status: String(row.status) as NotificationCandidateStatus,
    reasonCode: row.reason_code == null ? undefined : String(row.reason_code),
    priority: priorityFor(kind),
  }
}

export async function createCandidate(input: Omit<NotificationCandidate, 'id'>, db: SqliteDatabase = getDb()): Promise<Result<NotificationCandidate>> {
  try {
    const existing = await db.execute('SELECT * FROM notification_candidates WHERE dedupe_key = ?', [input.dedupeKey])
    if (existing.rows[0]) {
      const candidate = rowToCandidate(existing.rows[0])
      const next = { ...candidate, ...input, id: candidate.id, status: ['opened', 'cancelled', 'expired'].includes(candidate.status ?? '') ? candidate.status : (input.status ?? candidate.status) }
      const saved = await upsertCandidate(next, db)
      return saved.success ? ok(next) : saved
    }
    const candidate = { ...input, id: randomUUID() }
    const saved = await upsertCandidate(candidate, db)
    return saved.success ? ok(candidate) : saved
  } catch (e) { return err('NOTIF_CANDIDATE_WRITE_FAILED', 'Failed to create notification candidate', e) }
}

export async function listEligibleCandidates(now: number, db: SqliteDatabase = getDb()): Promise<Result<NotificationCandidate[]>> {
  try {
    const res = await db.execute(
      "SELECT * FROM notification_candidates WHERE status = 'eligible' AND expires_at > ? ORDER BY eligible_at ASC",
      [now]
    )
    return ok(res.rows.map(rowToCandidate))
  } catch (e) { return err('NOTIF_CANDIDATE_LIST_FAILED', 'Failed to list notification candidates', e) }
}

export async function getCandidate(id: string, db: SqliteDatabase = getDb()): Promise<Result<NotificationCandidate | null>> {
  try {
    const res = await db.execute('SELECT * FROM notification_candidates WHERE id = ?', [id])
    const row = res.rows[0]
    return ok(row ? rowToCandidate(row) : null)
  } catch (e) { return err('NOTIF_CANDIDATE_READ_FAILED', 'Failed to read notification candidate', e) }
}

export async function markCandidateStatus(
  id: string,
  status: NotificationCandidateStatus,
  db: SqliteDatabase = getDb()
): Promise<Result<boolean>> {
  try {
    const res = await db.execute(
      'UPDATE notification_candidates SET status = ?, updated_at = ? WHERE id = ? AND status NOT IN (\'opened\',\'cancelled\',\'expired\')',
      [status, Date.now(), id]
    )
    return ok((res.rowsAffected ?? 0) > 0)
  } catch (e) { return err('NOTIF_CANDIDATE_STATUS_FAILED', 'Failed to update notification candidate status', e) }
}

export async function markCandidateOpened(id: string, db: SqliteDatabase = getDb()): Promise<Result<boolean>> {
  try {
    const res = await db.execute(
      "UPDATE notification_candidates SET status = 'opened', updated_at = ? WHERE id = ? AND status NOT IN ('opened','cancelled','expired')",
      [Date.now(), id]
    )
    return ok((res.rowsAffected ?? 0) > 0)
  } catch (e) { return err('NOTIF_CANDIDATE_OPEN_FAILED', 'Failed to mark notification opened', e) }
}

export async function listRecentNotificationEvents(
  since: number,
  db: SqliteDatabase = getDb()
): Promise<Result<NotificationEvent[]>> {
  try {
    const res = await db.execute(
      'SELECT id, candidate_id, kind, event_type, reason_code, occurred_at FROM notification_events WHERE occurred_at >= ? ORDER BY occurred_at DESC',
      [since]
    )
    return ok(res.rows.map((row) => ({
      id: String(row.id),
      candidateId: row.candidate_id == null ? undefined : String(row.candidate_id),
      kind: row.kind == null ? undefined : String(row.kind) as NotificationKind,
      type: String(row.event_type) as NotificationEventType,
      reasonCode: row.reason_code == null ? undefined : String(row.reason_code),
      occurredAt: Number(row.occurred_at),
    })))
  } catch (e) { return err('NOTIF_EVENT_READ_FAILED', 'Failed to read notification events', e) }
}

export async function recordNotificationEvent(
  type: NotificationEventType,
  input: { candidateId?: string; kind?: NotificationKind; reasonCode?: string; occurredAt?: number } = {},
  db: SqliteDatabase = getDb()
): Promise<Result<void>> {
  try {
    await db.execute(
      'INSERT INTO notification_events (id, candidate_id, kind, event_type, reason_code, occurred_at) VALUES (?, ?, ?, ?, ?, ?)',
      [randomUUID(), input.candidateId ?? null, input.kind ?? null, type, input.reasonCode ?? null, input.occurredAt ?? Date.now()]
    )
    return ok(undefined)
  } catch (e) { return err('NOTIF_EVENT_WRITE_FAILED', 'Failed to record notification event', e) }
}

/** Keep notification history bounded. Events older than the retention horizon
 * are not useful for budget/cooldown decisions (window is seven days), and old
 * terminal candidates accumulate as the user journals. */
const RETENTION_MS = 90 * 86_400_000

export async function pruneNotificationHistory(now: number, db: SqliteDatabase = getDb()): Promise<Result<void>> {
  try {
    const cutoff = now - RETENTION_MS
    await db.execute('DELETE FROM notification_events WHERE occurred_at < ?', [cutoff])
    await db.execute("DELETE FROM notification_candidates WHERE status IN ('opened','cancelled','expired') AND updated_at < ?", [cutoff])
    return ok(undefined)
  } catch (e) { return err('NOTIF_PRUNE_FAILED', 'Failed to prune notification history', e) }
}