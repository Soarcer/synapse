# Synapse Analytics Dashboard — Implementation & Verification Plan

## Decision Summary

| Decision | Choice |
|----------|--------|
| **Launch model** | Same app, route switch (`?view=analytics`) |
| **Multi-provider** | Hooks + CSV/JSON import hybrid |
| **Pricing** | Snapshot cost on events + price_history table for what-if |
| **Testing** | Unit + integration + E2E (Playwright) |
| **Export** | Self-contained HTML + PDF |
| **Timeline** | Phased roadmap (each phase independently shippable) |
| **AI Coach** | Data cards + AI-generated summary + gamification badges |

---

## Phase 1 — Real Data Integration (Foundation)

**Goal**: Replace mock data with real Synapse event data. The analytics dashboard shows actual usage from the SQLite DB.

### 1.1 Backend: Analytics API Endpoints

**New file**: `packages/server/src/routes/analytics.ts`

```
GET /api/analytics/overview?from=&to=&cwd=
  → { totalCost, totalTokens, totalSessions, totalToolCalls, avgLatency }

GET /api/analytics/timeseries?from=&to=&granularity=hour|day|week&cwd=
  → [{ timestamp, cost, inputTokens, outputTokens, cacheReadTokens, sessions, toolCalls }]

GET /api/analytics/sessions?from=&to=&cwd=&limit=&offset=
  → [{ sessionId, name, model, vendor, totalCost, totalTokens, toolCalls, duration, startTime }]

GET /api/analytics/tools?from=&to=&cwd=
  → [{ toolName, callCount, avgDurationMs, errorCount, errorRate, totalTokens }]

GET /api/analytics/models?from=&to=&cwd=
  → [{ model, vendor, sessions, totalCost, totalTokens, avgLatency }]

GET /api/analytics/turns?sessionId=
  → [{ turnIndex, timestamp, promptText, inputTokens, outputTokens, cacheReadTokens,
        cacheCreationTokens, toolCount, toolNames, latencyMs, costUsd, model, compactionBefore,
        thinkingLength, textLength }]
```

**Implementation details**:
- All queries use parameterized SQL against the `events` table
- Time range filtering: `created_at BETWEEN ? AND ?`
- CWD filtering for per-project analytics
- Zod validation on all query params (`AnalyticsQuerySchema`)
- Cost computation: `computeCostUsd(model, inputTokens, outputTokens, cacheReadTokens)` using price snapshot
- Response envelope: `{ data: T[], meta: { from, to, totalCount } }`
- Pagination with cursor-based or offset-based strategy

### 1.2 Backend: Cost Computation Service

**New file**: `packages/server/src/services/costService.ts`

```typescript
interface PricePoint {
  model: string;
  vendor: string;
  effectiveFrom: number;     // Unix ms
  inputPer1M: number;        // USD per 1M tokens
  cachedInputPer1M: number;
  outputPer1M: number;
}

// Functions:
getPrice(model: string, timestamp: number): PricePoint
computeCostUsd(model: string, input: number, output: number, cacheRead: number, timestamp?: number): number
getAllPrices(): PricePoint[]
addPrice(price: PricePoint): void
```

**Price data sources** (hardcoded initially, user-editable later):
- Anthropic: Opus 4.6, Sonnet 4.5, Haiku 4.5 (with date-stamped pricing)
- OpenAI: GPT-4o, GPT-4o-mini, o1, o1-mini, o3-mini
- Google: Gemini 2.5 Pro, Gemini 2.5 Flash
- Groq: Llama 3.3, Mixtral
- Custom: user-defined models + pricing

### 1.3 Backend: Rollup Tables

**New tables in `db.ts` schema migration**:

