# MindWiki — Database Schema
# Full SQL schema for SQLite + SQLCipher.
# See previous session for complete file. Key tables:
# entries, wiki_pages, graph_nodes, graph_edges,
# settings, sync_queue, crisis_events, schema_migrations
# Plus Migration 002 (weekly_digests) and Migration 003 (devices)

## Open with SQLCipher

The app opens SQLCipher through op-sqlite with the key supplied at open time. Do not use `PRAGMA key` after opening the database.

```typescript
const db = open({ name: 'mindwiki.db', encryptionKey: key })
await db.execute('PRAGMA journal_mode = WAL')
await db.execute('PRAGMA foreign_keys = ON')
```
