# Dashboard + Entries Redesign — SPARC Plan

## 1. Goal and assumptions

### Goal
Separate daily dashboard from journal archive:

- **Home (`/`)** answers: “What matters today, and what changed?”
- **Entries (`/entries`)** answers: “Find anything I wrote.”
- Preserve existing four-tab navigation: Home / You / Reflect / Settings.
- Preserve privacy boundary: archive contains only `source = 'journal'`; Reflect and guided-path records continue feeding wiki/graph without appearing as journal entries.

### Assumptions

1. “Entries screen” means new all-entries archive, not redesign of composer (`/entry`) or individual detail (`/entries/[id]`).
2. Home keeps current synthesis, streak, challenge, digest, setup, and sync features, but stops owning search/filter/full history.
3. Home shows at most **3 recent journal entries** plus explicit **View all entries** action.
4. Archive MVP includes newest-first timeline, day grouping, full-corpus text search, emotion filter, pagination, loading/error/empty states, entry-detail navigation, and New Entry action.
5. Calendar, favorites/pinning, media gallery, editable dashboard panels, and new bottom tab are deferred.
6. Existing theme tokens and UI primitives remain authoritative; no dependency or analytics addition.

### Success criteria

- Home is scannable without scrolling through lifetime history.
- `/entries` can reach every journal entry, not only current `listEntries()` default limit of 50.
- Search and emotion filtering query encrypted local storage, not only loaded rows.
- Archive pagination has stable ordering and no duplicates/skips when timestamps tie.
- Opening an entry older than first 50 still supports Older/Newer detail navigation.
- Existing entry save, sync-refresh, wiki lineage, streak rescue, challenge, digest, model download, recovery, and privacy behavior remain intact.
- Focused tests, full Jest suite, TypeScript check, and lint/project checks pass.

---

## 2. Key findings

### Current dashboard and archive behavior

- `src/app/(tabs)/index.tsx` combines dashboard cards, search/filter controls, and complete visible timeline in one `SectionList`.
- `src/hooks/useEntries.ts:useEntries()` calls `listEntries()` with default limit and reports loaded-array length as `count`.
- `src/services/storage/entries.ts:listEntries()` defaults to **50**, filters to journal source, and lacks cursor/search/filter support. Current “entry count” and Home search therefore cover at most latest 50 entries.
- `src/components/journal/EntryCard.tsx` shows time, inferred emotion/topics, situation preview, and mood-colored bar.
- `src/components/journal/grouping.ts:groupEntriesByDay()` already provides reusable local-day sections and stable relative headings.
- `src/app/entries/[id].tsx` derives Older/Newer neighbors from `useEntries()`; entries beyond latest 50 receive no neighbors.
- `src/app/_layout.tsx` uses file-based Expo Router with a headerless root `Stack`; adding `src/app/entries/index.tsx` creates `/entries` without changing bottom tabs.
- `src/app/(tabs)/_layout.tsx` intentionally has four tabs. Project memory records prior five-to-four tab simplification; archive should not restore fifth tab.
- Existing coverage:
  - `__tests__/app/home.test.tsx`
  - `__tests__/app/entry-detail.test.tsx`
  - `__tests__/components/journal/grouping.test.ts`
  - `__tests__/hooks/useEntries.test.ts`
  - `__tests__/services/storage/entries.test.ts`

### Reusable design system

- `src/theme/colors.ts`, `typography.ts`, and `spacing.ts` already define light/dark palette, Lora journal typography, Nunito UI fonts, mood colors, spacing, and radii.
- `src/components/ui/Screen.tsx`, `Card.tsx`, `TextField.tsx`, `Chip.tsx`, `Button.tsx`, and `EmptyState.tsx` cover required primitives.
- `src/components/StreakCard.tsx` and `src/components/home/WhatChangedCard.tsx` should remain core Home hierarchy because streak continuity and compounding wiki synthesis differentiate MindWiki.

### Research-backed product direction

Comparable journaling products generally split “today/continuity” from “history/findability.” Recommended architecture:

- Dashboard: daily CTA, continuity/streak, recent synthesis, conditional progress cards, small recent-entry preview.
- Archive: chronological virtualized list, search, filters, day headers, compose action, progressive loading.

---

# 3. SPARC specification

## [SPEC] Exact behavior

### A. Home dashboard (`src/app/(tabs)/index.tsx`)

#### Layout order

