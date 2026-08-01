# MindWiki Privacy-Leak Remediation — SPARC Plan

## 1. Goal and assumptions

### Goal
Close confirmed plaintext/privacy exposure paths found in whole-app audit:

- screenshots, recording, and task-switcher snapshots
- weak server-side ciphertext validation
- keyboard learning/autofill exposure for private writing
- hardcoded demo database key
- sensitive text in navigation parameters
- SecureStore keychain migration policy
- Android backup and debug network-inspector exposure
- release signing/configuration guardrails

Preserve existing privacy architecture: SQLCipher local DB, on-device LLM, device-to-device pairing, recovery phrase, AES-256-GCM sync, and opaque notification payloads.

### Assumptions

- Pairing QR continues to carry the master key device-to-device; server must never receive it.
- Recovery phrase remains visible during one-time setup.
- Global Android screenshot blocking is acceptable. iOS uses app-switcher masking because no exact cross-platform `FLAG_SECURE` equivalent exists.
- Android backup is not a product requirement; recovery phrase and encrypted sync remain restore paths.
- Demo app is non-production, but must clearly reject real personal data and must not use a committed encryption key.
- No schema migration is required for this remediation.
- Existing untracked `docs/FACTUAL_KNOWLEDGE_ARCHITECTURE.md` remains untouched.

## 2. Key findings and durable paths

### Storage and sync

- Production DB opener: `src/services/storage/db.ts`; SQLCipher key supplied at open.
- Client sync encryption: `src/services/sync/encryption.ts`; upload orchestration: `src/services/sync/engine.ts`.
- Upload trust boundary: `server/src/storage/upload.ts:11`; currently checks only truthiness and stores arbitrary `ciphertext`.
- Local R2 inspection found no confirmed plaintext journal fields, but three malformed short ciphertext values prove validation gap.

### Secret persistence

- Master key: `src/native/CryptoModule.ts`; SecureStore defaults currently used.
- Session tokens: `src/services/auth/token-store.ts`.
- Crash-recovery transition record containing master key and tokens: `src/services/auth/account-transition.ts`.
- SecureStore Android backup exclusions are generated/native configuration, not present at expected checked-in XML paths; verify generated output during implementation.

### UI/platform exposure

- Android activity: `android/app/src/main/java/com/mindwiki/app/MainActivity.kt`; no `FLAG_SECURE`.
- App lifecycle/lock overlay: `src/app/_layout.tsx`, `src/hooks/useAppLock.ts`, `src/store/lock.store.ts`.
- Pair QR: `src/app/pair.tsx`, `src/services/sync/pairing.ts`.
- Recovery phrase: `src/components/auth/RecoveryPhraseView.tsx`.
- Shared text input: `src/components/ui/TextField.tsx`; direct inputs also exist in journal/Reflect/reframe flows.
- User-derived navigation params: wiki/reframe route and graph focus route.

### Build/configuration

- Expo config: `app.json`.
- Android manifest: `android/app/src/main/AndroidManifest.xml`.
- Debug inspector flag: `android/gradle.properties`.
- Demo DB: `demo/screens/EntrySmoke.tsx`.

## 3. Proposed implementation — SPARC phases

### [SPEC] Define exact behavior

1. Write privacy contract tests/spec notes before implementation:
   - Production journal, wiki, chat, graph labels, reframes, drafts, and embeddings never persist outside SQLCipher or approved OS keystore.
   - Server sync blobs must be authenticated ciphertext envelopes, never arbitrary caller text.
   - Sensitive screens are masked immediately when app leaves active state.
   - Private writing inputs disable correction, spell checking, autofill, and personalized keyboard learning where platform APIs support it.
   - Navigation carries opaque IDs only, never user-derived labels or belief text.
   - Master key/session SecureStore entries are device-bound and excluded from backup migration.
2. Define upload envelope constraints:
   - exact allowed body keys
   - allowed sync tables
   - URL/body account, table, and record identity must agree
   - ciphertext must be bounded even-length hex with at least 12-byte nonce + 16-byte GCM tag
   - `updated_at` must be finite, integer, non-negative, and bounded as appropriate
