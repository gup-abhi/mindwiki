import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'

import { type MessageSource } from '@/services/storage/chat'

export interface UIMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  sources: MessageSource[]
  crisisTier: number | null
  /** A reply that failed to generate — renders a "Try again" affordance. */
  failed?: boolean
}

// In-flight conversation UI state. Persistence lives in SQLite (services/storage/
// chat.ts); this store holds only what the screen renders, so streaming token
// updates re-render the live bubble without touching the rest of the thread.
export interface ChatState {
  conversationId: string | null
  messages: UIMessage[]
  /** The assistant reply being streamed in (empty when idle). */
  streaming: string
  sending: boolean
  /** Rolling recap of earlier turns + how many messages it covers. */
  summary: string
  summaryCount: number
  /** Distress tier from the rolling summary, scored on refresh (0 = no signal).
   *  Never interrupts the conversation — the screen quietly surfaces resources. */
  summaryCrisisTier: number
  reset: () => void
  load: (conversationId: string, messages: UIMessage[], summary: string, summaryCount: number) => void
  setConversationId: (id: string) => void
  addMessage: (message: UIMessage) => void
  /** Drop any failed-reply placeholders (before a retry re-runs the turn). */
  dropFailed: () => void
  setMessageCrisis: (id: string, tier: number) => void
  setSending: (sending: boolean) => void
  setSummary: (summary: string, summaryCount: number) => void
  setSummaryCrisisTier: (tier: number) => void
  appendToken: (token: string) => void
  clearStreaming: () => void
}

export const useChatStore = create<ChatState>()(
  immer((set) => ({
    conversationId: null,
    messages: [],
    streaming: '',
    sending: false,
    summary: '',
    summaryCount: 0,
    summaryCrisisTier: 0,
    reset: () =>
      set((s) => {
        s.conversationId = null
        s.messages = []
        s.streaming = ''
        s.sending = false
        s.summary = ''
        s.summaryCount = 0
        s.summaryCrisisTier = 0
      }),
    load: (conversationId, messages, summary, summaryCount) =>
      set((s) => {
        s.conversationId = conversationId
        s.messages = messages
        s.streaming = ''
        s.sending = false
        s.summary = summary
        s.summaryCount = summaryCount
        s.summaryCrisisTier = 0
      }),
    setConversationId: (id) =>
      set((s) => {
        s.conversationId = id
      }),
    addMessage: (message) =>
      set((s) => {
        s.messages.push(message)
      }),
    dropFailed: () =>
      set((s) => {
        s.messages = s.messages.filter((m) => !m.failed)
      }),
    setMessageCrisis: (id, tier) =>
      set((s) => {
        const m = s.messages.find((msg) => msg.id === id)
        if (m) m.crisisTier = tier
      }),
    setSending: (sending) =>
      set((s) => {
        s.sending = sending
      }),
    setSummary: (summary, summaryCount) =>
      set((s) => {
        s.summary = summary
        s.summaryCount = summaryCount
      }),
    setSummaryCrisisTier: (tier) =>
      set((s) => {
        s.summaryCrisisTier = tier
      }),
    appendToken: (token) =>
      set((s) => {
        s.streaming += token
      }),
    clearStreaming: () =>
      set((s) => {
        s.streaming = ''
      }),
  }))
)
