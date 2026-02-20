# Codebase Decomposition Audit

**Date**: 2026-02-18
**Branch**: fix/review-findings
**Scope**: All source files 300+ lines or with multiple responsibilities

---

## Files Over 300 Lines (47 total)

| Lines | File | Verdict |
|------:|------|---------|
| 1,282 | `packages/server/src/services/reportCardEngine.ts` | **SPLIT** — 12 detectors + scorer + cache in one file |
| 1,237 | `apps/dashboard/src/components/panels/AgentDetailPanel.tsx` | **SPLIT** — panel layout + AI analysis + formatters + tool dispatch |
| 1,101 | `packages/server/src/db.ts` | **SPLIT** — init + persistence + 30 queries + schema + pruning |
| 1,097 | `packages/server/src/routes/analytics.ts` | **SPLIT** — 24 endpoints across 5 domains |
| 1,012 | `apps/vscode/src/settingsPanel.ts` | **SKIP** — VS Code webview, HTML template, self-contained |
| 1,002 | `apps/dashboard/src/components/analytics/insights/InsightsView.tsx` | **SPLIT** — badges + budget + AI coach + modals |
| 918 | `apps/dashboard/src/components/panels/ToolDetailRenderers.tsx` | **OK** — registry pattern, 30 small renderers, cohesive |
| 867 | `apps/dashboard/src/components/analytics/nudges/LiveNudgesView.tsx` | **SPLIT** — feed + config + rule stats + escalation tester |
| 759 | `apps/dashboard/src/store/agentStore.ts` | **SPLIT** — state shape + dedup + time filter + node removal + WS wiring |
| 685 | `apps/dashboard/src/components/graph/AgentGraph.tsx` | **SPLIT** — render + visibility filter + edge styling + auto-pan |
| 681 | `apps/dashboard/src/store/__tests__/agentStore.test.ts` | **OK** — test file, size is proportional to store complexity |
| 678 | `apps/dashboard/src/components/analytics/prompts/PromptAnalyzer.tsx` | **SPLIT** — list + filter + analysis + comparison + workshop bridge |
| 653 | `apps/dashboard/src/store/eventHandlers.ts` | **OK** — 16 handlers are cohesive; already extracted from store |
| 617 | `packages/server/src/services/nudgeEngine.ts` | **SPLIT** — 30 regex patterns + accumulator + rule eval + cache |
| 579 | `packages/server/src/__tests__/analyticsRoutes.test.ts` | **OK** — test file |
| 575 | `packages/server/src/__tests__/nudgeEngine.test.ts` | **OK** — test file |
| 534 | `packages/server/src/__tests__/db.test.ts` | **OK** — test file |
| 527 | `apps/dashboard/src/components/analytics/workshop/PromptWorkshop.tsx` | **BORDERLINE** — focused on one job, could extract model selector |
| 515 | `apps/dashboard/src/components/panels/ToolGroupDetailView.tsx` | **OK** — single purpose |
| 491 | `apps/dashboard/src/components/analytics/replay/SessionReplay.tsx` | **OK** — single purpose |
| 469 | `apps/dashboard/src/hooks/useAutoLayout.ts` | **OK** — single algorithm, well-documented |
| 449 | `apps/dashboard/src/components/lens/treemap/TreemapView.tsx` | **OK** — single visualization |
| 449 | `apps/dashboard/src/components/lens/LensAdapter.tsx` | **OK** — tab shell, proportional |
| 442 | `apps/dashboard/src/components/analytics/executive/ExecutiveOverview.tsx` | **OK** — single dashboard |
| 428 | `packages/server/src/services/aiCoachService.ts` | **OK** — one service |
| 411 | `apps/dashboard/src/components/graph/nodes/ToolGroupNode.tsx` | **OK** — one node type |
| 404 | `apps/dashboard/src/components/analytics/mockData.ts` | **OK** — test data |
| 382 | `apps/dashboard/src/components/lens/sankey/SankeyView.tsx` | **OK** — single visualization |
| 377 | `packages/server/src/services/eventStore.ts` | **SPLIT** — normalization + enrichment + storage in one pipeline |
| 367 | `apps/dashboard/src/components/analytics/coaching/ReportCardPanel.tsx` | **OK** — single panel |
| 359 | `packages/server/src/services/agentManager.ts` | **OK** — single service |
| 358 | `apps/dashboard/src/components/lens/cost/CostWaterfallView.tsx` | **OK** — single visualization |
| 348 | `apps/vscode/src/extension.ts` | **OK** — VS Code lifecycle, proportional |
| 337 | `packages/server/src/routes/coaching.ts` | **SPLIT** — report cards + nudges + playbooks + rules |
| 326 | `apps/dashboard/src/components/analytics/useAnalyticsData.ts` | **SPLIT** — time conversion + 7 fetchers + response mapping |
| 335 | `apps/dashboard/src/components/lens/lensComputations.ts` | **OK** — pure computation helpers |
| 316 | `apps/dashboard/src/components/lens/compaction/CompactionView.tsx` | **OK** — single visualization |
| 310 | `scripts/simulate_session.ts` | **OK** — script |
| 306 | `apps/dashboard/src/components/analytics/export/ExportDialog.tsx` | **OK** — single dialog |
| 303 | `apps/dashboard/src/hooks/__tests__/useAutoLayout.test.ts` | **OK** — test file |