1. Existing `SyncBanner` when applicable.
2. Dashboard heading: **Today** and a clear **New entry** action.
3. Existing `StreakCard`, still opening `/trends`.
4. Existing `WhatChangedCard` and `FirstPageReadyBanner` when applicable.
5. Conditional setup/status surfaces: model download and recovery setup.
6. Conditional engagement surfaces: weekly digest and active challenge.
7. Guided reflections card.
8. Pending synthesis status.
9. **Recent entries** section:
   - Header row: “Recent entries” + “View all” and true journal-entry count.
   - Latest 3 journal entries, newest first, using redesigned shared entry rows.
   - Tap row → `/entries/[id]`.
   - Tap View all → `/entries`.
   - No entries → compact dashboard empty state with New Entry action.
10. Keep New Entry reachable without scrolling; use visible header action and retain accessible floating action only if it does not duplicate/conflict during implementation review.

#### Removed from Home

- Inline text search.
- Emotion filter chips.
- Full day-grouped timeline.
- Search-result empty state.

Those behaviors move to `/entries` and their tests move with them.

### B. All Entries archive (`src/app/entries/index.tsx`)

#### Header and controls

- Back action returns to prior route.
- Title: **Entries**.
- True total journal-entry count displayed as secondary text.
- Always-visible search field with placeholder “Search your entries.”
- Horizontal filter row: **All** plus distinct non-empty inferred emotions available across journal history.
- Search and filter combine with AND semantics.
- Clear search restores active emotion-filter results; choosing All clears only emotion filter.

#### Timeline

- `SectionList`, newest first, grouped via `groupEntriesByDay()`.
- Sticky day headers.
- Shared `EntryCard`/entry-row component.
- Initial page size: 30 entries.
- `onEndReached` loads next page; footer spinner while loading.
- Stable cursor uses `(created_at, id)` descending.
- Pulling screen back into focus reloads first page so saves and sync pulls appear.
- New Entry action opens `/entry`.
- Entry tap opens `/entries/[id]`.

#### Search scope

Case-insensitive local search across journal-only fields already displayed or read in entry detail:

- `situation`
- `thought`
- `behavior`
- `closing_note`
- `named_emotion`
- `emotion`
- `distortion`
- `topic`
- `topic2`

Use parameterized SQL. Escape `%`, `_`, and escape character so user input is treated as text, not unintended wildcard syntax.

#### States

- Initial loading: centered ActivityIndicator, no false empty state.
- Storage error: neutral message + Try again.
- Empty archive: “No entries yet” + New Entry CTA.
- No search/filter match: “No entries match your search” + clear-filter action.
- Empty next page: silently mark `hasMore = false`.
- Repeated end-reached calls while loading: ignored.
- Query/filter changes: reset page/cursor; stale prior response cannot overwrite current results.

### C. Shared entry row (`src/components/journal/EntryCard.tsx`)

Redesign shared row for Home and archive:

- Keep mood color as quick visual cue.
- Show local time.
- Preview first useful content: trimmed `situation`, else trimmed `thought`, else “Mood check-in.”
- Keep preview capped at 2 lines; never expose full entry body in list.
- Metadata line uses de-duplicated values: mood label, named/inferred emotion, primary/secondary topic as available.
- Preserve “tagging…” status for written entries awaiting tags.
- Add explicit accessibility label containing date/time, mood label, and safe truncated preview.
- Maintain `React.memo()`.

### D. Entry detail compatibility (`src/app/entries/[id].tsx`)

- Replace first-50-array neighbor lookup with storage-backed adjacent journal-entry lookup.
- Ordering must match archive: `(created_at DESC, id DESC)`.
- “Older” and “Newer” work for every archived journal entry.
- Reflect/path records remain excluded from journal neighbor navigation.
- Existing lineage, wiki links, graph deep link, related entries, and prose rendering remain unchanged.

---

## [PSEUDO] Data and UI flow

### Storage page query

```text
function listJournalEntriesPage(options): Result<EntryPage>
  limit = clamp(options.limit, 1, 100)
  clauses = [source = 'journal']
  params = []

  if options.query.trim exists
    escaped = escapeLike(options.query.trim)
    clauses += one parenthesized OR across searchable text columns using LIKE
    params += repeated "%escaped%" values

  if options.emotion exists
    clauses += emotion = ? COLLATE NOCASE
    params += emotion

  if options.cursor exists
    clauses += (
      created_at < cursor.createdAt OR
      (created_at = cursor.createdAt AND id < cursor.id)
    )
    params += cursor values

  SELECT ...
  WHERE clauses joined with AND
  ORDER BY created_at DESC, id DESC
  LIMIT limit + 1

  hasMore = rows.length > limit
  items = first limit rows
  nextCursor = last item when hasMore, else null
  return { items, nextCursor, hasMore }
```

