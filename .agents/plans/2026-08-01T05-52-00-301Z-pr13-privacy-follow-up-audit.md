# PR #13 Privacy Follow-up Audit — SPARC Remediation Plan

## Goal

Audit open PR #13 (`fix/privacy-leak-remediation`) for bypasses, regression risks, and unshipped protections. Close confirmed gaps without widening product scope. Preserve SQLCipher, on-device LLM, zero-knowledge ciphertext sync, QR pairing, recovery phrase, opaque notifications, and standalone demo isolation.

## Audit basis

- PR #13 head: `797c77dc06a8761b58620c262aab074aef1882bd`
- Base: `origin/main` `8e4369d1a280eb939b0c75d2d3f0134fc239b33a`
- GitHub CI `quality`: passed. PR mergeable and clean at audit time.
- Existing local untracked `docs/FACTUAL_KNOWLEDGE_ARCHITECTURE.md` remains excluded from all work.
- Review is code/static only. No Android/iOS physical device or release artifact verification occurred.

## Severity-ranked findings

### P0 — Android protection changes are not in PR or tracked build source

**Evidence**

- `.gitignore:9-10` ignores generated `android/` and `ios/`.
- `app.json` has no `android.allowBackup: false` and no privacy config plugin registration.
- No tracked `plugins/` directory exists.
- Local ignored generated artifacts may show `android:allowBackup="false"` and `FLAG_SECURE`, but release/CI prebuild derives from tracked `app.json`, so clean prebuild loses these protections.
- Generated `android/app/build.gradle` still configures `release` with `signingConfigs.debug`; generated `android/gradle.properties` local state must not be treated as source-of-truth.

**Impact**

Fresh Android build can allow app-data backup/data extraction, screenshots/screen recording, and task snapshots. Release artifact can remain debug-signed. Pair QR, recovery phrase, journal, and Reflect content are exposed by these platform surfaces.

**Required remediation**

1. Add tracked Expo configuration: `expo.android.allowBackup: false` in `app.json`.
2. Create tracked Expo config plugin. It must use supported config-plugin APIs to modify generated Android `MainActivity` and add `WindowManager.LayoutParams.FLAG_SECURE` before app content displays.
3. Register plugin in `app.json`; make transform idempotent and fail loudly if expected generated source shape changes.
4. Configure Android build/release source so production build cannot silently use debug signing. Prefer CI/EAS-provided signing credentials; document local release prerequisites instead of committing a keystore.
5. Set dev-client network inspector to off in tracked build source/plugin if Expo version supports it; otherwise add release artifact guard that fails on its presence.
6. Add prebuild-output verification test/script in disposable workspace. Assert:
   - manifest `android:allowBackup="false"`;
   - no conflicting backup/data-extraction resource attributes;
   - `FLAG_SECURE` in generated `MainActivity`;
   - no release debug signing configuration;
   - network inspector disabled/rejected.
7. Device-test Android screenshot, recording, and recents behavior for journal, Pair QR, recovery phrase, Reflect, and wiki. Test a release artifact, not only dev client.

### P0 — Standalone demo now fails after process restart

**Evidence**

- `demo/screens/EntrySmoke.tsx` keeps an encrypted `entries.db` on disk.
- It creates a new random `dbKey` every JS launch when module state resets.
- Existing database cannot be opened with next launch’s new key; `CREATE TABLE` fails before UI can clear data.

**Impact**

Demo smoke flow becomes unusable after first restart. Error state can surface native database details. This is regression from fixed key removal, not a secure deletion guarantee.

**Required remediation**

1. Preserve explicit test-only warning and sensitive input flags.
2. Use a random **per-install** SQLCipher key stored in demo-local SecureStore/Keychain, not a committed constant. It must be generated once, never logged, and use device-only accessibility.
3. Add one small demo dependency/config change only if SecureStore is unavailable to demo already.
4. Alternatively delete old `entries.db` plus WAL/SHM before every demo startup; reject this alternative unless per-launch-only behavior is explicitly desired because it discards smoke data and needs reliable native deletion.
5. Add demo restart contract test or narrow native/storage integration test: same install key reopens prior demo DB; no hardcoded key exists in source.

