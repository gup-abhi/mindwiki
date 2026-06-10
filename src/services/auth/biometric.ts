import * as LocalAuthentication from 'expo-local-authentication'
import * as SecureStore from 'expo-secure-store'

// App-lock preference. Default ON (see isLockEnabled) — the user can turn it off
// in Settings. Stored as '1'/'0'; not a secret, but SecureStore is already a dep
// and keeps it off AsyncStorage.
const LOCK_ENABLED_KEY = 'biometric_lock_enabled'

/**
 * Whether the device can actually authenticate the user — biometrics enrolled OR
 * a device PIN/passcode set. If NONE, locking would be a permanent lockout, so
 * the gate treats the lock as off regardless of preference.
 */
export async function canAuthenticate(): Promise<boolean> {
  try {
    const level = await LocalAuthentication.getEnrolledLevelAsync()
    return level !== LocalAuthentication.SecurityLevel.NONE
  } catch {
    return false
  }
}

/**
 * Prompt for biometric (or device PIN/passcode) auth. Returns true on success.
 * Device-credential fallback stays enabled so users without enrolled biometrics
 * can still unlock. Never throws — a thrown/denied prompt is just `false`.
 */
export async function authenticate(reason: string): Promise<boolean> {
  try {
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: reason,
      cancelLabel: 'Cancel',
      disableDeviceFallback: false,
    })
    return result.success
  } catch {
    return false
  }
}

/** App-lock preference, defaulting ON when never set. */
export async function isLockEnabled(): Promise<boolean> {
  try {
    const v = await SecureStore.getItemAsync(LOCK_ENABLED_KEY)
    return v === null ? true : v === '1'
  } catch {
    return true
  }
}

export async function setLockEnabled(enabled: boolean): Promise<void> {
  try {
    await SecureStore.setItemAsync(LOCK_ENABLED_KEY, enabled ? '1' : '0')
  } catch {
    // best-effort; preference persistence failing shouldn't crash the app
  }
}
