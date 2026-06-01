# MindWiki — Architecture
# See the full version in the previous session output.
# Key points reproduced here for agent reference.

## Entry processing pipeline
User submits → Save to SQLite (immediate) → Fast model tag (sync ≤2s) →
Crisis check (sync) → Wiki update via deep model (background) →
Graph upsert (background) → Sync queue (background)

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