### P1 — Existing malformed R2 objects remain deliverable through delta

**Evidence**

- Audit previously observed local Miniflare R2 objects with 4–8-character hex payloads accepted before PR #13.
- `server/src/storage/upload.ts` now rejects future malformed uploads.
- `server/src/storage/delta.ts` trusts existing R2 JSON via cast and returns it unchanged; no envelope/table/key/timestamp validation.
- `src/services/sync/engine.ts` casts `resp.data.json()` to `DeltaRecord[]`; decryption failures skip only current record. This avoids plaintext application but does not repair/quarantine corrupt legacy server data.

**Impact**

Known malformed/legacy objects remain in backup storage and are served indefinitely. A malformed R2 blob can repeatedly consume sync work; a directly injected malformed blob can cause client JSON/parsing risk. Existing invalid R2 data is not remediated by upload hardening.

**Required remediation**

1. Extract a shared server-only ciphertext-envelope validator used by both upload and delta. Keep no plaintext validation/decryption on server.
2. In `handleDelta`, validate stored JSON, `ciphertext` shape, safe nonnegative timestamp, path table allowlist, and object-key parse before including response.
3. Skip invalid blobs without echoing their content. Log only non-sensitive object-key/error code if operational logging is needed.
4. Create one authenticated maintenance/quarantine process for existing invalid objects:
   - enumerate R2 objects per account/prefix;
   - identify invalid envelope/key metadata;
   - delete or move only demonstrably invalid blobs;
   - dry-run/report counts and keys, never ciphertext/plaintext;
   - run against Miniflare first, then production under explicit operational approval.
5. Harden client `pullDelta` at network boundary: validate `unknown` JSON response items before decrypt/`JSON.parse`; malformed remote records must not throw/wedge pull or advance cursor incorrectly.
6. Tests:
   - malformed stored JSON;
   - stored plaintext-shaped ciphertext;
   - invalid timestamp/extra keys;
   - key/body table or record mismatch;
   - valid blob remains returned;
   - client skips malformed delta item and still applies later valid item.

### P1 — Sync protocol authority duplicated and lacks contract regression guard

**Evidence**

- Client authoritative list is `src/services/sync/conflict.ts:SyncTable` / `SYNCED_TABLES`.
- PR duplicates same nine literals in `server/src/storage/upload.ts`.
- Client/server cannot import across React Native and Worker packages.

**Impact**

Future new synced table can be client-enqueued but server-rejected as `400`; client keeps retrying forever. Privacy hardening becomes silent sync outage.

**Required remediation**

1. Extract table names into a dependency-free shared TypeScript module usable by app, server, and tests, or retain explicit mirror but add a parity test importing both sources in Node/Jest.
2. Make server `SyncTable` derive from single readonly array when feasible.
3. Add test asserting client `SYNCED_TABLES` exactly equals server allowlist.
4. Document protocol versioning/rollout rule: server allowlist deploys before a client introducing a new table.

### P1 — Upload validation tests miss complete Worker route and hostile persisted-data cases

**Evidence**

- `__tests__/server/upload.test.ts` calls `handleUpload` directly.
- No server delta tests exist.
- `server/src/index.ts` matches any `GET` path ending `/delta` before delegation; handler relies on authenticated account ID rather than expected route shape.

**Impact**

Direct-handler coverage can miss router/path normalization and malformed-object behavior. Current broad delta match does not leak cross-account data because handler prefixes authenticated `accountId`, but it leaves ambiguous unsupported endpoint behavior.

**Required remediation**

1. Add Worker-level tests through `server/src/index.ts` for:
   - exact `/sync/{authenticatedAccountId}/delta` only;
   - foreign account path rejects;
   - malformed `/sync` paths reject;
   - encoded/separator-containing record IDs do not alter R2 object identity;
   - unauthenticated requests reject.
