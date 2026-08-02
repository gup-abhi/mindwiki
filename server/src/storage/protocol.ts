export const SERVER_SYNCED_TABLES = [
  'entries',
  'wiki_pages',
  'entry_entities',
  'conversations',
  'chat_messages',
  'challenges',
  'graph_node_dismissals',
  'belief_reframes',
  'streak_freezes',
] as const

export type ServerSyncTable = (typeof SERVER_SYNCED_TABLES)[number]

export const MIN_CIPHERTEXT_HEX_LENGTH = (12 + 16) * 2
export const MAX_CIPHERTEXT_HEX_LENGTH = 1_000_000
export const MAX_UPLOAD_BODY_LENGTH = MAX_CIPHERTEXT_HEX_LENGTH + 1_024
export const MAX_FUTURE_SKEW_MS = 24 * 60 * 60 * 1_000
// At most eight maximum-sized ciphertexts per response (~8 MiB plus JSON).
export const DELTA_PAGE_SIZE = 8

const TABLES = new Set<string>(SERVER_SYNCED_TABLES)
const SYNC_ID_PATTERN = /^[0-9a-f]{64}$/
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/
const MAX_LEGACY_RECORD_ID_BYTES = 2_048

export interface UploadEnvelope {
  version: 2
  ciphertext: string
  updated_at: number
  sync_id: string
  table: ServerSyncTable
}

export interface StoredEnvelope {
  ciphertext: string
  updated_at: number
}

export interface ParsedObjectKey {
  table: ServerSyncTable
  syncId?: string
  recordId?: string
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value)
  return actual.length === keys.length && actual.every((key) => keys.includes(key))
}

export function isServerSyncTable(value: string): value is ServerSyncTable {
  return TABLES.has(value)
}

export function isSyncId(value: unknown): value is string {
  return typeof value === 'string' && SYNC_ID_PATTERN.test(value)
}

export function isCiphertext(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length >= MIN_CIPHERTEXT_HEX_LENGTH &&
    value.length <= MAX_CIPHERTEXT_HEX_LENGTH &&
    value.length % 2 === 0 &&
    /^[0-9a-f]+$/i.test(value)
  )
}

export function isTimestamp(value: unknown, now = Date.now(), enforceFutureBound = true): value is number {
  return (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    (!enforceFutureBound || value <= now + MAX_FUTURE_SKEW_MS)
  )
}

export function parseUploadEnvelope(value: unknown, now = Date.now()): UploadEnvelope | null {
  if (!isPlainObject(value)) return null
  if (!hasExactKeys(value, ['version', 'ciphertext', 'updated_at', 'sync_id', 'table'])) return null
  if (
    value.version !== 2 ||
    !isCiphertext(value.ciphertext) ||
    !isTimestamp(value.updated_at, now) ||
    !isSyncId(value.sync_id) ||
    typeof value.table !== 'string' ||
    !isServerSyncTable(value.table)
  ) return null
  return value as unknown as UploadEnvelope
}

export function parseStoredEnvelope(value: unknown): StoredEnvelope | null {
  if (!isPlainObject(value)) return null
  if (!hasExactKeys(value, ['ciphertext', 'updated_at'])) return null
  if (!isCiphertext(value.ciphertext) || !isTimestamp(value.updated_at, Date.now(), false)) return null
  return value as unknown as StoredEnvelope
}

/** New keys contain only account id, protocol version, table, and opaque HMAC sync id. */
export function syncObjectKey(accountId: string, table: ServerSyncTable, syncId: string): string {
  if (!isSyncId(syncId)) throw new Error('Invalid sync id')
  return `${accountId}/v2/${table}/${syncId}`
}

export function isLegacyRecordId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    !/[\u0000-\u001f\u007f]/.test(value) &&
    new TextEncoder().encode(value).length <= MAX_LEGACY_RECORD_ID_BYTES
  )
}

/** Parse v2 keys plus old account/table/record-id keys for restore compatibility. */
export function parseSyncObjectKey(key: string, accountId: string): ParsedObjectKey | null {
  const prefix = `${accountId}/`
  if (!key.startsWith(prefix)) return null
  const suffix = key.slice(prefix.length)
  const parts = suffix.split('/')
  if (parts[0] === 'v2') {
    if (parts.length !== 3 || !isServerSyncTable(parts[1]) || !isSyncId(parts[2])) return null
    return { table: parts[1], syncId: parts[2] }
  }

  const table = parts.shift()
  const recordId = parts.join('/')
  if (!table || !isServerSyncTable(table) || !isLegacyRecordId(recordId)) return null
  return { table, recordId }
}

export function encodeDeltaCursor(cursor: string): string {
  return btoa(cursor).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

export function decodeDeltaCursor(value: string | null): string | undefined | null {
  if (value == null || value === '') return undefined
  if (value.length > 4_096 || !BASE64URL_PATTERN.test(value)) return null
  try {
    const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4)
    const decoded = atob(padded)
    return decoded || null
  } catch {
    return null
  }
}