```sql
-- Pre-aggregated daily stats for fast analytics queries
CREATE TABLE IF NOT EXISTS analytics_daily (
  date TEXT NOT NULL,                -- YYYY-MM-DD
  cwd TEXT,                          -- NULL for global
  model TEXT,                        -- NULL for all-model rollup
  vendor TEXT,
  total_events INTEGER DEFAULT 0,
  total_sessions INTEGER DEFAULT 0,
  total_input_tokens INTEGER DEFAULT 0,
  total_output_tokens INTEGER DEFAULT 0,
  total_cache_read_tokens INTEGER DEFAULT 0,
  total_cache_creation_tokens INTEGER DEFAULT 0,
  total_cost_usd REAL DEFAULT 0,
  total_tool_calls INTEGER DEFAULT 0,
  total_errors INTEGER DEFAULT 0,
  total_compactions INTEGER DEFAULT 0,
  sum_latency_ms INTEGER DEFAULT 0,
  count_latency INTEGER DEFAULT 0,  -- for computing average
  min_latency_ms INTEGER,
  max_latency_ms INTEGER,
  PRIMARY KEY (date, COALESCE(cwd, '__all__'), COALESCE(model, '__all__'))
);

CREATE INDEX IF NOT EXISTS idx_daily_date ON analytics_daily(date);
CREATE INDEX IF NOT EXISTS idx_daily_cwd ON analytics_daily(cwd);

-- Tool-level daily rollups
CREATE TABLE IF NOT EXISTS analytics_tool_daily (
  date TEXT NOT NULL,
  cwd TEXT,
  tool_name TEXT NOT NULL,
  call_count INTEGER DEFAULT 0,
  error_count INTEGER DEFAULT 0,
  total_duration_ms INTEGER DEFAULT 0,
  avg_duration_ms REAL DEFAULT 0,
  PRIMARY KEY (date, COALESCE(cwd, '__all__'), tool_name)
);

-- Model pricing history
CREATE TABLE IF NOT EXISTS price_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  model TEXT NOT NULL,
  vendor TEXT NOT NULL,
  effective_from INTEGER NOT NULL,   -- Unix ms
  input_per_1m REAL NOT NULL,
  cached_input_per_1m REAL NOT NULL,
  output_per_1m REAL NOT NULL,
  source TEXT DEFAULT 'default',     -- 'default' | 'user' | 'api'
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_price_model ON price_history(model, effective_from);
```

**Rollup trigger**: `updateDailyRollup(event)` called after each event insert, debounced to batch.

### 1.4 Frontend: Replace Mock Data with API Calls

**Modify**: `apps/dashboard/src/components/analytics/AnalyticsPage.tsx`

- Add `useAnalyticsData(timeRange, cwdFilter)` hook that fetches from `/api/analytics/*`
- Loading states, error states, empty states for each prototype tab
- Pass real data through the same `MockData`-shaped interface (adapter pattern)
- Fallback to mock data when server is unavailable (dev mode)

**New file**: `apps/dashboard/src/components/analytics/useAnalyticsData.ts`

```typescript
interface AnalyticsData {
  overview: OverviewMetrics;
  timeseries: TimeseriesPoint[];
  sessions: SessionSummary[];
  tools: ToolSummary[];
  models: ModelSummary[];
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
}

function useAnalyticsData(timeRange: string, cwd?: string): AnalyticsData
```

### 1.5 Tests for Phase 1

**Unit tests** (`packages/server/src/__tests__/`):
- `costService.test.ts` — price lookup, cost computation, edge cases (unknown model, zero tokens)
- `analyticsRollup.test.ts` — rollup computation, incremental updates, date boundaries

**Integration tests** (`packages/server/src/__tests__/`):
- `analyticsRoutes.test.ts` — all 6 endpoints with supertest, time range filtering, pagination, error responses

**Frontend tests** (`apps/dashboard/src/components/analytics/__tests__/`):
- `useAnalyticsData.test.ts` — hook with mock fetch, loading/error states
- `computeMetrics.test.ts` — metric derivation from API responses

### 1.6 Verification Checklist

- [ ] All 6 API endpoints return correct data for known seed data
- [ ] Time range filtering works (24h, 7d, 30d, custom)
- [ ] CWD filtering isolates project data
- [ ] Cost computation matches manual calculation for known token counts
- [ ] Rollup tables update correctly on event insert
- [ ] Frontend loads real data and all 4 prototype tabs render correctly
- [ ] Graceful fallback when server is unavailable
- [ ] No N+1 queries (verify with SQL query logging)

---

## Phase 2 — Multi-Provider Support + Price History

**Goal**: Track and display usage across Anthropic, OpenAI, Google, Groq, and custom providers.

### 2.1 Provider-Agnostic Event Normalization

**Modify**: `packages/server/src/services/eventStore.ts`

