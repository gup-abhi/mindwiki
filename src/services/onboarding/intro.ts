import * as SecureStore from 'expo-secure-store'

// Install-level because the product introduction runs before an account and its
// encrypted database exist. It intentionally survives logout, like the device ID.
const INTRO_ONBOARDING_DONE = 'mindwiki.intro_onboarding_done'

/** Best-effort: a read failure safely re-shows the introduction. */
export async function isIntroOnboardingDone(): Promise<boolean> {
  try {
    return (await SecureStore.getItemAsync(INTRO_ONBOARDING_DONE)) === '1'
  } catch {
    return false
  }
}

/** Best-effort: the current session still advances if persistence fails. */
export async function markIntroOnboardingDone(): Promise<void> {
  try {
    await SecureStore.setItemAsync(INTRO_ONBOARDING_DONE, '1')
  } catch {
    // The introduction may reappear next launch; never block account access.
  }
}
