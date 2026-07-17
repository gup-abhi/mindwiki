# SPEC — Reflect post-embedding-swap fixes & companion "talk to someone" loop

> Temporary working spec. Not for commit — delete once implemented.
> Source: Reflect audit after the bge-small → EmbeddingGemma-300m swap (2026-07-13).
> Method: SPARC/TDD per CLAUDE.md — every workstream lists failing tests first.

---

## Scope

Four workstreams, in implementation order:

1. **WS1 — Bug fixes** (small, isolated, test-first)
2. **WS2 — Companion constraint handling** (the "no one to talk to" loop)
3. **WS3 — Hybrid ranker recalibration for EmbeddingGemma**
4. **WS4 — Optional/deferred** (task-prefix split, recap steer, embed-window check)

Out of scope: embedding-based paraphrase detection (1–2s fresh-context load per
embed call makes it unusable per-sentence), any cloud LLM, any change to the
crisis keyword path.

---

## WS1 — Bug fixes

### WS1.1 Summary seed poisons the recap counter

**Where:** `src/hooks/useConversation.ts` (~line 329, conversation seeding).

**Bug:** Seeding a new conversation calls `setSummary(combined, totalCount)`
where `totalCount` is the count of messages from *previous* conversations.
`updateRunningSummary` interprets `summaryCount` as "messages of THIS thread
already folded into the recap", so the first `totalCount` messages of the new
thread are treated as already-summarized: they fall out of the 8-message recent
window and are silently never folded into the recap.

**Behavior:** Seeding a conversation with prior-conversation recaps must set
`summaryCount = 0`. The seeded summary text is unchanged.

**Tests (failing first):**
- `__tests__/services/wiki/conversation.test.ts` (or hook test if one exists):
  given seeded state `{ summary: 'seed', summaryCount: 0 }` and a 12-message
  thread, `updateRunningSummary` folds `messages.slice(0, 4)` — i.e. eviction
  starts at message 0, not at the old conversations' count.
- Regression shape: seed with the buggy count (e.g. 12) and assert the current
  behavior skips messages — this documents WHY the fix matters (optional).

**Edge cases:** empty seed (no prior recaps) — unchanged, summaryCount stays 0.

### WS1.2 Duplicate & buggy question-alternation guard

**Where:** `src/services/wiki/conversation.ts` — `stripTrailingQuestion()` +
its call site in `respond()`.

**Bug:** (a) The sentence-boundary search uses `lastIndexOf('.')` only, so a
reply like `"That sounds hard! What happened?"` isn't split at `!`.
(b) The guard is redundant: `converseFromWiki` (deep-model.ts) already enforces
question alternation via `scrubReply` + stream gate before `respond` re-applies
this buggier version.

**Behavior:** Delete `stripTrailingQuestion` and its invocation from
`respond()`. The deep-model guard is the single source of truth.