Add normalization for different hook event formats:
- **Claude Code hooks**: Already normalized (current format)
- **OpenClaw events**: `vendor` field already supported, normalize token field names
- **OpenAI format**: Map `prompt_tokens` → `inputTokens`, `completion_tokens` → `outputTokens`
- **Gemini format**: Map `totalTokenCount` → total, split input/output
- **Custom webhook**: Accept a generic JSON payload with field mapping config

**New file**: `packages/server/src/services/providerNormalizer.ts`

```typescript
interface NormalizedUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  model: string;
  vendor: string;
  costUsd: number;     // computed at ingestion time
  latencyMs?: number;
}

function normalizeProviderEvent(raw: unknown, vendor: string): NormalizedUsage
```

### 2.2 CSV/JSON Import for Historical Data

**New endpoint**: `POST /api/analytics/import`

Accepted formats:
- **OpenAI usage export** (CSV from platform.openai.com/usage)
- **Google Cloud billing export** (JSON from Cloud Console)
- **Generic JSON** (array of `{ timestamp, model, inputTokens, outputTokens, cost }`)
- **Synapse snapshot** (already supported, extend with analytics metadata)

**New file**: `packages/server/src/services/importService.ts`

```typescript
interface ImportResult {
  eventsImported: number;
  totalCost: number;
  dateRange: { from: string; to: string };
  vendors: string[];
  errors: string[];
}

function importOpenAICsv(csv: string): ImportResult
function importGeminiJson(json: unknown): ImportResult
function importGenericJson(json: unknown): ImportResult
```

### 2.3 Price History Management

**New endpoint**: `GET /api/analytics/prices` — list all prices
**New endpoint**: `POST /api/analytics/prices` — add/update a price
**New endpoint**: `DELETE /api/analytics/prices/:id` — remove a user price

**Frontend**: Price management UI in analytics settings
- Table showing all models, current price, effective date
- "Add Custom Model" form
- "Override Price" for existing models (user price takes precedence)

### 2.4 What-If Calculator

**New component**: `apps/dashboard/src/components/analytics/whatif/WhatIfCalculator.tsx`

- Select a session or date range
- Choose target model (e.g., "What if I used Sonnet instead of Opus?")
- Shows: original cost, hypothetical cost, savings, token count adjustment (some models need more tokens)
- Adjustable "quality factor" slider (e.g., Haiku may need 1.5x more turns than Opus)
- Bar chart comparing costs across all available models

### 2.5 Vendor Dashboard Section

**New component**: `apps/dashboard/src/components/analytics/executive/VendorBreakdown.tsx`

- Treemap: cost by vendor → model
- Stacked area: daily cost by vendor
- Table: vendor comparison (cost, tokens, latency, error rate)
- Vendor-colored badges throughout the dashboard

### 2.6 Tests for Phase 2

**Unit tests**:
- `providerNormalizer.test.ts` — each vendor format, edge cases, malformed data
- `importService.test.ts` — CSV parsing, JSON validation, deduplication
- `priceHistory.test.ts` — time-based lookup, user overrides, fallback pricing

**Integration tests**:
- `import.test.ts` — end-to-end import flow with supertest
- `prices.test.ts` — CRUD operations on price history

### 2.7 Verification Checklist

- [ ] OpenAI CSV import parses correctly (test with real export file)
- [ ] Gemini JSON import works
- [ ] Generic JSON import handles all required fields
- [ ] What-If calculator produces sensible cost comparisons
- [ ] Price history correctly applies time-based pricing
- [ ] User-defined prices override defaults
- [ ] Vendor colors and labels render consistently across all views
- [ ] Import deduplication prevents double-counting

---

## Phase 3 — Token Velocity, Efficiency & Prompt Analysis

**Goal**: Deep analytics on usage patterns, prompt quality, and efficiency metrics.

### 3.1 Token Velocity Engine

**New file**: `packages/server/src/services/velocityService.ts`

Metrics computed per session and globally:
- **Tokens/minute**: Rolling average of (inputTokens + outputTokens) / session_duration_minutes
- **Cost/minute**: Rolling cost accumulation rate
- **Context window utilization**: inputTokens / model_context_limit (e.g., 200k for Opus)
- **Thinking overhead ratio**: thinkingTokens / outputTokens (Opus-specific)
- **Output efficiency**: outputTokens / inputTokens (how much new content per context)
- **Cache efficiency score**: (cacheReadTokens / totalInputTokens) — higher = better

