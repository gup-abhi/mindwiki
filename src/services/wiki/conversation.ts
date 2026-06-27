import { converseFromWiki, summarizeConversation } from '@/services/llm/deep-model'
import { expandQueryTerms } from '@/services/llm/fast-model'
import { type ConversationContext } from '@/services/llm/prompts/conversation'
import { graphNeighborhood } from '@/services/graph/neighborhood'
import { setConversationSummary } from '@/services/storage/chat'
import { type GraphNode, type GraphEdge } from '@/services/storage/graph'
import { type WikiPage } from '@/services/storage/wiki'
import { type ChatMessage } from '@/native/LLMBridge'
import { type Result, ok } from '@/types/result'

import { rankPages, rankPagesHybrid, queryTerms, type QueryEmbeddings } from './search'
import { buildQueryEmbeddings } from './embeddings'

export interface ConversationReply {
  text: string
  /** Pages the reply was grounded in (for source chips). */
  sources: WikiPage[]
}

export interface RespondInput {
  /** Prior turns (user/assistant), oldest first. Trimmed internally. */
  history: ChatMessage[]
  /** The newest user message. */
  message: string
  pages: WikiPage[]
  nodes: GraphNode[]
  edges: GraphEdge[]
  /** Rolling recap of earlier turns that fell out of the recent window. */
  summary?: string
}

// Keep the prompt inside the deep model's n_ctx (2048): cap retrieved pages,
// truncate each page's content, and keep only the most recent turns.
const MAX_PAGES = 3
const MAX_PAGE_CHARS = 600
const MAX_HISTORY_MESSAGES = 8 // ~4 user/assistant turns
const MAX_CONNECTION_PAGES = 2
const MAX_NEIGHBORS = 3
// Only ground in a page the message genuinely points to. rankPages scores a
// title-term match at 5 and each content hit at 1 (+≤1 richness), so an
// incidental single word (~1) falls below this floor while a title match or
// real content overlap clears it. Without it the model force-links every
// message to whatever page shares one common word.
const MIN_RELEVANCE = 3
// Recent USER turns folded into the ranking query so a terse latest message
// ("ugh, again") still carries the thread's signal. User turns only — assistant
// text would bias retrieval toward wiki content we already injected.
const RETRIEVAL_TURNS = 2

/** The text to rank pages against: the last few user turns plus the new message. */
function retrievalQuery(history: ChatMessage[], message: string): string {
  const recentUser = history
    .filter((m) => m.role === 'user')
    .slice(-RETRIEVAL_TURNS)
    .map((m) => m.content)
  return [...recentUser, message].join(' ')
}

/** Fast-model query expansion as a best-effort list — [] if the model is missing
 * or the call fails, so retrieval still runs on graph + embeddings + lexical. */
async function modelExpansion(query: string): Promise<string[]> {
  const res = await expandQueryTerms(query)
  return res.success ? res.data : []
}

// Cap how many associative terms the graph can add, so a hub node with many
// edges can't flood the query and drown the message's own words.
const MAX_EXPANSION_TERMS = 5

/**
 * Widen the ranking query with associative terms from the user's graph. For each
 * graph node the message actually names, add its strongest 1-hop neighbours'
 * labels — so in a dense graph a message can ground in pages about *connected*
 * themes it shares no words with ("my boss again" → also rank a "Criticism"
 * page). Lexical-only by design: the embedding query stays the literal message
 * (semantics are already covered there); this only widens term overlap. Pure.
 */
function expandWithGraph(query: string, nodes: GraphNode[], edges: GraphEdge[]): string {
  const terms = new Set(queryTerms(query))
  if (terms.size === 0 || nodes.length === 0) return query

  // Nodes the query names: every meaningful token of the label is present (so a
  // multi-word label only matches when fully referenced — avoids over-expanding).
  const named = nodes.filter((n) => {
    const labelTokens = queryTerms(n.label)
    return labelTokens.length > 0 && labelTokens.every((t) => terms.has(t))
  })
  if (named.length === 0) return query

  const byFreq = new Map<string, number>() // neighbour label → frequency (ranks it)
  for (const node of named) {
    const hood = graphNeighborhood(node.label, nodes, edges, 1)
    if (!hood) continue
    for (const nb of hood.neighbors) {
      const nbTokens = queryTerms(nb.label)
      if (nbTokens.length === 0 || nbTokens.every((t) => terms.has(t))) continue // already implied
      byFreq.set(nb.label, Math.max(byFreq.get(nb.label) ?? 0, nb.frequency))
    }
  }

  const expansion = [...byFreq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_EXPANSION_TERMS)
    .map(([label]) => label)

  return expansion.length ? `${query} ${expansion.join(' ')}` : query
}