3. Define sensitive-input policy API, likely a `sensitive`/`privacyMode` prop on `TextField` plus explicit handling for direct `TextInput`s.
4. Define route contracts:
   - `/reframe` receives page ID, not belief text
   - graph focus receives opaque node/page ID; label resolves from encrypted DB
5. Define platform behavior:
   - Android `FLAG_SECURE` at activity creation and resume.
   - iOS privacy cover when inactive/backgrounded; remove only after active and lock/auth state is safe.
   - App lock timing remains separate from screenshot masking; do not rely on 30-second grace period.

### [PSEUDO] Write behavior before code

1. `handleUpload(request)`:
   - parse unknown JSON safely
   - reject malformed JSON
   - validate exact envelope and path/body identity
   - validate allowed table and ciphertext shape/size
   - apply existing last-write-wins rule
   - store only `{ ciphertext, updated_at }`
2. `SensitiveTextInput`:
   - merge caller props with privacy defaults
   - never weaken privacy defaults for journal/Reflect/reframe/demo entry fields
   - retain auth-specific behavior through existing ordinary input props
3. Lifecycle masking:
   - on Android native activity: set secure window flag
   - on iOS/app JS lifecycle inactive/background: show opaque cover immediately
   - on foreground: keep cover until root/auth/lock state is ready
4. Keychain policy:
   - centralize SecureStore options
   - use `WHEN_UNLOCKED_THIS_DEVICE_ONLY` for master key, owner marker, session tokens, and transition record
   - preserve one-release migration behavior and delete legacy entries after successful rewrite
5. Opaque navigation:
   - push stable ID only
   - destination queries encrypted DB/store by ID
   - reject or ignore legacy text params without displaying/storing them
6. Demo:
   - generate or retrieve per-install random key from SecureStore, or remove persistence if demo is not intended for personal data
   - display explicit test-only warning
   - apply sensitive input defaults

### [ARCH] Confirm module boundaries

- `server/src/storage/upload.ts`: validation only; keep encryption ownership on client.
- New small shared server validator/helper only if needed by upload tests; no broad abstraction.
- `src/components/ui/TextField.tsx`: shared JS input defaults.
- Native Android activity/config plugin: screenshot flag; use Expo config plugin so prebuild preserves native change.
- Existing lifecycle/root components: privacy cover; avoid putting business logic in screens.
- `src/native/CryptoModule.ts` and auth stores: centralized SecureStore options.
- Pairing/reframe/graph routes: opaque identifiers.
- `demo/`: isolated test app changes only.

Dependencies:

- Upload validator depends on sync table definitions and AES-GCM output format.
- Privacy cover depends on React Native app lifecycle and existing lock gate.
- SecureStore policy depends on installed `expo-secure-store` constants and migration semantics.
- Native screenshot protection depends on Expo prebuild/config-plugin behavior.

### [TDD] Add failing tests first

1. Server upload tests:
   - valid encrypted-shaped payload stores successfully
   - plaintext JSON in `ciphertext` returns 400
   - short ciphertext returns 400
   - odd/non-hex ciphertext returns 400
   - oversized ciphertext returns 400
   - unknown table returns 400
   - path/body mismatch returns 400
   - malformed `updated_at`/extra fields returns 400
   - valid stale write still receives 200 without overwrite
2. SecureStore tests:
   - all sensitive writes pass device-only accessibility option
   - transition record uses same policy
   - legacy migration rewrites/deletes safely
   - key/token deletion remains complete
3. Input tests:
   - sensitive `TextField` emits privacy defaults
   - auth inputs can retain required password/autofill behavior
   - direct journal/Reflect/reframe fields receive privacy settings
4. Navigation tests:
   - reframe navigation sends ID only
   - destination resolves title/content locally
   - graph deep link sends opaque ID and resolves label locally
   - no user-derived text appears in route serialization
5. Lifecycle/platform tests:
   - app becomes covered on inactive/background
   - cover remains until safe foreground state
   - native config/plugin contains Android secure-window behavior
6. Demo tests or static checks:
   - no committed fixed DB key
   - demo warning exists
   - demo writes remain encrypted with per-install key or persistence is removed
