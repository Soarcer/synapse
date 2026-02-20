# Analytics Restructuring Plan

**Date**: 2026-02-16
**Rollback tag**: `v0.9.0-pre-restructure` (commit `1b757a6`)
**Rollback command**: `git reset --hard v0.9.0-pre-restructure`

## Goal

Consolidate the analytics page from **10 tabs** down to **5 focused tabs**. Cut low-value views, merge overlapping functionality, and elevate Live Nudges into a first-class experience.

## Decision Log (Scoring)

Each tab was scored 1-5 by the project owner during interactive review:

| Tab | Score | Decision | Rationale |
|-----|-------|----------|-----------|
| Executive Overview | 3-4 | **KEEP** | Useful landing page with KPIs. Flexible — could be trimmed but provides good overview. |
| Deep Dive Explorer | 1-2 | **CUT** | Dense data dump, no clear narrative. Overlap with other views. |
| Session Replay | 5 | **KEEP** | Must-keep. Temporal narrative of individual sessions. Unique value. |
| Compare (Side-by-side) | 1-2 | **CUT** | Rarely useful. Can be added back later if needed. |
| What-If Calculator | 1-2 | **FOLD into Insights** | Static pricing table not valuable alone. Rethink as "Model Optimization" insight card. |
| Token Velocity | 1-2 | **CUT** | Gauge charts add noise. Key metrics (cache hit, output ratio) already in Executive. |
| Prompt Analyzer | 5 | **KEEP** | Must-keep. Cross-session prompt analysis. Distinct from Session Replay (aggregate vs temporal). |
| Tool Chains | 1-2 | **CUT** | Co-occurrence matrix too academic. Tool stats already in Executive. |
| Insights | 5 | **KEEP + MERGE** | Merge Coach content into this tab. Becomes the unified coaching/insights hub. |
| Coach | 5 (merged) | **MERGE into Insights** | Report cards, playbooks, budget tracker, tips — all fold into Insights. |

### Prompt Analyzer vs Session Replay — Overlap Analysis

Both were scored 5. Explicit comparison confirmed they serve **different purposes**:

- **Session Replay**: "What happened in session X?" — temporal narrative within one session, cumulative burn charts, compaction markers, turn-by-turn timeline
- **Prompt Analyzer**: "Which prompts are expensive/complex?" — cross-session aggregate analysis, complexity scoring, category classification, scatter visualization

**Overlap**: Token breakdown bars, expandable detail cards, and helper functions (`fmtTokens`, `MODEL_COLORS`, `TOOL_COLORS`). These should be extracted into shared components during implementation.

**Decision**: Keep both as separate tabs. Extract shared UI into `analytics/shared/`.

## Target Structure (5 Tabs)

```
AnalyticsPage
├── Tab 1: Executive Overview  (landing page, KPIs + sparklines)
├── Tab 2: Session Replay      (per-session timeline deep-dive)
├── Tab 3: Prompt Analyzer     (cross-session prompt analysis)
├── Tab 4: Insights            (merged: insights + coach + what-if model advisor)
└── Tab 5: Live Nudges         (new: config, history, real-time coaching)
```

### Tab 4: Insights (Merged)

Combines content from three former sources:

1. **InsightsView** (existing) — AI-generated insight cards (cost optimization, efficiency, prompt engineering, model selection, tool usage, patterns)
2. **CoachingView** (existing) — Report cards, playbooks, session-level grading
3. **What-If** (existing) — Fold in as a "Model Optimization" insight card showing cost comparison across models

**Layout concept**: Sectioned page with:
- Top: Insight cards grid (from InsightsView rules engine)
- Middle: Report card summary (from CoachingView, works without transcripts via graceful degradation)
- Bottom: Budget tracker + Model optimization card (from What-If pricing data)
- Sidebar or section: Playbook management

### Tab 5: Live Nudges (New Dedicated Tab)

Extracted from the Coach tab and elevated to first-class status. Three delivery channels:

1. **Dedicated analytics tab** — Nudge history, configuration UI (enable/disable rules, thresholds), nudge effectiveness metrics
2. **Live in graph view** — Toast/badge overlay when a nudge fires during an active session (already partially implemented via `NudgePanel` in coaching)
3. **Analytics history** — Nudge frequency, most common nudges, dismissal rates

