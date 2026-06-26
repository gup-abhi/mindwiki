import type { Env } from '../types'

export interface PairedDevice {
  id: string
  label: string
  platform: string
  paired_at: number
}

// Cap the log so the KV value can't grow unbounded; newest are kept.
const MAX_DEVICES = 50

/**
 * Record a device on the account's log (newest first). Called when a pairing
 * code is redeemed or a device signs in/registers, so the owner can see — and
 * notice — every device on the account. The device sends a stable client id so
 * the same device refreshes its timestamp (and can be removed on logout) instead
 * of appending a duplicate each time; older rows without one fall back to a
 * label+platform match. Label/platform are plaintext account metadata (like the
 * email), never user content, so this is not part of the E2E record sync.
 */
export async function recordPairedDevice(
  env: Env,
  accountId: string,
  label: string,
  platform: string,
  deviceId?: string
): Promise<void> {
  const key = `devices:${accountId}`
  const existing = ((await env.AUTH_KV.get(key, 'json')) as PairedDevice[] | null) ?? []
  const cleanLabel = label.trim().slice(0, 80) || 'Unknown device'
  const cleanPlatform = platform.trim().slice(0, 20) || 'unknown'
  const id =
    deviceId ??
    existing.find((d) => d.label === cleanLabel && d.platform === cleanPlatform)?.id ??
    crypto.randomUUID()
  const entry: PairedDevice = { id, label: cleanLabel, platform: cleanPlatform, paired_at: Date.now() }
  const rest = existing.filter((d) => d.id !== id)
  const next = [entry, ...rest].slice(0, MAX_DEVICES)
  await env.AUTH_KV.put(key, JSON.stringify(next))
}

/**
 * Remove a device from the account's log (called on logout, by its client id).
 * No-op if the id isn't present.
 */
export async function removePairedDevice(env: Env, accountId: string, deviceId: string): Promise<void> {
  const key = `devices:${accountId}`
  const existing = ((await env.AUTH_KV.get(key, 'json')) as PairedDevice[] | null) ?? []
  const next = existing.filter((d) => d.id !== deviceId)
  if (next.length !== existing.length) await env.AUTH_KV.put(key, JSON.stringify(next))
}

/** List the account's paired devices, newest first (authenticated). */
export async function handleListDevices(
  _req: Request,
  env: Env,
  accountId: string
): Promise<Response> {
  const devices =
    ((await env.AUTH_KV.get(`devices:${accountId}`, 'json')) as PairedDevice[] | null) ?? []
  return Response.json({ devices })
}

/** Remove a device from the account's list by id (authenticated). */
export async function handleRemoveDevice(req: Request, env: Env, accountId: string): Promise<Response> {
  const { device_id } = await req.json<{ device_id?: string }>()
  if (device_id) await removePairedDevice(env, accountId, device_id)
  return new Response(null, { status: 204 })
}
