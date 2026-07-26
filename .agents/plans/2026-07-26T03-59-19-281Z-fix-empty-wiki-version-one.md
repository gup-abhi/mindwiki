# SPARC Plan: Make Wiki Version 1 First Real Synthesis

## Goal and assumptions

Fix forward creation of non-emotion wiki pages so version 1 contains first synthesized content instead of empty shell.

Success invariants:

- New synthesized page: `version = 1`, `content = synth.data`, `entry_count = 1`, `version_history = []`.
- Existing page: unchanged `updatePage()` behavior; prior version archived, version/count incremented.
- Failed synthesis: no page created.
- Emotion page: unchanged placeholder flow; `createPage()` defaults to count 0, then `ticklePageCount()` records first contribution.
- Existing/synced legacy pages with empty v1 remain readable. No migration, history rewrite, or version renumbering.
- No raw journal text leaves device; no network/privacy boundary changes.

## Key findings

- `src/services/wiki/engine.ts:updateWikiForEntry()` around lines 334–344 creates new non-emotion page without content, then calls `updatePage()` with synthesis.
- `src/services/storage/wiki.ts:createPage()` around lines 100–128 defaults omitted content to `''`, count to `0`, and version to `1`.
- `src/services/storage/wiki.ts:updatePage()` around lines 347–393 archives current page before writing next content. Empty shell therefore becomes v1; first synthesis becomes v2.
- `src/services/wiki/engine.ts:tickleEmotionPage()` around lines 445–465 intentionally creates contentful placeholder at count 0, then increments count. New API must preserve this path.
- `__tests__/services/wiki/engine.test.ts:updateWikiForEntry` currently asserts create-then-update behavior and already covers existing-page updates plus synthesis failure.
- `__tests__/services/storage/wiki.test.ts:storage/wiki CRUD` covers creation defaults and history persistence.
- `__tests__/services/wiki/drift.test.ts` and `__tests__/services/wiki/evolution.test.ts` intentionally support empty-v1 chains. These remain compatibility tests, but comments should identify them as legacy data rather than current engine behavior.

## SPARC

### 1. [SPEC]

#### Input contract

Extend `NewWikiPage` in `src/services/storage/wiki.ts`:

```ts
export interface NewWikiPage {
  title: string
  category?: string | null
  content?: string
  entry_count?: number
}
```

`entry_count` follows existing storage DTO/database naming (`closing_note`, `target_days`, `entry_count`) and defaults to `0`.

#### Required behavior

1. `createPage(input)` persists and returns `input.entry_count ?? 0`.
2. New non-emotion page created from successful synthesis receives synthesis content and `entry_count: 1` in initial INSERT.
3. New-page branch does not call `updatePage()`.
4. Existing-page branch still calls `updatePage(page.id, synth.data)`.
5. Create failure does not add topic to returned updated-title list.
6. Synthesis failure still creates nothing.
7. Emotion placeholder creation omits `entry_count`; existing default-plus-tickle semantics remain intact.

#### Edge cases

- Empty synthesis should remain governed by deep-model validation; persistence layer should not infer count from content.
- Explicit `entry_count: 0` must remain 0.
- Legacy empty v1 history remains accepted by drift/evolution normalization.
- No historical repair in this change.

### 2. [PSEUDO]

```text
createPage(input):
  count = input.entry_count ?? 0
  page = {
    title: input.title,
    category: input.category ?? null,
    content: input.content ?? '',
    entry_count: count,
    version: 1,
    version_history: []
  }
  INSERT page using count
  enqueue sync upsert
  return page

updateWikiForEntry(entry):
  for each non-emotion topic:
    resolve existing/survivor page
    synthesize using existing content or empty base
    if synthesis failed:
      continue

    if page does not exist:
      created = createPage({
        title: topic.title,
        category: topic.category,
        content: synthesis,
        entry_count: 1
      })
      if created succeeded:
        append topic title to updated list
      else:
        dev-log error code only
      continue

    applied = updatePage(page.id, synthesis)
    if applied succeeded:
      append topic title
    else:
      dev-log error code only

  return updated list
```

### 3. [ARCH]

Module boundaries stay unchanged:

