import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { randomUUID } from 'expo-crypto'
import { useFocusEffect } from 'expo-router'

import { type ChatMessage } from '@/native/LLMBridge'
import { hasCrisisKeyword, assessCrisis } from '@/services/crisis/detector'
import { scoreSummaryCrisis } from '@/services/llm/fast-model'
import { areModelsReady, ensureEmbedModel } from '@/services/llm/model-manager'
import {
  queueReflectCapture,
  flushReflectCaptures,
  pauseReflectCaptures,
  resumeReflectCaptures,
} from '@/services/pipeline'
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
import { backfillStaleEmbeddings } from '@/services/wiki/embeddings'
import { backfillBeliefEmbeddings } from '@/services/wiki/belief-snap'
import { suggestedQuestions } from '@/services/wiki/query'
import { useChatStore, type UIMessage } from '@/store/chat.store'

const MODELS_MISSING =
  'The on-device AI models aren’t downloaded yet. Tap “Download AI models” on the Home screen, then try again.'

const REPLY_FAILED = 'Something went wrong — please try again.'

// Shown when a resumed thread ends on a user message whose reply never landed
// (the app was closed mid-generation). Reuses the failed-reply retry affordance.
const REPLY_INTERRUPTED = 'This reply didn’t finish. Tap to try again.'

// Module-level generation tracking, surviving screen unmount/remount. Leaving the
// Reflect screen mid-reply does NOT cancel the in-flight generation (the reply
// is valuable and lands asynchronously), so we need to know it is still running
// when the thread is reopened — otherwise loadConversation can't tell "still
// generating" from "died mid-generation" and offers a retry placeholder that,
// when tapped, starts a SECOND generation. Both replies then land → duplicates.
//
// - generationsInFlight: the set of conversations with a live generateReply.
//   loadConversation checks this; a retry while a generation is in flight is a
//   no-op (store.sending is also true, but the flag can be reset by load()).
// - generationEpochs: per-conversation counter. Each generateReply captures its
//   epoch at start; before writing to the store it checks it is still current,
//   so a superseded generation (user retried) neither adds a duplicate message
//   nor clears the newer generation's `sending` flag.
const generationsInFlight = new Set<string>()
const generationEpochs = new Map<string, number>()

function epochOf(conversationId: string): number {
  const next = (generationEpochs.get(conversationId) ?? 0) + 1
  generationEpochs.set(conversationId, next)
  return next
}