2. Make GET delta routing exact and verify path account ID matches authenticated account before calling `handleDelta`.
3. Define/validate record ID character and length policy compatible with all current sync tables. Do not assume UUID without schema audit; reject `/`, control characters, and unreasonable lengths at server boundary.
4. Set explicit body/ciphertext limits aligned with Worker/R2 platform limits and largest valid encrypted wiki/chat record. Add boundary tests at minimum/maximum/over-limit.

### P1 — iOS screenshot/task-switch protection remains best-effort JS only

**Evidence**

- PR root `AppState` cover in `src/app/_layout.tsx` mounts after JS receives inactive/background event.
- JS render scheduling cannot guarantee cover appears before iOS task-switch snapshot capture.
- No tracked iOS native source/config plugin exists.

**Impact**

Secret views can appear in iOS app-switcher snapshot during event/render race. No app can universally prevent normal iOS screenshots, but sensitive app-switch snapshot must be mitigated natively where platform supports it.

**Required remediation**

1. Keep JS opaque cover as fallback for all routes.
2. Extend tracked config plugin/native-generation approach with iOS application lifecycle privacy overlay (e.g. native window overlay added on resign-active and removed after active).
3. Make native transform idempotent and inspect generated iOS project.
4. Device-test backgrounding from Pair QR, recovery phrase, journal, and Reflect; capture exact app-switcher behavior on supported iOS versions.
5. Document residual platform limits: user screenshots and third-party keyboards cannot be absolutely controlled.

### P2 — Private input policy incomplete for iOS and sensitive credential fields

**Evidence**

- `TextField.sensitive` sets `autoCorrect`, `spellCheck`, `autoComplete="off"`, and Android `importantForAutofill="noExcludeDescendants"`.
- React Native declarations say iOS disables autofill with `textContentType="none"`; PR does not set it.
- Recovery phrase is sensitive but lacks `textContentType="none"`.
- Password inputs intentionally retain password-manager behavior, but no explicit `autoComplete` or `textContentType` policy prevents platform defaults from drifting.

**Impact**

iOS may still surface text-content/autofill suggestions for private journal/recovery text. Props reduce risk, not guarantee third-party keyboard behavior.

**Required remediation**

1. Add `textContentType="none"` for sensitive free-text/recovery inputs on iOS through shared `TextField` and direct `ConversationComposer` / recovery phrase inputs.
2. Keep auth password fields deliberately compatible with password managers using explicit platform values (`password`, `newPassword` as appropriate); set email username/email type explicitly.
3. Add component tests asserting sensitive iOS prop and direct sensitive-input props.
4. Physical-device test iOS/Android keyboard suggestions/autofill for journal, Reflect, recovery phrase, login, register, and recovery password.

### P2 — SecureStore device-only migration lacks failure coverage and nonsecret policy review

**Evidence**

- Device-only policy applied to master key, owner marker, tokens, account-transition data.
- Migration rewrites values after a default-options read.
- Tests cover token write options; no explicit failure tests for master key, owner marker, or account transition rewrite.
- `biometric.ts`, `device-id.ts`, and `wipe-marker.ts` retain default SecureStore options. Device ID is nonsecret; lock preference is low sensitivity. Wipe marker controls privacy cleanup and should be evaluated separately.

**Impact**

Failed migration write may reject auth/bootstrap path even though old secret remains readable. Interrupted-wipe marker may migrate across device restore, potentially causing unexpected wipe; default backup/accessibility should be intentional and documented.

**Required remediation**

1. Confirm Expo SecureStore semantics: `keychainAccessible` applies iOS; Android backup behavior is controlled by config-plugin/manifest, not this option.
2. Add failure-path tests: legacy master key/owner/token/transition remains intact and readable if device-only rewrite fails; no destructive clear occurs before successful rewrite.
3. Decide and document policy for `wipe_pending`:
   - device-only if it is part of local privacy cleanup state;
   - otherwise retain default intentionally with rationale.
