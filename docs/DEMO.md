# MindWiki — Demo App

The demo app is a standalone Expo project in `demo/` that validates the three highest-risk technical dependencies on physical hardware before Phase 0 starts. It is not the real app. It shares no code with `src/`.

**Hard gate**: Phase 0 does not start until every check in this document passes on your actual device.

---

## Why this exists

The real app depends on:
1. **SQLCipher** — encrypted SQLite. Works differently on iOS vs Android, can break with certain Expo SDK versions.
2. **Argon2id native module** — password key derivation. Timing varies 1–8 seconds depending on device. You need to know your device's actual timing before designing UX around it.
3. **On-device LLM inference** — GGUF models via Core ML / ExecuTorch. Inference speed determines whether the 2-second fast-model target is achievable on your hardware.

Building Phase 0 and discovering one of these doesn't work is expensive. Running the demo takes 30 minutes and saves days.

---

## What's in the demo

```
demo/
├── App.tsx                        ← Expo entry point, 2-screen navigator
├── screens/
│   ├── SystemCheck.tsx            ← automated pass/fail checks with timings
│   └── EntrySmoke.tsx             ← manual entry save/read smoke test
├── native/
│   ├── LLMBridgeStub.ts           ← stub that returns hardcoded output
│   └── CryptoModuleStub.ts        ← stub for Android (use real Argon2 on iOS first)
├── package.json
└── README.md                      ← where you fill in your device results
```

---

## System check implementation

```typescript
// demo/screens/SystemCheck.tsx
// The demo uses op-sqlite with SQLCipher enabled in demo/package.json.

interface CheckResult {
  name: string
  passed: boolean
  timingMs: number | null
  detail: string
}

const CHECKS: Array<() => Promise<CheckResult>> = [

  async function checkSQLCipher(): Promise<CheckResult> {
    const start = Date.now()
    try {
      const db = open({ name: 'sqlcipher-check.db', encryptionKey: 'demo-test-key-32bytes-padding!!' })
      await db.execute('CREATE TABLE IF NOT EXISTS test (id TEXT, val TEXT)')
      await db.execute('INSERT INTO test VALUES (?, ?)', ['1', 'hello-mindwiki'])
      const result = await db.execute('SELECT val FROM test WHERE id = ?', ['1'])
      const row = result.rows[0] as { val?: string } | undefined
      db.close()
      const passed = row?.val === 'hello-mindwiki'
      return { name: 'SQLite + SQLCipher', passed, timingMs: Date.now() - start, detail: passed ? 'Write/read verified' : `Got: ${row?.val}` }
    } catch (e) {
      return { name: 'SQLite + SQLCipher', passed: false, timingMs: Date.now() - start, detail: String(e) }
    }
  },

  async function checkArgon2(): Promise<CheckResult> {
    const start = Date.now()
    try {
      const salt = 'mindwiki-demo-salt'   // fixed for determinism check
      const result = await Argon2.hash('testpassword', salt, {
        iterations: 3,
        memory: 65536,   // 64MB — same as production settings
        parallelism: 4,
        hashLength: 32,
        mode: 'argon2id',
      })
      const timing = Date.now() - start
      const passed = typeof result.rawHash === 'string' && result.rawHash.length > 0
      const detail = passed
        ? `Key derived in ${timing}ms${timing > 4000 ? ' — consider lower memory for UX' : ''}`
        : 'Hash output was empty'
      return { name: 'Argon2id key derivation', passed, timingMs: timing, detail }
    } catch (e) {
      return { name: 'Argon2id key derivation', passed: false, timingMs: Date.now() - start, detail: String(e) }
    }
  },

  async function checkAESGCM(): Promise<CheckResult> {
    const start = Date.now()
    try {
      // Use a fixed test key (32 bytes hex)
      const testKey = 'a'.repeat(64)   // 32 bytes in hex
      const plaintext = 'Hello MindWiki - AES test'
      const encrypted = await CryptoModule.encrypt(plaintext, testKey)
      const decrypted = await CryptoModule.decrypt(encrypted, testKey)
      const passed = decrypted === plaintext
      return { name: 'AES-256-GCM', passed, timingMs: Date.now() - start, detail: passed ? 'Encrypt/decrypt verified' : `Got: ${decrypted}` }
    } catch (e) {
      return { name: 'AES-256-GCM', passed: false, timingMs: Date.now() - start, detail: String(e) }
    }
  },

  async function checkFastModel(): Promise<CheckResult> {
    const start = Date.now()
    try {
      const loadStart = Date.now()
      await LLMBridge.loadModel('fast')
      const loadTime = Date.now() - loadStart

      const inferStart = Date.now()
      const output = await LLMBridge.tag(
        'Output only valid JSON with one field: {"emotion": "anxiety"}',
        { maxTokens: 50, temperature: 0.1 }
      )
      const inferTime = Date.now() - inferStart

      const parsed = JSON.parse(output)
      const passed = typeof parsed.emotion === 'string'
      const tokensPerSec = parsed ? Math.round(50 / (inferTime / 1000)) : 0

      return {
        name: 'Fast model (1.5B)',
        passed,
        timingMs: Date.now() - start,
        detail: `Load: ${loadTime}ms · Infer: ${inferTime}ms · ~${tokensPerSec} tok/s`,
      }
    } catch (e) {
      return { name: 'Fast model (1.5B)', passed: false, timingMs: Date.now() - start, detail: String(e) }
    }
  },

  async function checkDeepModel(): Promise<CheckResult> {
    const start = Date.now()
    try {
      const loadStart = Date.now()
      await LLMBridge.loadModel('deep')
      const loadTime = Date.now() - loadStart

      const inferStart = Date.now()
      const output = await LLMBridge.synthesise(
        'Write one sentence about journaling.',
        { maxTokens: 60, temperature: 0.7 }
      )
      const inferTime = Date.now() - inferStart

      const passed = output.trim().length > 10
      const tokensPerSec = Math.round(60 / (inferTime / 1000))

      return {
        name: 'Deep model (3B)',
        passed,
        timingMs: Date.now() - start,
        detail: `Load: ${loadTime}ms · Infer: ${inferTime}ms · ~${tokensPerSec} tok/s`,
      }
    } catch (e) {
      return { name: 'Deep model (3B)', passed: false, timingMs: Date.now() - start, detail: String(e) }
    }
  },

  async function checkNotifications(): Promise<CheckResult> {
    const start = Date.now()
    try {
      const { status } = await Notifications.requestPermissionsAsync()
      if (status !== 'granted') {
        return { name: 'Notifications', passed: false, timingMs: Date.now() - start, detail: 'Permission denied' }
      }
      await Notifications.scheduleNotificationAsync({
        content: { title: 'MindWiki demo', body: 'Notifications work ✓' },
        trigger: { seconds: 3 },
      })
      return { name: 'Notifications', passed: true, timingMs: Date.now() - start, detail: 'Permission granted, test fires in 3s' }
    } catch (e) {
      return { name: 'Notifications', passed: false, timingMs: Date.now() - start, detail: String(e) }
    }
  },

]
```

