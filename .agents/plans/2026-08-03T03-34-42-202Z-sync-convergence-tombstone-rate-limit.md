# SPARC: Sync convergence, challenge tombstone, auth rate limiting

Fixes audit findings P1-#1/#2, P1-#3, P2-#4 (2026-08-03 audit). Deferred items listed at end.

## 1. SPEC

### F1 — Delta pull convergence (engine.ts + server delta unchanged)

Current behavior (verified): `pullDelta` fetches ≤512 pages × 8 records per window, then sets global cursor `sync:last_pull` = max `updated_at` over **decoded** records. Consequences:

- **Wedge:** window > 4096 records → hard `SYNC_PULL_FAILED` before anything applies → every sync retries, applies nothing, forever. (fresh restore / long-offline device / ~2yr journal)
- **Silent loss:** window ≤ 4096 but records remain. R2 list is key-ordered (HMAC sync_ids = random order); cursor = max over a random subset. Unfetched records with `updated_at ≤ cursor` are filtered forever by `metadataTimestamp <= since` (delta.ts:54).
- **Skip-forever (apply error):** `maxUpdated` is folded in at **decode** time (engine.ts decode loop), so an `applyRemote` exception still advances the cursor → row never applied, never retried.
- **Re-pull-forever (decrypt/parse error):** failures excluded from `maxUpdated` → re-fetched every sync, cursor stuck.

Desired behavior:
1. No hard wedge — hitting the page cap pauses the window and resumes next sync from the server's R2 list cursor (`next_cursor`, already returned by delta.ts; server code unchanged).
2. Every record with `updated_at > since` is scanned exactly once per window; cursor only advances when the window is fully scanned. No silent loss.
3. Decrypt/parse/apply failures go to a local quarantine table with a retry budget (3 attempts); excluded from cursor advance until budget exhausted, then dropped with a count-only log.
4. Restore UI (`endRestore()`) fires only on window completion, not on a paused partial pass.

**Explicitly out:** backward-clock-skew corner (a record written with `updated_at` > 24h behind an already-applied max can strand). Matches server's forward `MAX_FUTURE_SKEW_MS` bound (protocol.ts:18); server filter unchanged. Documented in code comment.

### F2 — Challenge deletion syncs (tombstone)

`deleteChallenge` (challenges.ts:160) is `DELETE FROM challenges` local-only → a removed challenge resurrects on other devices and after restore. Desired: `UPDATE ... SET deleted_at = ?` tombstone + sync via existing upsert protocol; all challenge reads filter `deleted_at IS NULL`. Entries deletion is NOT user-facing (no `deleteEntry` caller in `src/app`) → stays documented-known (§22.1), same pattern later.

### F3 — Auth rate limiting (server)

No rate limiting anywhere in server (grep rate/limit/429 → zero). Login brute-force is the crown-jewel vector: guess password → unwrap escrow → full plaintext journal. Desired: KV sliding-window limiter:

| Route | Scope | Limit |
|---|---|---|
| POST /auth/login | per-email | 10 / 15 min |
| POST /auth/login | per-IP | 30 / 15 min |
| POST /auth/recover | per-email | 5 / 15 min |
| POST /auth/register | per-IP | 5 / 15 min |
| POST /auth/refresh | — | unlimited (256-bit random token, no brute vector) |

429 + `Retry-After`. Client maps 429 → distinct error on login/recover screens.

## 2. PSEUDO

### F1 — pullDelta state machine

