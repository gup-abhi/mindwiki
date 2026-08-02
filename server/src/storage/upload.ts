import type { Env } from '../types'
import {
  MAX_UPLOAD_BODY_LENGTH,
  isServerSyncTable,
  parseUploadEnvelope,
  syncObjectKey,
} from './protocol'

function parseV2Path(path: string, accountId: string): { table: string; syncId: string } | null {
  const parts = path.split('/')
  if (parts.length !== 6 || parts[1] !== 'sync' || parts[3] !== 'v2') return null
  let pathAccount: string
  try {
    pathAccount = decodeURIComponent(parts[2])
  } catch {
    return null
  }
  if (pathAccount !== accountId || !isServerSyncTable(parts[4]) || !parts[5]) return null
  return { table: parts[4], syncId: parts[5] }
}

type BodyRead =
  | { ok: true; value: unknown }
  | { ok: false; status: 400 | 413 }

async function readBoundedJson(req: Request): Promise<BodyRead> {
  const declared = req.headers.get('Content-Length')
  if (declared) {
    const length = Number(declared)
    if (!Number.isSafeInteger(length) || length < 0) return { ok: false, status: 400 }
    if (length > MAX_UPLOAD_BODY_LENGTH) return { ok: false, status: 413 }
  }
  if (!req.body) return { ok: false, status: 400 }

  const reader = req.body.getReader()
  const chunks: Uint8Array[] = []
  let length = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      length += value.byteLength
      if (length > MAX_UPLOAD_BODY_LENGTH) {
        await reader.cancel()
        return { ok: false, status: 413 }
      }
      chunks.push(value)
    }
  } catch {
    return { ok: false, status: 400 }
  } finally {
    reader.releaseLock()
  }

  const bytes = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  try {
    return { ok: true, value: JSON.parse(new TextDecoder().decode(bytes)) as unknown }
  } catch {
    return { ok: false, status: 400 }
  }
}

/** PUT /sync/{accountId}/v2/{table}/{syncId} — store ciphertext only. */
export async function handleUpload(
  req: Request,
  env: Env,
  accountId: string,
  path: string
): Promise<Response> {
  const parsedPath = parseV2Path(path, accountId)
  if (!parsedPath) return new Response('Bad Request', { status: 400 })

  const contentType = req.headers.get('Content-Type')?.split(';', 1)[0].trim().toLowerCase()
  if (contentType !== 'application/json') return new Response('Unsupported Media Type', { status: 415 })

  const declared = Number(req.headers.get('Content-Length') ?? 0)
  if (declared > MAX_UPLOAD_BODY_LENGTH) return new Response('Payload Too Large', { status: 413 })

  const read = await readBoundedJson(req)
  if (!read.ok) {
    return new Response(read.status === 413 ? 'Payload Too Large' : 'Bad Request', {
      status: read.status,
    })
  }
  const body = parseUploadEnvelope(read.value)
  if (!body || body.table !== parsedPath.table || body.sync_id !== parsedPath.syncId) {
    return new Response('Bad Request', { status: 400 })
  }

  const key = syncObjectKey(accountId, body.table, body.sync_id)
  const existing = await env.R2.head(key)
  const rawStored = existing?.customMetadata?.updated_at
  if (rawStored !== undefined) {
    const stored = Number(rawStored)
    if (!Number.isSafeInteger(stored) || stored < 0) {
      // Do not overwrite an object with malformed metadata. It needs dry-run audit.
      return new Response('Conflict', { status: 409 })
    }
    if (body.updated_at < stored) return new Response('OK', { status: 200 })
  }

  await env.R2.put(
    key,
    JSON.stringify({ ciphertext: body.ciphertext, updated_at: body.updated_at }),
    { customMetadata: { updated_at: String(body.updated_at) } }
  )

  return new Response('OK', { status: 200 })
}