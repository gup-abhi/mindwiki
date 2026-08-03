# Factual Personal Knowledge — Architecture Research

> **Status:** Research proposal for review. No implementation approved or started.
>
> **Purpose:** Extend MindWiki from a knowledge base focused mainly on thoughts, emotions, beliefs, and patterns into one that can also retain user-stated personal facts safely and accurately.

---

## Executive summary

MindWiki already extracts people, places, activities, themes, beliefs, and behaviours from journal entries. These signals currently become graph labels and synthesized wiki pages. This is effective for reflective knowledge, but insufficient for factual personal knowledge.

Personal memory needs two structured forms that current wiki pages and graph edges do not provide:

- **situations:** bounded occurrences that bind actions or states with participants, roles, time, place, actuality, attribution, and source;
- **claims:** durable user-stated propositions with provenance, temporal validity, correction, supersession, contradiction handling, and safe retrieval rules.

A claim such as “Sarah is my sister” can stand alone. A situation such as “Sarah criticized my report during Tuesday's meeting, then James helped me revise it” loses meaning if flattened into unrelated triples.

**Recommendation:** add a provenance-first **episodic situation layer and semantic claim layer** beside the existing wiki.

- Immutable entries and eligible user-authored Reflect messages remain lossless source evidence.
- New situation records preserve what happened, with whom, where, when, and under which perspective.
- New claim records preserve durable user-stated details and their current/historical lifecycle.
- Situation and claim lifecycle changes use append-only records, not mutable last-write-wins state; current sync cannot safely propagate record deletion or resolve equal-timestamp edits.
- Wiki pages remain synthesized, evolving narrative interpretations rather than factual source of truth.
- Existing co-occurrence graph remains separate; factual/event relationships are derived views only.
- Raw sources and structured memory remain on-device and sync only as encrypted records through existing zero-knowledge sync.

This preserves MindWiki’s core LLM Wiki architecture while adding structured episodic and semantic memory without letting model-generated prose silently become truth.

---

## 1. Problem definition

MindWiki’s product concept is a compounding personal knowledge base. Current implementation has concentrated on reflective knowledge:

- emotions;
- cognitive distortions;
- recurring beliefs;
- behavioural patterns;
- themes;
- relationships between recurring concepts.

Personal knowledge also includes explicit facts:

- “Sarah is my sister.”
- “I work at Acme.”
- “I moved to Berlin in 2024.”
- “Swimming is my preferred workout.”
- “I left Acme in June.”

These facts should be remembered, searchable, correctable, temporally accurate, and available as grounding for Reflect. They should not be blended into evolving AI prose without traceable evidence.

### Terminology

This document uses **claim** rather than **fact** for stored propositions, and **situation** for a structured occurrence or state described by the user.

A claim means:

> A proposition the user explicitly stated, retained with source and projected lifecycle status.

A situation means:

> A source-linked model interpretation that binds an event or state to participants, event-bounded roles, time, place, actuality, and explicit relations to other situations.

Neither implies external verification or complete representation. App can reliably say “You previously wrote…” or “Based on your journal…”. It should not claim objective certainty.

---

## 2. Current architecture

### 2.1 Existing ingestion pipeline

Current entry pipeline is centered in `src/services/pipeline.ts`:

```text
Journal / Guided Path / eligible Reflect capture
  → save immutable entry immediately
  → fast-model crisis assessment
  → deep-model structured extraction
  → persist tags and entities
  → update derived graph
  → synthesize/update wiki pages
  → enqueue encrypted sync records
```

Relevant boundaries:

- `src/services/llm/prompts/extract-entry.ts`
- `src/services/llm/schemas/entry-extract.schema.ts`
- `src/services/llm/deep-model.ts`
- `src/services/pipeline.ts`
- `src/services/storage/entries.ts`
- `src/services/storage/entities.ts`
- `src/services/wiki/engine.ts`
- `src/services/graph/engine.ts`

Deep extraction currently produces:

- emotion;
- distortion and confidence;
- mood score;
- one or two topics;
- people;
- places;
- activities;
- beliefs;
- behaviours;
- Reflect-only self-relevance and restatement fields.

### 2.2 What current system already captures

Current entities provide useful factual ingredients:

```text
person: Sarah
place: Berlin
activity: Swimming
```

Current topics provide domains:

```text
Work
Marriage
Job hunting
```

These are labels, not assertions. They cannot encode:

```text
Sarah — sibling of → user
user — works at → Acme
user — lived in → Berlin during 2024
user — prefers → swimming
```

### 2.3 Existing wiki semantics

`src/services/wiki/engine.ts` and `src/services/llm/prompts/update-page.ts` maintain mutable, versioned wiki pages.

Each update:

1. reads existing page prose;
2. supplies new reflection evidence;
3. asks on-device deep model to rewrite one consolidated page;
4. saves old content in version history;
5. periodically re-grounds from source entries to limit drift.

This is correct for patterns and evolving interpretations. It is intentionally a synthesis, not an append-only evidence store.

### 2.4 Existing graph semantics

`src/services/graph/engine.ts` derives nodes and additive co-occurrence edges from entries.

Current graph properties:

- node identity: `type + label`;
- edge meaning: concepts appeared together;
- edge direction: none;
- edge predicate: none;
- edges: additive-only;
- graph: rebuilt locally from synced source data;
- recurrence threshold: two entries before materialization.

This graph answers “what tends to appear together?” It cannot safely answer “what relationship is true?”

### 2.5 Existing sync semantics

Relevant code:

- `src/services/sync/conflict.ts`
- `src/services/sync/engine.ts`
- `server/src/storage/upload.ts`
- `server/src/storage/delta.ts`

Findings:

- Client has explicit synced-table allowlists and column maps.
- Records are encrypted individually before upload.
- Server stores opaque ciphertext under account/table/record keys.
- Server does not need record schema knowledge.
- Mutable client records use `updated_at` last-write-wins.
- Synced entries are not re-synthesized independently on every device; origin-generated wiki records sync separately.
- Graph remains device-local and is rebuilt after pulls.

New claim tables would require client sync registration, but no plaintext-aware server feature.

---

## 3. Why current structures are insufficient

### 3.1 Wiki prose cannot be factual source of truth

A synthesized page can:

- paraphrase a fact;
- omit it during later consolidation;
- weaken or strengthen wording;
- merge it with interpretation;
- accidentally mutate details;
- make correction require rewriting unrelated prose.

Example:

```text
Source entry: “Sarah is my sister and lives in Paris.”
Later page: “Sarah is a close family relationship who may be geographically distant.”
```

Page may remain emotionally useful, but it no longer preserves two atomic claims.

### 3.2 Entity labels lack relation semantics

`person: Sarah` does not encode whether Sarah is:

- sister;
- friend;
- manager;
- doctor;
- former partner;
- hypothetical person.

### 3.3 Additive graph edges cannot retract facts

If factual relationships were inserted into current graph, correcting “works at Acme” to “left Acme” would conflict with additive-only behavior. Current graph is designed to accumulate co-occurrence, not represent mutable world state.

### 3.4 Whole-page correction is too coarse

Current wiki correction lets user rewrite an entire page. Structured memory needs precise correction actions:

- update;
- mark not current;
- reject wrong extraction;
- split or merge situation grouping;
- supersede;
- inspect source;
- inspect previous value.

### 3.5 Recurrence is wrong reliability mechanism for explicit facts

Current recurrence threshold protects permanent graph concepts from one noisy extraction. A directly stated claim may be important after one mention. Explicitness, extraction confidence, provenance, and correction controls are better safeguards than repeated mention; mandatory confirmation is unnecessary for high-confidence allowed claims.

### 3.6 Source entries are not structured episodic memory

An entry is lossless evidence, but one entry may describe multiple occurrences, background states, quoted reports, imagined outcomes, and reflections. Treating whole entry as one episode makes contextual retrieval imprecise. Flattening every sentence into independent claims destroys event boundaries, participant roles, sequence, and attribution.

Example:

```text
“Sarah criticized my report during Tuesday's meeting.
James helped me revise it afterward, which calmed me down.”
```

This contains at least three linked situations: criticism, assistance, and emotional response. The useful memory is not merely `Sarah`, `James`, `report`, and `calm`; it is who did what, in which role, when, and how situations relate. Structured situation records are therefore required beside atomic claims.

---

## 4. Knowledge classification

Fact extraction must distinguish assertions from interpretations and intentions.

| User statement | Classification | Destination |
|---|---|---|
| “I work at Acme.” | Explicit personal claim | Claim layer |
| “Sarah is my sister.” | Explicit relationship claim | Claim layer |
| “I moved to Berlin in 2024.” | Occurred transition plus durable residence history | Situation layer + claim layer |
| “Coffee is my favourite drink.” | Preference claim | Claim layer |
| “Sarah criticized my report during Tuesday's meeting.” | Bounded occurrence with participant roles | Situation layer |
| “James helped afterward, which calmed me down.” | Linked assistance and emotional-response situations | Situation layer + reflection pipeline |
| “I feel anxious at work.” | Ongoing emotional state/evidence | Situation layer + reflection pipeline |
| “Sarah never respects me.” | Interpretation/generalization | Existing thought/wiki pipeline |
| “I want to move to Berlin.” | Intention or plan, not current residence | Situation layer only when explicit plan capture is enabled |
| “I might leave Acme.” | Possible future situation, not current fact | Situation layer only; never active employment change |
| “I am worthless.” | Belief | Existing belief pipeline |
| “My doctor diagnosed asthma.” | User-reported sensitive fact | Defer from automatic v1 capture |

Core rule:

> Extract only what user explicitly states. Do not promote implications, beliefs, plans, predictions, or model conclusions into claims.

---

## 5. Recommended architecture

