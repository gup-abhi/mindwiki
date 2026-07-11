import type { Env } from '../types'

/** GET /sync/{accountId}/delta?since={ts} — return blobs changed since a timestamp. */
export async function handleDelta(
  req: Request,
  env: Env,
  accountId: string,
  url: URL
): Promise<Response> {
  const since = Number(url.searchParams.get('since') ?? 0)

  // Page through the FULL object list: R2.list caps at 1000 objects per call and
  // returns them in lexicographic key order (accountId/table/recordId), NOT by
  // updated_at. A single un-paginated call only ever sees the first 1000 keys, so
  // on a large account (chat_messages alone can be hundreds) the window is cut off
  // mid-alphabet — later tables (entries, entry_entities, wiki_pages) never appear
  // and a fresh-device restore comes back empty. Loop on the cursor so the since
  // filter is applied across every object, not just the first page.
  // (include customMetadata so updated_at is present — otherwise every object
  // looks like updated_at=0 and drops from the delta.)
  const changed: R2Object[] = []
  let cursor: string | undefined
  do {
    const listed = await env.R2.list({
      prefix: `${accountId}/`,
      include: ['customMetadata'],
      cursor,
    })
    for (const obj of listed.objects) {
      if (Number(obj.customMetadata?.updated_at ?? 0) > since) changed.push(obj)
    }
    cursor = listed.truncated ? listed.cursor : undefined
  } while (cursor)

  const results = await Promise.all(
    changed.map(async (obj) => {
      const body = await env.R2.get(obj.key)
      if (!body) return null
      const record = (await body.json()) as { ciphertext: string; updated_at: number }
      // Expose the key path so the client knows which table/record this is.
      const [, table, recordId] = obj.key.split('/')
      return { table, record_id: recordId, ...record }
    })
  )

  return Response.json(results.filter(Boolean))
}
