import { truncateMiddle } from '@/services/llm/prompts/budget'
import { LLMBridge } from '@/native/LLMBridge'
import { type WikiPage } from '@/services/storage/wiki'
import {
  listPageEmbeddings,
  upsertPageEmbedding,
} from '@/services/storage/page-embeddings'
import { type Result, ok, err } from '@/types/result'

import { type QueryEmbeddings } from './search'

// The embedding model's window is small (n_ctx 512 ≈ ~2k chars). Cap the page
// text so a long page doesn't overflow it. The opening carries the gist, but a
// distinctive concept near the end of a long page (a recurring closing ritual,
// a late-developed theme) is exactly what a merge candidate shares — so F-2B
// embeds both HEAD and TAIL of the content, joined by an explicit ellipsis,
// within the same total budget. `truncateMiddle` (from the prompt budget)
// keeps code points whole (surrogate-safe) and gives us the head+tail shape for
// free; we reuse it instead of duplicating the surrogate boundary logic.
const MAX_EMBED_CHARS = 1500

/** Sampling-strategy version baked into the content hash input. When the
 *  strategy changes (e.g. we re-balance head/tail, or include the category
 *  label), bump this so previously-stored hashes mismatch and pages are
 *  re-embedded naturally by the backfill pass. */
export const EMBED_SAMPLING_VERSION = 'v2'

/** The text we embed for a page: its title plus bounded head + tail samples of
 *  the content. Exported for tests + future re-use; callers should treat it as
 *  an opaque strategy string. */
export function embeddedText(page: WikiPage): string {
  return `${page.title}\n${truncateMiddle(page.content, MAX_EMBED_CHARS)}`
}

/** Versioned hash input: the sampling strategy version is part of the payload
 *  so a strategy bump invalidates existing hashes and forces re-embedding
 *  naturally. Not cryptographic — fast sync hash, not expo-crypto. */
function hashableText(page: WikiPage): string {
  return `${EMBED_SAMPLING_VERSION}:${embeddedText(page)}`
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

// EmbeddingGemma requires a task prefix — it was trained with one and omitting it
// degrades vectors. The model card's format for symmetric semantic similarity is
// "task: sentence similarity | query: {text}". We apply it to EVERY embedded
// string (belief labels, page text, queries) so all vectors share one task space;
// that symmetry is what makes cosine between a stored belief and a new one valid.
const EMBED_TASK_PREFIX = 'task: sentence similarity | query: '

/** Embed arbitrary text into a vector. Best-effort — fails if no embed model. */
export async function embedText(text: string): Promise<Result<number[]>> {
  try {
    const vector = await LLMBridge.embed(`${EMBED_TASK_PREFIX}${text}`)
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
  return upsertPageEmbedding(page.id, res.data, contentHash(hashableText(page)))
}

/** Result of a backfill pass: how many pages were (re)embedded and how many
 *  failed. Per-page failures are SWALLOWED — the pass continues past them so a
 *  single transient failure (one page's content trips the embedder) doesn't
 *  block embedding of the rest, and the saved page stays stale for retry. The
 *  NEW sampling strategy means the per-page hash check must include the version
 *  tag, so old vectors become stale naturally. */
export interface BackfillResult {
  embedded: number
  failed: number
}

/** Backfill (re)embed any pages whose stored vector is missing or stale
 *  (content changed since last embedding, or sampling strategy bumped). A
 *  single page's failure is recorded and the pass continues — the next pass
 *  retries that page (its hash still mismatches). Never throws; the caller
 *  stays on lexical ranking on failure. */
export async function backfillStaleEmbeddings(pages: WikiPage[]): Promise<BackfillResult> {
  const stored = await listPageEmbeddings()
  const existing = stored.success ? stored.data : new Map()

  let embedded = 0
  let failed = 0
  for (const page of pages) {
    const hash = contentHash(hashableText(page))
    if (existing.get(page.id)?.contentHash === hash) continue
    const res = await embedPage(page)
    if (res.success) {
      embedded++
    } else {
      // Per-page failure: count it (no titles or content in the result — the
      // error object is dropped, not propagated, so the caller never logs
      // user text) and CONTINUE so the rest of the pass still embeds.
      failed++
    }
  }
  return { embedded, failed }
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
