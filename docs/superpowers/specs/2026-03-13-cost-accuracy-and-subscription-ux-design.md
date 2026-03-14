# Cost Accuracy & Subscription-Aware UX Design

**Date:** 2026-03-13
**Status:** Reviewed (revised 2026-03-13)
**Scope:** Pricing consolidation, cost formula fixes, subscription UX, data integrity

---

## Problem Statement

People are starting to trust Synapse's cost data. An audit revealed critical accuracy issues:

1. **Frontend double-counts cached tokens** — charges full input rate AND cache rate, overstating costs by up to 80% for high-cache sessions
2. **Three independent pricing tables** drift independently across `costService.ts`, `transcript.ts`, and `promptUtils.ts`
3. **Cache creation tokens never costed** — Anthropic charges 1.25x input rate, currently ignored
4. **Thinking tokens never costed** — billed at output rate by Anthropic, currently ignored
5. **No subscription vs API distinction** — subscription users see raw API pricing with no context
6. **`inputTokens` semantic mismatch** — means different things in different data paths, causing silent miscalculation

## Decisions Made

| Decision                     | Choice                                   | Rationale                                           |
| ---------------------------- | ---------------------------------------- | --------------------------------------------------- |
| Pricing source of truth      | Single file in `@synapse-ai/core`        | Eliminates drift, one import everywhere             |
| Client-side cost computation | Yes — shared function from core          | Real-time graph header needs instant updates        |
| Cache creation pricing       | Explicit `cacheCreationPer1M` per model  | More transparent than multiplier, easy to override  |
| Thinking token costing       | Separate line item in cost breakdown     | Users can see and optimize extended thinking costs  |
| Subscription default view    | Consumption-first (tokens/models/cache)  | Dollars aren't meaningful for flat-fee users        |
| API default view             | Dollars-first                            | API users pay per token, dollars are primary metric |
| Toggle mechanism             | `$` button in header + keyboard shortcut | Lightweight, discoverable, persistent               |

---

## Design

### 1. Pricing Consolidation

#### New file: `packages/core/src/pricing.ts`

Single source of truth for all pricing data, lookup functions, and cost computation.

**PricePoint interface:**

```typescript
export interface PricePoint {
  model: string;
  vendor: string; // e.g. 'anthropic', 'openai', 'google', 'groq', 'openrouter', 'custom', 'unknown'
  // Kept as string (not union) for backward compat with DB-stored user overrides
  effectiveFrom: number; // Unix ms (0 = epoch, i.e. always valid)
  inputPer1M: number; // USD per 1M fresh input tokens
  cachedInputPer1M: number; // USD per 1M cache-read tokens
  cacheCreationPer1M: number; // USD per 1M cache-creation tokens
  outputPer1M: number; // USD per 1M output tokens (also used for thinking)
  // Ephemeral token pricing deferred — add fields when Anthropic publishes rates
}
```

**Default pricing table:**

| Model                      | Vendor      | Input $/1M | Cached $/1M | Creation $/1M | Output $/1M |
| -------------------------- | ----------- | ---------- | ----------- | ------------- | ----------- |
| claude-opus-4-6            | anthropic   | 15.00      | 1.50        | 18.75         | 75.00       |
| claude-opus-4-20250514     | anthropic   | 15.00      | 1.50        | 18.75         | 75.00       |
| claude-sonnet-4-5          | anthropic   | 3.00       | 0.30        | 3.75          | 15.00       |
| claude-sonnet-4-5-20250929 | anthropic   | 3.00       | 0.30        | 3.75          | 15.00       |
| claude-sonnet-4-20250514   | anthropic   | 3.00       | 0.30        | 3.75          | 15.00       |
| claude-haiku-4-5           | anthropic   | 0.80       | 0.08        | 1.00          | 4.00        |
| claude-haiku-4-5-20251001  | anthropic   | 0.80       | 0.08        | 1.00          | 4.00        |
| claude-haiku-3-5-20241022  | anthropic   | 0.80       | 0.08        | 1.00          | 4.00        |
| gpt-4o                     | openai      | 2.50       | 1.25        | 0             | 10.00       |
| gpt-4o-mini                | openai      | 0.15       | 0.075       | 0             | 0.60        |
| o1                         | openai      | 15.00      | 7.50        | 0             | 60.00       |
| o3-mini                    | openai      | 1.10       | 0.55        | 0             | 4.40        |
| gemini-2.5-pro             | google      | 1.25       | 0.3125      | 0             | 10.00       |
| gemini-2.5-flash           | google      | 0.15       | 0.0375      | 0             | 0.60        |
| **Fallback**               | **unknown** | **3.00**   | **0.30**    | **3.75**      | **15.00**   |

