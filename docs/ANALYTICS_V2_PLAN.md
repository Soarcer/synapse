# Analytics Dashboard v2 — Comprehensive Enhancement Plan

## Context

The analytics dashboard was restructured from 10 → 5 tabs (on branch `fix/review-findings`). The user identified 10 bugs/feature requests across all tabs. This plan covers all 10 items organized into 8 ordered phases.

**Key user decisions from Q&A:**
- API key: auto-detect `ANTHROPIC_API_KEY` from env + settings UI fallback
- Coach model: Haiku 4.5 default ($1/M in, $5/M out)
- Project filter: CWD-based project dropdown + session multi-select
- Budget: subscription-aware, auto-detect Claude plan + manual override
- AI triggers: hybrid (continuous every N calls + smart triggers + user sensitivity config)
- Time filter: dual-handle range slider with presets
- Prompt analysis: full suite (scores, rewrites, history comparison, savings)
- Playbooks: rename to "Session Templates" + onboarding + built-in examples
- Executive: add AI summary + ROI metrics
- Session replay: AI summary + linked artifacts + mini timeline + charts-relative-to-session

---

## Phase 1: AI Coaching Backend Infrastructure [XL]

**Why first**: Items 2, 3, 4a, 5b, 6, 8, 10 all need server-side LLM calls. This unblocks the majority of work.

### Create
- `packages/server/src/services/settingsService.ts` — Settings CRUD with env fallback
  - `settings` table in SQLite (key TEXT PRIMARY KEY, value TEXT, updated_at INTEGER)
  - `getSetting(key)`, `setSetting(key, value)`, `getAllSettings()`
  - Auto-detect: check `process.env.ANTHROPIC_API_KEY` first, fall back to DB
- `packages/server/src/services/aiCoachService.ts` — Core AI calling service (singleton)
  - Lazy-init Anthropic client from settings
  - `isAvailable(): boolean` — check if API key exists
  - `summarizeSession(context): Promise<string>` — 3-sentence summary
  - `analyzePrompt(promptText, context): Promise<PromptAnalysis>` — score, rewrite, savings
  - `generateRecommendations(context): Promise<Recommendation[]>` — actionable insights
  - `escalateNudge(nudge, eventBuffer): Promise<EnrichedNudge>` — AI-enhanced nudge
  - Rate limiting: max 10 concurrent calls, exponential backoff
  - Token budget: configurable max $/session (default $0.10)
  - Cache: `ai_coaching_cache` table (method + sessionId + contentHash → response, 1hr TTL)
  - Use raw `fetch()` to `https://api.anthropic.com/v1/messages` (simpler than full Agent SDK for completions)
- `packages/server/src/routes/settings.ts` — API routes
  - `GET /api/settings` — returns settings (API key masked)
  - `PUT /api/settings` — update settings
  - `GET /api/settings/ai-status` — health check (key valid, model available)

### Modify
- `packages/server/src/db.ts` — Add `settings` + `ai_coaching_cache` tables in `initDb()`
- `packages/server/src/app.ts` — Mount `/api/settings` routes
- `packages/core/src/types/coaching.ts` — Add `PromptAnalysis`, `SessionSummary`, `EnrichedNudge` types

### Frontend
- Minimal settings panel (gear icon in analytics header) showing:
  - API key status (env detected / manual / missing)
  - Coach model selector (Haiku default, Sonnet option)
  - "Test Connection" button

### Verification
- Unit test: settings CRUD with env override
- Unit test: aiCoachService with mocked fetch
- Manual: configure key via UI, verify `GET /api/settings/ai-status` returns healthy

---

## Phase 2: Global Filtering [L]

**Can run in parallel with Phase 1.**

### Create
- `apps/dashboard/src/components/analytics/shared/RangeSlider.tsx`
  - Dual-handle HTML range slider over a mini activity sparkline
  - Props: `min`, `max`, `from`, `to`, `onChange(from, to)`
  - Debounce on `pointerup` (not continuous) to avoid excessive re-fetches
- `apps/dashboard/src/components/analytics/shared/ProjectFilter.tsx`
  - Dropdown populated from `GET /api/analytics/projects` (new endpoint returning distinct cwds)
  - "All Projects" default option
