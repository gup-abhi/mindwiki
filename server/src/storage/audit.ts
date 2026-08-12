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
  const all = url.searchParams.get('all') === 'true'
  const decodedCursor = all ? undefined : decodeDeltaCursor(url.searchParams.get('cursor'))
  if (decodedCursor === null) return new Response('Bad Request', { status: 400 })

  let valid = 0
  let invalidKey = 0
  let invalidMetadata = 0
  let oversized = 0
  let missing = 0
  let invalidEnvelope = 0
  let timestampMismatch = 0
  let scanned = 0
  let cursor = decodedCursor
  let nextCursor: string | null = null

  do {
    const listOptions = {
      prefix: `${accountId}/`,
      include: ['customMetadata'],
      // Count-only full audits are an explicit diagnostic, so reduce requests
      // without exposing any object identity or encrypted body.
      limit: all ? 1_000 : DELTA_PAGE_SIZE,
      cursor,
    } as unknown as Parameters<typeof env.R2.list>[0]
    const listed = await env.R2.list(listOptions)
    scanned += listed.objects.length

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
    const rawCursor = listed.truncated ? listed.cursor : undefined
    nextCursor = rawCursor ? encodeDeltaCursor(rawCursor) : null
    cursor = rawCursor
  } while (all && nextCursor)

  return Response.json({
    dry_run: true,
    complete: all || nextCursor === null,
    scanned,
    valid,
    invalid: {
      key: invalidKey,
      metadata: invalidMetadata,
      oversized,
      missing,
      envelope: invalidEnvelope,
      timestamp_mismatch: timestampMismatch,
    },
    next_cursor: all ? null : nextCursor,
  })
}
