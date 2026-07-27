import { type NotificationContentInput } from 'expo-notifications'

import {
  type NotificationCandidate,
  type NotificationCategory,
  type NotificationEvent,
  type NotificationKind,
  type NotificationPreferences,
} from './types'

export type { NotificationCandidate } from './types'

export const GENERIC_COPY: Record<NotificationKind, string> = {
  journal: 'A quiet moment to check in, if it would help.',
  challenge: 'Your daily check-in is waiting, whenever you’re ready.',
  reengagement: 'Your journal is here whenever you’re ready.',
  digest: 'Your week in review is ready when you want to look back.',
  insight: 'A new insight is ready when you want to explore it.',
  momentum: 'Something encouraging is worth noticing when you’re ready.',
  pattern: 'A pattern may be worth exploring when you have a quiet moment.',
}

export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  enabled: false,
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

const categoryFor = (kind: NotificationKind): NotificationCategory => {
  if (kind === 'digest' || kind === 'insight' || kind === 'momentum' || kind === 'pattern') return 'insights'
  return kind
}

export function buildNotificationContent(candidate: NotificationCandidate): NotificationContentInput {
  return {
    title: 'MindWiki',
    body: GENERIC_COPY[candidate.kind],
    data: { candidateId: candidate.id, kind: candidate.kind },
  }
}

export interface PolicyContext {
  now: number
  recentEvents: NotificationEvent[]
  journaledToday: boolean
  /** Candidate ids already scheduled in the OS. These remain desired and do
   * NOT consume the per-day/per-week send budget or collide with new picks. */
  pendingIds: Set<string>
  preferences?: NotificationPreferences
}

function localDay(ts: number): number {
  const d = new Date(ts)
  return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86_400_000)
}

function inQuietHours(ts: number, preferences: NotificationPreferences): boolean {
  const hour = new Date(ts).getHours()
  const { quietStartHour: start, quietEndHour: end } = preferences
  return start === end ? false : start > end ? hour >= start || hour < end : hour >= start && hour < end
}

function enabledFor(kind: NotificationKind, preferences: NotificationPreferences): boolean {
  if (kind === 'journal') return preferences.journal
  if (kind === 'challenge') return preferences.challenge
  if (kind === 'reengagement') return preferences.reengagement
  if (kind === 'momentum') return preferences.momentum
  if (kind === 'pattern') return preferences.patterns
  return preferences.insights
}

/** Pure, deterministic policy. Ordinary proactive notifications are capped at
 * one per local day and four per rolling seven days. Same-window collisions keep
 * the highest-priority candidate; lower priorities are suppressed. */
