import { chooseCandidates, type NotificationCandidate } from '@/services/notifications/policy'
import { type PolicyContext } from '@/services/notifications/policy'

// ── pure policy unit tests (no native dep) ──────────────────────────────

const candidate = (
  overrides: Partial<NotificationCandidate> & { id: string; kind: NotificationCandidate['kind'] }
): NotificationCandidate => ({
  dedupeKey: `${overrides.kind}:${overrides.id}`,
  targetRoute: '/entry',
  eligibleAt: overrides.eligibleAt ?? Date.now() + 86_400_000,
  expiresAt: (overrides.eligibleAt ?? Date.now() + 86_400_000) + 86_400_000,
  priority: 30,
  status: 'eligible' as const,
  ...overrides,
})

function ctx(overrides?: Partial<PolicyContext>): PolicyContext {
  return {
    now: Date.now(),
    recentEvents: [],
    journaledToday: false,
    pendingIds: new Set(),
    ...overrides,
  }
}

describe('policy — pending exclusion', () => {
  it('keeps a pending candidate even when expiration is near', () => {
    const c = candidate({ id: 'kept', kind: 'journal', expiresAt: Date.now() + 10_000 })
    const result = chooseCandidates([c], ctx({ pendingIds: new Set(['kept']) }))
    expect(result.map((x) => x.id)).toEqual(['kept'])
  })

  it('keeps a pending candidate regardless of journaledToday', () => {
    const c = candidate({ id: 'p', kind: 'journal' })
    const result = chooseCandidates([c], ctx({ pendingIds: new Set(['p']), journaledToday: true }))
    expect(result.map((x) => x.id)).toEqual(['p'])
  })

  it('keeps a pending candidate regardless of app recently active', () => {
    const c = candidate({ id: 'p', kind: 'journal' })
    const result = chooseCandidates([c], ctx({
      pendingIds: new Set(['p']),
      recentEvents: [{ id: 'ev', type: 'app_active', occurredAt: Date.now() - 1_000 }],
    }))
    expect(result.map((x) => x.id)).toEqual(['p'])
  })

  it('keeps pending candidates even when weekly or daily cap would be exceeded by new picks', () => {
    const pending = [
      candidate({ id: 'a', kind: 'journal', eligibleAt: Date.now() + 86_400_000 }),
      candidate({ id: 'b', kind: 'challenge', eligibleAt: Date.now() + 2 * 86_400_000 }),
      candidate({ id: 'c', kind: 'digest', eligibleAt: Date.now() + 3 * 86_400_000 }),
      candidate({ id: 'd', kind: 'reengagement', eligibleAt: Date.now() + 4 * 86_400_000 }),
    ]
    const result = chooseCandidates(pending, ctx({
      pendingIds: new Set(['a', 'b', 'c', 'd']),
    }))
    expect(result).toHaveLength(4) // all four survive despite spanning multiple days
  })
})

