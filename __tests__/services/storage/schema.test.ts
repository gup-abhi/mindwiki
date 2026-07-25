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
    if (result.success)
      expect(result.data).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30])
    expect(applied).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30])
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

describe('migration 003 (entry entities)', () => {
  it('is registered as version 3', () => {
    expect(MIGRATIONS[2].version).toBe(3)
    expect(MIGRATIONS[2].name).toBe('entry_entities')
  })

  it('creates entry_entities and recreates graph_nodes with place/activity', () => {
    const stmts = MIGRATIONS[2].statements
    expect(stmts.some((s) => s.includes('CREATE TABLE entry_entities'))).toBe(true)
    // graph_nodes is dropped + recreated with the widened type CHECK
    expect(stmts.some((s) => s.includes('DROP TABLE graph_nodes'))).toBe(true)
    const recreate = stmts.find((s) => s.includes('CREATE TABLE graph_nodes'))
    expect(recreate).toBeDefined()
    expect(recreate).toContain("'place'")
    expect(recreate).toContain("'activity'")
  })

  it('recreates graph_nodes before graph_edges (FK target first)', () => {
    const stmts = MIGRATIONS[2].statements
    const nodesAt = stmts.findIndex((s) => s.includes('CREATE TABLE graph_nodes'))
    const edgesAt = stmts.findIndex((s) => s.includes('CREATE TABLE graph_edges'))
    expect(nodesAt).toBeLessThan(edgesAt)
  })
})

describe('migration 028 (graph_nodes label NOCASE)', () => {
  it('is registered as version 28 and recreates the graph tables', () => {
    expect(MIGRATIONS[27].version).toBe(28)
    expect(MIGRATIONS[27].name).toBe('graph_nodes_label_nocase')
    const stmts = MIGRATIONS[27].statements
    // graph_nodes dropped + recreated so the UNIQUE index is case-insensitive.
    expect(stmts.some((s) => s.includes('DROP TABLE graph_nodes'))).toBe(true)
    const recreate = stmts.find((s) => s.includes('CREATE TABLE graph_nodes'))
    expect(recreate).toContain('COLLATE NOCASE')
  })
})

describe('migration 004 (conversations)', () => {
  it('is registered as version 4', () => {
    expect(MIGRATIONS[3].version).toBe(4)
    expect(MIGRATIONS[3].name).toBe('conversations')
  })

  it('creates conversations before chat_messages (FK target first)', () => {
    const stmts = MIGRATIONS[3].statements
    const convAt = stmts.findIndex((s) => s.includes('CREATE TABLE conversations'))
    const msgAt = stmts.findIndex((s) => s.includes('CREATE TABLE chat_messages'))
    expect(convAt).toBeGreaterThanOrEqual(0)
    expect(convAt).toBeLessThan(msgAt)
  })
})

describe('migration 005 (entry source)', () => {
  it('is registered as version 5 and adds a source column defaulting to journal', () => {
    expect(MIGRATIONS[4].version).toBe(5)
    expect(MIGRATIONS[4].name).toBe('entry_source')
    expect(MIGRATIONS[4].statements).toEqual([
      "ALTER TABLE entries ADD COLUMN source TEXT NOT NULL DEFAULT 'journal'",
    ])
  })
})

describe('migration 006 (conversation summary)', () => {
  it('is registered as version 6 and adds summary + summary_count columns', () => {
    expect(MIGRATIONS[5].version).toBe(6)
    expect(MIGRATIONS[5].name).toBe('conversation_summary')
    expect(MIGRATIONS[5].statements).toEqual([
      "ALTER TABLE conversations ADD COLUMN summary TEXT NOT NULL DEFAULT ''",
      'ALTER TABLE conversations ADD COLUMN summary_count INTEGER NOT NULL DEFAULT 0',
    ])
  })
})