**Summary**: 14 files need splitting, 6 are borderline, rest are fine.

---

## Repeated Patterns to Consolidate

### 1. Route error handling — 54 identical `catch(err) → 500` blocks

Every route handler in `packages/server/src/routes/` wraps its body in:
```ts
try { ... } catch (err) {
  logger.error({ err }, 'message');
  res.status(500).json({ error: 'Internal server error' });
}
```
This appears **56 times** across 7 route files.

**Extract**: `asyncRoute()` wrapper in `packages/server/src/lib/asyncRoute.ts`:
```ts
export function asyncRoute(handler: (req, res) => void | Promise<void>) {
  return (req, res, next) => {
    try { const result = handler(req, res); if (result instanceof Promise) result.catch(next); }
    catch (err) { next(err); }
  };
}
```
Combined with an Express error middleware that logs + returns 500.

### 2. localStorage try-catch — 19 occurrences across 6 dashboard files

Files: `AgentDetailPanel.tsx`, `AnalyticsPage.tsx`, `PromptAnalyzer.tsx`, `PlaybookPanel.tsx`, `PromptWorkshop.tsx`, `agentStore.ts`

**Extract**: `useLocalStorage(key, defaultValue)` hook in `apps/dashboard/src/hooks/useLocalStorage.ts`

### 3. `parseTimeRange` + `buildWhereClause` — duplicated in 2 route files

Both `analytics.ts` and `coaching.ts` define/import these. They should live in a shared helper.

**Extract**: `packages/server/src/lib/queryHelpers.ts`

### 4. Inline markdown formatting — duplicated in 3+ components

`AgentDetailPanel.tsx`, analytics components each have their own bold/italic/code regex formatter.

**Extract**: Already partially done in `apps/dashboard/src/components/analytics/shared/formatMarkdown.tsx` — wire remaining usages to it.

---

## Detailed Split Plans

### Split 1: `routes/analytics.ts` (1,097 lines → 5 files)

**Current state**: 24 endpoints crammed into one router covering overview stats, timeseries, sessions, tools, models, velocity, prompts, insights, budget, badges, plans, prices, import, AI coach, model optimization.

**Split into**:
| New file | Endpoints | ~Lines |
|----------|-----------|--------|
| `routes/analytics/overview.ts` | `/overview`, `/timeseries`, `/sessions`, `/turns` | ~250 |
| `routes/analytics/tools.ts` | `/tools`, `/tools/:name`, `/models`, `/model-optimization` | ~200 |
| `routes/analytics/coaching.ts` | `/velocity/*`, `/prompts/*`, `/insights/*`, `/budget/*`, `/badges/*` | ~250 |
| `routes/analytics/admin.ts` | `/prices/*`, `/plans/*`, `/import/*`, `/ai/*` | ~200 |
| `routes/analytics/index.ts` | Re-export combined router + shared `parseTimeRange`/`buildWhereClause` | ~50 |

**Shared helpers** extracted to `routes/analytics/_helpers.ts`: `parseTimeRange()`, `buildWhereClause()`, `extractSessionFilter()`.

### Split 2: `db.ts` (1,101 lines → 5 files)

**Current state**: init + persistence + schema + 30 query functions + pruning.