```text
Journal / Guided Path / eligible user Reflect message
          │
          ▼
On-device extraction
  ├── reflective signals
  │     └── existing wiki + co-occurrence graph
  │
  ├── situation mentions
  │     └── event/state frames + participants + roles + time/place + relations
  │
  └── explicit durable claims
        └── provenance-first claim/event store
                    │
                    ▼
          Composed knowledge views
          ├── recalled situations
          ├── current and historical user-stated claims
          ├── synthesized narrative insight
          ├── source evidence
          └── correction/history
```

### Architectural invariants

1. Existing wiki remains compounding synthesized narrative interpretation.
2. Source records remain lossless authority for what user authored.
3. Situations preserve occurrence boundaries and context; claims preserve durable propositions.
4. Both remain source-linked model interpretations, not objective truth or complete replicas of source meaning.
5. Corrections preserve history and never silently erase prior state.
6. No routine user confirmation is required; user correction outranks model extraction.
7. Current co-occurrence graph stores neither canonical factual edges nor canonical situations.
8. Structured memory never leaves device as plaintext.
9. LLM failure never blocks entry save.
10. Existing reflection quality must not regress to add structured extraction.

---

## 6. Conceptual data model

Exact SQL is intentionally deferred until architecture review.

### 6.1 `memory_situations` — immutable source-scoped situation assertion

```text
id
situation_type
actuality
valid_time
location_entity_id
extraction_confidence
origin
extractor_version
created_at
```

`actuality` must distinguish at least `occurred`, `ongoing`, `planned`, `possible`, `hypothetical`, `reported`, and `imagined`. Situation type comes from a small registry, not arbitrary model vocabulary.

### 6.2 `memory_situation_mentions` — immutable source attachment

```text
id
situation_id
source_type
source_id
source_field
start_offset
end_offset
created_at
```

One source may contain several situations. One situation may later accumulate several mentions without discarding source-scoped identities.

### 6.3 `memory_situation_participants` — event-bounded roles

```text
id
situation_id
entity_id
role
attribution
created_at
```

Role belongs to entity within this situation. It must not silently become permanent entity type or relationship.

### 6.4 `memory_situation_relations` — explicit inter-situation structure

```text
id
from_situation_id
to_situation_id
relation
basis
created_at
```

Initial relations should remain narrow: `before`, `after`, `during`, `part_of`, `responded_to`, and `explicitly_caused_by`. `basis` distinguishes user-stated relation from conservative derived ordering. LLM-inferred causality is not canonical.

### 6.5 `memory_situation_claims` — bridge between episode and semantic state

```text
id
situation_id
claim_id
relation
created_at
```

This records where a durable claim was asserted, changed, or applied without flattening whole situation into claim triples.

### 6.6 `knowledge_claims` — immutable assertion

```text
id
subject_type
subject_label
predicate
object_type
object_value
temporal_value
extraction_confidence
origin
extractor_version
created_at
```

Suggested semantics:

| Field | Meaning |
|---|---|
| `id` | Opaque immutable record identity |
| `subject_type` | `self`, `person`, `organization`, `place`, `activity` |
| `subject_label` | `self` or source-scoped display label; not graph-node identity |
| `predicate` | Controlled predicate from registry |
| `object_type` | `text`, `entity`, `date`, `number`, `boolean` |
| `object_value` | Normalized typed value |
| `temporal_value` | Precision-preserving temporal object; see §22.4 |
| `extraction_confidence` | Confidence that model extracted statement correctly |
| `origin` | `extracted` or `manual` |
| `extractor_version` | Version of extraction contract that created assertion |
| `created_at` | Local record creation time |

Claim assertion is never overwritten for lifecycle change. `extraction_confidence` measures extraction quality, not truth or confirmation.

### 6.7 `knowledge_claim_evidence` — immutable source attachment

```text
id
claim_id
source_type
source_id
stance
created_at
```

Suggested semantics:

| Field | Meaning |
|---|---|
| `claim_id` | Parent immutable assertion |
| `source_type` | `entry`, `chat_message`, `manual` |
| `source_id` | Existing source record ID |
| `stance` | `supports` or `contradicts` |

Evidence rows reference existing encrypted content instead of duplicating evidence text. Repeated support adds an evidence row; it does not rewrite claim.

### 6.8 Extraction state

Current `tagged_at`, `wiki_indexed_at`, and `graph_indexed_at` markers have different responsibilities. Structured memory extraction needs dedicated versioned markers, conceptually:

```text
entries.situations_extracted_version
entries.knowledge_extracted_version
```

They may share one completion while retaining separate schema/version boundaries.

Requirements:

- set only after situation, claim, and provenance transaction commits;
- synced with entry metadata;
- missing/older value remains eligible for retry or deliberate backfill;
- extractor-version bump enables migration to improved extraction rules;
- catch-up remains restart-safe and best-effort.

### 6.9 Identity and deduplication

Claim identity needs two levels:

1. opaque record ID for storage and encrypted sync;
2. local canonical key for detecting equivalent claims.

Canonical comparison may normalize:

```text
subject + predicate + typed object + temporal scope
```

Situation identity is stricter. V1 situations remain source-scoped by default. Similar participants, type, place, and time may nominate `possibly_same_as`, but automatic cross-source merge is prohibited until event-coreference precision is measured. A user-directed grouping event may merge views while preserving every original situation and mention.

Do not expose unhashed canonical content as server record ID. Predictable record IDs could leak information through dictionary guessing even when payload is encrypted. If deterministic cross-device IDs become necessary, derive them using keyed HMAC under master key.

---

## 7. Initial structured-memory registries

Avoid arbitrary predicates, full FrameNet, or universal event ontology in v1. Small on-device model needs constrained choices, optional fields, and strict validation.

### 7.1 Situation registry

Candidate v1 situation types:

- `social_interaction`;
- `work_interaction`;
- `conflict`;
- `support_received`;
- `decision`;
- `achievement`;
- `setback`;
- `transition`;
- `plan`;
- `routine_activity`;
- `emotional_response`.

Candidate roles remain generic where possible: `actor`, `other_participant`, `speaker`, `listener`, `helper`, `recipient`, `affected_person`. Candidate relations: `before`, `after`, `during`, `part_of`, `responded_to`, `explicitly_caused_by`. Missing role, time, place, or relation is valid; model must abstain instead of filling slots.

V1 scope limits:

- source-scoped situations; no automatic global event merge;
- no inferred causality;
- no permanent relationship inferred from event role;
- no current fact inferred from event location;
- no occurrence inferred from planned, possible, hypothetical, reported, dreamed, or imagined scene;
- no attempt to encode every detail from source;
- exact source remains fallback for anything frame omits.

### 7.2 Claim predicate registry

Recommended initial domains:

| Domain | Candidate predicates |
|---|---|
| Relationships | `related_to`, `partner_of`, `parent_of`, `sibling_of` |
| Employment | `works_at`, `role_at`, `previously_worked_at` |
| Education | `studies_at`, `studied_at` |
| Residence | `lives_in`, `previously_lived_in` |
| Preferences | `likes`, `dislikes`, `prefers`, `avoids` |
| Routines | `regularly_does` |
| Possessions/pets | `owns`, `has_pet` |
| Milestones | `moved_to`, `started_at`, `left_at` |

Predicate metadata should define:

- valid subject types;
- valid object types;
- display wording;
- whether multiple simultaneous values are normal;
- whether predicate is temporal;
- potential inverse predicate;
- contradiction policy.

### Deferred domains

Defer from automatic v1 extraction:

- medical conditions;
- medications;
- legal status;
- financial data;
- diagnoses;
- claims about third parties that could be highly sensitive.

MindWiki must never infer diagnosis or treatment claims.

---

## 8. Extraction design

### 8.1 Proposed output shape

Illustrative only:

```json
{
  "situations": [
    {
      "local_id": "s1",
      "type": "work_interaction",
      "actuality": "occurred",
      "participants": [
        { "entity": "Sarah", "role": "critic" },
        { "entity": "self", "role": "recipient" }
      ],
      "time": { "kind": "relative", "value": "Tuesday" },
      "location": null,
      "relations": [],
      "confidence": 0.93
    }
  ],
  "claims": [
    {
      "subject_type": "self",
      "subject": "self",
      "predicate": "works_at",
      "object_type": "entity",
      "object": "Acme",
      "temporal": { "kind": "none" },
      "confidence": 0.97
    }
  ]
}
```

One completion may produce both arrays, but situation-frame and claim-promotion evaluation remain separate.

### 8.2 Prompt rules

Structured extractor should be instructed to:

- output only strict JSON;
- segment multiple occurrences instead of treating whole entry as one episode;
- bind participants to situation-specific roles;
- use only registered situation types, roles, relations, and claim predicates;
- preserve occurred, ongoing, planned, possible, hypothetical, reported, and imagined actuality;
- preserve negation, attribution, and temporal qualifiers;
- never infer dates or causal links;
- distinguish current state, past state, and future intention;
- promote only explicit durable propositions into claims;
- keep one-time event context inside situations;
- return no situation or claim when uncertain;
- cap structured records per source;
- avoid interpreting emotional judgments as facts;
- avoid converting beliefs into facts;
- preserve relative/ambiguous time until civil-time resolution is safe;
- never use assistant text or generated wiki prose as user evidence.

All output remains on-device and Zod-validated. Malformed claims are dropped individually where safe; extraction failure never affects entry persistence.

### 8.3 Combined vs separate completion

#### Option A — extend current entry extraction

Add tolerant `claims: []` to existing extraction schema.

**Advantages**

- no second deep-model completion;
- lower battery use;
- lower total indexing latency;
- reuses current pipeline and catch-up.

**Risks**

- current prompt already requests many fields;
- added complexity may reduce topic/entity/emotion quality;
- fact extraction failures become harder to isolate;
- extractor versioning becomes coupled to existing knowledge signals.

#### Option B — dedicated claim extractor

Run separate background completion after entry save.

**Advantages**

- focused prompt;
- independent schema and versioning;
- easier evaluation;
- current extraction behavior remains stable;
- fact precision can evolve independently.

