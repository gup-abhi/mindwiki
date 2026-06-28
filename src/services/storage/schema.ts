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

// Migration 004 — reflective conversations. Persists the revamped "Ask" feature:
// a saved, resumable chat between the user and the grounded companion. Both
// tables sync as encrypted blobs (content never leaves the device in plaintext).
// chat_messages are append-only; conversations carry updated_at for last-write-wins.
export const migration004: Migration = {
  version: 4,
  name: 'conversations',
  statements: [
    `CREATE TABLE conversations (
      id         TEXT PRIMARY KEY,
      title      TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`,
    // role limited to the two turns we persist; sources_json holds [{id,title}]
    // for citation chips; crisis_tier is set on user messages that tripped a tier.
    `CREATE TABLE chat_messages (
      id              TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL REFERENCES conversations(id),
      role            TEXT NOT NULL CHECK (role IN ('user','assistant')),
      content         TEXT NOT NULL,
      sources_json    TEXT NOT NULL DEFAULT '[]',
      crisis_tier     INTEGER,
      created_at      INTEGER NOT NULL
    )`,
    `CREATE INDEX idx_chat_messages_conversation ON chat_messages (conversation_id, created_at)`,
  ],
}

// Migration 005 — entry provenance. Reflect-chat messages that surface durable
// new info (a person/place/activity or theme the journal hasn't recorded) are
// captured as entries so they feed entity recurrence + the graph + the wiki,
// like journal entries. `source` distinguishes them: 'journal' (the CBT flow,
// shown in the timeline) vs 'reflect' (chat-derived, filtered out of it).
// Pre-existing rows default to 'journal'.
export const migration005: Migration = {
  version: 5,
  name: 'entry_source',
  statements: [`ALTER TABLE entries ADD COLUMN source TEXT NOT NULL DEFAULT 'journal'`],
}

// Migration 006 — conversation memory. A resumed chat can run past the model's
// context window, so it keeps a rolling `summary` of the turns that fall out of
// the recent window; `summary_count` records how many messages that summary
// already covers (so each turn only folds in the newly-evicted ones). Synced as
// ciphertext like the rest of the conversation.
export const migration006: Migration = {
  version: 6,
  name: 'conversation_summary',
  statements: [
    `ALTER TABLE conversations ADD COLUMN summary TEXT NOT NULL DEFAULT ''`,
    `ALTER TABLE conversations ADD COLUMN summary_count INTEGER NOT NULL DEFAULT 0`,
  ],
}

// Migration 007 — pursuits. Things the user is actively working on (a goal /
// project / effort), extracted from entries + Reflect chats. Unlike graph nodes
// (frequency-based, additive) or wiki pages (timeless), a pursuit is temporal:
// `status` tracks its lifecycle and the *_at timestamps drive periodic check-ins
// ("how's X going?"). `details` is a deep-model summary; `checkin_question` is
// the pre-generated prompt the Home card surfaces. Synced as ciphertext.
export const migration007: Migration = {
  version: 7,
  name: 'pursuits',
  statements: [
    `CREATE TABLE pursuits (
      id                TEXT PRIMARY KEY,
      title             TEXT NOT NULL,
      details           TEXT NOT NULL DEFAULT '',
      status            TEXT NOT NULL DEFAULT 'active'
                          CHECK (status IN ('active','done','abandoned','dormant')),
      checkin_question  TEXT NOT NULL DEFAULT '',
      wiki_page_id      TEXT REFERENCES wiki_pages(id),
      created_at        INTEGER NOT NULL,
      updated_at        INTEGER NOT NULL,
      last_mentioned_at INTEGER NOT NULL,
      last_checkin_at   INTEGER
    )`,
    `CREATE INDEX idx_pursuits_status ON pursuits (status, last_mentioned_at)`,
  ],
}

