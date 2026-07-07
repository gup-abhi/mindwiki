# Wiki Re-grounding — periodic synthesis from source entries

> Spec — 2026-07-07. Proposed feature.

---

## Problem

Wiki pages use a fixed 400-token output buffer (`deep-model.ts:143`) with a 2400-char input cap (`update-page.ts:31`). Every entry only ever sees the **previous 400-token summary + itself**. After N entries, the page is N passes of telephone through a 3B model at temperature 0.5.

**Measured consequence** (drift data): step-retention ~87%, origin-retention ~75%. Early insights decay after ~10 entries because the model never re-reads them.

## Principle

> Entries are immutable, all on-device, private. Unlike a cloud app, the full source corpus costs nothing to query. Use it.

Re-grounding replaces the telephone chain with direct evidence: **periodically, the model sees not just the previous summary, but K source entries that shaped the page**. It builds from both, resetting the accumulation to zero so the next N incremental passes start fresh.

```
Incremental (default):    summary_{n-1} + entry_n → summary_n     [cheap, ≤1 query]
Re-grounding (periodic):  summary_{n-1} + K entries + entry_n → summary_n   [truth resync]
```

---

## Re-grounding trigger

A page re-grounds when:

```typescript
page.entry_count > 0 &&
page.entry_count % RE_GROUND_INTERVAL === 0 &&
!page.dismissed_at &&
new Date(page.created_at).getTime() > 24 * 60 * 60 * 1000 ago  // page exists ≥24h
```

| Constant | Value | Rationale |
|----------|-------|-----------|
| `RE_GROUND_INTERVAL` | **10** | Smooth with ~1-2 entries/day → every 5-10 days. Short enough that early insights never drift far, long enough that 90% of passes stay cheap. |
| Age gate | **24h** | A new page shouldn't re-ground before it has content worth re-grounding from. Prevents a double-synthesis on day 1. |

A page created *by* a re-grounding pass gets the interval counter reset: its re-ground is at entry_count = 20, 30, etc., not 10 (the first 10 entries were synthesised by the re-grounding itself, so the telephone is fresh).

### Entry count edge case

`entry_count` is the number of entries that have shaped the page. It is already stored on `wiki_pages` and updated by `updatePage()` (`engine.ts:165` area). Pages created before this feature get their first re-grounding at `entry_count = ceil(count / 10) * 10` — a page with 23 entries re-grounds when entry 30 hits it.

---

## Entry sampling — `sampleEntriesForPage()`

New function in `engine.ts`. Queries the K most recent entries relevant to a page, deduplicated by creation date.

```typescript
async function sampleEntriesForPage(
  title: string,
  category: string | null,
  maxEntries: number
): Promise<Entry[]>
```

| Category | Query | Columns |
|----------|-------|---------|
| `emotion` | `SELECT * FROM entries WHERE emotion = ? ORDER BY created_at DESC` | emotion |
| `distortion` | `SELECT * FROM entries WHERE distortion = ? ORDER BY created_at DESC` | distortion |
| `theme` | `SELECT * FROM entries WHERE topic = ? OR topic2 = ? ORDER BY created_at DESC` | topic, topic2 |
| `person`, `place`, `activity`, `belief`, `behavior` | `SELECT e.* FROM entries e JOIN entry_entities ee ON e.id = ee.entry_id WHERE ee.label = ? ORDER BY e.created_at DESC` | entry_entities.label |

**Max entries**: `K = 6`. Chosen so that:

| Item | Chars | Source |
|------|-------|--------|
| Prompt instructions + style | ~400 | static |
| Current page (trimmed) | ~1200 | 300 tokens, trimmed more aggressively during re-ground |
| 6 entries @ ~130 chars each | ~780 | `situation + thought`, projected |
| New reflection | ~300 | single entry |
| **Total** | **~2680** | under 4000-char output cap, under 2048 n_ctx |

Entry text is formatted as a compact date-keyed block (no labelled "Situation"/"Thought" headers — those leak into output):

```
Past entries:
2026-06-01 — {trimmed situation + thought, ~120 chars}
2026-06-07 — {trimmed situation + thought, ~120 chars}
...
```

**Deduplication**: if two entries have identical `situation + thought` (same reflection restated), only the most recent is kept. Implemented by hashing the projected display text.

**Exclusion**: Reflect-capture entries (`source = 'reflect'`) are excluded — their restated `situation` is a distillation, not a raw journal entry. This matches `listEntriesByColumn`'s existing filter.

