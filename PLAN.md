# MindWiki — Development Plan
> SPARC-compatible roadmap. Phase -1 is a hard gate — do not start Phase 0 until all demo checks pass on physical hardware.

---

## Phase overview

| Phase | Name | Gate |
|-------|------|------|
| **-1** | **Demo app** | All system checks green on physical device |
| 0 | Foundation | Encrypted DB + native modules scaffold |
| 1 | Core journal | Full 5-step entry flow saves encrypted |
| 2 | LLM pipeline | Fast model tags entry on-device |
| 3 | Wiki engine | Deep model updates wiki pages |
| 4 | Knowledge graph | Graph renders from wiki data |
| 5 | Habit system | Notifications + streak |
| 6 | Weekly digest | Sunday digest generates |
| 7 | Wiki query | Ask questions of your wiki |
| 8 | Auth + sync | E2E encrypted cross-device sync |
| 9 | Business model | Free trial + paywall |
| 10 | Polish + launch | App Store submission ready |

---

## Phase -1 — Demo app
**Goal**: Prove the three highest-risk technical dependencies work on your actual hardware before building anything real on top of them.

**Hard gate**: Every check in `demo/screens/SystemCheck.tsx` must be green. No phase 0 until this is done.

### What to validate

| Check | Success criteria |
|-------|-----------------|
| SQLite + SQLCipher | DB opens, write, read, encrypt, decrypt — all under 100ms |
| Argon2id native module | Key derivation completes — note timing (target < 4s on device) |
| AES-256-GCM | Encrypt string, decrypt string, values match |
| Fast model inference | Loads 1.5B GGUF, produces JSON output, records tokens/sec |
| Deep model inference | Loads 3B GGUF, produces text output, records tokens/sec |
| Notifications | Permission granted, test notification fires |
| Basic navigation | 2 screens, back navigation works |

### Track A: Expo project bootstrap

```
Assumptions to state before starting:
- Physical device available (iOS or Android)
- Node 22, Xcode / Android Studio installed
- Model files downloaded to models/ directory
```

- [ ] `npx create-expo-app demo --template expo-template-blank-typescript`
- [ ] Install minimal dependencies: `expo-sqlite`, `expo-notifications`, `react-native-argon2`
- [ ] Configure Expo Router (2 screens only)
- [ ] Configure `tsconfig.json` with `@/` alias pointing to `demo/`
- [ ] Test cold launch on physical device — must reach home screen

### Track B: System check screen (`demo/screens/SystemCheck.tsx`)

Each row: label, [Run] button, result badge (✓ green / ✗ red / timing ms).

- [ ] **SQLCipher check**
  ```typescript
  // Open DB with test key, write one row, read it back, delete it
  // Success: read value === written value
  // Fail: any exception
  // Record: open time + write time + read time
  ```

- [ ] **Argon2id check**
  ```typescript
  // Derive 32-byte key from "testpassword" + random 16-byte salt
  // Success: output is 32 bytes, deterministic on same input
  // Record: wall clock time (inform user if >4s they should expect that on this device)
  ```

- [ ] **AES-256-GCM check**
  ```typescript
  // Encrypt "Hello MindWiki" with derived key
  // Decrypt ciphertext
  // Success: decrypted === "Hello MindWiki"
  ```

- [ ] **Fast model check (1.5B)**
  ```typescript
  // Load fast-model.gguf
  // Run prompt: "Output only valid JSON: { "emotion": "anxiety" }"
  // Success: output contains valid JSON with emotion field
  // Record: load time, inference time, tokens/sec
  ```

- [ ] **Deep model check (3B)**
  ```typescript
  // Load deep-model.gguf
  // Run prompt: "Write one sentence about journaling."
  // Success: output is non-empty text
  // Record: load time, inference time, tokens/sec
  ```

- [ ] **Notifications check**
  ```typescript
  // Request permissions
  // Schedule a notification 5 seconds from now
  // Success: notification fires while app is in foreground
  ```

- [ ] [Run all] button — runs all checks in sequence, shows summary

### Track C: Entry smoke test screen (`demo/screens/EntrySmoke.tsx`)

- [ ] Text input (multiline)
- [ ] "Save encrypted" button → writes to SQLite with SQLCipher key
- [ ] Shows entry back from DB (confirms read/decrypt works)
- [ ] Shows entry count (total rows in DB)
- [ ] "Clear all" button (clean up test data)

