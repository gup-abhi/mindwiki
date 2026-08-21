import * as Notifications from 'expo-notifications'

import { type NotificationContentInput } from 'expo-notifications'
import { type Result, ok } from '@/types/result'
import { type NotificationCandidate, type NotificationCategory, type NotificationEvent, type NotificationKind, type NotificationPreferences } from './types'
import { scheduleFirstInsightCandidate } from './orchestrator'

const ROUTINE_COPY = 'A quiet moment to check in, if it would help.'

export const GENERIC_COPY: Record<NotificationKind, string> = {
  routine: ROUTINE_COPY,
  'routine-retry': ROUTINE_COPY,
  'weekly-review': 'Your week in reflection is ready when you want to look back.',
  challenge: 'A challenge is ready whenever you are.',
  insight: 'A new insight is ready when you want to explore it.',
  journal: ROUTINE_COPY,
  reengagement: ROUTINE_COPY,
  digest: 'Your week in reflection is ready when you want to look back.',
  momentum: 'Something encouraging is worth noticing when you are ready.',
  pattern: 'A pattern may be worth exploring when you have a quiet moment.',
}

export { type NotificationCandidate } from './types'
export { type NotificationPreferencesInput } from './types'

export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  enabled: false,
  routineWeekdays: [1, 2, 3, 4, 5],
  routineHour: 20,
  retryDelayMinutes: 60,
  pausedUntil: null,
  firstPlanSavedAt: null,
  setupDismissed: false,
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

const categoryFor = (kind: NotificationKind): NotificationCategory =>
  kind === 'challenge' ? 'challenge' : kind === 'insight' || kind === 'weekly-review' ? 'insights' : 'routine'

export function buildNotificationContent(candidate: NotificationCandidate): NotificationContentInput {
  return {
    title: 'MindWiki',
    body: GENERIC_COPY[candidate.kind],
    ...(candidate.kind === 'routine' || candidate.kind === 'routine-retry'
      ? { categoryIdentifier: 'reflectionroutine' }
      : {}),
    data: { candidateId: candidate.id, kind: candidate.kind },
  }
}

export interface PolicyContext {
  now: number
  recentEvents: NotificationEvent[]
  journaledToday: boolean
  pendingIds: Set<string>
  preferences?: NotificationPreferences
}

function enabledFor(kind: NotificationKind, preferences: NotificationPreferences): boolean {
  const isLegacyShape = preferences.routineWeekdays == null
  if (kind === 'routine' || kind === 'routine-retry') return preferences.enabled && (preferences.routineWeekdays?.length ?? 0) > 0
  if (kind === 'challenge') return preferences.challenge
  if (kind === 'insight') return preferences.insights
  if (kind === 'weekly-review') return preferences.weeklyReview === true
  if (isLegacyShape) {
    if (kind === 'journal') return preferences.enabled && preferences.journal
    if (kind === 'reengagement') return preferences.enabled && preferences.reengagement
    if (kind === 'digest') return preferences.enabled && preferences.insights
    if (kind === 'momentum') return preferences.enabled && preferences.momentum
    if (kind === 'pattern') return preferences.enabled && preferences.patterns
  }
  return false
  return false
}

function legacyDay(ts: number): number {
  const date = new Date(ts)
  return Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86_400_000)
}

function withinLegacyWeeklyCap(candidateAt: number, existing: number[]): boolean {
  const times = [...existing, candidateAt].sort((a, b) => a - b)
  return times.every((start) => times.filter((time) => time >= start && time < start + 7 * 86_400_000).length <= 4)
}

