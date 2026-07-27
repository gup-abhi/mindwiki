import * as Notifications from 'expo-notifications'

import { type Result, ok, err } from '@/types/result'
import { type NotificationRequestInput } from 'expo-notifications'
import { generateNotificationCandidates, hasJournalEntryToday } from './candidates'
import { getPage } from '@/services/storage/wiki'
import { buildNotificationContent, chooseCandidates } from './policy'
import { getNotificationPreferences } from './preferences'
import { notificationPermissionState } from './permissions'
import { createCandidate, listEligibleCandidates, listRecentNotificationEvents, markCandidateOpened, markCandidateStatus, recordNotificationEvent, getCandidate, upsertCandidate, pruneNotificationHistory } from './repository'
import { isWiping } from '@/services/storage/db'
import { type NotificationCandidate, type NotificationReconcileReason, type NotificationReconcileSummary } from './types'

const REQUEST_PREFIX = 'mindwiki-notification-'
const LEGACY_PREFIXES = ['mindwiki-daily-reminder', 'mindwiki-weekly-digest', 'mindwiki-challenge-', 'mindwiki-first-page-ready']
const CHANNEL_ID = 'reflection-reminders'

let flight: Promise<Result<NotificationReconcileSummary>> | null = null
let rerun = false

function requestId(candidate: NotificationCandidate): string {
  return `${REQUEST_PREFIX}${candidate.id}`
}

function isMindWikiRequest(identifier: string): boolean {
  return identifier.startsWith(REQUEST_PREFIX) || LEGACY_PREFIXES.some((prefix) => identifier.startsWith(prefix))
}

async function configureChannel(): Promise<void> {
  try {
    await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
      name: 'Reflection reminders',
      importance: 4,
      description: 'Privacy-safe reminders from MindWiki',
      sound: null,
      enableVibrate: false,
      enableLights: false,
      showBadge: false,
    })
  } catch {
    // iOS and web do not expose Android channels.
  }
}

async function reconcileOnce(now: number): Promise<Result<NotificationReconcileSummary>> {
  if (isWiping()) return ok({ scheduled: 0, cancelled: 0, suppressed: 0, permission: 'not-determined' })
  const permission = await notificationPermissionState()
  const preferences = await getNotificationPreferences()
  if (!preferences.success) return preferences
  // Bound local history before reading it (no-op when nothing is due to prune).
  await pruneNotificationHistory(now)
  let pending: Notifications.NotificationRequest[]
  try { pending = await Notifications.getAllScheduledNotificationsAsync() }
  catch (e) { return err('NOTIF_PENDING_READ_FAILED', 'Failed to read scheduled notifications', e) }
  const existing = pending.filter((item) => isMindWikiRequest(item.identifier))

  if (!preferences.data.enabled || (permission !== 'granted' && permission !== 'provisional')) {
    let cancelled = 0
    for (const item of existing) {
      try { await Notifications.cancelScheduledNotificationAsync(item.identifier); cancelled++ } catch { /* converge next run */ }
    }
    return ok({ scheduled: 0, cancelled, suppressed: 0, permission })
  }

  await configureChannel()
  const activity = await listRecentNotificationEvents(now - 8 * 7 * 86_400_000)
  const recent = activity.success
    ? { ...activity, data: activity.data.filter((event) => event.occurredAt >= now - 7 * 86_400_000) }
    : activity
  const generated = await generateNotificationCandidates(now, activity.success
    ? activity.data.filter((event) => event.type === 'app_active' || event.type === 'entry_saved').map((event) => ({ occurredAt: event.occurredAt }))
    : [])
  const candidates: NotificationCandidate[] = []
  for (const item of generated) {
    const saved = await createCandidate(item)
    if (saved.success) candidates.push(saved.data)
  }
  const stored = await listEligibleCandidates(now)
  if (stored.success) candidates.push(...stored.data.filter((item) => !candidates.some((current) => current.id === item.id)))
  const journaledToday = await hasJournalEntryToday(now)
  const nativeCandidateIds = new Set(
    existing
      .filter((item) => item.identifier.startsWith(REQUEST_PREFIX))
      .map((item) => item.identifier.slice(REQUEST_PREFIX.length))
  )
  // A scheduled candidate whose native request is no longer pending was
  // delivered (the OS drops the request once a DATE trigger fires) and never
  // opened. Mark it expired so it is not resurrected, and stop tracking it
  // against the send budget — `opened` is the only budget event, so delivery
  // without a tap does not consume a daily/weekly slot.
  for (const candidate of candidates) {
    if (candidate.status === 'scheduled' && !nativeCandidateIds.has(candidate.id)) {
      void markCandidateStatus(candidate.id, 'expired')
    }
  }
  // Already-pending candidates are passed to policy with their real status so
  // policy can keep them desired without re-evaluating eligibility or consuming
  // the send budget. Clearing status here caused the reconcile self-cancel bug:
  // the matching `scheduled` event then suppressed the candidate, emptying the
  // desired set on the very next run and cancelling the request we just armed.
  const selected = chooseCandidates(candidates, { now, recentEvents: recent.success ? recent.data : [], journaledToday, pendingIds: nativeCandidateIds, preferences: preferences.data })
  const desired = new Set(selected.map(requestId))
  let cancelled = 0
  for (const item of existing) {
    if (!desired.has(item.identifier)) {
      try {
        await Notifications.cancelScheduledNotificationAsync(item.identifier)
        cancelled++
      } catch { /* converge next run */ }
    }
  }

  let scheduled = 0
  for (const candidate of selected) {
    const identifier = requestId(candidate)
    if (existing.some((item) => item.identifier === identifier)) continue
    const input: NotificationRequestInput = {
      identifier,
      content: buildNotificationContent(candidate),
      trigger: candidate.eligibleAt > now
        ? { type: Notifications.SchedulableTriggerInputTypes.DATE, date: candidate.eligibleAt, channelId: CHANNEL_ID }
        : null,
    }
    try {
      await Notifications.scheduleNotificationAsync(input)
      await upsertCandidate({ ...candidate, scheduledFor: candidate.eligibleAt, status: 'scheduled' })
      scheduled++
    } catch {
      // Partial failure is represented by the Result summary; next lifecycle run converges.
    }
  }
  return ok({ scheduled, cancelled, suppressed: Math.max(0, generated.length - selected.length), permission })
}

