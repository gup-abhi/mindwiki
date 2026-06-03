import type { Env } from '../types'

/** GET /sync/{accountId}/delta?since={ts} — return blobs changed since a timestamp. */
export async function handleDelta(
  req: Request,
  env: Env,
  accountId: string,
  url: URL
): Promise<Response> {
  const since = Number(url.searchParams.get('since') ?? 0)

  // include customMetadata — R2.list omits it by default, which would make
  // every object look like updated_at=0 and drop from the delta.
  const listed = await env.R2.list({ prefix: `${accountId}/`, include: ['customMetadata'] })
  const changed = listed.objects.filter(
    (obj) => Number(obj.customMetadata?.updated_at ?? 0) > since
  )

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
