import * as Notifications from 'expo-notifications'

import { type SqliteDatabase } from '@/services/storage/db'
import {
  ensurePermission,
  onEntrySaved,
  recordActivity,
  rescheduleDailyReminder,
} from '@/services/notifications/scheduler'

const mockSchedule = Notifications.scheduleNotificationAsync as jest.Mock
const mockCancel = Notifications.cancelScheduledNotificationAsync as jest.Mock
const mockGetPerms = Notifications.getPermissionsAsync as jest.Mock
const mockReqPerms = Notifications.requestPermissionsAsync as jest.Mock

// A fake settings-backed db with a single key/value store.
function createFakeDb(): { db: SqliteDatabase; store: Map<string, string> } {
  const store = new Map<string, string>()
  const db: SqliteDatabase = {
    async execute(sql, params = []) {
      if (/^SELECT value FROM settings/.test(sql)) {
        const v = store.get(String(params[0]))
        return { rows: v === undefined ? [] : [{ value: v }], rowsAffected: 0 }
      }
      if (/^INSERT INTO settings/.test(sql)) {
        store.set(String(params[0]), String(params[1]))
        return { rows: [], rowsAffected: 1 }
      }
      throw new Error(`unhandled SQL: ${sql}`)
    },
    async transaction(fn) {
      await fn(db)
    },
    async close() {},
  }
  return { db, store }
}

const at = (h: number): number => new Date(2026, 5, 1, h, 0).getTime()

beforeEach(() => {
  jest.clearAllMocks()
})

describe('ensurePermission', () => {
  it('returns true without prompting when already granted', async () => {
    mockGetPerms.mockResolvedValueOnce({ granted: true, canAskAgain: true })
    expect(await ensurePermission()).toEqual({ success: true, data: true })
    expect(mockReqPerms).not.toHaveBeenCalled()
  })

  it('prompts when not yet granted and returns the result', async () => {
    mockGetPerms.mockResolvedValueOnce({ granted: false, canAskAgain: true })
    mockReqPerms.mockResolvedValueOnce({ granted: true })
    expect(await ensurePermission()).toEqual({ success: true, data: true })
    expect(mockReqPerms).toHaveBeenCalledTimes(1)
  })

  it('does not prompt again when blocked', async () => {
    mockGetPerms.mockResolvedValueOnce({ granted: false, canAskAgain: false })
    expect(await ensurePermission()).toEqual({ success: true, data: false })
    expect(mockReqPerms).not.toHaveBeenCalled()
  })
})

describe('recordActivity', () => {
  it('persists a 24-slot histogram with the activity counted', async () => {
    const { db, store } = createFakeDb()
    await recordActivity(at(21), db)
    const saved = JSON.parse(store.get('notif_hour_histogram')!)
    expect(saved).toHaveLength(24)
    expect(saved[21]).toBe(1)
  })

  it('accumulates across calls', async () => {
    const { db, store } = createFakeDb()
    await recordActivity(at(21), db)
    await recordActivity(at(21), db)
    expect(JSON.parse(store.get('notif_hour_histogram')!)[21]).toBe(2)
  })
})

describe('rescheduleDailyReminder', () => {
  it('cancels the prior reminder and schedules a daily one at the optimal hour', async () => {
    const { db } = createFakeDb()
    // 3+ activities at 21:00 so optimalHour picks 21 (past the minSamples floor).
    await recordActivity(at(21), db)
    await recordActivity(at(21), db)
    await recordActivity(at(21), db)

    const res = await rescheduleDailyReminder(at(21), db)

    expect(res).toEqual({ success: true, data: 21 })
    expect(mockCancel).toHaveBeenCalledWith('mindwiki-daily-reminder')
    expect(mockSchedule).toHaveBeenCalledTimes(1)
    const arg = mockSchedule.mock.calls[0][0]
    expect(arg.identifier).toBe('mindwiki-daily-reminder')
    expect(arg.trigger).toMatchObject({ type: 'daily', hour: 21, minute: 0 })
    expect(typeof arg.content.body).toBe('string')
    expect(arg.content.body.length).toBeGreaterThan(0)
  })

  it('falls back to the default hour with insufficient data', async () => {
    const { db } = createFakeDb()
    const res = await rescheduleDailyReminder(at(10), db)
    expect(res).toEqual({ success: true, data: 20 }) // DEFAULT_SEND_HOUR
  })
})

describe('onEntrySaved', () => {
  it('asks for permission on the first entry, records activity, and schedules', async () => {
    const { db, store } = createFakeDb()
    const res = await onEntrySaved(at(21), db)

    expect(res).toEqual({ success: true, data: undefined })
    expect(mockReqPerms).toHaveBeenCalledTimes(1)
    expect(store.get('notif_permission_asked')).toBe('1')
    expect(JSON.parse(store.get('notif_hour_histogram')!)[21]).toBe(1)
    expect(mockSchedule).toHaveBeenCalledTimes(1)
  })

  it('does not ask for permission again on subsequent entries', async () => {
    const { db } = createFakeDb()
    await onEntrySaved(at(21), db)
    mockReqPerms.mockClear()
    await onEntrySaved(at(21), db)
    expect(mockReqPerms).not.toHaveBeenCalled()
  })
})
