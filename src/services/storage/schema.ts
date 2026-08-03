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

// Migration 018 — energy axis. Capture moved to an energy×pleasantness grid: the
// horizontal axis stays `mood` (1–5 pleasantness, unchanged semantics) and this
// column adds the vertical axis — arousal/energy 1–5. Lets the digest tell a
// "wired" tough day (high energy: anxious/angry) from a "flat" one (low energy:
// sad/tired). Nullable for pre-grid entries; synced like the other entry fields.
export const migration018: Migration = {
  version: 18,
  name: 'entry_energy',
  statements: [`ALTER TABLE entries ADD COLUMN energy INTEGER`],
}

// Migration 019 — wiki self-heal marker. `tagged_at` is stamped before the
// fire-and-forget wiki synthesis runs, so an entry killed mid-synthesis looks
// "indexed" and the tagged_at-keyed catch-up never revisits it. This column is
// set only once wiki synthesis actually resolves, letting catch-up find entries
// that were tagged but never synthesized. Device-local (NOT in the sync column
// allowlist). Backfill trusts already-tagged rows' wiki ran, so upgrading doesn't
// trigger a re-synthesis storm.
export const migration019: Migration = {
  version: 19,
  name: 'entry_wiki_indexed_at',
  statements: [
    `ALTER TABLE entries ADD COLUMN wiki_indexed_at INTEGER`,
    `UPDATE entries SET wiki_indexed_at = tagged_at WHERE tagged_at IS NOT NULL`,
  ],
}

// Migration 020 — graph self-heal marker. Parallel to wiki_indexed_at: the graph
// step is also fire-and-forget after tagging, so an entry killed before its graph
// contribution was written looks "indexed" and nothing revisits it. Set once the
// graph step resolves. Healed by a full rebuildGraph() (additive edges forbid a
// safe per-entry re-run). Device-local (NOT synced). Backfill trusts already-
// tagged rows' graph ran, so upgrading doesn't force a rebuild.
export const migration020: Migration = {
  version: 20,
  name: 'entry_graph_indexed_at',
  statements: [
    `ALTER TABLE entries ADD COLUMN graph_indexed_at INTEGER`,
    `UPDATE entries SET graph_indexed_at = tagged_at WHERE tagged_at IS NOT NULL`,
  ],
}

// Migration 021 — Reflect capture provenance. A qualifying chat message is now
// distilled into a self-contained restatement before it becomes the entry's
// `situation` (raw fragments like "yeah exactly, and it's worse at night" were
// grounding permanent wiki pages). The original message is kept here so nothing
// the user actually said is lost. Null for journal/path entries. Synced (it is
// user content like situation — same encryption).
export const migration021: Migration = {
  version: 21,
  name: 'entry_raw_text',
  statements: [`ALTER TABLE entries ADD COLUMN raw_text TEXT`],
}

// Migration 023 — second topic for multi-theme entries. An entry about work
// stress bleeding into the marriage now contributes to both pages, not just one.
// The primary topic stays in `topic` (backward-compat, graph situation nodes, all
// existing queries); `topic2` holds the secondary theme. Nullable. Synced.
export const migration023: Migration = {
  version: 23,
  name: 'entry_topic2',
  statements: [`ALTER TABLE entries ADD COLUMN topic2 TEXT`],
}

// Migration 024 — aggregated_upto column for emotion aggregate tracking.
// Emotion pages skip per-entry synthesis in favour of periodic aggregate
// synthesis from entry data. aggregated_upto records the entry_count at which
// the last aggregate was applied, so we only re-synthesise when enough new
// entries have accumulated (AGGREGATE_BATCH_SIZE = 10). Default 0 means the
// first aggregate will consider all existing entries.
export const migration024: Migration = {
  version: 24,
  name: 'emotion_page_aggregated_upto',
  statements: [
    `ALTER TABLE wiki_pages ADD COLUMN aggregated_upto INTEGER NOT NULL DEFAULT 0`,
  ],
}

// Migration 022 — entity embeddings for semantic belief canonicalization. One
// row per entity label+type, storing the bge-small vector and a content hash
// so re-embedding only needs to run on labels not yet stored. NOT synced (the
// vector depends on this device's embedding model, like page_embeddings).
export const migration022: Migration = {
  version: 22,
  name: 'entity_embeddings',
  statements: [
    `CREATE TABLE IF NOT EXISTS entity_embeddings (
      label TEXT NOT NULL,
      type TEXT NOT NULL,
      dim INTEGER NOT NULL,
      vector TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (label, type)
    )`,
  ],
}

