# Synapse Analytics Dashboard — AI Agent Execution Prompt

Use this prompt with an AI coding agent (Claude Code, Cursor, etc.) to implement the analytics dashboard. The plan supports up to 3 parallel agents working on non-overlapping concerns.

---

## Context for the Agent

You are implementing a comprehensive analytics and reporting dashboard for **Synapse**, an AI agent orchestration tool. The project is a pnpm monorepo with:

- `packages/core/` — shared TypeScript types and Zod schemas (`@synapse-ai/core`)
- `packages/server/` — Express 5 + sql.js + WebSocket backend
- `apps/dashboard/` — React 19 + Recharts + Zustand + Tailwind CSS frontend

**What already exists**:
- 4 working prototype tabs at `?view=analytics` using mock data (Executive Overview, Deep Dive Explorer, Session Replay, Comparison Lab)
- Mock data generator at `apps/dashboard/src/components/analytics/mockData.ts`
- Shared chart components (KpiCard, ChartCard, TimeRangeSelector, MetricDelta)
- Event database with `events` table (session_id, event_type, token_input, token_output, tool_name, model, vendor, duration_ms, cwd, created_at)
- Existing cost computation in `packages/core/src/types/transcript.ts` (MODEL_PRICING, DEFAULT_PRICING)

**Key documents to read first**:
1. `docs/ANALYTICS_DASHBOARD_DESIGN.md` — design decisions and prototype specs
2. `docs/ANALYTICS_IMPLEMENTATION_PLAN.md` — full phased plan with file inventory
3. `packages/core/src/types/agent.ts` — AgentEvent type definition
4. `packages/core/src/types/transcript.ts` — TranscriptSummary, MODEL_PRICING
5. `packages/server/src/db.ts` — current database schema and query helpers
6. `packages/server/src/services/eventStore.ts` — event normalization
7. `apps/dashboard/src/components/analytics/mockData.ts` — mock data shape (target interface)
8. `apps/dashboard/src/components/analytics/AnalyticsPage.tsx` — current page structure

---

## Agent A Prompt: Backend Implementation

### Your Role
You are implementing the server-side analytics infrastructure for Synapse. You work in `packages/server/` and `packages/core/`.

### Phase 1 Tasks (Do These First)

#### Task 1.1: Analytics API Endpoints
Create `packages/server/src/routes/analytics.ts` with these endpoints:

```
GET /api/analytics/overview?from=&to=&cwd=
GET /api/analytics/timeseries?from=&to=&granularity=hour|day|week&cwd=
GET /api/analytics/sessions?from=&to=&cwd=&limit=&offset=
GET /api/analytics/tools?from=&to=&cwd=
GET /api/analytics/models?from=&to=&cwd=
GET /api/analytics/turns?sessionId=
```

**Requirements**:
- All queries use parameterized SQL against the `events` table
- Time range filtering via `created_at BETWEEN ? AND ?`
- CWD filtering for per-project isolation
- Zod validation on all query params (create `AnalyticsQuerySchema` in `packages/core/src/schemas.ts`)
- Response envelope: `{ data: T, meta: { from: number, to: number, totalCount: number } }`
- Cost computation using `computeCostUsd()` from the cost service (Task 1.2)
- Register routes in `packages/server/src/index.ts`

#### Task 1.2: Cost Computation Service
Create `packages/server/src/services/costService.ts`:

```typescript
// Must support:
// 1. Hardcoded pricing for current models (Anthropic, OpenAI, Google, Groq)
// 2. Time-based price lookup (for historical accuracy)
// 3. User-defined custom model pricing
// 4. Fallback to DEFAULT_PRICING for unknown models

interface PricePoint {
  model: string;
  vendor: string;
  effectiveFrom: number;     // Unix ms
  inputPer1M: number;
  cachedInputPer1M: number;
  outputPer1M: number;
}

export function getPrice(model: string, timestamp?: number): PricePoint;
export function computeCostUsd(model: string, inputTokens: number, outputTokens: number, cacheReadTokens: number, timestamp?: number): number;
export function getAllPrices(): PricePoint[];
```