- `apps/dashboard/src/components/analytics/shared/SessionFilter.tsx`
  - Multi-select checkbox dropdown of sessions within current project + time range
  - Search/filter by session name
  - "All Sessions" default

### Modify
- `apps/dashboard/src/components/analytics/shared/TimeRangeSelector.tsx`
  - Add 1h, 6h preset buttons alongside existing 24h/7d/30d/All
  - Add "Custom" mode that reveals the RangeSlider
  - When slider is used, switch to "Custom" automatically
- `apps/dashboard/src/components/analytics/useAnalyticsData.ts`
  - Extend `AnalyticsFilters`: add `from?: number`, `to?: number`, `sessionIds?: string[]`
  - Add `'1h'` and `'6h'` cases to `getTimeRangeMs()`
  - Add `'custom'` case that passes through `from`/`to`
  - Pass `sessionIds` to relevant endpoints as query param
- `apps/dashboard/src/components/analytics/AnalyticsPage.tsx`
  - Add ProjectFilter + SessionFilter to filter bar
  - Manage `cwd` and `sessionIds` filter state
- `packages/server/src/routes/analytics.ts`
  - Add `GET /api/analytics/projects` → `SELECT DISTINCT cwd FROM events WHERE cwd IS NOT NULL`
  - Support `sessionIds` query param in overview/sessions/turns/tool-calls endpoints

### Verification
- Visual: filter bar shows 1h/6h/24h/7d/30d/All + Custom slider
- Functional: project dropdown filters data; session multi-select works
- Edge case: empty project list when no CWD data

---

## Phase 3: Small UI Fixes & Polish [S]

**All sub-items are independent — can be parallelized.**

### 3A: Prompt tooltip fix (Item 4b)
- **File**: `apps/dashboard/src/components/analytics/prompts/PromptAnalyzer.tsx`
- Add to Recharts `<Tooltip>`: `contentStyle={{ backgroundColor: '#161b22', border: '1px solid #374151', color: '#e5e7eb' }}` and `labelStyle={{ color: '#9ca3af' }}`

### 3B: Scatter plot click-to-highlight (Item 4b)
- **File**: `apps/dashboard/src/components/analytics/prompts/PromptAnalyzer.tsx`
- Add `selectedPromptIdx` state
- Add `onClick` handler to `<Scatter>` that sets selected index
- Scroll table to selected row and expand it
- Render selected dot larger with `activeShape` prop

### 3C: Insights recommendation formatting (Item 5a)
- **File**: `apps/dashboard/src/components/analytics/insights/InsightsView.tsx`
- Change recommendation rendering from paragraph to vertical `<ul>/<li>` list
- Style: `text-xs text-gray-300`, left-border accent matching category color

### 3D: Report card dimension tooltips (Item 6)
- **File**: `apps/dashboard/src/components/analytics/coaching/ReportCardPanel.tsx`
- Add `DIMENSION_DESCRIPTIONS` constant with 1-2 sentence explanations per dimension
- Add info icon with hover tooltip next to each dimension label
- Show `detector.evidence` in expanded detector rows for concrete examples

### 3E: Playbook rename + onboarding (Item 7)
- **Files**: `PlaybookPanel.tsx`, `InsightsView.tsx`
- Rename all UI labels: "Playbook" → "Session Template"
- Empty state: guided onboarding card explaining what templates are (dismissible via localStorage)
- **File**: `packages/server/src/services/playbookService.ts`
  - Add `seedBuiltInPlaybooks()` — insert 3 example templates ("Feature Development", "Bug Investigation", "Code Review") with realistic patterns if none exist
  - Call during `initDb()`

### 3F: Metric info tooltips (Items 4c, 6)
- **Create**: `apps/dashboard/src/components/analytics/shared/InfoTooltip.tsx`
  - Reusable: `<InfoTooltip text="..." />` renders "(i)" icon with hover popup
  - Style: dark background, white text, max-w-xs, z-30
- **Modify**: `PromptAnalyzer.tsx` — add InfoTooltip to Cost, Tokens, Cache Hits, Latency, Complexity, Turns column headers
- **Modify**: `KpiCard.tsx` — add optional `tooltip?: string` prop, render InfoTooltip when provided

