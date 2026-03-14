# Cost Accuracy & Subscription-Aware UX Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix cost calculation accuracy (double-counting, missing token types) and add subscription-aware display modes.

**Architecture:** Consolidate three independent pricing tables into a single `@synapse-ai/core/pricing` module. Fix `inputTokens` semantics at three normalization points. Add consumption/cost display toggle driven by detected plan type.

**Tech Stack:** TypeScript, Vitest, React, Zustand, @synapse-ai/core, packages/server

**Spec:** `docs/superpowers/specs/2026-03-13-cost-accuracy-and-subscription-ux-design.md`

---

## Chunk 1: Core Pricing Module

### Task 1: Create `pricing.ts` — PricePoint, DEFAULT_PRICES, PRICING_VERSION

**Files:**

- Create: `packages/core/src/pricing.ts`
- Test: `packages/core/src/__tests__/pricing.test.ts`

- [x] **Step 1: Write failing tests for PricePoint interface and DEFAULT_PRICES**

```typescript
// packages/core/src/__tests__/pricing.test.ts
import { describe, it, expect } from 'vitest';
import { DEFAULT_PRICES, FALLBACK_PRICE, PRICING_VERSION } from '../pricing.js';

describe('DEFAULT_PRICES', () => {
  it('contains all expected models', () => {
    const models = DEFAULT_PRICES.map((p) => p.model);
    expect(models).toContain('claude-opus-4-6');
    expect(models).toContain('claude-sonnet-4-5');
    expect(models).toContain('gpt-4o');
    expect(models).toContain('gemini-2.5-pro');
  });

  it('every price point has cacheCreationPer1M', () => {
    for (const p of DEFAULT_PRICES) {
      expect(typeof p.cacheCreationPer1M).toBe('number');
    }
  });

  it('Anthropic cache creation is 1.25x input', () => {
    const opus = DEFAULT_PRICES.find((p) => p.model === 'claude-opus-4-6')!;
    expect(opus.cacheCreationPer1M).toBe(opus.inputPer1M * 1.25);
  });

  it('OpenAI cache creation is 0 (automatic caching, no surcharge)', () => {
    const gpt4o = DEFAULT_PRICES.find((p) => p.model === 'gpt-4o')!;
    expect(gpt4o.cacheCreationPer1M).toBe(0);
  });

  it('Google cache creation is 0 (no creation fee)', () => {
    const gemini = DEFAULT_PRICES.find((p) => p.model === 'gemini-2.5-pro')!;
    expect(gemini.cacheCreationPer1M).toBe(0);
  });

  it('FALLBACK_PRICE has all required fields', () => {
    expect(FALLBACK_PRICE.inputPer1M).toBe(3);
    expect(FALLBACK_PRICE.cachedInputPer1M).toBe(0.3);
    expect(FALLBACK_PRICE.cacheCreationPer1M).toBe(3.75);
    expect(FALLBACK_PRICE.outputPer1M).toBe(15);
  });

  it('PRICING_VERSION is a non-empty string', () => {
    expect(typeof PRICING_VERSION).toBe('string');
    expect(PRICING_VERSION.length).toBeGreaterThan(0);
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `cd packages/core && npx vitest run src/__tests__/pricing.test.ts`
Expected: FAIL — module `../pricing.js` not found

- [x] **Step 3: Implement `pricing.ts` with PricePoint, DEFAULT_PRICES, FALLBACK_PRICE, PRICING_VERSION**

```typescript
// packages/core/src/pricing.ts
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bernhard

// ─── Single Source of Truth for Model Pricing ────────────────────────
// All pricing data, lookup, and cost computation live here.
// Both server and frontend import from this module.

export interface PricePoint {
  model: string;
  vendor: string; // e.g. 'anthropic', 'openai', 'google', 'groq', 'openrouter', 'custom', 'unknown'
  effectiveFrom: number; // Unix ms (0 = epoch, always valid)
  inputPer1M: number; // USD per 1M fresh input tokens
  cachedInputPer1M: number; // USD per 1M cache-read tokens
  cacheCreationPer1M: number; // USD per 1M cache-creation tokens
  outputPer1M: number; // USD per 1M output tokens (also used for thinking)
}

export interface CostBreakdown {
  input: number;
  cached: number;
  creation: number;
  output: number;
  thinking: number;
  total: number;
}

// Bump this when DEFAULT_PRICES changes. Format: YYYY-MM-DD.
export const PRICING_VERSION = '2026-03-13';

export const DEFAULT_PRICES: PricePoint[] = [
  // ── Anthropic ──
  // Cache creation at 1.25x input rate per Anthropic pricing
  {
    model: 'claude-opus-4-6',
    vendor: 'anthropic',
    effectiveFrom: 0,
    inputPer1M: 15,
    cachedInputPer1M: 1.5,
    cacheCreationPer1M: 18.75,
    outputPer1M: 75,
  },
  {
    model: 'claude-opus-4-20250514',
    vendor: 'anthropic',
    effectiveFrom: 0,
    inputPer1M: 15,
    cachedInputPer1M: 1.5,
    cacheCreationPer1M: 18.75,
    outputPer1M: 75,
  },
  {
    model: 'claude-sonnet-4-5',
    vendor: 'anthropic',
    effectiveFrom: 0,
    inputPer1M: 3,
    cachedInputPer1M: 0.3,
    cacheCreationPer1M: 3.75,
    outputPer1M: 15,
  },
  {
    model: 'claude-sonnet-4-5-20250929',
    vendor: 'anthropic',
    effectiveFrom: 0,
    inputPer1M: 3,
    cachedInputPer1M: 0.3,
    cacheCreationPer1M: 3.75,
    outputPer1M: 15,
  },
  {
    model: 'claude-sonnet-4-20250514',
    vendor: 'anthropic',
    effectiveFrom: 0,
    inputPer1M: 3,
    cachedInputPer1M: 0.3,
    cacheCreationPer1M: 3.75,
    outputPer1M: 15,
  },
  {
    model: 'claude-haiku-4-5',
    vendor: 'anthropic',
    effectiveFrom: 0,
    inputPer1M: 0.8,
    cachedInputPer1M: 0.08,
    cacheCreationPer1M: 1.0,
    outputPer1M: 4,
  },
  {
    model: 'claude-haiku-4-5-20251001',
    vendor: 'anthropic',
    effectiveFrom: 0,
    inputPer1M: 0.8,
    cachedInputPer1M: 0.08,
    cacheCreationPer1M: 1.0,
    outputPer1M: 4,
  },
  {
    model: 'claude-haiku-3-5-20241022',
    vendor: 'anthropic',
    effectiveFrom: 0,
    inputPer1M: 0.8,
    cachedInputPer1M: 0.08,
    cacheCreationPer1M: 1.0,
    outputPer1M: 4,
  },

  // ── OpenAI ──
  // Cache creation = 0: OpenAI caching is automatic with no creation surcharge
  {
    model: 'gpt-4o',
    vendor: 'openai',
    effectiveFrom: 0,
    inputPer1M: 2.5,
    cachedInputPer1M: 1.25,
    cacheCreationPer1M: 0,
    outputPer1M: 10,
  },
  {
    model: 'gpt-4o-mini',
    vendor: 'openai',
    effectiveFrom: 0,
    inputPer1M: 0.15,
    cachedInputPer1M: 0.075,
    cacheCreationPer1M: 0,
    outputPer1M: 0.6,
  },
  {
    model: 'o1',
    vendor: 'openai',
    effectiveFrom: 0,
    inputPer1M: 15,
    cachedInputPer1M: 7.5,
    cacheCreationPer1M: 0,
    outputPer1M: 60,
  },
  {
    model: 'o3-mini',
    vendor: 'openai',
    effectiveFrom: 0,
    inputPer1M: 1.1,
    cachedInputPer1M: 0.55,
    cacheCreationPer1M: 0,
    outputPer1M: 4.4,
  },

  // ── Google ──
  // Cache creation = 0: Gemini context caching has no creation fee (only storage time, not tracked)
  {
    model: 'gemini-2.5-pro',
    vendor: 'google',
    effectiveFrom: 0,
    inputPer1M: 1.25,
    cachedInputPer1M: 0.3125,
    cacheCreationPer1M: 0,
    outputPer1M: 10,
  },
  {
    model: 'gemini-2.5-flash',
    vendor: 'google',
    effectiveFrom: 0,
    inputPer1M: 0.15,
    cachedInputPer1M: 0.0375,
    cacheCreationPer1M: 0,
    outputPer1M: 0.6,
  },
];

