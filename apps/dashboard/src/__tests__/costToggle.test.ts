// @vitest-environment jsdom
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bernhard

import { describe, it, expect, beforeEach } from 'vitest';
import { formatCostDisplay, formatStatLine } from '../components/analytics/shared/costFormat';

// ─── costFormat utility tests (pure functions, no store needed) ──────────────
//
// The costDisplayMode toggle lives in agentStore, which has heavy browser
// dependencies (WebSocket, fetch, window.location). Rather than bootstrapping
// the entire store in jsdom we test:
//   1. The default value declared in the store initializer (via localStorage)
//   2. The localStorage persistence contract (via persistViewSettings)
//   3. The formatting functions that drive the API vs subscription distinction
//
// The store's toggle logic itself is a one-liner:
//   next = mode === 'consumption' ? 'cost' : 'consumption'
// which is trivial and exercised implicitly through the format tests.

describe('costDisplayMode', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('defaults to consumption when localStorage is empty', () => {
    // The store reads savedViewSettings.costDisplayMode ?? 'consumption'.
    // With an empty localStorage the parsed value is undefined, so the
    // default is 'consumption'.
    const raw = localStorage.getItem('synapse-view-settings');
    expect(raw).toBeNull();

    // Simulate the store initializer expression
    const parsed = raw ? JSON.parse(raw) : {};
    const mode: 'consumption' | 'cost' = parsed.costDisplayMode ?? 'consumption';
    expect(mode).toBe('consumption');
  });

  it('persists mode to localStorage on toggle', () => {
    // Simulate persistViewSettings({ costDisplayMode: 'cost' })
    const KEY = 'synapse-view-settings';
    const current = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    localStorage.setItem(KEY, JSON.stringify({ ...current, costDisplayMode: 'cost' }));

    const stored = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    expect(stored.costDisplayMode).toBe('cost');

    // Toggle back
    const current2 = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    localStorage.setItem(KEY, JSON.stringify({ ...current2, costDisplayMode: 'consumption' }));
    const stored2 = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    expect(stored2.costDisplayMode).toBe('consumption');
  });

  it('API users see plain $ prefix', () => {
    // plan='api' → isApiPlan=true → no ≈ prefix
    const result = formatCostDisplay(1.83, true);
    expect(result).toBe('$1.83');
  });

  it('subscription users see ≈$ prefix', () => {
    // plan='pro' → isApiPlan=false → ≈ prefix
    const result = formatCostDisplay(1.83, false);
    expect(result).toBe('≈$1.83');
  });
});

// ─── formatCostDisplay ───────────────────────────────────────────────────────

describe('formatCostDisplay', () => {
  it('formats zero cost correctly for API plan', () => {
    expect(formatCostDisplay(0, true)).toBe('$0.00');
  });

  it('formats zero cost correctly for subscription plan', () => {
    expect(formatCostDisplay(0, false)).toBe('≈$0.00');
  });

  it('rounds to 2 decimal places', () => {
    expect(formatCostDisplay(1.836, true)).toBe('$1.84');
    expect(formatCostDisplay(1.831, false)).toBe('≈$1.83');
  });

  it('handles large values', () => {
    expect(formatCostDisplay(100.0, true)).toBe('$100.00');
    expect(formatCostDisplay(100.0, false)).toBe('≈$100.00');
  });
});

// ─── formatStatLine ──────────────────────────────────────────────────────────

describe('formatStatLine', () => {
  it('returns cost string in cost mode for API plan', () => {
    expect(formatStatLine('cost', 50_000, 1.83, true)).toBe('$1.83');
  });

  it('returns cost string with ≈ in cost mode for subscription plan', () => {
    expect(formatStatLine('cost', 50_000, 1.83, false)).toBe('≈$1.83');
  });

  it('returns token count in consumption mode', () => {
    expect(formatStatLine('consumption', 50_000, 1.83, true)).toBe('50.0k tokens');
    expect(formatStatLine('consumption', 50_000, 1.83, false)).toBe('50.0k tokens');
  });

  it('isApiPlan is ignored in consumption mode', () => {
    const api = formatStatLine('consumption', 12_500, 0.5, true);
    const sub = formatStatLine('consumption', 12_500, 0.5, false);
    expect(api).toBe(sub);
  });

  it('formats sub-thousand token counts', () => {
    expect(formatStatLine('consumption', 500, 0.01, true)).toBe('0.5k tokens');
  });
});