**Pricing data to include** (as of Feb 2026):
- Anthropic: claude-opus-4-6 ($15/$1.50/$75), claude-sonnet-4-5 ($3/$0.30/$15), claude-haiku-4-5 ($0.80/$0.08/$4)
- OpenAI: gpt-4o ($2.50/$1.25/$10), gpt-4o-mini ($0.15/$0.075/$0.60), o1 ($15/$7.50/$60), o3-mini ($1.10/$0.55/$4.40)
- Google: gemini-2.5-pro ($1.25/$0.3125/$10), gemini-2.5-flash ($0.15/$0.0375/$0.60)

#### Task 1.3: Rollup Tables
Add to `packages/server/src/db.ts`:
- `analytics_daily` table with per-date, per-cwd, per-model aggregations
- `analytics_tool_daily` table with per-date, per-tool aggregations
- `price_history` table for time-based pricing
- Index creation for all new tables
- `updateDailyRollup(event)` function called after event insert

**Important**: Use the same `initDb()` pattern — add CREATE TABLE IF NOT EXISTS and migration ALTERs. The database uses sql.js (not better-sqlite3), so use the existing `queryAll`, `queryGet`, `execute` helpers.

#### Task 1.4: Tests
Write tests using Vitest:
- `packages/server/src/__tests__/costService.test.ts`
- `packages/server/src/__tests__/analyticsRoutes.test.ts` (use supertest)

Run with: `pnpm test --filter @synapse-ai/server`

### Phase 2 Tasks (After Phase 1 is verified)

#### Task 2.1: Provider Normalizer
Create `packages/server/src/services/providerNormalizer.ts` — normalize events from OpenAI, Google, Groq formats to Synapse's AgentEvent shape.

#### Task 2.2: Import Service
Create `packages/server/src/services/importService.ts` with `POST /api/analytics/import` — accept OpenAI CSV, generic JSON, Gemini JSON formats.

#### Task 2.3: Price History API
Add CRUD endpoints for `price_history` table:
- `GET /api/analytics/prices`
- `POST /api/analytics/prices`
- `DELETE /api/analytics/prices/:id`

### Phase 3 Tasks

#### Task 3.1: Velocity Service
Create `packages/server/src/services/velocityService.ts` — compute tokens/minute, cost/minute, context utilization, efficiency scores.

#### Task 3.2: Prompt Analyzer
Create `packages/server/src/services/promptAnalyzer.ts` — compute complexity scores, auto-classify prompts, find optimization opportunities.

### Phase 4 Tasks

#### Task 4.1: Insights Engine
Create `packages/server/src/services/insightsEngine.ts` — rule-based daily insights (cost spikes, cache improvements, streak tracking).

#### Task 4.2: Budget Service
Create `packages/server/src/services/budgetService.ts` — budget tracking with prediction (weighted moving average), threshold alerts.

#### Task 4.3: Badge System
Add `badges_earned` table, badge definitions, and earning logic. Endpoint: `GET /api/analytics/badges`.

---

## Agent B Prompt: Frontend Implementation

### Your Role
You are implementing the frontend analytics views in `apps/dashboard/src/components/analytics/`. The prototype tabs already exist with mock data — your job is to wire them to real data and add new views.

### Phase 1 Tasks (Do These First)

#### Task 1.1: Data Fetching Hook
Create `apps/dashboard/src/components/analytics/useAnalyticsData.ts`:

```typescript
interface AnalyticsFilters {
  timeRange: string;         // '24h' | '7d' | '30d' | 'all' | custom
  cwd?: string;
  model?: string;
  vendor?: string;
  sessionId?: string;
}

interface AnalyticsData {
  overview: { totalCost: number; totalTokens: { input: number; output: number; cacheRead: number }; totalSessions: number; totalToolCalls: number; avgLatencyMs: number } | null;
  timeseries: { timestamp: number; cost: number; inputTokens: number; outputTokens: number; sessions: number; toolCalls: number }[];
  sessions: MockSession[];     // Use the existing MockSession interface shape
  tools: { name: string; count: number; avgDuration: number; errorRate: number }[];
  models: { model: string; sessions: number; cost: number; tokens: number }[];
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
}

export function useAnalyticsData(filters: AnalyticsFilters): AnalyticsData;
```

