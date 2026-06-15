import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { randomUUID } from 'expo-crypto'
import { useFocusEffect } from 'expo-router'

import { type ChatMessage } from '@/native/LLMBridge'
import { hasCrisisKeyword } from '@/services/crisis/detector'
import { areModelsReady } from '@/services/llm/model-manager'
import { captureReflectMessage } from '@/services/pipeline'
import {
  appendMessage,
  createConversation,
  findConversationByStarter,
  getConversation,
  listConversations,
  listMessages,
  type Conversation,
} from '@/services/storage/chat'
import { listEdges, listNodes, type GraphEdge, type GraphNode } from '@/services/storage/graph'
import { listPages, type WikiPage } from '@/services/storage/wiki'
import { respond, updateRunningSummary } from '@/services/wiki/conversation'
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
 * Fold any turns that fell out of the model's recent window into the
 * conversation's rolling recap. Works off the persisted thread so the recap
 * (and its coverage count) stay aligned with what a later resume reloads.
 * Background, best-effort.
 */
async function refreshSummary(conversationId: string): Promise<void> {
  const msgs = await listMessages(conversationId)
  if (!msgs.success) return
  const thread: ChatMessage[] = msgs.data.map((m) => ({ role: m.role, content: m.content }))
  const st = useChatStore.getState()
  const upd = await updateRunningSummary(conversationId, thread, {
    summary: st.summary,
    summaryCount: st.summaryCount,
  })
  if (upd.success && upd.data) {
    useChatStore.getState().setSummary(upd.data.summary, upd.data.summaryCount)
  }
}

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

  // The model-reply half of a turn, shared by send and retry: stream the
  // grounded reply and persist it (refreshing the recap), or drop a retryable
  // failure placeholder. Assumes sending is already true and the user message
  // is in the thread.
  const retryRef = useRef<{
    conversationId: string
    message: string
    priorHistory: ChatMessage[]
  } | null>(null)

  const generateReply = useCallback(
    async (conversationId: string, message: string, priorHistory: ChatMessage[]) => {
      const store = useChatStore.getState()
      const res = await respond(
        { history: priorHistory, message, pages, nodes, edges, summary: store.summary },
        (t) => useChatStore.getState().appendToken(t)
      )

      if (res.success) {
        const sources = res.data.sources.map((p) => ({ id: p.id, title: p.title }))
        store.addMessage({
          id: randomUUID(),
          role: 'assistant',
          content: res.data.text,
          sources,
          crisisTier: null,
        })
        await appendMessage({
          conversation_id: conversationId,
          role: 'assistant',
          content: res.data.text,
          sources,
        })
        // Keep the rolling recap current so a long, resumed thread doesn't lose
        // earlier context to the model's window. Background, best-effort.
        void refreshSummary(conversationId)
        retryRef.current = null
      } else {
        store.addMessage({
          id: randomUUID(),
          role: 'assistant',
          content: REPLY_FAILED,
          sources: [],
          crisisTier: null,
          failed: true,
        })
        retryRef.current = { conversationId, message, priorHistory }
      }
      useChatStore.getState().clearStreaming()
      useChatStore.getState().setSending(false)
    },
    [pages, nodes, edges]
  )

  // Re-run the last turn whose reply failed, without re-adding or re-persisting
  // the user message (the failure placeholder is dropped first).
  const retry = useCallback(async () => {
    const pending = retryRef.current
    const store = useChatStore.getState()
    if (!pending || store.sending) return
    store.dropFailed()
    retryRef.current = null
    store.setSending(true)
    store.clearStreaming()
    await generateReply(pending.conversationId, pending.message, pending.priorHistory)
  }, [generateReply])

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

      // Crisis safety net: only an explicit self-harm keyword interrupts with
      // support. The fast model's crisis score is too noisy on conversational
      // text to drive an interruptive UI, so it is deliberately NOT used here
      // (the entry-save flow still runs full model-based detection on journal
      // entries). hasCrisisKeyword is deterministic and high-precision; on a
      // hit we surface support and skip the reply, otherwise the reflective
      // reply proceeds normally.
      const isCrisis = hasCrisisKeyword(message)
      await appendMessage({
        conversation_id: conversationId,
        role: 'user',
        content: message,
        crisis_tier: isCrisis ? 3 : null,
      })
      if (isCrisis) {
        store.setMessageCrisis(userMsg.id, 3)
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

      await generateReply(conversationId, message, priorHistory)

      // Compounding knowledge: capture anything durable the user shared (people,
      // places, themes the wiki hasn't recorded) into the wiki/graph. Background,
      // best-effort — runs after the reply so it never contends with streaming or
      // blocks the UI. Crisis messages returned earlier and are never indexed.
      void captureReflectMessage(message)
    },
    [generateReply]
  )

  const newConversation = useCallback(() => useChatStore.getState().reset(), [])

  const loadConversation = useCallback(async (id: string) => {
    const [res, conv] = await Promise.all([listMessages(id), getConversation(id)])
    if (!res.success) return
    const ui: UIMessage[] = res.data.map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      sources: m.sources,
      crisisTier: m.crisis_tier,
    }))
    const row = conv.success ? conv.data : null
    useChatStore.getState().load(id, ui, row?.summary ?? '', row?.summary_count ?? 0)
  }, [])

  // Tapping a starter reopens its conversation if one already exists (matched by
  // the title it seeded), otherwise it begins a new one.
  const openStarter = useCallback(
    (question: string) => {
      const existing = findConversationByStarter(history, question)
      if (existing) loadConversation(existing.id)
      else send(question)
    },
    [history, loadConversation, send]
  )

  // Auto-open a thread routed in from elsewhere (Home "Curious?" card), once,
  // after the wiki/graph context has loaded, as a user starter. Reopens the
  // existing conversation instead of duplicating.
  const askedInitial = useRef(false)
  useEffect(() => {
    if (loaded && !askedInitial.current && initialQuestion) {
      askedInitial.current = true
      openStarter(initialQuestion)
    }
  }, [initialQuestion, loaded, openStarter])

  const suggestions = useMemo(() => suggestedQuestions(pages), [pages])

  return {
    messages,
    streaming,
    sending,
    suggestions,
    history,
    send,
    retry,
    openStarter,
    newConversation,
    loadConversation,
  }
}
