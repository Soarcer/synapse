// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bernhard

// ─── Cost Computation Service ────────────────────────────────────────
// Provides model pricing lookup and cost computation for analytics.
// Supports time-based pricing for historical accuracy and user-defined overrides.

import { logger } from '../lib/logger.js';

export interface PricePoint {
  model: string;
  vendor: string;
  effectiveFrom: number; // Unix ms
  inputPer1M: number; // USD per 1M input tokens
  cachedInputPer1M: number; // USD per 1M cached input tokens
  outputPer1M: number; // USD per 1M output tokens
}

// ─── Default Pricing (Feb 2026) ──────────────────────────────────────

const DEFAULT_PRICES: PricePoint[] = [
  // Anthropic
  {
    model: 'claude-opus-4-6',
    vendor: 'anthropic',
    effectiveFrom: 0,
    inputPer1M: 15,
    cachedInputPer1M: 1.5,
    outputPer1M: 75,
  },
  {
    model: 'claude-opus-4-20250514',
    vendor: 'anthropic',
    effectiveFrom: 0,
    inputPer1M: 15,
    cachedInputPer1M: 1.5,
    outputPer1M: 75,
  },
  {
    model: 'claude-sonnet-4-5-20250929',
    vendor: 'anthropic',
    effectiveFrom: 0,
    inputPer1M: 3,
    cachedInputPer1M: 0.3,
    outputPer1M: 15,
  },
  {
    model: 'claude-sonnet-4-5',
    vendor: 'anthropic',
    effectiveFrom: 0,
    inputPer1M: 3,
    cachedInputPer1M: 0.3,
    outputPer1M: 15,
  },
  {
    model: 'claude-sonnet-4-20250514',
    vendor: 'anthropic',
    effectiveFrom: 0,
    inputPer1M: 3,
    cachedInputPer1M: 0.3,
    outputPer1M: 15,
  },
  {
    model: 'claude-haiku-4-5-20251001',
    vendor: 'anthropic',
    effectiveFrom: 0,
    inputPer1M: 0.8,
    cachedInputPer1M: 0.08,
    outputPer1M: 4,
  },
  {
    model: 'claude-haiku-4-5',
    vendor: 'anthropic',
    effectiveFrom: 0,
    inputPer1M: 0.8,
    cachedInputPer1M: 0.08,
    outputPer1M: 4,
  },
  {
    model: 'claude-haiku-3-5-20241022',
    vendor: 'anthropic',
    effectiveFrom: 0,
    inputPer1M: 0.8,
    cachedInputPer1M: 0.08,
    outputPer1M: 4,
  },

  // OpenAI
  {
    model: 'gpt-4o',
    vendor: 'openai',
    effectiveFrom: 0,
    inputPer1M: 2.5,
    cachedInputPer1M: 1.25,
    outputPer1M: 10,
  },
  {
    model: 'gpt-4o-mini',
    vendor: 'openai',
    effectiveFrom: 0,
    inputPer1M: 0.15,
    cachedInputPer1M: 0.075,
    outputPer1M: 0.6,
  },
  {
    model: 'o1',
    vendor: 'openai',
    effectiveFrom: 0,
    inputPer1M: 15,
    cachedInputPer1M: 7.5,
    outputPer1M: 60,
  },
  {
    model: 'o3-mini',
    vendor: 'openai',
    effectiveFrom: 0,
    inputPer1M: 1.1,
    cachedInputPer1M: 0.55,
    outputPer1M: 4.4,
  },

  // Google
  {
    model: 'gemini-2.5-pro',
    vendor: 'google',
    effectiveFrom: 0,
    inputPer1M: 1.25,
    cachedInputPer1M: 0.3125,
    outputPer1M: 10,
  },
  {
    model: 'gemini-2.5-flash',
    vendor: 'google',
    effectiveFrom: 0,
    inputPer1M: 0.15,
    cachedInputPer1M: 0.0375,
    outputPer1M: 0.6,
  },
];

