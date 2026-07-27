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

  const sent = context.recentEvents.filter((e) => e.type === 'scheduled' || e.type === 'opened')
  const today = localDay(context.now)
  const weekAgo = context.now - 7 * 86_400_000
  const usedToday = sent.some((e) => localDay(e.occurredAt) === today)
  const usedThisWeek = sent.filter((e) => e.occurredAt >= weekAgo).length
  const appRecentlyActive = context.recentEvents.some(
    (e) => e.type === 'app_active' && e.occurredAt >= context.now - 2 * 3_600_000
  )

  return candidates
    .filter((candidate) => candidate.expiresAt > context.now)
    .filter((candidate) => enabledFor(candidate.kind, preferences))
    .filter((candidate) => !inQuietHours(candidate.eligibleAt, preferences))
    .filter((candidate) => !(context.journaledToday && (candidate.kind === 'journal' || candidate.kind === 'reengagement')))
    .filter((candidate) => !(appRecentlyActive && (candidate.kind === 'journal' || candidate.kind === 'reengagement')))
    .filter((candidate) => !candidate.status || !['scheduled', 'opened', 'cancelled', 'expired'].includes(candidate.status))
    .filter((candidate) => !sent.some((event) => event.candidateId === candidate.id))
    .sort((a, b) => b.priority - a.priority || a.eligibleAt - b.eligibleAt || a.id.localeCompare(b.id))
    .filter((candidate, index, all) => {
      if (index > 0 && all[index - 1].eligibleAt - candidate.eligibleAt < 6 * 3_600_000) return false
      if (usedToday || usedThisWeek >= 4) return false
      return true
    })
    .slice(0, 1)
}

export function isNotificationKind(value: unknown): value is NotificationKind {
  return value === 'journal' || value === 'challenge' || value === 'reengagement' || value === 'digest' || value === 'insight' || value === 'momentum' || value === 'pattern'
}

export function categoryForKind(kind: NotificationKind): NotificationCategory {
  return categoryFor(kind)
}