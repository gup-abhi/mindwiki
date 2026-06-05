# MindWiki — Sync Architecture
# E2E encrypted delta sync via Cloudflare R2.
# Master key: Argon2id(password) → never transmitted
# Per-record key: HKDF(master_key, record_id, "mindwiki-record-v1")
# Conflict resolution:
#   entries: UUID merge (no conflict)
#   wiki_pages: last_modified_wins
#   graph_nodes/edges: additive union (max weight/count)
#   settings: last_modified_wins per key
#   streak: take maximum
# Device pairing: QR code (proximity) or 12-word recovery phrase

## Engine (src/services/sync/)
Local writes enqueue into sync_queue (storage/sync-queue.ts): createEntry /
applyTags / createPage / updatePage call enqueueUpsert best-effort (never blocks
the write). One pending row per (table, record) — id = `table:record_id`, ON
CONFLICT resets synced_at, so repeated edits collapse to one upload.

engine.ts `sync()` = pushPending then pullDelta (requires session + master key,
both on-device; never throws):
- **pushPending** — for each pending row: load the local row, encryptRecord
  (per-record HKDF key) → PUT /sync/{accountId}/{table}/{recordId}, then
  markSynced. Any failure leaves the row pending for the next run.
- **pullDelta** — GET /sync/{accountId}/delta?since={cursor}; decrypt each
  (skip undecryptable), apply the LWW winners (conflict.ts recordsToApply) via
  INSERT OR REPLACE — deliberately bypassing the storage write helpers so applied
  rows do NOT re-enqueue (no echo). Cursor (`sync:last_pull` in settings) advances
  to the newest applied updated_at.

Synced tables: entries, wiki_pages (conflict.ts SYNCED_TABLES). Entries have no
updated_at column → watermark is max(created_at, tagged_at). Graph is NOT synced
(additive, rebuilt locally from entries — ADR 006).
