# Auth ↔ DB Lifecycle Spec (account isolation)

> [SPEC] Normative spec for how the encrypted database, master key, session
> tokens, and in-memory state must behave across login, logout, account switch,
> session expiry, and crash/kill windows. Written 2026-07-18 after an audit of
> the current implementation.

## Scope

Covers the device-local lifecycle of four pieces of state:

| State | Where it lives | Owner |
|-------|----------------|-------|
| Session tokens (`access`, `refresh`, `accountId`) | SecureStore (`token-store.ts`) | account |
| Master key | SecureStore (`CryptoModule`, `mindwiki.master_key`) | account |
| Encrypted DB file (`mindwiki.db` + `-wal`/`-shm`) | app sandbox, keyed by master key | account |
| In-memory state (Zustand stores, `dbInstance` singleton) | JS runtime | session |

Out of scope: server-side session revocation, push-logout (deferred), backup
restore semantics, RevenueCat state.

## Invariants (normative)

- **I1 — Key isolation.** A master key must never be shared across accounts. A
  key found in the keystore may only be reused when it provably belongs to the
  account that is signing in.
- **I2 — Data isolation.** An account must never be able to open, decrypt, or
  render another account's DB rows, settings, drafts, or in-memory state.
- **I3 — Fail-safe partial logout.** If logout is interrupted (kill, crash,
  native error), the reachable states must degrade to "still logged in as the
  old account" — never to "logged out with old key/DB still installed".
- **I4 — Explicit ownership.** DB/key ownership must be checked by comparing
  account IDs, not only by relying on SQLCipher decrypt failure. (Decrypt
  failure only detects a *different* key; it cannot detect an *inherited* key.)
- **I5 — No writes after wipe.** Once a wipe starts, no background work (sync,
  LLM pipeline, catch-up) may touch the DB handle.
- **I6 — Informed destruction.** Logout is destructive (local wipe). The user
  must be told, and warned when unsynced changes would be lost.

## Current flows — audit results

