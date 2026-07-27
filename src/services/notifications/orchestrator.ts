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
let suspended = false
let generation = 0

const EMPTY_SUMMARY: NotificationReconcileSummary = {
  scheduled: 0,
  cancelled: 0,
  suppressed: 0,
  permission: 'not-determined',
}

function canContinue(capturedGeneration: number): boolean {
  return !suspended && capturedGeneration === generation && !isWiping()
}

export function suspendNotificationReconciliation(): void {
  suspended = true
  generation++
  rerun = false
}

export function resumeNotificationReconciliation(): void {
  suspended = false
  generation++
}

export async function waitForNotificationReconciliation(timeoutMs = 500): Promise<void> {
  const active = flight
  if (!active) return
  await new Promise<void>((resolve) => {
    let settled = false
    const finish = () => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve()
    }
    const timer = setTimeout(finish, timeoutMs)
    void active.then(finish)
  })
  // A permanently hung native call must not own the singleton forever and
  // block reconciliation for the next authenticated account. Its generation is
  // already invalidated; detaching is safe, and identity checks prevent its
  // eventual completion from clearing a newer flight.
  if (flight === active) flight = null
}

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

async function reconcileOnce(now: number, capturedGeneration: number): Promise<Result<NotificationReconcileSummary>> {
  if (!canContinue(capturedGeneration)) return ok(EMPTY_SUMMARY)
  const permission = await notificationPermissionState()
  if (!canContinue(capturedGeneration)) return ok(EMPTY_SUMMARY)
  const preferences = await getNotificationPreferences()
  if (!canContinue(capturedGeneration)) return ok(EMPTY_SUMMARY)
  if (!preferences.success) return preferences
  // Bound local history before reading it (no-op when nothing is due to prune).
  await pruneNotificationHistory(now)
  if (!canContinue(capturedGeneration)) return ok(EMPTY_SUMMARY)
  let pending: Notifications.NotificationRequest[]
  try { pending = await Notifications.getAllScheduledNotificationsAsync() }
  catch (e) { return err('NOTIF_PENDING_READ_FAILED', 'Failed to read scheduled notifications', e) }
  if (!canContinue(capturedGeneration)) return ok(EMPTY_SUMMARY)
  const existing = pending.filter((item) => isMindWikiRequest(item.identifier))

  if (!preferences.data.enabled || (permission !== 'granted' && permission !== 'provisional')) {
    let cancelled = 0
    for (const item of existing) {
      if (!canContinue(capturedGeneration)) return ok({ scheduled: 0, cancelled, suppressed: 0, permission })
      try { await Notifications.cancelScheduledNotificationAsync(item.identifier); cancelled++ } catch { /* converge next run */ }
    }
    return ok({ scheduled: 0, cancelled, suppressed: 0, permission })
  }

  await configureChannel()
  if (!canContinue(capturedGeneration)) return ok(EMPTY_SUMMARY)
  const activity = await listRecentNotificationEvents(now - 8 * 7 * 86_400_000)
  if (!canContinue(capturedGeneration)) return ok(EMPTY_SUMMARY)
  const recent = activity.success
    ? { ...activity, data: activity.data.filter((event) => event.occurredAt >= now - 7 * 86_400_000) }
    : activity
  const generated = await generateNotificationCandidates(now, activity.success
    ? activity.data.filter((event) => event.type === 'app_active' || event.type === 'entry_saved').map((event) => ({ occurredAt: event.occurredAt }))
    : [])
  if (!canContinue(capturedGeneration)) return ok(EMPTY_SUMMARY)
  const candidates: NotificationCandidate[] = []
  for (const item of generated) {
    if (!canContinue(capturedGeneration)) return ok(EMPTY_SUMMARY)
    const saved = await createCandidate(item)
    if (saved.success) candidates.push(saved.data)
  }
  const stored = await listEligibleCandidates(now)
  if (!canContinue(capturedGeneration)) return ok(EMPTY_SUMMARY)
  if (stored.success) candidates.push(...stored.data.filter((item) => !candidates.some((current) => current.id === item.id)))
  const journaledToday = await hasJournalEntryToday(now)
  if (!canContinue(capturedGeneration)) return ok(EMPTY_SUMMARY)
  const nativeCandidateIds = new Set(
    existing
      .filter((item) => item.identifier.startsWith(REQUEST_PREFIX))
      .map((item) => item.identifier.slice(REQUEST_PREFIX.length))
  )
  // Reconcile DB/native divergence. A scheduled candidate whose native request
  // vanished was delivered/cancelled externally; an expired pending request
  // must be cancelled and terminal too. Neither may be resurrected.
  for (const candidate of candidates) {
    const nativePending = nativeCandidateIds.has(candidate.id)
    if ((candidate.status === 'scheduled' && !nativePending) || candidate.expiresAt <= now) {
      if (candidate.status === 'scheduled' && !nativePending) {
        await recordNotificationEvent('delivered', {
          candidateId: candidate.id,
          kind: candidate.kind,
          occurredAt: candidate.scheduledFor ?? candidate.eligibleAt,
        })
        if (!canContinue(capturedGeneration)) return ok(EMPTY_SUMMARY)
      }
      await markCandidateStatus(candidate.id, 'expired')
      candidate.status = 'expired'
      if (!canContinue(capturedGeneration)) return ok(EMPTY_SUMMARY)
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
      if (!canContinue(capturedGeneration)) return ok({ scheduled: 0, cancelled, suppressed: 0, permission })
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
      if (!canContinue(capturedGeneration)) break
      const nativeIdentifier = await Notifications.scheduleNotificationAsync(input)
      // Suspension may begin while native scheduling is in flight. Cleanup may
      // already have completed by the time it resolves, so cancel this specific
      // late request and never write its scheduled state to the wiped DB.
      if (!canContinue(capturedGeneration)) {
        try { await Notifications.cancelScheduledNotificationAsync(nativeIdentifier) } catch { /* next unauthenticated cleanup retries */ }
        break
      }
      await upsertCandidate({ ...candidate, scheduledFor: candidate.eligibleAt, status: 'scheduled' })
      if (!canContinue(capturedGeneration)) {
        try { await Notifications.cancelScheduledNotificationAsync(nativeIdentifier) } catch { /* next unauthenticated cleanup retries */ }
        break
      }
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
  if (suspended || isWiping()) return Promise.resolve(ok(EMPTY_SUMMARY))
  if (flight) {
    rerun = true
    return flight
  }
  const capturedGeneration = generation
  const active = reconcileOnce(now, capturedGeneration).catch((cause) => err('NOTIF_RECONCILE_FAILED', 'Notification reconciliation failed', cause))
  flight = active
  void active.finally(() => {
    if (flight !== active) return
    flight = null
    if (rerun && !suspended && !isWiping()) {
      rerun = false
      void reconcileNotifications('resume')
    } else {
      rerun = false
    }
  })
  return active
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