---

## Exit criteria template

Copy this into `demo/README.md` and fill in before starting Phase 0:

```
## Device test results

Device: _________________________________
OS:     _________________________________
Date:   _________________________________

| Check              | Result | Timing  | Notes |
|--------------------|--------|---------|-------|
| SQLite + SQLCipher |  ✓/✗   | ___ms   |       |
| Argon2id           |  ✓/✗   | ___ms   |       |
| AES-256-GCM        |  ✓/✗   | ___ms   |       |
| Fast model (1.5B)  |  ✓/✗   | ___tok/s|       |
| Deep model (3B)    |  ✓/✗   | ___tok/s|       |
| Notifications      |  ✓/✗   | ___ms   |       |

Entry smoke test: ✓/✗

UX implications:
- Argon2 timing of ___ms means: (e.g. show loading indicator > 2s)
- Fast model at ___tok/s means: (e.g. 2s target is achievable / not achievable)

Phase 0 start approved: YES / NO
Signed: _________________________________
```

---

## Common failure modes and fixes

| Check fails | Likely cause | Fix |
|------------|-------------|-----|
| SQLCipher | Wrong pod version | `cd ios && pod install --repo-update` |
| SQLCipher Android | Missing AAR | Check `android/build.gradle` for sqlcipher dependency |
| Argon2 crash | Native module not linked | `expo prebuild --clean` |
| LLM model not found | Path wrong | Model must be in `models/` and bundled via `metro.config.js` |
| LLM load crash | Wrong GGUF format | Re-download — must be Q4_K_M, not Q5 |
| Notifications iOS | Missing entitlement | Add push notification capability in Xcode |
| Notifications Android | FCM not configured | Add `google-services.json` |