export function chooseCandidates(
  candidates: NotificationCandidate[],
  context: PolicyContext
): NotificationCandidate[] {
  const preferences = context.preferences ?? { ...DEFAULT_NOTIFICATION_PREFERENCES, enabled: true }
  if (!preferences.enabled || (preferences.pausedUntil != null && preferences.pausedUntil > context.now)) return []

  // Budget is counted from notifications actually opened. A `scheduled` event
  // only proves the OS accepted a request, not that a notification fired.
  // Counting those would make a re-run cancel the very request an earlier run
  // just armed (the reconcile self-cancel bug): the matching `scheduled` event
  // would suppress the candidate, the desired set would empty, and the OS
  // request would be cancelled. Only `opened` (user saw + acted) consumes the
  // budget.
  const sent = context.recentEvents.filter((e) => e.type === 'opened')
  const today = localDay(context.now)
  const weekAgo = context.now - 7 * 86_400_000
  const usedToday = sent.some((e) => localDay(e.occurredAt) === today)
  const usedThisWeek = sent.filter((e) => e.occurredAt >= weekAgo).length
  const appRecentlyActive = context.recentEvents.some(
    (e) => e.type === 'app_active' && e.occurredAt >= context.now - 2 * 3_600_000
  )

  // Candidates already pending in the OS stay desired unconditionally: they
  // neither compete with new picks nor count against the send budget. Removing
  // them here would cancel legitimate future reminders on every re-run.
  const keep = candidates.filter((candidate) => context.pendingIds.has(candidate.id))
  // Shift candidates whose eligibleAt lands inside quiet hours to the first
  // valid slot (quietEndHour same day, or quietEndHour next day). Suppress if
  // the shifted slot would be past expiresAt or in the past.
  const shiftedFresh = (candidate: NotificationCandidate): NotificationCandidate | null => {
    if (!inQuietHours(candidate.eligibleAt, preferences)) return candidate
    const sameDay = atLocalHour(localDay(candidate.eligibleAt), preferences.quietEndHour)
    const sameDayAfterNow = sameDay > candidate.eligibleAt ? sameDay : Number.NaN
    const nextDay = atLocalHour(localDay(candidate.eligibleAt) + 1, preferences.quietEndHour)
    const next = !Number.isNaN(sameDayAfterNow) ? sameDayAfterNow : nextDay
    if (next >= candidate.expiresAt) return null
    if (next < context.now) return null
    return { ...candidate, eligibleAt: next }
  }
  const fresh = candidates
    .filter((candidate) => !context.pendingIds.has(candidate.id))
    .filter((candidate) => candidate.expiresAt > context.now)
    .filter((candidate) => enabledFor(candidate.kind, preferences))
    .map((candidate) => shiftedFresh(candidate))
    .filter((candidate): candidate is NotificationCandidate => candidate != null)
    .filter((candidate) => !(context.journaledToday && (candidate.kind === 'journal' || candidate.kind === 'reengagement')))
    .filter((candidate) => !(appRecentlyActive && (candidate.kind === 'journal' || candidate.kind === 'reengagement')))
    .filter((candidate) => !candidate.status || !['opened', 'cancelled', 'expired'].includes(candidate.status))
    .filter((candidate) => !sent.some((event) => event.candidateId === candidate.id))
    .sort((a, b) => b.priority - a.priority || a.eligibleAt - b.eligibleAt || a.id.localeCompare(b.id))

  // Arm a bounded horizon, not a single request. Re-engagement D3/D7/D30 and
  // challenge/journal continuity only work if later tiers are already armed
  // before the app goes dormant. Enforce one per local day and four per rolling
  // seven days; suppress (do not shift) candidates that would collide inside
  // the six-hour spacing window or exceed the weekly cap.
  const pickedDays = new Set(keep.map((candidate) => localDay(candidate.eligibleAt)))
  let weekCount = usedThisWeek + keep.filter((candidate) => candidate.eligibleAt >= weekAgo).length
  const picked: NotificationCandidate[] = []
  for (const candidate of fresh) {
    const day = localDay(candidate.eligibleAt)
    if (usedToday || pickedDays.has(day)) continue
    if (weekCount >= 4) continue
    const tooClose = [...keep, ...picked].some((other) => Math.abs(other.eligibleAt - candidate.eligibleAt) < 6 * 3_600_000)
    if (tooClose) continue
    picked.push(candidate)
    pickedDays.add(day)
    if (candidate.eligibleAt >= weekAgo) weekCount++
  }
  return [...keep, ...picked]
}

function atLocalHour(day: number, hour: number): number {
  // day = UTC day index from localDay(). day * DAY_MS = UTC midnight of the
  // original local date. Reconstruct a local Date so hour:00 is local (not UTC).
  const d = new Date(day * 86_400_000)
  return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), hour, 0, 0, 0).getTime()
}

export function isNotificationKind(value: unknown): value is NotificationKind {
  return value === 'journal' || value === 'challenge' || value === 'reengagement' || value === 'digest' || value === 'insight' || value === 'momentum' || value === 'pattern'
}

export function categoryForKind(kind: NotificationKind): NotificationCategory {
  return categoryFor(kind)
}