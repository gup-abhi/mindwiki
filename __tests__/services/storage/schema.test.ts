import { type SqliteDatabase } from '@/services/storage/db'
import { runMigrations, MIGRATIONS } from '@/services/storage/migrations'

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

const TABLES = [
  'entries',
  'wiki_pages',
  'graph_nodes',
  'graph_edges',
  'settings',
  'sync_queue',
  'crisis_events',
]

describe('migration 001 (initial schema)', () => {
  it('is registered as version 1', () => {
    expect(MIGRATIONS[0].version).toBe(1)
    expect(MIGRATIONS[0].name).toBe('initial_schema')
  })

  it('creates all seven core tables when run', async () => {
    const { db, applied, executed } = createFakeDb()

    const result = await runMigrations(db, MIGRATIONS)

    expect(result.success).toBe(true)
    if (result.success) expect(result.data).toEqual([1, 2])
    expect(applied).toEqual([1, 2])
    for (const table of TABLES) {
      expect(executed.some((sql) => sql.includes(`CREATE TABLE ${table} `))).toBe(true)
    }
  })

  it('orders graph_nodes before graph_edges (FK target must exist first)', () => {
    const stmts = MIGRATIONS[0].statements
    const nodesAt = stmts.findIndex((s) => s.includes('CREATE TABLE graph_nodes'))
    const edgesAt = stmts.findIndex((s) => s.includes('CREATE TABLE graph_edges'))
    expect(nodesAt).toBeLessThan(edgesAt)
  })
})

describe('migration 002 (entry topic)', () => {
  it('is registered as version 2 and adds the topic column', () => {
    expect(MIGRATIONS[1].version).toBe(2)
    expect(MIGRATIONS[1].name).toBe('entry_topic')
    expect(MIGRATIONS[1].statements).toEqual(['ALTER TABLE entries ADD COLUMN topic TEXT'])
  })
})