// Migration 025 — wipe embedding caches for the EmbeddingGemma swap. The embed
// model changed from bge-small/MiniLM (384-dim) to EmbeddingGemma-300m (768-dim),
// so every stored vector is now the wrong dimensionality. cosine() returns 0 on a
// length mismatch (safe, no false matches), but backfill hashes the label/content
// — model-independent — so it would skip these stale rows forever and never
// re-embed them. Both tables are device-local, unsynced, derived caches, so a
// clean DELETE is safe: the existing backfill (backfillStaleEmbeddings +
// backfillBeliefEmbeddings, run on next launch) repopulates them at 768-dim.
export const migration025: Migration = {
  version: 25,
  name: 'wipe_embeddings_for_gemma',
  statements: [
    'DELETE FROM entity_embeddings',
    'DELETE FROM page_embeddings',
  ],
}

// Migration 026 — re-embed belief labels under the frame-stripped geometry.
// snapBeliefSemantic now strips the leading "I am [not] …" frame before embedding
// so content words separate distinct beliefs (the STS prefix over-weighted the
// shared frame, inverting the window). Stored belief vectors were embedded from the
// full label, so they're in the old geometry; backfill hashes the raw label (model-
// independent) and would skip them forever. Delete the belief rows so the next-
// launch backfillBeliefEmbeddings re-embeds them stripped. Only 'belief' — page and
// other entity embeddings are unaffected.
export const migration026: Migration = {
  version: 26,
  name: 'reembed_beliefs_frame_stripped',
  statements: [
    "DELETE FROM entity_embeddings WHERE type = 'belief'",
  ],
}

// Migration 027 — re-embed belief labels AGAIN under the stripped geometry.
// migration026 wiped the belief rows, but backfillBeliefEmbeddings was still
// calling embedText (raw label) at the time, so the repopulated vectors landed
// in the OLD un-stripped geometry — mismatched against the stripped snap query.
// backfillBeliefEmbeddings now embeds via embedBeliefLabel (stripped); this wipe
// forces the corrected backfill to re-embed all belief rows stripped. 026 can't
// be reused — it's already recorded on-device and won't re-run.
export const migration027: Migration = {
  version: 27,
  name: 'reembed_beliefs_stripped_backfill_fix',
  statements: [
    "DELETE FROM entity_embeddings WHERE type = 'belief'",
  ],
}

