# Reflect Audit Remediation — SPARC Plan

## 1. Goal and assumptions

Goal: close remaining findings from `reports/reflect-features-audit.html` for Reflect features 6–11 without changing privacy boundaries or existing product behavior beyond audited defects.

Assumptions:
- Scope includes F-01 through F-06.
- On-device LLM remains only inference path for journal/chat content.
- Existing best-effort pipeline stays non-blocking for entry saves.
- Existing UI flows remain intact unless a stale/error state must be surfaced.
- `Result<T, E>` and current storage/sync patterns remain authoritative.
- Implementation must preserve raw provenance and encrypted local storage.

Success criteria:
- Explicit declarative/self-relevant extraction gate prevents pure informational questions from capture.
- No back-to-back question output survives non-stream or stream fallback paths.
- Summary distress state is tied to current conversation and summary revision, and clears correctly.
- First-mention capture is durable/idempotent across partial failure, or its accepted semantics are made explicit and tested.
- Recurrence/capture behavior has defined cross-device semantics.
- Cross-conversation seed is bounded and either relevance-aware or explicitly bounded broad continuity.
- Focused tests, full tests, and TypeScript pass.

## 2. SPARC execution

### [SPEC] Exact behavior

#### F-01 — Declarative/self-relevant capture gate
- Extend validated extraction output with a required decision such as `isSelfRelevant: boolean`.
- Extraction must classify statements about the user's own experience, thoughts, feelings, behavior, or situation as self-relevant.
- Pure informational/advice questions must be false, even when they contain a recognized topic.
- A self-disclosure ending with `?` may be true; punctuation must not decide capture.
- Capture requires valid extraction, self-relevance, a usable topic, and existing recurrence rules.
- Invalid/missing decision fails closed: no recurrence increment and no wiki capture.
- Preserve original message in `raw_text`; use distilled restatement for `situation`.

#### F-02 — Strict question cadence
- If previous assistant reply ends in a question, final new reply must not end in a question.
- Applies to normal generation, novelty retry, cleanup, and streaming release.
- If cleaned output is question-only, use a safe non-question fallback or retry; never return banned original question.
- If no prior assistant question exists, current behavior remains unchanged.
- No visible streamed text may include removed question content.

#### F-03/F-04 — Capture durability and recurrence semantics
- Choose account-level recurrence semantics only if compatible with encrypted sync; otherwise document and test conservative device-local semantics.
- Preferred implementation: durable capture record/idempotency key for parked first mention, current mention, and completion state.
- Re-running after process death must not duplicate parked entries.
- Current message must not be marked complete before successful persistence/indexing.
- Setting/capture state transitions must be atomic where storage supports it.
- Preserve 90-day expiry and successful-clear behavior.

#### F-05 — Summary distress ownership
- Attach conversation ID and summary revision/count to every async score request.
- Apply result only if conversation and revision are still current.
- Successful low score clears prior positive tier.
- Opening/changing conversation clears or replaces stale summary distress state.
- Failed/stale scores do not mutate current state.
- Keep soft resource-strip behavior; never interrupt conversation.

#### F-06 — Cross-conversation continuity
- Keep up to three prior summaries, but enforce a combined character/token budget.
- Prefer recent summaries as current behavior; deterministic ordering required.
- If topical relevance is added, use existing local wiki/search utilities only and retain recency fallback.
- Never expose unrelated context beyond the bounded seed.
- New thread starts with `summaryCount = 0`.

### [PSEUDO] Proposed control flow

```text
extract(message)
  if extraction invalid: return no-capture
  if extraction.isSelfRelevant != true: return no-capture
  if topic absent/none: return no-capture
  apply recurrence gate
  if gate not passed: park first mention durably; return
  load parked capture by idempotency key
  persist parked capture exactly once
  persist current capture exactly once
  mark capture complete / clear parked state transactionally
  enqueue wiki and graph work best-effort
```

```text
respond(input)
  previousQuestion = previous assistant output ends with '?'
  generate on-device response
  clean repeat/deflection/scaffolding
  if previousQuestion and cleaned output ends with '?':
    retry once or return safe reflective non-question fallback
  stream only text accepted by cadence guard
  persist final response
```

```text
refreshSummary(conversationId, summaryRevision)
  persist summary
  score summary asynchronously
  if score result failed: no state mutation
  if current conversation/revision mismatch: discard result
  set summary crisis tier to returned tier, including 0
```

```text
loadNewThreadContext(message)
  fetch candidate summaries
  order deterministically by recency/relevance
  trim to total budget without splitting unsafe content unexpectedly
  return at most three bounded summaries
```

### [ARCH] Module boundaries and dependencies

- Extraction schema/prompt: `src/services/llm/schemas/entry-extract.schema.ts`, extraction prompt module, `src/services/llm/deep-model.ts`.
- Capture orchestration: `src/services/pipeline.ts`; use existing encrypted entry/settings storage and sync serialization.
- Capture durability: add narrow storage module/table only if existing settings cannot express idempotent state; do not place state machine in React hooks.
- Conversation generation/guards: `src/services/llm/deep-model.ts` and existing conversation service cleanup/stream boundary.
- Summary ownership: `src/hooks/useConversation.ts` plus chat store actions; keep model scoring service-only.
- Continuity: `src/hooks/useConversation.ts` and existing summary storage/query helpers.
- Tests: focused suites under `__tests__/services`, `__tests__/hooks`, and `__tests__/app` as appropriate.
- No network API changes. No raw text logging.

### [TDD] Failing tests first