// Migration 008 — challenges. An explicit, user-declared 30-day challenge (e.g.
// "work out every day"). Unlike pursuits (implicit, open-ended, auto-detected),
// a challenge is bounded and daily: the user taps "I did it" each day and the
// streak builds toward `target_days`. A missed day hard-resets the streak (see
// challenges.ts). `last_checkin_date` is a local 'YYYY-MM-DD' string (not an
// epoch) so streak math is calendar-day based regardless of time-of-day.
// `affirmation` is the reward unlocked on completion; the user may then promote
// it to the cover screen. Synced as ciphertext.
export const migration008: Migration = {
  version: 8,
  name: 'challenges',
  statements: [
    `CREATE TABLE challenges (
      id                TEXT PRIMARY KEY,
      title             TEXT NOT NULL,
      details           TEXT NOT NULL DEFAULT '',
      target_days       INTEGER NOT NULL DEFAULT 30,
      current_streak    INTEGER NOT NULL DEFAULT 0,
      last_checkin_date TEXT NOT NULL DEFAULT '',
      status            TEXT NOT NULL DEFAULT 'active'
                          CHECK (status IN ('active','completed')),
      affirmation       TEXT NOT NULL DEFAULT '',
      created_at        INTEGER NOT NULL,
      updated_at        INTEGER NOT NULL,
      completed_at      INTEGER
    )`,
    `CREATE INDEX idx_challenges_status ON challenges (status, updated_at)`,
  ],
}

// Migration 009 — let the user drop a wrong wiki insight. dismissed_at marks a
// page the user flagged as inaccurate: it's excluded from retrieval grounding
// (Reflect, suggested questions) and the wiki list, so it stops shaping future
// interactions. Soft + reversible (restore sets it back to NULL); a new entry on
// the topic re-synthesizes the page fresh and clears the flag (self-heals).
export const migration009: Migration = {
  version: 9,
  name: 'wiki_page_dismissal',
  statements: [`ALTER TABLE wiki_pages ADD COLUMN dismissed_at INTEGER`],
}

// Migration 010 — correct-with-replacement. Lets the user rewrite a wrong insight
// in their own words instead of only dropping it. corrected_at marks a page whose
// content is the user's text: future synthesis builds on it (the engine uses the
// current content as its base) so the correction compounds forward. The flag is
// cleared on the next synthesis (updatePage) — once a new entry merges in, the
// content is no longer purely the user's words.
export const migration010: Migration = {
  version: 10,
  name: 'wiki_page_correction',
  statements: [`ALTER TABLE wiki_pages ADD COLUMN corrected_at INTEGER`],
}

// Migration 011 — let the user drop a wrong graph node. The graph is derived:
// rebuildGraph() wipes graph_nodes/graph_edges and re-derives them from entries
// on every sync pull, and node ids are regenerated each time. So a suppression
// flag can't live on the node row (wiped) or key on its id (regenerated) — it
// lives in its own table, keyed by stable identity (type + label), which the
// derivation honors. Soft + reversible: dismissed_at NULL means restored; the
// row persists so it syncs last-write-wins like the wiki dismissal.
export const migration011: Migration = {
  version: 11,
  name: 'graph_node_dismissal',
  statements: [
    `CREATE TABLE graph_node_dismissals (
      id           TEXT PRIMARY KEY,
      type         TEXT NOT NULL,
      label        TEXT NOT NULL,
      dismissed_at INTEGER,
      updated_at   INTEGER NOT NULL
    )`,
  ],
}

// Migration 012 — belief/behavior entities. The deep model now also extracts the
// underlying beliefs and recurring behaviors from an entry; they flow through the
// same entry_entities path as people/places/activities (graph_nodes already
// allows the 'belief'/'behavior' types since migration 003). SQLite can't ALTER a
// CHECK in place, so the (source-data) table is rebuilt preserving its rows: the
// old indexes are dropped with the old table, then recreated on the new one.
export const migration012: Migration = {
  version: 12,
  name: 'entity_beliefs_behaviors',
  statements: [
    `ALTER TABLE entry_entities RENAME TO entry_entities_old`,
    `CREATE TABLE entry_entities (
      id         TEXT PRIMARY KEY,
      entry_id   TEXT NOT NULL REFERENCES entries(id),
      type       TEXT NOT NULL CHECK (type IN ('person','place','activity','belief','behavior')),
      label      TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      UNIQUE (entry_id, type, label)
    )`,
    `INSERT INTO entry_entities (id, entry_id, type, label, created_at)
       SELECT id, entry_id, type, label, created_at FROM entry_entities_old`,
    `DROP TABLE entry_entities_old`,
    `CREATE INDEX idx_entry_entities_type_label ON entry_entities (type, label)`,
    `CREATE INDEX idx_entry_entities_entry ON entry_entities (entry_id)`,
  ],
}

