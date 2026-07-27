export type NotificationKind =
  | 'journal'
  | 'challenge'
  | 'reengagement'
  | 'digest'
  | 'insight'
  | 'momentum'
  | 'pattern'

export type NotificationCategory =
  | 'journal'
  | 'challenge'
  | 'reengagement'
  | 'insights'

export type NotificationPermissionState =
  | 'not-determined'
  | 'provisional'
  | 'granted'
  | 'denied'
  | 'blocked'

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