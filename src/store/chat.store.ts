import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'

import { type MessageSource } from '@/services/storage/chat'

export interface UIMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  sources: MessageSource[]
  crisisTier: number | null
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
  reset: () => void
  load: (conversationId: string, messages: UIMessage[]) => void
  setConversationId: (id: string) => void
  addMessage: (message: UIMessage) => void
  setMessageCrisis: (id: string, tier: number) => void
  setSending: (sending: boolean) => void
  appendToken: (token: string) => void
  clearStreaming: () => void
}

export const useChatStore = create<ChatState>()(
  immer((set) => ({
    conversationId: null,
    messages: [],
    streaming: '',
    sending: false,
    reset: () =>
      set((s) => {
        s.conversationId = null
        s.messages = []
        s.streaming = ''
        s.sending = false
      }),
    load: (conversationId, messages) =>
      set((s) => {
        s.conversationId = conversationId
        s.messages = messages
        s.streaming = ''
        s.sending = false
      }),
    setConversationId: (id) =>
      set((s) => {
        s.conversationId = id
      }),
    addMessage: (message) =>
      set((s) => {
        s.messages.push(message)
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
