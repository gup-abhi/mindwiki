// In-memory SQLite fake for F-02C maintenance runner tests. Parses the exact
// statements the runner issues. Supports INSERT / UPDATE / SELECT over
// entry_entities, belief_reframes, belief_maintenance_state, sync_queue,
// settings, wiki_pages (read-only), entity_embeddings (read-only, empty).
// transaction(fn) snapshots every map so a throw inside fn rolls back.

export interface FakeState {
  entry_entities: Map<string, Record<string, unknown>> // keyed by id
  belief_reframes: Map<string, Record<string, unknown>> // keyed by id
  belief_maintenance_state: Map<string, Record<string, unknown>> // keyed by key
  sync_queue: Map<string, Record<string, unknown>> // by composite id
  settings: Map<string, string>
  wiki_pages: Map<string, Record<string, unknown>> // keyed by id (read-only for runner)
  // Stored belief embeddings keyed by raw label. JSON `vector` column. Lets
  // tests inject near-synonym vectors above the threshold so buildAliasClusters
  // clusters them via the real cosine path (rather than the exact strip fallback).
  entity_embeddings: Map<string, Record<string, unknown>> // keyed by label
}

export function createFakeDb(initial: Partial<FakeState> = {}) {
  const state: FakeState = {
    entry_entities: new Map(initial.entry_entities ?? []),
    belief_reframes: new Map(initial.belief_reframes ?? []),
    belief_maintenance_state: new Map(initial.belief_maintenance_state ?? []),
    sync_queue: new Map(initial.sync_queue ?? []),
    settings: new Map(initial.settings ?? []),
    wiki_pages: new Map(initial.wiki_pages ?? []),
    entity_embeddings: new Map(initial.entity_embeddings ?? []),
  }

  const executed: string[] = []
  const enqueueLog: { table: string; id: string }[] = []
  let failNextUpdateOn: string | null = null
  let failNextUpdateBelief: string | null = null // match a specific raw belief label

  function failNextUpdate(table: string, belief?: string) {
    failNextUpdateOn = table
    failNextUpdateBelief = belief ?? null
  }

  function maybeThrow(table: string) {
    if (failNextUpdateOn === table) {
      failNextUpdateOn = null
      failNextUpdateBelief = null
      throw new Error('forced UPDATE failure on ' + table)
    }
  }

  const db: any = {
    execute(sql: string, params: any[] = []) {
      const s = sql.trim().replace(/\s+/g, ' ')
      executed.push(s)

      // entry_entities INSERT [OR REPLACE]
      if (/^INSERT (OR REPLACE )?INTO entry_entities \(/i.test(s) && /VALUES/i.test(s)) {
        const colsMatch = s.match(/\(([\w_, ]+)\)\s*VALUES/i)
        const cols = colsMatch![1].split(',').map((c) => c.trim())
        const row: Record<string, unknown> = {}
        for (let i = 0; i < cols.length; i++) row[cols[i]] = params[i]
        const id = String(row.id)
        state.entry_entities.set(id, row)
        return { rows: [row], rowsAffected: 1 }
      }
      if (/^UPDATE entry_entities SET canonical_label = \?, updated_at = MAX\(updated_at, \?\) WHERE id = \?/i.test(s)) {
        maybeThrow('entry_entities')
        const [canon, now, rowId] = params
        const row = state.entry_entities.get(String(rowId))
        if (row) {
          row.canonical_label = canon
          row.updated_at = Math.max(Number(row.updated_at) || 0, Number(now) || 0)
        }
        return { rows: [], rowsAffected: row ? 1 : 0 }
      }
      if (/^UPDATE entry_entities SET canonical_label = \?, updated_at = \? WHERE id IN \(/i.test(s)) {
        maybeThrow('entry_entities')
        const [canon, now, ...ids] = params
        let n = 0
        for (const id of ids as string[]) {
          const row = state.entry_entities.get(id)
          if (row) {
            row.canonical_label = canon
            row.updated_at = Math.max(Number(row.updated_at) || 0, Number(now) || 0)
            n++
          }
        }
        return { rows: [], rowsAffected: n }
      }
      if (/^UPDATE entry_entities SET canonical_label = \?, updated_at = MAX\(updated_at, \?\) WHERE type = 'belief' AND LOWER\(label\) IN \(/i.test(s)) {
        // Force throw only when a specific belief label is being retired.
        const labels = params.slice(3).map((p) => String(p).toLowerCase())
        if (failNextUpdateOn === 'entry_entities' && (failNextUpdateBelief == null || labels.includes(failNextUpdateBelief.toLowerCase()))) {
          failNextUpdateOn = null
          failNextUpdateBelief = null
          throw new Error('forced UPDATE failure')
        }
        const [canon, now, , ...idsOrLabels] = params
        const matchLabels = (idsOrLabels as string[]).map((x) => x.toLowerCase())
        let n = 0
        for (const row of state.entry_entities.values()) {
          if (row.type === 'belief' && matchLabels.includes(String(row.label).toLowerCase())) {
            row.canonical_label = canon
            row.updated_at = Math.max(Number(row.updated_at) || 0, Number(now) || 0)
            n++
          }
        }
        return { rows: [], rowsAffected: n }
      }
      if (/^SELECT label, MIN\(created_at\) AS first_seen, COUNT\(DISTINCT entry_id\) AS entry_count FROM entry_entities WHERE type = 'belief' GROUP BY label COLLATE NOCASE/i.test(s)) {
        const byLabel = new Map<string, Record<string, unknown>>()
        for (const r of state.entry_entities.values()) {
          if (r.type !== 'belief') continue
          const k = String(r.label).toLowerCase()
          const ex = byLabel.get(k)
          if (!ex) byLabel.set(k, { label: r.label, first_seen: r.created_at, entry_count: 1 })
          else {
            ex.first_seen = Math.min(Number(ex.first_seen), Number(r.created_at))
            ex.entry_count = (ex.entry_count as number) + 1
          }
        }
        return { rows: [...byLabel.values()], rowsAffected: 0 }
      }
      if (/^SELECT label, canonical_label FROM entry_entities WHERE type = 'belief' AND canonical_label IS NOT NULL/i.test(s)) {
        return { rows: [...state.entry_entities.values()].filter((r) => r.canonical_label != null), rowsAffected: 0 }
      }
      // Runner: lookup id of belief entities by lowercase label.
      if (/^SELECT id FROM entry_entities WHERE type = 'belief' AND LOWER\(label\) = \?/i.test(s)) {
        const label = String(params[0]).toLowerCase()
        return { rows: [...state.entry_entities.values()].filter((r) => r.type === 'belief' && String(r.label).toLowerCase() === label).map((r) => ({ id: r.id })), rowsAffected: 0 }
      }

      // belief_reframes
      if (/^INSERT INTO belief_reframes \(/i.test(s) && /VALUES/i.test(s)) {
        const cols = s.match(/\(([\w_, ]+)\)\s*VALUES/i)![1].split(',').map((c) => c.trim())
        const row: Record<string, unknown> = {}
        for (let i = 0; i < cols.length; i++) row[cols[i]] = params[i]
        state.belief_reframes.set(String(row.id), row)
        return { rows: [row], rowsAffected: 1 }
      }
      if (/^UPDATE belief_reframes SET belief = \?, updated_at = \? WHERE belief = \? COLLATE NOCASE/i.test(s)) {
        maybeThrow('belief_reframes')
        const [canon, now, fromRaw] = params
        let n = 0
        for (const r of state.belief_reframes.values()) {
          if (String(r.belief).toLowerCase() === String(fromRaw).toLowerCase()) {
            r.belief = canon
            r.updated_at = Math.max(Number(r.updated_at) || 0, Number(now) || 0)
            n++
          }
        }
        return { rows: [], rowsAffected: n }
      }
      if (/^SELECT \* FROM belief_reframes WHERE belief = \? COLLATE NOCASE ORDER BY created_at DESC/i.test(s)) {
        return {
          rows: [...state.belief_reframes.values()].filter((r) => String(r.belief).toLowerCase() === String(params[0]).toLowerCase()),
          rowsAffected: 0,
        }
      }
      if (/^SELECT id FROM belief_reframes WHERE belief = \? COLLATE NOCASE/i.test(s)) {
        return {
          rows: [...state.belief_reframes.values()].filter((r) => String(r.belief).toLowerCase() === String(params[0]).toLowerCase()).map((r) => ({ id: r.id })),
          rowsAffected: 0,
        }
      }

      // belief_maintenance_state
      if (/^SELECT \* FROM belief_maintenance_state WHERE key = \?/i.test(s)) {
        return { rows: state.belief_maintenance_state.has(String(params[0])) ? [state.belief_maintenance_state.get(String(params[0]))!] : [], rowsAffected: 0 }
      }
      if (/^INSERT INTO belief_maintenance_state .*VALUES.*ON CONFLICT\(key\) DO NOTHING/i.test(s)) {
        if (!state.belief_maintenance_state.has('belief')) {
          state.belief_maintenance_state.set('belief', {
            key: 'belief', algorithm_version: 0, source_generation: 0, processed_generation: 0,
            status: 'idle', last_run_at: null, repaired_clusters: 0, deferred_clusters: 0, consolidated_clusters: 0, run_count: 0,
          })
        }
        return { rows: [], rowsAffected: 0 }
      }
      if (/^UPDATE belief_maintenance_state SET source_generation = source_generation \+ 1 WHERE key = \?/i.test(s)) {
        const row = state.belief_maintenance_state.get(String(params[0]))
        if (row) row.source_generation = Number(row.source_generation) + 1
        return { rows: [], rowsAffected: row ? 1 : 0 }
      }
      if (/^SELECT source_generation FROM belief_maintenance_state WHERE key = \?/i.test(s)) {
        const row = state.belief_maintenance_state.get(String(params[0]))
        return { rows: row ? [{ source_generation: row.source_generation }] : [], rowsAffected: 0 }
      }
      if (/^INSERT INTO belief_maintenance_state .*ON CONFLICT\(key\) DO UPDATE SET/i.test(s)) {
        const setClause = s.match(/DO UPDATE SET (.+)$/i)![1].trim()
        const colList = s.match(/\((key, [\w_, ]+)\)\s*VALUES/i)![1].split(',').map((c) => c.trim())
        let row = state.belief_maintenance_state.get('belief')
        if (!row) {
          row = {
            key: 'belief', algorithm_version: 0, source_generation: 0, processed_generation: 0,
            status: 'idle', last_run_at: null, repaired_clusters: 0, deferred_clusters: 0, consolidated_clusters: 0, run_count: 0,
          }
          state.belief_maintenance_state.set('belief', row)
        }
        const fieldCount = colList.length - 1
        const insertVals = params.slice(1, 1 + fieldCount)
        for (let i = 0; i < fieldCount; i++) {
          const col = colList[1 + i]
          if (insertVals[i] != null) (row as any)[col] = insertVals[i]
        }
        const assigns = setClause.split(',').map((a) => a.trim().split(' = ')[0].trim())
        const setVals = params.slice(1 + fieldCount)
        for (let i = 0; i < assigns.length; i++) (row as any)[assigns[i]] = setVals[i]
        return { rows: [], rowsAffected: 1 }
      }

      // sync_queue
      if (/^INSERT OR REPLACE INTO sync_queue \(/i.test(s) && /VALUES/i.test(s)) {
        const cols = s.match(/\(([\w_, ]+)\)\s*VALUES/i)![1].split(',').map((c) => c.trim())
        const row: Record<string, unknown> = {}
        for (let i = 0; i < cols.length; i++) row[cols[i]] = params[i]
        const composite = `${row.table_name}:${row.record_id}`
        state.sync_queue.set(composite, row)
        enqueueLog.push({ table: String(row.table_name), id: String(row.record_id) })
        return { rows: [], rowsAffected: 1 }
      }

      // settings
      if (/^SELECT value FROM settings WHERE key = \?/i.test(s)) {
        return { rows: state.settings.has(String(params[0])) ? [{ value: state.settings.get(String(params[0])) }] : [], rowsAffected: 0 }
      }
      if (/^INSERT INTO settings .*ON CONFLICT\(key\) DO UPDATE SET value = excluded.value/i.test(s)) {
        state.settings.set(String(params[0]), String(params[1]))
        return { rows: [], rowsAffected: 1 }
      }
      // settings DELETE (used by maintenance runner to clear graph-rebuild marker)
      if (/^DELETE FROM settings WHERE key = \?/i.test(s)) {
        state.settings.delete(String(params[0]))
        return { rows: [], rowsAffected: 0 }
      }

      // wiki_pages (read-only for runner) — belief category
      if (/^SELECT \* FROM wiki_pages WHERE category = 'belief'/i.test(s)) {
        return { rows: [...state.wiki_pages.values()].filter((p) => p.category === 'belief' || p.category == null), rowsAffected: 0 }
      }
      // Slice 8 consolidation — mark loser merged_into survivor.
      if (/^UPDATE wiki_pages SET merged_into = \?, updated_at = MAX\(updated_at \+ 1, \?\) WHERE id = \?/i.test(s)) {
        const [survivorId, now, loserId] = params
        const row = state.wiki_pages.get(String(loserId))
        if (row) {
          row.merged_into = String(survivorId)
          row.updated_at = Math.max(Number(row.updated_at) || 0, Number(now) || 0)
        }
        return { rows: [], rowsAffected: row ? 1 : 0 }
      }
      // Slice 8 consolidation — set survivor entry_count + regrounded_upto.
      if (/^UPDATE wiki_pages SET entry_count = \?, regrounded_upto = \?, updated_at = MAX\(updated_at \+ 1, \?\) WHERE id = \?/i.test(s)) {
        const [count, regroundUpto, now, pageId] = params
        const row = state.wiki_pages.get(String(pageId))
        if (row) {
          row.entry_count = Number(count)
          row.regrounded_upto = Number(regroundUpto)
          row.updated_at = Math.max(Number(row.updated_at) || 0, Number(now) || 0)
        }
        return { rows: [], rowsAffected: row ? 1 : 0 }
      }

      // entity_embeddings (read-only) — store label+vector JSON.
      if (/^SELECT label, type, vector FROM entity_embeddings WHERE type = \?/i.test(s)) {
        const out: Record<string, unknown>[] = []
        for (const [label, row] of state.entity_embeddings) out.push({ label, type: row.type ?? 'belief', vector: row.vector })
        return { rows: out, rowsAffected: 0 }
      }

      throw new Error('UNHANDLED SQL: ' + s)
    },
    async transaction<T>(fn: (tx: any) => Promise<T>): Promise<T> {
      const snap = new Map<string, Map<string, Record<string, unknown>>>()
      for (const [k, m] of Object.entries(state)) snap.set(k, new Map([...(m as Map<string, Record<string, unknown>>)].map(([id, r]) => [id, { ...r }])))
      try {
        return await fn(db)
      } catch (e) {
        for (const [k, m] of snap) (state as any)[k] = m
        throw e
      }
    },
    close() {},
  }

  return { db, state, executed, enqueueLog, failNextUpdate }
}
