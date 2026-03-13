// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bernhard

// ─── Cost Computation Service ────────────────────────────────────────
// Thin wrapper around @synapse-ai/core pricing module.
// Provides user price override management and backwards-compatible API.

import {
  type PricePoint,
  type CostBreakdown,
  DEFAULT_PRICES,
  getPrice as coreGetPrice,
  computeCostUsd as coreComputeCost,
} from '@synapse-ai/core';

export type { PricePoint, CostBreakdown };

// User-defined price overrides (loaded from DB at init)
let userPrices: PricePoint[] = [];

// ─── Public API ──────────────────────────────────────────────────────

/**
 * Look up pricing for a model at a given point in time.
 * Priority: user overrides > default prices > fallback.
 */
export function getPrice(model: string, timestamp?: number): PricePoint {
  // Guard old user overrides that may lack cacheCreationPer1M
  const pricedOverrides = userPrices.map((p) => ({
    ...p,
    cacheCreationPer1M: p.cacheCreationPer1M ?? 0,
  }));
  return coreGetPrice(model, pricedOverrides, timestamp);
}

/**
 * Compute cost breakdown in USD for a single API call.
 *
 * IMPORTANT: `inputTokens` must be fresh-only (excludes cache reads).
 * The old costService subtracted cacheRead internally — that subtraction
 * is now the caller's responsibility (or handled at parse time).
 */
export function computeCostUsd(
  model: string,
  inputTokens: number,
  outputTokens: number,
  cacheReadTokens: number,
  cacheCreationTokens?: number,
  thinkingTokens?: number,
  timestamp?: number,
): CostBreakdown {
  const price = getPrice(model, timestamp);
  return coreComputeCost({
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheCreationTokens: cacheCreationTokens ?? 0,
    thinkingTokens: thinkingTokens ?? 0,
    price,
  });
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