### Track D: Demo README

- [ ] `demo/README.md`
  - How to run the demo on iOS and Android
  - Expected timing per device class
  - What to do if a check fails (troubleshooting per check)
  - Record your device results here before marking Phase -1 complete

### Exit criteria

```
Physical device: _________________ (iPhone/Android model)
OS version: _____________________
All SystemCheck rows: ✓
Fast model inference: _____ tokens/sec
Deep model inference: _____ tokens/sec
Argon2 timing: _____ ms
Signed off: _____________________
```

Fill this in `demo/README.md` before starting Phase 0.

---

## Phase 0 — Foundation
**Prerequisite**: Phase -1 exit criteria signed off.
**Goal**: Encrypted database running in the real app, native modules scaffolded.

### Track A: Expo app scaffold
- [ ] `npx create-expo-app mindwiki --template expo-template-blank-typescript`
- [ ] Configure `tsconfig.json` strict mode + `@/` alias
- [ ] ESLint + Prettier
- [ ] Jest + React Native Testing Library
- [ ] Configure Expo Router (shell navigation only, no content yet)
- [ ] `.gitignore` (models, *.db, .env, .claude-flow/memory/)
- [ ] `.graphify.json` configured for TypeScript aliases
- [ ] `.claude/hooks/pre-session.sh` for Graphify rebuild

### Track B: Storage layer
- [ ] `src/services/storage/db.ts` — connection, SQLCipher key injection, WAL mode
- [ ] Migration runner — reads pending migrations on app start
- [ ] Migration 001 — full schema (see `docs/DATABASE.md`):
  - `entries`, `wiki_pages`, `graph_nodes`, `graph_edges`
  - `settings`, `sync_queue`, `crisis_events`, `schema_migrations`
- [ ] `src/services/storage/entries.ts` — CRUD with Result<T>
- [ ] Unit tests: CRUD, migration idempotency

### Track C: Native module interfaces
- [ ] `src/native/LLMBridge.ts` — TypeScript interface with stubs
- [ ] `src/native/CryptoModule.ts` — TypeScript interface with stubs
- [ ] iOS `MindWikiLLM` Swift module stub
- [ ] Android `MindWikiLLM` Kotlin module stub
- [ ] iOS `CryptoModule` Swift module (Argon2 — real implementation, not stub)
- [ ] Android `CryptoModule` Kotlin module (Argon2 — real implementation)

**Exit criteria**: `yarn test` passes, `yarn tsc` clean, app launches on simulator.

---

## Phase 1 — Core journal
**Goal**: User completes 5-step entry, data saved encrypted.

### Track A: Entry flow UI (ui-agent)
- [ ] Onboarding 7 screens (welcome → privacy → how it works → intent → Q1 → Q2 → saved)
- [ ] Daily entry stepper (5 steps, progress bar, skip on steps 4+5)
- [ ] Mood check-in component (5-point horizontal picker)
- [ ] Situation prompt component
- [ ] Thought capture component (shows previous answer reference)
- [ ] Behaviour prompt + skip button
- [ ] Closing note + skip button
- [ ] Entry saved screen with proto-graph SVG

### Track B: Entry store + hooks (storage-agent)
- [ ] `src/store/entry.store.ts` — active entry, step tracking
- [ ] `useJournalEntry` hook — step navigation, submit, validation
- [ ] Home screen Day-1 variant (single CTA)

### Track C: Tests
- [ ] Step navigation: forward, back, skip
- [ ] Entry saves to DB with all fields
- [ ] Submission returns Result<T>

**Exit criteria**: Full 5-step entry completes, row visible in DB.

---

## Phase 2 — LLM pipeline
**Goal**: Entry tagging runs on-device. Crisis detection working.

### Track A: Native model integration (llm-agent)
- [ ] iOS Core ML: load `fast-model.gguf`, implement `tag()` returning JSON string
- [ ] Android ExecuTorch: same
- [ ] iOS Core ML: load `deep-model.gguf`, implement `synthesise()`
- [ ] Android ExecuTorch: same

### Track B: LLM service layer (llm-agent)
- [ ] `src/services/llm/prompts/tag-entry.ts` — see `docs/LLM_PIPELINE.md`
- [ ] `src/services/llm/schemas/entry-tag.schema.ts` — Zod schema
- [ ] `src/services/llm/fast-model.ts` — calls native, validates, returns Result
- [ ] `src/services/llm/deep-model.ts` — background processing