**Tests:**
- Existing `respond` tests that exercise stripping
  (`conversation.test.ts` "strips a trailing question…", "keeps a standalone
  question…", "keeps the reply when previous turn did NOT end with ?") move
  their intent to deep-model coverage: verify `deep-model.test.ts` already
  covers alternation scrub (it does — extend with a `!`-boundary fixture if
  missing). The `respond`-level tests are updated to assert the reply passes
  through **unmodified** (the mock returns final text; respond no longer edits it).

**Edge cases:** none new — behavior is deletion + reliance on existing guard.

### WS1.3 `lastBackgroundKey` leaks across conversations

**Where:** `src/services/wiki/conversation.ts` — module-level
`lastBackgroundKey`, reset only when `history.length === 0`.

**Bug:** Resuming conversation B after chatting in A can wrongly produce a
titles-only turn (no page prose) if B's first retrieval matches A's last key,
because the module-level key survives across conversations.

**Behavior:** Key the dedupe per conversation. Add optional
`conversationId?: string` to `RespondInput`; store keys in a
`Map<conversationId, string>` (module-level Map is fine; single value keyed
`''` when id is absent preserves old behavior for tests that don't pass one).
Reset semantics: a conversation's entry is cleared when `history.length === 0`
for that id.

**Tests (failing first), `conversation.test.ts`:**
- Turn 1 in convo A (full background) → turn 1 in convo B with the SAME
  retrieval → B must get **full** background (sources non-empty), not
  titles-only.
- Existing "full once, then titles-only" test updated to pass a
  conversationId and still pass.

**Caller change:** `useConversation.ts` passes the active conversation id into
`respond`.

---

## WS2 — Companion constraint handling ("no one to talk to" loop)

### Problem statement

When the user states they have no one to talk to, the companion repeatedly
suggests talking to someone. Three root causes:

1. The 3B model's instruction-tuned reflex (distress → "reach out") is never
   countered in the prompt; no helper note covers loneliness/isolation.
2. User-stated constraints have no persistence — once "I don't have anyone"
   scrolls past the 8-message window, the contradiction is forgotten.
3. `makeRepeatChecker` only catches ≥80% content-word overlap with verbatim
   prior sentences, and only within the trimmed (~4-reply) window; paraphrased
   advice passes.

### Design

Three layers, mirroring the existing question-alternation pattern
(prompt steer + deterministic code guard), plus one memory widening:

#### WS2.A Constraint pins — `src/services/llm/reference/constraints.ts` (new)

Pure module, same idiom as `selectHelperNotes`:

```
detectConstraints(userTurns: string[]): Constraint[]
```

- `Constraint = { id: string; steer: string }`
- Trigger table (lowercase cue → constraint), initial set:
  - `no-support-network`: "no one to talk to", "nobody to talk to",
    "don't have anyone", "dont have anyone", "no friends", "nobody to turn to",
    "no one i can talk", "all alone in this"
  - `no-therapy-access`: "can't afford therapy", "cant afford therapy",
    "no therapist", "can't see a therapist"
  - `unsafe-family`: "can't talk to my family", "family isn't safe",
    "family wouldn't understand" *(keep the cue list tight — substring match
    for phrases, same as companion-wiki TRIGGERS)*
- Steer text for `no-support-network` (exact copy to be prompt-tested):
  > "They have told you they don't have anyone to talk to. Never suggest
  > reaching out to, talking to, or confiding in other people — you are the
  > one who is here. Reflect what it is like to carry this alone."
- Scans **all** user turns of the conversation (full history, not the trimmed
  window), dedupes by id, order-stable.
- Non-matches must stay non-matches: "I talked to my mom today" must NOT
  trigger anything.

**Wiring:** `respond()` receives full history already; it computes constraints
from `history` (user turns) + the new `message` **before** trimming, and passes
them through `ConversationContext` (new optional field `constraints: string[]`)
into `buildConversationMessages`, which appends them to the system prompt as a
pinned block (after helper notes, before background).

**Tests (failing first):**
- `__tests__/services/llm/reference/constraints.test.ts` (new):
  - each cue in the table triggers its constraint
  - "I talked to my mom", "my friend said…" do not trigger
  - dedupe: cue appearing in 3 turns → 1 constraint
  - matches a turn at index 0 of a 20-turn history (full-history scan)
- `__tests__/services/llm/prompts/conversation.test.ts`:
  - system prompt contains the steer when `context.constraints` is non-empty
  - absent when empty
- `conversation.test.ts` (`respond`):
  - user turn 1 = "i don't have anyone to talk to", then 10 more turns (so it
    is OUTSIDE the trimmed window) → the context passed to `converseFromWiki`
    still carries the constraint.

#### WS2.B Advice-deflection scrub — `src/services/llm/deep-model.ts`

Deterministic post-guard alongside `ANNOUNCE_RE`:

```
DEFLECT_RE — sentence-level match for third-party deflection, e.g.:
  /\b(talk|speak|reach out|open up)\s+(to|with)\s+(someone|somebody|a friend|
  a therapist|a counsellor|a counselor|a professional|your (friend|family|
  parents|partner|doctor))\b/i
  /\bconsider (seeing|telling|talking to)\b/i
  /\bshare (this|it|that) with\b/i
```

- Applied **unconditionally** in the companion reply path (`scrubReply` and
  `createStreamGate`): the techniques contract is already "reflect, don't
  prescribe", so deflection sentences are always off-style, constraint or not.
- Sentence-drop semantics identical to the announcement scrub: drop matching
  sentences; if the entire reply would be dropped, keep the original (never
  return empty — same fallback rule as `scrubReply`).
- The crisis path is untouched: `CRISIS_REPLY` in `useConversation.ts` is a
  fixed string that never passes through `converseFromWiki`.

**Tests (failing first), `deep-model.test.ts`:**
- reply "That sounds heavy. Maybe talk to a friend about it." → "That sounds
  heavy."
- reply "Have you considered seeing a therapist?" (entire reply matches) →
  kept as-is (never-empty fallback)
- reply with validation + no deflection → unchanged
- stream-gate fixture: deflection sentence is held and never emitted to
  `onToken`
- paraphrases: "reaching out to somebody might help", "open up to your
  family" → dropped; "I'm here to talk with you" → kept (regex must not
  match first-person presence).

#### WS2.C Loneliness helper note — `src/services/llm/reference/companion-wiki.ts`

Add a non-distortion entry:

- Cues: "lonely", "alone", "no one", "nobody", "isolated"
- Note (presence-first): "They may be feeling isolated. Do not try to fix the
  isolation or suggest people to contact — be the one who is listening right
  now. Name the loneliness gently and stay with it."
- Respects the existing `max = 2` cap; deterministic ordering with distortion
  notes (define: loneliness note counts toward the cap, insertion order =
  table order).

**Tests (failing first), `companion-wiki.test.ts`:**
- "i feel so alone lately" → loneliness note selected
- word-boundary check: "along" / "loneliness" handling consistent with the
  file's existing single-word matching rules
- message hitting 2 distortions + loneliness → only `max` notes returned,
  ordering deterministic.

#### WS2.D Widen the repeat guard's memory

`makeRepeatChecker` currently sees only the trimmed history. Change: `respond`
extracts **all** assistant turns from the full history and passes them to
`converseFromWiki` as `priorReplies` (new explicit field on its input, or an
added optional param), replacing derivation from the trimmed slice.

**Tests (failing first):**
- `conversation.test.ts`: 20-turn history; assert `converseFromWiki` receives
  prior replies including the assistant turn at index 1 (outside the trimmed
  window).
- `deep-model.test.ts`: repeat of a sentence from an old (out-of-window) reply
  is suppressed.

**Perf note:** repeat check is O(replies × sentences) string work — fine for
on-device thread lengths (<100 turns).

#### WS2.E Eval fixtures — `__tests__/services/wiki/conversation-eval.test.ts`

Extend `checkReply` with a `deflection` rule (reuses `DEFLECT_RE` exported
from deep-model or duplicated in the eval contract per that file's
conventions), and add raw-sample fixtures:

- model reply "You should talk to a friend about this." → violation
- "I hear how alone that feels." → clean
- full-pipeline fixture: history contains "i don't have anyone", mocked model
  emits a deflection sentence → final `respond` output contains none.

---

## WS3 — Hybrid ranker recalibration for EmbeddingGemma

### Problem

`src/services/wiki/search.ts` still carries bge-small-era constants:

```
SEMANTIC_BASELINE = 0.3   // "bge-small sits on a high cosine baseline"
SEMANTIC_WEIGHT   = 10
```

Score = `lex + WEIGHT * max(0, cosine − BASELINE)`; grounding floor
`MIN_RELEVANCE = 3` (conversation.ts). EmbeddingGemma's cosine distribution
runs higher/compressed (belief snap needed 0.65 → 0.78 after the swap), so an
*unrelated* page at cosine ~0.6 gets +3 and clears the floor on semantics
alone → over-grounding. Page vectors themselves are correct (migration025 +
backfill); only the fusion constants are stale. `MERGE_THRESHOLD = 0.82` in
`merge.ts` is likewise unvalidated for Gemma.

### Behavior

1. Raise `SEMANTIC_BASELINE` to Gemma's observed unrelated-pair plateau
   (working hypothesis ~0.55–0.6; **must be confirmed on device**, see step 3)
   and re-derive `SEMANTIC_WEIGHT` so a clearly-related pair
   (cosine ≈ plateau + 0.2) alone contributes ≈ MIN_RELEVANCE.
2. Update the comment to name EmbeddingGemma and the calibration date.
3. Device probe (reuse the belief-threshold-probe infrastructure /
   DevEmbedProbe): embed ~10 hand-picked page/query pairs — unrelated,
   loosely related, clearly related — log cosines, pick constants from the
   observed separation. No user text logged (fixture strings only).
4. `merge.ts` `MERGE_THRESHOLD`: measure in the same probe run; adjust only
   if the observed related-page band demands it (separate, surgical change).

**Tests (failing first), `search.test.ts`:**
- Fixture vectors with Gemma-like geometry (unrelated ≈ 0.55, related ≈ 0.8,
  built from hand-constructed unit vectors):
  - unrelated page, zero lexical overlap → hybrid score < MIN_RELEVANCE
    (must NOT ground)
  - related page, zero lexical overlap → hybrid score ≥ MIN_RELEVANCE
    (must ground — this is the whole point of the semantic channel)
  - lexical-only ranking unchanged when no embeddings supplied
- These encode the *contract*; the exact constants come from the device probe
  and the fixtures assert the contract holds under them.

**Note:** ship WS3 constants only after the device probe confirms the plateau —
unit fixtures alone are hypotheses about Gemma's geometry, not evidence.

---

## WS4 — Optional / deferred

- **WS4.1 Asymmetric task prefixes.** Gemma's card prescribes
  `task: search result | query:` for queries and `title: none | text:` for
  documents; we use STS for both. Switching invalidates ALL stored page
  vectors → requires a migration-028-style wipe + backfill AND re-running the
  WS3 calibration (the baseline shifts). Do together with a future WS3 redo or
  not at all. Belief↔belief comparison keeps the symmetric STS prefix either
  way.
- **WS4.2 Recap constraint retention.** Add one line to `SUMMARY_SYSTEM`
  (prompts/conversation.ts): keep facts the user stated about their
  circumstances (e.g. who they can or cannot talk to). Reinforces WS2.A
  through the summary path. Test: prompt-builder test asserts the line is
  present.
- **WS4.3 Embed-window truncation check.** `MAX_EMBED_CHARS = 1500` + task
  prefix vs the embed context's n_ctx 512 — one-off device check that Gemma's
  tokenizer doesn't truncate mid-page; adjust the cap if it does.
- **WS4.4 Embed timeout in respond().** `buildQueryEmbeddings` has no
  timeout; a slow embed stalls the reply. Race against ~2.5s → lexical
  fallback. Test: fake timer test where embed resolves late → respond used
  lexical ranking.

---

## Implementation order & verification gates

```
1. WS1.1–1.3  → verify: new tests fail, then pass; yarn test green; tsc clean
2. WS2.A–2.E  → verify: constraints/deflection/helper/eval suites pass;
                 existing 193 wiki tests unaffected
3. WS3        → verify: search.test.ts contract fixtures pass with probed
                 constants; device probe log reviewed before merging constants
4. WS4        → individually, only on request
```

Every step: failing test first, minimal diff, no adjacent "improvements".
No user text in any log line (codes/fixtures only).