describe('migration 007 (pursuits)', () => {
  it('is registered as version 7', () => {
    expect(MIGRATIONS[6].version).toBe(7)
    expect(MIGRATIONS[6].name).toBe('pursuits')
  })

  it('creates the pursuits table with a lifecycle status and an index', () => {
    const stmts = MIGRATIONS[6].statements
    expect(stmts.some((s) => s.includes('CREATE TABLE pursuits'))).toBe(true)
    expect(
      stmts.some((s) => s.includes("CHECK (status IN ('active','done','abandoned','dormant'))"))
    ).toBe(true)
    expect(stmts.some((s) => s.includes('CREATE INDEX idx_pursuits_status'))).toBe(true)
  })

  it('is registered as version 8', () => {
    expect(MIGRATIONS[7].version).toBe(8)
    expect(MIGRATIONS[7].name).toBe('challenges')
  })

  it('creates the challenges table with a two-state status and an index', () => {
    const stmts = MIGRATIONS[7].statements
    expect(stmts.some((s) => s.includes('CREATE TABLE challenges'))).toBe(true)
    expect(stmts.some((s) => s.includes("CHECK (status IN ('active','completed'))"))).toBe(true)
    expect(stmts.some((s) => s.includes('CREATE INDEX idx_challenges_status'))).toBe(true)
  })

  it('is registered as version 9 and adds the wiki page dismissal column', () => {
    expect(MIGRATIONS[8].version).toBe(9)
    expect(MIGRATIONS[8].name).toBe('wiki_page_dismissal')
    expect(MIGRATIONS[8].statements).toEqual([
      'ALTER TABLE wiki_pages ADD COLUMN dismissed_at INTEGER',
    ])
  })

  it('is registered as version 10 and adds the wiki page correction column', () => {
    expect(MIGRATIONS[9].version).toBe(10)
    expect(MIGRATIONS[9].name).toBe('wiki_page_correction')
    expect(MIGRATIONS[9].statements).toEqual([
      'ALTER TABLE wiki_pages ADD COLUMN corrected_at INTEGER',
    ])
  })

  it('is registered as version 11 and creates the graph_node_dismissals table', () => {
    expect(MIGRATIONS[10].version).toBe(11)
    expect(MIGRATIONS[10].name).toBe('graph_node_dismissal')
    expect(MIGRATIONS[10].statements.some((s) => s.includes('CREATE TABLE graph_node_dismissals'))).toBe(true)
  })

  it('is registered as version 12 and rebuilds entry_entities with belief/behavior, preserving rows', () => {
    expect(MIGRATIONS[11].version).toBe(12)
    expect(MIGRATIONS[11].name).toBe('entity_beliefs_behaviors')
    const stmts = MIGRATIONS[11].statements
    // rebuilt (not dropped): rename → recreate with widened CHECK → copy → drop old
    const recreate = stmts.find((s) => s.includes('CREATE TABLE entry_entities '))
    expect(recreate).toContain("'belief','behavior'")
    expect(stmts.some((s) => /INSERT INTO entry_entities[\s\S]*SELECT/.test(s))).toBe(true)
    // indexes recreated on the new table
    expect(stmts.some((s) => s.includes('CREATE INDEX idx_entry_entities_type_label'))).toBe(true)
  })

  it('is registered as version 13 and creates the belief_reframes table', () => {
    expect(MIGRATIONS[12].version).toBe(13)
    expect(MIGRATIONS[12].name).toBe('belief_reframes')
    const stmts = MIGRATIONS[12].statements
    expect(stmts.some((s) => s.includes('CREATE TABLE belief_reframes'))).toBe(true)
    const create = stmts.find((s) => s.includes('CREATE TABLE belief_reframes'))
    expect(create).toContain('balanced_thought')
  })

  it('is registered as version 14 and adds the wiki_pages merged_into column', () => {
    expect(MIGRATIONS[13].version).toBe(14)
    expect(MIGRATIONS[13].name).toBe('wiki_page_merge')
    expect(MIGRATIONS[13].statements).toEqual([
      'ALTER TABLE wiki_pages ADD COLUMN merged_into TEXT',
    ])
  })

  it('is registered as version 15 and creates the streak_freezes table', () => {
    expect(MIGRATIONS[14].version).toBe(15)
    expect(MIGRATIONS[14].name).toBe('streak_freezes')
    expect(MIGRATIONS[14].statements[0]).toContain('CREATE TABLE streak_freezes')
  })

  it('is registered as version 16 and creates the page_embeddings table', () => {
    expect(MIGRATIONS[15].version).toBe(16)
    expect(MIGRATIONS[15].name).toBe('page_embeddings')
    expect(MIGRATIONS[15].statements[0]).toContain('CREATE TABLE page_embeddings')
  })

  it('is registered as version 17 and adds the entries named_emotion column', () => {
    expect(MIGRATIONS[16].version).toBe(17)
    expect(MIGRATIONS[16].name).toBe('named_emotion')
    expect(MIGRATIONS[16].statements).toEqual([
      'ALTER TABLE entries ADD COLUMN named_emotion TEXT',
    ])
  })

  it('is registered as version 18 and adds the entries energy column', () => {
    expect(MIGRATIONS[17].version).toBe(18)
    expect(MIGRATIONS[17].name).toBe('entry_energy')
    expect(MIGRATIONS[17].statements).toEqual([
      'ALTER TABLE entries ADD COLUMN energy INTEGER',
    ])
  })

  it('is registered as version 19 and adds wiki_indexed_at with a tagged_at backfill', () => {
    expect(MIGRATIONS[18].version).toBe(19)
    expect(MIGRATIONS[18].name).toBe('entry_wiki_indexed_at')
    expect(MIGRATIONS[18].statements).toEqual([
      'ALTER TABLE entries ADD COLUMN wiki_indexed_at INTEGER',
      'UPDATE entries SET wiki_indexed_at = tagged_at WHERE tagged_at IS NOT NULL',
    ])
  })

  it('is registered as version 20 and adds graph_indexed_at with a tagged_at backfill', () => {
    expect(MIGRATIONS[19].version).toBe(20)
    expect(MIGRATIONS[19].name).toBe('entry_graph_indexed_at')
    expect(MIGRATIONS[19].statements).toEqual([
      'ALTER TABLE entries ADD COLUMN graph_indexed_at INTEGER',
      'UPDATE entries SET graph_indexed_at = tagged_at WHERE tagged_at IS NOT NULL',
    ])
  })

  it('is registered as version 21 and adds the Reflect provenance column', () => {
    expect(MIGRATIONS[20].version).toBe(21)
    expect(MIGRATIONS[20].name).toBe('entry_raw_text')
    expect(MIGRATIONS[20].statements).toEqual(['ALTER TABLE entries ADD COLUMN raw_text TEXT'])
  })

  it('is registered as version 22 and creates the entity_embeddings table', () => {
    expect(MIGRATIONS[21].version).toBe(22)
    expect(MIGRATIONS[21].name).toBe('entity_embeddings')
    expect(MIGRATIONS[21].statements.some((s) => s.includes('CREATE TABLE IF NOT EXISTS entity_embeddings'))).toBe(true)
  })

  it('is registered as version 23 and adds the entries topic2 column', () => {
    expect(MIGRATIONS[22].version).toBe(23)
    expect(MIGRATIONS[22].name).toBe('entry_topic2')
    expect(MIGRATIONS[22].statements).toEqual([
      'ALTER TABLE entries ADD COLUMN topic2 TEXT',
    ])
  })

  it('is registered as version 25 and wipes both embedding caches for the model swap', () => {
    const m = MIGRATIONS.find((mig) => mig.version === 25)!
    expect(m).toBeDefined()
    expect(m.name).toBe('wipe_embeddings_for_gemma')
    // The stale 384-dim bge/MiniLM vectors are incompatible with the 768-dim
    // EmbeddingGemma model. Both tables are unsynced derived caches, so a clean
    // wipe is safe — the existing backfill repopulates them on next launch.
    expect(m.statements).toEqual([
      'DELETE FROM entity_embeddings',
      'DELETE FROM page_embeddings',
    ])
  })
})
