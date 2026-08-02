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

/**
 * Metadata-only, count-only audit. Never returns/logs object keys, record IDs,
 * ciphertext, or bodies. No delete/quarantine operation exists here; production
 * mutation requires separate explicit operational approval after this dry run.
 */
export async function handleSyncAudit(
  env: Env,
  accountId: string,
  url: URL
): Promise<Response> {
  if (url.searchParams.get('dry_run') !== 'true') {
    return new Response('Dry run required', { status: 400 })
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

  let valid = 0
  let invalidKey = 0
  let invalidMetadata = 0
  let oversized = 0
  let missing = 0
  let invalidEnvelope = 0
  let timestampMismatch = 0

  for (const object of listed.objects) {
    if (!parseSyncObjectKey(object.key, accountId)) {
      invalidKey++
      continue
    }
    const metadataTimestamp = Number(object.customMetadata?.updated_at)
    if (!isTimestamp(metadataTimestamp, Date.now(), false)) {
      invalidMetadata++
      continue
    }
    if (object.size > MAX_UPLOAD_BODY_LENGTH) {
      oversized++
      continue
    }
    try {
      const stored = await env.R2.get(object.key)
      if (!stored) {
        missing++
        continue
      }
      const envelope = parseStoredEnvelope(await stored.json<unknown>())
      if (!envelope) {
        invalidEnvelope++
        continue
      }
      if (envelope.updated_at !== metadataTimestamp) {
        timestampMismatch++
        continue
      }
      valid++
    } catch {
      invalidEnvelope++
    }
  }

  return Response.json({
    dry_run: true,
    scanned: listed.objects.length,
    valid,
    invalid: {
      key: invalidKey,
      metadata: invalidMetadata,
      oversized,
      missing,
      envelope: invalidEnvelope,
      timestamp_mismatch: timestampMismatch,
    },
    next_cursor: listed.truncated && listed.cursor ? encodeDeltaCursor(listed.cursor) : null,
  })
}