### Track C: Crisis detection (security-agent)
- [ ] `src/services/crisis/detector.ts` — LLM confidence + keyword safety net
  - Tier 1: confidence ≥ 0.30
  - Tier 2: confidence ≥ 0.60
  - Tier 3: confidence ≥ 0.85 or explicit keywords
- [ ] Crisis UI components — Tier 1 (inline), Tier 2 (bottom sheet), Tier 3 (full screen)
- [ ] `src/services/crisis/resources.ts` — 988, Crisis Text Line data

### Track D: Pipeline (llm-agent)
- [ ] `src/services/pipeline.ts` — orchestrates: save → tag → crisis check → queue wiki update
- [ ] Background task (Expo BackgroundFetch)

**Exit criteria**: Entry submits, `entry.tags` populated, crisis tier tested at all thresholds.

---

## Phase 3 — Wiki engine
**Goal**: Deep model updates wiki pages after every entry.

- [ ] `src/services/storage/wiki.ts` — CRUD + full-text search (FTS5)
- [ ] `src/services/llm/prompts/identify-pages.ts`
- [ ] `src/services/llm/prompts/update-page.ts`
- [ ] `src/services/llm/schemas/wiki-update.schema.ts`
- [ ] `src/services/wiki/engine.ts` — processEntry, identifyAffectedPages, synthesisePage, applyUpdates
- [ ] Wiki page versioning (append to `version_history` JSON column)
- [ ] Wiki page component (title, richness bar, content, related, sources)
- [ ] Wiki browse screen (by category)
- [ ] Unit tests: page update, version history preservation, graceful LLM failure

**Exit criteria**: After 3+ entries, ≥1 wiki page with compiled content exists.

---

## Phase 4 — Knowledge graph
**Goal**: Graph renders from wiki data. Tap, filter, timeline all work.

- [ ] `src/services/storage/graph.ts` — CRUD, additive edge upsert
- [ ] `src/services/graph/engine.ts` — extract nodes/edges from entry tags
- [ ] `src/services/graph/layout.ts` — force-directed layout (no d3, pure TypeScript)
- [ ] Graph SVG components: `GraphCanvas`, `GraphNode`, `GraphEdge`, `ClusterBackground`
- [ ] `NodeDetailCard` — appears on node tap
- [ ] Filter pills (All / Emotions / Situations / etc.)
- [ ] Focus mode: tap node → dim unconnected
- [ ] Timeline mode: date range filter

**Exit criteria**: Graph renders with real data, tap shows detail card, filter works.

---

## Phase 5 — Habit system
**Goal**: Notifications fire, streak tracks with grace days.

- [ ] `src/services/notifications/copy.ts` — 12 rotating variants
- [ ] `src/services/notifications/timing.ts` — on-device open histogram → optimal send time
- [ ] `src/services/notifications/scheduler.ts` — Expo Notifications
- [ ] Streak logic: current, longest, grace day (1/week), pause not break
- [ ] Re-engagement: 3-day, 7-day, 30-day silence rules
- [ ] Home screen evolution: Day 1 / Day 7 / Day 30 variants
- [ ] Notification permission ask after first entry (not on launch)

**Exit criteria**: Notification fires at optimised time, streak/grace day logic unit tested.

---

## Phase 6 — Weekly digest
**Goal**: Sunday digest generates and renders.

- [ ] `src/services/digest/generator.ts` — mood arc, observations, pattern, correlation, question, quote
- [ ] Digest reflection question LLM prompt
- [ ] Weekly digest screen (mood arc SVG, insight cards, quote)
- [ ] Sunday morning notification
- [ ] "Digest ready" card on home screen

### Phase 6b — Multi-agent digest synthesis (additive)
- [ ] `src/services/graph/neighborhood.ts` — pure graph-neighborhood helper (depth-limited walk; used by the retriever)
- [ ] `src/services/digest/agents/retriever.ts` — pure: gather the week's material (focus labels → relevant entries, graph neighborhoods, wiki pages). No LLM.
- [ ] `src/services/digest/agents/analyst.ts` + `src/services/llm/prompts/digest-synthesis.ts` + `schemas/digest-synthesis.schema.ts` — deep model produces Zod-validated `{ themes, patterns, openQuestions }`
- [ ] `src/services/digest/agents/critic.ts` — pure claim-check: drop themes/patterns no source entry supports → `flaggedClaims`; open questions always kept
- [ ] `src/services/digest/agents/orchestrator.ts` — retriever → analyst (bounded retry) → critic; graceful failure leaves the deterministic digest intact
- [ ] `Digest.synthesis` field + synthesis section on the digest screen (themes / patterns / open questions + flagged claims) with a loading indicator while the deep model runs