const FALLBACK_PRICE: PricePoint = {
  model: '__default__',
  vendor: 'unknown',
  effectiveFrom: 0,
  inputPer1M: 3,
  cachedInputPer1M: 0.3,
  outputPer1M: 15,
};

// User-defined price overrides (loaded from DB at init)
let userPrices: PricePoint[] = [];

// ─── Public API ──────────────────────────────────────────────────────

/**
 * Look up pricing for a model at a given point in time.
 * Priority: user overrides > default prices > fallback.
 */
export function getPrice(model: string, timestamp?: number): PricePoint {
  const ts = timestamp ?? Date.now();

  // Normalize model name for fuzzy matching
  const normalized = model.toLowerCase();

  // Check user overrides first (most recent effective price before timestamp)
  const userMatch = findBestMatch(userPrices, normalized, ts);
  if (userMatch) return userMatch;

  // Check default prices
  const defaultMatch = findBestMatch(DEFAULT_PRICES, normalized, ts);
  if (defaultMatch) return defaultMatch;

  // Try prefix matching (e.g. "claude-sonnet-4-5-20250929" matches "claude-sonnet-4-5")
  const prefixMatch = findPrefixMatch(DEFAULT_PRICES, normalized);
  if (prefixMatch) return prefixMatch;

  logger.debug({ model }, 'No pricing found for model, using fallback');
  return { ...FALLBACK_PRICE, model, vendor: inferVendorFromModel(model) };
}

/**
 * Compute total cost in USD for a single API call.
 */
export function computeCostUsd(
  model: string,
  inputTokens: number,
  outputTokens: number,
  cacheReadTokens: number,
  timestamp?: number,
): number {
  const price = getPrice(model, timestamp);
  const freshInput = Math.max(0, inputTokens - cacheReadTokens);
  return (
    (freshInput / 1_000_000) * price.inputPer1M +
    (cacheReadTokens / 1_000_000) * price.cachedInputPer1M +
    (outputTokens / 1_000_000) * price.outputPer1M
  );
}

/**
 * Get all known prices (defaults + user overrides).
 */
export function getAllPrices(): PricePoint[] {
  return [...DEFAULT_PRICES, ...userPrices];
}

/**
 * Add/replace a user-defined price override.
 */
export function addUserPrice(price: PricePoint): void {
  userPrices.push(price);
  // Sort by effectiveFrom descending for efficient lookup
  userPrices.sort((a, b) => b.effectiveFrom - a.effectiveFrom);
}

/**
 * Load user prices from database rows.
 */
export function loadUserPrices(prices: PricePoint[]): void {
  userPrices = prices.sort((a, b) => b.effectiveFrom - a.effectiveFrom);
}

/**
 * Clear all user price overrides.
 */
export function clearUserPrices(): void {
  userPrices = [];
}

// ─── Internal Helpers ────────────────────────────────────────────────

function findBestMatch(
  prices: PricePoint[],
  normalizedModel: string,
  ts: number,
): PricePoint | undefined {
  return prices.find((p) => p.model.toLowerCase() === normalizedModel && p.effectiveFrom <= ts);
}

function findPrefixMatch(prices: PricePoint[], normalizedModel: string): PricePoint | undefined {
  // Try matching the model name as a prefix (handles dated model IDs)
  for (const p of prices) {
    const pNorm = p.model.toLowerCase();
    if (normalizedModel.startsWith(pNorm) || pNorm.startsWith(normalizedModel)) {
      return p;
    }
  }
  return undefined;
}

function inferVendorFromModel(model: string): string {
  const m = model.toLowerCase();
  if (m.includes('claude') || m.startsWith('anthropic/')) return 'anthropic';
  if (m.includes('gpt') || m.includes('o1') || m.includes('o3') || m.startsWith('openai/'))
    return 'openai';
  if (m.includes('gemini') || m.startsWith('google/')) return 'google';
  if (m.startsWith('groq/')) return 'groq';
  return 'unknown';
}