**Split into**:
| New file | Contents | ~Lines |
|----------|----------|--------|
| `db/init.ts` | `initDb()`, `scheduleSave()`, `performSave()`, `closeDb()`, schema creation | ~150 |
| `db/events.ts` | `insertEvent()`, `getEvents()`, `getEventsBySession()`, `deleteEvents()`, `pruneOldEvents()` | ~200 |
| `db/sessions.ts` | Session rollup queries, session list, session stats | ~150 |
| `db/coaching.ts` | Report card CRUD, nudge CRUD, playbook queries, price history | ~250 |
| `db/analytics.ts` | `analyticsQueryAll()`, `analyticsQueryGet()`, `analyticsExecute()` | ~100 |
| `db/index.ts` | Re-exports everything, exposes `getDb()` accessor | ~30 |

The `db` instance becomes a module-level singleton accessed via `getDb()` from `db/init.ts`.

### Split 3: `reportCardEngine.ts` (1,282 lines → 4 files)

**Current state**: `SessionContext` interface + `buildSessionContext()` + context cache + 12 dimension detectors + score calculator.

**Split into**:
| New file | Contents | ~Lines |
|----------|----------|--------|
| `services/reportCard/context.ts` | `SessionContext` type, `buildSessionContext()`, context cache | ~200 |
| `services/reportCard/detectors.ts` | All 12 `detect*()` functions (completeness, efficiency, velocity, etc.) | ~600 |
| `services/reportCard/scorer.ts` | `computeReportCard()`, score aggregation, grade calculation | ~200 |
| `services/reportCard/index.ts` | Re-exports public API | ~20 |

### Split 4: `AgentDetailPanel.tsx` (1,237 lines → 4 files)

**Current state**: Panel shell + tool list + AI analysis section + inline formatters + tool dispatch.

**Split into**:
| New file | Contents | ~Lines |
|----------|----------|--------|
| `panels/AgentDetailPanel.tsx` | Panel shell, tabs, overflow, tool list rendering | ~400 |
| `panels/AgentAIAnalysis.tsx` | AI analysis fetch, cache (useLocalStorage), developer/vibe toggle, display | ~300 |
| `panels/AgentToolList.tsx` | Filterable tool list with search, sort, summary stats | ~250 |
| `panels/agentPanelUtils.ts` | `formatInlinePanel()`, `panelCacheKey()`, cost/complexity computations | ~100 |

### Split 5: `InsightsView.tsx` (1,002 lines → 3 files)

**Split into**:
| New file | Contents | ~Lines |
|----------|----------|--------|
| `insights/InsightsView.tsx` | Page shell + tab orchestration | ~200 |
| `insights/BadgeSection.tsx` | Badge grid, earn logic, progress display | ~300 |
| `insights/BudgetSection.tsx` | Budget progress bar, budget modal, reset | ~250 |
| `insights/AICoachSection.tsx` | AI coach status, recommendation fetch, settings modal | ~250 |

### Split 6: `LiveNudgesView.tsx` (867 lines → 3 files)

**Split into**:
| New file | Contents | ~Lines |
|----------|----------|--------|
| `nudges/LiveNudgesView.tsx` | Feed shell + nudge cards + dismiss/undo | ~350 |
| `nudges/NudgeConfigPanel.tsx` | Severity filter, rule toggles, sensitivity sliders | ~250 |
| `nudges/RuleStatsPanel.tsx` | Per-rule stats dashboard + escalation tester | ~250 |

### Split 7: `agentStore.ts` (759 lines → 3 files)

**Split into**:
| New file | Contents | ~Lines |
|----------|----------|--------|
| `store/agentStore.ts` | State shape + actions (selectNode, toggles, etc.) | ~350 |
| `store/eventPipeline.ts` | `eventFingerprint()`, `wsDedupeKey()`, `isWsDuplicate()`, queue replay, `ingestBatch()` | ~200 |
| `store/timeFilter.ts` | Time range state, persistence, `loadTimeRange()`, `computeFilterRange()` | ~100 |

### Split 8: `AgentGraph.tsx` (685 lines → 3 files)

**Split into**:
| New file | Contents | ~Lines |
|----------|----------|--------|
| `graph/AgentGraph.tsx` | ReactFlow rendering, controls, minimap, keyboard shortcuts | ~300 |
| `graph/useVisibleNodes.ts` | Visibility memo (collapse, search filter, toolGroup replacement, auto-close) | ~200 |
| `graph/useEdgeStyling.ts` | Cost gradient computation, edge type selection | ~80 |

