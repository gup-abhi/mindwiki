import * as Notifications from 'expo-notifications'

import {
  reconcileNotifications,
  resumeNotificationReconciliation,
  suspendNotificationReconciliation,
} from '@/services/notifications/orchestrator'
import { generateNotificationCandidates, hasJournalEntryToday } from '@/services/notifications/candidates'
import { getNotificationPreferences } from '@/services/notifications/preferences'
import { notificationPermissionState } from '@/services/notifications/permissions'
import {
  createCandidate,
  listEligibleCandidates,
  listRecentNotificationEvents,
  markCandidateStatus,
  pruneNotificationHistory,
  recordNotificationEvent,
  upsertCandidate,
} from '@/services/notifications/repository'
import { isWiping } from '@/services/storage/db'
import { ok } from '@/types/result'
import { type NotificationCandidate } from '@/services/notifications/types'

jest.mock('@/services/notifications/candidates', () => ({
  generateNotificationCandidates: jest.fn(),
  hasJournalEntryToday: jest.fn(),
}))
jest.mock('@/services/notifications/preferences', () => ({ getNotificationPreferences: jest.fn() }))
jest.mock('@/services/notifications/permissions', () => ({ notificationPermissionState: jest.fn() }))
jest.mock('@/services/notifications/repository', () => ({
  createCandidate: jest.fn(),
  listEligibleCandidates: jest.fn(),
  listRecentNotificationEvents: jest.fn(),
  markCandidateOpened: jest.fn(),
  markCandidateStatus: jest.fn(),
  recordNotificationEvent: jest.fn(),
  getCandidate: jest.fn(),
  upsertCandidate: jest.fn(),
  pruneNotificationHistory: jest.fn(),
}))
jest.mock('@/services/storage/wiki', () => ({ getPage: jest.fn() }))
jest.mock('@/services/storage/db', () => ({ isWiping: jest.fn() }))

const schedule = Notifications.scheduleNotificationAsync as jest.Mock
const cancel = Notifications.cancelScheduledNotificationAsync as jest.Mock
const getPending = Notifications.getAllScheduledNotificationsAsync as jest.Mock
const mockGenerate = generateNotificationCandidates as jest.Mock
const mockJournaled = hasJournalEntryToday as jest.Mock
const mockPreferences = getNotificationPreferences as jest.Mock
const mockPermission = notificationPermissionState as jest.Mock
const mockCreate = createCandidate as jest.Mock
const mockList = listEligibleCandidates as jest.Mock
const mockEvents = listRecentNotificationEvents as jest.Mock
const mockStatus = markCandidateStatus as jest.Mock
const mockUpsert = upsertCandidate as jest.Mock
const mockPrune = pruneNotificationHistory as jest.Mock
const mockRecordEvent = recordNotificationEvent as jest.Mock
const mockIsWiping = isWiping as jest.Mock

const DAY = 86_400_000
const NOW = Date.UTC(2026, 6, 15, 12)

const prefs = {
  enabled: true,
  journal: true,
  challenge: true,
  reengagement: true,
  insights: true,
  momentum: false,
  patterns: false,
  quietStartHour: 21,
  quietEndHour: 9,
  reminderStartHour: 17,
  reminderEndHour: 21,
  pausedUntil: null,
}

function candidate(id: string, days: number, priority = 30, status: NotificationCandidate['status'] = 'eligible'): NotificationCandidate {
  return {
    id,
    kind: 'journal',
    dedupeKey: `journal:${id}`,
    targetRoute: '/entry',
    eligibleAt: NOW + days * DAY,
    expiresAt: NOW + (days + 1) * DAY,
    priority,
    status,
  }
}

function native(id: string): { identifier: string } {
  return { identifier: `mindwiki-notification-${id}` }
}

async function waitUntil(predicate: () => boolean): Promise<void> {
  for (let i = 0; i < 50; i++) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  throw new Error('Condition not reached')
}

beforeEach(() => {
  jest.clearAllMocks()
  resumeNotificationReconciliation()
  mockIsWiping.mockReturnValue(false)
  mockPermission.mockResolvedValue('granted')
  mockPreferences.mockResolvedValue(ok(prefs))
  mockPrune.mockResolvedValue(ok(undefined))
  mockRecordEvent.mockResolvedValue(ok(undefined))
  mockEvents.mockResolvedValue(ok([]))
  mockGenerate.mockResolvedValue([])
  mockList.mockResolvedValue(ok([]))
  mockJournaled.mockResolvedValue(false)
  mockStatus.mockResolvedValue(ok(true))
  mockUpsert.mockResolvedValue(ok(undefined))
  mockCreate.mockImplementation(async (input: NotificationCandidate) => ok(input))
  getPending.mockResolvedValue([])
  schedule.mockImplementation(async (input: { identifier: string }) => input.identifier)
})

afterEach(() => resumeNotificationReconciliation())