- `src/services/wiki/engine.ts` decides semantic meaning: first successful synthesis represents one entry contribution.
- `src/services/storage/wiki.ts` persists explicit initial state; it does not infer meaning from non-empty content.
- `updatePage()` remains update-only and keeps version-history semantics.
- Emotion aggregation remains separate through `tickleEmotionPage()`.
- Sync receives same `wiki_pages` row shape; no schema or protocol change because `entry_count` already exists.

Rejected alternatives:

- Start at v0 then update: preserves two writes and phantom version.
- Skip archiving blank content in `updatePage()`: masks history symptom while first synthesis still becomes v2.
- Infer count from content: breaks emotion placeholders and other authored seed content.
- Add specialized creation abstraction: unnecessary for one branch; optional explicit field is smaller.
- Rewrite existing histories: risky under sync and capped history; outside forward bug fix.

### 4. [TDD]

Write/adjust failing tests before implementation.

#### Storage tests — `__tests__/services/storage/wiki.test.ts`

1. Add test: `createPage({ content: 'first synthesis', entry_count: 1 })` returns and rereads:
   - version 1
   - exact content
   - entry count 1
   - empty history
2. Keep existing default-creation test proving omitted count remains 0.
3. Keep `updatePage()` test proving real second revision archives contentful v1 and becomes v2/count 2 when fixture starts with `entry_count: 1`; update expected count accordingly if test is changed to represent synthesized lifecycle.

#### Engine tests — `__tests__/services/wiki/engine.test.ts`

1. Replace create-then-update test with direct contentful-v1 assertion:
   - `createPage()` called with title, category, `content: 'synthesized content'`, `entry_count: 1`
   - `updatePage()` not called
   - topic returned as updated
2. Keep existing-page test asserting `createPage()` not called and `updatePage()` called.
3. Keep synthesis-failure test asserting neither create nor update for missing page.
4. Add/adjust create-failure assertion: topic not reported; update not called.
5. Update exact `createPage()` expectations for recurring entity and belief new-page paths to include content/count.
6. Preserve emotion creation expectation: placeholder content supplied, no explicit initial count, then tickle called.

#### Legacy compatibility tests

- Keep empty-v1 cases in `__tests__/services/wiki/drift.test.ts` and `__tests__/services/wiki/evolution.test.ts`.
- Change comments/test wording only where needed from “engine pages start empty” to “legacy engine pages may start empty.”

### 5. [IMPL]

1. Update `NewWikiPage` and `createPage()` in `src/services/storage/wiki.ts`:
   - add optional `entry_count`
   - calculate one local count using nullish default
   - use same count in returned object and INSERT params
2. Update new non-emotion branch in `src/services/wiki/engine.ts`:
   - pass synthesis and count directly to `createPage()`
   - mark title updated on successful create
   - `continue` after handling new-page branch
   - retain current existing-page `updatePage()` path and error-code-only dev logging
3. Update only affected comments/tests. No schema, sync, UI, drift algorithm, or migration changes.

### 6. [REFINE]

- Confirm no duplicate persistence call on new-page path.
- Confirm create failure remains best-effort and never blocks entry save.
- Confirm no user content appears in logs; only existing error codes remain.
- Confirm emotion placeholder/count semantics through focused test.
- Keep API optional for backward compatibility with all current callers.

## Verification plan

Run focused checks first:

```bash
yarn test __tests__/services/storage/wiki.test.ts --runInBand
yarn test __tests__/services/wiki/engine.test.ts --runInBand
yarn test __tests__/services/wiki/drift.test.ts __tests__/services/wiki/evolution.test.ts --runInBand
```

Then project checks:

```bash
yarn tsc --noEmit
yarn test --runInBand
yarn lint
```

Acceptance evidence:

- New engine test shows one create write, no update write.
- Storage reread shows contentful v1/count 1/history empty.
- Existing update test still shows proper v2 archive behavior.
- Emotion and legacy-history tests pass.
- Full TypeScript/tests pass; lint has no new errors.

## Risks and non-blocking questions

- Legacy pages retain empty v1. Deliberate compatibility choice; future repair would require separate sync-aware migration design.
- Creation and sync-queue enqueue remain current best-effort behavior; transactionality is unrelated and unchanged.
- Concurrent same-title creation is pre-existing behavior and outside this fix.
- No blocking questions.
