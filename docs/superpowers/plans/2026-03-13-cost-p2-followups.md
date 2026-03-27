# Cost P2 Follow-ups: Prefix Tests, Cost Validation, Plan Selector UI

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close out three P2 items from the cost-accuracy post-implementation review: harden prefix matching with edge-case tests, add cost validation snapshot tests, and build a plan selector dropdown in the dashboard.

**Architecture:** Task 1 adds pure unit tests to `packages/core`. Task 2 adds snapshot-style cost validation tests to `packages/core`. Task 3 adds a `PlanSelector` popover component to `apps/dashboard` that calls the existing `PUT /api/analytics/budget/plan` endpoint. Tasks are independent.

**Tech Stack:** Vitest, React 19, Tailwind CSS 4, existing `Tooltip` component pattern, `fetch` API.

---

## Chunk 1: Prefix Match Tests + Cost Validation

### Task 1: Prefix Match Edge-Case Tests

**Files:**

- Modify: `packages/core/src/__tests__/pricing.test.ts`

These tests document the expected behaviour of `findPrefixMatch` after the separator fix (date-suffix regex `^-\d+`). No implementation changes needed — tests only.

- [ ] **Step 1: Add edge-case tests to `getPrice` describe block**

Add after the existing `prefix match works with separator` test (line ~79):

```typescript
it('o3-mini does not match o3', () => {
  // If o3 were added to DEFAULT_PRICES, o3-mini should not inherit its pricing
  // because '-mini' does not start with a digit.
  const p = getPrice('o3-mini');
  expect(p.inputPer1M).toBe(1.1); // exact match — o3-mini IS in DEFAULT_PRICES
});

it('gpt-4o-2024-05-13 matches gpt-4o via dated prefix', () => {
  const p = getPrice('gpt-4o-2024-05-13');
  expect(p.inputPer1M).toBe(2.5); // gpt-4o pricing
});

it('gpt-4o-mini does not match gpt-4o', () => {
  // gpt-4o-mini has its own entry; but even if it didn't,
  // '-mini' suffix would prevent prefix match to gpt-4o.
  const p = getPrice('gpt-4o-mini');
  expect(p.inputPer1M).toBe(0.15); // exact match for gpt-4o-mini
});

it('gemini-2.5-pro-preview falls back (non-digit suffix)', () => {
  // Hypothetical model — '-preview' should not prefix-match gemini-2.5-pro
  const p = getPrice('gemini-2.5-pro-preview');
  expect(p.inputPer1M).toBe(3); // FALLBACK_PRICE
});

it('case-insensitive matching', () => {
  const p = getPrice('Claude-Opus-4-6');
  expect(p.inputPer1M).toBe(15);
});
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `npx vitest run packages/core/src/__tests__/pricing.test.ts`
Expected: all tests pass (existing + 5 new = ~23 total)

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/__tests__/pricing.test.ts
git commit -m "test(core): add prefix match edge-case tests for model pricing lookup"
```

---

### Task 2: Cost Validation Snapshot Tests

**Files:**

- Modify: `packages/core/src/__tests__/pricing.test.ts`

Add a `describe('cost validation snapshots')` block with known-good token counts and expected dollar amounts computed by hand from public pricing pages. These act as regression guards — if `DEFAULT_PRICES` or `computeCostUsd` change, these tests break and force manual verification.

- [ ] **Step 1: Add snapshot test block**

Add at the end of the file, after the `computeCostUsd` describe block:

```typescript
describe('cost validation snapshots', () => {
  // Hand-computed from public pricing pages (2026-03-13).
  // If any of these fail, verify the new prices against the provider's pricing page
  // before updating the expected values.

  it('claude-opus-4-6: 100K input + 50K cache-read + 10K cache-write + 20K output + 5K thinking', () => {
    const price = getPrice('claude-opus-4-6');
    const result = computeCostUsd({
      inputTokens: 100_000,
      outputTokens: 20_000,
      cacheReadTokens: 50_000,
      cacheCreationTokens: 10_000,
      thinkingTokens: 5_000,
      price,
    });
    // input:    100K / 1M * $15.00    = $1.5000
    // cached:    50K / 1M * $1.50     = $0.0750
    // creation:  10K / 1M * $18.75    = $0.1875
    // output:    20K / 1M * $75.00    = $1.5000
    // thinking:   5K / 1M * $75.00    = $0.3750
    // total:                          = $3.6375
    expect(result.input).toBeCloseTo(1.5, 4);
    expect(result.cached).toBeCloseTo(0.075, 4);
    expect(result.creation).toBeCloseTo(0.1875, 4);
    expect(result.output).toBeCloseTo(1.5, 4);
    expect(result.thinking).toBeCloseTo(0.375, 4);
    expect(result.total).toBeCloseTo(3.6375, 4);
  });

  it('claude-sonnet-4-5: 500K input + 200K cache-read + 0 cache-write + 100K output + 50K thinking', () => {
    const price = getPrice('claude-sonnet-4-5');
    const result = computeCostUsd({
      inputTokens: 500_000,
      outputTokens: 100_000,
      cacheReadTokens: 200_000,
      cacheCreationTokens: 0,
      thinkingTokens: 50_000,
      price,
    });
    // input:    500K / 1M * $3.00    = $1.5000
    // cached:   200K / 1M * $0.30    = $0.0600
    // creation:   0K / 1M * $3.75    = $0.0000
    // output:   100K / 1M * $15.00   = $1.5000
    // thinking:  50K / 1M * $15.00   = $0.7500
    // total:                         = $3.8100
    expect(result.input).toBeCloseTo(1.5, 4);
    expect(result.cached).toBeCloseTo(0.06, 4);
    expect(result.creation).toBeCloseTo(0, 4);
    expect(result.output).toBeCloseTo(1.5, 4);
    expect(result.thinking).toBeCloseTo(0.75, 4);
    expect(result.total).toBeCloseTo(3.81, 4);
  });

  it('gpt-4o: 1M input + 500K cache-read + 200K output + 0 thinking (no cache creation fee)', () => {
    const price = getPrice('gpt-4o');
    const result = computeCostUsd({
      inputTokens: 1_000_000,
      outputTokens: 200_000,
      cacheReadTokens: 500_000,
      cacheCreationTokens: 100_000, // should be $0 — OpenAI has no creation fee
      thinkingTokens: 0,
      price,
    });
    // input:     1M / 1M * $2.50    = $2.5000
    // cached:  500K / 1M * $1.25    = $0.6250
    // creation: 100K / 1M * $0      = $0.0000
    // output:  200K / 1M * $10.00   = $2.0000
    // thinking:   0                 = $0.0000
    // total:                        = $5.1250
    expect(result.input).toBeCloseTo(2.5, 4);
    expect(result.cached).toBeCloseTo(0.625, 4);
    expect(result.creation).toBeCloseTo(0, 4);
    expect(result.output).toBeCloseTo(2.0, 4);
    expect(result.total).toBeCloseTo(5.125, 4);
  });

  it('gemini-2.5-flash: 2M input + 1M cache-read + 500K output (cheapest tier)', () => {
    const price = getPrice('gemini-2.5-flash');
    const result = computeCostUsd({
      inputTokens: 2_000_000,
      outputTokens: 500_000,
      cacheReadTokens: 1_000_000,
      cacheCreationTokens: 0,
      thinkingTokens: 0,
      price,
    });
    // input:     2M / 1M * $0.15     = $0.3000
    // cached:    1M / 1M * $0.0375   = $0.0375
    // output:  500K / 1M * $0.60     = $0.3000
    // total:                         = $0.6375
    expect(result.input).toBeCloseTo(0.3, 4);
    expect(result.cached).toBeCloseTo(0.0375, 4);
    expect(result.output).toBeCloseTo(0.3, 4);
    expect(result.total).toBeCloseTo(0.6375, 4);
  });
});
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `npx vitest run packages/core/src/__tests__/pricing.test.ts`
Expected: all tests pass (~27 total)

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/__tests__/pricing.test.ts
git commit -m "test(core): add cost validation snapshot tests with hand-computed expected values"
```

---

## Chunk 2: Plan Selector UI

### Task 3: Extract plan badge into PlanBadge component

**Files:**

- Create: `apps/dashboard/src/components/layout/PlanBadge.tsx`
- Modify: `apps/dashboard/src/components/layout/GraphStats.tsx`

Extract the plan badge rendering and state from `GraphStats` into a self-contained `PlanBadge` component. This keeps `GraphStats` focused on stats and gives us a clean place to add the selector popover.

