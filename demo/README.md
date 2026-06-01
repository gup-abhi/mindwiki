# MindWiki — Phase -1 Demo

Standalone Expo app that validates the highest-risk technical dependencies on **your
physical device** before Phase 0 begins. Shares no code with `src/`.

This is the **hard gate**: Phase 0 does not start until every check below genuinely
passes on real hardware and the results table is filled in and signed.

---

## ⚠️ Read this first — what is real vs stubbed

To get the harness running, some checks ship against **stubs** that always pass. A green
badge on a stubbed check validates the UI/flow, **not** the real capability. Before
signing off the gate you must replace the stubs and re-run on device.

| Check | Status as scaffolded | To make it real |
|-------|----------------------|-----------------|
| SQLite + SQLCipher | ✅ **Real** — `@op-engineering/op-sqlite` with `sqlcipher: true`. The check writes with the key, then reopens with a *wrong* key and asserts the read fails | Already real after `expo prebuild`. (NB: this supersedes the CLAUDE.md "expo-sqlite + SQLCipher" stack — expo-sqlite has no encryption.) |
| Argon2id | ✅ Real (`react-native-argon2`) — confirmed 68ms at 64MB/3-iter, params verified by scaling test | Works after `expo prebuild` — record real timing |
| AES-256-GCM | ❌ **Stub** (`native/CryptoModuleStub.ts` — no encryption) | Implement native AES-256-GCM (iOS CryptoKit / Android Tink) |
| Fast model (1.5B) | ✅ **Real** (`native/LLMBridge.ts` — llama.rn/GGUF) | `adb push` `fast-model.gguf` (see `../models/README.md`), then run the check for real tok/s |
| Deep model (3B) | ✅ **Real** (llama.rn/GGUF) | `adb push` `deep-model.gguf`, then run the check |
| Notifications | ✅ Real (`expo-notifications`) | Works after prebuild + permission grant |

The whole point of Phase -1 is to de-risk SQLCipher, Argon2, and on-device LLM. The
Argon2 path is real; **SQLCipher and the two LLM checks still need real native
implementations before the gate is honestly met.**

---

## Requirements

- Node 22 (repo standard; this was scaffolded under Node 18 — bump before running)
- Xcode (iOS) and/or Android Studio
- A **physical device** — `react-native-argon2`, SQLCipher, and the LLM bridge need a
  dev build, not Expo Go
- Model files downloaded **and `adb push`ed to the device** (see `../models/README.md`) —
  required for the Fast/Deep model checks to pass (they run real llama.rn/GGUF inference)

## Run it

```bash
cd demo
npm install

# Type-check (do this first — no device needed)
npm run tsc

# Build a dev client and launch on a connected device
npm run prebuild          # expo prebuild --clean (links native modules)
npm run ios               # or: npm run android
```

Two tabs at the bottom: **System Check** (automated, has a “Run all”) and
**Entry Smoke** (manual save/read round-trip).

---

## Device test results

> Fill this in on your device. Phase 0 stays blocked until this is complete and signed.

```
Device: Samsung Galaxy S26 (SM-S942W), 12GB RAM  [adb: RFGL23DKBRJ]
OS:     Android 16
Date:   2026-06-01

| Check              | Result | Timing       | Notes |
|--------------------|--------|--------------|-------|
| SQLite + SQLCipher |   ✓    | 357ms        | Encrypted write/read OK; wrong key rejected (real SQLCipher via op-sqlite) |
| Argon2id           |   ✓    | 95ms         | 64MB/3-iter/4-parallel; params confirmed real via scaling test |
| AES-256-GCM        |   ⚠    | 1ms          | STUB (CryptoModuleStub) — no real crypto yet. Phase 8 / sync concern |
| Fast model (1.5B)  |   ✓    | ~45 tok/s    | Qwen2.5 1.5B Q4_K_M; infer 492ms, cold load 1143ms |
| Deep model (3B)    |   ✓    | ~18 tok/s    | Qwen2.5 3B Q4_K_M; infer 1941ms, cold load 4583ms |
| Notifications      |   ✓    | 125ms        | Permission granted, fires |

Entry smoke test: ✓ (encrypted entries.db via op-sqlite)

UX implications:
- Argon2 at 95ms: instant — key derivation needs no loading indicator.
- Fast model at ~45 tok/s: ≤2s tagging target is ACHIEVABLE (a ~30–50 tok tag ≈ ~1s).
  Keep the model context warm to avoid the ~1.1s cold load per use.
- Deep model at ~18 tok/s: fine for background wiki synthesis (non-blocking).

Stubs replaced with real native modules: PARTIAL — SQLCipher, Argon2, and on-device
  LLM are real; AES-256-GCM remains a stub (not needed until Phase 8 sync).
Phase 0 start approved: YES — the three highest-risk dependencies (SQLCipher, Argon2,
  on-device LLM) are validated on real hardware. AES tracked for Phase 8.
Signed: Abhishek — 2026-06-01
```

---

## Common failure modes and fixes

| Check fails | Likely cause | Fix |
|------------|-------------|-----|
| SQLCipher | Wrong pod version | `cd ios && pod install --repo-update` |
| SQLCipher Android | Missing AAR | Check `android/build.gradle` for sqlcipher dependency |
| Argon2 crash | Native module not linked | `npm run prebuild` (expo prebuild --clean) |
| LLM model not found | Not pushed to device | `adb push` the .gguf to the app files dir (see `../models/README.md`); path is in `native/LLMBridge.ts` |
| LLM load crash | Wrong GGUF format | Re-download — must be Q4_K_M, not Q5 |
| Notifications iOS | Missing entitlement | Add push notification capability in Xcode |
| Notifications Android | FCM not configured | Add `google-services.json` |
