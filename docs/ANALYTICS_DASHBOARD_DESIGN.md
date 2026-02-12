# Synapse Analytics Dashboard — Design Document

## 1. Vision

A comprehensive reporting and analytics dashboard for AI coding assistant usage, built as a separate full-page view inside Synapse. It answers three questions:

1. **How much am I spending?** (Cost awareness)
2. **How am I using AI?** (Usage patterns)
3. **Is AI making me more effective?** (Productivity insights)

## 2. Design Principles

- **Vercel-inspired clarity**: Large KPI cards, sparklines, minimal chrome, dark-first
- **GitHub Copilot-inspired metrics**: Acceptance-style metrics adapted for agent orchestration
- **Helicone/LangSmith depth**: Token breakdowns, latency distributions, per-model analysis
- **Progressive disclosure**: Summary → Breakdown → Raw data
- **Multiple prototype tabs**: Users explore 4 distinct dashboard personalities before committing

## 3. Target Audience

| Persona | Needs |
|---------|-------|
| **Individual developer** | Personal cost tracking, session efficiency, tool usage patterns, prompt optimization |
| **Team lead / manager** | Aggregate usage, per-developer breakdowns, budget tracking, ROI justification |

## 4. Data Sources (Already Available in Synapse)

### From Hook Events (AgentEvent)
- `type`: session_start/end, agent_start/stop, tool_start/end, user_prompt, compact, etc.
- `tokenUsage`: { input, output } per event
- `costUsd`: computed cost per event
- `duration`: milliseconds per tool call / agent run
- `toolName`: Read, Write, Edit, Bash, Grep, Glob, Task, WebFetch, etc.
- `agentType`: Explore, Plan, Bash, general-purpose, custom
- `model`: claude-opus-4-6, claude-sonnet-4-5, etc.
- `vendor`: anthropic, openai, google, groq, openrouter
- `sessionId`, `agentId`, `parentAgentId`: hierarchy
- `timestamp`, `cwd`: timing and project context

### From Transcript Parsing (TranscriptSummary)
- Per-turn: inputTokens, outputTokens, cacheReadTokens, cacheCreationTokens
- Per-turn: thinkingLength, textLength, toolUseCount, toolNames
- Per-turn: model, stopReason, contentTypes
- Aggregates: estimatedCostUsd, avgCacheHitRate, peakCacheHitRate
- Aggregates: totalDurationMs, avgResponseLatencyMs, totalToolCalls

### From CostTurn (already computed in lensComputations.ts)
- Per-prompt: inputTokens, outputTokens, cumulativeInput, cumulativeOutput
- Per-prompt: toolCount, compactionBefore, cacheReadTokens, responseLatencyMs
- Per-prompt: thinkingLength, textLength, model, dataSource

## 5. Metric Inventory (Ranked by Importance)

### Tier 1 — Always Visible (KPI Cards)
1. **Total Cost** — Cumulative USD spent, with trend sparkline
2. **Total Tokens** — Input + output, with input/output split
3. **Session Count** — Total sessions in period
4. **Avg Cost per Session** — Cost / sessions
5. **Total Tool Calls** — Aggregate tool invocations

### Tier 2 — Primary Charts
6. **Cost Over Time** — Stacked area (input cost + output cost)
7. **Token Usage Over Time** — Stacked area (prompt + completion + cache)
8. **Tool Usage Distribution** — Horizontal bar chart (Read, Write, Bash, etc.)
9. **Model Usage Distribution** — Donut chart (Opus vs Sonnet vs Haiku)
10. **Latency Distribution** — Histogram (P50, P90, P99 markers)

### Tier 3 — Detailed Breakdowns
11. **Cost by Model** — Treemap or stacked bar
12. **Agent Type Distribution** — Bar chart (Explore, Plan, Bash, general-purpose)
13. **Cache Hit Rate Over Time** — Line chart with threshold markers
14. **Compaction Events** — Timeline markers showing context resets
15. **Prompt Length Distribution** — Histogram
16. **Thinking vs Output Ratio** — Stacked area or ratio line

### Tier 4 — Advanced Insights
17. **Tool Call Heatmap** — Tool × Time-of-day heatmap
18. **Session Duration Distribution** — Histogram
19. **Cost per Tool Call** — Bar chart comparing tool costs
20. **Token Efficiency** — Output tokens per input token (over time)

## 6. Prototype Specifications

### Prototype 1: Executive Overview
**Personality**: Vercel Analytics — clean, minimal, KPI-focused
**Layout**:
- Top row: 5 KPI cards with sparklines and delta percentages
- Middle: Large cost-over-time area chart (primary)
- Bottom row: 3 mini charts (token split donut, tool distribution bar, model mix donut)
**Color palette**: Muted blues/greens on dark background, accent color for highlights
**Interaction**: Click KPI card to filter the main chart

### Prototype 2: Deep Dive Explorer
**Personality**: Grafana — dense, data-rich, configurable
**Layout**:
- Filter bar: Time range, model, agent type, session picker
- Grid of 6 charts (2×3):
  1. Cost over time (stacked area)
  2. Token breakdown (stacked bar per session)
  3. Latency distribution (histogram with percentile lines)
  4. Tool usage heatmap (tool × time bucket)
  5. Cache hit rate (line with threshold)
  6. Agent hierarchy Sankey
**Color palette**: High-contrast neon on dark (matches existing Synapse theme)
**Interaction**: Cross-filtering — click any chart element to filter all others

