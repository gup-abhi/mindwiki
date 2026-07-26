# Backfill legacy wiki empty v1

## SPEC
Repair legacy wiki pages whose retained version 1 is an empty shell and whose current or later retained history contains real content. Canonical output removes only empty v1, shifts later snapshots down one version, decrements current `version`, preserves current content, `entry_count`, timestamps inside historical snapshots, and all non-legacy rows. Repair is idempotent. Existing legacy empty-v1 rows must remain supported by evolution/drift code.

Sync requirement: repaired local rows must get a newer `updated_at` and pending `wiki_pages` upsert so repair propagates. Incoming legacy rows from older devices must be canonicalized before local application and must not be re-enqueued as remote echo.

Emotion placeholder pages are excluded. No schema migration, content regeneration, or historical rewrite beyond removing empty v1 and renumbering retained snapshots.

## PSEUDO
```text
isLegacy(page):
  version >= 2
  history contains version 1 with content.trim() == ''
  current content or any retained version after v1 is non-empty

repair(page, now):
  if not legacy: return unchanged
  retained = history excluding empty v1
  shift each retained version -= 1
  current.version -= 1
  updated_at = max(now, old updated_at + 1)
  return page with repaired history/current metadata

startup:
  versioned setting flag
  transaction: find candidate pages; repair each; bump updated_at; enqueue upsert
  block DB readiness until scan succeeds
  set flag only after successful scan

pull:
  after decrypt, canonicalize wiki_pages row in memory
  apply only if remote updated_at wins
  enqueue repaired inbound row so canonical form propagates to older devices
```

## ARCH
- `src/services/wiki/legacy-backfill.ts`: pure detector/repair plus DB backfill orchestration.
- `src/services/storage/wiki.ts`: expose/find/update primitives only if needed; preserve Result style.
- `src/services/storage/bootstrap.ts`: invoke startup backfill after migrations and before DB readiness.
- `src/services/sync/engine.ts`: normalize inbound `wiki_pages` rows before apply.
- `src/services/sync/conflict.ts`: unchanged; normalization stays in sync engine to avoid broad conflict API changes.
- `__tests__/services/wiki/legacy-backfill.test.ts`, storage/bootstrap/sync tests: failing cases first.

Use existing settings and queue APIs. Avoid schema changes. Keep production diff limited to requested repair and tests.

## TDD
1. Detector excludes missing history, non-empty v1, and placeholder-only rows; legacy emotion rows with a truly empty v1 remain repairable.
2. Repair removes empty v1, renumbers history/current, preserves content/count/timestamps, and is idempotent.
3. Local backfill repairs and enqueues; retries if scan fails; flag prevents repeat.
4. Inbound normalization repairs legacy payloads without changing non-legacy payloads.
5. Existing legacy evolution/drift compatibility remains green.

## VERIFY
- `yarn jest __tests__/services/wiki/legacy-backfill.test.ts --runInBand`
- focused sync/bootstrap/storage tests
- `yarn test --runInBand`
- `yarn tsc --noEmit`
- `yarn lint`
- `git diff --check`
- inspect diff and confirm no schema/history rewrite outside target.
