import type { Env } from '../types'
import { revokeFamily } from './devices'

/**
 * Sign a device out (authenticated). Invalidates the device's token family so its
 * session can't refresh, and removes it from the account's paired-devices list.
 * Used both for a device logging itself out and for the owner signing another
 * device out from their device list — the body just names which device by id.
 */
export async function handleLogout(
  _req: Request,
  env: Env,
  accountId: string,
  familyId: string
): Promise<Response> {
  await revokeFamily(env, accountId, familyId)
  return new Response(null, { status: 204 })
}