// Migration 028 — enforce case-insensitive label uniqueness on graph_nodes.
// Every app-level node lookup is COLLATE NOCASE, but the column collated BINARY,
// so UNIQUE(type,label) was case-sensitive: any path that bypasses the read
// (concurrent inserts, a sync/restore) could create "Anxiety" and "anxiety" as
// two permanent nodes. Recreate the table with `label TEXT NOT NULL COLLATE
// NOCASE` so the UNIQUE index (and upsertNode's ON CONFLICT(type,label)) is
// case-insensitive. The graph is derived, so drop + recreate is safe — bootstrap
// runs rebuildGraph() after this migration (same pattern as migration003).
export const migration028: Migration = {
  version: 28,
  name: 'graph_nodes_label_nocase',
  statements: [
    // Edges FK-reference graph_nodes(id); drop them first, then the node table.
    `DROP TABLE graph_edges`,
    `DROP TABLE graph_nodes`,
    `CREATE TABLE graph_nodes (
      id         TEXT PRIMARY KEY,
      type       TEXT NOT NULL CHECK (type IN
                 ('emotion','situation','person','belief','behavior','distortion','place','activity')),
      label      TEXT NOT NULL COLLATE NOCASE,
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

// Migration 030 — regrounded_upto column + wiki_page_contributions table.
// F-01 durable re-ground: track how many distinct matching source entries have
// been successfully synthesised (via re-ground), so corpus-representative
// maintenance can decide when each non-emotion page is due. The device-local
// contributions table makes interrupted/retried synthesis idempotent.
export const migration030: Migration = {
  version: 30,
  name: 'wiki_reground_upto',
  statements: [
    `ALTER TABLE wiki_pages ADD COLUMN regrounded_upto INTEGER NOT NULL DEFAULT 0`,
    `CREATE TABLE IF NOT EXISTS wiki_page_contributions (
      entry_id   TEXT NOT NULL,
      page_id    TEXT NOT NULL REFERENCES wiki_pages(id),
      created_at INTEGER NOT NULL,
      UNIQUE (entry_id, page_id)
    )`,
  ],
}

// tagging completed; it is not a general modification timestamp. `updated_at`
// is bumped whenever mutable entry metadata changes so post-create edits (such
// as topic repointing during a merge) reach other devices.
export const migration029: Migration = {
  version: 29,
  name: 'entry_updated_at',
  statements: [
    `ALTER TABLE entries ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0`,
    `UPDATE entries SET updated_at = MAX(created_at, COALESCE(tagged_at, 0))`,
    `CREATE INDEX idx_entries_updated_at ON entries (updated_at)`,
  ],
}

// Migration 031 — F-02B effective belief labels. `entry_entities` was
// write-once-per-entry (re-tagging replaced the whole set), so the only
// mutable signal was the raw label. Canonicalization needs a mutable column
// that records "this raw label is an alias of <canonical>" without rewriting or
// deleting the source row (deletes don't propagate via the additive sync
// model). Add two columns:
//   - canonical_label TEXT NULL:            null = raw label is its own
//                                            canonical identity; otherwise the
//                                            trimmed canonical label.
//   - updated_at INTEGER NOT NULL:          LWW watermark so a canonicalization
//                                            bump reaches other devices;
//                                            backfilled from created_at so
//                                            existing rows remain syncable.
// All recurrence/lineage/routing paths were keyed on `label`; they now key on
//    COALESCE(canonical_label, label) COLLATE NOCASE
// so a canonicalized alias counts toward one node/recurrence/wiki identity
// without losing or deleting the original raw row. See reports/wiki-structural-
// audit-sparc-plan.md (F-02B).
export const migration031: Migration = {
  version: 31,
  name: 'entry_entities_effective_label',
  statements: [
    `ALTER TABLE entry_entities ADD COLUMN canonical_label TEXT NULL`,
    `ALTER TABLE entry_entities ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0`,
    `UPDATE entry_entities SET updated_at = created_at WHERE updated_at = 0`,
  ],
}

// Migration 032 — belief maintenance state. F-02C introduces an idempotent
// historical belief-repair pass (alias clustering + canonicalization) that runs
// only when the embedding model is available and only when there's belief
// source the runner has not yet processed. The pass has to be restart-safe: a
// pass interrupted between source repair and graph rebuild resumes on next
// launch, and a pass that produced no new clusters is a no-op (same-version /
// same-processed-generation is idle). That requires persisting:
//   - algorithm_version     — bump when the cluster geometry / threshold /
//                             polarity rules change; bumps force one rerun;
//   - source_generation     — incremented by every raw belief/reframe ingestion
//                             and remote apply (NOT by maintenance's own
//                             rewrites); maintenance increments only on
//                             writes it observes, never on its own writes;
//   - processed_generation  — set to the captured source_generation after the
//                             pass settles every approved and deferred cluster;
//   - status / counts       — count-only; never label text or label hashes.
// The table is keyed by a single string key ('belief' for the only maintenance
// pass today) so a future maintenance variant can add its own row without a
// schema migration.
export const migration032: Migration = {
  version: 32,
  name: 'belief_maintenance_state',
  statements: [
    `CREATE TABLE belief_maintenance_state (
      key                   TEXT PRIMARY KEY,
      algorithm_version    INTEGER NOT NULL DEFAULT 0,
      source_generation    INTEGER NOT NULL DEFAULT 0,
      processed_generation INTEGER NOT NULL DEFAULT 0,
      status               TEXT NOT NULL DEFAULT 'idle',
      last_run_at          INTEGER,
      repaired_clusters    INTEGER NOT NULL DEFAULT 0,
      deferred_clusters    INTEGER NOT NULL DEFAULT 0,
      run_count            INTEGER NOT NULL DEFAULT 0
    )`,
    `INSERT INTO belief_maintenance_state (key) VALUES ('belief')`,
  ],
}

// F-02C Slice 8 — page-consolidation pass needs its own count so a
// settlement can distinguish source-repair clusters from page-consolidation
// clusters. Add the consolidated_clusters column to the seeded belief row.
export const migration033: Migration = {
  version: 33,
  name: 'belief_maintenance_consolidated_clusters',
  statements: [
    `ALTER TABLE belief_maintenance_state ADD COLUMN consolidated_clusters INTEGER NOT NULL DEFAULT 0`,
  ],
}

// Migration 034 — one active wiki lineage per case-insensitive title. Older
// versions had no identity invariant, so concurrent indexers could create
// duplicate live pages. Keep the corrected/richest deterministic survivor and
// mark other rows merged before adding the partial unique index.
export const migration034: Migration = {
  version: 34,
  name: 'wiki_live_title_uniqueness',
  statements: [
    `UPDATE wiki_pages
       SET merged_into = (
         SELECT survivor.id
           FROM wiki_pages survivor
          WHERE survivor.merged_into IS NULL
            AND survivor.title = wiki_pages.title COLLATE NOCASE
          ORDER BY (survivor.corrected_at IS NOT NULL) DESC,
                   survivor.entry_count DESC,
                   survivor.updated_at DESC,
                   survivor.id ASC
          LIMIT 1
       )
     WHERE wiki_pages.merged_into IS NULL
       AND wiki_pages.id <> (
         SELECT survivor.id
           FROM wiki_pages survivor
          WHERE survivor.merged_into IS NULL
            AND survivor.title = wiki_pages.title COLLATE NOCASE
          ORDER BY (survivor.corrected_at IS NOT NULL) DESC,
                   survivor.entry_count DESC,
                   survivor.updated_at DESC,
                   survivor.id ASC
          LIMIT 1
       )`,
    `CREATE UNIQUE INDEX idx_wiki_pages_live_title
       ON wiki_pages (title COLLATE NOCASE)
       WHERE merged_into IS NULL`,
  ],
}

// Migration 035 — device-local notification planning and count-only outcomes.
// These tables are intentionally absent from SYNCED_TABLES: schedules, native
// permission state, and interaction history belong to this device.
export const migration035: Migration = {
  version: 35,
  name: 'local_notification_state',
  statements: [
    `CREATE TABLE notification_candidates (
      id            TEXT PRIMARY KEY,
      kind          TEXT NOT NULL CHECK (kind IN ('journal','challenge','reengagement','digest','insight','momentum','pattern')),
      dedupe_key    TEXT NOT NULL UNIQUE,
      target_route  TEXT NOT NULL,
      eligible_at   INTEGER NOT NULL,
      expires_at    INTEGER NOT NULL,
      scheduled_for INTEGER,
      status        TEXT NOT NULL CHECK (status IN ('eligible','scheduled','opened','suppressed','cancelled','expired')),
      reason_code   TEXT,
      created_at    INTEGER NOT NULL,
      updated_at    INTEGER NOT NULL
    )`,
    `CREATE INDEX idx_notification_candidates_schedule ON notification_candidates (status, scheduled_for)`,
    `CREATE TABLE notification_events (
      id           TEXT PRIMARY KEY,
      candidate_id TEXT,
      kind         TEXT CHECK (kind IS NULL OR kind IN ('journal','challenge','reengagement','digest','insight','momentum','pattern')),
      event_type   TEXT NOT NULL CHECK (event_type IN ('app_active','entry_saved','delivered','scheduled','opened','suppressed','cancelled')),
      reason_code  TEXT,
      occurred_at  INTEGER NOT NULL
    )`,
    `CREATE INDEX idx_notification_events_time ON notification_events (occurred_at)`,
  ],
}

// Migration 036 — extend local notification allowlists for opt-in insight types.
export const migration036: Migration = {
  version: 36,
  name: 'local_notification_insight_kinds',
  statements: [
    `ALTER TABLE notification_candidates RENAME TO notification_candidates_old`,
    `CREATE TABLE notification_candidates (
      id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK (kind IN ('journal','challenge','reengagement','digest','insight','momentum','pattern')),
      dedupe_key TEXT NOT NULL UNIQUE, target_route TEXT NOT NULL, eligible_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
      scheduled_for INTEGER, status TEXT NOT NULL CHECK (status IN ('eligible','scheduled','opened','suppressed','cancelled','expired')),
      reason_code TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    )`,
    `INSERT INTO notification_candidates SELECT * FROM notification_candidates_old`,
    `DROP TABLE notification_candidates_old`,
    `CREATE INDEX idx_notification_candidates_schedule ON notification_candidates (status, scheduled_for)`,
    `ALTER TABLE notification_events RENAME TO notification_events_old`,
    `CREATE TABLE notification_events (
      id TEXT PRIMARY KEY, candidate_id TEXT, kind TEXT CHECK (kind IS NULL OR kind IN ('journal','challenge','reengagement','digest','insight','momentum','pattern')),
      event_type TEXT NOT NULL CHECK (event_type IN ('app_active','entry_saved','delivered','scheduled','opened','suppressed','cancelled')),
      reason_code TEXT, occurred_at INTEGER NOT NULL
    )`,
    `INSERT INTO notification_events SELECT * FROM notification_events_old`,
    `DROP TABLE notification_events_old`,
    `CREATE INDEX idx_notification_events_time ON notification_events (occurred_at)`,
  ],
}

// Migration 037 — sync convergence: per-record quarantine for pull failures
// (F1) + tombstone column for challenge deletion (F2).
//
// sync_skipped: records that failed to decrypt/parse/apply during a pull. They
// are excluded from the pull cursor until the retry budget (3 attempts) is
// exhausted, then dropped permanently on this device. The payload is the row's
// wire metadata only — never ciphertext, never content.
export const migration037: Migration = {
  version: 37,
  name: 'sync_quarantine_and_challenge_tombstone',
  statements: [
    `CREATE TABLE IF NOT EXISTS sync_skipped (
      table_name TEXT NOT NULL,
      record_id TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      failures INTEGER NOT NULL DEFAULT 1,
      last_attempt INTEGER NOT NULL,
      PRIMARY KEY (table_name, record_id)
    )`,
    `ALTER TABLE challenges ADD COLUMN deleted_at INTEGER`,
  ],
}