export const FALLBACK_PRICE: PricePoint = {
  model: '__default__',
  vendor: 'unknown',
  effectiveFrom: 0,
  inputPer1M: 3,
  cachedInputPer1M: 0.3,
  cacheCreationPer1M: 3.75,
  outputPer1M: 15,
};
```

- [x] **Step 4: Run test to verify it passes**

Run: `cd packages/core && npx vitest run src/__tests__/pricing.test.ts`
Expected: PASS

- [x] **Step 5: Commit**

```bash
git add packages/core/src/pricing.ts packages/core/src/__tests__/pricing.test.ts
git commit -m "feat(core): add pricing module with PricePoint, DEFAULT_PRICES, PRICING_VERSION"
```

---

### Task 2: Add `computeCostUsd` and `getPrice` to pricing.ts

**Files:**

- Modify: `packages/core/src/pricing.ts`
- Test: `packages/core/src/__tests__/pricing.test.ts`

- [x] **Step 1: Write failing tests for computeCostUsd**

Add to `packages/core/src/__tests__/pricing.test.ts`:

**Important:** Do NOT create a new `inferVendor` in `pricing.ts`. An `inferVendor` already exists in `packages/core/src/utils/format.ts:182`. The pricing module should import and use it internally. The only semantic difference (format.ts returns `'claude'` for no model, `'custom'` for unknown) is acceptable — for pricing fallback, both go to `FALLBACK_PRICE`.

```typescript
import { computeCostUsd, getPrice } from '../pricing.js';

describe('getPrice', () => {
  it('returns exact match', () => {
    const p = getPrice('claude-opus-4-6');
    expect(p.inputPer1M).toBe(15);
  });
  it('returns prefix match for dated model ID', () => {
    const p = getPrice('claude-sonnet-4-5-20260101');
    expect(p.inputPer1M).toBe(3);
  });
  it('returns fallback for unknown model', () => {
    const p = getPrice('llama-3-70b');
    expect(p.inputPer1M).toBe(3);
    expect(p.vendor).toBe('unknown');
  });
});

