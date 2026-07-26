# Evolution screen: horizontal version-chip selector

## Goal
Remove the scrolling back-and-forth pain on the wiki page evolution screen
(`src/app/wiki/[id]/evolution.tsx`) by replacing the tall vertical
`VersionTimeline` with a horizontal scrollable row of version chips pinned near
the top. Selecting a chip swaps the content inline — no long timeline above
content to scroll up to.

## Assumptions
- The "show versions then the text" complaint refers to the **evolution**
  screen, not the main page screen (`[id].tsx` only shows a single "See
  evolution →" link — that one is fine).
- Keep existing functions/semantics: single vs compare mode, play/pause
  auto-advance, gap/sample-out indicators, integrity notes, retention metrics.
- Chip count ≤ ~21 (cap is `MAX_VERSION_HISTORY=20` + current). Horizontal
  scroll handles this naturally; no virtualization needed.
- No new npm deps. Reuse `Chip` primitive where it fits, or build a thin
  version-specific chip so gap markers carry through.
- No schema / service changes — pure UI.

## Key findings (durable paths)
- Screen: `src/app/wiki/[id]/evolution.tsx` (entry: `PageEvolutionScreen`)
- Current timeline component: `src/components/wiki/VersionTimeline.tsx`
  - exports `formatRelative(ts, now)` — **keep exporting this**; test
    `__tests__/components/wiki/VersionTimeline.test.tsx` only checks that fn.
- Diff / viewer: `src/components/wiki/VersionDiff.tsx`,
  `src/components/wiki/VersionViewer.tsx` (unchanged)
- Evolution data: `src/services/wiki/evolution.ts` — `EvolutionVersion`,
  `pageEvolution`, gaps/issues already available. (unchanged)
- Existing chip primitive: `src/components/ui/Chip.tsx` (pill, `selected`
  style, haptics on press). Reuse styling pattern but make a dedicated
  `VersionChip` so we can show date + gap marker inline.
- Screen wrapper `Screen scroll` uses `ScrollView`; to pin the chip row while
  content scrolls, either (a) move chip row out of the `Screen`'s scroll into
  a fixed header above the `ScrollView`, or (b) keep inside but accept it
  scrolls away. Chosen: put header + chip row + action bar in a **sticky
  header** that stays visible (covers the whole point — switch version without
  scrolling up). Implementation: split `Screen scroll` into
  `<SafeAreaView>` outer containing a fixed `<View>` header + `<ScrollView>`
  body. Simpler: stop passing `scroll` to `Screen`, wrap body in its own
  `ScrollView`. Re-check against `Screen.tsx` (it renders `SafeAreaView` + opt
  `ScrollView` + `FadeIn`). Concretely: render `<Screen>` (no scroll) as the
  SafeAreaView/footer, then inside: fixed header `View`, inline
  `ScrollView` for body. Keeps theme + StatusBar behavior intact.

## Proposed implementation

### 1. New component `src/components/wiki/VersionChipRow.tsx`
Props (mirrors what `VersionTimeline` consumed):
```ts
interface VersionChipRowProps {
  versions: { version: number; updated_at: number }[]  // oldest-first, includes current
  gaps: TimelineGap[]
  selectedVersion: number | null
  compareVersion: number | null
  onSelect: (version: number) => void
  isPlaying?: boolean        // dim/freeze when playing
}
```
- Horizontal `ScrollView` (`showsHorizontalScrollIndicator=false`), RTL ok
  via default row; gap `t.spacing.xs` between chips; `paddingHorizontal`
  screen-wide.
- Each chip = `Pressable`, pill style like `Chip` (`t.colors.surfaceAlt`,
  selected → `t.colors.accent`, compare → accent outline/border `success`).
  Reuse the existing two-layer highlight logic from `VersionTimeline`
  (`isSelected` filled, `isCompare` bordered accent) so compare mode stays
  legible.
- Chip shows `v{version}` bold + `formatRelative(updated_at)` small underneath.
- Gap indicator: between a chip and the next, when the next chip's version is
  the `toVersion` of a gap whose `fromVersion` == this chip's version, insert a
  small "⋮ {missing}" separator chip (non-interactive) before the next chip.
  Preserves the "sampled versions exist here" signal without the vertical line
  treatment. Falls back gracefully: if `gaps` empty, just dense chips.
- Auto-scroll to active: on `selectedVersion` change `scrollTo`
  via ref to keep chosen chip visible. Optional polish — can defer if it adds
  complexity; default landing on first version means it's already visible.
- TestID per chip: `version-chip-v{version}` (replaces `timeline-dot-v*` /
  `timeline-label-v*` which are RN-only screen tests = none exist).
- Gap chip testID: `version-gap-v{from}`.

### 2. Edit `src/app/wiki/[id]/evolution.tsx`
- Import `VersionChipRow` instead of `VersionTimeline`.
- Replace the `timelineSection` block with the chip row.
- Restructure layout so the chip row + action bar (Play / View-Compare) live in
  a fixed header that does NOT scroll with the content:
  - Stop using `Screen scroll`. Use bare `<Screen>` (SafeAreaView + StatusBar).
  - Inside, a top `View` containing: back link, title, meta, action bar, chip
    row. This is the "sticky" header.
  - Below it a single `<ScrollView>` (with the same `contentContainerStyle`
    padding `Screen` used: `paddingHorizontal: t.spacing.xl`, bottom pad
    `t.spacing['2xl']`) holding: integrity notice, content section
    (`VersionViewer` / `VersionDiff` / view/compare title / empty hint),
    keeping current `Divider` between header and content.
  - `keyboardShouldPersistTaps="handled"` to match prior `Screen` behavior
    (not needed here — no text inputs — but harmless).
- Keep compare-mode two-tap flow and hint text ("Tap two versions to compare")
  exactly as-is; chips support the same `onSelect` semantics.
- Keep playback: selected chip advances; chip row still tappable (tap while
  playing pauses — same as current `onSelect` guard). Playback interval
  unchanged (2500 ms).
- Keep the "v{N} current" context: chip for the current version gets a small
  "now"/"current" affordance (e.g. a dot or "current" caption) so the user
  knows the last chip is the live content even when scrolling chips.
- Retention metrics aren't surfaced on this screen today (only via
  `VersionRetention` export used elsewhere?) — confirm via
  `retentionAtVersions` callers before dropping any visual use. Grep found no
  UI consumer of `retentionAtVersions`; only the service test imports it. No
  visual loss expected.
