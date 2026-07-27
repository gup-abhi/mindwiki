import { listEligibleCandidates, pruneNotificationHistory } from '@/services/notifications/repository'
import { type SqliteDatabase } from '@/services/storage/db'

function dbWith(execute: jest.Mock): SqliteDatabase {
  const db: SqliteDatabase = {
    execute,
    transaction: jest.fn(async (fn) => fn(db)),
    close: jest.fn(),
  }
  return db
}

describe('notification repository retention/reconciliation', () => {
  it('prunes events and terminal candidates older than 90 days', async () => {
    const execute = jest.fn().mockResolvedValue({ rows: [], rowsAffected: 0 })
    const now = Date.UTC(2026, 6, 15)

    const result = await pruneNotificationHistory(now, dbWith(execute))

    expect(result.success).toBe(true)
    const cutoff = now - 90 * 86_400_000
    expect(execute.mock.calls).toEqual([
      ['DELETE FROM notification_events WHERE occurred_at < ?', [cutoff]],
      ["DELETE FROM notification_candidates WHERE status IN ('opened','cancelled','expired') AND updated_at < ?", [cutoff]],
    ])
  })

  it('lists eligible and scheduled candidates so native divergence can converge', async () => {
    const execute = jest.fn().mockResolvedValue({ rows: [], rowsAffected: 0 })

    await listEligibleCandidates(Date.now(), dbWith(execute))

    expect(execute).toHaveBeenCalledWith(
      "SELECT * FROM notification_candidates WHERE status IN ('eligible','scheduled') ORDER BY eligible_at ASC"
    )
  })
})