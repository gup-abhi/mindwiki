import { converseFromWiki } from '@/services/llm/deep-model'
import { type ConversationContext } from '@/services/llm/prompts/conversation'
import { graphNeighborhood } from '@/services/graph/neighborhood'
import { type GraphNode, type GraphEdge } from '@/services/storage/graph'
import { type WikiPage } from '@/services/storage/wiki'
import { type ChatMessage } from '@/native/LLMBridge'
import { type Result, ok } from '@/types/result'

import { rankPages } from './search'

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
}

// Keep the prompt inside the deep model's n_ctx (2048): cap retrieved pages,
// truncate each page's content, and keep only the most recent turns.
const MAX_PAGES = 3
const MAX_PAGE_CHARS = 600
const MAX_HISTORY_MESSAGES = 8 // ~4 user/assistant turns
const MAX_CONNECTION_PAGES = 2
const MAX_NEIGHBORS = 3

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
 * Build the grounded context for one turn: rank wiki pages against the latest
 * message and pull short graph-connection lines for the top pages. Pure — the
 * caller supplies pages and graph. Returns the context for the prompt plus the
 * source pages (for citation chips).
 */
export function buildContext(
  message: string,
  pages: WikiPage[],
  nodes: GraphNode[],
  edges: GraphEdge[]
): { context: ConversationContext; sources: WikiPage[] } {
  const sources = rankPages(message, pages, MAX_PAGES).map((r) => r.page)

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
  { history, message, pages, nodes, edges }: RespondInput,
  onToken?: (token: string) => void
): Promise<Result<ConversationReply>> {
  const { context, sources } = buildContext(message, pages, nodes, edges)
  const trimmed = history.slice(-MAX_HISTORY_MESSAGES)

  const res = await converseFromWiki({ history: trimmed, message, context }, onToken)
  if (!res.success) return res

  return ok({ text: res.data, sources })
}
