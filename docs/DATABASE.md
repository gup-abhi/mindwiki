# MindWiki — Database Schema
# Full SQL schema for SQLite + SQLCipher.
# See previous session for complete file. Key tables:
# entries, wiki_pages, graph_nodes, graph_edges,
# settings, sync_queue, crisis_events, schema_migrations
# Plus Migration 002 (weekly_digests) and Migration 003 (devices)

## Open with SQLCipher
await db.execAsync(`PRAGMA key = '${key}'`)
await db.execAsync(`PRAGMA cipher_page_size = 4096`)
await db.execAsync(`PRAGMA journal_mode = WAL`)
await db.execAsync(`PRAGMA foreign_keys = ON`)
