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
