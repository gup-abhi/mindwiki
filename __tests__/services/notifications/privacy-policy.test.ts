import {
  GENERIC_COPY,
  buildNotificationContent,
  chooseCandidates,
  type NotificationCandidate,
} from '@/services/notifications/policy'
import { type NotificationPreferences } from '@/services/notifications/types'

const candidate = (overrides: Partial<NotificationCandidate> = {}): NotificationCandidate => ({
  id: 'candidate-1',
  kind: 'routine',
  dedupeKey: 'routine:2026-07-27:main',
  targetRoute: '/entry',
  eligibleAt: new Date(2026, 6, 27, 18).getTime(),
  expiresAt: new Date(2026, 6, 28).getTime(),
  priority: 30,
  ...overrides,
})

const enabledPreferences = {
  enabled: true,
  routineWeekdays: [1, 2, 3, 4, 5],
} as NotificationPreferences

describe('notification privacy policy', () => {
  it('serializes only opaque candidate data and generic copy', () => {
    const content = buildNotificationContent(candidate({ id: 'opaque-123' }))
    expect(content).toEqual({
      title: 'MindWiki',
      body: GENERIC_COPY.routine,
      categoryIdentifier: 'reflectionroutine',
      data: { candidateId: 'opaque-123', kind: 'routine' },
    })
    expect(JSON.stringify(content)).not.toContain('wikiId')
    expect(JSON.stringify(content)).not.toContain('topic')
  })

  it('keeps highest priority candidate when candidates collide', () => {
    const result = chooseCandidates(
      [
        candidate({ id: 'routine', kind: 'routine', priority: 30 }),
        candidate({ id: 'insight', kind: 'insight', priority: 80, dedupeKey: 'insight:1' }),
      ],
      { now: new Date(2026, 6, 27, 18).getTime(), recentEvents: [], journaledToday: false, pendingIds: new Set(), preferences: { ...enabledPreferences, insights: true } }
    )
    expect(result.map((item) => item.id)).toEqual(['insight', 'routine'])
  })

  it('does not schedule legacy candidates under V2 preferences', () => {
    const result = chooseCandidates(
      [candidate({ kind: 'journal' })],
      { now: new Date(2026, 6, 27, 18).getTime(), recentEvents: [], journaledToday: false, pendingIds: new Set(), preferences: enabledPreferences }
    )
    expect(result).toEqual([])
  })
})