```
state = readSetting('sync:pull_state')                     // JSON {since, cursor, windowMax}
  ?? { since: readSetting('sync:last_pull') ?? 0, cursor: null, windowMax: 0 }   // one-time migrate

// Phase 1 — scan (resumable)
remote = []; pageCount = 0; paused = false; nextCursor = state.cursor
loop:
  page = fetch `/sync/{acc}/delta?since=${state.since}${nextCursor ? '&cursor='+nextCursor : ''}`
  on fetch/parse error: if nextCursor → nextCursor = null; retry once   // expired-cursor self-heal
                       else → return err
  remote += page.records
  nextCursor = page.next_cursor
  pageCount++
  if nextCursor && (pageCount >= MAX_DELTA_PAGES || ciphertextHex > MAX_DELTA_CIPHERTEXT_HEX):
      paused = true; break                                            // soft pause, NOT err
  if !nextCursor: break                                                // window complete

// Phase 2 — decode + apply (per table, as today)
for table:
  for r in remote where r.table == table:
    dec = decrypt/parse/id-verify
    fail → quarantine(table, r.record_id, r.updated_at)                // failures<3 → skip; ==3 → purge + count
    ok  → decoded[]
  local = localUpdatedAt(decoded)
  for d in recordsToApply(decoded, local):
    try applyRemote(d); quarantine-delete(d); applied++
    catch → quarantine(table, d.record_id, d.updated_at); continue     // count-only log

// Phase 3 — cursor advance
windowMax = max(state.windowMax, max updated_at over scanned records NOT in quarantine(failures<3))
if paused: write pull_state {since: state.since, cursor: nextCursor, windowMax}
else:      write pull_state {since: windowMax, cursor: null, windowMax: 0}
           purge quarantine rows with failures ≥ 3 (drop, count-only log)
           useSyncStore.endRestore()                                   // moved out of sync()
           if applied > 0: rebuildGraph(); bumpRevision()              // as today
return ok(applied)
```

`sync()` keeps signature; drop its unconditional `endRestore()`.

### F2 — tombstone

```
migration037:
  CREATE TABLE sync_skipped (
    table TEXT NOT NULL, record_id TEXT NOT NULL, updated_at INTEGER NOT NULL,
    failures INTEGER NOT NULL DEFAULT 1, last_attempt INTEGER NOT NULL,
    PRIMARY KEY (table, record_id))
  ALTER TABLE challenges ADD COLUMN deleted_at INTEGER
  CREATE INDEX idx_challenges_deleted ON challenges (deleted_at)   -- optional, small table → skip

deleteChallenge(id):
  db.execute('UPDATE challenges SET deleted_at = ?, updated_at = ? WHERE id = ?', [now, now, id])
  enqueueUpsert('challenges', id)                     // tombstone syncs

reads (storage layer only — notifications/streak go through these):
  listChallenges:   WHERE deleted_at IS NULL
  getActiveChallenge: status='active' AND deleted_at IS NULL
  getChallenge:     AND deleted_at IS NULL

engine.ts TABLES.challenges.columns += 'deleted_at'   // applyRemote INSERT OR REPLACE carries it; LWW by updated_at unchanged
rowToChallenge maps deleted_at
```

### F3 — rate limiter

```
// server/src/middleware/rate-limit.ts
kvRateLimit(env, scope, key, limit, windowMs): Promise<Result>
  k = `rl:${scope}:${key}`; now = Date.now()
  cur = AUTH_KV.get(k, 'json')            // {count, windowStart}
  if !cur || now - cur.windowStart >= windowMs: cur = {count: 0, windowStart: now}
  if cur.count >= limit: return 429 + Retry-After (windowStart+windowMs-now)/1000
  AUTH_KV.put(k, {count: cur.count+1, windowStart: cur.windowStart}, {expirationTtl: windowMs})
  // KV eventual consistency → bursts possible under race; documented, DO upgrade path

index.ts public routes wrap:
  register → ipKey(cf-connecting-ip) 5/15min
  login    → email 10/15min AND ipKey 30/15min
  recover  → email 5/15min
  ipKey null (local dev) → skip IP leg

client auth.service login/recover: 429 → AUTH_RATE_LIMITED; screens show "too many attempts"
```

## 3. ARCH

- **No server protocol change for F1** — `next_cursor` already exposed (delta.ts:92-97). All change client-side: `src/services/sync/engine.ts` + `src/services/storage/settings.ts` (JSON value under one key).
- `sync_skipped` table: new migration 037 in `schema.ts` (`migration037`, statements above) + append to `MIGRATIONS` in `migrations.ts` (pattern verified: migration036 at schema.ts:791, registry at migrations.ts:~115).
- Quarantine helpers live in `engine.ts` (or small `src/services/sync/quarantine.ts` — prefer inline in engine.ts; single-use). Excluded from `windowMax` when `failures < 3`.
- F2 touches: `src/services/storage/challenges.ts` (delete + 3 reads + rowToChallenge), `engine.ts` TABLES allowlist, migration 037. Notifications/streak reach challenges only via storage exports (verified: candidates.ts imports `getActiveChallenge`) — filter once at storage layer.
- F3 touches: new `server/src/middleware/rate-limit.ts`, `server/src/index.ts`, client `src/services/auth/auth.service.ts` (error map) + login/recover screens.
- Limits as constants; response shape = existing plain-text style.

