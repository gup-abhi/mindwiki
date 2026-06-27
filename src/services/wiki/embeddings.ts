import { LLMBridge } from '@/native/LLMBridge'
import { type WikiPage } from '@/services/storage/wiki'
import {
  listPageEmbeddings,
  upsertPageEmbedding,
} from '@/services/storage/page-embeddings'
import { type Result, ok, err } from '@/types/result'

import { type QueryEmbeddings } from './search'

// The embedding model's window is small (n_ctx 512 ≈ ~2k chars). Cap the page
// text so a long page doesn't overflow it; the opening of a page carries its
// gist, which is what we're matching on.
const MAX_EMBED_CHARS = 1500

/** The text we embed for a page: its title plus the start of its content. */
function embeddedText(page: WikiPage): string {
  return `${page.title}\n${page.content.slice(0, MAX_EMBED_CHARS)}`
}

/**
 * Tiny deterministic hash (djb2) of the embedded text, so backfill re-embeds a
 * page only when its title/content actually changed. Not cryptographic — pure
 * change-detection — so a fast sync hash is the right tool, not expo-crypto.
 */
export function contentHash(text: string): string {
  let h = 5381
  for (let i = 0; i < text.length; i++) {
    h = ((h << 5) + h + text.charCodeAt(i)) | 0
  }
  return (h >>> 0).toString(36)
}

/** Embed arbitrary text into a vector. Best-effort — fails if no embed model. */
export async function embedText(text: string): Promise<Result<number[]>> {
  try {
    const vector = await LLMBridge.embed(text)
    if (!Array.isArray(vector) || vector.length === 0) {
      return err('EMBED_EMPTY', 'Embedding model returned no vector')
    }
    return ok(vector)
  } catch (e) {
    return err('EMBED_FAILED', 'Failed to embed text', e)
  }
}

/** Embed one wiki page and persist its vector + content hash. */
export async function embedPage(page: WikiPage): Promise<Result<void>> {
  const text = embeddedText(page)
  const res = await embedText(text)
  if (!res.success) return res
  return upsertPageEmbedding(page.id, res.data, contentHash(text))
}

/**
 * Embed any pages whose stored vector is missing or stale (content changed since
 * it was embedded). Background, best-effort: a single page's failure (e.g. the
 * embed model isn't downloaded yet) stops the pass without throwing. Returns how
 * many pages were (re)embedded.
 */
export async function backfillStaleEmbeddings(pages: WikiPage[]): Promise<number> {
  const stored = await listPageEmbeddings()
  const existing = stored.success ? stored.data : new Map()

  let embedded = 0
  for (const page of pages) {
    const hash = contentHash(embeddedText(page))
    if (existing.get(page.id)?.contentHash === hash) continue
    const res = await embedPage(page)
    if (!res.success) break // model unavailable — stop the pass, try again later
    embedded++
  }
  return embedded
}

/**
 * Assemble the inputs the hybrid ranker needs for one turn: the query vector and
 * the stored page vectors. Returns null if embeddings are unavailable for any
 * reason (no embed model, no stored vectors) — the caller then ranks lexically.
 */
export async function buildQueryEmbeddings(query: string): Promise<QueryEmbeddings | null> {
  try {
    const stored = await listPageEmbeddings()
    if (!stored.success || stored.data.size === 0) return null

    const q = await embedText(query)
    if (!q.success) return null

    const byPage = new Map<string, number[]>()
    for (const [id, emb] of stored.data) byPage.set(id, emb.vector)
    return { query: q.data, byPage }
  } catch {
    return null // any failure → lexical fallback; never block the reply
  }
}
