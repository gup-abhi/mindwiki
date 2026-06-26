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
 * code is redeemed or a device signs in directly, so the owner can see — and
 * notice — every device on the account. Re-signing in on the same device (label
 * + platform) refreshes its timestamp instead of appending a duplicate (logout
 * wipes local state, so re-login looks like a new device each time). Label/
 * platform are plaintext account metadata (like the email), never user content,
 * so this is not part of the E2E record sync.
 */
export async function recordPairedDevice(
  env: Env,
  accountId: string,
  label: string,
  platform: string
): Promise<void> {
  const key = `devices:${accountId}`
  const existing = ((await env.AUTH_KV.get(key, 'json')) as PairedDevice[] | null) ?? []
  const cleanLabel = label.trim().slice(0, 80) || 'Unknown device'
  const cleanPlatform = platform.trim().slice(0, 20) || 'unknown'
  const prior = existing.find((d) => d.label === cleanLabel && d.platform === cleanPlatform)
  const entry: PairedDevice = {
    id: prior?.id ?? crypto.randomUUID(),
    label: cleanLabel,
    platform: cleanPlatform,
    paired_at: Date.now(),
  }
  const rest = existing.filter((d) => d.id !== entry.id)
  const next = [entry, ...rest].slice(0, MAX_DEVICES)
  await env.AUTH_KV.put(key, JSON.stringify(next))
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