## 4. TDD

Client (jest, existing harnesses):
1. `__tests__/services/sync/engine.test.ts` (extend fakeDb with `sync_skipped` routing + pull_state settings key):
   - cap hit → `ok`, not err; pull_state persists {since: old, cursor: X, windowMax}; second pull resumes from cursor and completes; since = max scanned.
   - decrypt-fail record: quarantined; excluded from since; re-fetched next window; after 3 attempts purged + since passes.
   - applyRemote throw: same quarantine path.
   - window complete: since = max over all scanned (not just applied); endRestore called on complete only.
   - legacy `sync:last_pull` seeds pull_state when absent.
   - existing tests keep passing (single-window behavior unchanged).
2. `__tests__/services/storage/challenges.test.ts`:
   - deleteChallenge sets deleted_at + enqueues upsert; list/active/get exclude deleted.
   - pulled tombstone row (applyRemote) → reads return nothing.
3. `__tests__/services/storage/migrations.test.ts`: migration037 applies + re-runs idempotent.

Server: no test runner (verified: no test script/files) → typecheck + manual `wrangler dev` verification (below). Adding vitest to server = rejected scope creep.

## 5. IMPL

1. schema.ts: `migration037` (sync_skipped + challenges.deleted_at); migrations.ts: append to registry.
2. engine.ts: pull-state read/migrate/write; scan loop soft-pause; quarantine upsert/purge/check; windowMax tracking; endRestore move; decrypt/apply failure routing to quarantine. Keep `MAX_DELTA_PAGES` as per-pass pause threshold.
3. challenges.ts: tombstone delete + read filters + rowToChallenge; engine.ts TABLES.challenges.columns += `deleted_at`.
4. server: `middleware/rate-limit.ts` + index.ts route wrapping.
5. client auth: 429 mapping + login/recover screen copy.
6. Update engine.test.ts fakeDb; write new tests (TDD list).
7. `yarn tsc --noEmit`; `yarn test`.

## 6. REFINE / VERIFY

