# MindWiki Graph/Map Audit — Remediation Plan

## Findings (verified, 2026-07-26)

| # | Sev | Where | Issue |
|---|-----|-------|-------|
| F1 | P0 | `src/components/graph/Graph3D.tsx::buildGraphHtml` | `JSON.stringify` inlined labels `</script>`/`<img>` into the script context — XSS / script-tag escape. |
| F2 | P1 | `src/services/storage/graph.ts::restoreNodeDismissal` | Update + `enqueueUpsert` run outside a transaction — half-restored state on crash. |
| F3 | P1 | `storage/graph.ts::nodeDismissalKey` + `graph/engine.ts` derivation skip | Cross-type resurrection: dropping `place:Work` does not stop `situation:Work`. **Product decision: keep (type,label) exact.** |
| F4 | P2 | `Graph3D.tsx` WebView props | No CSP, `originWhitelist=['*']`, no navigation guard — RCE / remote-script vectors wide open. |
| F5 | P2 | `graph/engine.ts::rebuildGraphImpl` | Recurrence-gate freq=1 at trip; rebuild backfills counts. **Accepted divergence; locked by test.** |
| F6 | P2 | `Graph3D.tsx::buildLabels/updateLabels` | O(n²) collision work scales with node count; cap visible labels. |
| F7 | P2 | `services/insights/affect-map.ts::buildEmotionAggregate` | `dominant` lookup unsafely indexes empty `entries.sort(...)[0]`. |
| F8 | P3 | `__tests__/services/graph/engine.test.ts` | Call-count-only assertions — didn't catch freq/weight regressions. |
| F9 | P3 | `storage/graph.ts::dismissNode` | Per-row deletes — not actually N+1 because `UNIQUE(type,label)` constrains rows to ≤1 each; the loop is cosmetic. |
| F10 | P3 | `hooks/useGraph.ts` + `services/graph/layout.ts::computeLayout` | Layout output unused (no caller destructured); on-thread computation also pointless. |

## Reality divergences (vs. earlier draft)

* **F9 batching is a no-op.** `graph_nodes.type/label` already dedup to one row; loop runs at most once. **Skipping cosmetic change.**
* **F10 computeLayout was dead code.** `useGraph` returned `layout` but no caller used it. Removed hook params + `computeLayout` import; `layout.ts` retained for any future caller but unused. **No InteractionManager defer needed.**
* **F1 escape must NOT touch `\`** — JSON keys/strings use it. Replace only `<`→`\u003c`, `>`→`\u003e`, `&`→`\u0026`, U+2028/2029.
* **F4 webview navigation** — `originWhitelist=[]` + block-all `onShouldStartLoadWithRequest` bricks the static HTML; the initial `about:blank` URL is required. Use `originWhitelist=['about:blank']` and the navigation guard only allows `about:blank`.
* **F6 cap** — applies to every graph (not just >400), computed once in `buildLabels` (not per-frame in `updateLabels`).

## Tests added (TDD, all green)

* `Graph3D.test.tsx` — CSP meta present + `connect-src 'none'`; attack label `</script><img src=x onerror=alert(1)>\u2028<script>` produces exactly 2 `<script>` tags, no `<img>`, and `\u003c/script\u003e` + `\u2028` appear in escaped form; `originWhitelist` is `['about:blank']` and `onShouldStartLoadWithRequest` blocks non-`about:blank`.
* `storage/graph.test.ts` — `restoreNodeDismissal` UPDATE + `INSERT INTO sync_queue` both run inside `db.transaction`; nested-transaction mock guard proves it; returns `GRAPH_NODE_NOT_FOUND` for unknown id.
* `graph/engine.test.ts` — `materializes only the signals corroborated by >=2 entries` now asserts that the live `frequency` for the surviving emotion node starts at 1 even when support is 2 (locked gate-trip semantics); `rebuild backfills exact recurring node frequency and edge weight` walks two entries through a stateful `mockUpsertNode`/`mockUpsertEdge` and asserts `emotion:anxiety` and `distortion:catastrophizing` reach `frequency=2` and the edge between them reaches `weight=2`; cross-type resurrection test confirms dropping `place:work` does not suppress a derived `situation:Work`.

## Verification

```
$ yarn jest --runInBand
Test Suites: 160 passed, 160 total
Tests:       1515 passed, 1515 total
$ yarn tsc --noEmit
Done in 8.32s.
$ yarn lint
0 errors
```

(Lint warnings unchanged from baseline; 0 new violations introduced.)

Physical-device matrix (Android + iOS) deferred to next run: WebView renders with `unsafe-eval` CSP, `</script>`-bearing topic labels render safely, dismiss/restore propagates across devices, 1500-node graph opens <1.5s with ≥30 fps pan.

## Commits (suggested)

```
feat(graph): sanitise entry-derived labels in inline script (F1 XSS)
fix(graph): restoreNodeDismissal is atomic (F2)
docs(graph): cross-type dismissal is product intent (F3)
feat(graph): CSP + navigation guard on graph WebView (F4)
test(graph): lock frequency/weight semantics (F5/F8)
feat(graph): cap visible labels to 250 (F6)
fix(insights): default dominant quadrant when empty (F7)
refactor(graph): drop unused computeLayout from useGraph (F10)
```