**Frontend component**: `apps/dashboard/src/components/analytics/velocity/TokenVelocityView.tsx`

- Real-time gauge: tokens/minute, cost/minute
- Session timeline: velocity curve overlaid on cost curve
- Context window utilization bar (fills up as context grows, resets on compaction)
- Efficiency leaderboard: sessions ranked by cost-per-output-token

### 3.2 Prompt Complexity Analyzer

**New file**: `packages/server/src/services/promptAnalyzer.ts`

Per-prompt metrics:
- **Token count**: raw prompt length in tokens (approximate from char count)
- **Estimated complexity**: based on tool calls triggered, agent spawns, duration
- **Cost-per-prompt**: total cost of the response cycle
- **Tool chain depth**: max depth of agent → subagent → tool chains
- **Response amplification**: outputTokens / promptTokens ratio
- **Compaction trigger**: did this prompt cause a context compaction?

Aggregate insights:
- **Most expensive prompts** (top 10 by cost)
- **Most efficient prompts** (best output/cost ratio)
- **Prompt patterns**: cluster similar prompts, show avg cost per pattern
- **Prompt length sweet spot**: scatter plot of prompt length vs. response quality/cost

**Frontend component**: `apps/dashboard/src/components/analytics/prompts/PromptAnalyzer.tsx`

- Sortable table of all prompts with metrics
- Prompt detail view with breakdown
- "Expensive prompt" warnings with suggestions
- Prompt length distribution histogram

### 3.3 Tool Chain Analysis

**New component**: `apps/dashboard/src/components/analytics/tools/ToolChainView.tsx`

- Sankey diagram: prompt → agent → tools flow with cost/token weights
- Tool co-occurrence matrix: which tools are used together
- Tool sequence analysis: common tool call patterns (e.g., Grep → Read → Edit)
- Tool error hotspots: which tools fail most often and in what context

### 3.4 Tests for Phase 3

**Unit tests**:
- `velocityService.test.ts` — all velocity metrics with known data
- `promptAnalyzer.test.ts` — complexity scoring, cost attribution, edge cases

**Component tests**:
- `TokenVelocityView.test.tsx` — renders with various data shapes
- `PromptAnalyzer.test.tsx` — sorting, filtering, prompt detail expansion

### 3.5 Verification Checklist

- [ ] Token velocity matches manual calculation
- [ ] Context window utilization correctly uses per-model limits
- [ ] Prompt complexity scores correlate with actual cost (sanity check)
- [ ] Tool chain Sankey renders correctly with complex agent hierarchies
- [ ] All views handle edge cases (single turn, zero tokens, no tools)

---

## Phase 4 — AI Coach + Gamification

**Goal**: AI-generated daily insights, usage tips, achievement badges, and habit tracking.

### 4.1 Daily Insights Engine

**New file**: `packages/server/src/services/insightsEngine.ts`

Generates structured insights from analytics data:

```typescript
interface DailyInsight {
  id: string;
  type: 'achievement' | 'warning' | 'tip' | 'trend' | 'comparison';
  severity: 'info' | 'positive' | 'negative' | 'neutral';
  title: string;          // "Cache Hit Rate Improved!"
  description: string;    // "Your cache hit rate jumped from 45% to 72% today..."
  metric?: string;        // "cacheHitRate"
  value?: number;
  previousValue?: number;
  suggestion?: string;    // "Try breaking complex prompts into smaller steps..."
  badge?: Badge;
}

interface Badge {
  id: string;
  name: string;           // "Cache Master"
  icon: string;           // emoji
  description: string;
  condition: string;      // "90%+ cache hit rate in a session"
  earnedAt?: number;
}
```

**Rule-based insights** (no LLM needed):
- Cost spike detection: "Today cost 3x your weekly average"
- Cache improvement: "Cache hit rate improved by X%"
- Model efficiency: "Switching 2 sessions to Sonnet would save $X"
- Tool diversity: "You used 8 different tools today vs. your avg of 5"
- Compaction frequency: "3 compactions today — try shorter sessions"
- Prompt optimization: "Your top 3 prompts cost more than the rest combined"
- Streak tracking: "5-day streak of keeping costs under $X"

### 4.2 AI-Generated Summary (Optional LLM Call)

**New endpoint**: `POST /api/analytics/insights/generate`

