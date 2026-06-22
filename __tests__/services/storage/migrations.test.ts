import { type SqliteDatabase } from '@/services/storage/db'
import { runMigrations, MIGRATIONS, type Migration } from '@/services/storage/migrations'

// Fake DB that tracks schema_migrations state so we can verify idempotency.
function createFakeDb() {
  const applied: number[] = []
  const executed: string[] = []
  const db: SqliteDatabase = {
    async execute(sql, params) {
      executed.push(sql)
      if (/^SELECT version FROM schema_migrations/.test(sql)) {
        return { rows: applied.map((version) => ({ version })), rowsAffected: 0 }
      }
      if (/^INSERT INTO schema_migrations/.test(sql)) {
        applied.push(Number(params![0]))
        return { rows: [], rowsAffected: 1 }
      }
      return { rows: [], rowsAffected: 0 }
    },
    async transaction(fn) {
      await fn(db)
    },
    close() {},
  }
  return { db, applied, executed }
}

const MIGS: Migration[] = [
  { version: 2, name: 'second', statements: ['CREATE TABLE b (id TEXT)'] },
  { version: 1, name: 'first', statements: ['CREATE TABLE a (id TEXT)'] },
]

describe('storage/migrations runner', () => {
  it('creates schema_migrations and applies pending in ascending version order', async () => {
    const { db, applied, executed } = createFakeDb()

    const result = await runMigrations(db, MIGS)

    expect(result.success).toBe(true)
    if (result.success) expect(result.data).toEqual([1, 2])
    expect(applied).toEqual([1, 2])
    expect(executed[0]).toContain('CREATE TABLE IF NOT EXISTS schema_migrations')
    expect(executed).toContain('CREATE TABLE a (id TEXT)')
    expect(executed).toContain('CREATE TABLE b (id TEXT)')
  })

  it('is idempotent — a second run applies nothing', async () => {
    const { db } = createFakeDb()

    await runMigrations(db, MIGS)
    const second = await runMigrations(db, MIGS)

    expect(second.success).toBe(true)
    if (second.success) expect(second.data).toEqual([])
  })

  it('applies only the not-yet-recorded migrations', async () => {
    const { db, applied } = createFakeDb()

    await runMigrations(db, [MIGS[1]]) // version 1 only
    const result = await runMigrations(db, MIGS) // now add version 2

    expect(result.success).toBe(true)
    if (result.success) expect(result.data).toEqual([2])
    expect(applied).toEqual([1, 2])
  })
})

describe('registry', () => {
  it('has unique, ascending versions', () => {
    const versions = MIGRATIONS.map((m) => m.version)
    expect(versions).toEqual([...versions].sort((a, b) => a - b))
    expect(new Set(versions).size).toBe(versions.length)
  })

  it('registers migration 012 widening entry_entities to belief/behavior', () => {
    const m = MIGRATIONS.find((mig) => mig.version === 12)
    expect(m).toBeDefined()
    const sql = m!.statements.join('\n')
    expect(sql).toContain("'belief','behavior'")
    expect(sql).toContain('entry_entities') // table rebuilt, not dropped
  })
})