**Key principle**: Nudges must work **proactively during sessions**, not just post-session review. The graph view integration is critical.

## Files to Modify

### Delete (5 tab components)

| File | Lines | Notes |
|------|-------|-------|
| `analytics/explorer/DeepDiveExplorer.tsx` | 406 | Cut entirely |
| `analytics/comparison/ComparisonLab.tsx` | 388 | Cut entirely |
| `analytics/whatif/WhatIfCalculator.tsx` | 161 | Content folded into Insights |
| `analytics/velocity/TokenVelocityView.tsx` | 358 | Cut entirely |
| `analytics/tools/ToolChainView.tsx` | 211 | Cut entirely |

**Total removed**: ~1,524 lines

### Modify

| File | Change |
|------|--------|
| `analytics/AnalyticsPage.tsx` | Remove 5 tab imports + entries. Update `TABS` array to 5 items. Add `LiveNudges` tab. |
| `analytics/insights/InsightsView.tsx` | Merge in report card summary, playbook section, model optimization card from What-If data |
| `analytics/coaching/CoachingView.tsx` | Refactor — extract nudge history into new `LiveNudgesView`. Keep report card + playbook logic for Insights integration. |
| `analytics/coaching/NudgePanel.tsx` | Move/adapt into new `nudges/LiveNudgesView.tsx` |

### Create

| File | Purpose |
|------|---------|
| `analytics/nudges/LiveNudgesView.tsx` | New tab: nudge history timeline, configuration toggles, effectiveness metrics |
| `analytics/shared/TokenBreakdownBar.tsx` | Extract duplicated token bar from Replay + Prompts |
| `analytics/shared/ToolBadges.tsx` | Extract duplicated tool badge rendering |
| `analytics/shared/ModelBadge.tsx` | Extract duplicated model badge rendering |

### Server (Minimal Changes)

The existing coaching routes (`/api/analytics/coaching/*`) and nudge engine already support the new structure. Only changes:

- Add `GET /api/analytics/coaching/nudges/stats` endpoint — aggregate nudge stats for the Live Nudges tab (fire count, dismiss rate, rule breakdown)
- Ensure report card endpoint degrades gracefully when transcript files are missing (return partial data instead of error)

## Implementation Phases

### Phase 1: Remove cut tabs (low risk)
- Delete 5 component files/directories
- Update `AnalyticsPage.tsx` TABS array and imports
- Verify remaining 5 tabs render correctly

### Phase 2: Extract shared components
- Create `TokenBreakdownBar`, `ToolBadges`, `ModelBadge` in `shared/`
- Refactor Session Replay and Prompt Analyzer to use shared components
- Verify no visual regression

### Phase 3: Merge Coach into Insights
- Add report card summary section to InsightsView
- Add playbook management section to InsightsView
- Add model optimization card (from What-If pricing data)
- Add budget tracker section
- Wire up `useCoachingData` hook in InsightsView

### Phase 4: Create Live Nudges tab
- Create `nudges/LiveNudgesView.tsx` with history, config, stats
- Add nudge stats endpoint to server
- Wire into AnalyticsPage as 5th tab

### Phase 5: Graph view nudge integration
- Add nudge toast/overlay to graph view (fires during live sessions)
- Connect to existing WebSocket nudge broadcasts
- Add nudge badge on graph nodes when relevant

### Phase 6: Cleanup and testing
- Remove dead imports and unused coaching components
- Update e2e tests (`analytics-tabs.spec.ts`)
- Verify mock data still works for all remaining tabs
- Run full test suite

## Keyboard Shortcut Updates

Current analytics shortcuts use number keys 1-6 for lens tabs (tree, heatmap, treemap, sankey, compaction, cost). The analytics tab bar doesn't have shortcuts. No changes needed.

## Risk Assessment

| Risk | Mitigation |
|------|------------|
| Insights tab becomes too crowded after merge | Section-based layout with collapse/expand. User can focus on one section. |
| Report card depends on transcript files | Graceful degradation — show "transcript unavailable" instead of error |
| Removing tabs loses edge-case functionality | Tagged rollback point. All cut tabs are self-contained and can be restored. |
| Live Nudges graph integration touches core graph code | Phase 5 is isolated — can ship tabs 1-4 without it |
