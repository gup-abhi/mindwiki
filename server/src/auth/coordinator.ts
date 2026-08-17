import type { DurableObjectNamespace, DurableObjectState } from '@cloudflare/workers-types'

interface ReservationRequest {
  operation: 'reserve_email' | 'release_email'
  account_id: string
}

interface RefreshRequest {
  operation: 'claim_refresh'
  account_id: string
  family_id: string
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 200
}

function parseRequest(value: unknown): ReservationRequest | RefreshRequest | null {
  if (!value || typeof value !== 'object') return null
  const body = value as Record<string, unknown>
  if (body.operation === 'reserve_email' || body.operation === 'release_email') {
    return isNonEmptyString(body.account_id)
      ? { operation: body.operation, account_id: body.account_id }
      : null
  }
  if (body.operation === 'claim_refresh') {
    return isNonEmptyString(body.account_id) && isNonEmptyString(body.family_id)
      ? {
          operation: body.operation,
          account_id: body.account_id,
          family_id: body.family_id,
        }
      : null
  }
  return null
}

interface ReservationState {
  account_id: string
  released?: boolean
}

interface RefreshState {
  account_id: string
  family_id: string
  used: boolean
}

export type CoordinatorResult =
  | { status: 'reserved' | 'released' | 'claimed' }
  | { status: 'exists' | 'replay'; account_id: string; family_id?: string }

export class AuthCoordinator {
  constructor(private readonly state: DurableObjectState) {}

  async fetch(request: Request): Promise<Response> {
    let body: ReservationRequest | RefreshRequest | null
    try {
      body = parseRequest(await request.json())
    } catch {
      body = null
    }
    if (!body) return Response.json({ status: 'invalid' }, { status: 400 })

    if (body.operation === 'reserve_email') {
      const result = await this.state.storage.transaction(async (storage) => {
        const existing = await storage.get<ReservationState>('reservation')
        if (existing && !existing.released && existing.account_id !== body.account_id) {
          return { status: 'exists', account_id: existing.account_id } satisfies CoordinatorResult
        }
        await storage.put('reservation', { account_id: body.account_id })
        return { status: 'reserved' } satisfies CoordinatorResult
      })
      return Response.json(result)
    }

    if (body.operation === 'release_email') {
      await this.state.storage.transaction(async (storage) => {
        const existing = await storage.get<ReservationState>('reservation')
        if (existing?.account_id === body.account_id) await storage.delete('reservation')
      })
      return Response.json({ status: 'released' } satisfies CoordinatorResult)
    }

    if (body.operation === 'claim_refresh') {
      const result = await this.state.storage.transaction(async (storage) => {
        const existing = await storage.get<RefreshState>('refresh')
        if (existing?.used) {
          return { status: 'replay', account_id: existing.account_id, family_id: existing.family_id } satisfies CoordinatorResult
        }
        await storage.put('refresh', {
          account_id: body.account_id,
          family_id: body.family_id,
          used: true,
        } satisfies RefreshState)
        return { status: 'claimed' } satisfies CoordinatorResult
      })
      return Response.json(result)
    }

    return Response.json({ status: 'invalid' }, { status: 400 })
  }
}

export async function coordinatorRequest(
  namespace: DurableObjectNamespace | undefined,
  name: string,
  body: ReservationRequest | RefreshRequest
): Promise<CoordinatorResult | null> {
  if (!namespace) return null
  const id = namespace.idFromName(name)
  const response = await namespace.get(id).fetch('https://auth-coordinator', {
    method: 'POST',
    body: JSON.stringify(body),
  })
  if (!response.ok) return null
  return await response.json() as CoordinatorResult
}
