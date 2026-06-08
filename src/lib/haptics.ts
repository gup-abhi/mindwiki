import * as Haptics from 'expo-haptics'

/** Thin, crash-safe wrapper over expo-haptics. All calls are fire-and-forget. */
export const haptics = {
  light: () => void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined),
  medium: () => void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined),
  success: () =>
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined),
  select: () => void Haptics.selectionAsync().catch(() => undefined),
}