### Split 9: `nudgeEngine.ts` (617 lines → 3 files)

**Split into**:
| New file | Contents | ~Lines |
|----------|----------|--------|
| `services/nudgeEngine.ts` | Core engine: evaluate rules, manage accumulator, cache | ~200 |
| `services/nudgePatterns.ts` | All 30 regex patterns (bash ops, git, secrets, process kill) | ~150 |
| `services/nudgeAccumulator.ts` | `SessionAccumulator` interface, accumulator builder from events | ~150 |

### Split 10: `PromptAnalyzer.tsx` (678 lines → 3 files)

**Split into**:
| New file | Contents | ~Lines |
|----------|----------|--------|
| `prompts/PromptAnalyzer.tsx` | Prompt list shell + filters | ~250 |
| `prompts/PromptAnalysisPanel.tsx` | AI analysis toggle, developer/vibe modes, comparison view | ~250 |
| `prompts/PromptActions.tsx` | Copy-to-workshop, session replay bridge, export | ~150 |

### Split 11: `eventStore.ts` (377 lines → 2 files)

**Split into**:
| New file | Contents | ~Lines |
|----------|----------|--------|
| `services/eventStore.ts` | `ingestEvent()` pipeline: validate → normalize → enrich → store → broadcast | ~150 |
| `services/hookNormalizer.ts` | `normalizeHookPayload()`, `extractEventText()`, hook_event_name→AgentEventType map | ~200 |

### Split 12: `useAnalyticsData.ts` (326 lines → 2 files)

**Split into**:
| New file | Contents | ~Lines |
|----------|----------|--------|
| `analytics/useAnalyticsData.ts` | Hook: state, loading, error, composed fetch calls | ~150 |
| `analytics/analyticsApi.ts` | 7 fetch functions (`fetchOverview`, `fetchTimeseries`, etc.) + response converters | ~180 |

### Split 13: `routes/coaching.ts` (337 lines → 3 files)

**Split into**:
| New file | Contents | ~Lines |
|----------|----------|--------|
| `routes/coaching/reportCards.ts` | Report card CRUD (single + batch) | ~120 |
| `routes/coaching/nudges.ts` | Nudge CRUD + dismiss/acknowledge | ~120 |
| `routes/coaching/index.ts` | Combined router + playbook/rule endpoints | ~100 |

---

## Step-by-Step Execution Plan

### Phase 1: Shared Infrastructure (easiest wins, highest reuse)

**Step 1.1 — `asyncRoute` wrapper**
- Create `packages/server/src/lib/asyncRoute.ts`
- Add Express error middleware to `app.ts`
- Replace 54 try-catch blocks across all 7 route files
- **Verify**: `pnpm test` (all server tests), manually POST a bad event to confirm 500 still returns JSON

**Step 1.2 — `useLocalStorage` hook**
- Create `apps/dashboard/src/hooks/useLocalStorage.ts`
- Replace 19 manual localStorage calls in 6 files
- **Verify**: `pnpm test` (dashboard tests), open the dashboard and check that view settings, AI mode, and time filter all persist across reloads

**Step 1.3 — Query helpers extraction**
- Move `parseTimeRange()` + `buildWhereClause()` to `packages/server/src/lib/queryHelpers.ts`
- Update imports in `analytics.ts` and `coaching.ts`
- **Verify**: `pnpm test` — analyticsRoutes.test.ts + coachingRoutes.test.ts both pass

**Step 1.4 — Wire `formatMarkdown.tsx` everywhere**
- Replace `formatInlinePanel()` in AgentDetailPanel.tsx and any other inline formatters with the shared `formatMarkdown` component
- **Verify**: Open detail panel, confirm bold/italic/code renders correctly

### Phase 2: Server-Side Splits (independent of frontend)

**Step 2.1 — Split `db.ts` into `db/` directory**
- Create `packages/server/src/db/` with init.ts, events.ts, sessions.ts, coaching.ts, analytics.ts, index.ts
- Re-export everything from `db/index.ts` so existing `import from '../db.js'` still works
- **Verify**: `pnpm test` — all 534 lines of db.test.ts pass, server starts, events flow in