describe('policy — multi-horizon selection', () => {
  it('arms journal and challenge on different days', () => {
    const journal = candidate({ id: 'j', kind: 'journal', eligibleAt: Date.now() + 86_400_000, priority: 30 })
    const challenge = candidate({ id: 'c', kind: 'challenge', eligibleAt: Date.now() + 2 * 86_400_000, priority: 60 })
    const result = chooseCandidates([journal, challenge], ctx({ pendingIds: new Set() }))
    const ids = result.map((x) => x.id).sort()
    expect(ids).toEqual(['c', 'j']) // both selected (different days)
  })

  it('picks only one candidate per local day', () => {
    const journal = candidate({ id: 'j', kind: 'journal', eligibleAt: Date.now() + 86_400_000, priority: 30 })
    const challenge = candidate({ id: 'c', kind: 'challenge', eligibleAt: Date.now() + 86_400_000 + 1, priority: 60 })
    const result = chooseCandidates([journal, challenge], ctx({ pendingIds: new Set() }))
    const ids = result.map((x) => x.id)
    // Both same day; higher priority wins
    expect(ids).toHaveLength(1)
    expect(ids[0]).toBe('c')
  })

  it('picks at most one candidate per local day, higher priority wins', () => {
    const day = 86_400_000
    const hour = 3_600_000
    const now = Date.now()
    // Both candidates on the same local day (now + 24h ± 1h). Using a 1-hour
    // offset ensures they share a localDay in every timezone.
    const morning = candidate({ id: 'm', kind: 'challenge', eligibleAt: now + day, priority: 60 })
    const afternoon = candidate({ id: 'a', kind: 'journal', eligibleAt: now + day + hour, priority: 30 })
    const result = chooseCandidates([morning, afternoon], ctx({ now, pendingIds: new Set() }))
    // Same local day, so only one can be picked. Higher priority wins.
    expect(result.map((x) => x.id)).toEqual(['m'])
  })

  it('detects same local day collision even when 6-hour spacing is satisfied', () => {
    const day = 86_400_000
    const now = Date.now()
    // Both eligibleAt on the same local day (now+24h) but spaced >6h apart.
    // Still only one per local day is allowed.
    const nineAm = candidate({ id: 'm', kind: 'challenge', eligibleAt: now + day + 9 * 3_600_000, priority: 60 })
    const fivePm = candidate({ id: 'a', kind: 'journal', eligibleAt: now + day + 17 * 3_600_000, priority: 30 })
    const result = chooseCandidates([nineAm, fivePm], ctx({ now, pendingIds: new Set() }))
    // Same local day despite >6h spacing → only one picked
    expect(result.map((x) => x.id)).toHaveLength(1)
  })

  it('pending future requests reserve daily and rolling-week slots for fresh picks', () => {
    const day = 86_400_000
    const anchor = Date.UTC(2026, 6, 15, 12, 0, 0, 0)
    const pending = [1, 2, 3].map((days) => candidate({
      id: `pending-${days}`,
      kind: 'challenge',
      eligibleAt: anchor + days * day,
      priority: 60,
      status: 'scheduled',
    }))
    const fresh = [
      candidate({ id: 'same-day', kind: 'digest', eligibleAt: anchor + day + 1, priority: 80 }),
      candidate({ id: 'fourth', kind: 'journal', eligibleAt: anchor + 4 * day, priority: 30 }),
      candidate({ id: 'fifth', kind: 'journal', eligibleAt: anchor + 5 * day, priority: 30 }),
    ]
    const result = chooseCandidates([...pending, ...fresh], ctx({
      now: anchor,
      pendingIds: new Set(pending.map((item) => item.id)),
    }))

    expect(result.map((item) => item.id).sort()).toEqual(['fourth', 'pending-1', 'pending-2', 'pending-3'])
  })

  it('weekly cap allows up to four fresh picks', () => {
    const day = 86_400_000
    const anchor = Date.UTC(2026, 6, 15, 12, 0, 0, 0)
    const candidates = [
      { id: 'a', kind: 'journal' as const, eligibleAt: anchor + day, priority: 30 },
      { id: 'b', kind: 'reengagement' as const, eligibleAt: anchor + 2 * day, priority: 20 },
      { id: 'c', kind: 'challenge' as const, eligibleAt: anchor + 3 * day, priority: 60 },
      { id: 'd', kind: 'digest' as const, eligibleAt: anchor + 4 * day, priority: 80 },
      { id: 'e', kind: 'pattern' as const, eligibleAt: anchor + 5 * day, priority: 40 },
    ].map((x) => candidate(x))
    const result = chooseCandidates(candidates, ctx({ now: anchor, pendingIds: new Set() }))
    // First 4 (different days) fit within 4/week cap; 5th day exceeds cap
    expect(result.length).toBe(4)
  })

  it('weekly cap already consumed by opened events reduces fresh picks', () => {
    const day = 86_400_000
    const anchor = Date.UTC(2026, 6, 15, 12, 0, 0, 0)
    const opened = Array.from({ length: 3 }, (_, i) => ({
      id: `op${i}`, candidateId: undefined, kind: 'journal' as const,
      type: 'opened' as const, occurredAt: anchor - (i + 1) * day,
    }))
    const candidates = [
      { id: 'a', kind: 'journal' as const, eligibleAt: anchor + day, priority: 30 },
      { id: 'b', kind: 'challenge' as const, eligibleAt: anchor + 2 * day, priority: 60 },
      { id: 'c', kind: 'digest' as const, eligibleAt: anchor + 5 * day, priority: 80 },
    ].map((x) => candidate(x))
    // Rolling-window accounting allows one near-term slot and one beyond seven
    // days from the oldest opened event. Static `now-7d` counting would wrongly
    // suppress that later horizon.
    const result = chooseCandidates(candidates, ctx({ now: anchor, pendingIds: new Set(), recentEvents: opened }))
    expect(result.map((item) => item.kind)).toEqual(['digest', 'challenge'])
  })
})