7. Add static privacy scan test where practical for forbidden patterns:
   - `DB_KEY =` literals in demo
   - sensitive route params such as `belief`, `label`, `title` carrying text
   - raw upload body fields outside ciphertext envelope

### [IMPL] Implement smallest complete changes

1. Harden `server/src/storage/upload.ts`.
   - Parse as `unknown`; add narrow type guard.
   - Validate allowed tables and URL/body identity.
   - Validate ciphertext format, nonce/tag minimum, and maximum size.
   - Reject unexpected fields and invalid timestamps.
   - Keep R2 stored shape unchanged.
2. Add server tests under existing server test structure, reusing current auth-boundary/fake-R2 patterns.
3. Add central SecureStore options helper and update:
   - `src/native/CryptoModule.ts`
   - `src/services/auth/token-store.ts`
   - `src/services/auth/account-transition.ts`
   - any other master-key/token SecureStore call sites found during implementation.
4. Add screenshot protection:
   - implement Expo config plugin for Android `FLAG_SECURE`, or a checked-in native change only if project prebuild cannot support plugin safely;
   - add immediate app lifecycle privacy cover in root layout;
   - ensure Pair and recovery screens cannot remain visible in task snapshots;
   - do not log or copy QR/recovery content.
5. Add sensitive input defaults:
   - extend `TextField` with explicit privacy mode;
   - mark journal, Reflect, reframe, recovery, and demo content inputs sensitive;
   - add Android native no-personalized-learning flag if React Native props cannot guarantee it;
   - leave login/password manager behavior intentional and documented.
6. Replace user-derived route params:
   - reframe page title → page ID;
   - graph focus label → stable ID;
   - resolve display text after route using encrypted DB/store;
   - remove only data-path leakage, not unrelated UI refactors.
7. Fix demo key handling and warning.
8. Tighten platform/build config:
   - set Android `allowBackup=false` unless product explicitly requires backup;
   - remove/limit `EX_DEV_CLIENT_NETWORK_INSPECTOR` to local debug configuration;
   - add release guard against debug signing config before production build;
   - verify configured production API is HTTPS and debug cleartext behavior is not present in release.

### [REFINE] Security and regression verification

1. Review every modified diff against audit findings; reject unrelated cleanup.
2. Verify privacy defaults on iOS and Android, including password fields and multiline inputs.
3. Verify pairing still works: QR scans, server receives code/device metadata only, master key remains device-to-device.
4. Verify recovery still works and phrase is not persisted after setup.
5. Verify account transition crash-repair behavior with device-only SecureStore settings.
6. Verify R2 objects remain ciphertext-only after valid sync.
7. Verify malformed upload attempts never create R2 objects.
8. Verify generated Android manifest/resources after `expo prebuild` preserve secure window and backup policy.
9. Verify release artifact does not include debug inspector marker, localhost HTTP URL, or debug signing configuration.
10. Run physical-device SQLCipher canary gate when device is available:
    - save unique canary;
    - pull DB/WAL/SHM;
    - no `SQLite format 3` header;
    - canary bytes absent;
    - wrong-key open fails;
    - keyed integrity check passes.

## 4. Verification plan

### Automated

- `yarn test --runInBand` (or project-standard `yarn test` if no contention)
- `yarn tsc`
- `yarn lint`
- server-specific tests with malformed upload cases
- config/plugin tests or generated-file assertions

### Build/config

- `npx expo prebuild` in verification workspace; inspect generated Android manifest and resources.
- Android debug build: confirm screenshots/task snapshots blocked.
- Android release build: confirm backup/debug inspector/signing/API checks.
- iOS device build: background app and inspect app switcher; confirm opaque cover and recovery from foreground.

### Manual privacy matrix

| Surface | Expected result |
|---|---|
| Journal entry | not keyboard-learned/autofilled; no screenshot on Android; masked in app switcher |
| Reflect/chat | same |
| Reframe | same; route contains ID only |
| Recovery phrase | masked immediately on background; not backed up as app data |
| Pair QR | masked immediately; never sent to server |
| Local DB | SQLCipher only |
| R2 | ciphertext envelope only |
| Notifications | opaque metadata only |
| Demo | no fixed key; explicit test-only warning |