describe('computeCostUsd', () => {
  it('computes full breakdown with all token types', () => {
    const price = getPrice('claude-opus-4-6');
    const result = computeCostUsd({
      inputTokens: 10_000, // fresh input
      outputTokens: 5_000,
      cacheReadTokens: 20_000,
      cacheCreationTokens: 8_000,
      thinkingTokens: 3_000,
      price,
    });

    expect(result.input).toBeCloseTo((10_000 / 1_000_000) * 15, 6);
    expect(result.cached).toBeCloseTo((20_000 / 1_000_000) * 1.5, 6);
    expect(result.creation).toBeCloseTo((8_000 / 1_000_000) * 18.75, 6);
    expect(result.output).toBeCloseTo((5_000 / 1_000_000) * 75, 6);
    expect(result.thinking).toBeCloseTo((3_000 / 1_000_000) * 75, 6);
    expect(result.total).toBeCloseTo(
      result.input + result.cached + result.creation + result.output + result.thinking,
      6,
    );
  });

  it('thinking is charged at output rate', () => {
    const price = getPrice('claude-opus-4-6');
    const result = computeCostUsd({
      inputTokens: 0,
      outputTokens: 1_000_000,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      thinkingTokens: 1_000_000,
      price,
    });
    expect(result.thinking).toBe(result.output);
  });

  it('cache creation is 0 for OpenAI', () => {
    const price = getPrice('gpt-4o');
    const result = computeCostUsd({
      inputTokens: 1000,
      outputTokens: 1000,
      cacheReadTokens: 0,
      cacheCreationTokens: 50_000,
      thinkingTokens: 0,
      price,
    });
    expect(result.creation).toBe(0);
  });

  it('returns zero breakdown for zero tokens', () => {
    const price = getPrice('claude-opus-4-6');
    const result = computeCostUsd({
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      thinkingTokens: 0,
      price,
    });
    expect(result.total).toBe(0);
  });

  it('CostBreakdown.total equals sum of all parts', () => {
    const price = getPrice('claude-sonnet-4-5');
    const result = computeCostUsd({
      inputTokens: 50_000,
      outputTokens: 20_000,
      cacheReadTokens: 100_000,
      cacheCreationTokens: 10_000,
      thinkingTokens: 5_000,
      price,
    });
    const sum = result.input + result.cached + result.creation + result.output + result.thinking;
    expect(result.total).toBeCloseTo(sum, 10);
  });

  it('fallback pricing works for unknown model', () => {
    const price = getPrice('some-unknown-model');
    const result = computeCostUsd({
      inputTokens: 1_000_000,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      thinkingTokens: 0,
      price,
    });
    expect(result.input).toBe(3); // $3 per 1M input (fallback)
    expect(result.total).toBe(3);
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `cd packages/core && npx vitest run src/__tests__/pricing.test.ts`
Expected: FAIL — `computeCostUsd`, `getPrice`, `inferVendor` not exported

- [x] **Step 3: Implement computeCostUsd and getPrice in pricing.ts**

Add to bottom of `packages/core/src/pricing.ts`:

```typescript
import { inferVendor } from './utils/format.js';

// ─── Price Lookup ────────────────────────────────────────────────────

export function getPrice(
  model: string,
  userPrices: PricePoint[] = [],
  timestamp?: number,
): PricePoint {
  const ts = timestamp ?? Date.now();
  const normalized = model.toLowerCase();

  // User overrides first (most recent effective price before timestamp)
  const userMatch = findBestMatch(userPrices, normalized, ts);
  if (userMatch) return userMatch;

  // Default prices
  const defaultMatch = findBestMatch(DEFAULT_PRICES, normalized, ts);
  if (defaultMatch) return defaultMatch;

  // Prefix match (handles dated model IDs like claude-sonnet-4-5-20250929)
  const prefixMatch = findPrefixMatch(DEFAULT_PRICES, normalized);
  if (prefixMatch) return prefixMatch;

  return { ...FALLBACK_PRICE, model, vendor: inferVendor(model) };
}

function findBestMatch(
  prices: PricePoint[],
  normalizedModel: string,
  ts: number,
): PricePoint | undefined {
  return prices.find((p) => p.model.toLowerCase() === normalizedModel && p.effectiveFrom <= ts);
}

function findPrefixMatch(prices: PricePoint[], normalizedModel: string): PricePoint | undefined {
  for (const p of prices) {
    const pNorm = p.model.toLowerCase();
    if (normalizedModel.startsWith(pNorm)) {
      // One-directional: input model starts with known model
      return p;
    }
  }
  return undefined;
}

// ─── Cost Computation ────────────────────────────────────────────────

export function computeCostUsd(params: {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  thinkingTokens: number;
  price: PricePoint;
}): CostBreakdown {
  const { price, inputTokens, outputTokens, cacheReadTokens, cacheCreationTokens, thinkingTokens } =
    params;

  const input = (inputTokens / 1_000_000) * price.inputPer1M;
  const cached = (cacheReadTokens / 1_000_000) * price.cachedInputPer1M;
  const creation = (cacheCreationTokens / 1_000_000) * price.cacheCreationPer1M;
  const output = (outputTokens / 1_000_000) * price.outputPer1M;
  const thinking = (thinkingTokens / 1_000_000) * price.outputPer1M;

  return {
    input,
    cached,
    creation,
    output,
    thinking,
    total: input + cached + creation + output + thinking,
  };
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `cd packages/core && npx vitest run src/__tests__/pricing.test.ts`
Expected: ALL PASS

- [x] **Step 5: Re-export from core index.ts**

Modify `packages/core/src/index.ts` — add near the existing exports (around line 74 where `MODEL_PRICING` is exported):

```typescript
export {
  type PricePoint,
  type CostBreakdown,
  DEFAULT_PRICES,
  FALLBACK_PRICE,
  PRICING_VERSION,
  computeCostUsd,
  getPrice,
} from './pricing.js';
// Note: inferVendor is already exported from './utils/format.js' — do NOT re-export from pricing
```

- [x] **Step 6: Run all core tests**

Run: `cd packages/core && npx vitest run`
Expected: ALL PASS

- [x] **Step 7: Commit**

```bash
git add packages/core/src/pricing.ts packages/core/src/__tests__/pricing.test.ts packages/core/src/index.ts
git commit -m "feat(core): add computeCostUsd, getPrice, inferVendor to pricing module"
```

---

## Chunk 2: Data Integrity Fixes

### Task 3: Add `thinkingTokens` to AgentNodeData and `ReasoningTurn.usage`

**Files:**

- Modify: `packages/core/src/types/agent.ts:86-92` — tokenUsage field
- Modify: `packages/core/src/types/transcript.ts:319-323` — ReasoningTurn.usage

- [x] **Step 1: Add `thinking` to tokenUsage in AgentNodeData**

In `packages/core/src/types/agent.ts`, find the `tokenUsage` field in `AgentNodeData` (around line 86-92). Ensure it has:

```typescript
tokenUsage: {
  input: number;
  output: number;
  cacheRead?: number;
  cacheCreation?: number;
  thinking?: number;  // Extended thinking tokens (charged at output rate)
};
```

- [x] **Step 2: Add `cacheCreationTokens` and `thinkingTokens` to ReasoningTurn.usage**

In `packages/core/src/types/transcript.ts`, find `ReasoningTurn.usage` (line 319-323). Change from:

```typescript
usage: {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
}
```

To:

```typescript
usage: {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  thinkingTokens: number;
}
```

- [x] **Step 3: Run all core tests to check no regressions**

Run: `cd packages/core && npx vitest run`
Expected: PASS

- [x] **Step 4: Commit**

```bash
git add packages/core/src/types/agent.ts packages/core/src/types/transcript.ts
git commit -m "feat(core): add thinkingTokens to AgentNodeData and ReasoningTurn.usage"
```

---

### Task 4: Remove duplicate pricing from transcript.ts and core index.ts

**Files:**

- Modify: `packages/core/src/types/transcript.ts:50-61` — remove `MODEL_PRICING`, `DEFAULT_PRICING`
- Modify: `packages/core/src/index.ts:74` — remove old re-export, keep new pricing export

- [x] **Step 1: Remove `MODEL_PRICING` and `DEFAULT_PRICING` from transcript.ts**

In `packages/core/src/types/transcript.ts`, delete lines 48-61 (the `MODEL_PRICING` constant and `DEFAULT_PRICING` constant). Keep all the interfaces.

- [x] **Step 2: Update core index.ts to remove old export**

In `packages/core/src/index.ts`, find line 74: `export { MODEL_PRICING, DEFAULT_PRICING } from './types/transcript.js'` and remove it. The new exports from `./pricing.js` (added in Task 2 Step 5) replace these.

- [x] **Step 3: Find all imports of MODEL_PRICING/DEFAULT_PRICING from core and update them**

Run: `grep -r "MODEL_PRICING\|DEFAULT_PRICING" --include="*.ts" --include="*.tsx" packages/ apps/`

Update each import to use the new names from `@synapse-ai/core`:

- `MODEL_PRICING` → `DEFAULT_PRICES` (array of PricePoint)
- `DEFAULT_PRICING` → `FALLBACK_PRICE`

Key files to update:

- `packages/server/src/services/transcriptReader.ts:21` — imports `MODEL_PRICING, DEFAULT_PRICING`

- [x] **Step 4: Build core package to verify no type errors**

Run: `cd packages/core && npx tsc --noEmit`
Expected: No errors

- [x] **Step 5: Commit**

```bash
git add packages/core/src/types/transcript.ts packages/core/src/index.ts packages/server/src/services/transcriptReader.ts
git commit -m "refactor(core): remove MODEL_PRICING/DEFAULT_PRICING from transcript.ts"
```

---

### Task 5: Fix inputTokens normalization — Point A & B (transcriptReader.ts)

**Files:**

- Modify: `packages/server/src/services/transcriptReader.ts:219-276` (parseTurn, v1 path)
- Modify: `packages/server/src/services/transcriptReader.ts:367+` (parseExtendedUsage, v2 path)
- Test: `packages/server/src/__tests__/transcriptReader.test.ts`

- [x] **Step 1: Write failing test for inputTokens normalization**

Add to `packages/server/src/__tests__/transcriptReader.test.ts` (or create if needed):

```typescript
describe('inputTokens normalization', () => {
  it('parseTurn subtracts cacheReadTokens from inputTokens (v1)', () => {
    // Create a mock v1 raw record where usage.input_tokens includes cache reads
    // After parsing, turn.inputTokens should be fresh input only
    // turn.totalInputTokens should be inputTokens + cacheReadTokens
  });

  it('v2 ConversationRecord normalizes inputTokens', () => {
    // Create a mock v2 record where usage.inputTokens includes cache reads
    // After parsing, the resulting turn should have fresh input only
  });
});
```

Note: The exact test shape depends on how `parseTurn` is called — check if it's exported or if testing goes through `parseTranscript`. Adapt the test to use the available public API.

- [x] **Step 2: Run test to verify it fails**

Run: `cd packages/server && npx vitest run src/__tests__/transcriptReader.test.ts`
Expected: FAIL — inputTokens still includes cache reads

- [x] **Step 3: Fix parseTurn (v1 path) — normalize inputTokens**

In `packages/server/src/services/transcriptReader.ts`, in the `parseTurn()` function (around line 219-276), after reading `usage.input_tokens` and `cache_read_input_tokens`, ensure:

```typescript
const rawInput = usage?.input_tokens ?? 0;
const cacheRead = usage?.cache_read_input_tokens ?? 0;
const inputTokens = Math.max(0, rawInput - cacheRead); // Fresh input only
```

And keep `totalInputTokens = inputTokens + cacheRead` (which now correctly = rawInput).

- [x] **Step 4: Fix parseExtendedUsage (v2 path) — normalize inputTokens**

In the v2 parsing path (around line 367+), when building `ExtendedUsage` or `TranscriptTurn` from `ConversationRecord`:

```typescript
const rawInput = record.usage.inputTokens ?? 0;
const cacheRead = record.usage.cacheReadTokens ?? 0;
const freshInput = Math.max(0, rawInput - cacheRead);
```

- [x] **Step 5: Run test to verify it passes**

Run: `cd packages/server && npx vitest run src/__tests__/transcriptReader.test.ts`
Expected: PASS

- [x] **Step 6: Run all server tests**

Run: `cd packages/server && npx vitest run`
Expected: ALL PASS

- [x] **Step 7: Commit**

```bash
git add packages/server/src/services/transcriptReader.ts packages/server/src/__tests__/transcriptReader.test.ts
git commit -m "fix(server): normalize inputTokens to fresh-only at parse time"
```

---

### Task 6: Fix inputTokens normalization — Point C (eventHandlers.ts)

**Files:**

- Modify: `apps/dashboard/src/store/eventHandlers.ts:575-591`

- [x] **Step 1: Find and fix the token computation in eventHandlers.ts**

Around line 575-591, find where `input` is computed from `usage.input_tokens`. Currently:

```typescript
input: (usage.input_tokens ?? 0) + cacheRead + cacheCreation,
```

Change to:

```typescript
input: Math.max(0, (usage.input_tokens ?? 0) - cacheRead),
```

This ensures the frontend event handler produces fresh-input-only values, matching the server normalization.

- [x] **Step 2: Also pass thinking tokens through**

In the same block, ensure thinking tokens are extracted and passed to the agent's tokenUsage:

```typescript
thinking: usage.thinking_tokens ?? 0,
```

- [x] **Step 3: Run dashboard tests**

Run: `cd apps/dashboard && npx vitest run`
Expected: PASS (may need to update snapshot/assertions if any test relied on old input values)

- [x] **Step 4: Commit**

```bash
git add apps/dashboard/src/store/eventHandlers.ts
git commit -m "fix(dashboard): normalize inputTokens in event handler, pass thinking tokens"
```

---

### Task 7: Database schema update — add thinking column, fix INSERT + ON CONFLICT

<!-- revised: P0 — total_cache_read_tokens was also missing from INSERT. P1 — ON CONFLICT UPDATE clause also lacked all three columns. -->

**Files:**

- Modify: `packages/server/src/db.ts:186-207` (CREATE TABLE) and `packages/server/src/db.ts:778-796` (INSERT + ON CONFLICT)

- [x] **Step 1: Add `total_thinking_tokens` to CREATE TABLE**

In `packages/server/src/db.ts`, find the `analytics_daily` CREATE TABLE (line 186-207). Add after `total_cache_creation_tokens`:

```sql
total_thinking_tokens INTEGER DEFAULT 0,
```

- [x] **Step 2: Fix INSERT INTO analytics_daily — add all three missing columns**

In `packages/server/src/db.ts`, find the INSERT statement (line 778-790). Add `total_cache_read_tokens`, `total_cache_creation_tokens`, and `total_thinking_tokens` to the column list and VALUES clause:

```sql
INSERT INTO analytics_daily (date, cwd, model, vendor, total_events, total_sessions,
  total_input_tokens, total_output_tokens, total_cache_read_tokens, total_cache_creation_tokens,
  total_thinking_tokens, total_cost_usd, total_tool_calls,
  total_errors, total_compactions, sum_latency_ms, count_latency, min_latency_ms, max_latency_ms)
VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
```

And pass the corresponding values in the params array (after `outputTokens`):

```typescript
cacheReadTokens,   // total_cache_read_tokens
cacheCreationTokens, // total_cache_creation_tokens
thinkingTokens,    // total_thinking_tokens
```

**Note:** `total_cache_read_tokens` was already in the CREATE TABLE schema but was **never** included in the INSERT — existing analytics rollups show 0 for cache reads. This is a pre-existing bug fixed here.

- [x] **Step 3: Fix ON CONFLICT UPDATE clause to include all three columns**

The ON CONFLICT UPDATE clause (line 783-795) must also accumulate the new columns:

```sql
ON CONFLICT (date, cwd, model)
DO UPDATE SET
  total_events = total_events + 1,
  total_sessions = total_sessions + excluded.total_sessions,
  total_input_tokens = total_input_tokens + excluded.total_input_tokens,
  total_output_tokens = total_output_tokens + excluded.total_output_tokens,
  total_cache_read_tokens = total_cache_read_tokens + excluded.total_cache_read_tokens,
  total_cache_creation_tokens = total_cache_creation_tokens + excluded.total_cache_creation_tokens,
  total_thinking_tokens = total_thinking_tokens + excluded.total_thinking_tokens,
  total_cost_usd = total_cost_usd + excluded.total_cost_usd,
  ...
```

- [x] **Step 4: Ensure cacheReadTokens / cacheCreationTokens / thinkingTokens are available at the rollup call site**

In `packages/server/src/db.ts`, around line 770-773, the rollup currently only extracts `inputTokens`, `outputTokens`, `latencyMs`, `costUsd` from the event. Add extraction of the three new token types:

```typescript
const cacheReadTokens = event.cache_read_tokens ?? 0;
const cacheCreationTokens = event.cache_creation_tokens ?? 0;
const thinkingTokens = event.thinking_tokens ?? 0;
```

- [x] **Step 5: Run server tests**

Run: `cd packages/server && npx vitest run`
Expected: PASS

- [x] **Step 6: Commit**

```bash
git add packages/server/src/db.ts
git commit -m "fix(server): populate cache_read/cache_creation/thinking columns in analytics_daily"
```

---

### Task 8: Token validation at storage boundary

**Files:**

- Modify: `packages/server/src/services/eventStore.ts`

- [x] **Step 1: Add validateTokenCounts function**

In `packages/server/src/services/eventStore.ts`, add before the analytics rollup code:

```typescript
interface TokenCounts {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  thinkingTokens: number;
}

function validateTokenCounts(tokens: TokenCounts, logger: Logger): TokenCounts {
  const validated = {
    inputTokens: Math.max(0, tokens.inputTokens),
    outputTokens: Math.max(0, tokens.outputTokens),
    cacheReadTokens: Math.max(0, tokens.cacheReadTokens),
    cacheCreationTokens: Math.max(0, tokens.cacheCreationTokens),
    thinkingTokens: Math.max(0, tokens.thinkingTokens),
  };

  if (validated.cacheCreationTokens > validated.inputTokens) {
    logger.warn({ tokens: validated }, 'cacheCreationTokens > inputTokens — possible misparse');
  }
  if (tokens.cacheReadTokens < 0) {
    logger.warn({ raw: tokens.cacheReadTokens }, 'Negative cacheReadTokens clamped to 0');
  }
  const maxPerTurn = 10_000_000;
  for (const [key, val] of Object.entries(validated)) {
    if (val > maxPerTurn) {
      logger.warn({ key, val }, 'Token count exceeds 10M per turn — possible bug');
    }
  }

  return validated;
}
```

- [x] **Step 2: Call validateTokenCounts before writing to analytics_daily**

Find the code that writes to `analytics_daily` and wrap the token values through `validateTokenCounts()`.

- [x] **Step 3: Run server tests**

Run: `cd packages/server && npx vitest run`
Expected: PASS

- [x] **Step 4: Commit**

```bash
git add packages/server/src/services/eventStore.ts
git commit -m "feat(server): add token validation at analytics_daily storage boundary"
```

---

## Chunk 3: Server-Side Migration

### Task 9: Migrate costService.ts to use core pricing

<!-- revised: P1 — added caller audit steps for inputTokens contract change and return type change (number → CostBreakdown) -->

**Files:**

- Modify: `packages/server/src/services/costService.ts` (entire file)
- Modify: `packages/server/src/__tests__/costService.test.ts`

- [x] **Step 1: Audit all callers of `costService.computeCostUsd` for inputTokens semantics**

The old `costService.computeCostUsd` subtracted `cacheReadTokens` from `inputTokens` internally. The new core function does NOT — it expects pre-normalized fresh-only input. Verify every caller passes correct values.

Run: `grep -rn "computeCostUsd" packages/server/src/ --include="*.ts"`

Known callers and their status:

| File | Status | Notes |
|---|---|---|
| `services/eventStore.ts:97` | **Needs check** — does `inputTokens` include cache reads here? |
| `services/velocityService.ts:104,157,222` | **Needs fix** — passes `totalInput` and `Math.round(totalInput * 0.5)` as cacheRead. After normalization, `totalInput` should already be fresh-only, making the synthetic cacheRead wrong. |
| `services/promptAnalyzer.ts:132,183` | **Needs check** — does `turnTokenInput` include cache reads? |
| `services/importService.ts:60,121` | **Needs check** — imports pass `event.tokenUsage.input` |
| `routes/analytics.ts:236,591` | **Needs check** — passes `turn.inputTokens` from transcript |

For each caller: if it passes raw API `input_tokens` (which includes cache reads), add the normalization `Math.max(0, rawInput - cacheRead)` before calling `computeCostUsd`. If it already passes normalized values, no change needed.

- [x] **Step 2: Update costService.test.ts for new interface**

Update existing tests to expect the new `CostBreakdown` return type (`.total` instead of raw number) and add test for `cacheCreationPer1M` field.

- [x] **Step 3: Run tests to verify they fail**

Run: `cd packages/server && npx vitest run src/__tests__/costService.test.ts`
Expected: FAIL

- [x] **Step 4: Refactor costService.ts**

Replace the file contents:

1. Remove `DEFAULT_PRICES[]`, `FALLBACK_PRICE`, `PricePoint` interface, `computeCostUsd`, `findBestMatch`, `findPrefixMatch`, `inferVendorFromModel`
2. Import from `@synapse-ai/core`: `PricePoint, CostBreakdown, DEFAULT_PRICES, FALLBACK_PRICE, computeCostUsd as coreComputeCost, getPrice as coreGetPrice`
3. Keep: user price override management (`userPrices`, `addUserPrice`, `loadUserPrices`, `clearUserPrices`, `getAllPrices`)
4. `getPrice()` becomes a thin wrapper that passes `userPrices` to `coreGetPrice()`
5. `computeCostUsd()` becomes a wrapper that calls `getPrice()` then `coreComputeCost()`

```typescript
import {
  type PricePoint,
  type CostBreakdown,
  getPrice as coreGetPrice,
  computeCostUsd as coreComputeCost,
  DEFAULT_PRICES,
  FALLBACK_PRICE,
} from '@synapse-ai/core';
import { logger } from '../lib/logger.js';

export type { PricePoint, CostBreakdown };

let userPrices: PricePoint[] = [];

export function getPrice(model: string, timestamp?: number): PricePoint {
  // Ensure old user overrides (lacking cacheCreationPer1M) default to 0 instead of NaN
  const pricedOverrides = userPrices.map((p) => ({
    ...p,
    cacheCreationPer1M: p.cacheCreationPer1M ?? 0,
  }));
  return coreGetPrice(model, pricedOverrides, timestamp);
}

export function computeCostUsd(
  model: string,
  inputTokens: number,
  outputTokens: number,
  cacheReadTokens: number,
  cacheCreationTokens: number = 0,
  thinkingTokens: number = 0,
  timestamp?: number,
): CostBreakdown {
  const price = getPrice(model, timestamp);
  return coreComputeCost({
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheCreationTokens,
    thinkingTokens,
    price,
  });
}

// ... keep addUserPrice, loadUserPrices, clearUserPrices, getAllPrices unchanged
```

- [x] **Step 5: Fix all callers for return type change (number → CostBreakdown)**

Every caller that previously did `const cost = computeCostUsd(...)` and used `cost` as a number must now use `.total`:

```
grep -rn "computeCostUsd" packages/server/src/ --include="*.ts" | grep -v "test\|costService.ts"
```

Known callers that need `.total`:

| File | Line | Change |
|---|---|---|
| `eventStore.ts:97` | `costUsd = computeCostUsd(...)` | → `computeCostUsd(...).total` |
| `velocityService.ts:104` | `totalCost = computeCostUsd(...)` | → `computeCostUsd(...).total` |
| `velocityService.ts:157` | `cost = computeCostUsd(...)` | → `computeCostUsd(...).total` |
| `velocityService.ts:222` | `totalCost = computeCostUsd(...)` | → `computeCostUsd(...).total` |
| `promptAnalyzer.ts:132` | `costUsd: computeCostUsd(...)` | → `computeCostUsd(...).total` |
| `promptAnalyzer.ts:183` | `costUsd: computeCostUsd(...)` | → `computeCostUsd(...).total` |
| `importService.ts:60` | `costUsd = computeCostUsd(...)` | → `computeCostUsd(...).total` |
| `importService.ts:121` | `costUsd = computeCostUsd(...)` | → `computeCostUsd(...).total` |
| `routes/analytics.ts:236` | `turnCost = computeCostUsd(...)` | → `computeCostUsd(...).total` |
| `routes/analytics.ts:591` | `costUsd = computeCostUsd(...)` | → `computeCostUsd(...).total` |

- [x] **Step 6: Run tests to verify they pass**

Run: `cd packages/server && npx vitest run src/__tests__/costService.test.ts`
Expected: PASS

- [x] **Step 7: Run full server test suite**

Run: `cd packages/server && npx vitest run`
Expected: ALL PASS (verifies no caller is broken by return type change)

- [x] **Step 8: Commit**

```bash
git add packages/server/src/services/costService.ts packages/server/src/__tests__/costService.test.ts \
       packages/server/src/services/eventStore.ts packages/server/src/services/velocityService.ts \
       packages/server/src/services/promptAnalyzer.ts packages/server/src/services/importService.ts \
       packages/server/src/routes/analytics.ts
git commit -m "refactor(server): migrate costService to @synapse-ai/core pricing, fix all callers"
```

---

### Task 10: Update analytics routes for new token types

**Files:**

- Modify: `packages/server/src/routes/analytics.ts:100-200`

- [x] **Step 1: Update overview endpoint to include thinking tokens in response**

In `GET /api/analytics/overview`, add `totalThinkingTokens` and `totalCacheCreationTokens` to the returned object.

- [x] **Step 2: Update timeseries endpoint to include new token types**

In `GET /api/analytics/timeseries`, include `thinkingTokens` and `cacheCreationTokens` per bucket.

- [x] **Step 3: Update costService import to use new CostBreakdown-aware wrapper**

The routes already import `computeCostUsd` from costService. Since costService now returns `CostBreakdown`, update any code that uses the old numeric return to use `.total` instead.

- [x] **Step 4: Run server tests**

Run: `cd packages/server && npx vitest run`
Expected: PASS

- [x] **Step 5: Commit**

```bash
git add packages/server/src/routes/analytics.ts
git commit -m "feat(server): include thinking/creation tokens in analytics endpoints"
```

---

## Chunk 4: Frontend Migration

### Task 11: Remove duplicate pricing from promptUtils.ts, InsightsView.tsx, mockData.ts

**Files:**

- Modify: `apps/dashboard/src/components/analytics/shared/promptUtils.ts:8-49`
- Modify: `apps/dashboard/src/components/analytics/insights/InsightsView.tsx:89-93`
- Modify: `apps/dashboard/src/components/analytics/mockData.ts:73-80, 160-168`

- [x] **Step 1: Remove pricing code from promptUtils.ts**

Delete `MODEL_PRICING` (lines 8-17), `resolveModelPricing()` (lines 23-35), and `computeCostUsd()` (lines 37-49). Keep `classifyPrompt`, `computeComplexity`, `computeCacheRate`.

- [x] **Step 2: Update ALL frontend imports of `computeCostUsd` from `promptUtils`**

<!-- revised: P1 — AgentDetailPanel.tsx and MobileStatusBar.tsx also import from promptUtils, not just the analytics views -->

Search for all files importing `computeCostUsd` or `MODEL_PRICING` from `promptUtils`:

```
grep -rn "from.*promptUtils" apps/dashboard/src/ --include="*.ts" --include="*.tsx"
```

Known frontend callers that import `computeCostUsd` from `promptUtils`:

| File | Import | Action |
|---|---|---|
| `components/layout/GraphStats.tsx` | `computeCostUsd` | → Task 12 handles this |
| `components/panels/AgentDetailPanel.tsx:22` | `computeCostUsd` | → import from `@synapse-ai/core`, use `getPrice(model)` + `computeCostUsd({...}).total` |
| `components/mobile/MobileStatusBar.tsx:12` | `computeCostUsd` | → import from `@synapse-ai/core`, use `getPrice(model)` + `computeCostUsd({...}).total` |

Update each to import from `@synapse-ai/core`:

```typescript
import { computeCostUsd, getPrice } from '@synapse-ai/core';
```

Note: The core `computeCostUsd` takes a `price` param, so callers need to also call `getPrice(model)` first.

- [x] **Step 3: Remove inline pricing from InsightsView.tsx**

Find `MODEL_PRICING` around line 89-93 in `InsightsView.tsx`. Replace with import from `@synapse-ai/core`.

- [x] **Step 4: Remove inline pricing from mockData.ts**

Find `MODEL_INFO` (lines 73-80) and `computeCost()` (lines 160-168) in `mockData.ts`. Replace with imports from `@synapse-ai/core`.

- [x] **Step 5: Build dashboard to verify no type errors**

Run: `cd apps/dashboard && npx tsc --noEmit`
Expected: No errors

- [x] **Step 6: Run dashboard tests**

Run: `cd apps/dashboard && npx vitest run`
Expected: PASS

- [x] **Step 7: Commit**

```bash
git add apps/dashboard/src/components/analytics/shared/promptUtils.ts \
       apps/dashboard/src/components/analytics/insights/InsightsView.tsx \
       apps/dashboard/src/components/analytics/mockData.ts
git commit -m "refactor(dashboard): remove duplicate pricing tables, import from @synapse-ai/core"
```

---

### Task 12: Update GraphStats.tsx to use core computeCostUsd

**Files:**

- Modify: `apps/dashboard/src/components/layout/GraphStats.tsx:46-51`

- [x] **Step 1: Update import and cost computation**

Replace the local `computeCostUsd` import with:

```typescript
import { computeCostUsd, getPrice } from '@synapse-ai/core';
```

Update the cost computation loop (around line 46-51) to use the new interface:

```typescript
for (const agent of agents.values()) {
  const t = agent.tokenUsage;
  totalTokens += t.input + t.output;
  const price = getPrice(agent.model ?? 'claude-sonnet-4-5');
  const breakdown = computeCostUsd({
    inputTokens: t.input,
    outputTokens: t.output,
    cacheReadTokens: t.cacheRead ?? 0,
    cacheCreationTokens: t.cacheCreation ?? 0,
    thinkingTokens: t.thinking ?? 0,
    price,
  });
  totalCost += breakdown.total;
}
```

- [x] **Step 2: Run dashboard tests**

Run: `cd apps/dashboard && npx vitest run`
Expected: PASS

- [x] **Step 3: Commit**

```bash
git add apps/dashboard/src/components/layout/GraphStats.tsx
git commit -m "refactor(dashboard): update GraphStats to use core computeCostUsd"
```

---

## Chunk 5: Subscription-Aware UX

### Task 13: Add costDisplayMode to view settings store

**Files:**

- Modify: `apps/dashboard/src/store/viewSettingsStore.ts` (or `agentStore.ts` if view settings are there)

- [x] **Step 1: Add costDisplayMode state**

Add to the store:

```typescript
costDisplayMode: 'consumption' | 'cost';
setCostDisplayMode: (mode: 'consumption' | 'cost') => void;
toggleCostDisplayMode: () => void;
```

Default: read from `localStorage.getItem('synapse:costDisplayMode')` or determine from plan:

- For now, default to `'consumption'` (plan-based detection added in next step)

- [x] **Step 2: Persist to localStorage on change**

In the setter:

```typescript
setCostDisplayMode: (mode) => {
  localStorage.setItem('synapse:costDisplayMode', mode);
  set({ costDisplayMode: mode });
},
toggleCostDisplayMode: () => {
  const next = get().costDisplayMode === 'consumption' ? 'cost' : 'consumption';
  get().setCostDisplayMode(next);
},
```

- [x] **Step 3: Commit**

```bash
git add apps/dashboard/src/store/viewSettingsStore.ts
git commit -m "feat(dashboard): add costDisplayMode to view settings store"
```

---

### Task 14: Add `$` keyboard shortcut and toggle button

**Files:**

- Modify: `apps/dashboard/src/components/layout/KeyboardShortcutsTooltip.tsx:6-22`
- Modify: `apps/dashboard/src/components/layout/ViewSettingsDropdown.tsx:48-85`
- Modify: `apps/dashboard/src/App.tsx` (keyboard handler)

- [x] **Step 1: Add `$` to SHORTCUTS array**

In `KeyboardShortcutsTooltip.tsx`, add to the SHORTCUTS array:

```typescript
{ key: '$', label: 'Toggle cost display' },
```

- [x] **Step 2: Add keyboard handler for `$`**

Find where keyboard shortcuts are handled in `App.tsx` (or the keyboard handler hook). Add:

```typescript
case '$':
  toggleCostDisplayMode();
  break;
```

- [x] **Step 3: Add toggle button to ViewSettingsDropdown**

In `ViewSettingsDropdown.tsx`, add a new toggle in the toggles array (around line 48-85):

```typescript
{
  key: 'costDisplayMode',
  label: 'Show API costs',
  icon: DollarSign,  // from lucide-react
  value: costDisplayMode === 'cost',
  toggle: toggleCostDisplayMode,
},
```

- [x] **Step 4: Run dashboard tests**

Run: `cd apps/dashboard && npx vitest run`
Expected: PASS

- [x] **Step 5: Commit**

```bash
git add apps/dashboard/src/components/layout/KeyboardShortcutsTooltip.tsx \
       apps/dashboard/src/components/layout/ViewSettingsDropdown.tsx \
       apps/dashboard/src/App.tsx
git commit -m "feat(dashboard): add $ keyboard shortcut and cost display toggle"
```

---

### Task 15: Plan badge in GraphStats header

**Files:**

- Modify: `apps/dashboard/src/components/layout/GraphStats.tsx:98-107`

- [x] **Step 1: Fetch plan data**

Add a `useEffect` or hook that fetches from `GET /api/analytics/budget` on mount to get the detected plan. Store in local state or a small store.

- [x] **Step 2: Render plan badge**

After the existing stats display (around line 98-107), add the plan badge chip:

```tsx
{
  plan && (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium
    ${
      plan.plan === 'api'
        ? 'bg-blue-500/20 text-blue-300'
        : plan.source === 'auto'
          ? 'bg-green-500/20 text-green-300'
          : 'bg-amber-500/20 text-amber-300'
    }`}
      title={plan.source === 'auto' ? 'Auto-detected' : 'Manually set'}
    >
      <span
        className={`w-1.5 h-1.5 rounded-full
      ${
        plan.plan === 'api'
          ? 'bg-blue-400'
          : plan.source === 'auto'
            ? 'bg-green-400'
            : 'bg-amber-400'
      }`}
      />
      {PLAN_LABELS[plan.plan] ?? plan.plan}
    </span>
  );
}
```

Where `PLAN_LABELS` maps plan keys to display strings (import from a shared constant or inline).

- [x] **Step 3: Conditional cost display based on mode**

In the same component, use `costDisplayMode` to switch between token display and dollar display:

```tsx
{
  costDisplayMode === 'cost' ? (
    <span title={isApiPlan ? 'API cost' : 'API-equivalent cost'}>
      {isApiPlan ? '' : '≈'}${formatCost(totalCost)}
    </span>
  ) : (
    <span>{formatTokens(totalTokens)} tokens</span>
  );
}
```

- [x] **Step 4: Run dashboard tests**

Run: `cd apps/dashboard && npx vitest run`
Expected: PASS

- [x] **Step 5: Commit**

```bash
git add apps/dashboard/src/components/layout/GraphStats.tsx
git commit -m "feat(dashboard): add plan badge and consumption/cost display toggle"
```

---

### Task 16: Cost display mode in CostWaterfallView

**Files:**

- Modify: `apps/dashboard/src/components/lens/cost/CostWaterfallView.tsx`

- [x] **Step 1: Read costDisplayMode from store**

Import and read `costDisplayMode` from the view settings store.

- [x] **Step 2: Add dollar annotations when in cost mode**

When `costDisplayMode === 'cost'`, add a small dollar label next to each bar showing the computed cost for that turn. Use the same `≈` prefix logic for subscription users.

- [x] **Step 3: Run dashboard tests**

Run: `cd apps/dashboard && npx vitest run`
Expected: PASS

- [x] **Step 4: Commit**

```bash
git add apps/dashboard/src/components/lens/cost/CostWaterfallView.tsx
git commit -m "feat(dashboard): add dollar annotations to cost waterfall in cost mode"
```

---

### Task 17: Cost display mode tests

**Files:**

- Create: `apps/dashboard/src/__tests__/costToggle.test.ts`

- [x] **Step 1: Write tests for display mode logic**

```typescript
import { describe, it, expect } from 'vitest';

describe('costDisplayMode', () => {
  it('defaults to consumption for subscription plans', () => {
    // Mock plan as 'pro'
    // Expect costDisplayMode === 'consumption'
  });

  it('defaults to cost for API plan', () => {
    // Mock plan as 'api'
    // Expect costDisplayMode === 'cost'
  });

  it('persists mode to localStorage on toggle', () => {
    // Toggle mode
    // Check localStorage.getItem('synapse:costDisplayMode')
  });

  it('API users see plain $ prefix', () => {
    // With plan='api' and mode='cost'
    // Formatted cost should be '$1.83' (no ≈)
  });

  it('subscription users see ≈$ prefix', () => {
    // With plan='pro' and mode='cost'
    // Formatted cost should be '≈$1.83'
  });
});
```

- [x] **Step 2: Run tests**

Run: `cd apps/dashboard && npx vitest run src/__tests__/costToggle.test.ts`
Expected: PASS

- [x] **Step 3: Commit**

```bash
git add apps/dashboard/src/__tests__/costToggle.test.ts
git commit -m "test(dashboard): add cost display mode toggle tests"
```

---

### Task 18: Update analytics views for display mode

<!-- revised: P1 — decomposed vague steps into specific file-level changes with code sketches -->

**Files:**

- `apps/dashboard/src/components/analytics/useAnalyticsData.ts` — no changes (returns raw data, consumers format)
- Modify: `apps/dashboard/src/components/analytics/prompts/PromptAnalyzer.tsx`
- Modify: `apps/dashboard/src/components/analytics/insights/InsightsView.tsx`
- Modify: `apps/dashboard/src/components/mobile/MobileAnalyticsView.tsx`

**Approach:** Each consumer reads `costDisplayMode` from the view settings store directly. `useAnalyticsData` continues returning raw data (tokens + costs). No new hook or context needed.

- [x] **Step 1: Create shared cost formatting helper**

Add to `apps/dashboard/src/components/analytics/shared/costFormat.ts`:

```typescript
import { useViewSettings } from '../../../store/viewSettingsStore';

/** Format a dollar amount with plan-appropriate prefix */
export function formatCostDisplay(costUsd: number, isApiPlan: boolean): string {
  const formatted = `$${costUsd.toFixed(2)}`;
  return isApiPlan ? formatted : `≈${formatted}`;
}

/** Returns a summary string based on display mode */
export function formatStatLine(
  mode: 'consumption' | 'cost',
  tokens: number,
  costUsd: number,
  isApiPlan: boolean,
): string {
  if (mode === 'cost') return formatCostDisplay(costUsd, isApiPlan);
  return `${(tokens / 1000).toFixed(1)}k tokens`;
}
```

- [x] **Step 2: Update PromptAnalyzer to show cost column in cost mode**

In `apps/dashboard/src/components/analytics/prompts/PromptAnalyzer.tsx`, the prompt table already has a cost column. Read `costDisplayMode` from the store and:

- `consumption` mode: show token counts as primary, cost as secondary
- `cost` mode: show cost as primary column, tokens as secondary

```tsx
const costDisplayMode = useViewSettings((s) => s.costDisplayMode);
// In the table row:
{costDisplayMode === 'cost' ? formatCostDisplay(prompt.costUsd, isApiPlan) : `${fmtTokens(prompt.totalTokens)} tokens`}
```

- [x] **Step 3: Update InsightsView KPI cards for dual mode**

In `apps/dashboard/src/components/analytics/insights/InsightsView.tsx`, the KPI cards (around line 150-200) currently show tokens. Add mode switching:

```tsx
const costDisplayMode = useViewSettings((s) => s.costDisplayMode);

// KPI cards:
// consumption: Tokens | Sessions | Cache % | Tool Calls
// cost:        API Cost (≈$) | Avg/Session | Cache Savings $ | Tokens
const kpiCards = costDisplayMode === 'cost'
  ? [
      { label: isApiPlan ? 'API Cost' : '≈API Cost', value: formatCostDisplay(overview.totalCost, isApiPlan) },
      { label: 'Avg/Session', value: formatCostDisplay(overview.totalCost / Math.max(1, overview.totalSessions), isApiPlan) },
      { label: 'Cache Savings', value: formatCostDisplay(cacheSavings, isApiPlan) },
      { label: 'Tokens', value: fmtTokens(overview.totalTokens.input + overview.totalTokens.output) },
    ]
  : [
      { label: 'Tokens', value: fmtTokens(overview.totalTokens.input + overview.totalTokens.output) },
      { label: 'Sessions', value: String(overview.totalSessions) },
      { label: 'Cache %', value: `${cacheRate.toFixed(0)}%` },
      { label: 'Tool Calls', value: String(overview.totalToolCalls) },
    ];
```

Where `cacheSavings` = cost of cache reads at full input rate minus cost at cached rate.

- [x] **Step 4: Update model breakdown for dual mode**

In InsightsView's model breakdown section, switch between token % and dollar % per model:

```tsx
// consumption: "Sonnet 4.5: 65% of tokens"
// cost: "Sonnet 4.5: 72% of cost"
const modelMetric = costDisplayMode === 'cost'
  ? { value: model.cost, total: totalCost, suffix: 'of cost' }
  : { value: model.tokens, total: totalTokens, suffix: 'of tokens' };
```

- [x] **Step 5: Update MobileAnalyticsView for dual mode**

In `apps/dashboard/src/components/mobile/MobileAnalyticsView.tsx`, the mobile view consumes `useAnalyticsData`. Apply the same `costDisplayMode` read and formatting as InsightsView.

- [x] **Step 6: Run dashboard tests**

Run: `cd apps/dashboard && npx vitest run`
Expected: PASS

- [x] **Step 7: Commit**

```bash
git add apps/dashboard/src/components/analytics/ apps/dashboard/src/components/mobile/MobileAnalyticsView.tsx
git commit -m "feat(dashboard): add dual display mode to analytics views"
```

---

### Task 19: Add planDetector tests

**Files:**

- Create: `packages/server/src/__tests__/planDetector.test.ts`

- [x] **Step 1: Write tests for plan detection**

```typescript
import { describe, it, expect } from 'vitest';
import { detectPlan, setPlan, getPlanLabels, getPlanLimits } from '../services/planDetector.js';

describe('planDetector', () => {
  it('returns a valid plan object', () => {
    const plan = detectPlan();
    expect(plan).toHaveProperty('plan');
    expect(plan).toHaveProperty('monthlyLimit');
    expect(plan).toHaveProperty('detected');
    expect(plan).toHaveProperty('source');
  });

  it('setPlan validates plan name', () => {
    expect(() => setPlan('invalid_plan')).toThrow('Unknown plan');
  });

  it('setPlan returns correct limit for pro', () => {
    const plan = setPlan('pro');
    expect(plan.monthlyLimit).toBe(20);
    expect(plan.source).toBe('manual');
  });

  it('API plan has null monthly limit (unlimited)', () => {
    const plan = setPlan('api');
    expect(plan.monthlyLimit).toBeNull();
  });

  it('getPlanLabels returns all plan labels', () => {
    const labels = getPlanLabels();
    expect(labels).toHaveProperty('pro');
    expect(labels).toHaveProperty('api');
    expect(labels).toHaveProperty('max_5x');
  });

  it('getPlanLimits returns all plan limits', () => {
    const limits = getPlanLimits();
    expect(limits.pro).toBe(20);
    expect(limits.api).toBeNull();
    expect(limits.max_20x).toBe(200);
  });
});
```

- [x] **Step 2: Run tests**

Run: `cd packages/server && npx vitest run src/__tests__/planDetector.test.ts`
Expected: PASS

- [x] **Step 3: Commit**

```bash
git add packages/server/src/__tests__/planDetector.test.ts
git commit -m "test(server): add planDetector unit tests"
```

---

### Task 20: Add tests for token validation and eventHandler normalization

**Files:**

- Modify: `packages/server/src/__tests__/eventStore.test.ts` (or create)
- Modify: `apps/dashboard/src/store/__tests__/eventHandlers.test.ts` (or create)

- [x] **Step 1: Write tests for validateTokenCounts**

```typescript
describe('validateTokenCounts', () => {
  it('clamps negative values to 0', () => {
    const result = validateTokenCounts({
      inputTokens: -100,
      outputTokens: 50,
      cacheReadTokens: -10,
      cacheCreationTokens: 0,
      thinkingTokens: -5,
    });
    expect(result.inputTokens).toBe(0);
    expect(result.cacheReadTokens).toBe(0);
    expect(result.thinkingTokens).toBe(0);
    expect(result.outputTokens).toBe(50);
  });

  it('passes through valid values unchanged', () => {
    const input = {
      inputTokens: 100,
      outputTokens: 50,
      cacheReadTokens: 20,
      cacheCreationTokens: 10,
      thinkingTokens: 30,
    };
    const result = validateTokenCounts(input);
    expect(result).toEqual(input);
  });
});
```

- [x] **Step 2: Write test for eventHandler inputTokens normalization**

```typescript
describe('eventHandler token normalization', () => {
  it('inputTokens equals raw minus cacheRead (fresh only)', () => {
    // Create event with usage.input_tokens=100, cache_read=60
    // After processing, agent.tokenUsage.input should be 40
  });
});
```

- [x] **Step 3: Run tests**

Run: `pnpm test`
Expected: PASS

- [x] **Step 4: Commit**

```bash
git add packages/server/src/__tests__/eventStore.test.ts apps/dashboard/src/store/__tests__/
git commit -m "test: add token validation and eventHandler normalization tests"
```

---

## Chunk 6: Final Integration & Verification

### Task 21: Run full test suite and build

- [x] **Step 1: Run all tests across monorepo**

Run: `pnpm test`
Expected: ALL PASS

- [x] **Step 2: Build all packages**

Run: `pnpm -r build`
Expected: Build succeeds with no errors

- [x] **Step 3: Manual smoke test**

1. Start server: `.\start-server.ps1`
2. Start client: `.\start-client.ps1`
3. Run simulation: `npx tsx scripts/simulate_all_nodes.ts`
4. Verify:
   - GraphStats shows token count (consumption mode default)
   - Click `$` button or press Shift+4 → switches to cost display
   - Plan badge appears (likely "Pro $20/mo" or "API" depending on local config)
   - Cost waterfall shows dollar annotations in cost mode
   - Subscription users see `≈` prefix on costs
   - API users see plain `$` prefix

- [x] **Step 4: Commit any remaining fixes**

```bash
git add -A && git commit -m "chore: fix integration issues from cost accuracy implementation"
```

---

## Summary

| Chunk | Tasks | Focus                                                          |
| ----- | ----- | -------------------------------------------------------------- |
| 1     | 1-2   | Core pricing module (new file, tests, exports)                 |
| 2     | 3-8   | Data integrity (types, normalization, DB schema, validation)   |
| 3     | 9-10  | Server migration (costService wrapper, analytics routes)       |
| 4     | 11-12 | Frontend migration (remove duplicates, update GraphStats)      |
| 5     | 13-20 | Subscription UX (store, toggle, badge, analytics views, tests) |
| 6     | 21    | Integration verification                                       |

**Total tasks:** 21
**Estimated commits:** ~19 atomic commits

## Known Side Effects

<!-- revised: P1 — budget alert discontinuity after formula change -->

**Budget alert discontinuity:** After deploying, `total_cost_usd` values written to `analytics_daily` will change because (a) the double-counting bug is fixed (costs decrease) and (b) cache creation + thinking tokens are now costed (costs increase). The net effect depends on cache ratio. `budgetService.computeForecast()` uses a 14-day weighted moving average — the first two weeks after deployment will blend old and new formula data, potentially causing unexpected budget alerts or missed alerts. No action needed, but be aware of this if users report budget anomalies in the first two weeks post-deploy.

---

## Open Questions / Deferred (P2)

<!-- P2 items from plan review — address incrementally, not blocking implementation -->

- **`$` keyboard shortcut on international keyboards:** Shift+4 produces `$` on US layout but differs on French AZERTY, German, etc. The toggle button is the primary affordance; the shortcut is best-effort. Consider adding an alternative shortcut (e.g., `Ctrl+Shift+D`) in a follow-up if users report issues.
- **Plan selector for unknown plan:** The spec describes "Plan?" badge as clickable → plan selector, but no plan selector UI is implemented in this plan. For MVP, clicking "Plan?" can open a toast with instructions to set the plan via API (`PUT /api/settings/plan`). Full selector UI deferred.
- **Empty/loading state for plan badge:** During fetch or API failure, the badge is absent. Consider a skeleton state or fallback "Plan?" badge if the API is unreachable.
- **`findBestMatch` not future-safe for time-bucketed defaults:** If default prices gain different `effectiveFrom` values, the `find()` approach returns the first match, not the most recent valid one. Would need a sort or filter-then-max. Fine for now since all defaults use `effectiveFrom: 0`.
- **Cost accuracy validation:** No formal validation step compares Synapse cost output against Anthropic billing dashboard. Consider adding a manual test step with known token counts and expected dollar amounts.
- **Two-phase shipping:** Chunks 1-4 (accuracy fixes) could ship independently from Chunk 5 (subscription UX) to reduce blast radius.

---

## Review Findings Addressed

**Round 1 (plan review loop):**

- **CRITICAL:** `inferVendor` naming collision resolved — reuse existing from `format.ts`, don't create duplicate
- **CRITICAL:** `planDetector.test.ts` added as Task 19
- **CONCERN:** `useAnalyticsData.ts` + KPI/session/model views covered in Task 18
- **CONCERN:** User price override NaN prevention added to costService wrapper
- **CONCERN:** Prefix matching changed to unidirectional (input starts with known model only)
- **CONCERN:** Token validation and eventHandler normalization tests added as Task 20

**Round 2 (four-perspective review):**

- **P0:** `total_cache_read_tokens` was also missing from INSERT in `analytics_daily` — Task 7 now fixes all three columns (cache_read, cache_creation, thinking) in both INSERT and ON CONFLICT UPDATE
- **P1:** costService `inputTokens` contract change — Task 9 now includes caller audit table for all 10 server-side call sites
- **P1:** costService return type change (`number` → `CostBreakdown`) — Task 9 now includes `.total` migration table for all callers
- **P1:** Task 18 decomposed from 6 vague steps into 7 specific steps with file paths, code sketches, and shared formatting helper
- **P1:** Frontend callers of `promptUtils.computeCostUsd` (AgentDetailPanel, MobileStatusBar) added to Task 11
- **P1:** Budget alert discontinuity documented in Known Side Effects section
- **P2:** Six items added to Open Questions / Deferred section

**Round 3 (post-implementation four-perspective review):**

- **P1:** All 98 checkboxes updated from `[ ]` to `[x]` — implementation is 100% complete
- **P1:** Prefix match false positives for short model IDs (e.g., `o1` → `o1-preview`) — noted in spec, suggest separator check
- **P1:** Spec `computeCostUsd` signature had dead `model: string` param — removed from spec to match implementation
- **P1:** Budget forecast transition warning — added mitigation note to spec Section 4.5
- **P1:** Pricing version toast described but never implemented — moved to deferred in spec
- **P1:** `$` keyboard shortcut locale safety — added `event.key` requirement to spec
- **P1:** Plan selector UI for unknown plan — documented gap in spec Section 3.2
