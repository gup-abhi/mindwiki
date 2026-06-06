# MindWiki — Architecture
# See the full version in the previous session output.
# Key points reproduced here for agent reference.

## Launch sequence
configureNotifications + hydrateAuth (session from tokens, no DB) → gate:
unauthenticated → AuthScreen; authenticated → open encrypted DB (initStorage)
→ app. The DB opens ONLY after auth so it's keyed with the correct master key
(fresh DB on new-device login, existing DB for a returning user) — never with a
throwaway device key. DB-backed work (incl. background sync) lives under AppRoot,
mounted only when storage is ready.

## Entry processing pipeline
User submits → Save to SQLite (immediate) → Fast model tag (sync ≤2s) →
Crisis check (sync) → Wiki update via deep model (background) →
Graph upsert (background) → Sync queue (background)

## Weekly digest pipeline
Deterministic generator (6 sections) → reflection question (deep model) →
multi-agent synthesis (background): retriever (pure) → analyst (deep model) →
critic (pure) ⟲ orchestrator. Additive and best-effort — analyst failure leaves
the deterministic digest intact (no synthesis). See docs/LLM_PIPELINE.md.

## Module dependency rules
screens/ → hooks/ → services/ → native/
services/ cannot import store/, components/, screens/
store/ cannot import services/

## Performance targets
Entry save: <50ms | Fast model: <2000ms (iPhone 12) | Graph render: <16ms/frame

## Security boundaries
TRUST 1: Device ↔ Storage (SQLCipher AES-256-GCM)
TRUST 2: Device ↔ Network (TLS 1.3 + AES-256-GCM content)
TRUST 3: Device ↔ Device key transfer (QR proximity / recovery phrase)
