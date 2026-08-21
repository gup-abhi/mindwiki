import { generateNotificationCandidates } from '@/services/notifications/candidates'
import { getNotificationPreferences } from '@/services/notifications/preferences'
import { listReflectionCompletions } from '@/services/notifications/completions'
import { listReflectionPlanVersions } from '@/services/notifications/plan'
import { plannedDatesBetween } from '@/services/notifications/progress'
import { ok } from '@/types/result'
import { type ReflectionPlanVersion } from '@/services/notifications/types'

jest.mock('@/services/notifications/preferences', () => ({ getNotificationPreferences: jest.fn() }))
jest.mock('@/services/notifications/completions', () => ({ listReflectionCompletions: jest.fn() }))
jest.mock('@/services/notifications/plan', () => ({
  listReflectionPlanVersions: jest.fn(),
  planVersionAt: jest.requireActual('@/services/notifications/plan').planVersionAt,
  isPlannedSlot: jest.requireActual('@/services/notifications/plan').isPlannedSlot,
}))
jest.mock('@/services/storage/entries', () => ({ listEntries: jest.fn() }))

const mockPreferences = getNotificationPreferences as jest.Mock
const mockCompletions = listReflectionCompletions as jest.Mock
const mockPlans = listReflectionPlanVersions as jest.Mock

const DAY = 86_400_000
const HOUR = 60 * 60 * 1000
const NOW = new Date(2026, 7, 12, 12, 0, 0, 0).getTime()

const preferences = {
  enabled: true,
  routineWeekdays: [0, 1, 2, 3, 4, 5, 6],
  routineHour: 18,
  retryDelayMinutes: 60,
  pausedUntil: null,
  firstPlanSavedAt: NOW - 7 * DAY,
  setupDismissed: true,
  challenge: false,
  insights: false,
  weeklyReview: false,
  weeklyReviewWeekday: 0,
  weeklyReviewHour: 10,
  journal: true,
  reengagement: true,
  momentum: false,
  patterns: false,
  quietStartHour: 21,
  quietEndHour: 9,
  reminderStartHour: 17,
  reminderEndHour: 21,
}

function plan(overrides: Partial<ReflectionPlanVersion> = {}): ReflectionPlanVersion {
  return {
    id: 'plan',
    effectiveAt: 0,
    enabled: true,
    weekdays: [0, 1, 2, 3, 4, 5, 6],
    hour: 18,
    retryDelayMinutes: 60,
    pausedUntil: null,
    ...overrides,
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  mockPreferences.mockResolvedValue(ok(preferences))
  mockPlans.mockResolvedValue(ok([plan()]))
  mockCompletions.mockResolvedValue(ok([]))
})

describe('reflection routine policy', () => {
  it('keeps the main reminder after three misses but suppresses its retry', async () => {
    const result = await generateNotificationCandidates(NOW)
    const tomorrow = result.filter((candidate) => candidate.dedupeKey.includes('retry'))
    expect(result.some((candidate) => candidate.kind === 'routine')).toBe(true)
    expect(tomorrow).toHaveLength(0)
  })

  it('resets the missed sequence after a completion', async () => {
    mockCompletions.mockResolvedValue(ok([
      { id: 'completion', source: 'journal', durableId: 'entry', completedAt: NOW - DAY },
    ]))
    const result = await generateNotificationCandidates(NOW)
    expect(result.some((candidate) => candidate.kind === 'routine-retry')).toBe(true)
  })

  it('suppresses both candidates for a completed local date', async () => {
    mockCompletions.mockResolvedValue(ok([
      { id: 'completion', source: 'reflect', durableId: 'turn', completedAt: NOW + DAY + 7 * HOUR },
    ]))
    const result = await generateNotificationCandidates(NOW)
    expect(result.filter((candidate) => candidate.dedupeKey.includes('routine:2026-08-13'))).toHaveLength(0)
  })

  it('uses historical plan versions and excludes paused dates from progress', () => {
    const monday = new Date(2026, 7, 10, 0, 0, 0, 0).getTime()
    const versions = [
      plan({ effectiveAt: monday, weekdays: [1, 2], hour: 18 }),
      plan({ id: 'paused', effectiveAt: monday + DAY, weekdays: [1, 2], pausedUntil: monday + 3 * DAY }),
    ]
    const planned = plannedDatesBetween(monday, monday + 3 * DAY - 1, versions)
    expect(planned).toEqual(new Set(['2026-08-10']))
  })

  it('does not count an unplanned completion or future date', () => {
    const monday = new Date(2026, 7, 10, 0, 0, 0, 0).getTime()
    const versions = [plan({ effectiveAt: monday, weekdays: [1] })]
    const planned = plannedDatesBetween(monday, monday + 2 * DAY, versions)
    expect(planned).toEqual(new Set(['2026-08-10']))
  })
})