### Count and emotion options

```text
countJournalEntries()
  SELECT COUNT(*) FROM entries WHERE source = 'journal'

listJournalEmotions()
  SELECT DISTINCT emotion
  FROM entries
  WHERE source = 'journal' AND emotion IS NOT NULL AND TRIM(emotion) <> ''
  ORDER BY emotion COLLATE NOCASE
```

### Detail neighbors

```text
getJournalEntryNeighbors(entry)
  newer = first journal row ordered ASC where
    created_at > current OR (created_at = current AND id > current.id)
  older = first journal row ordered DESC where
    created_at < current OR (created_at = current AND id < current.id)
  return { older, newer }
```

### Archive hook

```text
useEntryArchive()
  state: items, query, debouncedQuery, emotion, loading, loadingMore,
         error, cursor, hasMore, total, emotions, requestGeneration

  on focus / sync revision:
    refresh first page + count + emotion options

  on query/emotion change:
    debounce query briefly
    increment generation
    clear cursor
    fetch first page
    apply response only if generation still current

  loadMore:
    return if loadingMore or !hasMore
    fetch using current cursor/query/emotion
    append by id without duplicates
```

### Home

```text
useEntries() -> recent corpus needed by existing dashboard calculations
useJournalEntryCount() -> true lifetime count
recent = entries.slice(0, 3)
render scrollable dashboard sections
render Recent entries + View all
```

---

## [ARCH] Boundaries and dependencies

### Storage layer

**Modify:** `src/services/storage/entries.ts`

Add:

- `EntryCursor`
- `JournalEntryPageOptions`
- `JournalEntryPage`
- `listJournalEntriesPage()`
- `countJournalEntries()`
- `listJournalEmotions()`
- `getJournalEntryNeighbors()`

Rules:

- Parameterized SQL only.
- Dynamic SQL limited to fixed internal clause fragments.
- Return `Promise<Result<...>>`; no throws across service boundary.
- Journal-only source constraint embedded in each archive query.
- Keep existing `listEntries()` unchanged for existing digest/trend/notification callers unless implementation evidence requires a narrow internal reuse.
- No schema migration initially: existing `idx_entries_created_at` supports chronological access; measure before adding index. Search remains local encrypted SQL and expected corpus size is modest.

### Hooks layer

**Modify:** `src/hooks/useEntries.ts`

Add focused hooks without placing business logic in screens:

- `useJournalEntryCount()` for Home.
- `useEntryArchive()` for archive pagination/search/filter/focus refresh.
- `useEntryNeighbors(entry)` for full-history detail navigation.

Keep existing `useEntries()` contract for Trends, You, digest-related calculations, and related-entry behavior.

### Components

**Modify:** `src/components/journal/EntryCard.tsx`

- Shared Home/archive visual row.
- No service calls.
- Memoized and theme-driven.

**Reuse unchanged unless tests expose need:**

- `src/components/journal/grouping.ts`
- `src/components/StreakCard.tsx`
- `src/components/home/WhatChangedCard.tsx`
- existing UI primitives.

### Routes

**Modify:** `src/app/(tabs)/index.tsx`

- Dashboard-only composition.
- Recent 3 entries + View all.
- No archive query/filter logic.

**Add:** `src/app/entries/index.tsx`

- Dedicated archive route.
- Screen delegates data behavior to hook.

**Modify narrowly:** `src/app/entries/[id].tsx`

- Storage-backed neighbors only; retain existing detail content and links.

### Dependency direction

```text
Screens -> hooks -> storage services -> encrypted SQLite
Screens -> presentational components -> theme/UI primitives
Components must not call storage/services directly
```

No server, sync protocol, database record shape, LLM, or network changes.

---

## [TDD] Failing tests first

### 1. Storage tests

Extend `__tests__/services/storage/entries.test.ts` before implementation:

- Page returns journal entries only.
- Stable newest-first ordering includes `id` tie-break.
- `limit + 1` determines `hasMore` and cursor.
- Next cursor page has no duplicates/skips.
- Search matches each searchable field case-insensitively.
- Search escapes `%`, `_`, and escape character.
- Emotion filter is case-insensitive.
- Search + emotion combine with AND semantics.
- Count includes all journal entries and excludes Reflect/path.
- Distinct emotions exclude null/blank and de-duplicate case-insensitively.
- Neighbor query returns correct older/newer rows, including tied timestamps and history beyond 50.
- Query failure returns correct `Result` error code without entry text logging.

Update fake DB only for SQL issued by new storage APIs; avoid converting it into a generic SQL engine.

### 2. Hook tests