**Requirements**:
- Fetch from `/api/analytics/*` endpoints (Agent A builds these)
- Parallel fetches for independent endpoints
- AbortController for cleanup on unmount or filter change
- Error handling with user-friendly messages
- Loading skeleton states
- Fallback to `generateMockData()` when API returns errors (dev mode indicator)

#### Task 1.2: Wire Prototype Tabs to Real Data
Modify `AnalyticsPage.tsx` to use `useAnalyticsData()` instead of `generateMockData()`.
Update each prototype component to accept the real data shape.
Add an adapter layer if the API response shape differs from MockData.

#### Task 1.3: Loading, Error, and Empty States
For each prototype tab, add:
- **Loading**: Skeleton placeholders matching the chart layout
- **Error**: Retry button with error message
- **Empty**: "No data yet" message with instructions to start a session

### Phase 2 Tasks

#### Task 2.1: What-If Calculator
Create `apps/dashboard/src/components/analytics/whatif/WhatIfCalculator.tsx`:
- Session/date range selector
- Target model dropdown
- Side-by-side cost comparison chart
- Savings indicator
- "Quality factor" slider for model capability adjustment

#### Task 2.2: Vendor Breakdown
Create `apps/dashboard/src/components/analytics/executive/VendorBreakdown.tsx`:
- Treemap: cost by vendor → model
- Stacked area: daily cost by vendor
- Vendor-colored badges

### Phase 3 Tasks

#### Task 3.1: Token Velocity View
Create `apps/dashboard/src/components/analytics/velocity/TokenVelocityView.tsx`:
- Velocity gauge (tokens/minute)
- Context window utilization bar
- Efficiency score (composite 0-100)
- Velocity sparkline over turns

#### Task 3.2: Prompt Analyzer View
Create `apps/dashboard/src/components/analytics/prompts/PromptAnalyzer.tsx`:
- Sortable prompt table with complexity scores
- Scatter plot: complexity vs cost
- Prompt category pie chart
- Optimization suggestions panel

#### Task 3.3: Tool Chain View
Create `apps/dashboard/src/components/analytics/tools/ToolChainView.tsx`:
- Tool co-occurrence matrix
- Common tool sequences
- Tool error hotspots

### Phase 4 Tasks

#### Task 4.1: Insights Dashboard
Create `apps/dashboard/src/components/analytics/insights/InsightsView.tsx`:
- AI summary banner (collapsible)
- Insight cards grid
- Badge shelf with earned badges
- Budget gauge with forecast

Add this as a 5th tab in the analytics page.

### Phase 5 Tasks

#### Task 5.1: Export Dialog
Create `apps/dashboard/src/components/analytics/export/ExportDialog.tsx` with HTML and PDF export.

---

## Agent C Prompt: Testing & Integration

### Your Role
You are responsible for end-to-end testing, integration verification, performance testing, and accessibility for the Synapse analytics dashboard.

### Setup
Install Playwright: `pnpm add -D @playwright/test --filter @synapse-ai/dashboard`
Create `apps/dashboard/playwright.config.ts` and `apps/dashboard/e2e/` directory.

### E2E Test Specs

#### `analytics-overview.spec.ts`
- Navigate to `?view=analytics`
- Verify all 4 prototype tabs are visible
- Click each tab, verify charts render (check for SVG elements)
- Verify KPI cards show numeric values
- Test time range selector changes data
- Test responsive layout at 1024px and 1440px widths

#### `analytics-explorer.spec.ts`
- Navigate to Deep Dive tab
- Click model filter, verify charts update
- Click tool filter, verify charts update
- Verify heatmap renders with correct number of rows
- Verify latency histogram has P50/P99 markers