**Important notes from review:**

- `GraphStats` is rendered inside `Header.tsx` (top bar), so the popover opens **downward** (`top-full mt-1`), matching all other layout dropdowns.
- Use `bg-[#1c2128]` for popover background — matches `ViewSettingsDropdown`, `ActionsMenu`, `SessionSelector`, etc.
- The existing `GET /api/analytics/budget/plans` endpoint (line 1041 of `analytics.ts`) already returns `{ labels, limits }` — use it instead of creating new endpoints.
- `GraphStats` uses `plan` for `isApiPlan` (controls `≈` prefix on cost display). Keep a minimal plan fetch in GraphStats, or pass `isApiPlan` from PlanBadge via a shared store/callback. Simplest: keep the existing budget fetch in GraphStats and just extract the badge UI + selector into PlanBadge, accepting `plan` as a prop.
- Suppress tooltip when popover is open to avoid visual overlap.

- [ ] **Step 1: Create PlanBadge component**

Create `apps/dashboard/src/components/layout/PlanBadge.tsx`:

```tsx
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bernhard

import { useEffect, useState, useRef } from 'react';
import { Tooltip } from '../ui/Tooltip';
import { apiUrl } from '../../utils/api';

interface PlanInfo {
  plan: string;
  source: 'auto' | 'manual';
  monthlyLimit: number | null;
  detected: boolean;
}

interface PlanOption {
  value: string;
  label: string;
  limit: number | null;
}

const FALLBACK_LABELS: Record<string, string> = {
  free: 'Free',
  pro: 'Pro $20/mo',
  max_5x: 'Max 5× $100/mo',
  max_20x: 'Max 20× $200/mo',
  team: 'Team $30/user/mo',
  api: 'API (pay-per-use)',
};

interface PlanBadgeProps {
  plan: PlanInfo;
  onPlanChange: (updated: PlanInfo) => void;
}

export function PlanBadge({ plan, onPlanChange }: PlanBadgeProps) {
  const [options, setOptions] = useState<PlanOption[]>([]);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Fetch plan options from existing combined endpoint when popover opens
  useEffect(() => {
    if (!open || options.length > 0) return;
    fetch(apiUrl('/api/analytics/budget/plans'))
      .then((r) => r.json())
      .then((res) => {
        const labels: Record<string, string> = res?.data?.labels ?? FALLBACK_LABELS;
        const limits: Record<string, number | null> = res?.data?.limits ?? {};
        setOptions(
          Object.entries(labels).map(([value, label]) => ({
            value,
            label,
            limit: limits[value] ?? null,
          })),
        );
      })
      .catch(() => {
        setOptions(
          Object.entries(FALLBACK_LABELS).map(([value, label]) => ({
            value,
            label,
            limit: null,
          })),
        );
      });
  }, [open, options.length]);

  // Click-outside to close (matches ViewSettingsDropdown pattern)
  useEffect(() => {
    if (!open) return;
    const handle = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [open]);

  const selectPlan = (planName: string) => {
    setSaving(true);
    fetch(apiUrl('/api/analytics/budget/plan'), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plan: planName }),
    })
      .then((r) => r.json())
      .then((res) => {
        const d = res?.data;
        if (d) {
          const updated: PlanInfo = {
            plan: d.plan,
            source: d.source ?? 'manual',
            monthlyLimit: d.monthlyLimit ?? null,
            detected: true,
          };
          onPlanChange(updated);
        }
        setOpen(false);
      })
      .catch(() => {
        // Keep popover open on error so user can retry
      })
      .finally(() => setSaving(false));
  };

  const label = FALLBACK_LABELS[plan.plan] ?? plan.plan;

  const badge = (
    <button
      type="button"
      onClick={() => setOpen(!open)}
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium cursor-pointer transition-colors
        ${
          !plan.detected
            ? 'bg-gray-500/20 text-gray-400 hover:bg-gray-500/30'
            : plan.plan === 'api'
              ? 'bg-blue-500/20 text-blue-300 hover:bg-blue-500/30'
              : plan.source === 'auto'
                ? 'bg-green-500/20 text-green-300 hover:bg-green-500/30'
                : 'bg-amber-500/20 text-amber-300 hover:bg-amber-500/30'
        }`}
    >
      <span
        className={`w-1.5 h-1.5 rounded-full ${
          !plan.detected
            ? 'bg-gray-400'
            : plan.plan === 'api'
              ? 'bg-blue-400'
              : plan.source === 'auto'
                ? 'bg-green-400'
                : 'bg-amber-400'
        }`}
      />
      {!plan.detected ? `${label}?` : label}
    </button>
  );

  return (
    <div ref={ref} className="relative inline-flex">
      {/* Suppress tooltip when popover is open to avoid visual overlap */}
      {open ? (
        badge
      ) : (
        <Tooltip
          content={
            !plan.detected
              ? 'Plan not detected — click to set'
              : plan.source === 'auto'
                ? 'Auto-detected from Claude config'
                : 'Manually set — click to change'
          }
        >
          {badge}
        </Tooltip>
      )}

      {open && (
        <div className="absolute left-0 top-full mt-1 w-52 bg-[#1c2128] border border-gray-700 rounded-lg shadow-xl z-30 py-1 text-xs">
          <div className="px-3 py-1.5 text-gray-500 font-medium border-b border-gray-800">
            Select plan
          </div>
          {options.length === 0 ? (
            <div className="px-3 py-2 text-gray-500">Loading...</div>
          ) : (
            options.map((opt) => (
              <button
                key={opt.value}
                type="button"
                disabled={saving}
                onClick={() => selectPlan(opt.value)}
                className={`w-full text-left px-3 py-1.5 transition-colors
                  ${
                    opt.value === plan.plan
                      ? 'bg-blue-500/20 text-blue-300'
                      : 'text-gray-300 hover:bg-gray-800'
                  }
                  ${saving ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
              >
                {opt.label}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Update GraphStats to use PlanBadge**

In `apps/dashboard/src/components/layout/GraphStats.tsx`:

1. Remove `PLAN_LABELS` constant (lines 18-24) — labels now live in PlanBadge.
2. Keep `PlanInfo` interface (still used for state) but add `detected` field (already done).
3. Keep `plan` state and `useEffect` fetch (GraphStats still needs `isApiPlan` for cost display).
4. Replace the plan badge JSX block (lines ~179-220) with:

```tsx
{
  plan && (
    <>
      <span className="hidden lg:inline text-gray-600">&middot;</span>
      <PlanBadge plan={plan} onPlanChange={setPlan} />
    </>
  );
}
```

5. Add import: `import { PlanBadge } from './PlanBadge';`

- [ ] **Step 3: Verify TypeScript compiles**

Run: `npx tsc --noEmit --project apps/dashboard/tsconfig.json`
Expected: clean (no errors)

- [ ] **Step 4: Commit**

```bash
git add apps/dashboard/src/components/layout/PlanBadge.tsx apps/dashboard/src/components/layout/GraphStats.tsx
git commit -m "feat(dashboard): add PlanBadge component with plan selector popover"
```

---

### Task 4: Wire up end-to-end and verify

**Files:**

- No new files — integration verification only.
- No new server endpoints needed — `GET /api/analytics/budget/plans` already exists (line 1041 of `analytics.ts`).

- [ ] **Step 1: Start backend and frontend**

```bash
# Terminal 1
.\start-server.ps1

# Terminal 2
.\start-client.ps1
```

- [ ] **Step 2: Verify plan badge renders**

Open http://localhost:5173. The plan badge should appear in the header stats area:

- If Claude config file exists with plan info: green badge with detected plan name
- If `ANTHROPIC_API_KEY` env var set: blue "API (pay-per-use)" badge
- Otherwise: grey "Pro $20/mo?" badge

- [ ] **Step 3: Verify plan selector popover**

Click the plan badge. A popover should appear **below** it (matching all other header dropdowns) listing all plan options. Click a different plan. The badge should update immediately to the selected plan with amber styling (manually set).

- [ ] **Step 4: Verify cost display prefix updates**

After changing plan to "API (pay-per-use)", the cost display should drop the `≈` prefix (exact API cost). Changing to any subscription plan should show `≈` prefix (API-equivalent cost).

- [ ] **Step 5: Verify plan persists across page reload**

Reload the page. The badge should show the plan you selected (fetched from server on load).

- [ ] **Step 6: Run full test suite**

Run: `pnpm test`
Expected: all tests pass

- [ ] **Step 7: Commit any fixes if needed**

If any issues found during verification, fix and commit with descriptive message.