## 5. Risks, non-blocking questions, rejected alternatives

### Risks

- Global screenshot blocking can reduce usability for support/documentation; accepted due to master-key QR and recovery-phrase exposure.
- iOS app-switcher masking cannot prevent every screenshot or keyboard behavior; document platform limits.
- Device-only SecureStore migration may invalidate values on device migration; this is intentional because pairing/recovery are approved transfer mechanisms.
- Android generated resources may be overwritten by prebuild; config plugin is preferred.
- Strict table allowlist must track future sync tables; add one source of truth or explicit test failure when new table is introduced.

### Non-blocking questions

- Whether demo persistence should be removed entirely can be decided during implementation; per-install SecureStore key is default because it preserves demo behavior with minimal change.
- Whether release signing should be fixed in this remediation or enforced as a release-gate failure can be chosen based on deployment timing; it must not remain silently accepted for production.

### Rejected alternatives

- Do not send raw text to server for server-side validation; server validates ciphertext shape only.
- Do not replace SQLCipher with filesystem encryption or AsyncStorage.
- Do not put sensitive content in global state persistence, route params, notifications, or analytics.
- Do not rely only on the existing 30-second app lock; screenshot/task snapshots happen before relock.
- Do not rely only on client-side upload validation; server is the storage trust boundary.
- Do not remove pairing QR master-key transfer without a replacement recovery/device-transfer design.

## 6. Execution status — 2026-08-01

### Completed tracked-file remediation

- **Sync upload boundary** — `server/src/storage/upload.ts` now requires exact encrypted-envelope JSON, an allowlisted sync table, matching URL/body IDs, safe nonnegative timestamp, and 56–4,000,000-character even-length hex ciphertext. It rejects plaintext/malformed payloads before R2 persistence; existing LWW handling remains.
- **Device-only secrets** — `src/services/auth/secure-store.ts` centralizes `SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY`. Master key, key-owner marker, session tokens, and account-transition record use it; readable legacy values rewrite under device-only policy.
- **Private input mode** — `TextField` gained `sensitive`; journal, reframe, untangle, paths, challenge, wiki correction, entry search, Reflect composer, recovery phrase, and demo input disable supported correction, spellcheck, and autofill behavior. Auth fields retain password-manager ergonomics.
- **Opaque navigation** — reframe receives `pageId`; graph receives `nodeId`. Belief titles and graph labels resolve locally from encrypted storage rather than route state.
- **Demo safety** — removed committed DB key; demo generates ephemeral launch key and warns against personal data.
- **Release API guard** — non-dev builds reject non-HTTPS `EXPO_PUBLIC_API_URL`.
- **Lifecycle cover** — root `AppState` cover masks all routes, including auth, pairing, and recovery, while inactive/backgrounded.

### Tests and checks completed

- Added server upload-boundary tests, sensitive `TextField` tests, SecureStore policy tests, opaque-route contract updates, and root lifecycle-cover test.
- `yarn test --runInBand`: **175 suites, 1596 tests passed**.
- `yarn tsc --noEmit`: passed.
- `yarn lint`: 0 errors; 69 pre-existing warnings.
- `git diff --check`: passed.

### Material blocker — native protection not shipped

`android/` and `ios/` are generated and ignored. Direct local changes to Android manifest/activity/Gradle files cannot ship and will be overwritten by `expo prebuild --clean`.

Required tracked source-of-truth follow-up:

1. Set `expo.android.allowBackup: false` in `app.json`.
2. Add Expo config plugin applying Android `WindowManager.LayoutParams.FLAG_SECURE`.
3. Disable debug network inspector and debug release signing in tracked build configuration.
4. Run clean prebuild in disposable workspace; inspect generated manifest/activity.
5. Device-test Android screenshot/recording/recents, iOS app-switcher cover, SecureStore migration, SQLCipher DB/WAL/SHM canary, and release artifact.

JS lifecycle cover is defense in depth; do not claim shipped Android screenshot blocking, backup disable, native iOS snapshot prevention, or physical SQLCipher verification until above completes.