Extend `__tests__/hooks/useEntries.test.ts` or add `__tests__/hooks/useEntryArchive.test.ts`:

- Initial page/count/emotions load.
- Pagination appends and de-duplicates.
- `loadMore` ignored while loading or when exhausted.
- Query/filter reset pagination.
- Stale request result is discarded after query changes.
- Sync revision/focus refresh replaces first page.
- Error state exposes retry.
- Neighbor hook reloads when entry changes.

Use fake timers only around search debounce; restore timers after each test.

### 3. Home dashboard tests

Refactor `__tests__/app/home.test.tsx`:

- Renders dashboard heading and New Entry action.
- Shows at most latest 3 entries.
- View all displays true count and routes to `/entries`.
- Recent entry opens detail.
- Empty recent section opens composer.
- Existing synthesizing, digest, challenge/check-in, lineage, and composer behaviors remain covered.
- Remove Home emotion/search expectations; re-home them in archive tests.

### 4. Entries archive screen tests

Add `__tests__/app/entries.test.tsx`:

- Renders loading, empty, error/retry, no-results, and populated states.
- Groups entries under day headings.
- Search input updates hook query.
- Emotion chip updates filter; All clears it.
- End reached calls `loadMore` once.
- Row routes to `/entries/[id]`.
- Back and New Entry actions route correctly.
- Footer spinner appears only while loading more.
- Accessibility labels exist for search, filters, entry rows, retry, and compose.

### 5. Entry detail regression tests

Extend `__tests__/app/entry-detail.test.tsx`:

- Detail uses storage-backed neighbors rather than latest-50 list.
- Older/Newer remain correct for same-timestamp ids.
- Existing wiki, graph, tags, not-found, and prose tests stay green.

### 6. Component/grouping tests

- Keep `__tests__/components/journal/grouping.test.ts` unchanged unless shared date formatting is extracted.
- Add `__tests__/components/journal/EntryCard.test.tsx` for preview fallback, metadata de-duplication, mood-only state, tagging state, two-line cap contract, press behavior, and accessibility label.

---

## [IMPL] Proposed implementation sequence

1. **Define archive storage contract**
   - Add types and failing storage tests.
   - Implement page/count/emotion/neighbor queries.
   - Verify: storage entries suite passes.

2. **Build archive state hook**
   - Add failing hook tests.
   - Implement first-page load, debounce, generation guard, pagination, refresh, and retry.
   - Add count and neighbor hooks.
   - Verify: hook suites pass without timer/open-handle leaks.

3. **Redesign shared entry row**
   - Add component tests.
   - Implement compact metadata, preview fallback, tagging state, mood cue, and accessibility label using theme tokens.
   - Verify: component tests and existing Home tests compile.

4. **Create `/entries` archive**
   - Add screen tests first.
   - Implement header, search, emotion chips, day-grouped `SectionList`, pagination footer, states, and compose FAB/action.
   - Verify: archive tests pass; manually inspect light/dark layouts and keyboard behavior.

5. **Refactor Home into dashboard**
   - Rewrite Home tests for dashboard contract.
   - Convert from header-heavy lifetime `SectionList` to dashboard scroll layout.
   - Preserve existing cards and effects; remove only archive-specific query/filter state.
   - Add Recent entries section, true count, and View all route.
   - Verify: Home, streak rescue, challenge, lineage, digest, model, and recovery tests pass.

6. **Repair detail navigation for full archive**
   - Add failing old-history/tied-timestamp tests.
   - Replace neighbor derivation with `useEntryNeighbors(entry)`.
   - Verify: entry-detail suite passes and related-entry behavior remains unchanged.

7. **Refine and integrate**
   - Remove imports/state made unused by refactor.
   - Confirm no new migration/dependency required.
   - Run focused suites, then full checks.

---

## [REFINE] Performance, accessibility, privacy, and UX

### Performance

- Keep `SectionList`; do not place full archive in `ScrollView`.
- Page by keyset cursor, not SQL offset.
- Fetch `limit + 1`, not total corpus, for `hasMore`.
- De-duplicate appended ids defensively.
- Memoize sections and entry rows.
- Debounce storage search around 250 ms and suppress stale responses.
- Do not render all emotion chips from loaded pages; fetch distinct corpus options once per refresh.
- Measure first. Add composite/search indexes only if profiling shows need; avoid speculative migration.

### Accessibility

- 44×44 minimum touch targets for Back, View all, filter chips, New Entry, and retry actions.
- Selected chips expose `accessibilityState={{ selected: true }}`.
- Entry rows expose meaningful labels instead of requiring mood-color interpretation.
- Mood color remains supplemental; mood label stays textual.
- Dynamic loading/no-results text remains screen-reader visible.
- Search return key and clear action have explicit labels.

