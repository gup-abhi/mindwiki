import type { Env } from '../types'
import { removePairedDevice } from './devices'

/**
 * Sign out (authenticated). Removes this device from the account's paired-devices
 * list so a logged-out device no longer appears. The session itself is dropped
 * client-side (tokens are stateless JWTs); this endpoint only prunes the list.
 */
export async function handleLogout(req: Request, env: Env, accountId: string): Promise<Response> {
  const { device_id } = await req.json<{ device_id?: string }>()
  if (device_id) await removePairedDevice(env, accountId, device_id)
  return new Response(null, { status: 204 })
}
