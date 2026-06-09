import { type Migration } from './migrations'

// Migration 001 — initial schema. Structure (PKs, types, CHECK/UNIQUE constraints)
// is locked here because SQLite can't ALTER those later without a table rebuild.
// Optional/feature columns (FTS5, sync/device fields, digests) are deferred to the
// phase that needs them via new migrations.
export const migration001: Migration = {
  version: 1,
  name: 'initial_schema',
  statements: [
    // entries — immutable; CBT 5-step + nullable fast-model tags (a failed
    // tagging must never block the save — ADR 004)
    `CREATE TABLE entries (
      id           TEXT PRIMARY KEY,
      created_at   INTEGER NOT NULL,
      mood         INTEGER NOT NULL CHECK (mood BETWEEN 1 AND 5),
      situation    TEXT NOT NULL,
      thought      TEXT NOT NULL,
      behavior     TEXT,
      closing_note TEXT,
      emotion      TEXT,
      distortion   TEXT,
      mood_score   REAL,
      tagged_at    INTEGER
    )`,

    // wiki_pages — mutable, versioned markdown
    `CREATE TABLE wiki_pages (
      id              TEXT PRIMARY KEY,
      title           TEXT NOT NULL,
      category        TEXT,
      content         TEXT NOT NULL DEFAULT '',
      entry_count     INTEGER NOT NULL DEFAULT 0,
      version         INTEGER NOT NULL DEFAULT 1,
      version_history TEXT NOT NULL DEFAULT '[]',
      created_at      INTEGER NOT NULL,
      updated_at      INTEGER NOT NULL
    )`,

    // graph_nodes — size = frequency
    `CREATE TABLE graph_nodes (
      id         TEXT PRIMARY KEY,
      type       TEXT NOT NULL CHECK (type IN
                 ('emotion','situation','person','belief','behavior','distortion')),
      label      TEXT NOT NULL,
      frequency  INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE (type, label)
    )`,

    // graph_edges — additive-only; isDashed (weight < 4) derived in app
    `CREATE TABLE graph_edges (
      id         TEXT PRIMARY KEY,
      source_id  TEXT NOT NULL REFERENCES graph_nodes(id),
      target_id  TEXT NOT NULL REFERENCES graph_nodes(id),
      weight     INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE (source_id, target_id)
    )`,

    `CREATE TABLE settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )`,

    // sync_queue — records pending E2E-encrypted upload
    `CREATE TABLE sync_queue (
      id         TEXT PRIMARY KEY,
      table_name TEXT NOT NULL,
      record_id  TEXT NOT NULL,
      operation  TEXT NOT NULL CHECK (operation IN ('upsert','delete')),
      created_at INTEGER NOT NULL,
      synced_at  INTEGER
    )`,

    // crisis_events — tier + confidence only; never stores entry text
    `CREATE TABLE crisis_events (
      id         TEXT PRIMARY KEY,
      entry_id   TEXT REFERENCES entries(id),
      tier       INTEGER NOT NULL CHECK (tier BETWEEN 1 AND 3),
      confidence REAL NOT NULL,
      created_at INTEGER NOT NULL
    )`,

    `CREATE INDEX idx_entries_created_at ON entries (created_at)`,
    `CREATE INDEX idx_entries_tagged_at ON entries (tagged_at)`,
    `CREATE INDEX idx_wiki_pages_category ON wiki_pages (category)`,
    `CREATE INDEX idx_graph_edges_source ON graph_edges (source_id)`,
    `CREATE INDEX idx_graph_edges_target ON graph_edges (target_id)`,
    `CREATE INDEX idx_sync_queue_synced_at ON sync_queue (synced_at)`,
  ],
}

// Migration 002 — persist the fast-model topic on entries. Topic was transient
// (used only at tag time), so the derived graph's theme/situation nodes couldn't
// be rebuilt on another device. Storing it lets the graph rebuild deterministically
// + consistently across devices. (Entries created before this stay topic=NULL.)
export const migration002: Migration = {
  version: 2,
  name: 'entry_topic',
  statements: ['ALTER TABLE entries ADD COLUMN topic TEXT'],
}

// Migration 003 — richer entity extraction. Adds a normalized entry_entities
// table (people / places / activities pulled from an entry) and widens the
// graph_nodes type CHECK to include 'place'/'activity'. SQLite can't ALTER a
// CHECK in place, so graph_nodes/graph_edges are dropped + recreated; the graph
// is derived, so rebuildGraph() (run after this migration / on next sync) fully
// repopulates it from entries + entry_entities. Pre-existing pages/entries are
// untouched.
export const migration003: Migration = {
  version: 3,
  name: 'entry_entities',
  statements: [
    // Normalized entities, write-once per entry (re-tagging replaces the set).
    `CREATE TABLE entry_entities (
      id         TEXT PRIMARY KEY,
      entry_id   TEXT NOT NULL REFERENCES entries(id),
      type       TEXT NOT NULL CHECK (type IN ('person','place','activity')),
      label      TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      UNIQUE (entry_id, type, label)
    )`,
    `CREATE INDEX idx_entry_entities_type_label ON entry_entities (type, label)`,
    `CREATE INDEX idx_entry_entities_entry ON entry_entities (entry_id)`,

    // Widen the node-type CHECK by rebuilding the derived graph tables.
    `DROP TABLE graph_edges`,
    `DROP TABLE graph_nodes`,
    `CREATE TABLE graph_nodes (
      id         TEXT PRIMARY KEY,
      type       TEXT NOT NULL CHECK (type IN
                 ('emotion','situation','person','belief','behavior','distortion','place','activity')),
      label      TEXT NOT NULL,
      frequency  INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE (type, label)
    )`,
    `CREATE TABLE graph_edges (
      id         TEXT PRIMARY KEY,
      source_id  TEXT NOT NULL REFERENCES graph_nodes(id),
      target_id  TEXT NOT NULL REFERENCES graph_nodes(id),
      weight     INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE (source_id, target_id)
    )`,
    `CREATE INDEX idx_graph_edges_source ON graph_edges (source_id)`,
    `CREATE INDEX idx_graph_edges_target ON graph_edges (target_id)`,
  ],
}