---

## Prompt changes

### Normal pass (unchanged)

`buildUpdatePagePrompt()` as-is. The existing `MAX_EXISTING_CHARS = 2400` cap stays.

### Re-grounding pass — `buildReGroundPrompt()`

New function, same signature as `UpdatePageInput` + `entries: Entry[]`:

```typescript
export interface ReGroundInput extends UpdatePageInput {
  pastEntries: Array<{ situation: string; thought: string; created_at: number }>
}
```

The prompt structure changes:

```
You maintain a personal wiki page titled "{title}" ({category}).
Re-synthesize it based on the current page AND the past entries below.
{style instructions}
{hint}
{reframeLine}
{recencyLine}

The current page is a summary. The "Past entries" are the actual journal
entries that shaped this topic — ground your synthesis in these as the
primary evidence. Do NOT copy any entry word-for-word; synthesise.

Current page (as prior):
{existing, trimmed to ~1200 chars}

Past entries (newest first):
2026-06-01 — {situation}. {thought}
2026-06-07 — {situation}. {thought}
...

New entry:
{situation}. {thought}

Output ONLY the page content, no preamble.
```

### Key differences from normal prompt

| Normal (`buildUpdatePagePrompt`) | Re-grounding (`buildReGroundPrompt`) |
|----------------------------------|---------------------------------------|
| "Weave the new reflection into the page" | "Re-synthesize based on the current page AND the past entries below" |
| ExistingContent trimmed to 2400 chars | ExistingContent trimmed to **1200 chars** (entries carry authority) |
| No entry context | 6 past entries as primary evidence |
| Current page is sole carrier of accumulated knowledge | Current page is a **prior**; entries are ground truth |
| "New reflection" alone | "Past entries" block + "New entry" |

---

## Synthesis parameters

Re-grounding uses the same `maxTokens: 400, temperature: 0.5` as normal synthesis (no change to `deep-model.ts`). The re-grounding prompt is longer (entries add ~800 chars), but the 400-token output cap is unchanged — re-grounding must consolidate, not expand.

**Context window check**: At ~2700 chars for the prompt, we are well within the deep model's 2048-token `n_ctx` (projected ~1400 tokens). No risk of silent context shift (`update-page.ts:25-30` documents the risk and our margin).

---

## Integration in engine.ts

The call site in `updateWikiForEntry()` changes minimally:

```typescript
// After resolveSurvivor, before .dismissed_at check
const baseContent = page && page.dismissed_at == null ? page.content : ''

// Re-grounding check — only for active pages with existing content
const isReGround = page != null &&
  page.entry_count > 0 &&
  page.entry_count % RE_GROUND_INTERVAL === 0 &&
  !page.dismissed_at &&
  Date.now() - page.created_at > 24 * 60 * 60 * 1000

let pastEntries: Entry[] = []
if (isReGround) {
  const sampled = await sampleEntriesForPage(effectiveTitle, category, 6)
  if (sampled.success) pastEntries = sampled.data
}

// Select prompt builder based on re-grounding
const synth = pastEntries.length > 0
  ? await synthesizePageReGround({
      title: effectiveTitle, category,
      existingContent: baseContent,
      situation: entry.situation,
      thought: entry.thought,
      reframe,
      weeksSinceUpdate,
      pastEntries: pastEntries.map(e => ({
        situation: e.situation,
        thought: e.thought,
        created_at: e.created_at,
      })),
    })
  : await synthesizePage({...})
```

**No nesting**: if `sampleEntriesForPage` fails (returns empty or err), fall through to the normal `synthesizePage` call — the entry still gets processed, just without re-grounding. Never block on a failed query.

### Throttling during catch-up

If a device has been offline for weeks and a catch-up pass hits many pages at their re-grounding boundary, the serial deep-model queue handles this naturally — each re-ground pass is ~15s on device. No additional throttle needed.

---

## Storage changes

### New query — `listEntriesByTopicOrTopic2`

Does not exist yet. Mirrors `listEntriesByColumn` but ORs two columns:

```typescript
export async function listEntriesByTopicOrTopic2(
  value: string,
  db?: SqliteDatabase
): Promise<Result<Entry[]>>
```

Added to `entries.ts` alongside the existing `listEntriesByTopic`.

### `listEntriesForEntity` — already exists

Used as-is for entity-category pages.

---

## Schema / migration