### Prototype 3: Session Replay
**Personality**: LangSmith trace view — narrative, sequential
**Layout**:
- Session picker at top
- Vertical timeline showing each prompt → response cycle
- Per-turn cards: tokens used, cost, tools called, latency, cache hit rate
- Cumulative cost line running alongside the timeline
- Compaction markers as dividers
**Color palette**: Warm gradient from start to end of session
**Interaction**: Expand/collapse turns, click tool calls to see details

### Prototype 4: Comparison Lab
**Personality**: Side-by-side analytical
**Layout**:
- Two column panels with session/period pickers
- Mirrored charts: cost, tokens, tools, latency
- Difference indicators (delta %, arrow direction)
- Summary table at bottom: metric-by-metric comparison
**Color palette**: Left panel blue, right panel green, deltas in red/green
**Interaction**: Lock/unlock period selections, swap panels

## 7. Technical Architecture

### New Files
```
apps/dashboard/src/
├── components/analytics/
│   ├── AnalyticsPage.tsx          # Main page with tab navigation
│   ├── AnalyticsContext.tsx        # Shared state (time range, filters)
│   ├── mockData.ts                # Mock data generators for prototyping
│   ├── computeMetrics.ts          # Metric computation from events
│   ├── shared/
│   │   ├── KpiCard.tsx            # Reusable KPI card with sparkline
│   │   ├── ChartCard.tsx          # Reusable chart container
│   │   ├── TimeRangeSelector.tsx  # Global time range picker
│   │   ├── FilterBar.tsx          # Model/agent/session filters
│   │   └── MetricDelta.tsx        # Percentage change indicator
│   ├── executive/
│   │   └── ExecutiveOverview.tsx   # Prototype 1
│   ├── explorer/
│   │   └── DeepDiveExplorer.tsx    # Prototype 2
│   ├── replay/
│   │   └── SessionReplay.tsx       # Prototype 3
│   └── comparison/
│       └── ComparisonLab.tsx       # Prototype 4
```

### Integration Points
- **App.tsx**: Add `?view=analytics` route alongside existing `full`, `lens`, `graph`
- **Header.tsx**: Add "Analytics" tab/button to navigate to the analytics view
- **agentStore.ts**: Read events and transcripts — no new state needed
- **Recharts**: New dependency for all chart types

### Mock Data Strategy
Generate realistic mock data that mimics:
- 5 sessions across 3 days
- 3 models (Opus, Sonnet, Haiku) with realistic pricing
- 12 tool types with realistic distribution (Read heavy, Write moderate, Bash occasional)
- Compaction events at realistic intervals
- Cache hit rates that start low and improve
- Latency distributions that follow log-normal
- 200-500 events total

## 8. Export Formats (v1)

### Standalone HTML
- Self-contained HTML file with embedded Recharts data
- Inline CSS + JS (no external dependencies)
- Opens in any browser, works offline
- Generated via a "Download Report" button

### PDF/PNG
- Use `html2canvas` + `jsPDF` for PDF generation
- Individual chart PNG export via Recharts' built-in SVG-to-PNG
- Report header with project name, date range, summary stats

## 9. Rollup Tables (Hybrid Storage)

### New SQL Tables (for pre-aggregated analytics)
```sql
CREATE TABLE IF NOT EXISTS daily_rollups (
  date TEXT NOT NULL,           -- YYYY-MM-DD
  session_id TEXT,              -- NULL for global rollups
  model TEXT,
  vendor TEXT,
  total_events INTEGER,
  total_tokens_in INTEGER,
  total_tokens_out INTEGER,
  total_cache_read INTEGER,
  total_cost_usd REAL,
  total_tool_calls INTEGER,
  total_sessions INTEGER,
  avg_latency_ms REAL,
  p50_latency_ms REAL,
  p99_latency_ms REAL,
  PRIMARY KEY (date, COALESCE(session_id, '__global__'), COALESCE(model, '__all__'))
);

CREATE TABLE IF NOT EXISTS tool_rollups (
  date TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  call_count INTEGER,
  total_duration_ms INTEGER,
  error_count INTEGER,
  avg_duration_ms REAL,
  PRIMARY KEY (date, tool_name)
);
```

### Rollup Trigger
- Compute on event insert (debounced, same as DB save)
- Or: batch rollup job that runs on the hour
- For v1 prototypes: compute on-the-fly from events (rollups can come later)

## 10. VS Code Extension Integration

### Sidebar Analytics Widget
- Compact version of Executive Overview in the VS Code sidebar
- 3 KPI cards (cost, tokens, sessions) for the current project
- "Open Full Analytics" button that opens the web dashboard

### Editor Panel
- Full analytics dashboard in a VS Code editor tab
- Same webview iframe approach as the existing graph view
- Data relay via postMessage from extension host

## 11. Implementation Phases

### Phase 1 (This PR) — Prototypes with Mock Data
- Install recharts
- Build all 4 prototype tabs
- Mock data generators
- Tab navigation in analytics page
- Accessible via `?view=analytics`

### Phase 2 — Real Data Integration
- Wire prototypes to actual Zustand store data
- Add analytics API endpoints for aggregated queries
- Implement rollup tables

### Phase 3 — Export
- Standalone HTML export
- PDF/PNG export
- Scheduled report generation

### Phase 4 — VS Code Integration
- Sidebar analytics widget
- Editor panel analytics view
- Cross-panel sync