**Costs**

- another deep-model inference;
- higher battery and thermal cost;
- more background queue pressure;
- longer time before claims appear.

### Recommendation

Keep situation extraction and claim promotion as separate architectural contracts. They may share a completion. During shadow evaluation, compare:

1. combined extraction;
2. dedicated extraction;
3. current extraction baseline.

Use combined extraction only if factual precision is acceptable and existing tag/entity quality shows no meaningful regression. For personal facts, precision is more important than recall.

---

## 9. Situation and claim lifecycle

### 9.1 Extraction

```text
Entry saved
  → claim extraction runs in background
  → output normalized and validated
  → claims + sources + extraction marker commit atomically
  → sync records enqueued
```

### 9.2 Initial projected state — agreed direction

Journal entry is authoritative evidence of **what user wrote**. Claim is model interpretation of that evidence; it is not assertion of objective external truth.

Auto-store high-confidence, allowed, explicit autobiographical assertions locally. They are eligible for factual retrieval without mandatory user confirmation. Auto-store eligible situation frames with their actuality and provenance. Present both as “You wrote…” or “Based on your journal…”, never as independently verified fact or complete record.

Projected claim status begins as **user-stated**. This state is distinct from extraction confidence:

- extraction confidence asks whether model faithfully preserved assertion, event boundaries, roles, negation, attribution, scope, and time;
- `user-stated` means source is user's own text;
- user correction is authoritative over model interpretation;
- objective truth remains outside product claim.

Rejection, retraction, correction, split, merge, and supersession change projection by adding immutable events, never by overwriting assertions.

### 9.3 Correction and conflict resolution, not confirmation

No fact-confirmation inbox. Review appears only when user opens memory controls, corrects model interpretation, or a genuine unresolved conflict affects retrieval.

Potential correction UI:

```text
Based on your journal · Jul 4

You work at Acme.
[Update] [Not current] [Wrong extraction] [View source]
```

Actions append immutable lifecycle events:

- **Update:** create replacement assertion, then append `supersede` event naming both claims.
- **Not current:** close temporal validity or append retraction according to predicate policy.
- **Wrong extraction:** append `reject` event.
- **Situation split/merge:** append explicit grouping event while preserving original mentions.
- **Remove from current memory:** append `retract` event under precise user-facing policy.

Current status is deterministic projection. No prior assertion, situation, evidence, or user action is overwritten.

### 9.4 Repeated evidence

When later source supports equivalent claim:

- reuse canonical active claim;
- add source link;
- do not create duplicate visible claim;
- preserve all provenance;
- optionally surface source count.

### 9.5 Correction and supersession

Correction should preserve history.

Example:

```text
Old: user works_at Acme
New: user left_at Acme in June
```

Result:

- old assertion remains immutable;
- new assertion records new statement and precision-preserving temporal value;
- `supersede` event links replacement and prior assertion;
- current retrieval uses projected active state;
- history can still explain prior context.

### 9.6 Contradiction

Example:

```text
Claim A: user lives_in Berlin
Claim B: user lives_in London
```

System must not assume contradiction solely from predicate match. Multiple residences may be valid.

Resolution rules:

1. If source explicitly states transition, close old validity and activate new claim.
2. If temporal scopes do not overlap, keep both.
3. If predicate permits multiple values, keep both.
4. If genuinely incompatible and ambiguous, mark conflict.
5. Never silently choose latest solely by timestamp.
6. Conflicted claims should be omitted from definitive grounding or explicitly described as unresolved.

---

## 10. Integration with wiki pages

### 10.1 Keep two representations

```text
Wiki page content
  = synthesized narrative interpretation

Claim section
  = deterministic rendering of active structured claims
```

Do not inject claim text into model-owned page content as canonical storage.

### 10.2 Composed page example

```text
Sarah
─────
Narrative insight
  Existing synthesized wiki prose about this relationship.

What you have said
  • Sarah is your sister.
  • Sarah lives in Paris.
  • You usually speak on weekends.

Sources
  Journal · Jul 4
  Journal · Aug 12
```

Claims can enrich existing person, place, activity, and theme pages without changing core wiki synthesis contract.

### 10.3 Single-mention facts

An explicit high-confidence claim should not require current two-entry recurrence threshold. That threshold protects permanent inferred graph concepts. Explicitness, provenance, extraction precision, and correction controls provide more appropriate safeguards.

---

## 11. Retrieval and Reflect grounding

Current retrieval ranks only wiki pages:

- `src/services/wiki/search.ts`
- `src/services/wiki/conversation.ts`

Current citation chips open wiki pages:

- `src/components/wiki/SourceChips.tsx`

Future retrieval should support a source union conceptually:

```typescript
type KnowledgeSource =
  | { kind: 'page'; pageId: string; title: string }
  | { kind: 'situation'; situationId: string; label: string }
  | { kind: 'claim'; claimId: string; label: string }
```

### 11.1 Prompt separation

Facts and interpretations must enter model context under different headings:

```text
RELEVANT SITUATIONS
- On July 4, you wrote that Sarah criticized your report during a meeting.
- You wrote that James helped revise it afterward and that you felt calmer.

USER-STATED CLAIMS
- You wrote that you work at Acme.
- You wrote on July 4 that Sarah is your sister.

SYNTHESIZED PATTERNS
- Work: You tend to anticipate criticism before reviews...
```

Model should never receive situations, durable claims, and synthesized patterns as undifferentiated “known facts.”

### 11.2 Grounding policy

| Memory type/status | Retrieval behavior |
|---|---|
| User-stated + active claim | Use with provenance wording: “you previously wrote…” |
| Occurred/ongoing situation | Use for contextual or event questions with source and time |
| Planned/possible/hypothetical/reported/imagined situation | Preserve actuality label; never state as occurred fact |
| Rejected | Never ground |
| Superseded | Exclude from current state; include only for explicit history queries |
| Historical | Include validity period |
| Conflicted | Omit from definitive answer or expose conflict explicitly |

### 11.3 Ranking

Initial retrieval routes by question type:

- durable/current-state question → projected claims;
- “what happened/when/who was involved?” → situations and participants;
- pattern/meaning question → wiki plus bounded supporting situations;
- source wording question → immutable entry/message.

Ranking can use subject/entity match, object/place match, predicate or situation-type aliases, participant roles, temporal fit, source recency, evidence support, actuality, and active-state filters.

Embeddings can be added later as device-local derived caches, matching current `page_embeddings` architecture. They are not needed to validate core claim model.

### 11.4 Citation UX

Claim source chips should open:

1. claim detail;
2. source entry or message when available;
3. relevant wiki page as secondary context.

This is stronger provenance than current page-only citation.

---

## 12. Graph strategy

Do not insert factual relationships into current co-occurrence edges.

Current edge:

```text
Work — Anxiety
meaning: concepts co-occurred
```

Factual edge:

```text
Sarah — sibling_of → user
meaning: user-stated relationship
```

These have incompatible semantics.

Recommended progression:

1. Keep current Connections map unchanged initially.
2. Derive factual relationship edges from active claims at read time if later needed.
3. Render factual edges as directed and labeled.
4. Visually distinguish them from co-occurrence edges.
5. Never persist them as additive graph edges.
6. Superseding/retracting claim automatically removes derived factual relationship from current view.

---

## 13. Sync and convergence

### 13.1 Existing fit

Claim records fit current zero-knowledge sync:

- SQLCipher protects local storage.
- Per-record AES-GCM protects synced payloads.
- Server stores opaque ciphertext.
- Server does not need claim schema.
- New client tables join existing synced table list and column map.

### 13.2 Table order

Parent assertions must be applied before evidence and lifecycle events:

```text
memory_situations
memory_situation_mentions
memory_situation_participants
memory_situation_relations
knowledge_claims
knowledge_claim_evidence
memory_situation_claims
knowledge_claim_events
```

### 13.3 Conflict policy

Current last-write-wins transport is unsuitable for claim truth/status because equal-timestamp cross-device writes can lose one user action. Use immutable UUID records only:

- situation assertions, mentions, participants, claims, evidence, and lifecycle events are append-only;
- corrections create replacement assertions plus `supersede` event;
- rejection, retraction, split, merge, and resolution are events, never in-place status writes;
- equivalent concurrent assertions may group through local canonical comparison, but source-scoped identities remain intact;
- incompatible concurrent events project as `conflicted` until a later explicit resolution event;
- normal correction/rejection needs no remote delete protocol.

Exact projection and race rules remain a blocker in §22.8. This model aligns with current opaque encrypted-record transport and avoids silent LWW history loss.

### 13.4 Origin-device extraction

Current sync architecture expects origin device to generate derived wiki records; receiving devices do not repeat completed synthesis for synced tagged entries. Claims should follow same rule:

- origin extracts and syncs claims;
- receiving device applies claims directly;
- receiving device extracts only if entry’s claim-extraction version is absent or explicitly stale;
- retries must be idempotent.

---

## 14. Privacy and safety analysis

Structured claims may be more sensitive than synthesized pages because they are compact, searchable, and explicit.

Required controls:

- on-device extraction only;
- SQLCipher at rest;
- encrypted per-record sync only;
- no raw claim content in logs;
- no subject/object text in analytics;
- no claim content in crash reporters;
- no claim-derived lock-screen notification copy;
- no cloud classification;
- no medical/legal/financial inference;
- no claim created from wiki prose alone;
- user can inspect source;
- user can reject and remove claim from active knowledge;
- account deletion removes encrypted claim records with other user data;
- logout continues to wipe local DB and master key under existing lifecycle rules.

### Third-party information

Claims can contain information about other people. Product review should decide whether automatic capture needs extra restrictions for:

- health information;
- addresses;
- minors;
- legal allegations;
- sexuality;
- financial information.

Initial scope should avoid extracting highly sensitive third-party attributes automatically.

---

## 15. Product surface

Recommended placement: current `You` area, not a new primary tab.