#### `analytics-replay.spec.ts`
- Navigate to Session Replay tab
- Select a session from the dropdown
- Verify turn cards appear in the timeline
- Click a turn card, verify it expands with details
- Verify cumulative cost chart updates with session selection
- Verify compaction markers appear

#### `analytics-comparison.spec.ts`
- Navigate to Compare tab
- Select two different sessions
- Verify metric comparison table renders with delta indicators
- Verify radar chart shows both sessions
- Verify mirrored bar charts render

#### `analytics-api.spec.ts` (API integration)
- Start server, seed test data
- Hit each `/api/analytics/*` endpoint
- Verify response shapes match expected interfaces
- Verify time range filtering returns correct subset
- Verify CWD filtering isolates data
- Load test: 10k events, verify analytics queries complete in <500ms

### Performance Benchmarks
- Analytics page initial load: <2s on localhost
- Tab switch: <500ms
- Chart interaction (hover, filter): <100ms
- API response time with 10k events: <500ms
- Bundle size: analytics chunk <200KB gzipped

### Accessibility Audit
- All charts have `aria-label` descriptions
- Keyboard navigation works for all tabs and controls
- Focus indicators visible on all interactive elements
- Color contrast meets WCAG 2.1 AA
- Screen reader announces tab changes and data updates

---

## Conventions to Follow

- **No `any` types** — use `unknown` and narrow with type guards
- **Zod validation** at all API boundaries
- **Pino logging** on server (not console.log)
- **Parameterized SQL** for all queries (no string interpolation)
- **`@synapse-ai/core`** for all shared types (never relative cross-package imports)
- **Zustand selectors**: avoid `?? []` inside selectors (infinite re-render risk), use module-level `const EMPTY: T[] = []`
- **Express 5**: `req.params.id` returns `string | string[]` — cast to `string`
- **sql.js**: use `queryAll`, `queryGet`, `execute` helpers from `db.ts`
- **Recharts 3.x**: Tooltip `formatter` takes `(value: number | undefined)` — use default params `(v: number = 0)`
- **Tailwind CSS 4**: dark theme uses `bg-[#0d1117]` base, `bg-[#161b22]` cards, `border-gray-800` borders

## Running the Project

```bash
# Install dependencies
pnpm install

# Start backend (port 4000)
npx tsx packages/server/src/index.ts

# Start frontend (port 5173)
cd apps/dashboard && npx vite

# Run tests
pnpm test

# Type check
npx tsc --noEmit --project apps/dashboard/tsconfig.json

# Build
cd apps/dashboard && npx vite build
```

## Verification Between Phases

After each phase, run:
1. `npx tsc --noEmit --project apps/dashboard/tsconfig.json` — zero errors
2. `pnpm test` — all tests pass
3. `cd apps/dashboard && npx vite build` — build succeeds
4. Manual check: open `http://localhost:5173/?view=analytics` and verify all tabs work
5. Check bundle size: analytics chunk should be <200KB gzipped

---

## Additional Nerdy Feature Ideas (Bonus)

If you finish the main phases and want to add more:

1. **Session Diff**: Compare two sessions' prompt strategies side-by-side, highlighting what made one more efficient
2. **Token Heatmap Calendar**: GitHub contribution-style calendar showing daily token usage (green = low cost, red = high cost)
3. **Model Recommendation Engine**: Based on your usage patterns, suggest which model to use for which task types
4. **Carbon Footprint Estimator**: Approximate CO2 emissions from AI usage (based on data center energy estimates)
5. **Keyboard Shortcut Analytics**: Track which Synapse shortcuts you use most, suggest ones you're missing
6. **Prompt Template Library**: Save and share effective prompts, track which templates perform best
7. **Real-time Cost Ticker**: Live-updating cost counter in the header showing today's spend accumulating
8. **Session Recording Playback**: Step through a past session turn-by-turn, seeing exactly what happened
9. **Team Leaderboard** (if multi-user): Compare efficiency scores across team members (opt-in)
10. **Weekly Email Digest**: Automated weekly summary email with charts (requires email integration)