- Collects today's metrics into a structured prompt
- Calls Claude Haiku (cheap) to generate a natural language daily summary
- Caches the result (one generation per day)
- User can opt out (rule-based only mode)

**Prompt template**:
```
You are an AI coding assistant usage analyst. Based on today's metrics, write a brief,
friendly daily summary (3-5 sentences) with one specific, actionable tip.

Today's data:
- Sessions: {n}, Total cost: ${cost}
- Models used: {models}
- Top tools: {tools}
- Cache hit rate: {rate}%
- Avg latency: {latency}ms
- Notable: {insights}

Be specific, reference actual numbers, and suggest one concrete improvement.
```

### 4.3 Achievement Badge System

**Badges** (earned automatically):

| Badge | Condition | Icon |
|-------|-----------|------|
| Cache Master | 90%+ cache hit rate in a session | `🎯` |
| Speed Demon | Avg latency <1s across a session | `⚡` |
| Penny Pincher | Complete a session for <$0.10 | `💰` |
| Tool Master | Use 8+ unique tools in one session | `🔧` |
| Marathon Runner | Session with 20+ turns | `🏃` |
| Efficiency Expert | <1000 input tokens per output token | `📊` |
| Multi-Model | Use 3+ different models in one day | `🎨` |
| Zero Errors | Session with 0 tool errors | `✅` |
| Compaction Survivor | Session with 3+ compactions and still productive | `🔄` |
| Night Owl | Session after midnight | `🦉` |
| Early Bird | Session before 7 AM | `🌅` |
| Budget Master | Stay under daily budget for 7 consecutive days | `🏆` |

**Storage**: `badges_earned` table in SQLite
**Display**: Badge shelf in the analytics header, toast on new badge earned

### 4.4 Budget Alerts & Prediction

**New file**: `packages/server/src/services/budgetService.ts`

```typescript
interface BudgetConfig {
  dailyLimitUsd?: number;
  weeklyLimitUsd?: number;
  monthlyLimitUsd?: number;
  alertThreshold: number;   // 0.8 = alert at 80%
}

interface BudgetStatus {
  daily: { spent: number; limit: number; percentage: number; alert: boolean };
  weekly: { spent: number; limit: number; percentage: number; alert: boolean };
  predicted: { dailyForecast: number; weeklyForecast: number; monthlyForecast: number };
}
```

**Prediction**: Simple linear extrapolation from last 7 days' trend
**Alerts**: WebSocket push when threshold crossed, shown as toast + header badge

### 4.5 Frontend: Insights Dashboard

**New component**: `apps/dashboard/src/components/analytics/insights/InsightsView.tsx`

- Top banner: AI-generated daily summary (collapsible)
- Insight cards grid: rule-based insights with icons and severity colors
- Badge shelf: earned badges with unlock dates
- Budget gauge: daily/weekly progress bars with forecast line
- Tips carousel: rotating tips based on usage patterns

### 4.6 Tests for Phase 4

**Unit tests**:
- `insightsEngine.test.ts` — all insight rules with boundary conditions
- `budgetService.test.ts` — threshold detection, prediction accuracy

**Integration tests**:
- `insights.test.ts` — API endpoint with known data, verify insight generation
- `badges.test.ts` — badge earning conditions, no duplicate awards

**E2E tests** (Playwright):
- Navigate to insights tab, verify insights render
- Set budget, trigger alert, verify toast appears
- Earn a badge, verify it appears in the shelf

### 4.7 Verification Checklist

- [ ] Rule-based insights generate correctly for known data patterns
- [ ] AI summary generates without errors (when enabled)
- [ ] Badges award correctly and don't double-award
- [ ] Budget alerts fire at correct thresholds
- [ ] Budget prediction is within 20% of actual (backtested on historical data)
- [ ] Insights view handles zero-data and first-time-user states

---

## Phase 5 — Export (HTML + PDF)

**Goal**: Generate shareable reports in standalone HTML and PDF formats.

### 5.1 HTML Export

**New file**: `apps/dashboard/src/components/analytics/export/htmlExporter.ts`

- Serialize current analytics view to a self-contained HTML file
- Inline all CSS, embed chart data as JSON
- Use a lightweight chart renderer (e.g., inline SVG or Chart.js CDN) for the standalone file
- Include: header with project name + date range, all KPI cards, top charts, session table
- File size target: <500KB

### 5.2 PDF Export

**Dependencies**: `html2canvas` + `jsPDF`

