import type { Env } from '../types'

interface UploadBody {
  ciphertext: string
  updated_at: number
  record_id: string
  table: SyncTable
}

type SyncTable =
  | 'entries'
  | 'wiki_pages'
  | 'entry_entities'
  | 'conversations'
  | 'chat_messages'
  | 'challenges'
  | 'graph_node_dismissals'
  | 'belief_reframes'
  | 'streak_freezes'

const SYNC_TABLES = new Set<SyncTable>([
  'entries',
  'wiki_pages',
  'entry_entities',
  'conversations',
  'chat_messages',
  'challenges',
  'graph_node_dismissals',
  'belief_reframes',
  'streak_freezes',
])
const MIN_CIPHERTEXT_HEX_LENGTH = (12 + 16) * 2 // AES-GCM nonce + tag
const MAX_CIPHERTEXT_HEX_LENGTH = 4_000_000

function isUploadBody(value: unknown): value is UploadBody {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const body = value as Record<string, unknown>
  if (Object.keys(body).length !== 4) return false
  if (!Object.keys(body).every((key) => key === 'ciphertext' || key === 'updated_at' || key === 'record_id' || key === 'table')) return false
  return (
    typeof body.ciphertext === 'string' &&
    body.ciphertext.length >= MIN_CIPHERTEXT_HEX_LENGTH &&
    body.ciphertext.length <= MAX_CIPHERTEXT_HEX_LENGTH &&
    body.ciphertext.length % 2 === 0 &&
    /^[0-9a-f]+$/i.test(body.ciphertext) &&
    typeof body.updated_at === 'number' &&
    Number.isSafeInteger(body.updated_at) &&
    body.updated_at >= 0 &&
    typeof body.record_id === 'string' &&
    body.record_id.length > 0 &&
    typeof body.table === 'string' &&
    SYNC_TABLES.has(body.table as SyncTable)
  )
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
  if (parts.length !== 5 || !parts[3] || !parts[4]) return new Response('Bad Request', { status: 400 })

  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return new Response('Bad Request', { status: 400 })
  }
  if (!isUploadBody(raw) || raw.table !== parts[3] || raw.record_id !== parts[4]) {
    return new Response('Bad Request', { status: 400 })
  }
  const body = raw

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
