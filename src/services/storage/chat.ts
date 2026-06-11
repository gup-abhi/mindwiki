import { randomUUID } from 'expo-crypto'

import { type Result, ok, err } from '@/types/result'

import { type SqliteDatabase, getDb } from './db'
import { enqueueUpsert } from './sync-queue'

export type ChatRole = 'user' | 'assistant'

/** Minimal page reference kept on a reply for citation chips. */
export interface MessageSource {
  id: string
  title: string
}

export interface Conversation {
  id: string
  title: string | null
  created_at: number
  updated_at: number
  /** Rolling recap of turns that have scrolled out of the model's context window. */
  summary: string
  /** How many messages (oldest-first) the summary already covers. */
  summary_count: number
}

export interface ConversationMessage {
  id: string
  conversation_id: string
  role: ChatRole
  content: string
  sources: MessageSource[]
  crisis_tier: number | null
  created_at: number
}

export interface NewMessage {
  conversation_id: string
  role: ChatRole
  content: string
  sources?: MessageSource[]
  crisis_tier?: number | null
}

function rowToConversation(row: Record<string, unknown>): Conversation {
  return {
    id: String(row.id),
    title: row.title == null ? null : String(row.title),
    created_at: Number(row.created_at),
    updated_at: Number(row.updated_at),
    summary: row.summary == null ? '' : String(row.summary),
    summary_count: row.summary_count == null ? 0 : Number(row.summary_count),
  }
}

function rowToMessage(row: Record<string, unknown>): ConversationMessage {
  let sources: MessageSource[] = []
  try {
    const parsed = JSON.parse(String(row.sources_json ?? '[]'))
    if (Array.isArray(parsed)) sources = parsed
  } catch {
    sources = []
  }
  return {
    id: String(row.id),
    conversation_id: String(row.conversation_id),
    role: String(row.role) as ChatRole,
    content: String(row.content ?? ''),
    sources,
    crisis_tier: row.crisis_tier == null ? null : Number(row.crisis_tier),
    created_at: Number(row.created_at),
  }
}

export async function createConversation(
  db: SqliteDatabase = getDb()
): Promise<Result<Conversation>> {
  const now = Date.now()
  const conversation: Conversation = {
    id: randomUUID(),
    title: null,
    created_at: now,
    updated_at: now,
    summary: '',
    summary_count: 0,
  }
  try {
    await db.execute(
      'INSERT INTO conversations (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)',
      [conversation.id, conversation.title, now, now]
    )
    await enqueueUpsert('conversations', conversation.id, db) // best-effort; never blocks
    return ok(conversation)
  } catch (e) {
    return err('CHAT_CREATE_FAILED', 'Failed to create conversation', e)
  }
}

/** Conversations, most recently updated first. */
export async function listConversations(
  db: SqliteDatabase = getDb()
): Promise<Result<Conversation[]>> {
  try {
    const res = await db.execute('SELECT * FROM conversations ORDER BY updated_at DESC')
    return ok(res.rows.map(rowToConversation))
  } catch (e) {
    return err('CHAT_LIST_FAILED', 'Failed to list conversations', e)
  }
}

/** A single conversation by id (null if it doesn't exist). */
export async function getConversation(
  id: string,
  db: SqliteDatabase = getDb()
): Promise<Result<Conversation | null>> {
  try {
    const res = await db.execute('SELECT * FROM conversations WHERE id = ?', [id])
    const row = res.rows[0]
    return ok(row ? rowToConversation(row) : null)
  } catch (e) {
    return err('CHAT_GET_FAILED', 'Failed to read conversation', e)
  }
}

/** Persist the rolling summary and the count of messages it now covers. */
export async function setConversationSummary(
  id: string,
  summary: string,
  summaryCount: number,
  db: SqliteDatabase = getDb()
): Promise<Result<void>> {
  try {
    await db.execute('UPDATE conversations SET summary = ?, summary_count = ? WHERE id = ?', [
      summary,
      summaryCount,
      id,
    ])
    await enqueueUpsert('conversations', id, db) // summary changed → re-sync
    return ok(undefined)
  } catch (e) {
    return err('CHAT_SUMMARY_FAILED', 'Failed to save conversation summary', e)
  }
}

/**
 * Append a message and bump the conversation's updated_at, in one transaction.
 * The first user message also seeds the conversation title (trimmed) if unset.
 */
export async function appendMessage(
  input: NewMessage,
  db: SqliteDatabase = getDb()
): Promise<Result<ConversationMessage>> {
  const now = Date.now()
  const message: ConversationMessage = {
    id: randomUUID(),
    conversation_id: input.conversation_id,
    role: input.role,
    content: input.content,
    sources: input.sources ?? [],
    crisis_tier: input.crisis_tier ?? null,
    created_at: now,
  }
  try {
    await db.transaction(async (tx) => {
      await tx.execute(
        `INSERT INTO chat_messages
           (id, conversation_id, role, content, sources_json, crisis_tier, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          message.id,
          message.conversation_id,
          message.role,
          message.content,
          JSON.stringify(message.sources),
          message.crisis_tier,
          now,
        ]
      )
      await tx.execute(
        `UPDATE conversations
           SET updated_at = ?,
               title = COALESCE(title, CASE WHEN ? = 'user' THEN ? ELSE title END)
         WHERE id = ?`,
        [now, message.role, message.content.slice(0, 60), message.conversation_id]
      )
    })
    await enqueueUpsert('chat_messages', message.id, db)
    await enqueueUpsert('conversations', message.conversation_id, db)
    return ok(message)
  } catch (e) {
    return err('CHAT_APPEND_FAILED', 'Failed to append message', e)
  }
}

/** Messages for a conversation, oldest first. */
export async function listMessages(
  conversationId: string,
  db: SqliteDatabase = getDb()
): Promise<Result<ConversationMessage[]>> {
  try {
    const res = await db.execute(
      'SELECT * FROM chat_messages WHERE conversation_id = ? ORDER BY created_at ASC',
      [conversationId]
    )
    return ok(res.rows.map(rowToMessage))
  } catch (e) {
    return err('CHAT_MESSAGES_FAILED', 'Failed to list messages', e)
  }
}