// Migration 013 — belief reframes. A user-authored CBT thought-record that
// challenges a recurring belief: evidence for / against it and a more balanced
// thought. Keyed by the belief `label` (its stable identity — the belief graph
// node + wiki page share it), not a page id, since the graph is rebuilt and node
// ids regenerate. Synced as ciphertext (user-authored, last-write-wins by
// updated_at) so a reframe survives a device switch.
export const migration013: Migration = {
  version: 13,
  name: 'belief_reframes',
  statements: [
    `CREATE TABLE belief_reframes (
      id               TEXT PRIMARY KEY,
      belief           TEXT NOT NULL,
      evidence_for     TEXT NOT NULL DEFAULT '',
      evidence_against TEXT NOT NULL DEFAULT '',
      balanced_thought TEXT NOT NULL,
      created_at       INTEGER NOT NULL,
      updated_at       INTEGER NOT NULL
    )`,
    `CREATE INDEX idx_belief_reframes_belief ON belief_reframes (belief)`,
  ],
}

// Migration 014 — page merge marker. When topic de-duplication collapses
// "relationships" into "relationship", the losing page is consolidated, not
// rejected by the user — so it must NOT appear in "Dropped insights" (that list
// is for pages the user dropped). merged_into holds the survivor's id and hides
// the page from both the active wiki and the dismissed list. Synced so the merge
// propagates between devices.
export const migration014: Migration = {
  version: 14,
  name: 'wiki_page_merge',
  statements: [`ALTER TABLE wiki_pages ADD COLUMN merged_into TEXT`],
}

// Migration 015 — streak freezes. A freeze the user deliberately spends to save a
// streak after a missed day. One row per frozen day (id = the day index). The
// streak count is derived from entries ∪ these days, so the choice must persist
// and sync. Additive — like graph_node_dismissals, it travels last-write-wins.
export const migration015: Migration = {
  version: 15,
  name: 'streak_freezes',
  statements: [
    `CREATE TABLE streak_freezes (
      id         TEXT PRIMARY KEY,
      day_index  INTEGER NOT NULL,
      frozen_at  INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`,
  ],
}

// Migration 016 — wiki page embeddings. A semantic vector per wiki page so
// Reflect can ground a terse or differently-worded message in the right page
// (hybrid lexical + semantic retrieval). Derived, device-local, and NOT synced:
// the vector depends on the on-device embedding model, so each device computes
// its own and a device without the model just falls back to lexical ranking.
// `vector` is a JSON array of floats (TEXT) — small (≤~3KB/page) and avoids
// plumbing BLOB params through the storage layer. `content_hash` lets backfill
// re-embed only pages whose content actually changed.
export const migration016: Migration = {
  version: 16,
  name: 'page_embeddings',
  statements: [
    `CREATE TABLE page_embeddings (
      page_id      TEXT PRIMARY KEY,
      dim          INTEGER NOT NULL,
      vector       TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      updated_at   INTEGER NOT NULL
    )`,
  ],
}

// Migration 017 — named emotion. The user now names a feeling at capture (a
// compulsory single tap). `emotion` stays the model's inferred feeling (it drives
// the graph + wiki); this column holds the user's conscious self-label, kept even
// when it differs from the model's read. The gap between named and inferred is the
// raw material for a future "emotion disguise" insight (parallel to mood vs
// mood_score). User-authored — synced like mood.
export const migration017: Migration = {
  version: 17,
  name: 'named_emotion',
  statements: [`ALTER TABLE entries ADD COLUMN named_emotion TEXT`],
}