Possible hierarchy:

```text
You
  Pages
    About you
      Relationships
      Work & education
      Places
      Preferences & routines
      Important dates

    Insight pages
      Emotions
      Beliefs
      Behaviours
      Themes
      People
      Places
      Activities
```

Structured-memory detail should show:

- human-readable claim or situation frame;
- user-stated or manual origin;
- source and date;
- actuality or applicable time period;
- update and “Not current” actions;
- “Wrong extraction” action;
- prior values/history;
- conflict state when applicable.

### Manual capture

A future “Remember something” action should create a manual-origin claim directly. Manual origin outranks model extraction when values conflict; it still records what user states, not externally verified truth.

### Reflect capture

Safest initial behavior:

- extract only from messages already accepted by current self-relevant capture pipeline; or
- expose explicit “Remember this” action.

Do not silently retain arbitrary informational questions or assistant-generated text.

---

## 16. Historical backfill

Backfill claims from raw source entries only.

Never extract claims from existing wiki prose because wiki pages are synthesized interpretation, not primary evidence.

Backfill requirements:

- on-device only;
- versioned extractor;
- restart-safe marker;
- low-priority queue;
- deep-model availability check;
- recent entries first;
- optional charging-only policy for large histories;
- atomic claim/source writes;
- idempotent retries;
- no launch blocking;
- no journal-save blocking;
- no graph double-counting;
- privacy-safe count-only diagnostics.

---

## 17. Rejected approaches

### 17.1 Add `fact` category to `wiki_pages`

**Rejected.** Free-form synthesis lacks atomic provenance, temporal validity, safe correction, and conflict handling.

### 17.2 Reuse `graph_nodes` and `graph_edges`

**Rejected.** Current graph lacks direction, predicates, validity time, provenance, retraction, and conflict semantics. Additive edges are incompatible with mutable facts.

### 17.3 Store facts only in entry text

**Rejected.** Entry text preserves evidence but does not provide consolidated lookup, typed retrieval, correction, or current-state reasoning.

### 17.4 Extract facts from wiki pages

**Rejected.** This converts model synthesis into evidence and compounds hallucination risk.

### 17.5 Adopt full RDF or general ontology system

**Rejected for initial release.** First-class assertions and provenance are useful principles, but full semantic-web infrastructure is unnecessary complexity for current React Native, SQLite, small-model, and privacy constraints.

### 17.6 Automatically treat newest value as truth

**Rejected.** Multiple jobs, residences, relationships, or preferences may coexist. Recency alone does not resolve contradiction.

---

## 18. Recommended staged rollout

### Stage 1 — evaluation only

- Build synthetic and hand-reviewed situation and claim extraction corpus.
- Include multi-event entries, participant roles, actuality, explicit facts, non-facts, negation, temporal statements, corrections, and ambiguity.
- Compare dedicated and combined extraction.
- Measure existing extraction regression.
- Optimize for precision over recall.

### Stage 2 — shadow structured-memory store

- Persist situations, claims, and provenance without user-facing retrieval.
- Validate event segmentation, claim promotion, interruption recovery, deduplication, sync, and cross-device convergence.
- Record count-only diagnostics; never log structured content.

### Stage 3 — correction and manual capture UI

- Show extracted situations and claims as “Based on your journal.”
- Add update/not-current/wrong-extraction/source actions; no confirmation queue.
- Add manual “Remember something.”
- Validate user trust before Reflect grounding.

### Stage 4 — routed retrieval

- Route occurrence questions to situations and current-state questions to claims.
- Preserve provenance, actuality, and time in grounding.
- Separate situations and claims from synthesized patterns in prompt context.
- Add structured-memory source chips.

### Stage 5 — composed wiki pages

- Render relevant active claims and bounded situation timelines beside narrative pages.
- Keep structured sections deterministic.
- Keep model-generated page content unchanged as architectural concept.

### Stage 6 — optional historical backfill

- Process source entries locally and incrementally.
- Do not use wiki prose as source.

### Stage 7 — optional factual/event relationship view

- Derive directed, labeled relations from active claims and situations.
- Keep separate from existing co-occurrence graph semantics.

---

## 19. Evaluation criteria

Before implementation approval, define measurable gates.

### Extraction quality

- situation-boundary precision and recall;
- situation type, participant-role, actuality, attribution, place, and time accuracy;
- explicit-relation accuracy, especially causality;
- claim precision and recall;
- claim-promotion false-positive rate;
- predicate and subject/object accuracy;
- temporal and negation accuracy;
- no-situation/no-claim rejection rate;
- regression in current emotion/topic/entity extraction.

### Lifecycle correctness

- equivalent repeated claim adds source, not duplicate visible claim;
- repeated descriptions preserve source-scoped situation mentions and group only with sufficient evidence;
- split/merge correction preserves prior history;
- claim correction preserves prior history;
- explicit transition closes prior validity correctly;
- ambiguous conflict is not silently resolved;
- rejected/superseded memory does not ground current responses.

### Reliability

- interrupted extraction retries safely;
- no duplicate source links after retry;
- app kill does not lose saved entry;
- model absence does not block journaling;
- cross-device restore converges;
- older client behavior remains bounded and understood.

### Privacy

- no plaintext structured-memory network path;
- no situation or claim text in logs or diagnostics;
- record IDs do not reveal normalized content;
- feature does not claim remote erasure until account-deletion and R2-retention path is designed and verified.

### UX trust

- user can see why claim exists;
- source opens directly;
- uncertainty is visible;
- correction is local and understandable;
- app distinguishes “you wrote this” from model inference and independently verified truth.

---

## 20. Open review decisions

These require product and architecture agreement before implementation planning.

1. **Scope:** autobiographical facts only, or arbitrary world knowledge?
   - Recommendation: autobiographical and personally relevant facts only.

2. **Automatic capture:** which high-confidence situations and explicit durable claims qualify for automatic persistence?
   - Agreed direction: auto-store allowed explicit structured memory as user-stated interpretation. No confirmation workflow. Suppress uncertain extraction; expose correction and targeted conflict resolution.

3. **Reflect:** automatic extraction from eligible user messages, explicit “Remember this,” or both?
   - Recommendation: start with explicit action or existing self-relevant capture gate only.

4. **Sensitive domains:** which medical, legal, financial, and third-party predicates are prohibited initially?
   - Recommendation: defer automatic extraction for these domains.

5. **Extraction implementation:** combined with current deep extract or separate completion?
   - Recommendation: decide through shadow evaluation, preserving separate architecture boundary.

6. **Situation registry:** which event/state types, participant roles, actuality values, and relations are enabled in v1?

7. **Conflict UX:** when should app ask user to resolve conflicting claims or situation grouping?

8. **Backfill:** opt-in, automatic, charging-only, or deferred?

9. **Retention:** should rejected structured records remain in local audit history or be hard-deletable immediately?

10. **Visibility:** should auto-stored structured memory appear directly in “About you” and timelines, or only when retrieved?

11. **Manual knowledge:** should user be able to add a manual claim or situation without creating a journal entry?
    - Recommendation: yes.

---

## 21. Recommended decision

Proceed toward **provenance-first personal situation and claim layers** with these boundaries:

- autobiographical and personally relevant situations/claims only;
- narrow situation-type, role, relation, and predicate registries;
- explicit source provenance and actuality;
- precision-preserving temporal memory and event-based correction/supersession;
- no routine confirmation; correction outranks model extraction;
- existing wiki retained as synthesized narrative;
- existing graph retained as co-occurrence map;
- deterministic situation/claim sections rendered alongside relevant wiki pages;
- encrypted sync through current opaque-record infrastructure;
- staged shadow evaluation before user-facing grounding;
- raw source entries and eligible user messages as only automatic backfill evidence.

This architecture extends MindWiki into episodic and semantic personal memory without weakening current reflective wiki, zero-knowledge privacy model, or user trust.

---

## 22. Architecture-readiness review — new findings

This review examined whether research above is sufficient to begin a detailed architecture design. Result: **core direction is sound, but implementation architecture is not ready for approval yet.** Six findings change design requirements; remaining blocker and high-priority investigations must close before SPARC specification work.

### 22.1 Finding: current sync has no working remote-delete protocol

`src/services/storage/sync-queue.ts` declares `SyncOperation = 'upsert' | 'delete'`, but implementation only exposes `enqueueUpsert()`. `pushPending()` in `src/services/sync/engine.ts` only uploads rows that still exist locally; when a row is gone it marks queue item synced without sending a deletion. Server sync exposes only PUT and delta listing:

- `server/src/storage/upload.ts`
- `server/src/storage/delta.ts`
- `server/src/index.ts`

No encrypted tombstone, R2 delete, or client remote-delete apply path exists.

**Architecture consequence:** normal claim correction/rejection cannot depend on row deletion. Claim state must be additive:

```text
assertion exists
  → rejection/retraction/correction/supersession is new state event
  → current view derives active state
```

A user-facing “remove from memory” action can retract or hide a claim from current retrieval, but cannot honestly promise physical erasure of its original assertion while source entry and remote ciphertext remain. Hard deletion requires separate deletion architecture for source entries, claim records, and remote R2 objects.

### 22.2 Finding: mutable LWW claim status is unsafe for factual state

Current client conflict resolver accepts a remote record only when:

```text
remote.updated_at > local.updated_at
```

Server accepts equal timestamps and overwrites stored record because it rejects only `body.updated_at < stored`. Two devices may therefore make concurrent edits at same millisecond, with server and clients not sharing a deterministic semantic winner:

- `src/services/sync/conflict.ts`
- `src/services/sync/engine.ts`
- `server/src/storage/upload.ts`

This is tolerable for current simple mutable rows, but not for structured memory where concurrent “reject,” “replace,” “split,” or “merge” actions must remain auditable.

**Revised recommendation:** use immutable assertion, evidence, and lifecycle-event records. Do not store claim truth/status as one mutable LWW row.

