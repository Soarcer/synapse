// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bernhard

import { inferVendor } from './utils/format.js';

// Increment this when DEFAULT_PRICES data changes so callers can detect stale overrides.
export const PRICING_VERSION = '2026-03-13';

/** Per-model pricing in USD per 1 million tokens. */
export interface PricePoint {
  model: string;
  vendor: string;
  inputPer1M: number;
  /** Price for tokens served from prompt cache (cache hit). */
  cachedInputPer1M: number;
  /**
   * Price to write tokens into the prompt cache (cache miss / cache population).
   * - Anthropic: 1.25× input rate (explicit write fee).
   * - OpenAI: 0 — caching is automatic, no write surcharge.
   * - Google: 0 — no creation fee for context caching.
   */
  cacheCreationPer1M: number;
  outputPer1M: number;
  /**
   * Unix timestamp in milliseconds from which this price is effective.
   * 0 = epoch (always valid). Used for time-based price lookup.
   */
  effectiveFrom: number;
}

/** Itemised cost breakdown for a single inference call, in USD. */
export interface CostBreakdown {
  /** Cost of non-cached input tokens. */
  input: number;
  /** Cost of cache-hit (cached read) tokens. */
  cached: number;
  /** Cost of cache-creation (cache write) tokens. */
  creation: number;
  /** Cost of output tokens (excluding thinking). */
  output: number;
  /** Cost of thinking/extended-thinking tokens (charged at output rate). */
  thinking: number;
  /** Sum of all above fields. */
  total: number;
}

// ---------------------------------------------------------------------------
// Pricing table — sourced from public provider pricing pages (2026-03-13).
// ---------------------------------------------------------------------------

export const DEFAULT_PRICES: PricePoint[] = [
  // --- Anthropic ---
  // Cache creation = 1.25× input (explicit write fee charged by Anthropic).
  {
    model: 'claude-opus-4-6',
    vendor: 'anthropic',
    inputPer1M: 15.0,
    cachedInputPer1M: 1.5,
    cacheCreationPer1M: 18.75, // 15 * 1.25
    outputPer1M: 75.0,
    effectiveFrom: 0,
  },
  {
    model: 'claude-opus-4-20250514',
    vendor: 'anthropic',
    inputPer1M: 15.0,
    cachedInputPer1M: 1.5,
    cacheCreationPer1M: 18.75,
    outputPer1M: 75.0,
    effectiveFrom: 0,
  },
  {
    model: 'claude-sonnet-4-5',
    vendor: 'anthropic',
    inputPer1M: 3.0,
    cachedInputPer1M: 0.3,
    cacheCreationPer1M: 3.75, // 3 * 1.25
    outputPer1M: 15.0,
    effectiveFrom: 0,
  },
  {
    model: 'claude-sonnet-4-5-20250929',
    vendor: 'anthropic',
    inputPer1M: 3.0,
    cachedInputPer1M: 0.3,
    cacheCreationPer1M: 3.75,
    outputPer1M: 15.0,
    effectiveFrom: 0,
  },
  {
    model: 'claude-sonnet-4-20250514',
    vendor: 'anthropic',
    inputPer1M: 3.0,
    cachedInputPer1M: 0.3,
    cacheCreationPer1M: 3.75,
    outputPer1M: 15.0,
    effectiveFrom: 0,
  },
  {
    model: 'claude-haiku-4-5',
    vendor: 'anthropic',
    inputPer1M: 0.8,
    cachedInputPer1M: 0.08,
    cacheCreationPer1M: 1.0, // 0.8 * 1.25
    outputPer1M: 4.0,
    effectiveFrom: 0,
  },
  {
    model: 'claude-haiku-4-5-20251001',
    vendor: 'anthropic',
    inputPer1M: 0.8,
    cachedInputPer1M: 0.08,
    cacheCreationPer1M: 1.0,
    outputPer1M: 4.0,
    effectiveFrom: 0,
  },
  {
    model: 'claude-haiku-3-5-20241022',
    vendor: 'anthropic',
    inputPer1M: 0.8,
    cachedInputPer1M: 0.08,
    cacheCreationPer1M: 1.0,
    outputPer1M: 4.0,
    effectiveFrom: 0,
  },

  // --- OpenAI ---
  // Cache creation = 0: OpenAI applies prompt caching automatically with no write surcharge.
  {
    model: 'gpt-4o',
    vendor: 'openai',
    inputPer1M: 2.5,
    cachedInputPer1M: 1.25,
    cacheCreationPer1M: 0, // automatic caching, no creation fee
    outputPer1M: 10.0,
    effectiveFrom: 0,
  },
  {
    model: 'gpt-4o-mini',
    vendor: 'openai',
    inputPer1M: 0.15,
    cachedInputPer1M: 0.075,
    cacheCreationPer1M: 0, // automatic caching, no creation fee
    outputPer1M: 0.6,
    effectiveFrom: 0,
  },
  {
    model: 'o1',
    vendor: 'openai',
    inputPer1M: 15.0,
    cachedInputPer1M: 7.5,
    cacheCreationPer1M: 0, // automatic caching, no creation fee
    outputPer1M: 60.0,
    effectiveFrom: 0,
  },
  {
    model: 'o3-mini',
    vendor: 'openai',
    inputPer1M: 1.1,
    cachedInputPer1M: 0.55,
    cacheCreationPer1M: 0, // automatic caching, no creation fee
    outputPer1M: 4.4,
    effectiveFrom: 0,
  },

  // --- Google ---
  // Cache creation = 0: Google charges only for cache storage time, not for writes.
  {
    model: 'gemini-2.5-pro',
    vendor: 'google',
    inputPer1M: 1.25,
    cachedInputPer1M: 0.3125,
    cacheCreationPer1M: 0, // no cache creation fee
    outputPer1M: 10.0,
    effectiveFrom: 0,
  },
  {
    model: 'gemini-2.5-flash',
    vendor: 'google',
    inputPer1M: 0.15,
    cachedInputPer1M: 0.0375,
    cacheCreationPer1M: 0, // no cache creation fee
    outputPer1M: 0.6,
    effectiveFrom: 0,
  },
];

