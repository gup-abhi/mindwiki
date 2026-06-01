# MindWiki — CLAUDE.md
> Master context for Claude Code and Ruflo. Read this completely before writing a single line.

---

## Behavioral guidelines (Karpathy)

These apply to every agent, every task, every phase. They override speed.

### 1. Think before coding
Don't assume. Don't hide confusion. Surface tradeoffs.
- State your assumptions explicitly before implementing. If uncertain, ask.
- If multiple interpretations exist, present them — don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

### 2. Simplicity first
Minimum code that solves the problem. Nothing speculative.
- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.
- Ask: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

### 3. Surgical changes
Touch only what you must. Clean up only your own mess.
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.
- Every changed line should trace directly to the request.

### 4. Goal-driven execution
Define success criteria. Loop until verified.
- Transform tasks into verifiable goals before starting.
- For multi-step tasks, state a brief plan with verify steps:
  ```
  1. [Step] → verify: [check]
  2. [Step] → verify: [check]
  ```
- Strong success criteria let you loop independently.
- "Make it work" is not a success criterion.

---

## Project overview

MindWiki is a privacy-first AI journaling app that builds a **compounding personal knowledge base** from journal entries. It uses an LLM Wiki architecture — each entry updates persistent wiki pages rather than re-deriving insights from scratch — CBT-structured prompts, and a visual knowledge graph. Everything runs on-device. No raw journal data ever leaves the phone.

**The single most important thing**: this is not a chatbot on top of a journal. The *wiki* is the product. Entries feed a growing knowledge base. The AI synthesises, not retrieves.

**Current project status**: Phase -1 (Demo app). Do not start Phase 0 until the demo app runs clean on physical hardware.

---

## Tech stack

```
React Native 0.76+     Expo SDK 52+          TypeScript 5.x (strict)
op-sqlite (SQLCipher)  react-native-argon2   llama.rn (GGUF inference)
Qwen2.5 1.5B + 3B      (GGUF, Q4_K_M)
Cloudflare Workers     Cloudflare R2          Cloudflare KV
APNs / FCM             RevenueCat             React Native Reanimated 3
Zustand (+ Immer)      TanStack Query         Zod
Wrangler 3             Graphify (codebase graph)
```

**Do not** add Redux, MobX, class components, any LLM cloud API for user journal data, or any analytics SDK that receives user-authored text.

---

## SPARC methodology (Ruflo)

All development follows SPARC. For every task:

1. **[SPEC]** Define exact behaviour — inputs, outputs, edge cases
2. **[PSEUDO]** Write pseudocode before any implementation
3. **[ARCH]** Confirm module boundaries and dependencies
4. **[TDD]** Write failing tests first
5. **[IMPL]** Implement to make tests pass
6. **[REFINE]** Performance, accessibility, error handling

### Ruflo agent assignments

| Agent | Owns |
|-------|------|
| `demo-agent` | Phase -1 demo app — all screens and validation checks |
| `architect-agent` | Module design, interface definition, ADR tracking |
| `storage-agent` | SQLite schema, migrations, encryption layer |
| `llm-agent` | On-device model integration, prompt engineering, wiki synthesis |
| `ui-agent` | React Native screens, components, animation |
| `graph-agent` | Knowledge graph data structures and visualisation |
| `sync-agent` | Cross-device sync, conflict resolution, key management |
| `server-agent` | Cloudflare Workers — auth, storage, push |
| `test-agent` | Test coverage, integration tests, E2E |
| `security-agent` | Encryption audit, key management, GDPR compliance |

### Ruflo memory namespaces

```
mindwiki/status       — phase and task completion tracking
mindwiki/arch         — architectural decisions
mindwiki/schema       — database schema versions
mindwiki/llm          — prompt templates, model configs
mindwiki/demo         — demo app test results (device, timing, pass/fail)
mindwiki/patterns     — code patterns that worked well
```

---

## Graphify directives

This project uses Graphify for codebase navigation. **Before grepping or globbing, query the graph first:**

```
/graphify query "where is the wiki engine?"
/graphify query "what imports fast-model.ts?"
/graphify query "which files handle SQLite encryption?"
```