Conceptual records:

```text
memory_situations               immutable source-scoped event/state assertion
memory_situation_mentions       immutable source attachment
memory_situation_participants   immutable event-bounded role
memory_situation_relations      immutable explicit/derived relation
knowledge_claims                immutable proposition identity
knowledge_claim_evidence        immutable source attachment / stance
memory_situation_claims         immutable situation/claim bridge
knowledge_claim_events          immutable reject, retract, supersede, or resolution event
memory_grouping_events           immutable situation split/merge/group resolution
```

Current situation grouping and claim state are deterministic projections over all events. Concurrent incompatible events surface conflict; no event is silently lost. Later explicit resolution names what it resolves.

This still uses existing opaque encrypted-record transport because each event has its own UUID and is never overwritten. Projections remain device-local and deterministic.

### 22.3 Finding: generic sync backfill misses tables introduced after first sync

`backfillSyncQueue()` uses one global durable flag, `sync:backfilled`. After it is set, later calls do not enqueue rows from any table:

- `src/services/storage/sync-queue.ts`
- `src/services/sync/engine.ts`

Therefore adding structured-memory tables to `SYNCED_TABLES` is insufficient for existing accounts. Their pre-existing locally generated situations and claims would not upload through generic backfill.

**Architecture consequence:** migration needs a dedicated, versioned sync-enqueue pass, for example `sync:structured_memory_backfilled_v1`. It must enqueue every new situation, mention, participant, relation, claim, evidence, bridge, and lifecycle row once after schema installation, then be idempotent. Do not reset global backfill flag; that would re-upload all historical tables.

### 22.4 Finding: temporal claims need civil-time precision, not entry epoch alone

Entries persist `created_at` epoch milliseconds but no source timezone or civil-date precision. A claim such as “I moved last year” cannot be faithfully converted into one exact timestamp, especially after sync across timezones. Existing page recency logic intentionally calculates local calendar days, but that is not sufficient evidence for factual event dates:

- `src/services/storage/entries.ts`
- `src/services/wiki/engine.ts:computeTiming()`

**Architecture consequence:** do not model fact validity as only epoch `valid_from` / `valid_to` values. Use a temporal value with explicit precision:

```text
kind: none | date | range | text
start_date: YYYY | YYYY-MM | YYYY-MM-DD | null
end_date: YYYY | YYYY-MM | YYYY-MM-DD | null
precision: year | month | day | unknown
original_text: optional normalized temporal phrase
```

For v1 current-state projection, rely only on explicit absolute dates. Preserve relative or ambiguous time on source-linked situations without converting it into exact claim validity. If relative temporal resolution is later required, add source civil-date/timezone contract first.

### 22.5 Finding: entity labels are not safe claim identities

Current entity canonicalization is designed primarily for recurring graph/wiki labels. Strong semantic snapping and maintenance exist for beliefs, while people, places, and activities use general label normalization:

- `src/services/storage/entities.ts`
- `src/services/llm/taxonomy.ts`
- `src/services/wiki/belief-snap.ts`

A claim must not assume two equal-looking person labels mean same individual, or that a normalized place/activity label is globally canonical. “Alex” can refer to multiple people; “Work” can be a place, theme, or employer.

**Architecture consequence:** situation participants and claim subject/object identities begin as source-scoped display text plus type, not current graph-node identity. Entity resolution is deferred. User-directed merges may later establish aliases; automatic person identity merging is out of scope for v1.

### 22.6 Finding: account data deletion is unverified and likely incomplete

Within reviewed server code, `POST /auth/logout` only revokes token family and device association. No account-deletion route or R2 object deletion path was found:

- `src/services/auth/auth.service.ts`
- `server/src/auth/logout.ts`
- `server/src/index.ts`

`docs/PRIVACY_SECURITY.md` lists GDPR deletion as a release checklist item, but reviewed implementation does not establish encrypted-record deletion from remote R2.

**Architecture consequence:** remove any assumption that adding claims automatically satisfies account-deletion requirements. Before accumulating more explicit PII, audit and specify account deletion, retention, remote R2 object enumeration/deletion, retries, and recovery behavior. This is a cross-product privacy requirement, not claim-feature work alone.

### 22.7 Revised minimal persistence model

Situation and claim assertions must not own mutable lifecycle/grouping fields as authoritative state.

```text
memory_situations
  id, situation_type, actuality, valid_time,
  location_entity_id, origin, extractor_version, created_at

memory_situation_mentions
  id, situation_id, source_type, source_id,
  source_field, start_offset, end_offset, created_at

memory_situation_participants
  id, situation_id, entity_id, role, attribution, created_at

memory_situation_relations
  id, from_situation_id, to_situation_id, relation, basis, created_at

knowledge_claims
  id, subject_type, subject_label, predicate,
  object_type, object_value, temporal_value,
  origin, extractor_version, created_at

knowledge_claim_evidence
  id, claim_id, source_type, source_id, stance, created_at

memory_situation_claims
  id, situation_id, claim_id, relation, created_at

knowledge_claim_events / memory_grouping_events
  id, target_id, type, replacement_or_group_ids,
  target_event_ids, created_at, origin_device_id
```

Projection rules are architecture logic, not model prompt:

- mentions/evidence attach sources without changing assertion;
- situation roles remain event-bounded;
- `reject` excludes wrong extraction while preserving auditability;
- `retract` removes assertion from current personal knowledge view;
- `supersede` explicitly links replacement assertion to prior assertion;
- split/merge events change canonical event grouping without destroying source-scoped situations;
- incompatible unresolved events yield conflict, never silent LWW selection;
- active claims answer current-state questions; eligible situations answer occurrence/context questions.

`origin_device_id` must be evaluated against existing device-ID privacy and lifecycle rules. It is a deterministic tie/audit attribute, not user content. If conflict resolution can remain set-based rather than order-based, it should; avoid inventing distributed-clock machinery unless a concrete resolution requires it.

### 22.8 Remaining research required before detailed design

| Priority | Open question | Why architecture cannot guess |
|---|---|---|
| Blocker | Situation and claim registries | Event types, roles, actuality, relations, predicate cardinality, conflict, and sensitive-domain rules are product/safety policy. |
| Blocker | Extraction evaluation on target device | No situation/claim fixture corpus, segmentation baseline, promotion false-positive budget, or current-extraction regression data exists. |
| Blocker | Data deletion and retention | Current server path does not demonstrate remote encrypted-record deletion; “remove” semantics cannot be honestly specified until resolved. |
| Blocker | Projection/grouping conflict semantics | Must define exact outcomes for reject/supersede/retract and situation split/merge races before schema, sync, and UI design. |
| High | Correction/manual-capture UX | Auto-store policy is agreed; exact correction, source inspection, targeted conflict, and manual capture UX remains open. |
| High | Temporal contract | Need decide v1 support: explicit dates only, or new source timezone/civil-time fields plus relative-date resolution. |
| High | Third-party sensitive data policy | Need prohibited event/role/predicate/object classes and whether third-party information can be retained automatically. |
| Medium | Source deletion/edit semantics | Entries are treated as immutable, but structured records need behavior if future entry/chat deletion or editing arrives. |
| Medium | Cross-device test strategy | Need two-writer cases: duplicate assertion, concurrent reject/replace, event split/merge, app kill, stale client, and fresh restore. |
| Medium | Storage/query performance budget | Need expected situation/claim counts, indexes, pagination, and routed retrieval benchmark before choosing FTS or scan-based retrieval. |

### 22.9 Architecture readiness gate

Proceed to detailed `[SPEC]` / `[PSEUDO]` architecture only after these gates pass:

1. Product approves v1 situation/role/relation, predicate, scope, and sensitive-data registries.
2. Situation and claim extraction evaluation demonstrates acceptable segmentation, role, actuality, promotion precision, and no material regression on target model/device.
3. Additive claim projection and situation grouping are specified with race/conflict examples and deterministic expected state.
4. Remote account-data deletion and retention are audited and specified.
5. Civil-time policy is chosen; claim validity defaults to explicit dates only if source timezone contract is not added.
6. Sync migration/backfill strategy includes every new structured-memory table for existing accounts.
7. Correction and targeted conflict UX is specified without routine confirmation.

Until then, situation-plus-claim architecture is viable direction, not implementation-ready design.

---

## 23. External research review and architecture synthesis

### 23.1 Research conclusion

Relevant research exists across several fields, but no paper or production system directly solves MindWiki's exact problem: privacy-first, on-device extraction of autobiographical claims from journals, deterministic multi-device correction, and coexistence with a mutable reflective wiki.

Strong prior art converges on seven ideas:

1. keep source documents, event/situation memory, and consolidated semantic memory distinct;
2. represent situations as first-class frames binding participants and event-specific roles;
3. represent durable claims as first-class records rather than prose fragments;
4. attach provenance to each situation and claim;
5. preserve actuality, viewpoint, and attribution instead of treating every described scene as occurred fact;
6. separate when memory was recorded from when it was valid or occurred;
7. preserve old assertions and derive current state instead of destructively replacing history.

MindWiki should adopt these principles without importing a graph database, RDF runtime, or vendor memory service. Existing SQLCipher SQLite, opaque encrypted sync, immutable journal entries, and on-device models remain correct substrate.

### 23.2 Research map