4. Keep device ID default only after recording it is nonsecret identity metadata.
5. Test real iOS upgrade/migration and Android backup-restore behavior after native backup policy lands.

### P2 — Route privacy audit still needs semantic boundary tests

**Evidence**

- PR correctly changed belief/graph label routes to opaque `pageId`/`nodeId`.
- Existing app still accepts route params `q`, `tier`, `conf`, `mood`, category, and first-run flags. Current known flows only pass curated/numeric values, but query route feeds `q` to conversation startup.

**Impact**

No confirmed current plaintext content route leak remains in reviewed route constructors. Future caller can reintroduce user text into `q`/other params without a failing contract test.

**Required remediation**

1. Add route-policy regression test or static lint/check that forbids user-derived entry/page/graph/chat text in navigation params and URL string construction.
2. Keep only opaque IDs, enum values, booleans, or bounded numeric values in routes. Define allowed params per route.
3. Validate inbound opaque IDs/numbers before storage lookup/UI use; invalid values route safely back with no raw param display/logging.
4. Add tests that page/graph title is absent from navigation action and that invalid `pageId`/`nodeId` cannot cause storage/network calls outside expected lookup.

## SPARC implementation sequence

### [SPEC]

Define acceptance criteria before code:

- Clean `expo prebuild --clean` from tracked repository produces Android backup disabled and `FLAG_SECURE`; release source cannot use debug signing.
- Root and native lifecycle protections hide sensitive UI on inactive/background; no claim of total screenshot prevention.
- Demo reopens its own SQLCipher DB across process restart using a generated per-install device-only key; no committed key.
- Upload and delta expose/store only valid opaque encrypted envelopes; invalid legacy objects are quarantined/deleted by approved maintenance process.
- Sync table list has one authority or executable parity contract.
- Sensitive input policy includes platform-supported `textContentType="none"`; password-manager behavior stays explicit.
- Legacy SecureStore secret rewrite fails safely without deletion or auth state corruption.

### [PSEUDO]

```text
shared sync tables -> app conflict list + server validator + parity test

validateEnvelope(value, expectedTable?, expectedRecordId?):
  require plain object, exact expected keys
  require table from shared list
  require bounded safe record id
  require nonnegative safe-integer timestamp
  require even hex nonce+ciphertext+GCM-tag length in bounds
  return typed value or null

upload:
  parse JSON -> validate envelope against exact route -> LWW head -> write envelope

delta:
  require exact authenticated route
  page R2 objects
  parse key -> validate table/id
  parse JSON -> validate stored envelope against key
  include valid only
  report invalid key/code only

client pull:
  parse response as unknown[]
  validate delta item before decrypt and decrypted row before apply
  skip malformed item, continue valid items

privacy config plugin:
  set Android backup false through Expo config
  idempotently add FLAG_SECURE to generated MainActivity
  idempotently add iOS inactive privacy overlay
  run clean prebuild verification assertions

demo key:
  read demo key from device-only SecureStore
  if missing: crypto-random 256-bit key -> write -> open SQLCipher DB
```

### [ARCH]

- Shared protocol constants/validator: dependency-free module under a location importable by Worker and app; no React Native/native imports.
- Server owns envelope shape and R2 key validation; never decrypts content.
- Client owns encryption/decryption and validates remote untrusted JSON before parsing/decrypting.
- Expo config plugin owns generated Android/iOS changes. Do not commit generated native project as source of truth.
- Shared `TextField` owns standard private-writing props; direct native `TextInput` components mirror them only where unavoidable.
- SecureStore helper owns secret accessibility policy; individual modules do not duplicate options.

### [TDD]

Write failing tests first:

1. Server Worker route/upload/delta tests, including malformed stored R2 data and foreign path rejection.
2. App/server sync-table parity test.
3. Client malformed-delta resilience test with one invalid and one valid record.
4. Demo key lifecycle/restart test or testable key helper unit test.
5. Config-plugin unit/fixture tests plus generated prebuild assertions.
6. TextField/direct-input iOS `textContentType` and Android autofill contracts.
7. SecureStore migration failed-rewrite tests for key, owner, tokens, transition, and wipe-marker policy.
8. Navigation privacy contracts and invalid opaque-param tests.