### Privacy and safety

- All search remains on-device in SQLCipher.
- No entry text logging, analytics, remote search, or LLM call.
- Preview remains two lines; no thought/behavior/closing-note expansion in timeline.
- Reflect/path content remains absent from journal archive.
- Search params remain parameterized; dynamic column names are fixed literals only.

### Error handling

- Service APIs return `Result`; hooks convert errors to count-free UI state.
- Retry reruns current query/filter from first page.
- Failed load-more keeps existing rows visible and offers retry in footer rather than replacing screen.
- Failed total/emotion metadata load must not hide successfully loaded entries.

---

## 4. Verification plan

### Automated

Run serially per project memory guidance:

```bash
yarn test __tests__/services/storage/entries.test.ts --runInBand
yarn test __tests__/hooks/useEntries.test.ts __tests__/hooks/useEntryArchive.test.ts --runInBand
yarn test __tests__/components/journal/EntryCard.test.tsx --runInBand
yarn test __tests__/app/home.test.tsx __tests__/app/entries.test.tsx __tests__/app/entry-detail.test.tsx --runInBand
yarn test --runInBand
yarn tsc --noEmit
```

Run configured lint command if present in `package.json`.

### Manual/device checks

1. Fresh account: Home empty state and New Entry action.
2. Existing account with >50 journal entries: true count, archive reaches oldest row.
3. Multiple entries sharing millisecond timestamp fixture: pagination and neighbors remain stable.
4. Search matches situation/thought/tag text outside first page.
5. Search characters `%`, `_`, and `\\` behave literally.
6. Emotion filter + search combine correctly.
7. Save entry, return to Home/archive: new row appears first.
8. Sync pull while archive focused/refocused: list refreshes without duplicate rows.
9. Open old entry: Older/Newer work; back restores archive query/filter/scroll where router permits.
10. Mood-only and untagged entries have understandable rows.
11. Light/dark mode, small Android phone, large iPhone, font scaling, keyboard open, VoiceOver/TalkBack.
12. FAB/controls clear bottom tab and safe areas.
13. No raw entry text appears in logs or network inspection.

---

## 5. Risks, non-blocking questions, rejected alternatives

### Risks

- **Current consumers use only latest 50:** Trends and some related-entry computations still use existing `useEntries()`. This plan fixes archive completeness and Home count only; changing analytics corpus is separate scope.
- **LIKE search cost:** Full-field substring search scans local encrypted rows. Expected journal corpus makes this acceptable for MVP; profile before considering FTS migration.
- **Timestamp ties:** Existing ordering uses only `created_at`; archive adds `id` tie-break. Neighbor and page queries must use same ordering everywhere.
- **Focus + query races:** Sync refresh and debounced search may overlap. Request-generation guard required.
- **Home card density:** Preserving every current conditional card may still create long dashboards. Implementation should use section spacing and compact recent rows, not introduce customizable panels.

### Non-blocking questions for visual review

- Final copy: “Today” vs “Home,” and “View all” vs “All entries.” Default in this plan: “Today” and “View all.”
- Keep circular FAB on Home after adding visible New Entry action. Default: retain only if usability review shows no redundant hierarchy; archive always keeps compose action.

### Rejected alternatives

- **Fifth Entries tab:** conflicts with deliberate four-tab restructure and overweights archive versus MindWiki’s synthesis product.
- **Keep lifetime timeline on Home:** preserves clutter and leaves dashboard/history goals mixed.
- **Configurable dashboard panels:** high complexity, no current user requirement, and settings persistence would be speculative.
- **Calendar/grid view in MVP:** useful later, but search/filter timeline solves requested all-entry browsing with smaller scope.
- **Favorites/pinning/media gallery:** require new data model and product decisions unrelated to requested redesign.
- **Load every entry into memory:** simple but degrades over time and makes “all entries” depend on device capacity.
- **FTS migration immediately:** unnecessary until measured; adds migration/tokenization complexity for modest local corpus.

---

## Execution record — 2026-07-28

- Recovered exact approved plan payload after plan file was absent from checkout; no scope change.
- Implemented storage archive APIs, archive/count/neighbors hooks, shared entry-row redesign, `/entries` archive route, Home dashboard split, and storage-backed detail navigation.
- Added focused storage, hook, component, archive-screen, Home, and detail regression coverage.
- Verification: 173 Jest suites / 1,583 tests passed; TypeScript passed; ESLint passed with pre-existing warnings plus hook dependency warnings in changed hook.