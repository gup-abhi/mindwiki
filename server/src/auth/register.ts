import { hash } from 'bcryptjs'

import type { Env } from '../types'
import { parseRegisterBody, readJsonBody } from '../validation/request'
import { coordinatorRequest } from './coordinator'
import { issueTokens } from './tokens'
import { recordPairedDevice } from './devices'

export async function handleRegister(req: Request, env: Env): Promise<Response> {
  const body = parseRegisterBody(await readJsonBody(req))
  if (!body) return new Response('Invalid request body', { status: 400 })

  const email = body.email

  const accountId = crypto.randomUUID()
  const coordinated = await coordinatorRequest(env.AUTH_COORDINATOR, `email:${email}`, {
    operation: 'reserve_email',
    account_id: accountId,
  })
  if (coordinated?.status === 'exists') return new Response('Email already registered', { status: 409 })
  if (env.AUTH_COORDINATOR && !coordinated) return new Response('Authentication temporarily unavailable', { status: 503 })
  if (!env.AUTH_COORDINATOR) {
    const existing = await env.AUTH_KV.get(`email:${email}`)
    if (existing) return new Response('Email already registered', { status: 409 })
  }

  try {
    const passwordBcrypt = await hash(body.password_hash, 12)
    const recoveryBcrypt = await hash(body.recovery_hash, 12)
    const now = Date.now()

    await env.AUTH_KV.put(
      `account:${accountId}`,
      JSON.stringify({ email, password_bcrypt: passwordBcrypt, created_at: now, trial_started_at: now })
    )
    await env.AUTH_KV.put(`email:${email}`, JSON.stringify({ account_id: accountId }))
    await env.AUTH_KV.put(
      `escrow:${accountId}`,
      JSON.stringify({
        encrypted_key: body.key_escrow.encrypted_key,
        salt: body.key_escrow.salt,
        updated_at: now,
      })
    )
    await env.AUTH_KV.put(
      `recovery:${accountId}`,
      JSON.stringify({
        recovery_bcrypt: recoveryBcrypt,
        encrypted_key: body.recovery_escrow.encrypted_key,
        status: 'pending_ack',
        updated_at: now,
      })
    )

    const { accessToken, refreshToken, familyId } = await issueTokens(accountId, env)
    await recordPairedDevice(
      env,
      accountId,
      body.device_label ?? 'New device',
      body.platform ?? 'unknown',
      body.device_id,
      familyId
    )

    return Response.json({
      account_id: accountId,
      access_token: accessToken,
      refresh_token: refreshToken,
      status: 'pending_ack',
    })
  } catch (error) {
    await coordinatorRequest(env.AUTH_COORDINATOR, `email:${email}`, {
      operation: 'release_email',
      account_id: accountId,
    })
    throw error
  }
}
