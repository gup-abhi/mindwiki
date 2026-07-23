# Page Evolution UI — Spec (#7)

> **Marketing-grade compounding visibility, zero new data needed.**
> Version history already stores what the wiki believed in March vs. now. This surfaces it.

---

## 1. Goal

Give every wiki page a browsable, shareable evolution view — "how this page grew over time" — that turns the existing `version_history` into a tangible artifact of compounding understanding. The view that sells the app against Rosebud/Ash: *the AI didn't just record — it changed its mind as it got to know you.*

**Verifiable success criteria:**
- A wiki page with ≥2 versions renders an evolution timeline with selectable snapshots
- Word-level diff is visible between any two versions (added/removed content highlighted)
- The view is accessible from the wiki page detail and is shareable as a screenshot
- Zero new database columns or sync schema changes

---

## 2. Data already available

Every `WikiPage` has:

| Field | Type | Purpose |
|-------|------|---------|
| `content` | `string` | Current page content |
| `version` | `number` | Current version number (starts at 1, bumped every write) |
| `version_history` | `WikiPageVersion[]` | Archived previous versions (capped at 20) |
| `entry_count` | `number` | Total entries that shaped this page |
| `created_at` | `number` | When the page was first created |
| `updated_at` | `number` | When the page was last written |

Each entry in `version_history`:

```typescript
interface WikiPageVersion {
  version: number   // the version number AT THE TIME of archiving
  content: string   // the full page content at that point
  updated_at: number // when that version was written
}
```

**Three write paths all populate `version_history`** (same push-old-content → cap → bump pattern):
- `updatePage()` — new entry synthesis (most common; increments `entry_count`)
- `correctPage()` — user correction (sets `corrected_at`)
- `regeneratePageContent()` — AI voice rewrite

**Already computed and available for reuse:**
- `retention(prev, next)` in `drift.ts` — fraction of content words surviving between versions (used by origin-retention metric)
- `capVersionHistory()` — monthly-bucketed cap at 20

---

## 3. User stories

### 3.1 Browse a page's timeline

> As a journaler, I want to see "how the AI's understanding of [emotion/theme] has changed over my entries" — so I can feel the compounding effect.

- From the wiki page detail, tap "See evolution" (replaces the current flat one-line-per-version list)
- A vertical timeline opens: dots connected by a line, each dot = one version, newest at top
- Tapping any version dot opens that version's full content below the timeline
- Badge at the top: "N versions · first seen [date]"

### 3.2 Compare any two versions

> As a journaler, I want to see what actually changed between two versions — not just read both.

- Select two versions on the timeline (tap to select one, then tap another with "Compare" mode)
- A word-level diff renders below: **green** for content added in the newer version, **red** for content removed, **default** for unchanged
- Quick-action button: "Compare current vs first" — the most demoable before/after

### 3.3 Play the evolution

> As a prospective user seeing a demo, I want to watch the page grow — one version at a time — without tapping each dot.

- Play/pause button at the top of the timeline
- Steps through all versions from oldest → newest, pausing ~2s per version
- Current version content animates/slides as it updates
- The version dot highlight tracks the playing position

### 3.4 Share the evolution

> As a user who loves seeing their growth, I want to share "how my understanding of [X] evolved" — the screenshot that proves an AI knows you better over time.

- "Share" button captures the timeline + current version as a composable screenshot
- Renders: page title, "N versions over M entries", the timeline rail, and the selected version content
- Pure client-side (no server upload); native share sheet via `expo-sharing`

---

## 4. Routes and navigation

### New route

```
/wiki/[id]/evolution
```

A push-from-right screen (not a modal) so the back gesture returns to the page detail. Accessible only when `page.version > 1 AND version_history.length > 0`.

### Entry points

| Location | What | When |
|----------|------|------|
| Wiki page detail | Replace flat "Previous versions" list with tappable "See evolution →" | Always, when `version >= 2` |
| Entry detail lineage | "This entry shaped [page] — see how its understanding evolved" link | When the linked page has ≥2 versions |
| Trends "What's changing" card | Long-press on a trend row → "See evolution" context action | When the page has ≥2 versions |

---

