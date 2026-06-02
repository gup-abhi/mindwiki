import { type SqliteDatabase } from '@/services/storage/db'
import { getSetting, setSetting } from '@/services/storage/settings'

function createFakeDb(): SqliteDatabase {
  const store = new Map<string, string>()
  const db: SqliteDatabase = {
    async execute(sql, params = []) {
      if (/^SELECT value FROM settings WHERE key/.test(sql)) {
        const v = store.get(String(params[0]))
        return { rows: v === undefined ? [] : [{ value: v }], rowsAffected: 0 }
      }
      if (/^INSERT INTO settings/.test(sql)) {
        store.set(String(params[0]), String(params[1]))
        return { rows: [], rowsAffected: 1 }
      }
      throw new Error(`unhandled SQL: ${sql}`)
    },
    async transaction(fn) {
      await fn(db)
    },
    async close() {},
  }
  return db
}

describe('settings storage', () => {
  it('returns null for an unset key', async () => {
    const db = createFakeDb()
    const res = await getSetting('missing', db)
    expect(res).toEqual({ success: true, data: null })
  })

  it('writes then reads a value', async () => {
    const db = createFakeDb()
    await setSetting('send_hour', '20', db)
    const res = await getSetting('send_hour', db)
    expect(res).toEqual({ success: true, data: '20' })
  })

  it('upserts (overwrites) an existing key', async () => {
    const db = createFakeDb()
    await setSetting('send_hour', '20', db)
    await setSetting('send_hour', '9', db)
    const res = await getSetting('send_hour', db)
    expect(res).toEqual({ success: true, data: '9' })
  })
})
