import {
  CHECKIN_COOLDOWN_MS,
  CHECKIN_INTERVAL_MS,
  DORMANT_AFTER_MS,
  dueForCheckin,
  fallbackCheckinQuestion,
  isStale,
  prepareCheckin,
  selectDuePursuit,
} from '@/services/pursuits/checkin'
import { listPursuits, updatePursuit, type Pursuit } from '@/services/storage/pursuits'
import { generateCheckinQuestion } from '@/services/llm/deep-model'
import { ok, err } from '@/types/result'

jest.mock('@/services/storage/pursuits', () => ({
  listPursuits: jest.fn(),
  updatePursuit: jest.fn(),
}))
jest.mock('@/services/llm/deep-model', () => ({ generateCheckinQuestion: jest.fn() }))

const mockList = listPursuits as jest.Mock
const mockUpdate = updatePursuit as jest.Mock
const mockGen = generateCheckinQuestion as jest.Mock

const NOW = 10 * CHECKIN_INTERVAL_MS // comfortably past any interval math
// Durations expressed relative to the exported cadence so these stay correct
// regardless of the configured interval/cooldown.
const UNDER_INTERVAL = CHECKIN_INTERVAL_MS / 2
const UNDER_COOLDOWN = CHECKIN_COOLDOWN_MS / 2
// Quiet long enough to be due, but not long enough to be retired as dormant.
const DUE_NOT_STALE = NOW - CHECKIN_INTERVAL_MS

const pursuit = (over: Partial<Pursuit>): Pursuit => ({
  id: 'p1',
  title: 'Marathon training',
  details: 'Aiming for a fall race.',
  status: 'active',
  checkin_question: '',
  wiki_page_id: null,
  created_at: 0,
  updated_at: 0,
  last_mentioned_at: NOW, // not due by default
  last_checkin_at: null,
  ...over,
})

describe('dueForCheckin', () => {
  it('is due when an active pursuit has been quiet past the interval', () => {
    expect(dueForCheckin(pursuit({ last_mentioned_at: NOW - CHECKIN_INTERVAL_MS }), NOW)).toBe(true)
    expect(dueForCheckin(pursuit({ last_mentioned_at: NOW - UNDER_INTERVAL }), NOW)).toBe(false)
  })

  it('is never due for a non-active pursuit', () => {
    expect(
      dueForCheckin(pursuit({ status: 'done', last_mentioned_at: 0 }), NOW)
    ).toBe(false)
  })

  it('counts a recent check-in as activity (no immediate re-nag)', () => {
    const p = pursuit({ last_mentioned_at: 0, last_checkin_at: NOW - UNDER_INTERVAL })
    expect(dueForCheckin(p, NOW)).toBe(false)
  })
})

describe('isStale', () => {
  it('is stale once an active pursuit has been silent past the dormant window', () => {
    expect(isStale(pursuit({ last_mentioned_at: NOW - DORMANT_AFTER_MS }), NOW)).toBe(true)
    expect(isStale(pursuit({ last_mentioned_at: DUE_NOT_STALE }), NOW)).toBe(false)
  })

  it('is never stale for a non-active pursuit', () => {
    expect(isStale(pursuit({ status: 'done', last_mentioned_at: 0 }), NOW)).toBe(false)
  })
})

describe('selectDuePursuit', () => {
  it('returns null when nothing is due', () => {
    expect(selectDuePursuit([pursuit({ last_mentioned_at: NOW })], NOW)).toBeNull()
  })

  it('holds off entirely if any pursuit was checked in within the last day', () => {
    const due = pursuit({ id: 'due', last_mentioned_at: 0 })
    const justChecked = pursuit({ id: 'recent', last_checkin_at: NOW - UNDER_COOLDOWN })
    expect(selectDuePursuit([due, justChecked], NOW)).toBeNull()
  })

  it('picks the most-overdue active pursuit', () => {
    const older = pursuit({ id: 'older', last_mentioned_at: NOW - 3 * CHECKIN_INTERVAL_MS })
    const newer = pursuit({ id: 'newer', last_mentioned_at: NOW - CHECKIN_INTERVAL_MS })
    expect(selectDuePursuit([newer, older], NOW)?.id).toBe('older')
  })
})

describe('prepareCheckin', () => {
  beforeEach(() => {
    mockList.mockReset()
    mockUpdate.mockReset()
    mockGen.mockReset()
    mockUpdate.mockImplementation(async (id, patch) => ok(pursuit({ id, ...patch })))
  })

  it('returns null when nothing is due', async () => {
    mockList.mockResolvedValue(ok([pursuit({ last_mentioned_at: NOW })]))
    expect(await prepareCheckin(NOW)).toBeNull()
    expect(mockGen).not.toHaveBeenCalled()
  })

  it('returns a prepared pursuit as-is without regenerating', async () => {
    const ready = pursuit({ last_mentioned_at: DUE_NOT_STALE, checkin_question: 'Already asked?' })
    mockList.mockResolvedValue(ok([ready]))
    const res = await prepareCheckin(NOW)
    expect(res?.checkin_question).toBe('Already asked?')
    expect(mockGen).not.toHaveBeenCalled()
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('generates + caches the question for a due pursuit', async () => {
    mockList.mockResolvedValue(ok([pursuit({ id: 'p1', last_mentioned_at: DUE_NOT_STALE })]))
    mockGen.mockResolvedValue(ok('How is the training feeling?'))

    const res = await prepareCheckin(NOW)

    expect(mockGen).toHaveBeenCalledWith({ title: 'Marathon training', details: 'Aiming for a fall race.' })
    expect(mockUpdate).toHaveBeenCalledWith('p1', { checkin_question: 'How is the training feeling?' })
    expect(res?.checkin_question).toBe('How is the training feeling?')
  })

  it('falls back to a templated question when generation fails', async () => {
    mockList.mockResolvedValue(ok([pursuit({ id: 'p1', last_mentioned_at: DUE_NOT_STALE })]))
    mockGen.mockResolvedValue(err('CHECKIN_QUESTION_INFERENCE_FAILED', 'x'))

    const res = await prepareCheckin(NOW)

    expect(res?.checkin_question).toBe(fallbackCheckinQuestion('Marathon training'))
    expect(mockUpdate).toHaveBeenCalledWith('p1', {
      checkin_question: 'How are things going with Marathon training?',
    })
  })

  it('retires a stale pursuit to dormant and excludes it from selection', async () => {
    mockList.mockResolvedValue(ok([pursuit({ id: 'old', last_mentioned_at: NOW - DORMANT_AFTER_MS })]))

    const res = await prepareCheckin(NOW)

    expect(mockUpdate).toHaveBeenCalledWith('old', { status: 'dormant' })
    expect(res).toBeNull() // retired, so nothing surfaces
    expect(mockGen).not.toHaveBeenCalled()
  })
})