**New file**: `apps/dashboard/src/components/analytics/export/pdfExporter.ts`

- Render each chart section to canvas, then to PDF pages
- Professional layout: cover page, table of contents, chart pages, data tables
- Include Synapse branding and timestamp

### 5.3 Export UI

**New component**: `apps/dashboard/src/components/analytics/export/ExportDialog.tsx`

- Format picker: HTML / PDF / Both
- Section picker: which charts/tables to include
- Date range override
- "Download" button

### 5.4 Tests for Phase 5

- `htmlExporter.test.ts` — generates valid HTML, data embedded correctly
- `pdfExporter.test.ts` — generates valid PDF (file header check)
- E2E: export button → file download → file opens correctly

---

## Parallel Agent Strategy

Three agents can work simultaneously on non-overlapping concerns:

### Agent A: Backend (Server + Core)
**Scope**: Phases 1.1–1.3, 2.1–2.3, 3.1–3.2, 4.1–4.4
- Analytics API endpoints
- Cost service + price history
- Rollup tables + migrations
- Provider normalization
- Import service
- Velocity/prompt analysis services
- Insights engine + budget service
- All server-side unit + integration tests

### Agent B: Frontend (Dashboard Components)
**Scope**: Phases 1.4, 2.4–2.5, 3.1–3.3 (components), 4.5, 5.1–5.3
- Replace mock data with API calls (`useAnalyticsData` hook)
- What-If Calculator UI
- Vendor Breakdown UI
- Token Velocity, Prompt Analyzer, Tool Chain views
- Insights/Badges/Budget dashboard
- Export dialog + HTML/PDF generators
- All frontend component tests

### Agent C: Testing + Integration
**Scope**: E2E tests, integration verification, cross-cutting concerns
- Playwright E2E test suite for all analytics flows
- API-to-frontend integration tests
- Performance benchmarks (analytics queries on 10k+ events)
- Accessibility audit (ARIA, keyboard nav, screen reader)
- Bundle size monitoring
- Documentation updates

### Dependency Graph

```
Phase 1: Agent A (API endpoints) ──→ Agent B (frontend wiring) ──→ Agent C (E2E)
                                 ↗
Phase 2: Agent A (providers) ────→ Agent B (What-If, Vendor UI) ──→ Agent C (E2E)

Phase 3: Agent A (velocity, prompts) → Agent B (views) → Agent C (E2E)

Phase 4: Agent A (insights, badges) → Agent B (insights UI) → Agent C (E2E)

Phase 5: Agent B (export) → Agent C (verification)
```

Within each phase, Agent A starts first (backend), Agent B follows once APIs are defined (can start with mock responses), Agent C runs after both complete.

---

## Nerdy Features — Detailed Specs

### What-If Calculator

**Data flow**:
1. User selects session(s) or date range
2. Frontend queries `GET /api/analytics/turns?sessionId=X`
3. User picks target model from dropdown
4. Frontend computes: for each turn, recalculate cost using target model pricing
5. Display: side-by-side cost comparison, total savings/increase, per-turn breakdown

**Edge cases**:
- Model doesn't exist in price history → show warning, use default pricing
- Token counts may differ between models (Opus thinking vs Sonnet) → adjustable multiplier
- Cache behavior differs between models → toggle "assume same cache rate" vs "reset cache"

### Token Velocity & Efficiency

**Metrics displayed**:
- **Velocity gauge**: animated speedometer showing current tokens/minute
- **Efficiency score**: composite 0-100 score based on:
  - Cache hit rate (weight: 30%)
  - Output/input ratio (weight: 25%)
  - Tool error rate (weight: 20%, inverted)
  - Compaction frequency (weight: 15%, inverted)
  - Cost per output token (weight: 10%, inverted)
- **Context window pressure**: horizontal bar showing how full the context window is
- **Velocity sparkline**: tokens/minute over the last 20 turns

### Prompt Complexity Analyzer

**Complexity score formula**:
```
complexity = (tokenCount / 100) * 0.2
           + (toolCallsTriggered) * 0.3
           + (agentSpawns * 2) * 0.2
           + (responseLatency / 1000) * 0.15
           + (compactionTriggered ? 5 : 0) * 0.15
```