---

## Phase 4: Budget Tracker Enhancement [M]

### Create
- `packages/server/src/services/planDetector.ts`
  - Check Claude config files: `~/.claude/settings.json`, `%APPDATA%\Claude\settings.json`
  - Parse plan type: Free, Pro ($20/mo), Max 5x ($100/mo), Max 20x ($200/mo), Team ($30/user/mo), API (pay-as-you-go)
  - Return `{ plan: string, monthlyLimit: number | null, detected: boolean }`
  - Fallback: return `{ detected: false }` if can't read config

### Modify
- `packages/server/src/db.ts` — Store plan config in settings table
- `packages/server/src/routes/analytics.ts`
  - `GET /api/analytics/budget` — return plan info + usage vs limits
  - `PUT /api/analytics/budget/plan` — manual plan override
- `apps/dashboard/src/components/analytics/insights/InsightsView.tsx`
  - Rewrite Budget Tracker section:
    - Plan badge (auto-detected or manual)
    - Usage gauge: spend vs plan limit (not hardcoded $50)
    - "API-equivalent cost" note for subscription users
    - Forecast: "At current rate, X% of monthly limit"
    - Plan selector dropdown for manual override

---

## Phase 5: AI-Enhanced Analytics Tabs [XL]

**Depends on Phase 1 (AI backend).**

### 5A: Executive — AI Summary + ROI (Item 2)
- **New endpoint**: `GET /api/analytics/ai-summary?from=X&to=Y`
  - Calls `aiCoachService.summarizeSession()` with aggregated overview data
  - Returns: `{ summary: string, roiMetrics: { timeSaved, costPerTask, successRate } }`
- **Modify**: `apps/dashboard/src/components/analytics/executive/ExecutiveOverview.tsx`
  - Add "AI Summary" banner above KPI cards (loading skeleton while in-flight)
  - Add 3 ROI KPI cards below existing row: Time Saved, Cost per Task, Success Rate
  - Cache summary client-side; refresh on filter change or manual button

### 5B: Prompt Analysis — Full AI Suite (Item 4a)
- **New endpoint**: `POST /api/analytics/ai-analyze-prompt`
  - Input: `{ promptText, sessionContext: { model, toolCount, category, cost } }`
  - Returns: `{ score: 1-10, explanation, rewrite, estimatedSavings, historyComparison }`
- **Modify**: `apps/dashboard/src/components/analytics/prompts/PromptAnalyzer.tsx`
  - Add "Analyze with AI" button in expanded prompt row
  - Show AI response card: Quality Score, Suggested Rewrite, Potential Savings, History Comparison
  - Add batch "Analyze Top 5 Most Expensive" button

### 5C: Insights — Actionable Recommendations (Item 5b)
- **New endpoint**: `POST /api/analytics/ai-insights`
- **Modify**: `apps/dashboard/src/components/analytics/insights/InsightsView.tsx`
  - Add "AI Insights" section above rule-based insights with "AI-generated" badge
  - Each AI insight: concrete recommendation, specific session example, estimated impact

### 5D: Report Card — AI Recommendations (Item 6a)
- **Modify**: `packages/server/src/services/reportCardEngine.ts` — Add `enrichWithAi()`
- **Modify**: `apps/dashboard/src/components/analytics/coaching/ReportCardPanel.tsx`
  - Add "Get AI Recommendations" button (lazy-load, not automatic)

### Graceful degradation
All AI features show "AI features require API key" when unavailable. Rule-based content continues.

---

## Phase 6: Session Replay Enrichment [L]

### Create
- `apps/dashboard/src/components/analytics/replay/ArtifactPanel.tsx`
  - Files modified, git activity, test results, errors
  - Data source: reuse `buildSessionContext()` from `reportCardEngine.ts`
- `apps/dashboard/src/components/analytics/replay/MiniTimeline.tsx`
  - Horizontal SVG bar: 20-30 time buckets, bar height = event density
  - Color: blue=tools, red=errors, orange=compaction. Clickable.