**Exit criteria**: Digest generates after 7+ entries, all 6 sections populated. Multi-agent synthesis adds themes/patterns/open questions on top, critic-grounded against source entries; the analyst runs on the deep (3B) model in the background, and any analyst failure degrades gracefully to the deterministic digest (no synthesis, never blocks).

---

## Phase 7 — Wiki query interface
**Goal**: User asks questions, gets wiki-sourced answers.

- [ ] `src/services/wiki/search.ts` — FTS5 query + semantic match
- [ ] Query screen: search bar, suggested questions, recent pages, mini graph
- [ ] Suggested questions (generated from high-entry-count wiki pages)
- [ ] Answer display: answer + evidence count + source page chips
- [ ] "Explore in graph →" from any answer
- [ ] Proactive surfacing cards on home screen
- [ ] Query LLM prompt + Zod schema

**Exit criteria**: Type question, get specific wiki-sourced answer.

---

## Phase 8 — Auth + cross-device sync
**Goal**: E2E encrypted sync between 2 devices. Full server live.

### Track A: Encryption service (client) — sync-agent
- [ ] `src/services/sync/encryption.ts`
  - `encryptRecord(plaintext, recordId, masterKey)` → AES-256-GCM
  - `decryptRecord(ciphertext, recordId, masterKey)`
  - Per-record key via HKDF

### Track B: Auth service (client) — sync-agent
**Accounts are mandatory (no anonymous mode).** Account-first onboarding; the
encrypted DB is opened only after a session + master key exist. Offline journaling
is allowed after the first successful login.
- [x] `src/native/CryptoModule.ts` `deriveKey` — real Argon2id via react-native-argon2 (argon2id, 64 MiB / t=3, 32-byte hex key, saltEncoding hex). **Requires native rebuild** (autolinked native module).
- [x] `src/services/auth/auth.service.ts`
  - `register(email, password)` — generates a random master key, escrows it (Argon2-wrapped), calls server
  - `loginNewDevice(email, password)` — recovers master key from escrow
  - `refreshAccessToken()` — auto-called by API client on 401
  - `hydrateAuth()` — resolve launch auth state from stored tokens
- [x] `src/services/auth/api-client.ts` — `authenticatedFetch()` with auto-refresh
- [x] `src/store/auth.store.ts` — authenticated / unauthenticated (+ loading on launch)
- [x] Auth screen + launch gate — `components/auth/AuthScreen.tsx` (register/login via `hooks/useAuth`), gated in `_layout.tsx` (loading→spinner, unauthenticated→AuthScreen, authenticated→open DB→app)
- [x] Open the encrypted DB *after* auth (was at launch) — fixes new-device login without a SQLCipher rekey: a fresh device's DB is created with the account master key on first open. Returning-device unaffected (existing DB, same key).
  - [ ] FOLLOW-UP: recovery-phrase display on register
  - [ ] EDGE (deferred): switching to a *different* account on a device that already has a DB → `initStorage` can't open the old DB with the new key; needs reset-on-key-mismatch (reinstall works for now). Doesn't affect the 2-device same-account exit criteria.
- [ ] Settings → Account/Sync entry point

### Track C: Cloudflare Workers server — server-agent
Full spec in `docs/SERVER.md`. Summary:
- [ ] `server/` Wrangler project init, `wrangler.toml`, KV + R2 bindings
- [ ] KV namespace `AUTH_KV`: accounts, refresh token families, key escrow
- [ ] `server/auth/register.ts` — bcrypt(SHA-256(password), 12), store account + escrow
- [ ] `server/auth/login.ts` — bcrypt.compare, return tokens + escrow
- [ ] `server/auth/refresh.ts` — rotate token, family invalidation on reuse
- [ ] `server/auth/logout.ts` — invalidate family
- [ ] `server/auth/change-password.ts` — re-bcrypt + update escrow
- [ ] `server/auth/delete-account.ts` — delete KV + all R2 blobs
- [ ] JWT signing key → `wrangler secret put JWT_SECRET`
- [ ] `server/storage/upload.ts` — PUT /sync/{accountId}/{table}/{recordId}
- [ ] `server/storage/delta.ts` — GET /sync/{accountId}/delta?since={ts}
- [ ] `server/storage/delete.ts` — DELETE all blobs for account
- [ ] `server/push/register.ts` — store push token → account mapping
- [ ] `server/push/send.ts` — APNs HTTP/2 + FCM v1

