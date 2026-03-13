// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bernhard

import { describe, it, expect } from 'vitest';
import { classifyPrompt, computeComplexity, computeCacheRate } from '../promptUtils';
import { computeCostUsd, getPrice, DEFAULT_PRICES } from '@synapse-ai/core';

// ── computeCostUsd (core) ────────────────────────────────────────────

describe('computeCostUsd (core)', () => {
  it('computes cost for Opus model', () => {
    const price = getPrice('claude-opus-4-6');
    const { total } = computeCostUsd({
      inputTokens: 1_000_000,
      outputTokens: 100_000,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      thinkingTokens: 0,
      price,
    });
    // input: 1M * 15/1M = 15, output: 100k * 75/1M = 7.5
    expect(total).toBeCloseTo(22.5, 2);
  });

  it('includes cached token cost at discounted rate', () => {
    const price = getPrice('claude-opus-4-6');
    const { total } = computeCostUsd({
      inputTokens: 500_000,
      outputTokens: 100_000,
      cacheReadTokens: 200_000,
      cacheCreationTokens: 0,
      thinkingTokens: 0,
      price,
    });
    // input: 500k * 15/1M = 7.5, output: 100k * 75/1M = 7.5, cache: 200k * 1.5/1M = 0.3
    expect(total).toBeCloseTo(15.3, 2);
  });

  it('returns 0 for zero tokens', () => {
    const price = getPrice('claude-opus-4-6');
    const { total } = computeCostUsd({
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      thinkingTokens: 0,
      price,
    });
    expect(total).toBe(0);
  });

  it('handles Sonnet pricing', () => {
    const price = getPrice('claude-sonnet-4-5');
    const { total } = computeCostUsd({
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      thinkingTokens: 0,
      price,
    });
    // input: 3, output: 15
    expect(total).toBeCloseTo(18, 2);
  });

  it('handles Haiku pricing', () => {
    const price = getPrice('claude-haiku-4-5');
    const { total } = computeCostUsd({
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      thinkingTokens: 0,
      price,
    });
    // input: 0.8, output: 4
    expect(total).toBeCloseTo(4.8, 2);
  });

  it('computes cost for suffixed model strings', () => {
    const price = getPrice('claude-opus-4-6-20260201');
    const { total } = computeCostUsd({
      inputTokens: 1_000_000,
      outputTokens: 100_000,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      thinkingTokens: 0,
      price,
    });
    expect(total).toBeCloseTo(22.5, 2);
  });
});

// ── getPrice (core) ──────────────────────────────────────────────────

describe('getPrice (core)', () => {
  it('has pricing for all Claude models', () => {
    expect(getPrice('claude-opus-4-6')).toBeDefined();
    expect(getPrice('claude-sonnet-4-5')).toBeDefined();
    expect(getPrice('claude-haiku-4-5')).toBeDefined();
  });

  it('cached rate is cheaper than input rate', () => {
    for (const p of DEFAULT_PRICES.filter((p) => p.vendor === 'anthropic')) {
      expect(p.cachedInputPer1M).toBeLessThan(p.inputPer1M);
    }
  });

  it('resolves dated model variants via prefix match', () => {
    const price = getPrice('claude-opus-4-6-20260201');
    const base = getPrice('claude-opus-4-6');
    expect(price.inputPer1M).toBe(base.inputPer1M);
  });

  it('returns fallback price for unknown models (not undefined)', () => {
    const price = getPrice('gpt-4');
    // Core returns a FALLBACK_PRICE for unknown models
    expect(price).toBeDefined();
    expect(price.inputPer1M).toBeGreaterThanOrEqual(0);
  });
});

// ── classifyPrompt ───────────────────────────────────────────────────