function isCurrentEpoch(conversationId: string, epoch: number): boolean {
  return (generationEpochs.get(conversationId) ?? 0) === epoch
}

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
    const { summary, summaryCount } = upd.data
    const store = useChatStore.getState()
    store.setSummary(summary, summaryCount)

    // Soft distress check over the rolling summary, using the fast model. The
    // summary spans many turns, so it can surface cumulative distress that no
    // single message carries an explicit keyword for. Runs once per refresh and
    // never interrupts the conversation — the result only ever soft-surfaces
    // resources via a quiet card in the Reflect screen.
    void scoreSummaryCrisis(summary).then((crisis) => {
      if (!crisis.success) return
      const { tier } = assessCrisis(summary, crisis.data.crisis_confidence)
      if (tier > 0) {
        useChatStore.getState().setSummaryCrisisTier(tier)
      }
    })
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
  const historyRef = useRef(history)
  historyRef.current = history
  const [loaded, setLoaded] = useState(false)

  useFocusEffect(
    useCallback(() => {
      // Live chat takes the deep model: stop any capture drain after its
      // current item so replies don't queue behind the whole backlog.
      pauseReflectCaptures()
      Promise.all([listPages(), listNodes(), listEdges(), listConversations()]).then(
        ([p, n, e, c]) => {
          const pageList = p.success ? p.data : []
          setPages(pageList)
          setNodes(n.success ? n.data : [])
          setEdges(e.success ? e.data : [])
          setHistory(c.success ? c.data : [])
          setLoaded(true)
          // Background, best-effort: make sure the optional embed model is present
          // (covers users already past onboarding) and bring page vectors up to
          // date so semantic ranking has something to match against. Failures are
          // swallowed — Reflect just stays on lexical ranking.
          void ensureEmbedModel().then(() => {
            backfillStaleEmbeddings(pageList)
            backfillBeliefEmbeddings()
          })
        }
      )
      // On blur: the chat is no longer live, so drain the deferred captures —
      // extract + wiki ingest run on the same deep-model lock as replies, which
      // is exactly why they must not run while the user is still chatting.
      return () => {
        resumeReflectCaptures()
        void flushReflectCaptures()
      }
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
      const epoch = epochOf(conversationId)
      generationsInFlight.add(conversationId)
      const store = useChatStore.getState()
      const res = await respond(
        { history: priorHistory, message, pages, nodes, edges, summary: store.summary },
        // Token streaming appends while this generation is both current and on
        // screen. Superseded generations stop streaming so they can't bleed into
        // a newer reply; off-screen ones skip (the reply still persists on done).
        (t) => {
          if (!isCurrentEpoch(conversationId, epoch)) return
          if (useChatStore.getState().conversationId !== conversationId) return
          useChatStore.getState().appendToken(t)
        }
      )

      // A newer generation (retry) superseded this one: drop it entirely. Adding
      // a message or persisting would create the duplicate reply the user is
      // already re-generating against; clearing sending/streaming would clobber
      // the newer turn's live state. Leave the in-flight flag to the winner.
      if (!isCurrentEpoch(conversationId, epoch)) {
        generationsInFlight.delete(conversationId)
        return
      }

      // Whether this generation's conversation is still loaded in the UI.
      // The reply always persists to the DB regardless (it belongs to its
      // conversation), but addMessage/clearStreaming/setSending are UI writes
      // that must not leak into the wrong screen (e.g. the reply landing on
      // the start screen with just the reply and a text field, or on a
      // different conversation's thread).
      const uiOpen = () => useChatStore.getState().conversationId === conversationId

      if (res.success) {
        // Final epoch guard before any state mutation: if the user retried
        // while this generation was running, the retry already started its
        // own epoch and owns the result slot. Writing here would land a
        // duplicate reply on top of the retry's. The retry is responsible
        // for keeping the in-flight set clean.
        if (!isCurrentEpoch(conversationId, epoch)) {
          generationsInFlight.delete(conversationId)
          return
        }

        const sources = res.data.sources.map((p) => ({ id: p.id, title: p.title }))
        await appendMessage({
          conversation_id: conversationId,
          role: 'assistant',
          content: res.data.text,
          sources,
        })
        if (uiOpen()) {
          useChatStore.getState().addMessage({
            id: randomUUID(),
            role: 'assistant',
            content: res.data.text,
            sources,
            crisisTier: null,
          })
          // Keep the rolling recap current so a long, resumed thread doesn't lose
          // earlier context to the model's window. Background, best-effort.
          void refreshSummary(conversationId)
          retryRef.current = null
        }
      } else {
        if (!isCurrentEpoch(conversationId, epoch)) {
          generationsInFlight.delete(conversationId)
          return
        }
        if (uiOpen()) {
          useChatStore.getState().addMessage({
            id: randomUUID(),
            role: 'assistant',
            content: REPLY_FAILED,
            sources: [],
            crisisTier: null,
            failed: true,
          })
          retryRef.current = { conversationId, message, priorHistory }
        }
      }
      if (uiOpen()) {
        useChatStore.getState().clearStreaming()
        useChatStore.getState().setSending(false)
      }
      generationsInFlight.delete(conversationId)
    },
    [pages, nodes, edges]
  )

  // Re-run the last turn whose reply failed, without re-adding or re-persisting
  // the user message (the failure placeholder is dropped first).
  const retry = useCallback(async () => {
    const pending = retryRef.current
    const store = useChatStore.getState()
    // Bail if a generation for this thread is already running (e.g. the user left
    // mid-reply and came back — the original is still going to land). store.sending
    // can be reset by load() during a reopen, so the in-flight set is authoritative.
    if (!pending || store.sending || generationsInFlight.has(pending.conversationId)) return
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
      // Don't start a new turn while one is still generating — serializes against
      // the same in-flight check retry uses, so a second send/different-starter
      // tap during a live reply is a no-op, not a duplicate-spawning race.
      if (!message || store.sending) return
      if (store.conversationId && generationsInFlight.has(store.conversationId)) return

      store.setSending(true)
      store.clearStreaming()
      // Sending a new message supersedes any pending retry: drop a lingering
      // failed/interrupted placeholder so it neither stays orphaned mid-thread
      // nor leaks its text into the model history captured below.
      store.dropFailed()
      retryRef.current = null

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

        // Seed the new conversation with rolling recaps from recent previous
        // conversations, so the companion can follow up across sessions ("last
        // time you were dreading Thursday's review — how did it go?"). Collect
        // up to 3 from the past week (oldest-first, so the model reads them in
        // chronological order); fall back to the last 3 ever if none this week.
        const oneWeekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000
        const candidates = historyRef.current
          .filter((c) => c.id !== conversationId && c.summary.trim().length > 0)
          .sort((a, b) => b.updated_at - a.updated_at)
        const recent = candidates.filter((c) => c.updated_at >= oneWeekAgo)
        const selected = recent.length >= 1 ? recent : candidates
        const top = selected.slice(0, 3).reverse() // oldest-first for prompt ordering
        if (top.length > 0) {
          const combined = top
            .map((c) => `— From a previous conversation —\n${c.summary.trim()}`)
            .join('\n\n')
          const totalCount = top.reduce((acc, c) => acc + c.summary_count, 0)
          store.setSummary(combined, totalCount)
        }
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
      // places, themes the wiki hasn't recorded) into the wiki/graph. Crisis
      // messages returned earlier and are never queued. DEFERRED, not run now:
      // capture shares the deep-model lock with the live reply, so running it
      // mid-chat makes the next reply queue behind an extract (or a full wiki
      // ingest) for tens of seconds. The queue drains on screen blur below.
      // The last few turns go along so the capture's restatement can resolve
      // "it/that/this" in a chat fragment; truncated hard — reference only.
      const captureContext = priorHistory
        .slice(-4)
        .map((m) => `${m.role === 'user' ? 'User' : 'Companion'}: ${m.content.slice(0, 200)}`)
        .join('\n')
      queueReflectCapture(message, captureContext)
    },
    [generateReply]
  )

  const newConversation = useCallback(async () => {
    retryRef.current = null
    useChatStore.getState().reset()
    // Refresh the conversation list so a just-ended conversation appears
    // immediately in the history tab instead of waiting for the next
    // useFocusEffect (which only fires on screen-focus, not within-tab
    // navigation like hardware-back → start screen).
    const res = await listConversations()
    if (res.success) setHistory(res.data)
  }, [])

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
    const store = useChatStore.getState()
    store.load(id, ui, row?.summary ?? '', row?.summary_count ?? 0)

    // Distinguish two cases that look identical from the DB alone (both end on a
    // user message): (1) a reply is still generating in the background — the user
    // left mid-turn and the LLM is still running — vs. (2) the reply truly died
    // (app closed mid-generation). In case (1) showing a retry placeholder and
    // having the user tap it would spawn a SECOND generation → duplicate reply.
    // So when in flight, show the thread as busy and let the original land instead
    // of offering retry. store.load() reset sending=false, so re-arm sending here.
    const inFlight = generationsInFlight.has(id)
    const last = ui[ui.length - 1]
    if (last?.role === 'user' && !inFlight) {
      retryRef.current = {
        conversationId: id,
        message: last.content,
        priorHistory: ui.slice(0, -1).map((m) => ({ role: m.role, content: m.content })),
      }
      store.addMessage({
        id: randomUUID(),
        role: 'assistant',
        content: REPLY_INTERRUPTED,
        sources: [],
        crisisTier: null,
        failed: true,
      })
    } else if (last?.role === 'user' && inFlight) {
      // The original generation is still going to land; don't offer retry, and
      // mark the thread as sending so the UI shows the live/streaming state.
      retryRef.current = null
      store.setSending(true)
    } else {
      retryRef.current = null
    }
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
