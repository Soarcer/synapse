import { describe, it, expect, beforeEach } from 'vitest';
import {
  getPrice,
  computeCostUsd,
  getAllPrices,
  addUserPrice,
  clearUserPrices,
  type PricePoint,
} from '../services/costService.js';

describe('costService', () => {
  beforeEach(() => {
    clearUserPrices();
  });

  describe('getPrice', () => {
    it('returns exact match for known models', () => {
      const price = getPrice('claude-opus-4-6');
      expect(price.model).toBe('claude-opus-4-6');
      expect(price.vendor).toBe('anthropic');
      expect(price.inputPer1M).toBe(15);
      expect(price.outputPer1M).toBe(75);
      expect(price.cachedInputPer1M).toBe(1.5);
    });

    it('returns exact match for OpenAI models', () => {
      const price = getPrice('gpt-4o');
      expect(price.vendor).toBe('openai');
      expect(price.inputPer1M).toBe(2.5);
      expect(price.outputPer1M).toBe(10);
    });

    it('returns exact match for Google models', () => {
      const price = getPrice('gemini-2.5-pro');
      expect(price.vendor).toBe('google');
      expect(price.inputPer1M).toBe(1.25);
    });

    it('handles case-insensitive lookup', () => {
      const price = getPrice('Claude-Opus-4-6');
      expect(price.inputPer1M).toBe(15);
    });

    it('returns fallback for unknown models', () => {
      const price = getPrice('unknown-model-xyz');
      expect(price.model).toBe('unknown-model-xyz');
      expect(price.vendor).toBe('unknown');
      expect(price.inputPer1M).toBe(3); // fallback
    });

    it('infers vendor for unknown models', () => {
      const price = getPrice('claude-future-model');
      expect(price.vendor).toBe('anthropic');
    });

    it('matches prefix for dated model IDs', () => {
      const price = getPrice('claude-sonnet-4-5-20250929');
      expect(price.inputPer1M).toBe(3);
      expect(price.outputPer1M).toBe(15);
    });

    it('prefers user overrides over defaults', () => {
      addUserPrice({
        model: 'claude-opus-4-6',
        vendor: 'anthropic',
        effectiveFrom: 0,
        inputPer1M: 20,
        cachedInputPer1M: 2,
        outputPer1M: 100,
      });

      const price = getPrice('claude-opus-4-6');
      expect(price.inputPer1M).toBe(20);
      expect(price.outputPer1M).toBe(100);
    });
  });

  describe('computeCostUsd', () => {
    it('computes cost for opus with no cache', () => {
      // 1000 input tokens @ $15/1M + 500 output tokens @ $75/1M
      const cost = computeCostUsd('claude-opus-4-6', 1000, 500, 0);
      expect(cost).toBeCloseTo(0.0525, 4);
      // 1000 * 15/1M = 0.015 + 500 * 75/1M = 0.0375 = 0.0525
    });

    it('computes cost with cache reads', () => {
      // 1000 input, 500 output, 800 cache read
      // Fresh input = 1000 - 800 = 200
      // Cost = 200 * 15/1M + 800 * 1.5/1M + 500 * 75/1M
      const cost = computeCostUsd('claude-opus-4-6', 1000, 500, 800);
      // = 0.003 + 0.0012 + 0.0375 = 0.0417
      expect(cost).toBeCloseTo(0.0417, 4);
    });

    it('handles zero tokens', () => {
      expect(computeCostUsd('claude-opus-4-6', 0, 0, 0)).toBe(0);
    });

    it('clamps fresh input to 0 when cache exceeds input', () => {
      // If cacheRead > inputTokens, freshInput = max(0, -N) = 0
      const cost = computeCostUsd('claude-opus-4-6', 100, 100, 200);
      // Fresh = 0, cache = 200 * 1.5/1M = 0.0003, output = 100 * 75/1M = 0.0075
      expect(cost).toBeCloseTo(0.0078, 4);
    });

    it('uses fallback pricing for unknown models', () => {
      const cost = computeCostUsd('unknown-model', 1000, 500, 0);
      // Fallback: $3/1M input, $15/1M output
      // 1000 * 3/1M + 500 * 15/1M = 0.003 + 0.0075 = 0.0105
      expect(cost).toBeCloseTo(0.0105, 4);
    });

    it('computes sonnet pricing correctly', () => {
      const cost = computeCostUsd('claude-sonnet-4-5', 10000, 5000, 5000);
      // Fresh = 5000 * 3/1M = 0.015, cache = 5000 * 0.3/1M = 0.0015, output = 5000 * 15/1M = 0.075
      expect(cost).toBeCloseTo(0.0915, 4);
    });
  });

  describe('getAllPrices', () => {
    it('includes default prices', () => {
      const prices = getAllPrices();
      expect(prices.length).toBeGreaterThan(10);

      const opusPrice = prices.find((p) => p.model === 'claude-opus-4-6');
      expect(opusPrice).toBeDefined();
      expect(opusPrice!.inputPer1M).toBe(15);
    });

    it('includes user prices after adding them', () => {
      const customPrice: PricePoint = {
        model: 'custom-model',
        vendor: 'custom',
        effectiveFrom: 0,
        inputPer1M: 1,
        cachedInputPer1M: 0.1,
        outputPer1M: 5,
      };
      addUserPrice(customPrice);

      const prices = getAllPrices();
      const found = prices.find((p) => p.model === 'custom-model');
      expect(found).toBeDefined();
      expect(found!.inputPer1M).toBe(1);
    });
  });

  describe('clearUserPrices', () => {
    it('removes all user overrides', () => {
      addUserPrice({
        model: 'test-model',
        vendor: 'test',
        effectiveFrom: 0,
        inputPer1M: 99,
        cachedInputPer1M: 9.9,
        outputPer1M: 999,
      });

      clearUserPrices();

      const price = getPrice('test-model');
      // Should fall back to default/fallback, not user price
      expect(price.inputPer1M).not.toBe(99);
    });
  });
});
