# MindWiki — LLM Pipeline
# Full prompt templates and service implementations.
# Models: Qwen2.5 1.5B (fast/tag), Qwen2.5 3B (deep/wiki), Qwen2.5 7B+ (weekly)
# All prompts in src/services/llm/prompts/ as TypeScript template strings.
# All LLM output validated with Zod before use.
# Retry: max 3 attempts with exponential backoff. After 3 failures: mark entry is_processed=-1.
# NEVER log entry.content in error paths.

## Weekly digest — multi-agent synthesis

The weekly digest is deterministic stats (`digest/generator.ts`, 6 sections) plus
an additive multi-agent synthesis layer in `src/services/digest/agents/`:

  retriever (pure)  → analyst (deep model)  → critic (pure)  ⟲ orchestrator

- **retriever** (`retriever.ts`) — no LLM. Picks the week's focus labels (top
  emotion + distortion) and gathers material: relevant entries (`wiki/search.ts`
  `rankEntries`), graph neighborhoods (`graph/neighborhood.ts`), and relevant
  wiki pages (`rankPages`). Returns a `DigestMaterial` bundle.
- **analyst** (`analyst.ts`) — deep model (Qwen2.5 3B). Prompt
  `prompts/digest-synthesis.ts`, output Zod-validated by
  `schemas/digest-synthesis.schema.ts` → `{ themes, patterns, openQuestions }`
  (1–4 short lines each). Grounded: "use ONLY the material below".
- **critic** (`critic.ts`) — no LLM. Drops any theme/pattern that no source entry
  supports (term-overlap check) into `flaggedClaims`; open questions are prompts,
  not assertions, so they are always kept.
- **orchestrator** (`orchestrator.ts`) — runs retriever → analyst (bounded retry
  on Zod failure) → critic. Best-effort and additive: on any failure (or when
  nothing survives the critic) it returns the deterministic digest unchanged with
  no `synthesis` — never throws, never blocks the digest (ADR 004).

Runs in the background off the digest screen (`useDigest.ts`), which shows a
loading indicator while the deep model works. The 7B+ "weekly" slot above is
reserved for future use; synthesis currently runs on the 3B deep model.

## Belief semantic dedup (snap after entity extraction)

Every entry's extracted belief labels go through a two-layer dedup in
`src/services/wiki/belief-snap.ts`:

1. **Text normalization** (`src/services/llm/taxonomy.ts`:
   `canonicalizeBelief`, `normalizeBeliefs`) — exact surface normalization:
   "I'm not good enough." → "I am not good enough". Contractions, common
   intensifiers, and trailing punctuation are normalised deterministically.

2. **Embedding snap** (`snapBeliefsSemantic`) — each canonical label is embedded
   (EmbeddingGemma-300m, 768-dim, `task: sentence similarity | query: ` prefix)
   and cosine-compared against all stored belief vectors. A match at or above
   `BELIEF_COSINE_THRESHOLD = 0.78` snaps the new label to the existing one, so
   "I am inadequate" resolves to "I am not good enough" instead of creating a
   separate wiki page.

### Frame-strip geometry (critical detail)

EmbeddingGemma over-weights the shared "I am [not/never]…" frame on short belief
phrases, producing an **inverted window** — a frame-sharing distinct belief
("I am not worthy of a good partner") out-scores a true synonym ("I am never
enough") against the anchor. No threshold separates an inverted window.

Fix: strip the leading first-person frame BEFORE embedding:

```typescript
const BELIEF_FRAME = /^i\s+(?:am|feel|'m)\s+(?:not\s+|never\s+)?/i
function stripBeliefFrame(label: string): string {
  return label.replace(BELIEF_FRAME, '').trim()
}
```

The content word ("partner", "enough") dominates after stripping, and the window
re-opens. **Only the embedding vector uses stripped text** — the stored label
(retrieved by `snapBeliefSemantic`) stays the full original form.

### Polarity guard (reframe safety)

Full-strip removes "not/never" along with the subject, so a belief and its
positive reframe collapse to identical text (cosine 1.000): "I am not good
enough" and "I am good enough" both strip to "good enough". The snap loop has a
narrow guard: it refuses to merge two beliefs whose **stripped forms match AND
polarity differs**. Negative synonyms without "not" ("I feel worthless") still
snap to the negated anchor — the guard is polarity-specific, not blanket.

```typescript
const BELIEF_FRAME_NEGATED = /^i\s+(?:am|feel|'m)\s+(?:not|never)\s+/i
function isNegatedBelief(label: string): boolean {
  return BELIEF_FRAME_NEGATED.test(label)
}
```

### Backfill geometry matching

`backfillBeliefEmbeddings()` must embed via the same stripped path
(`embedBeliefLabel`) that snaps use — not raw `embedText`. If stored vectors
mix geometries, the cosine comparison re-collapses the window. The backfill
dedup keys on `hash(rawLabel)` (djb2, model-independent), so re-running the
code alone skips every stored row; a **new migration** (`DELETE FROM
entity_embeddings WHERE type = 'belief'`) is required to force re-embed under
a changed geometry. Current wipe migrations: 025 (gemma swap), 026 + 027
(frame-strip & backfill fix).
