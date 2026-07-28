# Home Dashboard and Journal Archive

## Status

Implemented in commit `2c8c2e4` on branch `feat/dashboard-entries-redesign`.

The redesign separates Home dashboard concerns from the full journal archive. The
feature branch is pushed to GitHub; merge into protected `main` must happen through
the repository's pull-request flow.

## Home (`/`)

Home is a dashboard, not the full journal timeline. It keeps:

- Sync, streak, challenge, digest, model-download, recovery, and synthesis status.
- `WhatChangedCard`, showing which wiki pages the latest tagged entry reshaped.
- Up to three recent journal entries.
- True journal-entry count from encrypted local storage.
- `View all` navigation to `/entries`.

Reflect and guided-path records do not appear in the journal archive. They continue
to feed wiki/graph or reframe storage according to their existing flows.

### Plus actions

The Home plus control expands inline above the plus button. It does not open a
modal, popup, backdrop, or bottom sheet. It toggles three independent primary-color
buttons, centered horizontally on screen:

1. Guided reflection → `/paths`
2. Untangle a thought → `/untangle`
3. New entry → `/entry`

Each action collapses the group before navigation. The plus button exposes expanded
state and each action has an accessibility label.

## Journal archive (`/entries`)

The archive is a separate stack route and remains outside the four bottom tabs. It
contains journal entries only (`source = 'journal'`) and supports:

- Newest-first day-grouped timeline.
- Stable keyset pagination ordered by `created_at DESC, id DESC`.
- Local encrypted-storage search with debounced query handling.
- Emotion filtering and true total count.
- Loading, retry, empty, no-result, and pagination states.
- Entry navigation to `/entries/[id]`.

Archive search preserves former Home behavior:

- Text search covers `situation`, `thought`, `behavior`, and `closing_note`.
- Text matching is trimmed, case-insensitive substring matching.
- Emotion matching is exact; no `COLLATE NOCASE` behavior is added.
- SQL parameters are escaped for `%`, `_`, and backslash before `LIKE` use.

Search and filter requests are guarded against stale responses. Pagination appends
without duplicate IDs. Focus and sync refresh the first page.

## Entry detail

`/entries/[id]` uses storage-backed journal neighbors rather than the default
50-entry in-memory list. Older/Newer navigation therefore works for entries across
the complete archive and remains stable when timestamps tie.

## Verification

The redesign has focused and full coverage:

- 173 Jest suites / 1,583 tests passed.
- TypeScript passed.
- ESLint passed with existing warnings and hook dependency warnings.
- `git diff --check` passed.

Relevant implementation files:

- `src/app/(tabs)/index.tsx`
- `src/app/entries/index.tsx`
- `src/app/entries/[id].tsx`
- `src/hooks/useEntries.ts`
- `src/services/storage/entries.ts`
- `src/components/journal/EntryCard.tsx`