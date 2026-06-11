import { type SqliteDatabase } from '@/services/storage/db'
import {
  appendMessage,
  createConversation,
  getConversation,
  listConversations,
  listMessages,
  setConversationSummary,
} from '@/services/storage/chat'

let mockUuidCounter = 0
jest.mock('expo-crypto', () => ({
  randomUUID: () => `id-${++mockUuidCounter}`,
}))

// In-memory fake backing the exact queries chat.ts issues. sync_queue inserts
// are intentionally unhandled — enqueueUpsert swallows the error (best-effort).
function createFakeDb() {
  const conversations = new Map<string, Record<string, unknown>>()
  const messages = new Map<string, Record<string, unknown>>()
  const db: SqliteDatabase = {
    async execute(sql, params = []) {
      if (/^INSERT INTO conversations/.test(sql)) {
        const [id, title, created_at, updated_at] = params
        conversations.set(String(id), { id, title, created_at, updated_at })
        return { rows: [], rowsAffected: 1 }
      }
      if (/^SELECT \* FROM conversations ORDER BY/.test(sql)) {
        const rows = [...conversations.values()].sort(
          (a, b) => Number(b.updated_at) - Number(a.updated_at)
        )
        return { rows, rowsAffected: 0 }
      }
      if (/^SELECT \* FROM conversations WHERE id/.test(sql)) {
        const row = conversations.get(String(params[0]))
        return { rows: row ? [row] : [], rowsAffected: 0 }
      }
      if (/^UPDATE conversations SET summary/.test(sql)) {
        const [summary, summary_count, id] = params
        const row = conversations.get(String(id))
        if (row) {
          row.summary = summary
          row.summary_count = summary_count
        }
        return { rows: [], rowsAffected: row ? 1 : 0 }
      }
      if (/^INSERT INTO chat_messages/.test(sql)) {
        const [id, conversation_id, role, content, sources_json, crisis_tier, created_at] = params
        messages.set(String(id), {
          id,
          conversation_id,
          role,
          content,
          sources_json,
          crisis_tier,
          created_at,
        })
        return { rows: [], rowsAffected: 1 }
      }
      if (/^UPDATE conversations/.test(sql)) {
        const [updated_at, role, titleSlice, id] = params
        const row = conversations.get(String(id))
        if (row) {
          row.updated_at = updated_at
          if (row.title == null && role === 'user') row.title = titleSlice
        }
        return { rows: [], rowsAffected: row ? 1 : 0 }
      }
      if (/^SELECT \* FROM chat_messages WHERE conversation_id/.test(sql)) {
        const rows = [...messages.values()]
          .filter((m) => m.conversation_id === params[0])
          .sort((a, b) => Number(a.created_at) - Number(b.created_at))
        return { rows, rowsAffected: 0 }
      }
      throw new Error(`unhandled SQL: ${sql}`)
    },
    async transaction(fn) {
      await fn(db)
    },
    close() {},
  }
  return { db }
}

describe('storage/chat CRUD', () => {
  beforeEach(() => {
    mockUuidCounter = 0
  })

  it('round-trips a conversation: create, append, list in order', async () => {
    const { db } = createFakeDb()
    const conv = await createConversation(db)
    expect(conv.success).toBe(true)
    const convId = conv.success ? conv.data.id : ''

    await appendMessage(
      { conversation_id: convId, role: 'user', content: 'Why am I so anxious?', crisis_tier: null },
      db
    )
    await appendMessage(
      {
        conversation_id: convId,
        role: 'assistant',
        content: 'Deadlines seem to spike it.',
        sources: [{ id: 'p1', title: 'Work' }],
      },
      db
    )

    const msgs = await listMessages(convId, db)
    expect(msgs.success).toBe(true)
    if (msgs.success) {
      expect(msgs.data.map((m) => m.role)).toEqual(['user', 'assistant'])
      // sources_json round-trips back to an array
      expect(msgs.data[1].sources).toEqual([{ id: 'p1', title: 'Work' }])
    }
  })

  it('seeds the conversation title from the first user message and bumps updated_at', async () => {
    const { db } = createFakeDb()
    const conv = await createConversation(db)
    const convId = conv.success ? conv.data.id : ''

    await appendMessage({ conversation_id: convId, role: 'user', content: 'First thing I said' }, db)

    const list = await listConversations(db)
    expect(list.success).toBe(true)
    if (list.success) {
      expect(list.data[0].title).toBe('First thing I said')
    }
  })

  it('persists the crisis tier on a user message', async () => {
    const { db } = createFakeDb()
    const conv = await createConversation(db)
    const convId = conv.success ? conv.data.id : ''
    await appendMessage({ conversation_id: convId, role: 'user', content: 'help', crisis_tier: 3 }, db)

    const msgs = await listMessages(convId, db)
    expect(msgs.success && msgs.data[0].crisis_tier).toBe(3)
  })

  it('starts a conversation with an empty summary and reads it back via getConversation', async () => {
    const { db } = createFakeDb()
    const conv = await createConversation(db)
    expect(conv.success && conv.data.summary).toBe('')
    expect(conv.success && conv.data.summary_count).toBe(0)
    const convId = conv.success ? conv.data.id : ''

    const got = await getConversation(convId, db)
    expect(got.success && got.data?.summary).toBe('')
    const missing = await getConversation('nope', db)
    expect(missing.success && missing.data).toBeNull()
  })

  it('saves and reloads the rolling summary + coverage count', async () => {
    const { db } = createFakeDb()
    const conv = await createConversation(db)
    const convId = conv.success ? conv.data.id : ''

    const saved = await setConversationSummary(convId, 'They felt anxious about work.', 4, db)
    expect(saved.success).toBe(true)

    const got = await getConversation(convId, db)
    expect(got.success && got.data?.summary).toBe('They felt anxious about work.')
    expect(got.success && got.data?.summary_count).toBe(4)
  })
})
