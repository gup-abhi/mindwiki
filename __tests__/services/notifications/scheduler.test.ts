import * as Notifications from 'expo-notifications'

import { type SqliteDatabase } from '@/services/storage/db'
import {
  cancelChallengeReminders,
  ensurePermission,
  onEntrySaved,
  recordActivity,
  scheduleChallengeReminders,
  scheduleDailyReminders,
  scheduleWeeklyDigest,
} from '@/services/notifications/scheduler'

// jest-expo's expo-notifications mock exposes only { DAILY, WEEKLY } on the
// trigger-type enum; add DATE (real value 'date') so the one-shot challenge
// reminders schedule with the right trigger type under test.
;(Notifications.SchedulableTriggerInputTypes as { DATE?: string }).DATE = 'date'

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

describe('scheduleDailyReminders', () => {
  it('schedules evening one-shot reminders at the evening hour, skipping the journaled day', async () => {
    const { db } = createFakeDb()
    // 3+ activities at 19:00 so reminderHour picks 19 (past the minSamples floor).
    await recordActivity(at(19), db)
    await recordActivity(at(19), db)
    await recordActivity(at(19), db)

    // Journaled this morning (9am) → today's evening reminder is skipped.
    const res = await scheduleDailyReminders(at(9), true, db)

    expect(res).toEqual({ success: true, data: 19 })
    // legacy single reminder is cleared
    expect(mockCancel).toHaveBeenCalledWith('mindwiki-daily-reminder')

    const calls = mockSchedule.mock.calls.map((c) => c[0])
    expect(calls.length).toBeGreaterThanOrEqual(6) // today skipped, ~6 ahead
    for (const arg of calls) {
      expect(arg.trigger.type).toBe('date')
      const d = new Date(arg.trigger.date)
      expect(d.getHours()).toBe(19) // evening hour
      expect(d.getTime()).toBeGreaterThan(at(9)) // all in the future
      expect(typeof arg.content.body).toBe('string')
      expect(arg.content.body.length).toBeGreaterThan(0)
    }
    // first reminder is tomorrow (today was skipped because already journaled)
    const first = new Date(calls[0].trigger.date)
    expect(first.getDate()).toBe(new Date(at(9)).getDate() + 1)
  })

  it('falls back to the default hour with insufficient evening data', async () => {
    const { db } = createFakeDb()
    // Not journaled today and it's only 10am, so today's 8pm reminder is armed.
    const res = await scheduleDailyReminders(at(10), false, db)
    expect(res).toEqual({ success: true, data: 20 }) // DEFAULT_SEND_HOUR
    const first = new Date(mockSchedule.mock.calls[0][0].trigger.date)
    expect(first.getHours()).toBe(20)
    expect(first.getDate()).toBe(new Date(at(10)).getDate()) // today
  })
})

describe('scheduleWeeklyDigest', () => {
  it('schedules a Sunday 9am weekly trigger, replacing the prior', async () => {
    const res = await scheduleWeeklyDigest()
    expect(res).toEqual({ success: true, data: undefined })
    expect(mockCancel).toHaveBeenCalledWith('mindwiki-weekly-digest')
    const arg = mockSchedule.mock.calls[0][0]
    expect(arg.identifier).toBe('mindwiki-weekly-digest')
    expect(arg.trigger).toMatchObject({ type: 'weekly', weekday: 1, hour: 9, minute: 0 })
  })
})

describe('scheduleChallengeReminders', () => {
  const challenge = { id: 'ch1', status: 'active' as const }

  it('arms morning (9am) one-shot nudges, skipping today when already done', async () => {
    // 8am, already checked in today → today skipped, the rest of the window armed.
    const res = await scheduleChallengeReminders(challenge, at(8), true)
    expect(res.success).toBe(true)
    if (!res.success) return
    expect(res.data).toBe(13) // 14-day buffer minus today

    const calls = mockSchedule.mock.calls.map((c) => c[0])
    expect(calls).toHaveLength(13)
    for (const arg of calls) {
      expect(arg.identifier.startsWith('mindwiki-challenge-ch1-')).toBe(true)
      expect(arg.trigger.type).toBe('date')
      expect(new Date(arg.trigger.date).getHours()).toBe(9)
      expect(new Date(arg.trigger.date).getTime()).toBeGreaterThan(at(8))
      expect(arg.content.body.length).toBeGreaterThan(0)
    }
    // first nudge is tomorrow (today was skipped)
    expect(new Date(calls[0].trigger.date).getDate()).toBe(new Date(at(8)).getDate() + 1)
  })

  it('arms today when not yet done and 9am has not passed', async () => {
    const res = await scheduleChallengeReminders(challenge, at(8), false)
    expect(res.success && res.data).toBe(14) // full buffer, today included
    const first = mockSchedule.mock.calls[0][0]
    expect(new Date(first.trigger.date).getDate()).toBe(new Date(at(8)).getDate()) // today
    expect(new Date(first.trigger.date).getHours()).toBe(9)
  })

  it('cancels and schedules nothing for a completed challenge', async () => {
    const res = await scheduleChallengeReminders({ id: 'ch1', status: 'completed' }, at(8), false)
    expect(res.success && res.data).toBe(0)
    expect(mockSchedule).not.toHaveBeenCalled()
    expect(mockCancel).toHaveBeenCalledWith('mindwiki-challenge-ch1-0')
  })

  it('cancelChallengeReminders clears the namespaced ids', async () => {
    const res = await cancelChallengeReminders('ch1')
    expect(res.success).toBe(true)
    expect(mockCancel).toHaveBeenCalledWith('mindwiki-challenge-ch1-0')
    expect(mockCancel).toHaveBeenCalledWith('mindwiki-challenge-ch1-13')
  })
})

describe('onEntrySaved', () => {
  it('records activity without prompting or creating unmanaged native requests', async () => {
    const { db, store } = createFakeDb()
    const res = await onEntrySaved(at(21), db)

    expect(res).toEqual({ success: true, data: undefined })
    expect(mockReqPerms).not.toHaveBeenCalled()
    expect(JSON.parse(store.get('notif_hour_histogram')!)[21]).toBe(1)
    expect(mockSchedule).not.toHaveBeenCalled()
  })

  it('does not ask for permission again on subsequent entries', async () => {
    const { db } = createFakeDb()
    await onEntrySaved(at(21), db)
    mockReqPerms.mockClear()
    await onEntrySaved(at(21), db)
    expect(mockReqPerms).not.toHaveBeenCalled()
  })
})
