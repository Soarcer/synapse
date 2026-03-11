// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bernhard

import { describe, it, expect } from 'vitest';
import {
  computeCostUsd,
  classifyPrompt,
  computeComplexity,
  computeCacheRate,
  resolveModelPricing,
  MODEL_PRICING,
} from '../promptUtils';

describe('computeCostUsd', () => {
  it('computes cost for Opus model', () => {
    const cost = computeCostUsd(1_000_000, 100_000, 0, 'claude-opus-4-6');
    // input: 1M * 15/1M = 15, output: 100k * 75/1M = 7.5
    expect(cost).toBeCloseTo(22.5, 2);
  });

  it('includes cached token cost at discounted rate', () => {
    const cost = computeCostUsd(500_000, 100_000, 200_000, 'claude-opus-4-6');
    // input: 500k * 15/1M = 7.5, output: 100k * 75/1M = 7.5, cache: 200k * 1.5/1M = 0.3
    expect(cost).toBeCloseTo(15.3, 2);
  });

  it('returns 0 for unknown model', () => {
    expect(computeCostUsd(1000, 1000, 0, 'gpt-4')).toBe(0);
  });

  it('returns 0 for zero tokens', () => {
    expect(computeCostUsd(0, 0, 0, 'claude-opus-4-6')).toBe(0);
  });

  it('handles Sonnet pricing', () => {
    const cost = computeCostUsd(1_000_000, 1_000_000, 0, 'claude-sonnet-4-5');
    // input: 3, output: 15
    expect(cost).toBeCloseTo(18, 2);
  });

  it('handles Haiku pricing', () => {
    const cost = computeCostUsd(1_000_000, 1_000_000, 0, 'claude-haiku-4-5');
    // input: 0.8, output: 4
    expect(cost).toBeCloseTo(4.8, 2);
  });
});

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

describe('MODEL_PRICING', () => {
  it('has pricing for all Claude models', () => {
    expect(MODEL_PRICING['claude-opus-4-6']).toBeDefined();
    expect(MODEL_PRICING['claude-sonnet-4-5']).toBeDefined();
    expect(MODEL_PRICING['claude-haiku-4-5']).toBeDefined();
  });

  it('cached rate is cheaper than input rate', () => {
    for (const [, pricing] of Object.entries(MODEL_PRICING)) {
      expect(pricing.cachedPer1M).toBeLessThan(pricing.inputPer1M);
    }
  });
});

describe('resolveModelPricing', () => {
  it('resolves exact model names', () => {
    expect(resolveModelPricing('claude-opus-4-6')).toBe(MODEL_PRICING['claude-opus-4-6']);
    expect(resolveModelPricing('claude-sonnet-4-5')).toBe(MODEL_PRICING['claude-sonnet-4-5']);
  });

  it('resolves dated model variants via prefix match', () => {
    expect(resolveModelPricing('claude-opus-4-6-20260201')).toBe(MODEL_PRICING['claude-opus-4-6']);
  });

  it('prefers the longest matching prefix', () => {
    // "claude-sonnet-4-5-20250929" should match the dated key exactly, not the short one
    expect(resolveModelPricing('claude-sonnet-4-5-20250929')).toBe(
      MODEL_PRICING['claude-sonnet-4-5-20250929'],
    );
  });

  it('returns undefined for unknown models', () => {
    expect(resolveModelPricing('gpt-4')).toBeUndefined();
    expect(resolveModelPricing('unknown')).toBeUndefined();
  });

  it('enables computeCostUsd for suffixed model strings', () => {
    const cost = computeCostUsd(1_000_000, 100_000, 0, 'claude-opus-4-6-20260201');
    expect(cost).toBeCloseTo(22.5, 2);
  });
});