### [IMPL]

1. Land P0 native config plugin and tracked configuration; inspect clean prebuild output.
2. Fix demo per-install key before merge to avoid restart breakage.
3. Add shared sync table list/validator; harden upload, delta, and client pull.
4. Run approved R2 invalid-object maintenance dry run; require explicit approval before production deletion/quarantine.
5. Complete input policy and SecureStore failure behavior.
6. Add route-policy regression guard.
7. Update privacy plan/docs/PR description with exact protection boundaries and device-test requirements.

### [REFINE]

- Bound all identifiers and payload sizes based on observed maximum legitimate encrypted wiki/chat records plus safety margin.
- Ensure logs contain only error code, table, opaque ID/key—not ciphertext or decrypted content.
- Test interrupted auth/transition paths after SecureStore rewrite failures.
- Keep changes surgical; no analytics, cloud LLM, or unrelated navigation refactors.

## Verification

### Automated

- `yarn test --runInBand`
- `yarn tsc --noEmit`
- `yarn lint` with no errors
- `git diff --check`
- `cd server && yarn typecheck`
- focused server Worker + sync protocol tests
- config-plugin fixture tests
- disposable `npx expo prebuild --clean` verification script

### Artifact and device gates

1. Inspect generated Android manifest/activity and release Gradle output.
2. Build Android release artifact; verify signing certificate is not debug and network inspector is absent.
3. Android physical: screenshot, recording, recents, backup/data extraction, SQLCipher DB/WAL/SHM canary.
4. iOS physical: app-switcher snapshot from all sensitive screens; Keychain migration behavior; keyboard/autofill behavior.
5. R2: Miniflare dry-run cleanup first; production enumeration/deletion only after explicit approval and audited count/key report.

## Rejected alternatives

- Do not add server-side decryption or plaintext inspection.
- Do not treat generated Android/iOS local edits as deliverable source.
- Do not restore a fixed demo database key.
- Do not put recovery/master keys in routes, AsyncStorage, logs, or server payloads.
- Do not claim keyboard, iOS screenshots, or JS lifecycle masking are absolute platform guarantees.
- Do not delete production R2 objects without explicit operational approval and dry run.

## Execution notes — 2026-08-01

Material sync-protocol refinement after schema audit:

- New writes use protocol V2 only: opaque HMAC-SHA256 sync IDs replace plaintext record IDs in server routes, bodies, and R2 keys.
- V2 AES-256-GCM derives keys from and authenticates account/table/sync-ID context. Client verifies decrypted row ID recomputes to sync ID before apply.
- Legacy `account/table/recordId` R2 objects remain read-only compatible, including separator/Unicode IDs. Successful legacy pulls enqueue V2 migration uploads. No automatic legacy deletion/quarantine.
- Delta uses bounded R2 pages, opaque cursors, exact authenticated routes, ciphertext/response caps, strict server/client validation, and count-only malformed diagnostics.
- Authenticated `/sync/{accountId}/audit?dry_run=true` reports counts only. No mutation endpoint exists; production cleanup still requires explicit operational approval.
- Shared dependency-free module across Metro/Worker was not used because package boundaries differ. Server owns readonly list; Jest parity test enforces exact client/server equality.
- Tracked Expo plugin now reproduces Android backup denial, `FLAG_SECURE`, release debug-signing removal, disabled dev-client network inspector, and native iOS lifecycle overlay. Disposable clean prebuild generated expected files. Device gates remain.
- Query `q` route-param ingestion was removed because no current constructor needed it and it allowed future plaintext route leakage.

## Non-blocking residual risks

- Third-party keyboards remain outside app control even with private-input props.
- User-initiated iOS screenshots cannot be universally prevented.
- Server can validate ciphertext envelope structure only, not prove encryption authenticity without decrypting; client AEAD validation remains integrity gate.