- Delete unused `VersionTimeline` import. **Do not delete
  `VersionTimeline.tsx` itself** — `formatRelative` is still used/exported
  from it. Instead, move `formatRelative` into the new `VersionChipRow.tsx` file
  OR keep `VersionTimeline.tsx` as a pure-export helper (no JSX). Cleanest:
  extract `formatRelative` to a small `src/components/wiki/versionFormat.ts` so
  neither the old nor new component has to carry it; update the existing test
  import path. Verify by running the test after.

### 3. Styling (in `VersionChipRow.tsx`)
- `paddingVertical` of chip row ~ `t.spacing.sm`; row background slightly
  distinct (`t.colors.bg` / `surfaceAlt` thin top/bottom hairline) so it reads
  as a sticky bar.
- Compare mode: keep the success-green border treatment on the compare chip
  from `VersionTimeline` (`dotCompare` border `t.colors.success`).
- Ensure tap target ≥ 44pt: chip `paddingVertical` ≥ `t.spacing.sm` + label,
  reuses the same sizing `Chip.tsx` already does (`paddingVertical: sm`).

### 4. No service / type changes
- `EvolutionVersion`, `pageEvolution`, `TimelineGap`, `SampledGap`,
  `VersionIssue` all stay. No storage changes. No new dependencies.

## Verification plan
1. `yarn tsc --noEmit` — strict type check passes.
2. `yarn test` —
   - existing `__tests__/services/wiki/evolution.test.ts` still green (no
     service touched).
   - `__tests__/components/wiki/VersionTimeline.test.tsx` still green after
     `formatRelative` extraction (update its import path).
   - New minimal test for `VersionChipRow` — at least assert chips render per
     version and pressing `onSelect` forwards the right `version` number with
     correct highlighted state; mock `haptics` (already mocked pattern via
     `Chip.tsx`'s try/catch + the `haptics` import). Follow existing test
     infra expectations (check `jest.config`/mock root if unsure).
3. Manual smoke (device emulator):
   - Open a wiki page with ≥3 archived versions → "See evolution".
   - Confirm: back link + title + meta + action bar + horizontal chips sit in
     a header that stays put while vertical content scrolls.
   - Tap each chip → content swaps, active chip highlighted, no scroll jump.
   - Toggle Compare → two chips selectable; `VersionDiff` shows.
   - Tap Play → auto-advances chips, current chip follows; tap a chip → pause.
   - Page with a sampled gap (construct via known data / dev seed) → shows
     "⋮ {missing}" gap chip between the two surrounding chips.
4. No-regression: confirm `format` label wording unchanged ("today",
   "yesterday", "Nd ago") so any docs/demos still match.

## Risks / non-blocking open questions
- **Sticky-header layout** change touches the `Screen` wrapper usage; need care
  that `SafeAreaView` edges + `FadeIn` still apply once `scroll` is off (it
  does — `Screen`'s non-scroll branch just lacks the `ScrollView`, FadeIn
  still wraps). Will double check `Screen.tsx` non-scroll branch renders the
  `padded` style wrapper as a container that flexes; if header needs to not
  scroll, body `ScrollView` must `flex:1` inside that wrapper. Low risk.
- Older-rows semantics: with chips at ≤21 capped, horizontal scroll is short;
  that is acceptable and desirable (removes the long vertical list).
- Compare-mode discoverability: with the timeline gone, the "v1 v2 … vN" chip
  row makes picking two still obvious (same tap pattern). The compare hint text
  stays as reassurance. No blocking concern.
- Rejected alternative: a native RN `Picker`/modal dropdown. Rejected — modal
  drops the at-a-glance timeline-scanning value and hides gap markers; horizontal
  chips keep everything one tap away and visible.
- Rejected: horizontal segmented control without scroll (fixed width ≥ fails
  for 21 versions). Horizontal scroll row is the right primitive.