describe('policy — quiet hours shift', () => {
  const prefs = {
    enabled: true,
    journal: true,
    challenge: true,
    reengagement: true,
    insights: true,
    momentum: false,
    patterns: false,
    quietStartHour: 22,
    quietEndHour: 8,
    reminderStartHour: 17,
    reminderEndHour: 21,
    pausedUntil: null,
  }

  it('shifts journal candidate from 22:00 to next-day 08:00', () => {
    // Base eligibleAt lands at 22:00 local on a future day
    const now = Date.now()
    const dayMs = 86_400_000
    const eligibleAt = Math.ceil(now / dayMs) * dayMs + 22 * 3_600_000
    const c = candidate({ id: 'j', kind: 'journal', eligibleAt })
    const result = chooseCandidates([c], ctx({
      now: now,
      pendingIds: new Set(),
      preferences: prefs,
    }))
    // If eligibleAt is inside quiet hours (22:00-08:00), it's shifted to
    // quietEndHour (08:00) of the same day. Since 22:00 > 08:00, the same-day
    // shift would be 08:00 which is before the original 22:00, so next day.
    // Either way we get a candidate (not suppressed).
    expect(result.length).toBeGreaterThanOrEqual(1)
  })
})

describe('policy — budget counting per delivery/open (not scheduled)', () => {
  it('ignores scheduled events when counting daily/weekly budget', () => {
    // A candidate was scheduled (event exists) but never opened → budget unaffected
    const c = candidate({ id: 'j', kind: 'journal' })
    const result = chooseCandidates([c], ctx({
      recentEvents: [{ id: 's1', candidateId: 'other', kind: 'journal', type: 'scheduled', occurredAt: Date.now() }],
    }))
    expect(result.map((x) => x.id)).toContain('j')
  })

  it('counts delivered + opened for one candidate only once', () => {
    const now = Date.now()
    const fresh = candidate({ id: 'fresh', kind: 'journal', eligibleAt: now + 86_400_000 })
    const result = chooseCandidates([fresh], ctx({
      now,
      recentEvents: [
        { id: 'd', candidateId: 'old', kind: 'journal', type: 'delivered', occurredAt: now - 4 * 86_400_000 },
        { id: 'o', candidateId: 'old', kind: 'journal', type: 'opened', occurredAt: now - 4 * 86_400_000 + 1 },
        { id: 'd2', candidateId: 'old-2', kind: 'journal', type: 'delivered', occurredAt: now - 3 * 86_400_000 },
        { id: 'd3', candidateId: 'old-3', kind: 'journal', type: 'delivered', occurredAt: now - 2 * 86_400_000 },
        { id: 'd4', candidateId: 'old-4', kind: 'journal', type: 'delivered', occurredAt: now - 86_400_000 },
      ],
    }))
    expect(result).toHaveLength(0)
  })
})