/**
 * Used when a model is not found in DEFAULT_PRICES.
 * Approximates mid-tier Anthropic pricing so cost estimates are never zero.
 */
export const FALLBACK_PRICE: PricePoint = {
  model: '__default__',
  vendor: 'unknown',
  inputPer1M: 3,
  cachedInputPer1M: 0.3,
  cacheCreationPer1M: 3.75,
  outputPer1M: 15,
  effectiveFrom: 0,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Look up a PricePoint by model ID.
 *
 * Resolution order:
 * 1. User overrides — most recent entry with effectiveFrom <= timestamp
 * 2. Default prices — most recent entry with effectiveFrom <= timestamp (exact match)
 * 3. Prefix match — handles dated variants like `claude-sonnet-4-5-20260101`
 *    by checking whether any known model ID is a prefix of the requested ID.
 * 4. FALLBACK_PRICE with vendor inferred from the model string.
 */
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

  // Prefix match
  const prefixMatch = findPrefixMatch(DEFAULT_PRICES, normalized);
  if (prefixMatch) return prefixMatch;

  const vendor = inferVendor(model);
  return { ...FALLBACK_PRICE, model, vendor: vendor === 'custom' ? 'unknown' : vendor };
}

function findBestMatch(
  prices: PricePoint[],
  normalizedModel: string,
  ts: number,
): PricePoint | undefined {
  let best: PricePoint | undefined;
  for (const p of prices) {
    if (
      p.model.toLowerCase() === normalizedModel &&
      p.effectiveFrom <= ts &&
      (!best || p.effectiveFrom > best.effectiveFrom)
    ) {
      best = p;
    }
  }
  return best;
}

function findPrefixMatch(prices: PricePoint[], normalizedModel: string): PricePoint | undefined {
  let best: PricePoint | undefined;
  for (const p of prices) {
    const key = p.model.toLowerCase();
    if (!normalizedModel.startsWith(key)) continue;
    const suffix = normalizedModel.slice(key.length);
    // Require suffix to be empty, start with a digit, or start with '-' followed by a digit.
    // This prevents 'o1' from matching 'o1-preview' (suffix '-preview' fails) while
    // allowing 'claude-haiku-4-5' to match 'claude-haiku-4-5-20260601' (suffix '-2...' passes).
    if (suffix.length > 0 && !/^-?\d/.test(suffix)) continue;
    if (!best || key.length > best.model.length) best = p;
  }
  return best;
}

/** Input parameters for computeCostUsd. */
export interface ComputeCostParams {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  /** Extended-thinking tokens; charged at the output rate. */
  thinkingTokens: number;
  price: PricePoint;
}

/**
 * Compute a full cost breakdown for a single inference call.
 *
 * All token counts are raw token counts (not already divided by 1 million).
 * Returns USD amounts.
 */
export function computeCostUsd(params: ComputeCostParams): CostBreakdown {
  const { inputTokens, outputTokens, cacheReadTokens, cacheCreationTokens, thinkingTokens, price } =
    params;

  const M = 1_000_000;
  const input = (inputTokens / M) * price.inputPer1M;
  const cached = (cacheReadTokens / M) * price.cachedInputPer1M;
  const creation = (cacheCreationTokens / M) * price.cacheCreationPer1M;
  const output = (outputTokens / M) * price.outputPer1M;
  // Thinking tokens are billed at the output token rate.
  const thinking = (thinkingTokens / M) * price.outputPer1M;
  const total = input + cached + creation + output + thinking;

  return { input, cached, creation, output, thinking, total };
}