- `yarn tsc --noEmit`, `yarn test` (183 suites) green.
- `cd server && npm run typecheck`.
- Manual: `wrangler dev` + curl — register/login 10 rapid → 429 + Retry-After; delta resume: seed 20+ records via PUT, pull with `since=0` until `next_cursor` null, confirm all applied, no repeat on second pull.
- Perf: resumed pulls avoid O(n) re-scan (finding P3-#8 partially fixed); `rebuildGraph` gating = separate deferred item.

## Risks / open questions

- **R2 list cursor expiry across app restarts** (undocumented Cloudflare TTL) → expired-cursor self-heal reset (re-list from start, same since). Converges, extra cost only.
- **KV limiter races** (eventual consistency) → bursts possible; Durable Objects = production upgrade, documented in code.
- **Quarantine drop after 3** = permanent skip for that device if the error was transient → bounded, count-only logged.
- **Backward clock skew > 24h** can strand a record — documented, matches existing forward bound; no server change.
- **entries deletion** still local-only (§22.1, no UI caller today) — deferred, same tombstone pattern.
- Deferred audit findings: refresh-token reuse/family invalidation, push-relay doc drift, rebuildGraph gating, synced-column allowlist test, equal-timestamp LWW (already §22.2-documented).

## 7. EXECUTION (2026-08-03) — status: DONE

All items shipped + verified. Deviations from the plan (reality notes):

1. **F1 completion formula** — `since` advanced via `Math.max(since, state.windowMax, windowMax)`, not just `Math.max(state.windowMax, windowMax)`. Without the `since` term the cursor *regresses* to 0 when a quarantined row is the only window content (found in TDD). See engine.ts Phase 3.
2. **Quarantine SQL param count** — `failures` is a literal `1` in the INSERT (4 bound params, not 5). The engine.test.ts fake initially destructured 5 params and read `failures = Date.now() ≥ 3`, dropping rows instantly; fake fixed to mirror the real SQL.
3. **Cap-hit pause** only fires when the list continues (`hadMore`); overflow on the final page is applied (pushed before the check) — prevents an infinite pause/resume loop on a window larger than `MAX_DELTA_CIPHERTEXT_HEX`.
4. **Decrypt-failure quarantine key** = wire identity (`sync_id` for V2 — the record id lives inside the ciphertext); a later success clears by real id and the below-cursor purge deletes any stale row.
5. **`sync:last_pull` still written** alongside `sync:pull_state` — legacy/rollback compat; read priority is `pull_state`, seeded once from `last_pull`.
6. **rowToChallenge unchanged** — `deleted_at` not added to the public `Challenge` interface (reads filter before mapping; no churn).
7. **schema.test.ts** version-list assertion extended to 37 (existing suite, not in TDD list).

### Verification results
- `yarn tsc --noEmit` clean · `yarn test` 183 suites / 1649 tests pass (+8 new) · `server npm run typecheck` clean.
- wrangler dev + curl: register 1 account → login ×10 = 200, 11th = **429**; recover ×5 = 200, 6th = **429**; PUT 20 records → delta pagination 8+8+4 = **20 records, cursor-resumed** ✓.
- Retry-After header set on 429 (code path; 429 confirmed).

### Scope check
- Deferred as planned: entries tombstone (§22.1), refresh-token reuse detection, push-relay drift, rebuildGraph gating, allowlist trap test, equal-LWW.
- Nothing outside the plan was touched (10 modified files, 2 new: rate-limit.ts, migration037; challenge screens/useChallenge unaffected — tombstone transparent).

## 8. FOLLOW-UP BATCH (2026-08-03) — deferred findings 6a–6e done

**6a — refresh-token replay detection + family invalidation (P2, server)**
- refresh.ts: rotated tokens are now kept as `used` markers (TTL = token lifetime) instead of deleted. Presenting a used token = replay → the whole family is invalidated → 401 'Refresh token reuse detected'. A stolen session can no longer refresh undetected; the real device is forced to re-login (family check in authMiddleware kills its access too). Marker growth bounded by TTL; client single-flights refresh per token, so same-token retry races don't false-positive.
- Verified via wrangler dev: rotate → replay old = 401 reuse-detected → new token = 401 'Session invalidated' → access token = 401.

**6b — push-relay doc drift (P2, docs)**
- docs/SERVER.md: removed APNS_KEY/APNS_KEY_ID/APNS_TEAM_ID/FCM_SERVICE_ACCOUNT secrets, `push:{account_id}` KV schema, `/push/register` route + Env fields. Added a note: notifications are local-only today; server-side push relay is future work. No code change — `server/src/` never had push code.

**6c — rebuildGraph gating (P3)**
- engine.ts: full graph rebuild now only fires when the window applied `entries` or `entry_entities` rows (the only tables rebuildGraph reads). Other tables (chat_messages, streak_freezes, …) just bump the revision.

**6d — synced-column allowlist trap (P3, test)**
- engine.ts now exports `TABLES`; new guard tests in engine.test.ts walk MIGRATIONS (CREATE TABLE + ALTER ADD COLUMN) and assert (a) every TABLES column exists in the schema, (b) every schema column of a synced table is either in TABLES or declared local-only (`LOCAL_ONLY` = { entries: [wiki_indexed_at, graph_indexed_at] }). Verified red on a planted phantom column.

**6e — equal-timestamp LWW divergence (P3, client)**
- Key discovery: `createSyncId` is a deterministic HMAC of (account, table, record_id) — identical on every device — so sync_id is record identity, NOT a per-save version id; the server stores at most one object per record and can't break ties. My first approach (sync_ids mapping table + sync_id tie-break, migration 038) was WRONG and fully reverted.
- Correct fix, client-only: on equal updated_at, compare the projected content (`JSON.stringify` of TABLES columns in order) — the larger content wins. Own pushes project identically → skipped → no re-pull churn. When the LOCAL content wins a tie, the record is re-enqueued so the server (which overwrites on tie) adopts the winner and the other device pulls it — full convergence. conflict.ts shouldApplyRemote gained content args; engine localState returns content projections; legacy V1 rows (content always known) fit the same rule.

**5 — entries deletion tombstone: NOT implemented** — no deleteEntry UI caller exists today (§22.1); implementing would be speculative code. Same tombstone pattern as challenges when the feature ships.

### Verification
- tsc clean (client + server). 183 suites / 1658 tests (+9: 3 conflict, 3 engine tie/dedupe-repush, 2 guard, 1 conflict tie suite — net). Server: typecheck + wrangler dev replay test (above).
- All committed + pushed (see git log).
