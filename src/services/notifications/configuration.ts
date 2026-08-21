import * as Notifications from 'expo-notifications'

export async function configureNotificationCategories(): Promise<void> {
  try {
    await Notifications.setNotificationCategoryAsync('reflectionroutine', [
      {
        identifier: 'REFLECT',
        buttonTitle: 'Reflect instead',
        options: { opensAppToForeground: true },
      },
    ])
  } catch {
    // Category registration is unavailable on platforms without action support.
  }
}