Only fall back to Grep/Glob if the graph returns no result. The graph rebuilds automatically at session start via the pre-session hook. Do NOT run `/graphify rebuild` manually mid-task — it blocks other agents.

---

## Repository structure

```
mindwiki/
├── CLAUDE.md                      ← this file
├── PLAN.md                        ← phased development roadmap
├── .gitignore
├── .graphify.json                 ← Graphify codebase graph config
├── .claude/
│   ├── settings.json
│   ├── hooks/
│   │   └── pre-session.sh         ← auto-rebuilds Graphify graph
│   └── commands/                  ← custom slash commands
├── .claude-flow/                  ← Ruflo state (memory/, sessions/)
│
├── docs/
│   ├── ARCHITECTURE.md
│   ├── DATABASE.md
│   ├── LLM_PIPELINE.md
│   ├── SYNC.md
│   ├── PRIVACY_SECURITY.md
│   ├── SERVER.md                  ← Cloudflare Workers architecture
│   └── DEMO.md                    ← demo app spec and success criteria
│
├── demo/                          ← Phase -1: standalone validation app
│   ├── App.tsx                    ← entry point
│   ├── screens/
│   │   ├── SystemCheck.tsx        ← SQLCipher / Argon2 / LLM tests
│   │   └── EntrySmoke.tsx         ← basic entry save/read flow
│   └── README.md                  ← how to run + expected output
│
├── src/
│   ├── app/                       ← Expo Router screens
│   │   ├── (auth)/
│   │   ├── (tabs)/
│   │   └── _layout.tsx
│   ├── components/
│   │   ├── graph/
│   │   ├── journal/
│   │   ├── wiki/
│   │   ├── digest/
│   │   └── ui/
│   ├── services/
│   │   ├── storage/               ← SQLite + SQLCipher
│   │   ├── llm/                   ← on-device LLM
│   │   ├── wiki/                  ← wiki engine
│   │   ├── graph/                 ← graph engine
│   │   ├── sync/                  ← cross-device sync
│   │   ├── auth/                  ← auth service (client)
│   │   ├── crisis/                ← crisis detection
│   │   ├── notifications/         ← habit system
│   │   ├── digest/                ← weekly digest
│   │   └── subscription/          ← RevenueCat
│   ├── native/
│   │   ├── LLMBridge.ts
│   │   └── CryptoModule.ts
│   ├── store/
│   │   ├── entry.store.ts
│   │   ├── wiki.store.ts
│   │   ├── graph.store.ts
│   │   ├── auth.store.ts
│   │   └── user.store.ts
│   └── types/
│
├── server/                        ← Cloudflare Workers backend
│   ├── wrangler.toml
│   ├── wrangler.dev.toml
│   ├── package.json
│   └── src/
│       ├── index.ts               ← router
│       ├── middleware/auth.ts
│       ├── auth/                  ← register, login, refresh, logout, etc.
│       ├── storage/               ← R2 upload, delta, delete
│       └── push/                  ← APNs + FCM relay
│
├── models/                        ← GGUF files (gitignored)
│   └── README.md                  ← download instructions
│
├── ios/
├── android/
└── __tests__/
```

---

## Core concepts

### LLM Wiki architecture

Entries are immutable. Wiki pages are mutable, LLM-generated, versioned markdown. When entry E is submitted:

```
E → fast-model: tag(emotion, distortion, mood_score)   [sync, ≤2s]
  → crisis check                                        [sync, immediate]
  → deep-model: identify + update affected wiki pages   [background]
  → graph engine: upsert nodes + edges                  [background]
  → sync queue: add changed records                     [background]
```

**Never** re-derive insights from scratch. **Always** update the existing wiki page.

### CBT prompt structure (5 steps)

| Step | What it captures | CBT element |
|------|-----------------|-------------|
| 1 | Mood 1–5 | Baseline affect |
| 2 | Situation | Activating event |
| 3 | Thought | Automatic thought |
| 4 (optional) | Behaviour | Response |
| 5 (optional) | Closing note | Balanced perspective |

Steps 4 and 5 are always skippable. A failed LLM extraction must never fail the entry save.

### Graph node types

