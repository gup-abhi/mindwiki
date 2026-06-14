import { type Challenge } from '@/services/storage/challenges'
import { type SqliteDatabase } from '@/services/storage/db'
import { AFFIRMATION_BANK } from '@/services/challenges/affirmations'
import {
  effectiveStreak,
  evaluateCheckin,
  isDoneToday,
  recordCheckin,
  toLocalDate,
} from '@/services/challenges/checkin'
import { generateAffirmation } from '@/services/llm/deep-model'
import { ok, err } from '@/types/result'

jest.mock('@/services/llm/deep-model', () => ({ generateAffirmation: jest.fn() }))
const mockGenerate = generateAffirmation as jest.Mock

beforeEach(() => {
  // Default: model fails, so completion falls back to the bank.
  mockGenerate.mockResolvedValue(err('AFFIRMATION_INFERENCE_FAILED', 'down'))
})

// A local-noon timestamp for a given calendar date (avoids DST/midnight edges).
const day = (y: number, m: number, d: number): number => new Date(y, m - 1, d, 12, 0).getTime()

function challenge(overrides: Partial<Challenge> = {}): Challenge {
  return {
    id: 'c1',
    title: 'Work out',
    details: '',
    target_days: 30,
    current_streak: 0,
    last_checkin_date: '',
    status: 'active',
    affirmation: '',
    created_at: 0,
    updated_at: 0,
    completed_at: null,
    ...overrides,
  }
}

describe('toLocalDate', () => {
  it('formats a timestamp as local YYYY-MM-DD', () => {
    expect(toLocalDate(day(2026, 6, 13))).toBe('2026-06-13')
    expect(toLocalDate(day(2026, 1, 5))).toBe('2026-01-05')
  })
})

describe('evaluateCheckin', () => {
  it('first ever check-in starts the streak at day 1', () => {
    const d = evaluateCheckin(challenge(), day(2026, 6, 13))
    expect(d).toMatchObject({ outcome: 'first', streak: 1, justCompleted: false })
  })

  it('a check-in the day after the last one increments the streak', () => {
    const c = challenge({ current_streak: 4, last_checkin_date: '2026-06-12' })
    const d = evaluateCheckin(c, day(2026, 6, 13))
    expect(d).toMatchObject({ outcome: 'continued', streak: 5 })
  })

  it('a second check-in on the same day is a no-op', () => {
    const c = challenge({ current_streak: 5, last_checkin_date: '2026-06-13' })
    const d = evaluateCheckin(c, day(2026, 6, 13))
    expect(d).toMatchObject({ outcome: 'already_done', streak: 5 })
  })

  it('a missed day hard-resets the streak to 1', () => {
    const c = challenge({ current_streak: 18, last_checkin_date: '2026-06-10' })
    const d = evaluateCheckin(c, day(2026, 6, 13)) // 3-day gap
    expect(d).toMatchObject({ outcome: 'reset', streak: 1 })
  })

  it('flags completion when the streak reaches target_days', () => {
    const c = challenge({ target_days: 5, current_streak: 4, last_checkin_date: '2026-06-12' })
    const d = evaluateCheckin(c, day(2026, 6, 13))
    expect(d).toMatchObject({ outcome: 'continued', streak: 5, justCompleted: true })
  })

  it('treats a completed challenge as already done', () => {
    const c = challenge({ status: 'completed', current_streak: 30, last_checkin_date: '2026-06-12' })
    expect(evaluateCheckin(c, day(2026, 6, 13)).outcome).toBe('already_done')
  })
})

describe('effectiveStreak', () => {
  it('keeps the streak alive when the last check-in was today or yesterday', () => {
    expect(effectiveStreak(challenge({ current_streak: 7, last_checkin_date: '2026-06-13' }), day(2026, 6, 13))).toBe(7)
    expect(effectiveStreak(challenge({ current_streak: 7, last_checkin_date: '2026-06-12' }), day(2026, 6, 13))).toBe(7)
  })

  it('reads as 0 once a day has been missed', () => {
    expect(effectiveStreak(challenge({ current_streak: 7, last_checkin_date: '2026-06-11' }), day(2026, 6, 13))).toBe(0)
  })

  it('is 0 before any check-in', () => {
    expect(effectiveStreak(challenge(), day(2026, 6, 13))).toBe(0)
  })

  it('preserves the final streak of a completed challenge', () => {
    const c = challenge({ status: 'completed', current_streak: 30, last_checkin_date: '2026-05-01' })
    expect(effectiveStreak(c, day(2026, 6, 13))).toBe(30)
  })
})

