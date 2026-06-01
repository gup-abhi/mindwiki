# Graph Report - .  (2026-05-27)

## Corpus Check
- Corpus is ~8,298 words - fits in a single context window. You may not need a graph.

## Summary
- 75 nodes · 125 edges · 7 communities detected
- Extraction: 97% EXTRACTED · 3% INFERRED · 0% AMBIGUOUS · INFERRED: 4 edges (avg confidence: 0.89)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_Core Architecture|Core Architecture]]
- [[_COMMUNITY_Development Roadmap|Development Roadmap]]
- [[_COMMUNITY_Database & Storage|Database & Storage]]
- [[_COMMUNITY_LLM Pipeline|LLM Pipeline]]
- [[_COMMUNITY_Privacy & Security|Privacy & Security]]
- [[_COMMUNITY_Server & Auth|Server & Auth]]
- [[_COMMUNITY_Sync & Device Pairing|Sync & Device Pairing]]

## God Nodes (most connected - your core abstractions)
1. `LLM service` - 10 edges
2. `Privacy model` - 9 edges
3. `Sync service` - 8 edges
4. `Entry processing pipeline` - 6 edges
5. `Cloudflare Workers server` - 6 edges
6. `Storage service` - 6 edges
7. `docs/SYNC.md` - 5 edges
8. `SQLite + SQLCipher` - 5 edges
9. `Encryption stack` - 5 edges
10. `docs/ARCHITECTURE.md` - 4 edges

## Surprising Connections (you probably didn't know these)
- `SQLCipher` --implements--> `SQLite + SQLCipher`  [INFERRED]
  CLAUDE.md → docs/DATABASE.md
- `Cloudflare Workers` --implements--> `Cloudflare Workers server`  [INFERRED]
  CLAUDE.md → docs/SERVER.md
- `Privacy model` --uses--> `SQLite + SQLCipher`  [EXTRACTED]
  CLAUDE.md → docs/DATABASE.md
- `Privacy model` --uses--> `AES-256-GCM encryption`  [EXTRACTED]
  CLAUDE.md → docs/PRIVACY_SECURITY.md
- `Privacy model` --uses--> `TLS 1.3`  [EXTRACTED]
  CLAUDE.md → docs/PRIVACY_SECURITY.md

## Hyperedges (group relationships)
- **Entry processing pipeline services** — llm_service, crisis_service, wiki_service, graph_service, sync_service, storage_service [EXTRACTED 1.00]
- **Privacy encryption layers** — sqlite_sqlcipher, aes_256_gcm, tls_1_3, argon2id_master_key, hkdf_per_record_key [EXTRACTED 1.00]
- **Server auth and storage endpoints** — auth_endpoints, storage_endpoints, kv_schema, cloudflare_workers_server [EXTRACTED 1.00]

## Communities

### Community 0 - "Core Architecture"
Cohesion: 0.21
Nodes (14): ADR 001: LLM Wiki over RAG, Crisis detection service, Entry processing pipeline, Graph node types, Graph service, LLM Wiki architecture, MindWiki, Ruflo agent assignments (+6 more)

### Community 1 - "Development Roadmap"
Cohesion: 0.19
Nodes (14): Demo app, docs/DEMO.md, Phase 0: Foundation, Phase 10: Polish + launch, Phase 1: Core journal, Phase 2: LLM pipeline, Phase 3: Wiki engine, Phase 4: Knowledge graph (+6 more)

### Community 2 - "Database & Storage"
Cohesion: 0.22
Nodes (10): ADR 002: SQLCipher over standard SQLite, Database schema, docs/ARCHITECTURE.md, docs/DATABASE.md, Module dependency rules, Performance targets, Result<T,E> pattern, SQLite + SQLCipher (+2 more)

### Community 3 - "LLM Pipeline"
Cohesion: 0.27
Nodes (10): ADR 004: Result<T,E> over thrown exceptions, CBT prompt structure, docs/LLM_PIPELINE.md, LLM retry logic, LLM service, models/README.md, Qwen2.5 1.5B (fast), Qwen2.5 3B (deep) (+2 more)

### Community 4 - "Privacy & Security"
Cohesion: 0.31
Nodes (9): ADR 003: On-device LLM, AES-256-GCM encryption, docs/PRIVACY_SECURITY.md, Encryption stack, iOS Keychain / Android Keystore, Privacy model, Security audit checklist, Security boundaries (+1 more)

### Community 5 - "Server & Auth"
Cohesion: 0.36
Nodes (8): Auth endpoints, Auth service (client), Cloudflare Workers server, docs/SERVER.md, KV schema, Phase 8: Auth + sync, Storage endpoints, Cloudflare Workers

### Community 6 - "Sync & Device Pairing"
Cohesion: 0.39
Nodes (8): ADR 010: SHA-256 client + bcrypt server, Argon2id master key, Conflict resolution strategies, Delta sync, Device pairing, docs/SYNC.md, HKDF per-record key, Sync service

## Knowledge Gaps
- **8 isolated node(s):** `Performance targets`, `Phase 5: Habit system`, `Phase 6: Weekly digest`, `Phase 7: Wiki query`, `Phase 9: Business model` (+3 more)
  These have ≤1 connection - possible missing edges or undocumented components.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `LLM service` connect `LLM Pipeline` to `Core Architecture`, `Development Roadmap`, `Database & Storage`?**
  _High betweenness centrality (0.234) - this node is a cross-community bridge._
- **Why does `Sync service` connect `Sync & Device Pairing` to `Core Architecture`, `Server & Auth`?**
  _High betweenness centrality (0.160) - this node is a cross-community bridge._
- **Why does `Privacy model` connect `Privacy & Security` to `Core Architecture`, `Database & Storage`, `Sync & Device Pairing`?**
  _High betweenness centrality (0.135) - this node is a cross-community bridge._
- **What connects `Performance targets`, `Phase 5: Habit system`, `Phase 6: Weekly digest` to the rest of the system?**
  _8 weakly-connected nodes found - possible documentation gaps or missing edges._