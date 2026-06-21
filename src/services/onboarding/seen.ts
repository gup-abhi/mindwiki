import * as SecureStore from 'expo-secure-store'

// Whether the one-time welcome tour has been shown on this device. Per-device
// (not per-account) and survives logout — a returning user shouldn't re-watch
// it. Stored in the keystore alongside the other device flags; no DB access.
const KEY = 'mindwiki.onboarding_seen'

export async function hasSeenOnboarding(): Promise<boolean> {
  try {
    return (await SecureStore.getItemAsync(KEY)) === '1'
  } catch {
    return false
  }
}

export async function markOnboardingSeen(): Promise<void> {
  try {
    await SecureStore.setItemAsync(KEY, '1')
  } catch {
    // Non-fatal: worst case the tour shows again next launch.
  }
}