| Source | Type | Relevant result | MindWiki implication |
|---|---|---|---|
| Renoult et al., *Personal semantics: at the crossroads of semantic and episodic memory* (2012) | Peer-reviewed cognitive-science review | Personal semantic knowledge is idiosyncratic knowledge about one's own life and sits between general semantic memory and event-specific episodic memory. | Structured situations and projected claims serve different memory questions. Preserve both with original source. |
| Rubin and Umanath, *Event memory: A theory of memory for laboratory, autobiographical, and fictional events* (2015) | Peer-reviewed cognitive-science theory/review | Defines event memory around construction of a scene recalled as one occurrence; separates event/scene dimensions from semantic knowledge and allows real, imagined, past, or future scenes. | Entry text is not itself structured event memory. Preserve situation boundaries, scene context, actuality, and source. |
| Guan et al., *What is Event Knowledge Graph: A Survey* (TKDE 2022) | Peer-reviewed survey | Treats events as an essential form of knowledge distinct from entity-centric KGs and surveys schemas, acquisition, systems, and event-centric search/QA applications. | Atomic entity relations alone are insufficient for occurrence and contextual questions. Add event/situation layer. |
| van Hage et al., *Design and use of the Simple Event Model* (2011) | Peer-reviewed event-model paper | Models events around actors, places, times, event-bounded roles, temporary validity, and viewpoints/authority with minimal semantic commitment; causality remains outside its core. | Borrow minimal event frame, roles, validity, and attribution. Keep causality narrow and explicit; do not import RDF runtime. |
| Berkeley FrameNet / Frame Semantics | Long-running lexical-semantic research resource | Represents meaning using frames for situations, events, relations, or entities and participant roles called frame elements. | Extract participant role within situation frame, not permanent binary property inferred from co-mention. |
| Balog and Kenter, *An ecosystem for personal knowledge graphs: A survey and research roadmap* (2024) | Peer-reviewed survey | PKGs organize entities, attributes, and relations relevant to an individual; data integration, ownership, privacy, and user interaction remain central challenges. | Scope claim layer around personally relevant knowledge with local ownership and visible user control. |
| Sikos and Philp, *Provenance-Aware Knowledge Representation* (2020) | Peer-reviewed survey | Statement-level provenance is non-trivial; named graphs, reification, n-ary relations, and nanopublications trade simplicity against expressivity and storage/query cost. | Make assertion an addressable SQL row with separate evidence rows. Do not treat bare triples as sufficient. |
| W3C PROV-O / PROV-DM (2013) | Official W3C Recommendation | Provenance distinguishes entities, activities, and responsible agents and records derivation relationships. | Record source, extraction activity/version, and origin. Full PROV ontology unnecessary at runtime. |
| W3C OWL-Time (2017) | Official W3C Recommendation | Time representation distinguishes instants, intervals, ordering, duration, calendar descriptions, and precision. | Preserve year/month/day precision and interval semantics; do not coerce all time into exact epoch milliseconds. |
| Groth et al., *The anatomy of a nanopublication* (2010) | Peer-reviewed conceptual paper | Packages assertion, assertion provenance, and publication metadata as separate named graphs. | Mirrors claim + evidence + lifecycle metadata split, but RDF packaging would add little value on-device. |
| Saurí and Pustejovsky, *Are You Sure That This Happened?* (2012), plus modality/negation extraction work | Peer-reviewed NLP research | Proposition extraction must model polarity, certainty, source perspective, modality, and scope; surface event detection alone overstates factuality. | Extraction contract must preserve negation, attribution, hypotheticality, uncertainty, and temporal status. |
| Wu et al., *LongMemEval* (ICLR 2025) | Peer-reviewed benchmark | Evaluates information extraction, multi-session reasoning, temporal reasoning, knowledge updates, and abstention over long interaction histories. | Reuse these ability classes for factual-memory evaluation; exact benchmark data is chat-centric, so add journal-specific fixtures. |
| Rasmussen et al., *Zep: A Temporal Knowledge Graph Architecture for Agent Memory* (2025) | Vendor-authored preprint/system paper | Separates episode, semantic-entity/fact, and community subgraphs; tracks transaction and validity timelines; links facts to episodes; uses hybrid lexical/vector/graph retrieval. | Borrow episodic/semantic split, source links, bitemporality, and hybrid retrieval. Do not copy infrastructure. |
| Kleppmann et al., *Local-First Software* (2019) and CRDT literature | Peer-reviewed systems work/tutorials | Local writes, eventual synchronization, immutable operations, and explicit conflict semantics improve ownership and convergence; CRDT convergence does not resolve domain-level semantic conflict. | Sync append-only claim/evidence/events. Surface semantic contradiction rather than hiding it behind LWW. |
| MemGPT (2023) and HippoRAG (NeurIPS 2024) | Preprint / peer-reviewed retrieval architectures | Memory tiering and graph-assisted retrieval improve context selection and multi-hop recall. Neither supplies required personal-claim lifecycle, user correction, or encrypted offline convergence. | Useful retrieval ideas later; insufficient as factual source-of-truth architecture. |

Source quality matters. Standards and peer-reviewed papers support architectural principles. Zep/Graphiti gives useful production-oriented evidence, but its reported benchmark results and design choices come from its vendor authors and should not be treated as independent validation.

### 23.3 What to borrow, and what to reject

#### Borrow

- **Source/event/semantic separation:** immutable entry remains evidence; situation frames support event recall; claim projection becomes reusable personal semantic memory.
- **Event frames and roles:** represent occurrence plus who participated in which event-bounded role, when, where, and under whose viewpoint.
- **Situation- and claim-level provenance:** every projected memory can answer “which source caused this?”
- **Bi-temporal semantics:** keep record/ingestion time separate from claimed validity time.
- **Non-lossy history:** supersede and retract through new events, not destructive overwrite.
- **Hybrid retrieval:** structured filters first; lexical and embedding retrieval as derived candidate generators.
- **Abstention:** missing, rejected, stale, or unresolved claims must not be converted into confident answers.

#### Reject or narrow

- **Automatic newest-wins truth:** Zep/Graphiti invalidates older contradictory edges using LLM comparison and prioritizes newer information. MindWiki must not use this as default. New statements can describe another simultaneous job, residence, relationship, preference, quoted claim, or extraction error.
- **LLM-owned conflict resolution:** model may detect candidate conflict, but deterministic predicate policy and explicit user lifecycle events own projected state.
- **Full RDF/OWL runtime:** standards provide useful vocabulary, not deployment requirement. General semantic-web tooling increases binary size, ontology work, query complexity, and migration burden without improving v1 user outcomes.
- **Graph as source of truth:** graph traversal helps retrieval; graph shape alone cannot encode extraction confidence, source spans, actuality, participant-role provenance, user rejection, or exact event history safely.
- **Full FrameNet ontology:** Frame Semantics supports architecture, but 1,000+ general frames are too broad for v1 and unreliable for small on-device extraction. Use a small product registry.
- **Vector memory as authority:** embeddings are lossy indexes. They cannot provide exact identity, temporal closure, deletion semantics, or provenance.
- **Cloud memory service:** conflicts with raw-journal privacy and zero-knowledge architecture.

### 23.4 Recommended core architecture

```text
LAYER 0 — LOSSLESS SOURCE EVIDENCE
  immutable entries / eligible user-authored Reflect messages
                    │
                    ▼
LAYER 1 — EXTRACTION
  on-device, precision-first, versioned structured output
  situation boundaries + actuality + participants/roles + time/place
  explicit durable propositions + attribution + polarity + modality
                    │
          ┌─────────┴─────────┐
          ▼                   ▼
LAYER 2A — EVENT MEMORY    LAYER 2B — SEMANTIC MEMORY
  situations + mentions      claims + evidence
  participants + roles       lifecycle events
  situation relations        situation-claim links
          │                   │
          └─────────┬─────────┘
                    ▼
LAYER 3 — DETERMINISTIC PROJECTIONS
  event groupings and relations
  user-stated / active / historical /
  superseded / retracted / rejected / conflicted
                    │
          ┌─────────┴─────────┐
          ▼                   ▼
LAYER 4A — ROUTED RETRIEVAL LAYER 4B — PRODUCT VIEWS
  event/role/time SQL         situation timelines
  current-state SQL          “About you” claim sections
  lexical match              composed wiki pages
  optional embeddings        correction/history + sources
          │
          ▼
LAYER 5 — REFLECT GROUNDING
  separate situations, user-stated claims, and synthesized patterns
  cite source; preserve actuality/time; abstain on unresolved state
```

Responsibilities:

- **Entries/messages:** lossless evidence of what user authored, not proof of objective truth and not pre-segmented episodes.
- **Situations:** normalized model interpretations of bounded occurrences or states, including actuality and contextual bindings.
- **Participants/roles:** event-bounded participation, never automatically permanent entity relation.
- **Claims:** normalized model interpretation of one explicit durable proposition.
- **Evidence/mentions:** source attachments; ideally source field plus character offsets, avoiding duplicated plaintext excerpts.
- **Lifecycle/grouping events:** user intent, corrections, situation split/merge, and claim state changes. Append-only UUID records make current opaque sync safer than mutable status rows.
- **Projector:** pure deterministic function over assertions, evidence, predicate policy, and events. No LLM call.
- **Indexes:** disposable local accelerators, never authority.
- **Wiki/Reflect/Connections:** read models over projected state, not claim storage.

### 23.5 Architecture options with pros and cons

| Option | Pros | Cons | Decision |
|---|---|---|---|
| Keep factual memory only in wiki prose | No schema or UI work; preserves current compounding flow | Hallucination/drift risk; no atomic provenance, temporal state, correction, or reliable retrieval | Reject |
| Store only source entries + vector search | Minimal extraction; source always available; broad semantic recall | Repeatedly re-derives facts; noisy context; weak updates/contradictions; no deterministic current state | Reject as authority; retain source retrieval as fallback |
| Add factual edges to current Connections graph | Intuitive relationship display; graph traversal | Conflates co-occurrence with truth; additive edges cannot retract; weak statement metadata | Reject |
| Build full RDF/OWL personal KG | Rich standards, interoperability, mature provenance/time vocabularies | Heavy ontology/runtime/query cost; poor fit for RN + SQLite + 3B model; premature generality | Defer/export-only possibility |
| Adopt Graphiti/Zep-like graph service | Strong temporal graph and hybrid retrieval; existing implementation | Cloud/privacy mismatch; Neo4j/service complexity; LLM newest-wins policy unsuitable; vendor dependency | Reject runtime; borrow principles |
| Relational immutable claims only | Fits SQLCipher; strong current-state queries | Flattens bounded situations; loses participant roles, sequence, context, and actuality | Reject as complete architecture |
| Relational situation + claim layers | Fits SQLCipher and encrypted row sync; supports occurrence and current-state questions; deterministic; provenance-first | Requires situation registry, event segmentation, role extraction, entity resolution, projection, and dedicated UX | **Recommend** |