## 5. Component tree

```
PageEvolutionScreen
├── EvolutionHeader
│   ├── title + category badge
│   ├── summary line: "N versions · shaped by M entries · first [date]"
│   └── action row: [Play/Pause] [Compare mode] [Share]
├── VersionTimeline          ← vertical rail, scrollable
│   └── TimelineDot[]        ← one per version, dots connected by line
│       ├── date label (relative: "3 weeks ago" or absolute)
│       ├── version number
│       └── (when selected) highlight ring
│           └── (when comparing) second selected dot with compare highlight
├── DiffSelector             ← shown in compare mode
│   ├── "Version A" picker (default: oldest)
│   └── "Version B" picker (default: newest)
└── VersionContent
    ├── VersionViewer         ← single version full content
    └── VersionDiff           ← word-level diff between two versions
        ├── <TextAdd/>       ← green text for added words
        ├── <TextRemove/>    ← red/strikethrough for removed words
        └── <TextSame/>      ← default for unchanged words
```

### Component specs

#### `PageEvolutionScreen`
- Route: `/wiki/[id]/evolution`
- Loads `WikiPage` via `getPage(id)`
- Computes timeline via `pageEvolution()` service
- Manages state: `selectedVersion`, `compareVersion`, `isCompareMode`, `isPlaying`