describe('classifyPrompt', () => {
  it('classifies feature prompts', () => {
    expect(classifyPrompt('add a dark mode toggle')).toBe('feature');
    expect(classifyPrompt('create a new component')).toBe('feature');
    expect(classifyPrompt('implement the auth system')).toBe('feature');
  });

  it('classifies bugfix prompts', () => {
    expect(classifyPrompt('fix the login bug')).toBe('bugfix');
    expect(classifyPrompt('the button is broken')).toBe('bugfix');
    expect(classifyPrompt('error when clicking submit')).toBe('bugfix');
  });

  it('classifies refactor prompts', () => {
    expect(classifyPrompt('refactor the auth module')).toBe('refactor');
    expect(classifyPrompt('rename getUserData to fetchUser')).toBe('refactor');
  });

  it('classifies test prompts', () => {
    expect(classifyPrompt('run the unit test suite')).toBe('test');
    expect(classifyPrompt('write a spec for the component')).toBe('test');
  });

  it('classifies docs prompts', () => {
    expect(classifyPrompt('document the API endpoints')).toBe('docs');
    expect(classifyPrompt('update the readme')).toBe('docs');
  });

  it('classifies debug prompts', () => {
    expect(classifyPrompt('debug why the page is slow')).toBe('debug');
    expect(classifyPrompt('investigate the memory leak')).toBe('debug');
  });

  it('classifies review prompts', () => {
    expect(classifyPrompt('review the PR changes')).toBe('review');
  });

  it('classifies config prompts', () => {
    expect(classifyPrompt('setup the CI pipeline')).toBe('config');
    expect(classifyPrompt('update the deploy config')).toBe('config');
  });

  it('returns other for unrecognized prompts', () => {
    expect(classifyPrompt('make it black')).toBe('other');
    expect(classifyPrompt('hello world')).toBe('other');
  });
});

// ── computeComplexity ────────────────────────────────────────────────

describe('computeComplexity', () => {
  it('returns 0 for empty prompt with no tokens or tools', () => {
    expect(computeComplexity('', 0, 0)).toBe(0);
  });

  it('increases score with longer text', () => {
    const short = computeComplexity('do it', 0, 0);
    const long = computeComplexity(
      'please refactor the entire authentication module to use JWT tokens and add refresh token rotation with a sliding window expiry',
      0,
      0,
    );
    expect(long).toBeGreaterThan(short);
  });

  it('increases score with technical terms', () => {
    const simple = computeComplexity('make it work', 0, 0);
    const technical = computeComplexity(
      'refactor the function class interface module component',
      0,
      0,
    );
    expect(technical).toBeGreaterThan(simple);
  });

  it('increases score with output tokens', () => {
    const low = computeComplexity('do something', 100, 0);
    const high = computeComplexity('do something', 5000, 0);
    expect(high).toBeGreaterThan(low);
  });

  it('increases score with tool count', () => {
    const noTools = computeComplexity('do something', 0, 0);
    const manyTools = computeComplexity('do something', 0, 5);
    expect(manyTools).toBeGreaterThan(noTools);
  });

  it('caps at 100', () => {
    const max = computeComplexity(
      'implement a complex function with class interface type module component endpoint and more words to fill the prompt with technical jargon and dotted.paths and `code blocks`',
      50000,
      20,
    );
    expect(max).toBeLessThanOrEqual(100);
  });

  it('returns at least 0', () => {
    expect(computeComplexity('', 0, 0)).toBeGreaterThanOrEqual(0);
  });
});

// ── computeCacheRate ─────────────────────────────────────────────────

describe('computeCacheRate', () => {
  it('returns 0 when both are 0', () => {
    expect(computeCacheRate(0, 0)).toBe(0);
  });

  it('returns 0 when no cache reads', () => {
    expect(computeCacheRate(1000, 0)).toBe(0);
  });

  it('returns 50% when equal', () => {
    expect(computeCacheRate(500, 500)).toBeCloseTo(50, 1);
  });

  it('returns 100% when all cached', () => {
    expect(computeCacheRate(0, 1000)).toBeCloseTo(100, 1);
  });

  it('computes fractional rates', () => {
    // 200 cache out of 800+200=1000 total = 20%
    expect(computeCacheRate(800, 200)).toBeCloseTo(20, 1);
  });
});