**None.** This feature uses existing columns only.

---

## Edge cases

| Case | Behaviour |
|------|-----------|
| Page has 3 entries, entry_count % 10 = 3 | Normal synthesis — no re-ground |
| Page has 10 entries, re-ground triggered | Fetches 6 past entries (not all 10 — capped at K) |
| Re-ground produces a stunted page (< 100 chars) | `WikiContentSchema` validates. If too short, normal synthesis fallback? **No** — let it land; the model consolidated. No special handling. |
| `sampleEntriesForPage` returns 0 (all deleted?) | Fall through to normal synthesis — no re-grounding |
| Page was just created (age < 24h) | Even at entry_count = 10, skip re-grounding. Age gate wins. |
| Entry at the re-grounding boundary is itself a Reflect capture | Excluded by `source = 'journal'` filter in the query — still counts toward `entry_count`, just isn't surfaced as evidence. Normal. |
| Two identical entries in the K (same reflection repeated) | Deduped by content hash. The model sees one copy. |
| 3B model runs out of context during re-ground prompt | Not possible — ~1400 tokens projected, well under 2048. |
| Device is mid-catch-up, hits 3 pages at re-ground boundary simultaneously | Deep model serial queue processes them one by one. ~45s total for 3 re-grounds. Fine. |

---

## Success criteria

1. After a re-grounding pass, the page retains ≥1 insight from the sampled entries that was **absent from the previous summary** — demonstrating the model actually read the source entries rather than compressing the prior.
2. After 20 incremental entries without re-grounding, a page no longer mentions an insight from entry #1. After a re-ground at entry #20, that insight reappears.
3. The drift gap shrinks: step-retention and origin-retention differ by <5 percentage points post-re-ground (vs the current 12-point gap).

Criteria 2–3 can be validated with the existing `checkHouseStyle` test fixture by synthesising a page, running 10 incremental updates on fresh entries, then a re-grounding pass, and checking which early details survive.

---

## Files changed

| File | Change |
|------|--------|
| `src/services/llm/prompts/update-page.ts` | Add `buildReGroundPrompt()` function (new `ReGroundInput` interface, prompt template). Export both builders. |
| `src/services/llm/deep-model.ts` | Add `synthesizePageReGround()` export (calls `buildReGroundPrompt`, same `WikiContentSchema` / `stripScaffolding` / error handling as `synthesizePage`). |
| `src/services/wiki/engine.ts` | Add `RE_GROUND_INTERVAL`, `sampleEntriesForPage()`, re-grounding gating logic in `updateWikiForEntry()`. |
| `src/services/storage/entries.ts` | Add `listEntriesByTopicOrTopic2()` query. |
| `__tests__/services/wiki/engine.test.ts` | Add re-grounding flow test (mock entries, verify prompt builder dispatched for re-grounding boundary). |
| `__tests__/services/llm/update-page.test.ts` | Add `buildReGroundPrompt` unit test (verify prompt structure, entry formatting, char caps). |

No changes to: `deep-model.ts` inference call (same `LLMBridge.synthesise`), `WikiContentSchema`, `buildRewritePagePrompt`, graph engine, entry save path, sync layer.

---

## Implementation order

1. **Storage** — add `listEntriesByTopicOrTopic2()` to `entries.ts` (trivial, no review needed)
2. **Prompt** — add `buildReGroundPrompt()` to `update-page.ts` with entry formatting helpers
3. **Engine** — add `sampleEntriesForPage()`, re-grounding gate, and `RE_GROUND_INTERVAL` to `engine.ts`
4. **Deep model** — add `synthesizePageReGround()` to `deep-model.ts` (thin wrapper)
5. **Tests** — unit tests for prompt builder + engine dispatch logic

Steps 1–4 are independently verifiable at each step (typecheck passes, existing tests pass). Step 5 can run in parallel with 4.

---

## Future considerations (not implemented here)

- **Dynamic K**: sample K entries proportional to entry_count (capped at 10) so a 50-entry page re-grounds from a wider base. The current fixed K=6 is conservative and context-safe; dynamic K needs real-device profiling of the 2048 n_ctx headroom.
- **Manual re-ground**: a "Re-synthesize from entries" button on the wiki page detail. Independent of the automatic interval; could share `buildReGroundPrompt` with a user-settable K.
- **Sync-aware re-ground**: if a page was just synced from another device, skip its next re-ground (the sync body is fresh).