### 23.6 Core architecture challenges

#### 1. Extraction fidelity

Highest-risk failure is false personal memory, not missed memory. Extractor must preserve:

- negation: “I do not work at Acme”;
- attribution: “Alex says I am moving”;
- modality: “I might move”;
- counterfactual/hypothetical scope: “If I moved to Paris”;
- temporality: “I used to live in Berlin”;
- object boundaries: “my sister Sarah” versus unrelated Sarah mention;
- speaker ownership: user text only, never assistant suggestion.

Architecture response: narrow predicate registry, strict Zod validation, per-claim confidence, no-claim default, source spans, and shadow evaluation. Precision target should dominate recall target.

#### 2. Situation completeness without false structure

Journal entries often describe several linked occurrences. Extractor must segment situations, bind participants to event-specific roles, and preserve place, time, actuality, attribution, sequence, and explicit relations without pretending frame is complete.

Architecture response: source remains lossless authority; situation is source-scoped interpretation; use narrow registries; allow missing fields; never infer residence from event location, permanent relationship from participant role, occurrence from hypothetical scene, or causality from adjacency.

#### 3. Temporal modeling

Four distinct concepts can otherwise collapse:

- source creation time;
- extraction/record time;
- claimed event time;
- claim validity interval.

Architecture response: store recorded time independently; represent validity with explicit precision (`year`, `month`, `day`, `unknown`) and open/closed interval bounds. Do not resolve relative dates until source civil date/timezone exists.

#### 4. Changed state versus contradiction

“Left Acme” may supersede “works at Acme.” “Lives in London” may coexist with “lives in Berlin.” “Likes coffee” and “avoids coffee” may be context-dependent rather than logically inconsistent.

Architecture response: predicate metadata defines cardinality and temporal behavior. Model may nominate candidate relation; deterministic projector decides only cases encoded by policy. Everything else becomes unresolved or targeted review.

#### 5. Entity identity

Names are not identities. Two people may be called Alex; one person may appear as “Mom,” “Mum,” and a name. Current normalized graph labels are too aggressive for factual identity.

Architecture response: source-scoped typed entities first; conservative aliases; no automatic person merge without strong evidence or user action. Entity resolution remains independent from claim truth.

#### 6. Provenance without privacy duplication

Traceability favors quotes; privacy and storage favor references. Syncing duplicate excerpts multiplies sensitive text and deletion surfaces.

Architecture response: evidence references source record, field, and optional offsets. Render quote by reading encrypted source locally. Store excerpt only if immutable structured fields cannot address source precisely.

#### 7. Multi-device convergence

Current sync is opaque and privacy-preserving, but mutable equal-timestamp LWW and missing remote-delete behavior are unsafe for claim status. Generic one-time backfill also misses later-added tables.

Architecture response: assertions, evidence, and events are immutable records; projection is set-based; semantic conflict is explicit; claim migration has its own versioned enqueue pass. Hard deletion remains separate product-wide work.

#### 8. Retraction versus erasure

“Forget this” can mean exclude from retrieval, remove visible history, delete derived claim, or erase every source/ciphertext copy. Current system can support first meanings through events but cannot honestly guarantee last meaning remotely.

Architecture response: define user language precisely. `retract` removes current grounding; physical erasure requires verified source deletion, tombstone/remote-delete protocol, account deletion, and retention policy.

#### 9. Small-model and device budget

Dedicated extraction improves isolation but adds latency, thermal load, and queue contention. Combined extraction saves inference but may degrade existing wiki signals.

Architecture response: shadow-test both. Keep architectural contract separate even if one completion returns both schemas. Use one completion only if current extraction quality and claim precision meet gates on target device.

#### 10. Sensitive and third-party facts

Compact structured claims increase privacy harm if wrong, exposed, or over-collected.

Architecture response: v1 allowlist; prohibit automatic medical, diagnostic, legal, financial, address, minor, sexuality, and allegation predicates. Manual explicit capture can be reviewed separately. Never infer diagnosis or treatment.

#### 11. Retrieval trust

Relevant claim may still be superseded, conflicted, too sensitive, or unrelated to current question.

Architecture response: filter by projected status before ranking. Rank structure/lexical/embedding candidates afterward. Construct context with provenance and validity labels. Test abstention explicitly.

### 23.7 Proposed projection contract

Projection should be deterministic and set-based where possible:

```text
assertion + supporting evidence
  no excluding event                → user-stated active
  supersede(old → replacement)      → old superseded, replacement active
  retract event                     → retracted
  reject event                      → rejected extraction
  incompatible unresolved events    → conflicted
  resolution event naming conflict  → state selected by explicit user action
```

Avoid event ordering by device wall clock as semantic authority. Events should target claim/event IDs explicitly. Timestamp is audit/display metadata, not conflict winner. If two devices emit incompatible terminal events, retain both and project `conflicted` until resolution.

Materialized `knowledge_claim_state` may later cache projection for query speed, but must be rebuildable from immutable rows and never synced as authority.

### 23.8 Retrieval architecture

Recommended retrieval order:

1. classify question as source, situation/event, durable/current-state claim, or synthesized-pattern query;
2. parse explicit entity, participant-role, predicate/situation-type, place, actuality, and time filters;
3. query matching situation or active-claim projection using typed SQL;
4. add lexical candidates over labels and source-linked display text;
5. optionally add embedding candidates from local disposable vectors;
6. apply actuality/status, temporal, sensitivity, and source-availability filters;
7. rank by direct role/subject/object match, temporal fit, evidence support, then semantic score;
8. construct bounded context with situation/claim ID, user-stated wording, actuality/validity, and source date;
9. abstain or surface ambiguity when no safe structured memory answers query.

Graph expansion should be late and bounded, useful only for explicit relational/multi-hop questions. Current-state facts should resolve through claim projection; occurrence questions should resolve through situations; pattern questions should combine wiki with bounded situation evidence.

### 23.9 Evaluation program

Use four fixture sets:

1. **Situation extraction:** multi-event entries, event boundaries, participants/roles, place/time, actuality, attribution, explicit causality, sequence, emotional responses, and no-situation reflections.
2. **Claim extraction/promotion:** positive claims, no-claim cases, negation, attribution, hypotheticals, plans, past/current state, explicit/relative dates, sensitive content, entity collisions, and event-location versus residence traps.
3. **Lifecycle:** repeated mentions, possible same-event grouping, split/merge correction, transition, supersession, retract/reject races, non-exclusive predicates, real contradictions, and source deletion scenarios.
4. **Retrieval:** LongMemEval-inspired information extraction, multi-session reasoning, temporal reasoning, knowledge update, and abstention questions, plus event-role/context questions rewritten for journal evidence.

Required metrics:

- situation-boundary precision/recall;
- situation type, participant-role, actuality, place, temporal, attribution, sequence, and explicit-relation exact match;
- atomic claim precision and recall;
- claim-promotion false-positive rate, including event-context leakage;
- predicate, argument, attribution, polarity, modality, and temporal exact match;
- entity-resolution precision;
- current-state projection accuracy;
- conflict detection false-positive/false-negative rates;
- provenance/source-span accuracy;
- retrieval answer accuracy and abstention accuracy;
- regression against current emotion/topic/entity extraction;
- latency, battery, thermal, and interruption recovery on target devices;
- convergence across event permutations, equal timestamps, stale devices, and app-kill boundaries;
- proof that network payloads and logs contain no plaintext claim/source content.

Suggested launch philosophy: false-memory budget near zero. Start with small allowlist and accept lower recall. Expand predicates only after per-predicate precision clears agreed threshold.

### 23.10 Final recommendation

Proceed with relational, provenance-first situation and claim layers. Do not proceed directly to broad automatic extraction.

Next architecture sequence:

1. approve v1 situation-type/role/relation and predicate/sensitivity registries;
2. define exact situation grouping plus claim projection with race examples;
3. build device fixture/evaluation harness before schema integration;
4. audit remote erasure/account deletion semantics;
5. choose combined versus dedicated completion from measured results;
6. implement shadow situation/claim store and multi-device convergence tests;
7. expose correction and source-inspection UI without routine confirmation;
8. enable routed retrieval only after trust gates pass.

This preserves MindWiki's defining architecture: source entries remain immutable experience evidence, situations preserve contextual occurrences, claims preserve durable personal semantic memory, and wiki remains compounding narrative interpretation.

### 23.11 Primary sources