#### `VersionTimeline`
- Vertical `FlatList` or `ScrollView` with versions newest-first (reverse of the DB order)
- Each row: timeline rail dot + date + version tag
- Tapping a dot: selects it (shows that version's content below)
- Tapping while in compare mode: sets second selection
- Height: fixed to ~3-4 visible dots, scrollable for more
- The selected dot gets a larger ring; the compare dot gets a secondary ring

#### `VersionViewer`
- Renders the full content of a single past version using the existing `Markdown` component
- Header: "Version N · [date] · [entry count at that point]"
- No edit/dismiss actions — this is read-only history

#### `VersionDiff`
- Takes `(contentA: string, contentB: string)`
- Runs word-level diff (see §6.2)
- Renders text as a stream of fragments: green (added), red + strikethrough (removed), default (unchanged)
- If triggered with only one version selected, diffs against the current page content

#### `EvolutionPlayback`
- Creates a timer that cycles through versions (oldest → newest)
- 2s per version, with a brief slide-up transition on the content
- Tapping any timeline dot stops playback
- Loops back to the beginning after reaching the current version

---

## 6. New service logic

### 6.1 `pageEvolution()` — assemble the evolution timeline

```typescript
// src/services/wiki/evolution.ts — NEW

export interface EvolutionVersion {
  version: number
  content: string
  updated_at: number
  /** How many entries had shaped this page at this point.
   *  Inferred from version_history index + entry_count delta.
   *  Null when inestimable (user correction doesn't change entry_count). */
  entryCountAtVersion: number | null
  /** What triggered this version: 'synthesis' | 'correction' | 'regeneration' */
  source: 'synthesis' | 'correction' | 'regeneration'
}

export interface EvolutionData {
  title: string
  category: string | null
  versions: EvolutionVersion[]    // oldest → newest
  currentVersion: number
  totalEntryCount: number
  createdAt: number
}

export function pageEvolution(page: WikiPage): EvolutionData
```

The function unwraps `version_history`, pairs each entry with its trigger from page metadata, and returns a flat array oldest-first. The `source` field is inferred:
- If a version's `corrected_at` matches its `updated_at` → `'correction'`
- If `entry_count` incremented → `'synthesis'`
- Otherwise → `'regeneration'`

### 6.2 `wordDiff()` — word-level diff between two content strings

```typescript
// src/services/wiki/evolution.ts — NEW

type DiffToken = { text: string; type: 'same' | 'added' | 'removed' }

export function wordDiff(a: string, b: string): DiffToken[]
```

Algorithm (standard LCS-based word diff):
1. Tokenize both strings into word tokens (split on `/\b(\w+)\b/g`, preserving whitespace between)
2. Compute the longest-common-subsequence of word tokens
3. Walk both token arrays in parallel, emitting `'same'` for LCS matches, `'removed'` for words in `a` not in `b`, `'added'` for words in `b` not in `a`
4. Merge adjacent tokens of the same type into a single fragment

**Why not a library:** This is ~40 lines. LCS on words is well-understood and the page content is short (typically 50-200 words). No npm dependency needed.

### 6.3 `retentionAtVersion()` — drift-adjacent metric per version

```typescript
// src/services/wiki/evolution.ts — NEW

export interface VersionRetention {
  version: number
  /** Fraction of the prior RETAINED version's content words that survived
   *  (0–1). Null across a sampled-history gap (versions discarded), when
   *  the prior version had no content words, or for the first version. Word
   *  overlap only — not a measure of semantic understanding. */
  stepRetention: number | null
  /** Fraction of the first contentful version's words still present (0–1).
   *  Computed even across sampled-history gaps (v_first_contentful → v_current). */
  originRetention: number | null
}

export function retentionAtVersions(evo: EvolutionData): VersionRetention[]
```

Reuses `retention()` from `drift.ts` for each consecutive pair and for the origin chain. Shown as a subtle "retention meter" next to each version — a small bar that's fuller when most of the prior version's substance carried forward.

#### F-5 — sampled-history honesty

`drift.ts` and `evolution.ts` now normalise the retained verison chain before any retention math:

- **Gaps** — when the engine's retained-history cap discards intermediate versions (e.g. `v1, v2, v14, v15`), the `v2 → v14` interval is a *sampled* gap, not a single rewrite. `stepRetention` is **null** across gaps; the `PageDrift.gaps` array records each `{ fromVersion, toVersion, missing }`. `originRetention` (v_first_contentful → v_current) is computed across gaps, since the two endpoints are truthfully retained.
- **Validation issues** — duplicate version numbers (last write wins) and non-increasing timestamps are flagged in `PageDrift.issues` (`duplicate-version`, `non-increasing-timestamp`). The report never crashes on bad data; issues only carry version numbers and a sanitised human string (no page text or titles).
- **Label honesty** — every metric in this report is **word overlap / lexical retention**, never a measure of semantic understanding. The dev report UI says so explicitly. The Version Timeline renders sampled gaps with a dashed connector + a `⋮ N prior versions sampled out` chip so a `v2 ↔ v14` jump is never drawn as a single rename.

---

## 7. Visual design (marketing-grade)

### Timeline rail

```
 ● v9  Today
 │
 ● v8  Jun 28
 │
 ● v7  Jun 15         ← selected (highlighted ring)
 │
 ● v6  May 30
 │
 ● v5  May 10
 │
 ● v4  Apr 18
 │
 ● v3  Mar 28
 │
 ● v2  Mar 5
 │
 ● v1  Feb 12
```

- Rail is a hairline-width vertical line (`borderColor: t.colors.border`)
- Dots are 10px circles, filled for versions with content changes, outline-only for minor/regeneration versions
- Selected dot: 16px circle with accent-color fill and a subtle glow
- Compare-mode second dot: 16px circle with secondary accent fill
- Date labels: relative for recent ("3 weeks ago"), absolute for older ("Mar 28")
- Tap target: 40px minimum — comfortable on mobile

### Content area (below timeline)

- When a single version is selected: shows VersionViewer with the version's full markdown
- When in compare mode: shows VersionDiff with green/red word highlighting
  - Added: `color: t.colors.successBg` + subtle green background pill
  - Removed: `color: t.colors.errorText` + strikethrough + light red background pill
  - Same: default body color
- Transition: when switching versions, the content fades/animates in (200ms opacity)

### Share composition

The shareable view composes a static snapshot:
1. Header: "How [title] evolved" + category badge
2. Timeline rail (compact, ~5 dots max on screen)
3. Two version snapshots side-by-side: "Then" (oldest) vs "Now" (current)
4. Footer: "MindWiki — an AI that knows you better over time"

---

## 8. Integration map

| File | Change |
|------|--------|
| `src/services/wiki/evolution.ts` | **NEW** — `pageEvolution()`, `wordDiff()`, `retentionAtVersions()` |
| `src/services/wiki/drift.ts` | No change (reuse `retention()` and `contentWords()` from here) |
| `src/app/wiki/[id]/evolution.tsx` | **NEW** — `PageEvolutionScreen` route |
| `src/components/wiki/VersionTimeline.tsx` | **NEW** — timeline rail component |
| `src/components/wiki/VersionDiff.tsx` | **NEW** — word-level diff renderer |
| `src/components/wiki/VersionViewer.tsx` | **NEW** — read-only past version viewer |
| `src/app/wiki/[id].tsx` | Replace lines 171-188 (compactHistory) with tappable "See evolution →" link when `version >= 2` |
| `src/hooks/useWiki.ts` | Add `usePageEvolution(id)` hook |
| `src/app/entries/[id].tsx` | Add "See how this page evolved" link after lineage tags (when the linked page has ≥2 versions) |

### Schema changes

**None.** Everything uses the existing `version_history` field on `wiki_pages`.

---

## 9. Implementation plan

### Phase A — Foundation (service layer)

1. Write `src/services/wiki/evolution.ts`:
   - `pageEvolution()` — unwraps version_history, tags each version with source
   - `wordDiff()` — LCS-based word diff

2. Write tests:
   - `pageEvolution` with a known version_history array returns correct EvolutionVersion[]
   - `wordDiff` correctly identifies added/removed/same words
   - `wordDiff` on identical strings returns all 'same'
   - `wordDiff` on empty strings returns `[]`

3. Verify: `yarn test` passes

### Phase B — Timeline UI

4. Create `src/components/wiki/VersionTimeline.tsx`:
   - Vertical rail with dots + dates
   - Selection state (single + compare-mode)
   - Scrollable for >4 versions

5. Create `src/app/wiki/[id]/evolution.tsx`:
   - Loads page via `getPage(id)`
   - Computes `EvolutionData` via `pageEvolution()`
   - Renders timeline + selected version content
   - Compare mode toggle + second picker
   - Playback mode

6. Create `src/components/wiki/VersionDiff.tsx`:
   - Word-level diff renderer with green/red highlighting
   - Single-version view when not in compare mode (diffs against current)

7. Update `src/hooks/useWiki.ts` with `usePageEvolution(id)` hook

8. Verify: navigate to `/wiki/abc/evolution` on a page with history → see timeline

### Phase C — Entry points

9. Modify `src/app/wiki/[id].tsx`:
   - Replace compactHistory section (lines 171-188) with a "See evolution →" button
   - Condition: `page.version > 1 && page.version_history.length > 0`

10. Add evolution link to entry detail in `src/app/entries/[id].tsx`

11. Verify: from wiki page detail → tap "See evolution" → evolution screen opens with correct data

### Phase D — Playback and share

12. Add playback controls to `PageEvolutionScreen`

13. Add share composition via `expo-sharing` + `react-native-view-shot`

---

## 10. Marketing examples (screenshot copy)

**Bluesky/Twitter caption:**

> "A single wiki page, tracked over 4 months. The AI doesn't just remember what I said — it refines its understanding of me with every entry. Version 9 is *not* version 1 with new stuff tacked on. It genuinely evolved. 🧠✨"

**App Store screenshot mockup:**

| Label | Content |
|-------|---------|
| Device frame | iPhone showing the timeline rail with 9 dots |
| Title | "Your understanding, evolving" |
| Subtitle | "Watch any insight page grow from first thought to current understanding — version by version." |
| Highlight | Timeline rail with Version 1 ("I sometimes feel anxious") and Version 9 ("When I'm overloaded at work, I get irritable — which I used to read as anxiety") side-by-side |

---

## 11. What NOT to build (scoped out)

| Feature | Reason |
|---------|--------|
| Auto-generated evolution video | Too much complexity; shareable screenshot covers 90% of the use case |
| Evolution notifications ("Your [X] page just evolved!") | Notifications are for journaling habit, not wiki trivia |
| Cross-page evolution ("topics that changed most this month") | Trends screen already covers "What's changing" via frequency/mood |
| Version rollback ("restore v3's content") | Would raise hard questions about which version synthesis builds on; out of scope |
| Edit past version content | Past versions are immutable archives; editing them breaks the compounding trust model |
