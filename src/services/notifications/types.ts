export type NotificationKind =
  | 'routine'
  | 'routine-retry'
  | 'weekly-review'
  | 'challenge'
  | 'insight'
  | 'journal'
  | 'reengagement'
  | 'digest'
  | 'momentum'
  | 'pattern'

export type NotificationCategory =
  | 'routine'
  | 'challenge'
  | 'insights'

export type NotificationPermissionState =
  | 'not-determined'
  | 'provisional'
  | 'granted'
  | 'denied'
  | 'blocked'
  | 'unavailable'

export type NotificationCandidateStatus =
  | 'eligible'
  | 'scheduled'
  | 'opened'
  | 'suppressed'
  | 'cancelled'
  | 'expired'

export type NotificationEventType =
  | 'app_active'
  | 'entry_saved'
  | 'delivered'
  | 'scheduled'
  | 'opened'
  | 'suppressed'
  | 'cancelled'

export interface NotificationCandidate {
  id: string
  kind: NotificationKind
  dedupeKey: string
  targetRoute: string
  eligibleAt: number
  expiresAt: number
  priority: number
  scheduledFor?: number
  status?: NotificationCandidateStatus
  reasonCode?: string
}

export interface NotificationEvent {
  id: string
  candidateId?: string
  kind?: NotificationKind
  type: NotificationEventType
  reasonCode?: string
  occurredAt: number
}

export interface NotificationPreferences {
  enabled: boolean
  routineWeekdays?: number[]
  routineHour?: number
  retryDelayMinutes?: 30 | 60 | 120
  pausedUntil: number | null
  firstPlanSavedAt?: number | null
  setupDismissed?: boolean
  challenge: boolean
  insights: boolean
  weeklyReview?: boolean
  weeklyReviewWeekday?: number
  weeklyReviewHour?: number
  journal: boolean
  reengagement: boolean
  momentum: boolean
  patterns: boolean
  quietStartHour: number
  quietEndHour: number
  reminderStartHour: number
  reminderEndHour: number
}

export interface LegacyNotificationPreferences {
  enabled: boolean
  journal: boolean
  challenge: boolean
  reengagement: boolean
  insights: boolean
  momentum: boolean
  patterns: boolean
  quietStartHour: number
  quietEndHour: number
  reminderStartHour: number
  reminderEndHour: number
  pausedUntil: number | null
}

export type NotificationPreferencesInput = NotificationPreferences | LegacyNotificationPreferences

export const LEGACY_NOTIFICATION_KINDS: readonly NotificationKind[] = ['journal', 'reengagement', 'digest', 'momentum', 'pattern']

export const DEFAULT_LEGACY_NOTIFICATION_PREFERENCES: LegacyNotificationPreferences = {
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

export type ReflectionCompletionSource = 'journal' | 'reflect'

export interface ReflectionCompletion {
  id: string
  source: ReflectionCompletionSource
  durableId: string
  completedAt: number
}

export interface ReflectionPlanVersion {
  id: string
  effectiveAt: number
  enabled: boolean
  weekdays: number[]
  hour: number
  retryDelayMinutes: 30 | 60 | 120
  pausedUntil: number | null
}

export type NotificationAction = 'default' | 'reflect'

export const ROUTINE_HOURS = Array.from({ length: 18 }, (_, index) => index + 6)
export const ROUTINE_WEEKDAYS = [0, 1, 2, 3, 4, 5, 6] as const
export const RETRY_DELAYS = [30, 60, 120] as const

export interface NotificationPreferencesV2 extends NotificationPreferences {}

export type NotificationReconcileReason =
  | 'launch'
  | 'resume'
  | 'entry-saved'
  | 'challenge-changed'
  | 'sync'
  | 'preferences'
  | 'timezone'
  | 'insight-ready'
  | 'logout'

export interface NotificationReconcileSummary {
  scheduled: number
  cancelled: number
  suppressed: number
  permission: NotificationPermissionState
}