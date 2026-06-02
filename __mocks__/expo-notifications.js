// Manual mock — expo-notifications is a native module and cannot load in Jest.
// Auto-applied to any test importing the scheduler.
module.exports = {
  SchedulableTriggerInputTypes: { DAILY: 'daily' },
  setNotificationHandler: jest.fn(),
  getPermissionsAsync: jest.fn(async () => ({ granted: false, canAskAgain: true })),
  requestPermissionsAsync: jest.fn(async () => ({ granted: true })),
  scheduleNotificationAsync: jest.fn(async () => 'mindwiki-daily-reminder'),
  cancelScheduledNotificationAsync: jest.fn(async () => undefined),
}
