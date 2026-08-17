import { hash } from 'bcryptjs'

import type { Env } from '../types'
import { parseRecoveryBody, readJsonBody } from '../validation/request'

/**
 * Whether the account has a recovery phrase configured. Lets the client show a
 * "set up recovery" nudge to accounts that registered before recovery existed.
 * Authenticated route: accountId comes from the access token.
 */
export async function handleRecoveryStatus(
  _req: Request,
  env: Env,
  accountId: string
): Promise<Response> {
  const recovery = (await env.AUTH_KV.get(`recovery:${accountId}`, 'json')) as {
    recovery_bcrypt: string
    encrypted_key: string
    status?: 'pending_ack' | 'active'
  } | null
  return Response.json({ configured: recovery !== null, status: recovery?.status ?? 'active' })
}

/**
 * Set (or rotate) the recovery phrase for the current account. Stores the
 * bcrypted recovery credential + the master key wrapped under the phrase. The
 * master key is supplied by the client (it never leaves the device unwrapped),
 * so this works only for a logged-in device that holds the key.
 */
export async function handleSetRecovery(
  req: Request,
  env: Env,
  accountId: string
): Promise<Response> {
  const body = parseRecoveryBody(await readJsonBody(req))
  if (!body) return new Response('Invalid request body', { status: 400 })

  const recoveryBcrypt = await hash(body.recovery_hash, 12)
  await env.AUTH_KV.put(
    `recovery:${accountId}`,
    JSON.stringify({
      recovery_bcrypt: recoveryBcrypt,
      encrypted_key: body.recovery_escrow.encrypted_key,
      status: 'active',
      updated_at: Date.now(),
    })
  )
  return new Response(null, { status: 204 })
}
