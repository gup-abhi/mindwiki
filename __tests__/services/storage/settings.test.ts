import { type SqliteDatabase } from '@/services/storage/db'
import { getSetting, setSetting, bumpSetting, incrementSettingToThreshold } from '@/services/storage/settings'

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

describe('bumpSetting (atomic count-only diagnostic)', () => {
  it('starts at 1 for an unset key', async () => {
    const db = createFakeDb()
    const res = await bumpSetting('topic_truncation_count', db)
    expect(res).toEqual({ success: true, data: 1 })
    const read = await getSetting('topic_truncation_count', db)
    expect(read).toEqual({ success: true, data: '1' })
  })

  it('increments monotonically across sequential calls', async () => {
    const db = createFakeDb()
    await bumpSetting('topic_truncation_count', db)
    await bumpSetting('topic_truncation_count', db)
    const res = await bumpSetting('topic_truncation_count', db)
    expect(res).toEqual({ success: true, data: 3 })
  })

  it('returns a new Result per call (no shared mutable state)', async () => {
    const db = createFakeDb()
    const a = await bumpSetting('topic_truncation_count', db)
    const b = await bumpSetting('topic_truncation_count', db)
    expect(a).toEqual({ success: true, data: 1 })
    expect(b).toEqual({ success: true, data: 2 })
  })

  it('isolates each key', async () => {
    const db = createFakeDb()
    await bumpSetting('topic_truncation_count', db)
    await bumpSetting('distinct_counter', db)
    const a = await getSetting('topic_truncation_count', db)
    const b = await getSetting('distinct_counter', db)
    expect(a).toEqual({ success: true, data: '1' })
    expect(b).toEqual({ success: true, data: '1' })
  })
})

describe('incrementSettingToThreshold remains available for re-use', () => {
  it('counts toward threshold and wraps at threshold', async () => {
    const db = createFakeDb()
    let reached = await incrementSettingToThreshold('interval', 3, db)
    expect(reached).toEqual({ success: true, data: false })
    reached = await incrementSettingToThreshold('interval', 3, db)
    expect(reached).toEqual({ success: true, data: false })
    reached = await incrementSettingToThreshold('interval', 3, db)
    expect(reached).toEqual({ success: true, data: true })
    // Wraps to 0 after reaching threshold
    const read = await getSetting('interval', db)
    expect(read).toEqual({ success: true, data: '0' })
  })
})
