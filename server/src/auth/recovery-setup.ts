import { hash } from 'bcryptjs'

import type { Env } from '../types'

interface SetRecoveryBody {
  recovery_hash: string // SHA-256(recovery phrase) hex — computed client-side
  recovery_escrow: { encrypted_key: string }
}

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
  const body = await req.json<SetRecoveryBody>()

  if (!body.recovery_hash || body.recovery_hash.length !== 64) {
    return new Response('Invalid recovery_hash', { status: 400 })
  }
  if (!body.recovery_escrow?.encrypted_key) {
    return new Response('Missing recovery_escrow', { status: 400 })
  }

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