function chooseLegacyCandidates(candidates: NotificationCandidate[], context: PolicyContext, preferences: NotificationPreferences): NotificationCandidate[] {
  if (!preferences.enabled || (preferences.pausedUntil != null && preferences.pausedUntil > context.now)) return []
  const sent = context.recentEvents.filter((event) => event.type === 'delivered' || event.type === 'opened')
  const keep = candidates.filter((candidate) => context.pendingIds.has(candidate.id) && candidate.expiresAt > context.now && !['opened', 'cancelled', 'expired'].includes(candidate.status ?? ''))
  const days = new Set([...sent.map((event) => legacyDay(event.occurredAt)), ...keep.map((candidate) => legacyDay(candidate.eligibleAt))])
  const times = [...sent.map((event) => event.occurredAt), ...keep.map((candidate) => candidate.eligibleAt)]
  const fresh = candidates
    .filter((candidate) => !context.pendingIds.has(candidate.id))
    .filter((candidate) => candidate.expiresAt > context.now && candidate.eligibleAt >= context.now)
    .filter((candidate) => enabledFor(candidate.kind, preferences))
    .filter((candidate) => !['opened', 'cancelled', 'expired'].includes(candidate.status ?? ''))
    .filter((candidate) => !sent.some((event) => event.candidateId === candidate.id))
    .sort((a, b) => b.priority - a.priority || a.eligibleAt - b.eligibleAt || a.id.localeCompare(b.id))
  const picked: NotificationCandidate[] = []
  for (const candidate of fresh) {
    const day = legacyDay(candidate.eligibleAt)
    if (days.has(day) || !withinLegacyWeeklyCap(candidate.eligibleAt, times)) continue
    picked.push(candidate)
    days.add(day)
    times.push(candidate.eligibleAt)
  }
  return [...keep, ...picked]
}

export function chooseCandidates(candidates: NotificationCandidate[], context: PolicyContext): NotificationCandidate[] {
  const hasV2Candidate = candidates.some((candidate) => candidate.kind === 'routine' || candidate.kind === 'routine-retry' || candidate.kind === 'weekly-review' || candidate.kind === 'insight')
  const preferences = context.preferences ?? (hasV2Candidate ? {
    ...DEFAULT_NOTIFICATION_PREFERENCES,
    enabled: true,
    insights: true,
    weeklyReview: true,
  } : {
    ...DEFAULT_NOTIFICATION_PREFERENCES,
    enabled: true,
    routineWeekdays: undefined,
    journal: true,
    challenge: true,
    reengagement: true,
    insights: true,
    patterns: true,
  })
  if (!hasV2Candidate) return chooseLegacyCandidates(candidates, context, preferences)
  if (!preferences.enabled || (preferences.pausedUntil != null && preferences.pausedUntil > context.now)) return []
  return candidates
    .filter((candidate) => candidate.expiresAt > context.now)
    .filter((candidate) => enabledFor(candidate.kind, preferences))
    .filter((candidate) => !candidate.status || !['opened', 'cancelled', 'expired'].includes(candidate.status))
    .filter((candidate) => context.pendingIds.has(candidate.id) || candidate.eligibleAt >= context.now)
    .sort((a, b) => b.priority - a.priority || a.eligibleAt - b.eligibleAt || a.id.localeCompare(b.id))
}

export function isNotificationKind(value: unknown): value is NotificationKind {
  return value === 'routine' || value === 'routine-retry' || value === 'weekly-review' || value === 'challenge' || value === 'insight' || value === 'journal' || value === 'reengagement' || value === 'digest' || value === 'momentum' || value === 'pattern'
}

export function categoryForKind(kind: NotificationKind): NotificationCategory {
  return categoryFor(kind)
}

export function safeRoute(route: string): string | null {
  if (route === '/entry' || route === '/challenge' || route === '/digest' || route === '/trends' || route === '/(tabs)/query') return route
  if (/^\/wiki\/[A-Za-z0-9_-]+$/.test(route)) return route
  return null
}

/** Compatibility wrapper: insight notifications still enter through the orchestrator. */
export async function sendFirstPageReadyNotification(page: { id: string; title: string }): Promise<Result<void>> {
  void page.title
  return scheduleFirstInsightCandidate(page.id)
}

/** Configure local notifications without sound, badges, or foreground interruption. */
export function configureNotifications(): void {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({ shouldShowAlert: false, shouldPlaySound: false, shouldSetBadge: false }),
  })
}

export async function ensurePermission(): Promise<Result<boolean>> {
  return ok(false)
}