State tuple notation: `(tokens, key, dbFile)` where each is `A` (account A's),
`B`, or `∅`.

| # | Case | Current behavior | Verdict |
|---|------|------------------|---------|
| 1 | Fresh install → register A | Key lazily generated on first `getKeyFromKeychain()`; DB created after auth gate with that key | OK |
| 2 | Logout A (complete) → register B | Wipe removes DB + key; B gets fresh key + fresh DB | OK |
| 3 | Logout A (complete) → login B | Fresh DB keyed to B's unwrapped key; restore pull | OK |
| 4 | Logout A (complete) → login A again | Fresh DB, same key from escrow, re-pull | OK (data re-pulled, by design) |
| 5 | Session expiry (401 + refresh fail) → relogin A | Tokens cleared, **key + DB kept**; same key reinstalled; old DB opens; local data preserved | OK, but must be pinned as intended (see Decisions) |
| 6 | Session expiry → login B | B's key installed; old DB fails decrypt → bootstrap self-heal wipes → fresh DB | OK (backstop works) |
| 7 | **Kill between `clearTokens()` and `deleteDatabase()` in logout → register B** | State `(∅, A, A)`. `register()` **reuses A's keychain key**, escrows it for B; `initStorage` opens A's DB **successfully** (same key) → **B sees A's entire journal** | **CRITICAL — violates I1, I2, I3, I4** |
| 8 | Kill between `deleteDatabase()` and `deleteKeyFromKeychain()` → register B | State `(∅, A, ∅)`. B escrows A's master key (key reuse, I1); B's data encrypted under a key A's old devices/escrow could know | **HIGH — violates I1** |
| 9 | Kill before `clearTokens()` (during server call) | Fully logged in still; user retries logout | OK (fail-safe) |
| 10 | Logout while background sync / LLM synthesis in flight | `deleteDatabase()` deletes the native handle mid-use; in-flight queries fail (Result-wrapped) or risk native-layer UB | **MEDIUM — violates I5** |
| 11 | Logout with unsynced local changes (or offline) | No confirmation dialog at all (`settings.tsx` logout button); queue rows are in the DB → silently destroyed | **MEDIUM — violates I6** |
| 12 | Account switch within one app session (A logout → B login, no restart) | Zustand stores not reset: `entry.store` draft, `chat.store` messages, `sync.store` flags survive in memory | **MEDIUM — violates I2 (residue), fix required** |
| 13 | Session expiry → relogin same account | Old `dbInstance` handle never closed; `initDb` opens a second connection on the same file; old handle leaks | LOW (WAL tolerates it; still a leak) |
| 14 | Remote sign-out (device removed from paired list) | Detected within ~15 s (`useSync` recheck) → session-expiry path → **DB + key remain on device at rest** | Accepted risk for now (push-logout deferred); must be documented |
| 15 | `device-id` and biometric-lock preference survive logout | Intentional for device-id (server device log); lock preference inherits to next account | Accepted (not user content); documented decision |
| 16 | LLM models (`documentDirectory/models/`) survive logout | Intentional — 2.8 GB, not user data | OK, pinned here |
| 17 | Self-heal wipe on transient IO error | `isDecryptFailure()` is deliberately narrow; transient errors do NOT wipe | OK |
| 18 | Dev-build JS reload → `dbInstance` null during logout | `deleteDatabase()` opens a throwaway handle to delete the file | OK (already fixed 2026-06-27) |

### Root cause of the reported bug (cases 7/8)

`logout()` currently runs: server call → `clearTokens()` → `deleteDatabase()` →
`deleteKeyFromKeychain()` → `setUnauthenticated()`.

Tokens are destroyed **before** the key/DB wipe. A kill in that window leaves an
unauthenticated device with the previous account's key and DB installed.
`register()` then *reuses* any key present in the keystore
(`getKeyFromKeychain()` generates only when missing — a design left over from
the pre-account-first anonymous mode, per its own comment), and because the key
matches, the old DB opens cleanly and the decrypt-failure self-heal never
fires. Result: the new account inherits the old account's journal.

## Required behavior (normative)

### R1 — Logout sequence (replaces current ordering)

```
logout():
  1. Set durable wipe marker:  SecureStore 'mindwiki.wipe_pending' = '1'
  2. Quiesce: stop the sync loop; await/cancel in-flight sync and LLM
     pipeline work (I5). New getDb() callers must fail closed.
  3. Best-effort server POST /auth/logout, hard timeout ≤ 5 s.
  4. deleteDatabase()            (DB before tokens — I3)
  5. CryptoModule.deleteKeyFromKeychain()
  6. clearTokens()
  7. Clear 'mindwiki.wipe_pending'
  8. Reset ALL in-memory stores (entry, chat, sync, wiki pending, lock
     transient fields) + setUnauthenticated()
```

Failure semantics: a kill at any step ≤ 3 leaves the user logged in (retryable).
A kill at steps 4–6 leaves `wipe_pending` set, which R2 repairs. There is no
reachable state where tokens are gone but key/DB survive unnoticed.

### R2 — Launch/auth-boundary wipe repair

At `hydrateAuth()` and immediately before any `register()` / `loginNewDevice()`
/ `recoverAccount()` / `redeemPairing()` submission:

```
if wipe_pending:
  deleteDatabase(); deleteKeyFromKeychain(); clearTokens(); clear marker
```

Idempotent; safe to run every launch.

### R3 — Explicit key ownership (defense in depth, I4)

- New SecureStore item `mindwiki.key_owner` = accountId, written at every
  point a master key is installed or first escrowed: `register()` (after the
  server returns the accountId), `loginNewDevice()`, `recoverAccount()`,
  `redeemPairing()`.
- `initStorage()` MUST compare `key_owner` with `tokens.accountId` before
  opening the DB. Mismatch ⇒ treat as foreign: `deleteDatabase()` +
  `deleteKeyFromKeychain()` + re-derive/re-install is impossible locally ⇒
  fail to the login screen (clear tokens). This catches inherited-key states
  that decrypt-failure self-heal cannot.
- `register()` MUST NOT reuse an existing keychain key. If a key exists at
  register time (any `key_owner`, or none), delete key + DB first, then
  generate a fresh key. The "existing local data stays decryptable" rationale
  in `register()` predates account-first onboarding and is void: at register
  time there is no legitimate local data.
- The decrypt-failure self-heal in `initStorage()` remains as a backstop.

### R4 — Logout UX (I6)

- Confirmation dialog, always: "Log out? Your journal on this device will be
  removed. Your account data stays encrypted in your sync backup."
- If `pendingUploads()` > 0 (sync queue non-empty) or the device is offline:
  escalate the copy — "N entries haven't synced yet and will be lost." When
  online, attempt one final sync flush before wiping.
- Logout button shows a busy state; re-entry is a no-op while running.

### R5 — Session expiry (Decision, pinned)

On refresh failure the device keeps key + DB and gates the whole app behind
the login screen (current behavior). Rationale: same-account relogin restores
instantly without a full re-pull; data remains encrypted at rest; a different
account signing in is handled by R3/self-heal. **The stale comments in
`auth.store.ts` and CLAUDE.md ("cached local journaling still works offline;
only sync pauses") do not match the implemented gate and must be updated** —
the gate wins: an expired session shows the login screen, journaling is not
accessible until re-login. (If offline journaling-while-expired is ever wanted,
it needs its own spec; it must not weaken R1–R3.)

Additionally, on transition to `unauthenticated` without wipe (this path):
`closeDb()` must be called so no open handle outlives the session (case 13),
and in-memory stores must be reset exactly as in R1 step 8 (case 12).

### R6 — What intentionally survives logout

Pinned so future audits don't re-litigate: `device-id` (server pairing log
continuity), LLM model files (not user data, ~2.8 GB), app binary settings
outside the DB. Biometric-lock preference currently survives — acceptable (it
is a boolean preference, not content) but reset is preferred if trivial.
Everything else (DB incl. settings table, drafts, sync cursor, first-run
markers, embeddings, master key, tokens) is destroyed.

## Test matrix

Unit (Jest, native modules mocked):

1. `logout()` invokes wipe steps in R1 order; tokens cleared only after DB+key.
2. Kill simulation: throw between each pair of R1 steps → assert reachable
   state is either "logged in" or "wipe_pending set"; then R2 repairs it.
3. `register()` with a pre-existing keychain key → fresh key generated, old DB
   deleted, `key_owner` written.
4. `initStorage()` with `key_owner ≠ tokens.accountId` → wipe + fail to login.
5. Logout resets every Zustand store to initial state.
6. Session-expiry path calls `closeDb()` and resets stores, keeps key + DB.
7. Logout with non-empty sync queue → confirmation copy includes count; flush
   attempted when online.
8. Self-heal still fires on decrypt failure; still does NOT fire on transient
   IO error strings.

Device (manual, two phones):

- A logout → B register → B sees empty journal; A's data gone from disk.
- Force-kill mid-logout (adb kill between steps, or induced) → relaunch →
  register B → B sees empty journal.
- Session expiry (revoke on server) → relogin A → data intact without re-pull.
- Session expiry → login B → fresh DB, restore pull runs.
- Logout offline with unsynced entries → warning shown; entries lost only
  after explicit confirm.

## File map (implementation targets)

- `src/services/auth/auth.service.ts` — `logout()` reorder (R1), `register()`
  fresh-key rule (R3), wipe-repair hook (R2)
- `src/services/storage/db.ts` — no change expected; `deleteDatabase()` stays
- `src/services/storage/bootstrap.ts` — `key_owner` check (R3)
- `src/native/CryptoModule.ts` — `key_owner` read/write helpers (R3)
- `src/services/auth/token-store.ts` or new `wipe-marker.ts` — `wipe_pending`
- `src/app/_layout.tsx` / stores — store resets + `closeDb()` on
  unauthenticated (R5)
- `src/app/(tabs)/settings.tsx` — logout confirmation (R4)
- `src/store/auth.store.ts`, `CLAUDE.md` — fix stale offline-journaling text (R5)
