import type { Env } from '../types'
import {
  DELTA_PAGE_SIZE,
  MAX_UPLOAD_BODY_LENGTH,
  decodeDeltaCursor,
  encodeDeltaCursor,
  isTimestamp,
  parseStoredEnvelope,
  parseSyncObjectKey,
} from './protocol'

interface DeltaRecordV2 {
  version: 2
  table: string
  sync_id: string
  ciphertext: string
  updated_at: number
}

interface DeltaRecordV1 {
  version: 1
  table: string
  record_id: string
  ciphertext: string
  updated_at: number
}

/** GET /sync/{accountId}/delta?since={ts}&cursor={opaque} — bounded R2 page. */
export async function handleDelta(
  _req: Request,
  env: Env,
  accountId: string,
  url: URL
): Promise<Response> {
  const rawSince = url.searchParams.get('since') ?? '0'
  const since = Number(rawSince)
  if (!/^\d+$/.test(rawSince) || !isTimestamp(since, Date.now(), false)) {
    return new Response('Bad Request', { status: 400 })
  }

  const decodedCursor = decodeDeltaCursor(url.searchParams.get('cursor'))
  if (decodedCursor === null) return new Response('Bad Request', { status: 400 })

  const listOptions = {
    prefix: `${accountId}/`,
    include: ['customMetadata'],
    limit: DELTA_PAGE_SIZE,
    cursor: decodedCursor,
  } as unknown as Parameters<typeof env.R2.list>[0]
  const listed = await env.R2.list(listOptions)

  const records: (DeltaRecordV1 | DeltaRecordV2)[] = []
  let skipped = 0
  for (const object of listed.objects) {
    const parsedKey = parseSyncObjectKey(object.key, accountId)
    const metadataTimestamp = Number(object.customMetadata?.updated_at)
    if (
      !parsedKey ||
      !isTimestamp(metadataTimestamp, Date.now(), false) ||
      object.size > MAX_UPLOAD_BODY_LENGTH
    ) {
      skipped++
      continue
    }
    if (metadataTimestamp <= since) continue

    try {
      const stored = await env.R2.get(object.key)
      if (!stored) {
        skipped++
        continue
      }
      const envelope = parseStoredEnvelope(await stored.json<unknown>())
      if (!envelope || envelope.updated_at !== metadataTimestamp) {
        skipped++
        continue
      }
      if (parsedKey.syncId) {
        records.push({
          version: 2,
          table: parsedKey.table,
          sync_id: parsedKey.syncId,
          ...envelope,
        })
      } else if (parsedKey.recordId) {
        records.push({
          version: 1,
          table: parsedKey.table,
          record_id: parsedKey.recordId,
          ...envelope,
        })
      }
    } catch {
      skipped++
    }
  }

  // Count only. Never log object keys, record IDs, ciphertext, or persisted bodies.
  if (skipped > 0) console.warn(`sync_delta_skipped count=${skipped}`)

  return Response.json({
    records,
    next_cursor: listed.truncated && listed.cursor ? encodeDeltaCursor(listed.cursor) : null,
  })
}