1. **F-01 extraction tests**
   - schema rejects missing/invalid decision;
   - self-disclosure ending in `?` captures;
   - pure informational question with topic does not capture;
   - terse declaration without question mark captures;
   - missing/`none` topic still fails closed.
2. **F-02 guard tests**
   - one-sentence question after prior question becomes safe non-question;
   - novelty-retry path applies same rule;
   - streaming path never releases banned question-only output;
   - existing trailing-question and clean multi-sentence cases remain green.
3. **F-03/F-04 capture tests**
   - process-retry/idempotency does not duplicate parked entry;
   - failure before completion leaves durable retry state;
   - current mention is retained after current-write failure;
   - successful completion clears state once;
   - expiry remains enforced;
   - explicit cross-device semantics test using separate device state or sync fixture.
4. **F-05 hook/store tests**
   - delayed old-thread score cannot update new thread;
   - delayed old-summary revision cannot overwrite newer score;
   - successful tier 0 clears tier 1/2;
   - changing conversation clears stale strip;
   - failed score leaves current state unchanged.
5. **F-06 continuity tests**
   - no more than three summaries;
   - combined context stays under configured budget;
   - deterministic ordering and truncation;
   - new thread summary count is zero;
   - relevance fallback, if implemented, remains local and bounded.

### [IMPL] Smallest implementation sequence

1. Add extraction decision to type/schema/prompt and wire fail-closed gate in pipeline.
2. Refactor question cleanup into one pure helper used by normal, retry, and stream paths; add safe fallback.
3. Resolve F-03/F-04 design from existing storage capabilities. Prefer durable idempotent capture state; add migration only if required. Keep transaction boundaries narrow.
4. Add summary request revision/current-thread guards and explicit zero-tier clearing.
5. Add continuity budget using existing summary selection; avoid speculative retrieval changes unless tests show broad context violates budget/quality.
6. Update only relevant comments/docs to state accepted recurrence semantics and capture guarantees.

### [REFINE] Safety and quality pass

- Run formatter/linter checks on changed files.
- Confirm no `any`, relative service imports, raw user-text logs, or network payload changes.
- Confirm failed extraction never blocks save.
- Review migrations and rollback/startup behavior.
- Test app blur/focus, route change, and model unavailable behavior.
- Device-check Reflect generation, streaming, app restart during capture, and stale summary strip.

## 3. Verification plan

- Focused tests for each finding, then `yarn test`.
- `yarn tsc --noEmit`.
- Inspect `git diff --check` and changed-file list.
- Static privacy review: search fetch/authenticated network payload construction; verify no raw entry/chat text added.
- Device verification on iOS and Android where native model/streaming behavior matters:
  - self-disclosure and pure question capture;
  - one-question cadence after prior question;
  - leave/reopen Reflect during generation;
  - kill app during parked capture and retry;
  - switch conversation while summary crisis score is delayed;
  - long prior-summary set respects context budget.
- Record pass/fail evidence and residual risks in final report.

## 4. Risks and decisions

- Durable capture state may require migration and sync treatment. Reuse existing encrypted local DB and sync schema; never sync plaintext.
- Account-wide recurrence improves cross-device behavior but adds encrypted event reconciliation complexity. If not required, retain device-local behavior and document it rather than inventing partial sync semantics.
- Safe non-question fallback must remain reflective, non-diagnostic, and not advice-giving.
- Broad continuity may be intentional product behavior; budget enforcement is minimum safe fix. Topical retrieval is rejected as unnecessary unless product evaluation shows noise.
- No changes to wiki structural audit remediation are included; this plan targets only Reflect Features 6–11 findings.

## 5. Rejected alternatives

- Do not restore trailing-question regex as F-01 solution; punctuation cannot determine self-relevance.
- Do not silently drop all question-mark messages; valid self-disclosures can be phrased as questions.
- Do not solve stale summary state by global timeout alone; ownership must include conversation/revision.
- Do not send capture counters or plaintext content to server.
- Do not add cloud LLM fallback for user-authored Reflect content.

## Execution update — 2026-07-25

Implemented in current pass:
- F-01 explicit `is_self_relevant` extraction field, prompt guidance, normalized model output, and fail-closed Reflect capture gate.
- F-02 question-only fallback after a previous question; existing cleanup and retry path remain covered.
- F-05 summary score ownership checks against conversation and summary/count snapshot; successful low score clears tier.
- F-06 bounded prior-summary seed at 2,400 characters; existing three-summary recency selection retained.
- Added focused regression tests for pure informational questions and question-only replies.

Verification:
- `yarn tsc --noEmit` passed.
- Focused Reflect/deep-model/pipeline tests passed.
- Full suite passed: 158 suites, 1,494 tests.
- `git diff --check` passed.

Not completed in this pass:
- F-03 cross-device recurrence semantics remain device-local and unsynced, as documented in existing code. Account-level recurrence was not added because syncing settings/events would require a larger conflict model and could alter conservative privacy semantics.
- F-04 Reflect capture queue is now persisted in encrypted local settings, restored on flush/startup, and retains failed items for retry. Gate-passing messages also use encrypted local SHA-256 idempotency markers to prevent duplicate entry creation. Failed queue items are skipped for later items in the same drain and retried later.
- F-05 now includes an explicit in-memory summary revision guard in addition to conversation and summary/count checks.
- Native iOS/Android device verification was not run in this environment.

Residual risk: F-03/F-04 require storage/sync design and migration work beyond small scoped changes. F-05 uses conversation plus summary/count snapshot guards, not a persisted revision identifier.
