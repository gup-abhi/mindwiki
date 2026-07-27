import {
  GENERIC_COPY,
  buildNotificationContent,
  chooseCandidates,
  type NotificationCandidate,
} from '@/services/notifications/policy'

const candidate = (overrides: Partial<NotificationCandidate> = {}): NotificationCandidate => ({
  id: 'candidate-1',
  kind: 'journal',
  dedupeKey: 'journal:2026-07-27',
  targetRoute: '/(tabs)',
  eligibleAt: new Date(2026, 6, 27, 18).getTime(),
  expiresAt: new Date(2026, 6, 28).getTime(),
  priority: 30,
  ...overrides,
})

describe('notification privacy policy', () => {
  it('serializes only opaque candidate data and generic copy', () => {
    const content = buildNotificationContent(candidate({ id: 'opaque-123' }))
    expect(content).toEqual({
      title: 'MindWiki',
      body: GENERIC_COPY.journal,
      data: { candidateId: 'opaque-123', kind: 'journal' },
    })
    expect(JSON.stringify(content)).not.toContain('wikiId')
    expect(JSON.stringify(content)).not.toContain('topic')
  })

  it('keeps highest priority candidate when candidates collide', () => {
    const result = chooseCandidates(
      [
        candidate({ id: 'journal', kind: 'journal', priority: 30 }),
        candidate({ id: 'digest', kind: 'digest', priority: 80, dedupeKey: 'digest:1' }),
      ],
      { now: new Date(2026, 6, 27, 18).getTime(), recentEvents: [], journaledToday: false, pendingIds: new Set() }
    )
    expect(result.map((item) => item.id)).toEqual(['digest'])
  })

  it('suppresses journal candidate after same-day entry', () => {
    const result = chooseCandidates(
      [candidate()],
      { now: new Date(2026, 6, 27, 18).getTime(), recentEvents: [], journaledToday: true, pendingIds: new Set() }
    )
    expect(result).toEqual([])
  })
})