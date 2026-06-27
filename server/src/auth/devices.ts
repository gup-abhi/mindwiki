import type { Env } from '../types'

export interface PairedDevice {
  id: string
  label: string
  platform: string
  paired_at: number
  // The token family this device's session belongs to. Lets the owner sign the
  // device out remotely (invalidate the family). Never sent to clients.
  family_id?: string
}

// Cap the log so the KV value can't grow unbounded; newest are kept.
const MAX_DEVICES = 50

/**
 * Record a device on the account's log (newest first). Called when a pairing
 * code is redeemed or a device signs in/registers, so the owner can see — and
 * notice — every device on the account. The device sends a stable client id so
 * the same device refreshes its timestamp (and can be signed out remotely)
 * instead of appending a duplicate each time; older rows without one fall back to
 * a label+platform match. Label/platform are plaintext account metadata (like the
 * email), never user content, so this is not part of the E2E record sync.
 */
export async function recordPairedDevice(
  env: Env,
  accountId: string,
  label: string,
  platform: string,
  deviceId?: string,
  familyId?: string
): Promise<void> {
  const key = `devices:${accountId}`
  const existing = ((await env.AUTH_KV.get(key, 'json')) as PairedDevice[] | null) ?? []
  const cleanLabel = label.trim().slice(0, 80) || 'Unknown device'
  const cleanPlatform = platform.trim().slice(0, 20) || 'unknown'
  const id =
    deviceId ??
    existing.find((d) => d.label === cleanLabel && d.platform === cleanPlatform)?.id ??
    crypto.randomUUID()
  const entry: PairedDevice = {
    id,
    label: cleanLabel,
    platform: cleanPlatform,
    paired_at: Date.now(),
    family_id: familyId,
  }
  const rest = existing.filter((d) => d.id !== id)
  const next = [entry, ...rest].slice(0, MAX_DEVICES)
  await env.AUTH_KV.put(key, JSON.stringify(next))
}

/**
 * Sign a device out and drop it from the account's list, by its id. Invalidates
 * the device's token family so its session can't refresh (it's forced back to
 * login when its short-lived access token expires). Used for both self-logout
 * and signing another device out from the owner's device list. No-op if the id
 * isn't present.
 */
export async function revokeDevice(env: Env, accountId: string, deviceId: string): Promise<void> {
  const key = `devices:${accountId}`
  const existing = ((await env.AUTH_KV.get(key, 'json')) as PairedDevice[] | null) ?? []
  const target = existing.find((d) => d.id === deviceId)
  if (target?.family_id) {
    await env.AUTH_KV.put(
      `family:${target.family_id}`,
      JSON.stringify({ account_id: accountId, invalidated: true })
    )
  }
  const next = existing.filter((d) => d.id !== deviceId)
  if (next.length !== existing.length) await env.AUTH_KV.put(key, JSON.stringify(next))
}

/**
 * List the account's paired devices, newest first (authenticated). Strips the
 * internal family_id — clients only need to recognize and sign out devices by id.
 */
export async function handleListDevices(
  _req: Request,
  env: Env,
  accountId: string
): Promise<Response> {
  const stored =
    ((await env.AUTH_KV.get(`devices:${accountId}`, 'json')) as PairedDevice[] | null) ?? []
  const devices = stored.map(({ family_id: _family, ...d }) => d)
  return Response.json({ devices })
}
