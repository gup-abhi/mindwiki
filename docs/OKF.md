# OKF — Open Knowledge Format (design note)

> Status: **investigation / deferred**. No code yet. Written 2026-07-04.
> Decision: adopt a high-value *subset* as a rendered view when we next touch
> wiki grounding — not a wholesale adoption, not now.

## What OKF is

[Open Knowledge Format v0.1](https://github.com/GoogleCloudPlatform/knowledge-catalog/tree/main/okf)
is Google Cloud's open, vendor-neutral spec that formalizes Karpathy's "LLM Wiki"
pattern — the same pattern MindWiki is built on (ADR 001). It represents knowledge
as **plain markdown files with YAML frontmatter**, organized in a directory tree:

- One markdown file per concept; the file path is the concept's identity.
- Frontmatter: **`type` is the only required field** (freeform, no registry).
  Recommended: `title`, `description` (one sentence), `resource` (URI), `tags`,
  `timestamp` (ISO 8601). Extension keys are allowed and must be preserved.
- Reserved files: `index.md` (per-directory listing → progressive disclosure) and
  `log.md` (change history, newest-first, ISO date headings). Both optional.
- Links are plain markdown; they assert untyped relationships → a graph.
- **Forgiving parser:** consumers must not reject a bundle for missing optional
  fields, unknown `type`, unknown keys, broken links, or missing `index.md`.
- `okf_version: "0.1"` may be declared in the bundle-root `index.md`.

## Why we care

The knowledge is the compounding asset; the model is replaceable. A standardized,
self-describing wiki is **read consistently by any model**, and a *better* model can
**exploit it better** (walk an `index.md` to the relevant concept instead of being
fed raw content prefixes). That last point is the real, model-independent win — it
directly addresses our grounding weakness (small `n_ctx`, raw ~600-char page
prefixes fed to Reflect/synthesis).

**Honest limit:** OKF standardizes the *knowledge representation*, NOT the
*model-integration mechanics*. What made the Qwen3.5-4B swap painful — ChatML/prompt
template, hybrid-arch speed, thinking tokens — OKF does not touch. It makes the wiki
portable and cleanly consumable; it does not make model swaps easy.

## MindWiki → OKF mapping (we're ~85% there)

| OKF v0.1 | MindWiki today | Gap |
|---|---|---|
| markdown file per concept | `wiki_pages` row, `content` is markdown | stored in SQLite, not files |
| `type` (required) | `category` (emotion/distortion/theme/person/place/activity/belief/behavior) | surface as frontmatter |
| `title` | `title` | direct |
| `description` | — | missing; derive/synthesize a one-liner |
| `resource` (URI) | — | N/A for personal concepts — skip |
| `tags` | — (tags are on entries) | optional |
| `timestamp` | `updated_at` | reformat to ISO 8601 |
| extension keys | `entry_count`, `version`, `dismissed_at`, `corrected_at` | carry as extensions |
| `log.md` | `version_history` (JSON snapshots) | same concept, reserialize |
| `index.md` | category-list screen (not data) | **missing as data — the grounding win** |
| links = graph | lineage + `graph_nodes/edges` | already richer |

## The decision

**Keep SQLCipher SQLite as the source of truth.** OKF is a file format; do NOT move
the store to markdown files (we'd lose parameterized search/joins and complicate
encryption for no gain). Instead, treat OKF as a **rendered view** — a pure,
on-device function that materializes pages as OKF when needed.

**Adopt (when we next touch grounding):**
- The **frontmatter contract** (`type`/`title`/`description`/`timestamp` + extensions)
  — a clean, model-agnostic surface.
- **`index.md` progressive disclosure** for how pages are fed to the model — replaces
  raw prefixes with navigable, relevant context. Improves quality regardless of model.

**Skip / never adopt:**
- Distribution (tarballs, git repos, hosting, serving) — antithetical to the
  on-device, encrypted, nothing-leaves-the-phone privacy model.
- File-based storage — keep SQLCipher.
- `resource` URIs — no external asset per concept.

**Defer** the full "OKF as export/interchange" until there's a concrete need — an
opt-in cloud model, or an export feature. Neither exists today.

## Minimal first step (when ready, ~1 day, no migration)

Pure, on-device, additive — store/schema/privacy untouched, fully testable:

```
renderPageAsOKF(page): string          // frontmatter + content (+ log.md from version_history)
renderWikiIndex(pages): string         // index.md — progressive disclosure for grounding
```

Wire `renderWikiIndex` / `renderPageAsOKF` into `wiki/conversation.ts` grounding so
Reflect/synthesis navigate a structured index to the relevant concept instead of
raw content prefixes. Measure grounding quality before/after (the wiki-synthesis eval
harness is the net).

## Sources
- Spec: <https://github.com/GoogleCloudPlatform/knowledge-catalog/tree/main/okf> (`SPEC.md`)
- Google Cloud blog: <https://cloud.google.com/blog/products/data-analytics/how-the-open-knowledge-format-can-improve-data-sharing/>