- Renoult, L. et al. (2012), *Personal semantics: at the crossroads of semantic and episodic memory*: https://doi.org/10.1016/j.tics.2012.09.003
- Rubin, D. C. and Umanath, S. (2015), *Event memory: A theory of memory for laboratory, autobiographical, and fictional events*: https://pmc.ncbi.nlm.nih.gov/articles/PMC4295926/
- Guan, S. et al. (2022), *What is Event Knowledge Graph: A Survey*: https://arxiv.org/abs/2112.15280
- van Hage, W. R. et al. (2011), *Design and use of the Simple Event Model*: https://doi.org/10.1016/j.websem.2011.03.003
- Berkeley FrameNet, *What is FrameNet?*: https://berkeleyfn.framenetbr.ufjf.br/WhatIsFrameNet
- Balog, K. and Kenter, T. (2024), *An ecosystem for personal knowledge graphs: A survey and research roadmap*: https://arxiv.org/abs/2304.09572
- Sikos, L. F. and Philp, D. (2020), *Provenance-Aware Knowledge Representation: A Survey of Data Models and Contextualized Knowledge Graphs*: https://doi.org/10.1007/s41019-020-00118-0
- W3C, *PROV-O: The PROV Ontology*: https://www.w3.org/TR/prov-o/
- W3C, *Time Ontology in OWL*: https://www.w3.org/TR/2017/REC-owl-time-20171019/
- Groth, P., Gibson, A., and Velterop, J. (2010), *The anatomy of a nanopublication*: https://doi.org/10.3233/ISU-2010-0613
- Saurí, R. and Pustejovsky, J. (2012), *Are You Sure That This Happened? Assessing the Factuality Degree of Events in Text*: https://doi.org/10.1162/COLI_a_00096
- Bijl de Vroe, S. et al. (2021), *Modality and Negation in Event Extraction*: https://aclanthology.org/2021.case-1.6/
- Wu, D. et al. (2025), *LongMemEval: Benchmarking Chat Assistants on Long-Term Interactive Memory*: https://arxiv.org/abs/2410.10813
- Rasmussen, P. et al. (2025), *Zep: A Temporal Knowledge Graph Architecture for Agent Memory*: https://arxiv.org/abs/2501.13956
- Kleppmann, M. et al. (2019), *Local-First Software: You Own Your Data, in spite of the Cloud*: https://martin.kleppmann.com/papers/local-first.pdf
- Shapiro, M. et al. (2011), *Conflict-Free Replicated Data Types*: https://doi.org/10.1007/978-3-642-24550-3_29
- Packer, C. et al. (2023), *MemGPT: Towards LLMs as Operating Systems*: https://arxiv.org/abs/2310.08560
- Gutiérrez, B. J. et al. (2024), *HippoRAG: Neurobiologically Inspired Long-Term Memory for Large Language Models*: https://arxiv.org/abs/2405.14831

## 24. Local references reviewed

- `CLAUDE.md`
- `docs/ARCHITECTURE.md`
- `docs/LLM_PIPELINE.md`
- `docs/PRIVACY_SECURITY.md`
- `docs/SYNC.md`
- `docs/AUTH_DB_LIFECYCLE.md`
- `docs/OKF.md`
- `src/services/pipeline.ts`
- `src/services/llm/prompts/extract-entry.ts`
- `src/services/llm/schemas/entry-extract.schema.ts`
- `src/services/llm/prompts/update-page.ts`
- `src/services/wiki/engine.ts`
- `src/services/wiki/search.ts`
- `src/services/wiki/conversation.ts`
- `src/services/storage/entries.ts`
- `src/services/storage/entities.ts`
- `src/services/storage/wiki.ts`
- `src/services/storage/schema.ts`
- `src/services/storage/migrations.ts`
- `src/services/storage/sync-queue.ts`
- `src/services/graph/engine.ts`
- `src/services/sync/conflict.ts`
- `src/services/sync/engine.ts`
- `server/src/storage/upload.ts`
- `server/src/storage/delta.ts`
- `server/src/auth/logout.ts`
- `src/services/auth/auth.service.ts`
- `src/app/(tabs)/you.tsx`
- `src/app/wiki/[id].tsx`
- `src/components/wiki/SourceChips.tsx`

### External design principles considered

Research also reviewed temporal knowledge-graph, statement-provenance, and agent-memory patterns. Useful principles were retained narrowly:

- represent situations and assertions as first-class records;
- bind participants through event-specific roles;
- attach provenance to situations and assertions;
- distinguish actuality and validity time from record/update time;
- preserve superseded and corrected history;
- separate lossless source, event memory, semantic memory, and narrative synthesis.

No external framework or file format is proposed as runtime dependency. SQLCipher SQLite remains source of truth, consistent with `docs/OKF.md`.

---

## 25. Second architecture review — new findings (2026-08-03)

Second pass cross-checked §1–24 against the *live codebase* (not just the reviewed file list). Eight findings; none invalidate the architecture, several refine assumptions the prior review took as future or baseline. Findings marked **[baseline]** alter behaviour the design must absorb now, not gate.

### 25.1 Source deletion is live code, not a future assumption — baseline

The design (§2.5, §22.8 "Source deletion/edit semantics" as a Medium/future blocker, §23.6) repeatedly assumes entries are immutable and source deletion is future work. **That assumption is false in the current code.**

- `src/services/storage/entries.ts:699` — `deleteEntry()` does `DELETE FROM entries WHERE id = ?` and returns `ok`. It enqueues **no** sync op.
- `src/services/storage/sync-queue.ts` declares `SyncOperation = 'upsert' | 'delete'` but exposes only `enqueueUpsert()`; no call path enqueues a `'delete'`.
- No remote-delete path anywhere (consistent with §22.1, but for *entries now*, not future claim tables).

`deleteEntry` is currently uncalled by UI/sync paths, but the primitive exists and deletion is not a hypothetical. Claim `knowledge_claim_evidence.source_id` may therefore reference a locally-deleted entry while the remote ciphertext and other devices retain it.

**Architecture consequence:** treat **dangling evidence as a baseline state**, not an edge case. Claim/situation projection must resolve missing sources gracefully; "view source for a deleted entry" must degrade (open remaining evidence, or state the source is gone). A user-facing "remove this claim" can retract/hide the claim but cannot promise erasure while the original entry ciphertext and cross-device copies remain — same honesty boundary as §22.2 but for live entry deletion today.

### 25.2 Claim layer has no bridge to crisis / self-distress — unsafe auto-eligibility

§7.2 defers *sensitive* domains (medical, legal, financial, third-party) but **not self-harm / suicidal ideation** — and those are explicitly "autobiographical user-stated", so they fall inside the §9.2 auto-store-eligible set.

A high-emotion entry ("I want to disappear") can promote a `plan`/`emotional_response` situation or an explicit claim. Later that memory is **echoed back in Reflect grounding** as *"You wrote you want to …"* with no emotional-context guard, worsening distress. §23.6(11) filters retrieval by status/sensitivity but says nothing about crisis/self-harm content, and the existing crisis module (`src/services/crisis/`) is never consulted by the claim layer.

**Consequence:** claim extraction must exclude self-harm predicates; retrieval must never ground claims in crisis-triggered flows; auto-store must not fire for high-crisis sources even when fully explicit. This is a safety invariant, not retrieval polish.

### 25.3 Internal contradiction: §9.4 dedupe-reuse vs §22.5 deferred entity identity

§9.4 promises repeated evidence "reuses the canonical active claim" so the About-you view stays non-duplicated. §22.5 says entity identity is source-scoped display labels and automatic person-merge is out of v1 scope. Under those two rules, "my sister" / "Sarah" / "Sis" produce **distinct canonical keys** (because `subject_label` differs), so repeated support creates near-duplicate claims — breaking §9.4 exactly on the aliasing case it exists for, and fragmenting the projection.

**Resolution needed (pick one):** scope dedupe to exact `subject_label + predicate + typed object` (drop the §9.4 "reuse across surface forms" promise), or make alias resolution first-class in v1 rather than deferred. The two sections cannot both hold as written.

### 25.4 Claim re-extraction churns `entries.updated_at` → whole-entry re-upload

`src/services/storage/entries.ts:504` re-tag bumps:

```ts
tags = ?, # mood_score = ?, tagged_at = ?, updated_at = MAX(updated_at + 1, ?) WHERE id = ?
```

Entries sync as one opaque record (`src/services/sync/conflict.ts` SYNCED_TABLES + per-record encryption), so any marker bump re-uploads the whole entry ciphertext. If claim/situation extraction or the §16 backfill writes any shared lifecycle marker on `entries` (or re-tags), the backfill iterating all history re-uploads **every** entry — a sync/bandwidth/thermal storm plus cross-device pull duplicates.

**Requirement:** extraction markers (§6.8 `situations_extracted_version` / `knowledge_extracted_version`) must be new columns that never touch `entries.updated_at` or `tagged_at`, and claim extraction must not re-tag entries. Separate claim records (as designed) sidestep this cleanly only if no marker writes land on the entries row.

### 25.5 Reflect double-evidence: chat message *and* captured entry

`migration005` captures durable Reflect info as `entries` (`source='reflect'`) that also feeds entity recurrence, graph, and wiki. A single fact can therefore surface as both a `chat_message` (direct claim evidence) and a structurally-duplicate captured `entry` → two evidence rows / double support counting, unless the design mandates one canonical source_type per fact. Combine with §25.3: dedupe must collapse across these two source kinds too.

### 25.6 Provenance to a `source='reflect'` entry is invisible to the user

Captured Reflect entries are filtered out of the journal timeline (timeline shows `source='journal'`; see `migration005`). So a claim citing that entry → "View source" opens an entry the user cannot see in the timeline; the durable text lives only inside the captured copy. §11.4/§14 provenance UX misleads. For chat-captured claims "View source" should open the **conversation context**, not the hidden entry.

### 25.7 `origin_device_id` is feasible — keep it out of server-visible metadata

`device_id` already exists (`src/services/auth/device-id.ts`, and server register/login/pair store it), so `origin_device_id` is implementable within existing device-ID rules. Requirement: it must live **inside the encrypted payload**, never as a server-parsed field — the server already holds a plaintext `device_id` on the account row, so do not add another plaintext claim/event-identity loose end.

### 25.8 Rejected-claim retention needs a local purge decision, not just remote

§20.9 asks "should rejected structured records remain in local audit history or be hard-deletable?" Remote hard-delete is impossible under §22.2, but the *local* policy is still open — and "reject" currently implies reject-event + assertion retained forever, doubling the most sensitive rows (a fact the user explicitly disowned stays stored). Decide whether the reject-event should mask the rejected assertion from current retrieval while leaving the immutable audit row, or support true local erasure of the rejected assertion, before Stage-3 correction UX is built.

---

**Priority for address:** §25.1 (source deletion contradicts immutability), §25.2 (crisis safety), §25.3 + §25.5 (canonicalization/dedup tension). None block the overall direction — all refine the implementation contract before SPARC detail.