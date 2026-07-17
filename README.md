# MindWiki

> A privacy-first AI journaling app that builds a compounding personal knowledge base from your journal entries — entirely on-device.

MindWiki is not a chatbot on top of a journal. The **wiki is the product**. Each journal entry doesn't get answered and forgotten — it updates a growing set of persistent, LLM-generated wiki pages about your emotions, beliefs, people, and patterns. The AI *synthesises* your inner life over time; it doesn't just retrieve it session by session.

Everything runs on your phone. No raw journal data ever leaves the device.

---

## Why it's different

| Most journaling apps | MindWiki |
|----------------------|----------|
| Re-derive insight from scratch each session (RAG) | **Compounding synthesis** — entries update persistent wiki pages (ADR 001) |
| Send your text to a cloud LLM | **On-device inference** via llama.rn / GGUF — raw entries never hit the network (ADR 003) |
| Plaintext or app-level "encryption" | **SQLCipher at rest**, AES-256-GCM in transit, zero-knowledge server (ADR 002) |
| A single notes list | A **visual knowledge graph** of emotions, people, beliefs, behaviors, and distortions |

## Core ideas

- **LLM Wiki architecture** — entries are immutable; wiki pages are mutable, versioned markdown. A submitted entry is tagged by a fast model (≤2s), crisis-checked, then processed in the background by a deep model that updates the affected wiki pages and upserts graph nodes/edges. Insights are never re-derived from scratch.
- **CBT-structured entries** — a 5-step prompt (mood → situation → thought → optional behaviour → optional closing note) grounded in cognitive behavioural therapy. Steps 4 and 5 are always skippable, and a failed LLM extraction never blocks an entry save.
- **Knowledge graph** — node types are `emotion`, `situation`, `person`, `belief`, `behavior`, `distortion`. Node size reflects frequency; edge weight reflects co-occurrence. Edges are additive-only, which keeps cross-device conflict resolution simple (ADR 006).
- **Privacy by construction** — the master key (a random 256-bit SQLCipher key) lives only in the iOS Keychain / Android Keystore and moves device-to-device via QR code or recovery phrase. The server stores ciphertext and account metadata only, and is mathematically unable to read your content.

## Privacy model

```
RAW ENTRIES   on-device SQLite + SQLCipher only; LLM runs on-device, never serialised to network
MASTER KEY    never transmitted; OS keystore only; device→device via QR or recovery phrase
WIKI PAGES    encrypted at rest; cloud LLM is opt-in and only ever sees wiki pages, never raw entries
SERVER        stores ciphertext + account metadata only — zero-knowledge by design
```

If any code path would send raw entry text over the network, it is rejected on sight.

## Tech stack

- **App** — React Native 0.76+, Expo SDK 52+, TypeScript 5 (strict), Expo Router
- **Storage** — op-sqlite with SQLCipher, react-native-argon2 for key derivation
- **On-device LLM** — llama.rn (GGUF, Q4_K_M): Qwen2.5 1.5B (fast) + 3B (deep)
- **State** — Zustand (+ Immer), TanStack Query, Zod for all LLM-output validation
- **Graph / animation** — react-native-svg, React Native Reanimated 3
- **Server** — Cloudflare Workers + R2 + KV (Wrangler), APNs / FCM for push
- **Subscriptions** — RevenueCat

## Repository layout

```
src/
  app/            Expo Router screens (auth / tabs)
  components/     graph, journal, wiki, digest, ui
  services/       storage, llm, wiki, graph, sync, auth, crisis, notifications, digest, subscription
  native/         LLMBridge, CryptoModule
  store/          Zustand stores
server/           Cloudflare Workers backend (auth, encrypted storage, push relay)
demo/             Phase -1 validation app (SQLCipher / Argon2 / LLM on real hardware)
models/           GGUF files (gitignored — see models/README.md)
docs/             ARCHITECTURE, DATABASE, LLM_PIPELINE, SYNC, PRIVACY_SECURITY, SERVER, …
__tests__/        service + screen tests
```

## Getting started

Requires **Node v22.x** and Yarn.

```bash
yarn install
cd ios && pod install && cd ..

cp .env.example .env.local     # fill in R2 / RevenueCat keys and API_URL

# Download GGUF models — see models/README.md (not tracked in git)

yarn start                     # Expo dev server
yarn ios                       # build & run on iOS (physical device recommended for LLM)
yarn android                   # build & run on Android
```

A physical device is strongly recommended — on-device LLM inference is the whole point, and simulators don't represent real throughput.

### Server (local dev)

```bash
cd server && wrangler dev      # port 8787, Miniflare
```

Point the app at it with `API_URL=http://localhost:8787` in `.env.local`.

## Development

```bash
yarn test        # Jest — must pass before any commit
yarn tsc         # TypeScript, strict, no emit
yarn lint        # ESLint
```

Conventions worth knowing before you contribute:

- All async service functions return `Result<T, AppError>` — no thrown exceptions (ADR 004), so a failed LLM extraction can never fail an entry save.
- No `any` — use `unknown` + type guards. Strict mode always.
- Services never imported directly from components — always through hooks.
- Never log `entry.content`, `wikiPage.content`, or any user-authored text.
- Absolute imports only (`@/services/...`), `StyleSheet.create()` for all styles, functional components only.
- Conventional commits (`feat(storage): …`, `fix(crisis): …`).

See [CLAUDE.md](CLAUDE.md) for the full engineering context and the [docs/](docs/) folder for subsystem deep-dives.

## Status

Phases -1 → 8 complete and device-verified: auth, end-to-end cross-device sync, recovery phrase, QR pairing, and in-app model download (verified on two phones). Next up is the business model (RevenueCat trial + paywall). A live Cloudflare deploy is still pending; the server currently runs on local Miniflare.

## Disclaimer

MindWiki is a journaling and self-reflection tool. It does not diagnose, treat, or provide medical care for any condition, and is not a substitute for professional mental-health support.
