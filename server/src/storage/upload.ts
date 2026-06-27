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

  const key = `${accountId}/${body.table}/${body.record_id}`

  // Last-write-wins guard: never let an older write overwrite a newer stored
  // record. Without it a device re-uploading a stale copy it pulled (e.g. an
  // entry captured before a background tagging pass updated it) moves the record
  // backwards and silently discards the newer state. Ack as success so the client
  // still marks it synced and stops retrying.
  const existing = await env.R2.head(key)
  const stored = Number(existing?.customMetadata?.updated_at ?? 0)
  if (body.updated_at < stored) {
    return new Response('OK', { status: 200 })
  }

  await env.R2.put(
    key,
    JSON.stringify({ ciphertext: body.ciphertext, updated_at: body.updated_at }),
    { customMetadata: { updated_at: String(body.updated_at) } }
  )

  return new Response('OK', { status: 200 })
}
