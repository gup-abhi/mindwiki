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