describe('notification reconciliation integration', () => {
  it('keeps an already-native-pending candidate without duplicate schedule or cancellation', async () => {
    mockList.mockResolvedValue(ok([candidate('kept', 1, 30, 'scheduled')]))
    getPending.mockResolvedValue([native('kept')])

    const result = await reconcileNotifications('launch', NOW)

    expect(result.success).toBe(true)
    expect(schedule).not.toHaveBeenCalled()
    expect(cancel).not.toHaveBeenCalled()
    expect(mockStatus).not.toHaveBeenCalledWith('kept', 'expired')
  })

  it('arms multiple future days within the rolling weekly cap', async () => {
    const generated = [
      candidate('a', 1, 80),
      candidate('b', 2, 70),
      candidate('c', 3, 60),
      candidate('d', 4, 50),
      candidate('e', 5, 40),
    ]
    mockGenerate.mockResolvedValue(generated)
    mockCreate.mockImplementation(async (input: NotificationCandidate) => ok(input))

    const result = await reconcileNotifications('launch', NOW)

    expect(result).toMatchObject({ success: true, data: { scheduled: 4 } })
    expect(schedule).toHaveBeenCalledTimes(4)
    expect(mockUpsert).toHaveBeenCalledTimes(4)
  })

  it('does not infer delivery when a future native request disappears', async () => {
    mockList.mockResolvedValue(ok([candidate('gone', 1, 30, 'scheduled')]))

    await reconcileNotifications('launch', NOW)

    expect(mockRecordEvent).not.toHaveBeenCalledWith('delivered', expect.anything())
    expect(mockStatus).toHaveBeenCalledWith('gone', 'eligible')
    expect(schedule).toHaveBeenCalledTimes(1)
  })

  it('infers delivery only after the due-time tolerance', async () => {
    const due = NOW - 10 * 60 * 1000
    mockList.mockResolvedValue(ok([{ ...candidate('old', -1, 30, 'scheduled'), eligibleAt: due, scheduledFor: due, expiresAt: NOW + DAY }]))

    await reconcileNotifications('launch', NOW)

    expect(mockRecordEvent).toHaveBeenCalledWith('delivered', expect.objectContaining({ candidateId: 'old', kind: 'journal' }))
    expect(mockStatus).toHaveBeenCalledWith('old', 'expired')
    expect(schedule).not.toHaveBeenCalled()
  })

  it('converges after a partial native schedule failure on the next run', async () => {
    const item = candidate('retry', 1)
    mockGenerate.mockResolvedValue([item])
    schedule.mockRejectedValueOnce(new Error('native failure'))

    const first = await reconcileNotifications('launch', NOW)
    const second = await reconcileNotifications('resume', NOW)

    expect(first).toMatchObject({ success: true, data: { scheduled: 0 } })
    expect(second).toMatchObject({ success: true, data: { scheduled: 1 } })
    expect(schedule).toHaveBeenCalledTimes(2)
    expect(mockUpsert).toHaveBeenCalledTimes(1)
  })

  it('coalesces concurrent triggers into one active native scheduling pass', async () => {
    const item = candidate('one-flight', 1)
    mockGenerate.mockResolvedValue([item])
    let resolvePending: ((value: unknown[]) => void) | undefined
    let pendingReads = 0
    getPending.mockImplementation(() => {
      pendingReads++
      if (pendingReads === 1) return new Promise((resolve) => { resolvePending = resolve })
      return Promise.resolve([native('one-flight')])
    })

    const first = reconcileNotifications('launch', NOW)
    const second = reconcileNotifications('sync', NOW)
    await waitUntil(() => resolvePending != null)
    resolvePending?.([])
    await Promise.all([first, second])
    await waitUntil(() => pendingReads >= 2)

    expect(schedule).toHaveBeenCalledTimes(1)
  })

  it('bounded wait resolves while an active native call remains hung', async () => {
    let resolvePending: ((value: unknown[]) => void) | undefined
    getPending.mockImplementationOnce(() => new Promise((resolve) => { resolvePending = resolve }))
    const active = reconcileNotifications('launch', NOW)
    await waitUntil(() => resolvePending != null)
    suspendNotificationReconciliation()

    const started = Date.now()
    const { waitForNotificationReconciliation } = jest.requireActual('@/services/notifications/orchestrator') as typeof import('@/services/notifications/orchestrator')
    await waitForNotificationReconciliation(20)
    expect(Date.now() - started).toBeLessThan(200)

    // Resume starts a fresh account epoch even while old native call is pending.
    resumeNotificationReconciliation()
    getPending.mockResolvedValueOnce([])
    mockGenerate.mockResolvedValueOnce([])
    await expect(reconcileNotifications('launch', NOW + DAY)).resolves.toMatchObject({ success: true })

    resolvePending?.([])
    await active
  })

  it('cancels a native request that resolves after reconciliation is suspended', async () => {
    const item = candidate('late', 1)
    mockGenerate.mockResolvedValue([item])
    let resolveSchedule: ((identifier: string) => void) | undefined
    schedule.mockImplementationOnce(() => new Promise((resolve) => { resolveSchedule = resolve }))

    const active = reconcileNotifications('launch', NOW)
    await waitUntil(() => resolveSchedule != null)
    suspendNotificationReconciliation()
    resolveSchedule?.('mindwiki-notification-late')
    await active

    expect(cancel).toHaveBeenCalledWith('mindwiki-notification-late')
    expect(mockUpsert).not.toHaveBeenCalled()
  })
})