describe('isDoneToday', () => {
  it('is true only when the last check-in is today', () => {
    expect(isDoneToday(challenge({ last_checkin_date: '2026-06-13' }), day(2026, 6, 13))).toBe(true)
    expect(isDoneToday(challenge({ last_checkin_date: '2026-06-12' }), day(2026, 6, 13))).toBe(false)
    expect(isDoneToday(challenge(), day(2026, 6, 13))).toBe(false)
  })
})

// In-memory fake supporting the getChallenge + updateChallenge queries recordCheckin issues.
function createFakeDb(seed: Challenge) {
  const rows = new Map<string, Record<string, unknown>>([[seed.id, { ...seed }]])
  const db: SqliteDatabase = {
    async execute(sql, params = []) {
      if (/^SELECT \* FROM challenges WHERE id/.test(sql)) {
        const row = rows.get(String(params[0]))
        return { rows: row ? [row] : [], rowsAffected: 0 }
      }
      if (/^UPDATE challenges SET /.test(sql)) {
        const setPart = sql.slice(sql.indexOf('SET ') + 4, sql.indexOf(' WHERE'))
        const cols = setPart.split(',').map((s) => s.trim().split(' ')[0])
        const id = params[params.length - 1]
        const row = rows.get(String(id))
        if (row) cols.forEach((c, i) => { row[c] = params[i] })
        return { rows: [], rowsAffected: row ? 1 : 0 }
      }
      throw new Error(`unhandled SQL: ${sql}`)
    },
    async transaction(fn) {
      await fn(db)
    },
    close() {},
  }
  return { db, rows }
}

describe('recordCheckin', () => {
  it('persists an incremented streak and stamps the date', async () => {
    const { db, rows } = createFakeDb(
      challenge({ current_streak: 2, last_checkin_date: '2026-06-12' })
    )
    const res = await recordCheckin('c1', day(2026, 6, 13), db)
    expect(res.success).toBe(true)
    if (!res.success) return
    expect(res.data.decision.outcome).toBe('continued')
    expect(rows.get('c1')?.current_streak).toBe(3)
    expect(rows.get('c1')?.last_checkin_date).toBe('2026-06-13')
    expect(rows.get('c1')?.status).toBe('active')
  })

  it('does not write when today is already checked in', async () => {
    const { db, rows } = createFakeDb(
      challenge({ current_streak: 5, last_checkin_date: '2026-06-13', updated_at: 111 })
    )
    const res = await recordCheckin('c1', day(2026, 6, 13), db)
    expect(res.success && res.data.decision.outcome).toBe('already_done')
    expect(rows.get('c1')?.updated_at).toBe(111) // untouched
  })

  it('completes the challenge and unlocks an AI affirmation from the challenge', async () => {
    mockGenerate.mockResolvedValue(ok('I am someone who shows up.'))
    const { db, rows } = createFakeDb(
      challenge({ title: 'Work out', target_days: 3, current_streak: 2, last_checkin_date: '2026-06-12' })
    )
    const res = await recordCheckin('c1', day(2026, 6, 13), db)
    expect(res.success).toBe(true)
    if (!res.success) return
    expect(res.data.decision.justCompleted).toBe(true)
    expect(rows.get('c1')?.status).toBe('completed')
    expect(rows.get('c1')?.completed_at).toBe(day(2026, 6, 13))
    expect(mockGenerate).toHaveBeenCalledWith({ title: 'Work out', details: '', targetDays: 3 })
    expect(rows.get('c1')?.affirmation).toBe('I am someone who shows up.')
  })

  it('falls back to a bank affirmation when generation fails', async () => {
    // mockGenerate defaults to an error in beforeEach.
    const { db, rows } = createFakeDb(
      challenge({ target_days: 3, current_streak: 2, last_checkin_date: '2026-06-12' })
    )
    const res = await recordCheckin('c1', day(2026, 6, 13), db)
    expect(res.success).toBe(true)
    expect(AFFIRMATION_BANK).toContain(rows.get('c1')?.affirmation)
  })

  it('returns CHALLENGE_NOT_FOUND for a missing id', async () => {
    const { db } = createFakeDb(challenge())
    const res = await recordCheckin('ghost', day(2026, 6, 13), db)
    expect(res.success).toBe(false)
    if (!res.success) expect(res.error.code).toBe('CHALLENGE_NOT_FOUND')
  })
})