### Track D: Sync engine (client) — sync-agent
- [x] `src/services/storage/sync-queue.ts` — enqueue/pending/markSynced; writes (createEntry/applyTags/createPage/updatePage) enqueue best-effort
- [x] `src/services/sync/engine.ts` — pushPending (encrypt → PUT → markSynced) + pullDelta (delta → decrypt → LWW apply → cursor) + sync()
- [x] `src/services/sync/conflict.ts` — per-table strategies (LWW for entries + wiki_pages; graph excluded)
- [x] `src/hooks/useSync.ts` — trigger: runs sync() on auth + app-foreground (no-op until authenticated); mounted in `_layout.tsx`
- [ ] `src/services/sync/pairing.ts` — QR code + recovery phrase
- [ ] Sync settings screen (connected devices, add device, WiFi-only toggle)

### Track E: Wrangler deployment — server-agent
- [ ] `wrangler dev` local with Miniflare (KV + R2 emulated, port 8787)
- [ ] `wrangler deploy --env staging`
- [ ] `wrangler deploy --env production`
- [ ] GitHub Actions: auto-deploy on merge to main

**Exit criteria**: Two simulators with same account have identical wiki after sync.

---

## Phase 9 — Business model
**Goal**: 30-day free trial, RevenueCat paywall, feature gating.

- [ ] RevenueCat SDK — products: annual $69.99, monthly $9.99
- [ ] `src/services/subscription/paywall.ts`
- [ ] Trial logic (30-day, no card required)
- [ ] Paywall screen: shows wiki page count + patterns built, annual pre-selected
- [ ] Feature gating: wiki / graph / digest / personalised prompts behind subscription
- [ ] Day 7 soft conversion prompt (within digest)
- [ ] Day 28 trial-ending notification
- [ ] Paywall after Day 30 (warm framing, free tier available, data safety note)

**Exit criteria**: Free user hits paywall at Day 30, can subscribe, features unlock.

---

## Phase 10 — Polish + launch prep
**Goal**: App Store submission ready.

### Performance
- [ ] Graph: memo all node/edge components, profile with Flipper
- [ ] DB: add indexes on slow queries
- [ ] Fast model: verify ≤2s on iPhone 12 (minimum target device)
- [ ] Sync: verify delta sync <5s on WiFi

### App Store assets
- [ ] App icon (1024×1024 + all required sizes)
- [ ] 6 screenshots (designs in product brief)
- [ ] App Preview video (30s, shows graph interaction)
- [ ] Privacy Nutrition Label (should be near-empty for local-first)

### Legal
- [ ] Privacy Policy (hosted URL)
- [ ] Terms of Service (hosted URL)
- [ ] In-app mental health disclaimer at onboarding
- [ ] GDPR explicit consent flow
- [ ] Data deletion flow in Settings

### Testing
- [ ] Physical device test matrix: iPhone SE, iPhone 14, iPhone 16 Pro, iPad, Pixel 6, Samsung S24
- [ ] TestFlight build live, 50-user beta
- [ ] All unit tests passing, no TypeScript errors

**Exit criteria**: TestFlight build live, App Store review submitted.

---

## Parallel workstreams for Ruflo

```
Phase -1:  demo-agent runs solo (validates hardware before anything else)

Phase 0-1: storage-agent (DB) ∥ ui-agent (onboarding polish)

Phase 2-3: llm-agent (model integration) ∥ storage-agent (wiki storage)
           security-agent (crisis detection)

Phase 4-5: graph-agent (graph) ∥ ui-agent (habit UI) ∥ storage-agent (streak)

Phase 6-7: llm-agent (digest) ∥ ui-agent (query UI)

Phase 8:   sync-agent (client) ∥ server-agent (Cloudflare Workers)
           security-agent (encryption audit)
```

Track completion: `memory_store mindwiki/status "phase-1:systemcheck:ios:pass"`
