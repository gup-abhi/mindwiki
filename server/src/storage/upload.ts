import type { Env } from '../types'

interface UploadBody {
  ciphertext: string
  updated_at: number
  record_id: string
  table: string
}

/** PUT /sync/{accountId}/{table}/{recordId} — store an encrypted blob. */
export async function handleUpload(
  req: Request,
  env: Env,
  accountId: string,
  path: string
): Promise<Response> {
  const parts = path.split('/') // ['', 'sync', accountId, table, recordId]
  if (parts[2] !== accountId) return new Response('Forbidden', { status: 403 })

  const body = await req.json<UploadBody>()
  if (!body.ciphertext || !body.record_id || !body.table) {
    return new Response('Bad Request', { status: 400 })
  }

  await env.R2.put(
    `${accountId}/${body.table}/${body.record_id}`,
    JSON.stringify({ ciphertext: body.ciphertext, updated_at: body.updated_at }),
    { customMetadata: { updated_at: String(body.updated_at) } }
  )

  return new Response('OK', { status: 200 })
}