**Step 2.2 — Split `routes/analytics.ts` into sub-routers**
- Create `packages/server/src/routes/analytics/` directory
- Move endpoints into overview.ts, tools.ts, coaching.ts, admin.ts
- analytics/index.ts mounts sub-routers and re-exports
- **Verify**: `pnpm test` — all 579 lines of analyticsRoutes.test.ts pass, dashboard analytics page loads

**Step 2.3 — Split `reportCardEngine.ts` into `services/reportCard/`**
- Create context.ts, detectors.ts, scorer.ts, index.ts
- **Verify**: `pnpm test` — nudgeEngine.test.ts passes (it exercises report card via coaching routes)

**Step 2.4 — Split `nudgeEngine.ts`**
- Extract patterns to nudgePatterns.ts, accumulator to nudgeAccumulator.ts
- **Verify**: `pnpm test` — nudgeEngine.test.ts (575 lines) passes

**Step 2.5 — Split `eventStore.ts`**
- Extract hookNormalizer.ts
- **Verify**: `pnpm test` — eventStore.test.ts (461 lines) passes, send hook event and confirm it appears in dashboard

**Step 2.6 — Split `routes/coaching.ts`**
- Create coaching/reportCards.ts, coaching/nudges.ts, coaching/index.ts
- **Verify**: `pnpm test` — coachingRoutes.test.ts (335 lines) passes

### Phase 3: Dashboard Component Splits

**Step 3.1 — Split `AgentDetailPanel.tsx`**
- Extract AgentAIAnalysis.tsx, AgentToolList.tsx, agentPanelUtils.ts
- Keep AgentDetailPanel.tsx as the shell that composes them
- **Verify**: `pnpm test`, open dashboard → click agent node → detail panel renders correctly, AI analysis toggle works, tool list filters work

**Step 3.2 — Split `AgentGraph.tsx`**
- Extract useVisibleNodes.ts hook, useEdgeStyling.ts hook
- AgentGraph.tsx imports and uses both
- **Verify**: `pnpm test` — useAutoLayout.test.ts passes, graph renders with correct visibility and edge colors

**Step 3.3 — Split `agentStore.ts`**
- Extract eventPipeline.ts and timeFilter.ts
- Store imports from them; public API unchanged
- **Verify**: `pnpm test` — agentStore.test.ts (681 lines) passes, time filter persists, dedup works

**Step 3.4 — Split `InsightsView.tsx`**
- Extract BadgeSection, BudgetSection, AICoachSection
- **Verify**: Open Analytics → Insights tab, verify badges/budget/coach all render and interact

**Step 3.5 — Split `LiveNudgesView.tsx`**
- Extract NudgeConfigPanel, RuleStatsPanel
- **Verify**: Open Analytics → Nudges tab, verify feed/config/stats all work

**Step 3.6 — Split `PromptAnalyzer.tsx`**
- Extract PromptAnalysisPanel, PromptActions
- **Verify**: Open Analytics → Prompts tab, verify analysis and workshop bridge work

**Step 3.7 — Split `useAnalyticsData.ts`**
- Extract analyticsApi.ts
- **Verify**: Dashboard analytics page loads data correctly

### Phase 4: Final Cleanup

**Step 4.1 — Run full test suite**
- `pnpm test` — all 347+ tests pass
- `pnpm -r build` — clean build

**Step 4.2 — Verify VSCode extension build**
- `cd apps/vscode && pnpm run package` — produces valid .vsix

**Step 4.3 — Manual smoke test**
- Start server + dashboard
- Send hook events (simulate_session.ts)
- Verify: graph renders, detail panel works, analytics loads, nudges fire, time filter persists

---

## What NOT to Split

These files are large but cohesive — splitting would add indirection without benefit:

- **`ToolDetailRenderers.tsx` (918)** — Registry of 30 small renderers. Each is 20-100 lines. The file IS the registry; splitting into 30 files would be worse.
- **`eventHandlers.ts` (653)** — Already extracted from agentStore. All 16 handlers share the same draft interface. Splitting by event type would scatter tightly-coupled mutations.
- **`useAutoLayout.ts` (469)** — Single algorithm with clear sections. Dagre + custom post-pass is one job.
- **`settingsPanel.ts` (1,012)** — VS Code webview with HTML template. Self-contained by design.
- **Test files** — Size is proportional to tested code. Don't split tests.
- **Lens visualizations** (350-450 each) — Each is a single chart. One file per viz is correct.