export async function recordAppActive(now = Date.now()): Promise<Result<void>> {
  try { return await recordNotificationEvent('app_active', { occurredAt: now }) }
  catch (e) { return err('NOTIF_ACTIVITY_FAILED', 'Failed to record app activity', e) }
}

export async function recordEntrySaved(now = Date.now()): Promise<Result<void>> {
  try { return await recordNotificationEvent('entry_saved', { occurredAt: now }) }
  catch (e) { return err('NOTIF_ENTRY_EVENT_FAILED', 'Failed to record entry activity', e) }
}

// Foreground receipt means the OS fired the request while the app was open.
  // We do NOT mark the candidate expired here: that decision belongs to the
  // reconciler once the native request is confirmed gone. Marking on receipt
  // would swallow past-time candidates that fired before the user could act.
export async function handleNotificationDelivered(identifier: string): Promise<Result<void>> {
  if (!identifier.startsWith(REQUEST_PREFIX)) return ok(undefined)
  const candidateId = identifier.slice(REQUEST_PREFIX.length)
  return recordNotificationEvent('delivered', { candidateId })
}

export async function recordAndReconcile(
  type: 'app_active' | 'entry_saved',
  reason: NotificationReconcileReason,
  now = Date.now()
): Promise<Result<NotificationReconcileSummary>> {
  const recorded = type === 'app_active' ? await recordAppActive(now) : await recordEntrySaved(now)
  if (!recorded.success) return recorded
  return reconcileNotifications(reason, now)
}

export function reconcileNotifications(
  _reason: NotificationReconcileReason,
  now = Date.now()
): Promise<Result<NotificationReconcileSummary>> {
  if (flight) {
    rerun = true
    return flight
  }
  flight = reconcileOnce(now).catch((cause) => err('NOTIF_RECONCILE_FAILED', 'Notification reconciliation failed', cause)).finally(() => {
    flight = null
    if (rerun) {
      rerun = false
      void reconcileNotifications('resume')
    }
  })
  return flight
}

function safeRoute(route: string): string | null {
  if (route === '/' || route === '/(tabs)' || route === '/digest' || route === '/challenge' || route === '/entry' || route === '/trends') return route
  if (/^\/wiki\/[A-Za-z0-9_-]+$/.test(route)) return route
  return null
}

export async function handleNotificationCandidate(candidateId: string): Promise<Result<string | null>> {
  const candidate = await getCandidate(candidateId)
  if (!candidate.success) return candidate
  if (!candidate.data || candidate.data.expiresAt <= Date.now()) return ok(null)
  const marked = await markCandidateOpened(candidateId)
  if (!marked.success) return marked
  if (!marked.data) return ok(null)
  if (candidate.data.kind === 'insight') {
    const pageId = candidate.data.targetRoute.split('/').pop() ?? ''
    const page = await getPage(pageId)
    if (!page.success || !page.data || page.data.dismissed_at != null || page.data.merged_into != null) return ok(null)
  }
  const route = safeRoute(candidate.data.targetRoute)
  if (!route) return ok(null)
  await recordNotificationEvent('opened', { candidateId, kind: candidate.data.kind })
  return ok(route)
}

export async function scheduleFirstInsightCandidate(pageId: string): Promise<Result<void>> {
  const candidate = await createCandidate({
    kind: 'insight', dedupeKey: `first-insight:${pageId}`, targetRoute: `/wiki/${pageId}`,
    eligibleAt: Date.now(), expiresAt: Date.now() + 7 * 86_400_000, priority: 90,
  })
  if (!candidate.success) return candidate
  // Reconciliation applies permission, caps, collision handling, and stable IDs.
  const result = await reconcileNotifications('insight-ready')
  return result.success ? ok(undefined) : result
}