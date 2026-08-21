import { type NotificationPreferences } from './types'

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
