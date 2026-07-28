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
  /** Candidate ids already scheduled in the OS. These remain desired and are
   * considered occupied future delivery slots when selecting new picks. */
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

  // Budget is counted from delivery/open events, never scheduling attempts. A
  // `scheduled` event only proves the OS accepted a future request; counting it
  // caused the reconcile self-cancel bug. Deduplicate by candidate because a
  // foreground delivery followed by a tap can produce both event types.
  const sentByCandidate = new Map<string, NotificationEvent>()
  const anonymousSent: NotificationEvent[] = []
  for (const event of context.recentEvents) {
    if (event.type !== 'delivered' && event.type !== 'opened') continue
    if (event.candidateId) sentByCandidate.set(event.candidateId, event)
    else anonymousSent.push(event)
  }
  const sent = [...sentByCandidate.values(), ...anonymousSent]
  const appRecentlyActive = context.recentEvents.some(
    (e) => e.type === 'app_active' && e.occurredAt >= context.now - 2 * 3_600_000
  )
  const dueSoon = (candidate: NotificationCandidate): boolean =>
    candidate.eligibleAt <= context.now + 2 * 3_600_000

  // Candidates already pending in the OS stay desired unconditionally. Removing
  // them here would cancel legitimate future reminders on every re-run.
  const keep = candidates.filter((candidate) =>
    context.pendingIds.has(candidate.id)
    && candidate.expiresAt > context.now
    && (!candidate.status || !['opened', 'cancelled', 'expired'].includes(candidate.status))
  )
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
    .filter((candidate) => !(appRecentlyActive && dueSoon(candidate) && (candidate.kind === 'journal' || candidate.kind === 'reengagement')))
    .filter((candidate) => !candidate.status || !['opened', 'cancelled', 'expired'].includes(candidate.status))
    .filter((candidate) => !sent.some((event) => event.candidateId === candidate.id))
    .sort((a, b) => b.priority - a.priority || a.eligibleAt - b.eligibleAt || a.id.localeCompare(b.id))

  // Arm a bounded horizon, not a single request. Re-engagement D3/D7/D30 and
  // challenge/journal continuity only work if later tiers are already armed
  // before the app goes dormant. Existing pending requests remain desired, but
  // occupy their day/window when evaluating fresh requests. Enforce one per
  // local day and no more than four occurrences in any rolling seven-day span.
  const pickedDays = new Set([
    ...sent.map((event) => localDay(event.occurredAt)),
    ...keep.map((candidate) => localDay(candidate.eligibleAt)),
  ])
  const occurrenceTimes = [
    ...sent.map((event) => event.occurredAt),
    ...keep.map((candidate) => candidate.eligibleAt),
  ]
  const picked: NotificationCandidate[] = []
  for (const candidate of fresh) {
    const day = localDay(candidate.eligibleAt)
    if (pickedDays.has(day)) continue
    const tooClose = [...keep, ...picked].some((other) => Math.abs(other.eligibleAt - candidate.eligibleAt) < 6 * 3_600_000)
    if (tooClose) continue
    if (!withinWeeklyCap(candidate.eligibleAt, occurrenceTimes)) continue
    picked.push(candidate)
    pickedDays.add(day)
    occurrenceTimes.push(candidate.eligibleAt)
  }
  return [...keep, ...picked]
}

function withinWeeklyCap(candidateAt: number, existing: number[]): boolean {
  const times = [...existing, candidateAt].sort((a, b) => a - b)
  return times.every((start) => times.filter((time) => time >= start && time < start + 7 * 86_400_000).length <= 4)
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