```typescript
type NodeType = 'emotion' | 'situation' | 'person' | 'belief' | 'behavior' | 'distortion'
```

Node size = frequency. Edge weight = co-occurrence count. `isDashed = weight < 4`. Edges are additive-only — they gain weight but are never deleted in normal use.

### Privacy model (CRITICAL)

```
RAW ENTRIES:    on-device SQLite+SQLCipher only
                LLM: on-device only, never serialised to network
                Sync: AES-256-GCM ciphertext only, server cannot read

MASTER KEY:     never transmitted to any server
                stored: iOS Keychain / Android Keystore only
                transferred device→device: QR code or recovery phrase

WIKI PAGES:     same encryption at rest
                cloud LLM: opt-in only, wiki pages not raw entries

SERVER:         stores ciphertext + account metadata only
                mathematically unable to read user content
```

If any code path sends raw entry text over the network — reject it immediately.

---

## Module responsibilities

### `src/services/` — business logic, no UI imports

| Module | Owns |
|--------|------|
| `storage/` | SQLite+SQLCipher CRUD, migrations, connection |
| `llm/` | On-device inference, prompts, output validation |
| `wiki/` | Wiki page synthesis, versioning, search |
| `graph/` | Node/edge management, layout, clustering |
| `sync/` | Delta sync, encryption, conflict resolution, pairing |
| `auth/` | Account register/login/refresh, token management |
| `crisis/` | Confidence scoring, tier detection, keyword safety net |
| `notifications/` | Scheduling, timing intelligence, copy rotation |
| `digest/` | Weekly digest data compilation |
| `subscription/` | RevenueCat, trial logic, feature gating |

### `server/` — Cloudflare Workers, V8 isolates

No `fs`, no `path`, no Node.js APIs. KV for accounts/tokens/escrow. R2 for encrypted blobs. The server never reads plaintext. See `docs/SERVER.md` for full spec.

---

## Coding conventions

### TypeScript
- Strict mode always. No `any` — use `unknown` + type guards.
- All async service functions return `Promise<Result<T, AppError>>`. No thrown exceptions.
- Prefer `interface` for shapes, `type` for unions.

```typescript
type Result<T, E = AppError> =
  | { success: true; data: T }
  | { success: false; error: E }
```

### React Native
- Functional components only. Custom hooks for non-trivial logic.
- `StyleSheet.create()` for all styles — no inline objects.
- `React.memo()` on graph nodes and wiki cards.
- Never call services directly from components — always through hooks.

### Imports
```typescript
import { db } from '@/services/storage/db'    // ✓ absolute
import { db } from '../../services/storage/db' // ✗ relative
```

### File naming
```
PascalCase  → Components, Types
camelCase   → Services, hooks, utilities
kebab-case  → Route files (Expo Router)
UPPER_SNAKE → Constants
```

### Conventional commits
```
feat(storage): add SQLCipher encrypted database
fix(crisis): correct tier-2 detection threshold
test(graph): node/edge conflict resolution
chore: update dependencies
```

---

## Database patterns

Always parameterised queries. Always transactions for multi-table writes.

Storage is **op-sqlite** with SQLCipher (not expo-sqlite — it has no encryption; see ADR 002). Encryption is set at open time via `encryptionKey`, NOT `PRAGMA key`.

```typescript
import { open } from '@op-engineering/op-sqlite'

// Open encrypted — key from Keychain, set at open time. key must NEVER be logged.
const key = await CryptoModule.getKeyFromKeychain()
const db = open({ name: 'mindwiki.db', encryptionKey: key })

// Parameterised — always
await db.execute('INSERT INTO entries (id, content) VALUES (?, ?)', [id, content])

// Multi-table transaction
await db.transaction(async (tx) => {
  await tx.execute('INSERT INTO entries ...', [...])
  await tx.execute('UPDATE wiki_pages ...', [...])
})
```

---

## LLM patterns

```typescript
// Fast model — synchronous, ≤2s, validates with Zod
const result = await fastModel.tag(entry.content)
if (!result.success) {
  // store entry anyway, skip wiki update — never block entry save
  return
}

// Deep model — always background
BackgroundFetch.schedule(async () => {
  await wikiEngine.processEntry(entry)
})

// All LLM output validated with Zod before use
const parsed = EntryTagSchema.safeParse(rawOutput)
if (!parsed.success) {
  // log error code only — never log entry content
  return
}
```

