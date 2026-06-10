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
 * Append a device to the account's pairing log (newest first). Called when a
 * pairing code is redeemed so the original owner can see — and notice — every
 * device that has paired. Label/platform are plaintext account metadata (like the
 * email), never user content, so this is not part of the E2E record sync.
 */
export async function recordPairedDevice(
  env: Env,
  accountId: string,
  label: string,
  platform: string
): Promise<void> {
  const key = `devices:${accountId}`
  const existing = ((await env.AUTH_KV.get(key, 'json')) as PairedDevice[] | null) ?? []
  const entry: PairedDevice = {
    id: crypto.randomUUID(),
    label: label.trim().slice(0, 80) || 'Unknown device',
    platform: platform.trim().slice(0, 20) || 'unknown',
    paired_at: Date.now(),
  }
  const next = [entry, ...existing].slice(0, MAX_DEVICES)
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