**Prompt categories** (auto-classified):
- `simple-question` — short prompt, no tools, quick response
- `code-generation` — triggers Write/Edit tools
- `debugging` — triggers Read/Grep/Bash tools
- `refactoring` — triggers many Read + Edit cycles
- `research` — triggers WebSearch/WebFetch
- `orchestration` — spawns subagents (Task tool)

**Display**:
- Scatter plot: complexity score vs. cost (find outliers)
- Table: prompts sorted by cost, with complexity badge
- Category pie chart: distribution of prompt types
- "Optimization suggestions" panel: specific tips per high-cost prompt

### Budget Alerts + Prediction

**Prediction model**: Weighted moving average of last 7 days
```
forecast_daily = (day[-1] * 0.3 + day[-2] * 0.25 + day[-3] * 0.2 + ... + day[-7] * 0.05)
forecast_weekly = forecast_daily * 7
forecast_monthly = forecast_daily * 30
```

**Alert delivery**:
- WebSocket push → toast notification in dashboard
- Optional: browser notification API (if permission granted)
- Budget status always visible in analytics header bar

### AI Coach — Daily Summary Template

**Data cards** (always shown, no LLM needed):
1. "Today's spend: $X (Y% of daily budget)"
2. "Most used model: Z (N sessions)"
3. "Cache hit rate: X% (trend arrow)"
4. "Top tool: Read (N calls)"
5. "Sessions: N, avg duration: Xm"

**AI-generated paragraph** (optional, uses Haiku):
```
Today was a productive day! You completed 5 sessions using mostly Sonnet 4.5,
spending $2.34 total. Your cache hit rate hit 78% — up from 65% yesterday.
Nice improvement! One tip: your "Refactor DB Layer" session cost $0.89 alone,
mostly because of 12 consecutive Read calls. Try using Grep to narrow down
files before reading them — this could cut that session's cost by ~30%.
```

**Gamification toasts**:
- "🎯 Badge Earned: Cache Master! (90%+ cache hit rate)"
- "🔥 3-day streak: Under $5/day!"
- "📊 New personal best: 85% cache hit rate"

---

## File Inventory (All New Files)

### Backend (`packages/server/src/`)
```
routes/analytics.ts              — Analytics API endpoints
services/costService.ts          — Price lookup + cost computation
services/providerNormalizer.ts   — Multi-vendor event normalization
services/importService.ts        — CSV/JSON import
services/velocityService.ts      — Token velocity metrics
services/promptAnalyzer.ts       — Prompt complexity scoring
services/insightsEngine.ts       — Daily insights generation
services/budgetService.ts        — Budget tracking + prediction
__tests__/costService.test.ts
__tests__/analyticsRoutes.test.ts
__tests__/providerNormalizer.test.ts
__tests__/importService.test.ts
__tests__/velocityService.test.ts
__tests__/promptAnalyzer.test.ts
__tests__/insightsEngine.test.ts
__tests__/budgetService.test.ts
```

### Frontend (`apps/dashboard/src/components/analytics/`)
```
useAnalyticsData.ts              — Data fetching hook
velocity/TokenVelocityView.tsx   — Token velocity dashboard
prompts/PromptAnalyzer.tsx       — Prompt analysis view
tools/ToolChainView.tsx          — Tool chain Sankey + analysis
whatif/WhatIfCalculator.tsx      — What-if model comparison
insights/InsightsView.tsx        — AI coach + badges + budget
export/ExportDialog.tsx          — Export format picker
export/htmlExporter.ts           — Standalone HTML generator
export/pdfExporter.ts            — PDF generator
__tests__/useAnalyticsData.test.ts
__tests__/TokenVelocityView.test.tsx
__tests__/PromptAnalyzer.test.tsx
__tests__/WhatIfCalculator.test.tsx
__tests__/InsightsView.test.tsx
```

### E2E Tests (`apps/dashboard/e2e/`)
```
analytics-overview.spec.ts       — Executive overview flows
analytics-explorer.spec.ts       — Deep dive with filters
analytics-replay.spec.ts         — Session replay navigation
analytics-comparison.spec.ts     — Side-by-side comparison
analytics-whatif.spec.ts         — What-if calculator
analytics-insights.spec.ts      — Insights + badges
analytics-export.spec.ts        — Export HTML/PDF
```

### Core (`packages/core/src/`)
```
types/analytics.ts               — Shared analytics types
types/pricing.ts                 — Price history types
```
