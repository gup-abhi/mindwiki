import { SYNCED_TABLES } from '@/services/sync/conflict'
import {
  SERVER_SYNCED_TABLES,
  parseSyncObjectKey,
  syncObjectKey,
} from '../../server/src/storage/protocol'

const syncId = 'a'.repeat(64)

describe('sync protocol contract', () => {
  it('keeps app and Worker table allowlists identical', () => {
    expect(SERVER_SYNCED_TABLES).toEqual(SYNCED_TABLES)
  })

  it('round-trips opaque V2 object keys', () => {
    const key = syncObjectKey('account-1', 'entry_entities', syncId)
    expect(key).toBe(`account-1/v2/entry_entities/${syncId}`)
    expect(parseSyncObjectKey(key, 'account-1')).toEqual({
      table: 'entry_entities',
      syncId,
    })
  })

  it('reads legacy user-derived IDs with spaces, Unicode, percent, and slash', () => {
    const recordId = 'entry-id:belief:work / family % 日本語'
    expect(parseSyncObjectKey(`account-1/entry_entities/${recordId}`, 'account-1')).toEqual({
      table: 'entry_entities',
      recordId,
    })
  })

  it('rejects malformed and foreign-account object keys', () => {
    expect(parseSyncObjectKey(`account-2/v2/entries/${syncId}`, 'account-1')).toBeNull()
    expect(parseSyncObjectKey('account-1/v2/entries/not-opaque', 'account-1')).toBeNull()
    expect(parseSyncObjectKey(`account-1/v2/settings/${syncId}`, 'account-1')).toBeNull()
    expect(parseSyncObjectKey('account-1/entries/control\u0000id', 'account-1')).toBeNull()
  })
})