# MindWiki Graph/Map Audit — Remediation Plan

Status: **executed** (commits `7f2845a`, `eea1b9c` on `main`). Physical-device matrix deferred — V1–V7 checklist now lives in Settings → Developer → "Graph audit verification matrix" (`DevGraphAudit.tsx`).

## Findings (verified, 2026-07-26)

| # | Sev | Where | Issue | Status |
|---|-----|-------|-------|--------|
| F1 | P0 | `src/components/graph/Graph3D.tsx::buildGraphHtml` | `JSON.stringify` inlined labels `</script>`/`<img>` into the script context — XSS / script-tag escape. | **fixed** — `jsonForInlineScript` escapes `<`,`>`,`&`,U+2028,U+2029. |
| F2 | P1 | `src/services/storage/graph.ts::restoreNodeDismissal` | Update + `enqueueUpsert` run outside a transaction — half-restored state on crash. | **fixed** — wrapped in `db.transaction`, `enqueueUpsert` failure throws, atomic rollback. |
| F3 | P1 | `storage/graph.ts::nodeDismissalKey` + `graph/engine.ts` derivation skip | Cross-type resurrection: dropping `place:Work` does not stop `situation:Work`. **Product decision: keep (type,label) exact.** | **documented** — comments above `nodeDismissalKey` + derivation skip; cross-type regression test locks intent. |
| F4 | P2 | `Graph3D.tsx` WebView props | No CSP, `originWhitelist=['*']`, no navigation guard. | **fixed** — CSP meta `default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' …`; `originWhitelist=['about:blank']`; `onShouldStartLoadWithRequest` blocks non-`about:blank`. |
| F5 | P2 | `graph/engine.ts::rebuildGraphImpl` | Recurrence-gate freq=1 at trip; rebuild backfills counts. **Accepted divergence.** | **locked** — `materializes only…` test asserts live `frequency=1` at gate-trip even when `support=2`; new rebuild test asserts `frequency=2` after full re-derive. |
| F6 | P2 | `Graph3D.tsx::buildLabels/updateLabels` | O(n²) collision work scales with node count. | **fixed** — `LABELED` sorted once in `buildLabels`, sliced to 250; focused node always kept; `updateLabels` iterates the bounded set. |
| F7 | P2 | `services/insights/affect-map.ts::buildEmotionAggregate` | `dominant` lookup unsafely indexes empty `entries.sort(...)[0]`. | **fixed** — `?? 'neutral'` fallback. |
| F8 | P3 | `__tests__/services/graph/engine.test.ts` | Call-count-only assertions — didn't catch freq/weight regressions. | **fixed** — stateful `mockUpsertNode`/`mockUpsertEdge`; assertions on actual `frequency`/`weight` values. |
| F9 | P3 | `storage/graph.ts::dismissNode` | Per-row deletes — not actually N+1 because `UNIQUE(type,label)` constrains rows to ≤1 each; the loop is cosmetic. | **skipped (no-op)** — `UNIQUE(type,label)` constraint already caps rows at 1; batched `IN (…)` adds nothing. |
| F10 | P3 | `hooks/useGraph.ts` + `services/graph/layout.ts::computeLayout` | Layout output unused (no caller destructured); on-thread computation also pointless. | **fixed (alternative path)** — dropped `width`/`height` params, removed `computeLayout` import + unused `layout` field from hook. `layout.ts` retained for future caller. No `InteractionManager` defer needed. |

## Reality divergences (vs. earlier draft)

* **F9 batching is a no-op.** `graph_nodes.type/label` already dedup to one row; loop runs at most once. **Skipped cosmetic change.**
* **F10 computeLayout was dead code.** `useGraph` returned `layout` but no caller used it. Removed hook params + `computeLayout` import; `layout.ts` retained for any future caller but unused. **No InteractionManager defer needed.**
* **F1 escape must NOT touch `\`** — JSON keys/strings use it. Replace only `<`→`\u003c`, `>`→`\u003e`, `&`→`\u0026`, U+2028/2029.
* **F4 webview navigation** — `originWhitelist=[]` + block-all `onShouldStartLoadWithRequest` bricks the static HTML; the initial `about:blank` URL is required. Use `originWhitelist=['about:blank']` and the navigation guard only allows `about:blank`.
* **F6 cap** — applies to every graph (not just >400), computed once in `buildLabels` (not per-frame in `updateLabels`).

## Tests added (TDD, all green)

* `Graph3D.test.tsx` — CSP meta present + `connect-src 'none'`; attack label `</script><img src=x onerror=alert(1)>\u2028<script>` produces exactly 2 `<script>` tags, no `<img>`, and `\u003c/script\u003e` + `\u2028` appear in escaped form; `originWhitelist` is `['about:blank']` and `onShouldStartLoadWithRequest` blocks non-`about:blank`.
* `storage/graph.test.ts` — `restoreNodeDismissal` UPDATE + `INSERT INTO sync_queue` both run inside `db.transaction`; nested-transaction mock guard proves it; returns `GRAPH_NODE_NOT_FOUND` for unknown id.
* `graph/engine.test.ts` — `materializes only the signals corroborated by >=2 entries` now asserts that the live `frequency` for the surviving emotion node starts at 1 even when support is 2 (locked gate-trip semantics); `rebuild backfills exact recurring node frequency and edge weight` walks two entries through a stateful `mockUpsertNode`/`mockUpsertEdge` and asserts `emotion:anxiety` and `distortion:catastrophizing` reach `frequency=2` and the edge between them reaches `weight=2`; cross-type resurrection test confirms dropping `place:work` does not suppress a derived `situation:Work`.
* `DevGraphAudit.test.tsx` — `V1–V7` checklist renders, rows toggle, modal closes.

## Verification

```
$ yarn jest --runInBand
Test Suites: 161 passed, 161 total
Tests:       1519 passed, 1519 total
$ yarn tsc --noEmit
Done in 6.24s.
$ yarn lint
0 errors
```

(Lint warnings unchanged from baseline; 0 new violations introduced.)

## Physical-device verification

Now shippable via Settings → Developer → "Graph audit verification matrix" (`DevGraphAudit.tsx`). V1–V7 checks remain manual on Android + iOS:

| # | Check |
|---|-------|
| V1 | Map renders, ≥30 fps pan/zoom |
| V2 | Attack label does not break out of `<script>` |
| V3 | Dismiss/restore round-trips across devices |
| V4 | Cross-type resurrection (product intent) |
| V5 | 1500-node graph opens <1.5s, smooth pan |
| V6 | WebView navigation blocked |
| V7 | Restore is atomic (no half-state on crash) |

## Commits

```
7f2845a fix(graph): F1 XSS, F2 atomic restore, F4 CSP, F5/F8 frequency locks, F6 label cap, F7 default, F10 dead layout
eea1b9c feat(settings,dev): graph audit verification matrix (V1–V7) checklist
```

## Plan complete

All 10 findings resolved or explicitly skipped with reason. Code, tests, plan, and verification matrix shipped.