import { Platform } from 'react-native'
import * as Device from 'expo-device'

import { CryptoModule } from '@/native/CryptoModule'
import { authenticatedFetch } from '@/services/auth/api-client'
import { API_URL } from '@/services/auth/config'
import { getDeviceId } from '@/services/auth/device-id'
import { saveTokens } from '@/services/auth/token-store'
import { useAuthStore } from '@/store/auth.store'
import { type Result, ok, err } from '@/types/result'

/**
 * A label for this device in the owner's pairing log. Prefer the hardware model
 * (e.g. "iPhone 15 Pro", "Pixel 7") over the user-editable device name.
 */
function deviceLabel(): string {
  return Device.modelName || Device.deviceName || `${Platform.OS} device`
}

interface PairingPayload {
  v: 1
  code: string // one-time server pairing code
  key: string // master key hex — travels device→device only, never to the server
}

export function encodePairingPayload(p: PairingPayload): string {
  return JSON.stringify(p)
}

/** Parse + validate a scanned QR string. Rejects anything that isn't our payload. */
export function parsePairingPayload(raw: string): Result<PairingPayload> {
  try {
    const p = JSON.parse(raw) as Partial<PairingPayload>
    if (
      p.v !== 1 ||
      typeof p.code !== 'string' ||
      typeof p.key !== 'string' ||
      !/^[0-9a-f]{64}$/i.test(p.key)
    ) {
      return err('PAIR_INVALID_QR', 'Not a valid pairing code')
    }
    return ok({ v: 1, code: p.code, key: p.key })
  } catch {
    return err('PAIR_INVALID_QR', 'Not a valid pairing code')
  }
}

/**
 * Device A (authenticated): mint a one-time pairing code and bundle it with the
 * master key into a QR payload. The key is read from this device's keychain and
 * never sent to the server — it only travels to device B via the QR.
 */
export async function startPairing(): Promise<Result<string>> {
  try {
    const masterKey = await CryptoModule.getKeyFromKeychain()
    const res = await authenticatedFetch('/auth/pair/start', { method: 'POST' })
    if (!res.success) return res
    if (!res.data.ok) return err('PAIR_START_FAILED', `Pairing failed (${res.data.status})`)
    const data = (await res.data.json()) as { code: string }
    return ok(encodePairingPayload({ v: 1, code: data.code, key: masterKey }))
  } catch (e) {
    return err('PAIR_START_FAILED', 'Pairing failed', e)
  }
}

/**
 * Device B (no session): redeem a scanned QR. Exchanges the one-time code for a
 * session, installs the master key from the QR, and authenticates — after which
 * the encrypted DB opens with the correct key and synced data pulls down.
 */
export async function redeemPairing(raw: string): Promise<Result<{ accountId: string }>> {
  const parsed = parsePairingPayload(raw)
  if (!parsed.success) return parsed
  try {
    const res = await fetch(`${API_URL}/auth/pair/redeem`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // Send a device label + stable id for the owner's pairing log. The master
      // key still never touches the server — it travels only in the QR.
      body: JSON.stringify({
        code: parsed.data.code,
        device_label: deviceLabel(),
        platform: Platform.OS,
        device_id: await getDeviceId(),
      }),
    })
    if (!res.ok) return err('PAIR_REDEEM_FAILED', `Pairing failed (${res.status})`)

    const data = (await res.json()) as {
      account_id: string
      access_token: string
      refresh_token: string
    }
    await CryptoModule.setKeyInKeychain(parsed.data.key)
    await saveTokens({ accessToken: data.access_token, refreshToken: data.refresh_token, accountId: data.account_id })
    useAuthStore.getState().setAuthenticated(data.account_id)
    return ok({ accountId: data.account_id })
  } catch (e) {
    return err('PAIR_REDEEM_FAILED', 'Pairing failed', e)
  }
}