function connectionLine(title: string, nodes: GraphNode[], edges: GraphEdge[]): string | null {
  const hood = graphNeighborhood(title, nodes, edges, 1)
  if (!hood || hood.neighbors.length === 0) return null
  const top = [...hood.neighbors]
    .sort((a, b) => b.frequency - a.frequency)
    .slice(0, MAX_NEIGHBORS)
    .map((n) => n.label)
  return `${title} often comes up with ${top.join(', ')}.`
}

/**
 * Build the grounded context for one turn: rank wiki pages against the recent
 * thread (last few user turns + the new message) and pull short graph-connection
 * lines for the top pages. Pure — the caller supplies pages and graph. When
 * `embeddings` is provided, ranking is hybrid (lexical + semantic); otherwise it
 * falls back to pure lexical. Returns the context for the prompt plus the source
 * pages (for citation chips).
 */
export function buildContext(
  message: string,
  pages: WikiPage[],
  nodes: GraphNode[],
  edges: GraphEdge[],
  history: ChatMessage[] = [],
  embeddings?: QueryEmbeddings,
  expansionTerms: string[] = []
): { context: ConversationContext; sources: WikiPage[] } {
  const baseQuery = retrievalQuery(history, message)
  // Both expansions feed the LEXICAL query only — graph (associative neighbours)
  // and HyDE (fast-model alternate keywords). embeddings.query (built from the
  // literal message in respond) is intentionally left as-is.
  const graphExpanded = expandWithGraph(baseQuery, nodes, edges)
  const rankQuery = expansionTerms.length
    ? `${graphExpanded} ${expansionTerms.join(' ')}`
    : graphExpanded
  const ranked = embeddings
    ? rankPagesHybrid(rankQuery, pages, embeddings, MAX_PAGES)
    : rankPages(rankQuery, pages, MAX_PAGES)
  const sources = ranked.filter((r) => r.score >= MIN_RELEVANCE).map((r) => r.page)

  const connections: string[] = []
  for (const page of sources.slice(0, MAX_CONNECTION_PAGES)) {
    const line = connectionLine(page.title, nodes, edges)
    if (line) connections.push(line)
  }

  const context: ConversationContext = {
    sources: sources.map((p) => ({
      title: p.title,
      content: p.content.slice(0, MAX_PAGE_CHARS),
    })),
    connections,
  }
  return { context, sources }
}

/**
 * Generate one grounded reflective reply for the conversation. Ranks wiki +
 * graph context for the newest message, trims history to fit the context
 * window, and streams the deep model's tokens to `onToken`. Returns the
 * validated reply text and the pages it was grounded in.
 */
export async function respond(
  { history, message, pages, nodes, edges, summary }: RespondInput,
  onToken?: (token: string) => void
): Promise<Result<ConversationReply>> {
  // Two best-effort retrieval aids, run in PARALLEL so neither stacks latency on
  // the other before the reply: (1) embed the query for semantic ranking, (2) ask
  // the fast model for alternate keywords (HyDE) to widen lexical ranking. Either
  // failing (model missing, etc.) just drops that aid — never blocks the reply.
  const q = retrievalQuery(history, message)
  const [embeddings, expansionTerms] = await Promise.all([
    buildQueryEmbeddings(q),
    modelExpansion(q),
  ])
  const { context, sources } = buildContext(
    message,
    pages,
    nodes,
    edges,
    history,
    embeddings ?? undefined,
    expansionTerms
  )
  const trimmed = history.slice(-MAX_HISTORY_MESSAGES)

  const res = await converseFromWiki({ history: trimmed, message, context, summary }, onToken)
  if (!res.success) return res

  return ok({ text: res.data, sources })
}

export interface SummaryState {
  summary: string
  summaryCount: number
}

/**
 * Fold the turns that have just fallen out of the recent window into the
 * conversation's rolling recap, and persist it. `messages` is the full thread
 * (oldest first); only messages past the last MAX_HISTORY_MESSAGES that aren't
 * yet covered get summarized. Returns the new state, or null when nothing new
 * fell out. Background, best-effort — errors carry a code only, never text.
 */
export async function updateRunningSummary(
  conversationId: string,
  messages: ChatMessage[],
  current: SummaryState
): Promise<Result<SummaryState | null>> {
  const target = messages.length - MAX_HISTORY_MESSAGES
  if (target <= current.summaryCount) return ok(null) // recent window still covers everything older

  const evicted = messages.slice(current.summaryCount, target)
  const res = await summarizeConversation(current.summary, evicted)
  if (!res.success) return res

  const next: SummaryState = { summary: res.data, summaryCount: target }
  await setConversationSummary(conversationId, next.summary, next.summaryCount)
  return ok(next)
}