---

## Auth rules

- Auth is **optional**. Anonymous users have full journaling. Auth enables sync only.
- **Never** gate journaling features behind auth.
- Tokens stored in Keychain only — never AsyncStorage, never SQLite.
- Password flow: client `SHA-256(password)` → server `bcrypt(hash, 12)` → stored in KV.
- Master key derived `Argon2id(password, salt)` **client-side only** — never transmitted.
- All API calls go through `authenticatedFetch()` which handles 401 → token refresh.
- If `refreshAccessToken()` fails → set auth state `'unauthenticated'` + show re-login — do not block journaling.

---

## State management

Zustand with Immer. Stores in `src/store/`. Actions mutate via `set((s) => { s.field = value })`. Never mutate store state directly outside `set`.

---

## Testing

```
__tests__/
├── services/
│   ├── storage/entries.test.ts
│   ├── llm/fast-model.test.ts
│   ├── wiki/engine.test.ts
│   ├── graph/engine.test.ts
│   ├── auth/auth.service.test.ts
│   └── sync/conflict.test.ts
└── screens/
    ├── journal-entry.test.tsx
    └── graph.test.tsx
```

`yarn test` must pass before any commit. Mock all native modules in tests.

---

## What NOT to do

```
✗ Never send raw entry text to any external API
✗ Never store master key in AsyncStorage
✗ Never use Math.random() for crypto (use crypto.randomUUID())
✗ Never log entry.content, wikiPage.content, or any user text
✗ Never put business logic in screen components
✗ Never skip Zod validation on LLM output
✗ Never write speculative code that wasn't asked for
✗ Never "improve" adjacent code when making a targeted fix
✗ Never start implementing without stating your assumptions first
✗ Never use the 'any' TypeScript type
✗ Never use fs or path in Cloudflare Workers (V8 isolates, not Node.js)
✗ Never claim the app diagnoses or treats any condition (legal)
```

---

## Environment setup

```bash
node --version   # v22.x required
yarn install
cd ios && pod install && cd ..
cp .env.example .env.local   # fill in keys

# Models (not in git)
# See models/README.md for download instructions

yarn expo start
yarn expo run:ios      # physical device recommended for LLM testing
yarn expo run:android
yarn test
yarn tsc --noEmit

# Server local dev
cd server && wrangler dev   # port 8787, uses Miniflare
```

`.env.local` (never commit):
```
CLOUDFLARE_R2_BUCKET_URL=
CLOUDFLARE_R2_ACCESS_KEY_ID=
CLOUDFLARE_R2_SECRET_ACCESS_KEY=
REVENUECAT_PUBLIC_KEY_IOS=
REVENUECAT_PUBLIC_KEY_ANDROID=
API_URL=http://localhost:8787   # wrangler dev in local
```

---

## Key architectural decisions (ADRs)

| ADR | Decision | Reason |
|-----|----------|--------|
| 001 | LLM Wiki over RAG | Compounding synthesis vs session-by-session |
| 002 | op-sqlite (SQLCipher) over expo-sqlite | Transparent encryption at rest — expo-sqlite has no encryption (validated Phase -1) |
| 003 | On-device LLM via llama.rn/GGUF (cloud fallback opt-in) | Privacy promise — Qwen2.5 GGUF; ~45 tok/s fast model on device (validated Phase -1) |
| 004 | Result<T,E> over thrown exceptions | LLM failures must not fail entry saves |
| 005 | Zustand over Redux | Minimal boilerplate, sufficient complexity |
| 006 | Additive-only graph edges | Simplifies conflict resolution across devices |
| 007 | RevenueCat for subscriptions | Handles App Store + Google Play complexity |
| 008 | Cloudflare Workers for server | Zero cold start, global edge, cheap at low volume |
| 009 | Demo app before Phase 0 | Validate SQLCipher + Argon2 + LLM on real hardware before building |
| 010 | SHA-256 client + bcrypt server for passwords | Server never sees raw password → Argon2 key derivation stays local |
