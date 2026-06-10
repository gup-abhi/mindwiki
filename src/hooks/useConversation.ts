import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { randomUUID } from 'expo-crypto'
import { useFocusEffect } from 'expo-router'

import { type ChatMessage } from '@/native/LLMBridge'
import { assessMessageCrisis } from '@/services/crisis/message'
import { areModelsReady } from '@/services/llm/model-manager'
import {
  appendMessage,
  createConversation,
  listConversations,
  listMessages,
  type Conversation,
} from '@/services/storage/chat'
import { listEdges, listNodes, type GraphEdge, type GraphNode } from '@/services/storage/graph'
import { listPages, type WikiPage } from '@/services/storage/wiki'
import { respond } from '@/services/wiki/conversation'
import { suggestedQuestions } from '@/services/wiki/query'
import { useChatStore, type UIMessage } from '@/store/chat.store'

const MODELS_MISSING =
  'The on-device AI models aren’t downloaded yet. Tap “Download AI models” on the Home screen, then try again.'

const REPLY_FAILED = 'Something went wrong — please try again.'

/**
 * A supportive, non-clinical reply shown when a message trips the crisis net.
 * The companion does not counsel a crisis; it points to real human support
 * (rendered alongside CRISIS_RESOURCES by the screen).
 */
const CRISIS_REPLY =
  'It sounds like you’re going through something really painful. You deserve support from someone who can be there with you right now — please reach out to one of the resources below.'

/**
 * Reflective conversation: loads wiki + graph context on focus, drives the
 * grounded companion (streaming), checks every user message for crisis, and
 * persists the thread. UI state lives in the chat store so streaming re-renders
 * only the live bubble.
 */
export function useConversation(initialQuestion?: string) {
  const messages = useChatStore((s) => s.messages)
  const streaming = useChatStore((s) => s.streaming)
  const sending = useChatStore((s) => s.sending)

  const [pages, setPages] = useState<WikiPage[]>([])
  const [nodes, setNodes] = useState<GraphNode[]>([])
  const [edges, setEdges] = useState<GraphEdge[]>([])
  const [history, setHistory] = useState<Conversation[]>([])
  const [loaded, setLoaded] = useState(false)

  useFocusEffect(
    useCallback(() => {
      Promise.all([listPages(), listNodes(), listEdges(), listConversations()]).then(
        ([p, n, e, c]) => {
          setPages(p.success ? p.data : [])
          setNodes(n.success ? n.data : [])
          setEdges(e.success ? e.data : [])
          setHistory(c.success ? c.data : [])
          setLoaded(true)
        }
      )
    }, [])
  )

  const send = useCallback(
    async (text: string) => {
      const message = text.trim()
      const store = useChatStore.getState()
      if (!message || store.sending) return

      store.setSending(true)
      store.clearStreaming()

      // Lazily create the conversation on the first message.
      let conversationId = store.conversationId
      if (!conversationId) {
        const created = await createConversation()
        if (!created.success) {
          store.setSending(false)
          return
        }
        conversationId = created.data.id
        store.setConversationId(conversationId)
      }

      // Prior turns become the model's history; capture before adding this turn.
      const priorHistory: ChatMessage[] = store.messages.map((m) => ({
        role: m.role,
        content: m.content,
      }))

      const userMsg: UIMessage = {
        id: randomUUID(),
        role: 'user',
        content: message,
        sources: [],
        crisisTier: null,
      }
      store.addMessage(userMsg)

      // Crisis check runs on every message (keyword net works even if the fast
      // model isn't downloaded). Only an explicit keyword match or very-high
      // model confidence (tier 3) interrupts with support — the fast model's
      // crisis score is noisy on conversational text, so the 0.30–0.60 band
      // (tiers 1–2) would over-trigger here. The reflective reply proceeds
      // normally for everything below.
      const crisis = await assessMessageCrisis(message)
      const isCrisis = crisis.tier >= 3
      await appendMessage({
        conversation_id: conversationId,
        role: 'user',
        content: message,
        crisis_tier: isCrisis ? crisis.tier : null,
      })
      if (isCrisis) {
        store.setMessageCrisis(userMsg.id, crisis.tier)
        const reply: UIMessage = {
          id: randomUUID(),
          role: 'assistant',
          content: CRISIS_REPLY,
          sources: [],
          crisisTier: null,
        }
        store.addMessage(reply)
        await appendMessage({ conversation_id: conversationId, role: 'assistant', content: CRISIS_REPLY })
        store.setSending(false)
        return
      }

      if (!(await areModelsReady())) {
        const reply: UIMessage = {
          id: randomUUID(),
          role: 'assistant',
          content: MODELS_MISSING,
          sources: [],
          crisisTier: null,
        }
        store.addMessage(reply)
        store.setSending(false)
        return
      }

      const res = await respond({ history: priorHistory, message, pages, nodes, edges }, (t) =>
        useChatStore.getState().appendToken(t)
      )

      if (res.success) {
        const sources = res.data.sources.map((p) => ({ id: p.id, title: p.title }))
        const reply: UIMessage = {
          id: randomUUID(),
          role: 'assistant',
          content: res.data.text,
          sources,
          crisisTier: null,
        }
        store.addMessage(reply)
        await appendMessage({
          conversation_id: conversationId,
          role: 'assistant',
          content: res.data.text,
          sources,
        })
      } else {
        store.addMessage({
          id: randomUUID(),
          role: 'assistant',
          content: REPLY_FAILED,
          sources: [],
          crisisTier: null,
        })
      }
      store.clearStreaming()
      store.setSending(false)
    },
    [pages, nodes, edges]
  )

  // Auto-send a question routed in from elsewhere (e.g. the Home "Curious?"
  // card), once, after the wiki/graph context has loaded.
  const askedInitial = useRef(false)
  useEffect(() => {
    if (initialQuestion && loaded && !askedInitial.current) {
      askedInitial.current = true
      send(initialQuestion)
    }
  }, [initialQuestion, loaded, send])

  const newConversation = useCallback(() => useChatStore.getState().reset(), [])

  const loadConversation = useCallback(async (id: string) => {
    const res = await listMessages(id)
    if (!res.success) return
    const ui: UIMessage[] = res.data.map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      sources: m.sources,
      crisisTier: m.crisis_tier,
    }))
    useChatStore.getState().load(id, ui)
  }, [])

  const suggestions = useMemo(() => suggestedQuestions(pages), [pages])

  return { messages, streaming, sending, suggestions, history, send, newConversation, loadConversation }
}