- `packages/server/src/routes/sessionDetail.ts`
  - `GET /api/analytics/session/:id/artifacts`
  - `GET /api/analytics/session/:id/summary` (requires Phase 1)

### Modify
- `apps/dashboard/src/components/analytics/replay/SessionReplay.tsx`
  - AI summary in session card (lazy-load on select)
  - MiniTimeline above turn list
  - ArtifactPanel as collapsible section
  - Global/Focused chart toggle (focused = selected session only + percentile bands)
- `packages/server/src/app.ts` — Mount session detail routes

---

## Phase 7: Model Optimization [M]

### Create
- `packages/server/src/services/modelOptimizationService.ts`
  - `computeModelAlternatives(sessionTurns)` — cost with each model
  - `classifyTurnComplexity(turn)` — simple (Haiku) vs complex (Opus)
  - `getTopSwitchingOpportunities(turns, limit)` — highest savings turns

### Modify
- `packages/server/src/routes/analytics.ts` — `GET /api/analytics/model-optimization`
- `apps/dashboard/src/components/analytics/insights/InsightsView.tsx`
  - What-if calculator, concrete switching examples, savings projections

---

## Phase 8: Live AI Coaching [XL]

**Depends on Phase 1. Most complex feature.**

### Create
- `packages/server/src/services/aiNudgeEscalator.ts`
  - `escalateNudge(nudge, eventBuffer)` — AI-enriched nudge
  - `periodicCheck(sessionId, eventBuffer)` — every N tool calls
  - `smartTriggerCheck(event, eventBuffer)` — error spiral, cost spike, long silence
  - Rate limiting: max 1 AI call/session/2min, max 5/session total
  - Fire-and-forget (non-blocking)

### Modify
- `packages/server/src/services/nudgeEngine.ts`
  - Tool call counter per session, periodic check every 10 calls
  - AI escalation for warning/critical nudges
- `packages/server/src/services/eventStore.ts` — Integrate periodic coaching
- `packages/core/src/types/coaching.ts` — Add `source: 'rule' | 'ai-escalation' | 'ai-periodic' | 'ai-trigger'`
- `apps/dashboard/src/components/analytics/nudges/LiveNudgesView.tsx`
  - Sensitivity selector: Low / Medium / High
  - Visual distinction for AI nudges (sparkle + "AI" badge)
- `packages/server/src/routes/coaching.ts` — Sensitivity config endpoints

---

## Phase Dependency Graph

```
Phase 1 (AI Backend) ──┬──> Phase 5 (AI-Enhanced Tabs)
                        ├──> Phase 6 (Session Replay AI parts)
                        ├──> Phase 7 (Model Optimization AI parts)
                        └──> Phase 8 (Live AI Coaching)

Phase 2 (Global Filtering) ──> All tabs benefit (no hard block)
Phase 3 (UI Fixes) ──> Independent, parallelizable
Phase 4 (Budget) ──> Independent (soft dep on Phase 1 for settings table)
```

## Effort Summary

| Phase | Items | Effort | New Files | Modified Files |
|-------|-------|--------|-----------|----------------|
| 1 — AI Backend | Infrastructure | XL | 3 | 3 |
| 2 — Global Filtering | 1a, 1b | L | 3 | 4 |
| 3 — UI Fixes | 4b, 4c, 5a, 6, 7 | S | 1 | 6 |
| 4 — Budget | 9 | M | 1 | 3 |
| 5 — AI Tabs | 2, 4a, 5b, 6a | XL | 0 | 6 |
| 6 — Session Replay | 3 | L | 3 | 2 |
| 7 — Model Optimization | 8 | M | 1 | 2 |
| 8 — Live AI Coaching | 10 | XL | 1 | 5 |
| **Total** | **All 10** | | **~13** | **~20** |

## Key Conventions

- Dark theme: #0d1117 page, #161b22 cards, gray-800 borders
- Recharts for all charts
- Zustand with module-level EMPTY arrays to avoid re-render loops
- Zod at API boundaries, no `any` types
- pino for server logging
- Express 5 `req.params.id` returns `string | string[]` — cast to `string`
- `@synapse-ai/core` for cross-package imports