**Note on Creation = $0:** OpenAI caching is automatic with no creation surcharge. Google Gemini context caching has no creation fee (only storage time charges, which we don't track). Setting `cacheCreationPer1M: 0` is correct — add a code comment explaining why to prevent future "fixes."

**Lookup priority** (unchanged): user DB overrides → exact match → prefix match → vendor inference → fallback.

<!-- revised: P1 — prefix match can produce false positives (e.g. o1 matching o1-preview). Implementation uses longest-prefix-wins, but should also require a separator (`-` or end-of-string) after the prefix to prevent ambiguous matches. -->
**Prefix match safety:** Only match if the known model ID is followed by `-` or end-of-string in the input. This prevents `o1` from matching `o1-preview` if they have different pricing. Add explicit entries for dated variants rather than relying on prefix alone for short model IDs.

**Pricing version hash:** Export `PRICING_VERSION: string` — a hash of the default table. Frontend can detect stale pricing.

#### Files deleted after migration

- `packages/core/src/types/transcript.ts` → Remove `MODEL_PRICING` constant and `DEFAULT_PRICING` constant (types stay)
- `apps/dashboard/src/components/analytics/shared/promptUtils.ts` → Remove `MODEL_PRICING`, `resolveModelPricing()`, `computeCostUsd()` (other utils like `classifyPrompt` stay)
- `packages/server/src/services/costService.ts` → Remove `DEFAULT_PRICES[]`, `FALLBACK_PRICE` (imports from core). `getPrice()`, user override logic, and DB integration stay.

### 2. Cost Formula

#### CostBreakdown return type

```typescript
export interface CostBreakdown {
  input: number; // Fresh input cost
  cached: number; // Cache read cost
  creation: number; // Cache creation cost
  output: number; // Output cost
  thinking: number; // Thinking/extended reasoning cost
  total: number; // Sum of all above
}
```

#### computeCostUsd function

<!-- revised: P1 — removed `model: string` from params; PricePoint already carries the model. Implementation correctly omits it. -->

```typescript
export function computeCostUsd(params: {
  inputTokens: number; // MUST be fresh input only (excludes cache reads)
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  thinkingTokens: number;
  price: PricePoint;
}): CostBreakdown;
```

**Formula:**

```
input    = (inputTokens / 1M) × inputPer1M
cached   = (cacheReadTokens / 1M) × cachedInputPer1M
creation = (cacheCreationTokens / 1M) × cacheCreationPer1M
output   = (outputTokens / 1M) × outputPer1M
thinking = (thinkingTokens / 1M) × outputPer1M       ← same rate as output
total    = input + cached + creation + output + thinking
```

**Server integration:** `costService.ts` becomes a thin wrapper — it resolves the `PricePoint` via `getPrice()` (user overrides, prefix match, fallback logic) then calls `core.computeCostUsd()` with the resolved price. No duplicate formula.

**Key invariant:** `inputTokens` NEVER includes cache reads. This is enforced at parse time (see Section 4).

### 3. Subscription-Aware UX

#### 3.1 Cost Display Modes

```typescript
type CostDisplayMode = 'consumption' | 'cost';
```

**Default selection logic:**

- Plan `api` → `'cost'`
- Any other plan → `'consumption'`
- User override persisted in localStorage key `synapse:costDisplayMode`
- Plan detection uses existing `planDetector.ts` (checks DB override → Claude config file → ANTHROPIC_API_KEY env var → defaults to "pro")

#### 3.2 Plan Badge

Small chip in GraphStats header bar, right-aligned:

| Plan    | Badge Text         | Dot Color                               |
| ------- | ------------------ | --------------------------------------- |
| Free    | `Free`             | grey                                    |
| Pro     | `Pro $20/mo`       | green (auto-detected) or amber (manual) |
| Max 5x  | `Max 5× $100/mo`   | green or amber                          |
| Max 20x | `Max 20× $200/mo`  | green or amber                          |
| Team    | `Team $30/user/mo` | green or amber                          |
| API     | `API`              | blue                                    |
<!-- revised: P1 — no plan selector UI exists; clicking Plan? has no target. Added note. -->
| Unknown | `Plan?`            | grey (clickable → plan selector)        |

**Note:** The "plan selector" is not yet implemented as a frontend UI. Until it is, clicking `Plan?` should show a tooltip: "Plan not detected — set manually via server settings" or link to the `/api/plan` endpoint documentation. Backend `setPlan()` exists but has no frontend counterpart.

#### 3.3 Toggle Control

- **Location:** GraphStats header bar, next to existing view setting buttons
- **Icon:** `$` symbol (or DollarSign from lucide-react)
<!-- revised: P1 — keyboard shortcut must use event.key (not event.code) for locale safety -->
- **Keyboard shortcut:** `$` (Shift+4 on US layout; may vary on international keyboards — fallback to button only). **Implementation must use `event.key === '$'`**, not `event.code`, to handle international layouts correctly.
- **Behavior:** Toggles `costDisplayMode` between `'consumption'` and `'cost'`
- **Visual state:** Highlight ring when active (consistent with existing toggle buttons)
- **Tooltip:** "Show API-equivalent costs" / "Show consumption"

#### 3.4 What Changes Per Mode

**GraphStats header:**

- Consumption: `45.2k tokens · 12 sessions`
- Cost: `≈$1.83 · 12 sessions` (subscription) or `$1.83 · 12 sessions` (API)

**KPI cards (analytics page):**

- Consumption: Tokens, Sessions, Cache %, Tool Calls
- Cost: API Cost (or ≈API Cost), Avg/Session, Cache Savings $, Tokens

**Session list:**

- Consumption: token counts per session
- Cost: dollar amounts per session

**Cost waterfall lens:**

- Always shows token bars (unchanged)
- Cost mode adds dollar annotations on bars

**Model breakdown:**

- Consumption: token % per model
- Cost: dollar % per model

#### 3.5 Labeling Rules

- **API users:** Plain `$X.XX` — these are real charges
- **Subscription users in cost mode:** `≈$X.XX` prefix on all dollar amounts
- **Tooltip on ≈:** "API-equivalent cost — what this would cost on pay-as-you-go pricing"

### 4. Data Integrity

#### 4.1 inputTokens Semantic Normalization

**Rule:** `inputTokens` always means fresh input (excludes cache reads) at every layer.

**Three normalization points** (all upstream, so downstream consumers trust the value):

**Point A — Transcript v2 path:** `packages/server/src/services/transcriptReader.ts`

When parsing v2 `ConversationRecord` objects, the Claude API's `usage.input_tokens` includes cache reads. Normalize at parse time:

```typescript
const freshInput = Math.max(0, raw.usage.inputTokens - raw.usage.cacheReadTokens);
```

**Point B — Transcript v1 path:** Same file, `parseTurn()` function.

The v1 `message.usage.input_tokens` also includes cache reads. Apply the same normalization when building `TranscriptTurn` objects.

**Point C — Event handler path:** `apps/dashboard/src/store/eventHandlers.ts`

Line ~582 currently sets `input = (usage.input_tokens ?? 0) + cacheRead + cacheCreation`, which means `input` includes cache reads. Fix to:

```typescript
const input = Math.max(0, (usage.input_tokens ?? 0) - cacheRead);
```

After normalization, `TranscriptTurn.totalInputTokens` (= `inputTokens + cacheReadTokens`) retains its meaning as "total input context size" and remains correct.

**Audit `ReasoningTurn.usage`:** The `ReasoningTurn` type at `transcript.ts` only has `inputTokens`, `outputTokens`, `cacheReadTokens`. Add `cacheCreationTokens` and `thinkingTokens` to this interface if reasoning data is used for cost calculation.

#### 4.2 Token Validation at Storage Boundary

Before writing to `analytics_daily`, validate:

```typescript
function validateTokenCounts(tokens: TokenCounts): TokenCounts {
  return {
    inputTokens: Math.max(0, tokens.inputTokens),
    outputTokens: Math.max(0, tokens.outputTokens),
    cacheReadTokens: Math.max(0, tokens.cacheReadTokens),
    cacheCreationTokens: Math.max(0, tokens.cacheCreationTokens),
    thinkingTokens: Math.max(0, tokens.thinkingTokens),
  };
}
```

Log a warning if:

- `cacheCreationTokens > inputTokens` (unusual, may indicate misparse)
- `cacheReadTokens` is negative
- Any token count exceeds 10M per turn (likely a bug)

#### 4.3 Database Schema Updates

Add columns to `analytics_daily`:

```sql
ALTER TABLE analytics_daily ADD COLUMN total_thinking_tokens INTEGER DEFAULT 0;
```

`total_cache_creation_tokens` column already exists in schema but must be added to the INSERT statement (see 4.5).

#### 4.4 Pricing Version Hash

Since `@synapse-ai/core` runs in the browser (no Node `crypto`), compute the hash as a simple string literal updated when the pricing table changes:

```typescript
// packages/core/src/pricing.ts
// Bump this when DEFAULT_PRICES changes. Format: YYYY-MM-DD or semver.
export const PRICING_VERSION = '2026-03-13';
```

<!-- revised: P1 — pricing version toast logic described but never implemented. Moved to deferred. -->
~~Frontend stores `lastSeenPricingVersion` in localStorage. On mismatch, shows a subtle "Pricing updated" toast.~~ **Deferred** — not implemented. Add when pricing updates become frequent enough to warrant user notification.

#### 4.5 Existing Bug: `total_cache_read_tokens` and `total_cache_creation_tokens` Never Populated

<!-- revised: P0 — total_cache_read_tokens was also missing from INSERT, not just cache_creation. ON CONFLICT UPDATE clause also lacked both columns. -->

The `analytics_daily` table has `total_cache_read_tokens` and `total_cache_creation_tokens` columns in the CREATE TABLE schema, but **neither** is included in the `INSERT INTO analytics_daily` statement or the `ON CONFLICT UPDATE` clause in `db.ts`. Both columns have always been 0 in all historical data. Fix the INSERT and ON CONFLICT to populate all three token columns (`total_cache_read_tokens`, `total_cache_creation_tokens`, `total_thinking_tokens`).

**Side effect:** `budgetService.computeForecast()` uses a 14-day weighted moving average of `total_cost_usd`. After deploying the corrected cost formula, the first 14 days will blend old-formula and new-formula cost data, potentially causing temporary budget alert anomalies.

<!-- revised: P1 — budget forecast transition needs visibility. Add a log warning when data spans the pricing version change. -->
**Mitigation:** Log a warning in `computeForecast()` during the transition window (first 14 days after deployment). The warning should note that forecast accuracy is reduced due to mixed pricing formula data. No user-facing action needed — the anomaly is self-correcting.

### 5. Test Coverage

| Test                                  | File                                            | Validates                             |
| ------------------------------------- | ----------------------------------------------- | ------------------------------------- |
| Full formula with all 6 token types   | `core/src/__tests__/pricing.test.ts`            | `CostBreakdown` arithmetic            |
| Cache creation 1.25x for Anthropic    | `core/src/__tests__/pricing.test.ts`            | Vendor-specific creation rate         |
| Cache creation $0 for OpenAI/Google   | `core/src/__tests__/pricing.test.ts`            | No creation charge for auto-cache     |
| Thinking at output rate               | `core/src/__tests__/pricing.test.ts`            | Separate line item, correct rate      |
| inputTokens excludes cache reads      | `server/src/__tests__/transcriptReader.test.ts` | Semantic invariant                    |
| Frontend and server identical results | `core/src/__tests__/pricing.test.ts`            | No drift (single import)              |
| Fallback includes cache creation      | `core/src/__tests__/pricing.test.ts`            | No NaN on unknown models              |
| CostBreakdown.total = sum of parts    | `core/src/__tests__/pricing.test.ts`            | Arithmetic consistency                |
| User override takes precedence        | `server/src/__tests__/costService.test.ts`      | DB override priority                  |
| Plan detection defaults               | `server/src/__tests__/planDetector.test.ts`     | Correct default per plan type         |
| Cost display mode toggle              | `dashboard/src/__tests__/costToggle.test.ts`    | Mode switch, persistence, label rules |
| API user sees plain $                 | `dashboard/src/__tests__/costToggle.test.ts`    | No ≈ prefix for API plan              |
| Subscription user sees ≈$             | `dashboard/src/__tests__/costToggle.test.ts`    | ≈ prefix for non-API plans            |

### 6. Migration & Backward Compatibility

- **No breaking API changes** — existing endpoints return the same shape, with optional new fields
- **`CostBreakdown` is additive** — old code that reads `total` still works
- **Database columns added with DEFAULT 0** — no data migration needed
- **Old transcript data** — cache creation and thinking tokens will be 0 for historical data (acceptable; they were already 0 in cost calculations)
- **User price overrides** — existing overrides continue working; `cacheCreationPer1M` defaults to 0 if not set in override (conservative)

### 7. Files Changed

**New:**

- `packages/core/src/pricing.ts` — single source of truth
- `packages/core/src/__tests__/pricing.test.ts` — comprehensive pricing tests
- `apps/dashboard/src/__tests__/costToggle.test.ts` — display mode tests

**Modified (significant):**

- `packages/core/src/types/transcript.ts` — remove `MODEL_PRICING`, `DEFAULT_PRICING`
- `packages/core/src/types/agent.ts` — add `thinkingTokens` to `tokenUsage`
- `packages/server/src/services/costService.ts` — import pricing from core, add `cacheCreationPer1M`
- `packages/server/src/services/transcriptReader.ts` — normalize `inputTokens` at parse time
- `packages/server/src/services/eventStore.ts` — validate tokens before storage, add thinking column
- `packages/server/src/db.ts` — add new columns to `analytics_daily`
- `packages/server/src/routes/analytics.ts` — include new token types in responses
- `apps/dashboard/src/components/analytics/shared/promptUtils.ts` — remove pricing code, import from core
- `apps/dashboard/src/components/layout/GraphStats.tsx` — cost display mode toggle, plan badge
- `apps/dashboard/src/store/eventHandlers.ts` — fix inputTokens normalization (Point C), pass thinking tokens through
- `apps/dashboard/src/components/analytics/insights/InsightsView.tsx` — remove inline `MODEL_PRICING`, import from core
- `apps/dashboard/src/components/analytics/mockData.ts` — remove inline `computeCost`/`MODEL_INFO`, import from core
- `packages/core/src/types/transcript.ts` — add `cacheCreationTokens`/`thinkingTokens` to `ReasoningTurn.usage`
- `apps/dashboard/src/components/lens/cost/CostWaterfallView.tsx` — dollar annotations in cost mode
- `apps/dashboard/src/components/analytics/useAnalyticsData.ts` — pass display mode context

**Modified (minor):**

- `packages/core/src/index.ts` — re-export from `pricing.ts`
- `apps/dashboard/src/store/viewSettingsStore.ts` — add `costDisplayMode`
- `apps/dashboard/src/components/layout/ViewSettingsDropdown.tsx` — add toggle
- `apps/dashboard/src/components/layout/KeyboardShortcutsTooltip.tsx` — add `$` shortcut

---

## Out of Scope

- Ephemeral token pricing and fields (defer entirely until Anthropic publishes rates — avoid dead code)
- Server tool use pricing (web_search, web_fetch — tracked but not costed)
- Anthropic usage quota tracking (rate limit proximity for subscription users)
- Historical data re-computation (old sessions keep old costs; new formula applies going forward)

---

## Open Questions / Deferred (P2)

- **`effectiveFrom` field is unused** — all entries use `effectiveFrom: 0`. The field exists for future time-versioned pricing but has no mechanism to populate or query by date. Acceptable as future-proofing; document intent in code comments.
- **No test for prefix match ambiguity** — tests cover basic prefix matching but don't test edge cases like `o1` vs `o1-preview`. Add a test case when short model IDs are added.
- **"API-equivalent cost" label clarity** — the `≈` prefix and tooltip text ("API-equivalent cost — what this would cost on pay-as-you-go pricing") may not resonate with non-technical users. Consider A/B testing "Estimated API cost" as an alternative.
- **No success metrics** — no validation comparing old vs new cost calculations on real session data. Consider running a known session through both formulas and documenting the delta to confirm accuracy improvement.
- **Pricing version toast** — deferred from Section 4.4. Implement `lastSeenPricingVersion` localStorage check when pricing updates become frequent.
- **Plan selector frontend UI** — `detectPlan()` has `Unknown` → `Plan?` badge, but no UI to set the plan from the dashboard. Backend `setPlan()` exists but is API-only.
