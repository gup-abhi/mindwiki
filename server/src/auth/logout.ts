import type { Env } from '../types'
import { revokeDevice } from './devices'

/**
 * Sign a device out (authenticated). Invalidates the device's token family so its
 * session can't refresh, and removes it from the account's paired-devices list.
 * Used both for a device logging itself out and for the owner signing another
 * device out from their device list — the body just names which device by id.
 */
export async function handleLogout(req: Request, env: Env, accountId: string): Promise<Response> {
  const { device_id } = await req.json<{ device_id?: string }>()
  if (device_id) await revokeDevice(env, accountId, device_id)
  return new Response(null, { status: 204 })
}
