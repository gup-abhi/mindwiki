# Emotion Page Aggregates — Spec

> **Status:** Draft · **Target:** `main` + `feat/page-evolution-ui`  
> **Problem:** Emotion pages are the wiki's highest-traffic pages, rewritten every time the
> fast model tags the emotion. They converge to generic mush (a 400-token summary of
> every anxious thing that ever happened), and RICHNESS_BOOST in search preferentially
> grounds Reflect in exactly these mushiest pages.
>
> **Fix:** Stop synthesising emotion pages incrementally per-entry. Instead, synthesise
> them periodically from *aggregates*: top situations, trend direction, recent examples.
> Cheaper on battery, richer output, immune to mush.

---

## 1. The problem, in code

Every journal entry carries one canonical `emotion` tag (from a controlled 26-term
vocabulary). In [engine.ts:118](../../src/services/wiki/engine.ts#L118):

```ts
if (entry.emotion && entry.emotion.trim()) add(entry.emotion, 'emotion')
```

This adds the emotion as a wiki topic. `updateWikiForEntry` then calls
`synthesizePage()` for it — the **same** incremental "fold this new reflection in"
prompt used for every other category. Result:

| Category | Traffic | Existing content | Problem |
|----------|---------|-----------------|---------|
| `emotion` | ~1× per entry | Grows unbounded, rewritten each time | Mush |
| `distortion` | ~0.5× per entry | Grows slowly | Fine |
| `theme` | ~0.3× per entry | Few entries | Fine |
| `belief` | Rare | Stable | Fine |
| `person/place/activity` | Rare | Few entries | Fine |

**Drift measurements** (from [drift.ts](../../src/services/wiki/drift.ts)) confirm: 
emotion pages have the highest rewrite count and lowest step retention — words are
constantly churned, never compounding.

### RICHNESS_BOOST interaction

At [search.ts:48](../../src/services/wiki/search.ts#L48):

```ts
const RICHNESS_BOOST = (page: WikiPage): number => Math.min(page.entry_count, 10) * 0.1
```

Max boost is +1.0 points (hit at ~10 entries). A single title-word match = 5. So the
boost itself is small. The real problem is that emotion pages dominate lexical results:
"Anxiety" appears in every anxious entry's `situation` field, so `lexicalScore` on the
"Anxiety" page is always high. Emotion pages win retrieval → ground Reflect →
perpetuate the cycle.

### Re-grounding doesn't fix it

Every 10th synthesis does sample 6 past entries — but those 6 entries are just more
of the same mushy input pool. The structure of the problem (append-and-rewrite) is
unchanged.

---

## 2. Design — aggregate synthesis

### 2.1 New concept: aggregate page

An emotion page is no longer rewritten per-entry. Instead it's synthesised
**periodically** from structured aggregates computed from its source entries.

**Before (per-entry):**

```
entry tagged "Anxiety" → load Anxiety page → we-ave new reflection in → 400-token rewrite
```

**After (aggregate):**

```
entry tagged "Anxiety" → increment counter → (skip synthesis)

[periodic trigger]:
  1. query all entries tagged "Anxiety" (past N weeks)
  2. build aggregate summary:
     - total entry count (last 4 weeks, last 8 weeks)
     - top 5 most-frequent situations (from entry.situation)
     - mood trend: average mood over 4-week windows, direction
     - 2-3 recent concrete examples (newest distinct situations)
     - co-occurring emotions (what other emotions co-appear in entries tagged Anxiety)
  3. synthesise emotion page from aggregates
  4. update page (versioned, same mechanism)
```

### 2.2 What this buys

| Concern | Before | After |
|---------|--------|-------|
| **Battery** | 1 deep-model inference per tagged entry | 1 per week per emotion (26 emotions × 1/wk = ~26 inferences/wk vs potentially hundreds) |
| **Mush** | All entries averaged together | Top situations explicit, trend clear, recent examples concrete |
| **Drift** | Continuous churn (mean step retention ~75%) | Resets each period — origin retention irrelevant |
| **Reflect grounding** | Mushy generic page | Structured, specific page — better retrieval |
| **Page size** | Grows ~50-100 tok/rewrite | Capped at ~400 tok, regenerated each period |

### 2.3 When NOT to use

Only emotion pages use this path. Distortion, theme, belief, and entity pages continue
with incremental per-entry synthesis — their traffic is lower and their content is more
varied (emotions are controlled-vocab and universal; distortions/themes are sparser).

---

## 3. Aggregate data model

### 3.1 EmotionAggregate (new type)

Add to a new file `src/services/wiki/aggregates.ts`:

```ts
/** Pre-computed aggregate data for an emotion page synthesis. */
export interface EmotionAggregate {
  /** The canonical emotion label (e.g. "Anxiety"). */
  emotion: string

  /** Total entries tagged with this emotion, ever. */
  totalCount: number

  /** Count in the last 4 weeks and 8 weeks, for trend signal. */
  recentCount: { last4weeks: number; last8weeks: number }

  /** The 5 most-frequent situation patterns, with counts.
   *  "Situation" is free-text; we bucket by shared key terms via existing
   *  tokenize + word overlap (cheap, deterministic). */
  topSituations: { pattern: string; count: number }[]

  /** Rolling average mood (1-5) in the last 4 weeks vs the prior 4 weeks,
   *  to detect whether this emotion is intensifying or easing. */
  moodTrend: {
    recentAvg: number | null    // last 4 weeks
    priorAvg: number | null     // 4-8 weeks ago
    direction: 'up' | 'down' | 'stable' | 'insufficient_data'
  }

  /** 2-3 recent entries (newest, distinct situations) to use as concrete
   *  examples in the page. Minimal — just situation + thought, newest first. */
  recentExamples: { situation: string; thought: string; created_at: number }[]

  /** Other emotions that tagged entries co-occur with in the same entry
   *  (mood_score is derived from multiple signals). Top 3. */
  coOccurringEmotions: { emotion: string; count: number }[]
}
```

### 3.2 Why no new tables

The aggregate is fully derivable from existing data — it's a SQL query + some
client-side bucketing. Never persisted; computed on-demand at synthesis time.

---

## 4. Data flow

### 4.1 New route in `updateWikiForEntry`

In [engine.ts:136](../../src/services/wiki/engine.ts#L136), the `category === 'emotion'`
branch now skips `synthesizePage` and instead **tickles** the page for a future
aggregate:

```ts
if (category === 'emotion') {
  // Don't synthesise per-entry. Tick the page for aggregate refresh instead.
  await tickleEmotionPage(pageId, topic.title)
  continue
}
```

`tickleEmotionPage`:
- If the page doesn't exist yet, creates it with initial content (a placeholder
  "Tracking entries tagged with this emotion…" — the first aggregate will fill it).
- Increments `entry_count` but does NOT rewrite content.
- Records a `pending_aggregate_at` timestamp in a lightweight marker (see §6.1).

### 4.2 Periodic trigger

Two triggers check for pending aggregates:

#### (a) After every N taggings

A global counter in `engine.ts`. After every 20 emotion taggings (any emotion), scan all
emotion pages for aggregates due:

```ts
const AGGREGATE_INTERVAL_TAGS = 20   // global trigger: check after 20 emotion tags
const AGGREGATE_MIN_ENTRIES = 5       // minimum entries before first aggregate
const AGGREGATE_MIN_AGE_MS = 24 * 60 * 60 * 1000  // 24h before first aggregate
```

A page is "due" for aggregate when:
- `entry_count >= AGGREGATE_MIN_ENTRIES`
- `Date.now() - page.updated_at > AGGREGATE_MIN_AGE_MS` (once per day minimum)
- `entry_count` has grown by at least 10 entries since the last aggregate (re-synthesise
  only when there's enough new data to justify the inference)

#### (b) Engine idle hook (future)

An optional `maybeRefreshEmotionPages()` call in the background schedule, running every
~4 hours. Scans all emotion pages for the same due criteria. Cheap — just a SQL count +
comparison.

### 4.3 The aggregate query

In `buildEmotionAggregate(emotion: string): Promise<EmotionAggregate>`:

```ts
const eightWeeksAgo = Date.now() - 8 * 7 * 24 * 60 * 60 * 1000
const fourWeeksAgo = Date.now() - 4 * 7 * 24 * 60 * 60 * 1000

// All entries for this emotion (journal only)
const all = await listEntriesByEmotion(emotion)

// Filter to the 8-week window for aggregates
const recent = all.filter(e => e.created_at > eightWeeksAgo)

// Top situations: bucket by stripped, lowercased situation text
// Use exact text as bucket key after collapsing whitespace
const situationCounts = new Map<string, number>()
for (const e of recent) {
  const key = e.situation.trim().toLowerCase().replace(/\s+/g, ' ')
  situationCounts.set(key, (situationCounts.get(key) ?? 0) + 1)
}
const topSituations = [...situationCounts.entries()]
  .sort((a, b) => b[1] - a[1])
  .slice(0, 5)
  .map(([pattern, count]) => ({ pattern, count }))

// Mood trend
const last4 = recent.filter(e => e.created_at > fourWeeksAgo && e.mood != null)
const prior4 = recent.filter(e => e.created_at > eightWeeksAgo && e.created_at <= fourWeeksAgo && e.mood != null)
const avg4 = last4.length > 0 ? last4.reduce((s, e) => s + e.mood, 0) / last4.length : null
const avg8 = prior4.length > 0 ? prior4.reduce((s, e) => s + e.mood, 0) / prior4.length : null
const direction = avg4 != null && avg8 != null
  ? (avg8 - avg4 > 0.3 ? 'down' : avg4 - avg8 > 0.3 ? 'up' : 'stable')
  : 'insufficient_data'

// Recent examples: newest entries with distinct situations (dedup by situation text)
const seen = new Set<string>()
const recentExamples: EmotionAggregate['recentExamples'] = []
for (const e of all) {  // all entries, not just 8-week (covers older distinct situations)
  const key = e.situation.trim().toLowerCase().replace(/\s+/g, ' ')
  if (!seen.has(key) && e.situation.trim()) {
    seen.add(key)
    recentExamples.push({ situation: e.situation, thought: e.thought, created_at: e.created_at })
    if (recentExamples.length >= 3) break
  }
}

// Co-occurring emotions (across all history, for signal strength)
const coOccur = new Map<string, number>()
for (const e of all) {
  if (e.emotion) {
    // Count the entry itself, plus any other emotion listed (entries have one emotion,
    // but mood_score + energy imply co-regulation — captured via graph, not here.
    // For now this is a placeholder: the field is in the aggregate type for future
    // use when multi-emotion entries exist.)
  }
}
```

**Important:** This runs on-device, not on a server. The queries use existing indexed
columns (`emotion`, `created_at`). The aggregation is O(n) over one emotion's entries
(n ≤ ~200 for a heavy emotion across 8 weeks on a daily journaler). Acceptable for a
background operation.

---

## 5. Prompt design

### 5.1 New prompt: `buildEmotionPagePrompt`

In `src/services/llm/prompts/update-page.ts`, a new function:

```ts
export interface EmotionPageInput {
  title: string        // e.g. "Anxiety"
  data: EmotionAggregate
  existingContent: string
  /** Whole weeks since the last aggregate rewrite, for temporal framing. */
  weeksSinceUpdate: number | null
}
```

The prompt replaces the "weave in the new reflection" instruction with a
"summarise from aggregates" instruction:

```
You maintain a personal wiki page titled "Anxiety" (emotion).

This page tracks how the writer experiences ANXIETY — not a list of events, but an
evolving picture of what triggers it, how intense it feels, and how it's changing.

Re-synthesise the page from the aggregate data below. Do NOT just repeat the data —
turn it into warm, readable prose about the writer's patterns with this emotion.

Style:
- Write in second person ("you", "your") — the page is about THEIR patterns.
- Never use labels, headings, or sections like "Situation:", "Thought:".
- Be specific and concise — no generic filler.
- If there are concrete recent examples, weave in 1-2 naturally ("Recently, when…").
- If the trend is up or down, reflect that ("This has been coming up more lately…").
- If there's no trend yet (new pattern), just describe what you see so far.

Aggregate data for the past 8 weeks:
- Total check-ins tagged: 24 (15 in the last 4 weeks, 9 in the prior 4)
- Most common triggers/situations:
  • Work deadlines — mentioned 6 times
  • Social events — mentioned 4 times
  • Health worries — mentioned 3 times
  • Sleep issues — mentioned 3 times
  • Financial concerns — mentioned 2 times

- Mood when anxious: 2.4 (last 4 weeks) vs 2.8 (prior 4) — intensifying slightly
- Weekly frequency: ~4 check-ins → pattern is consistent

Recent examples (newest distinct situations):
  2026-07-08 — Presentation to the leadership team. Felt unprepared even though you'd prepared thoroughly.
  2026-07-05 — Lying in bed at 2am, replaying a conversation from the day before word by word.
  2026-07-01 — Someone didn't reply to a message and you immediately assumed you'd done something wrong.

Current page (as prior):
[existing content]

Output ONLY the re-synthesised page, no preamble.
```

### 5.2 Generation parameters

Same as `synthesizePage`: `maxTokens: 400`, `temperature: 0.5`.

### 5.3 Validation

Same `WikiContentSchema + stripScaffolding` guard as existing synthesis. The output is
validated identically.

---

## 6. Storage

### 6.1 Pending-aggregate marker

The simplest mechanism: **reuse the existing `entry_count` coupled with a new
`last_aggregate_at` concept.** No schema change needed.

- `updateWikiForEntry` still increments `entry_count` for emotion pages (keeps the
  counter honest — search ranking needs entry_count to reflect total entries).
- Content is NOT updated on each entry (saves ~400-token inference + the O(n) rewrite).
- A new page-level constant `nextAggregateAt: number` (the minimum entry_count that
  should trigger the next aggregate) is tracked in a new scratch column OR computed
  client-side.

**Option A (recommended — no migration):** New column `aggregated_upto` on
`wiki_pages`. Optional migration:

```sql
ALTER TABLE wiki_pages ADD COLUMN aggregated_upto INTEGER DEFAULT 0;
```

When `entry_count - aggregated_upto >= AGGREGATE_BATCH_SIZE (10)` and the page is
old enough, the page is due. After aggregate, set `aggregated_upto = entry_count`.

This is a nullable integer, default 0 — no index needed (we scan at most 26 emotion
pages).

### 6.2 Version history

Same `updatePage` call — the aggregate replaces content, archives the old version,
bumps version. The version_history now reflects aggregate snapshots, not per-entry
rewrites — which is actually *more* useful for the Evolution UI (each snapshot
represents a meaningful change in the pattern, not random churn).

### 6.3 Existing mush pages — immediate first aggregate

On first deploy, synthesise the first aggregate FOR EVERY existing emotion page
**from all historical data** rather than letting stale mush linger. This is the
default path — the aggregate query is O(n) over one emotion's entries (n ≤ ~200
for a heavy emotion on a daily journaler), well within background-task limits.

Each existing emotion page gets called through `maybeRefreshEmotionPages()` once on
deploy, with `aggregated_upto = 0` so the full history is included. After synthesis,
`aggregated_upto = entry_count`. From that point forward, only new entries trigger
future aggregates.

---

## 7. Search interaction

### 7.1 RICHNESS_BOOST unchanged

The boost value is fine (+1 max). The real fix is that aggregate emotion pages are
*concrete and specific* rather than mushy, so their content matches specific queries
better. A Reflect query about "work stress" matches the "Work deadlines" mention in
the new Anxiety page, not the old mush — which is exactly the right result.

### 7.2 entry_count still grows

Emotion pages will still have high `entry_count`. That's correct — they ARE the
highest-traffic pages. `RICHNESS_BOOST` capping at 10 keeps the effect bounded.

---

## 8. Edge cases

| Case | Handling |
|------|----------|
| **Emotion just tagged for first time** | Create page with placeholder content, `aggregated_upto = 0` |
| **Fewer than AGGREGATE_MIN_ENTRIES** | Don't synthesise until enough data |
| **Zero entries in the 8-week window** | If the emotion exists historically but is dormant, synthesise from all-time data with "This hasn't come up recently" framing |
| **All entries have identical situation** | dedup in recent examples catches this; show 1 example, note it's a recurring trigger |
| **User corrects a page that's now aggregate-driven** | `correctPage` works identically — replaces content, sets `corrected_at`. The next aggregate check should skip a recently-corrected page (within ~24h) so the user's edit persists. |
| **Emotion has only entry_count = 0 after creation** | No aggregate synthesised. The placeholder signals "tracking this — no data yet." |
| **Tagged emotion doesn't exist as a page yet** | `tickleEmotionPage` creates it. The first aggregate fills it. |
| **Existing page is dismissed** | Aggregate trigger skips dismissed pages (same `WHERE dismissed_at IS NULL` filter). The page stays empty. |

---

## 9. Implementation plan

### Phase 1 — Aggregate data builder (aggregates.ts)

- [ ] `buildEmotionAggregate(emotion) → EmotionAggregate` function
- [ ] Situation bucketing (exact text match, AGGREGATE_MIN_ENTRIES threshold)
- [ ] Mood trend computation
- [ ] Recent-example dedup (distinct situations)
- [ ] Co-occurrence (placeholder — single-emotion entries)
- [ ] Tests: zero entries, single entry, many entries, identical situations, mood nulls

### Phase 2 — Emotion routing + tickle (engine.ts)

- [ ] `tickleEmotionPage(pageId, title)` — create page if missing, increment counter
- [ ] Category check in `updateWikiForEntry`: `if (category === 'emotion')` → tickle, skip synth
- [ ] `maybeRefreshEmotionPages()` — scan due emotion pages, compute aggregate, synthesise
- [ ] Global trigger after every N emotion taggings
- [ ] Tests: emotion entry doesn't trigger old synthesis path, aggregate fires at threshold

### Phase 3 — Prompt (update-page.ts)

- [ ] `buildEmotionPagePrompt(input) → string`
- [ ] Wire into `deep-model.ts` as `synthesizeEmotionPage(input)`
- [ ] Same `maxTokens: 400, temperature: 0.5`
- [ ] Tests: prompt contains aggregate data, doesn't contain "weave the new reflection"

### Phase 4 — Migration

- [ ] Schema migration: `ALTER TABLE wiki_pages ADD COLUMN aggregated_upto INTEGER DEFAULT 0`
- [ ] One-shot `refreshAllEmotionPages()` called on deploy: for every emotion page with
      `entry_count > aggregated_upto`, compute the aggregate from ALL history and
      re-synthesise immediately (so existing mush is replaced day-one)
- [ ] Verify: existing emotion pages don't vanish or show placeholder after deploy

### Phase 5 — Cleanup

- [ ] `sampleEntriesForPage` in engine.ts still handles `emotion` as a query route — keep it (re-grounding for non-emotion pages uses it, and the aggregate builder calls `listEntriesByEmotion` directly)
- [ ] Remove emotion from `candidateTopics`? No — emotion still needs to produce a `Topic` so `updateWikiForEntry` routes it. The category check handles the rest.
- [ ] Verify RICHNESS_BOOST interaction: aggregate pages should rank HIGHER (more specific) than mushy ones — no changes needed.

---

## 10. Open questions

1. **Should we keep entry_count incrementing on emotion pages?** Yes — it's used by
   `RICHNESS_BOOST` and the page list sort. It also lets the user see "Anxiety has
   been tagged 47 times" in the page footer.

2. **Should the aggregate page include a link to search results?** The existing
   "N entries" display in the UI serves this purpose. Out of scope.

3. **What about named_emotion?** When a user consciously names an emotion at capture
   (journal), `named_emotion` is persisted but `emotion` is also set by the model.
   The page is keyed on the canonical `emotion` label — `named_emotion` is orthogonal
   (it's a UX thing). No change needed.

4. **Can the aggregate path be reused for distortions?** Possibly, but distortions
   have more varied content per entry (each is a different thinking pattern) and lower
   traffic — the incremental path works fine for now.

---

## 11. Success criteria

- [ ] Emotion pages no longer rewrite on every tagged entry — only when the aggregate
      trigger fires
- [ ] In a 30-day test with daily journaling (~90 entries, ~75 emotion-tagged):
  - Inference count drops from ~75 to ~3-4 per emotion (at most 26 aggregate
    syntheses per week, but in practice only 5-10 emotions are active)
  - Battery savings measurable on-device
- [ ] Emotion page content is visibly more structured (top situations, trend,
      concrete examples) rather than generic prose
- [ ] All existing tests pass (engine, search, evolution, drift)
- [ ] Version history on emotion pages is sparser but more meaningful (aggregate
      snapshots instead of churn)
