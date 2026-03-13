// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bernhard

import { describe, it, expect } from 'vitest';
import { DEFAULT_PRICES, FALLBACK_PRICE, PRICING_VERSION } from '../pricing.js';
import { computeCostUsd, getPrice } from '../pricing.js';

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
      inputTokens: 10_000,
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
    expect(result.input).toBe(3);
    expect(result.total).toBe(3);
  });
});
