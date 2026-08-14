---
name: verify
description: Run MindWiki's focused or full local quality gates without overlapping Jest. Use after implementation, before a commit, or when asked to test changes.
argument-hint: "[focused|full|ci] [optional test paths]"
---

# Verify MindWiki

Run checks sequentially. Never launch multiple Jest processes.

## Focused (default)

1. Inspect `git diff --name-only` and map changed production files to existing tests under `__tests__/`.
2. Run one combined test command through the mutex:
   ```bash
   bash .claude/scripts/run-jest.sh <all-related-test-paths>
   ```
3. Run `yarn tsc` when TypeScript changed.
4. Run `cd server && npm run typecheck` when `server/` changed.
5. Run `yarn lint` only for broad UI changes or when explicitly requested; it scans the whole app.
6. Report exact commands, pass/fail counts, and anything skipped.

## Full

Run in this order and stop on the first failure:

```bash
yarn tsc
(cd server && npm run typecheck)
yarn lint
bash .claude/scripts/run-jest.sh
git diff --check
```

If `demo/` changed, also run `(cd demo && npm run tsc)`.

## CI

Mirror `.github/workflows/ci.yml`, except keep Jest serialized locally:

```bash
yarn tsc
(cd server && npm run typecheck)
yarn lint
bash .claude/scripts/run-jest.sh --ci
git diff --check
```

Do not install dependencies unless the user asks. Native behavior still needs the relevant physical-device gate; Jest mocks native modules.
