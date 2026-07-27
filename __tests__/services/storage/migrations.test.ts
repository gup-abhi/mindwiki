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

  it('registers migration 019 adding wiki_indexed_at and backfilling from tagged_at', () => {
    const m = MIGRATIONS.find((mig) => mig.version === 19)
    expect(m).toBeDefined()
    const sql = m!.statements.join('\n')
    expect(sql).toContain('ADD COLUMN wiki_indexed_at')
    // backfill trusts already-tagged rows so upgrade doesn't re-synthesize them
    expect(sql).toContain('SET wiki_indexed_at = tagged_at WHERE tagged_at IS NOT NULL')
  })

  it('registers migration 020 adding graph_indexed_at and backfilling from tagged_at', () => {
    const m = MIGRATIONS.find((mig) => mig.version === 20)
    expect(m).toBeDefined()
    const sql = m!.statements.join('\n')
    expect(sql).toContain('ADD COLUMN graph_indexed_at')
    expect(sql).toContain('SET graph_indexed_at = tagged_at WHERE tagged_at IS NOT NULL')
  })

  it('registers migration 030 — regrounded_upto + wiki_page_contributions', () => {
    const m = MIGRATIONS.find((mig) => mig.version === 30)
    expect(m).toBeDefined()
    expect(m!.name).toBe('wiki_reground_upto')
    const sql = m!.statements.join('\n')
    expect(sql).toContain('ADD COLUMN regrounded_upto')
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS wiki_page_contributions')
    expect(sql).toContain('entry_id')
    expect(sql).toContain('page_id')
    expect(sql).toContain('UNIQUE (entry_id, page_id)')
  })

  it('registers migration 031 adding entry_entities.canonical_label + updated_at (F-02B)', () => {
    const m = MIGRATIONS.find((mig) => mig.version === 31)
    expect(m).toBeDefined()
    expect(m!.name).toBe('entry_entities_effective_label')
    const sql = m!.statements.join('\n')
    expect(sql).toContain('ALTER TABLE entry_entities ADD COLUMN canonical_label TEXT NULL')
    expect(sql).toContain('ALTER TABLE entry_entities ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0')
    // Backfill: pre-F-02B rows get updated_at = created_at so they stay syncable
    // (LWW watermark) before any canonicalization bump lands. Source rows (id /
    // label / created_at) are not rewritten — never copy the row, never delete.
    expect(sql).toContain('UPDATE entry_entities SET updated_at = created_at WHERE updated_at = 0')
  })

  it('registers migration 032 — belief_maintenance_state table with journal-row key plus seeded belief row (F-02C dry-run gate)', () => {
    const m = MIGRATIONS.find((mig) => mig.version === 32)
    expect(m).toBeDefined()
    expect(m!.name).toBe('belief_maintenance_state')
    const sql = m!.statements.join('\n')
    // The maintenance pass is restart-safe and rerun-gated: full state lives
    // in this table (algorithm_version + source_generation vs processed_generation).
    // Count-only — no label text or label-derived hashes persist here.
    expect(sql).toContain('CREATE TABLE belief_maintenance_state')
    expect(sql).toContain("INSERT INTO belief_maintenance_state (key) VALUES ('belief')")
  })

  it('registers migration 036 — notification insight kinds', () => {
    const m = MIGRATIONS.find((mig) => mig.version === 36)
    expect(m?.name).toBe('local_notification_insight_kinds')
  })

  it('registers migration 034 — live wiki title uniqueness', () => {
    const m = MIGRATIONS.find((mig) => mig.version === 34)
    expect(m).toBeDefined()
    expect(m!.name).toBe('wiki_live_title_uniqueness')
    const sql = m!.statements.join('\n')
    expect(sql).toContain('CREATE UNIQUE INDEX idx_wiki_pages_live_title')
    expect(sql).toContain('COLLATE NOCASE')
    expect(sql).toContain('merged_into IS NULL')
  })

  it('registers migration 033 — consolidated_clusters column in belief_maintenance_state (F-02C Slice 8)', () => {
    const m = MIGRATIONS.find((mig) => mig.version === 33)
    expect(m).toBeDefined()
    expect(m!.name).toBe('belief_maintenance_consolidated_clusters')
    const sql = m!.statements.join('\n')
    expect(sql).toContain('ALTER TABLE belief_maintenance_state')
    expect(sql).toContain('ADD COLUMN consolidated_clusters')
    expect(sql).toContain('INTEGER NOT NULL DEFAULT 0')
  })
})
