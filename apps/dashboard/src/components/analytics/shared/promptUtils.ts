// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Synapse Contributors

// Shared prompt analysis utilities used by both PromptAnalyzer and AgentDetailPanel

// ── Pricing ──────────────────────────────────────────────────────────

export const MODEL_PRICING: Record<
  string,
  { inputPer1M: number; outputPer1M: number; cachedPer1M: number }
> = {
  'claude-opus-4-6': { inputPer1M: 15, outputPer1M: 75, cachedPer1M: 1.5 },
  'claude-sonnet-4-5': { inputPer1M: 3, outputPer1M: 15, cachedPer1M: 0.3 },
  'claude-sonnet-4-5-20250929': { inputPer1M: 3, outputPer1M: 15, cachedPer1M: 0.3 },
  'claude-haiku-4-5': { inputPer1M: 0.8, outputPer1M: 4, cachedPer1M: 0.08 },
  'claude-haiku-4-5-20251001': { inputPer1M: 0.8, outputPer1M: 4, cachedPer1M: 0.08 },
};

/**
 * Resolve pricing for a model string. Tries exact match first,
 * then prefix match (e.g. "claude-opus-4-6-20260101" → "claude-opus-4-6").
 */
export function resolveModelPricing(
  model: string,
): { inputPer1M: number; outputPer1M: number; cachedPer1M: number } | undefined {
  if (MODEL_PRICING[model]) return MODEL_PRICING[model];
  // Prefix match: find the longest key that is a prefix of the model string
  let best: string | undefined;
  for (const key of Object.keys(MODEL_PRICING)) {
    if (model.startsWith(key) && (!best || key.length > best.length)) {
      best = key;
    }
  }
  return best ? MODEL_PRICING[best] : undefined;
}

export function computeCostUsd(
  inputTokens: number,
  outputTokens: number,
  cacheReadTokens: number,
  model: string,
): number {
  const pricing = resolveModelPricing(model);
  if (!pricing) return 0;
  const inputCost = (inputTokens / 1_000_000) * pricing.inputPer1M;
  const outputCost = (outputTokens / 1_000_000) * pricing.outputPer1M;
  const cacheCost = (cacheReadTokens / 1_000_000) * pricing.cachedPer1M;
  return inputCost + outputCost + cacheCost;
}

// ── Category Classification ──────────────────────────────────────────

export type PromptCategory =
  | 'feature'
  | 'bugfix'
  | 'refactor'
  | 'test'
  | 'docs'
  | 'debug'
  | 'review'
  | 'config'
  | 'other';

const CATEGORY_PATTERNS: [PromptCategory, RegExp][] = [
  ['feature', /\b(add|create|implement|build|new feature|introduce)\b/i],
  ['bugfix', /\b(fix|bug|broken|issue|error|crash|failing|not working)\b/i],
  ['refactor', /\b(refactor|rename|restructure|clean up|simplify|move|extract)\b/i],
  ['test', /\b(test|spec|coverage|assert|mock|unit test|e2e)\b/i],
  ['docs', /\b(document|readme|comment|jsdoc|docs|explain)\b/i],
  ['debug', /\b(debug|log|trace|inspect|investigate|why)\b/i],
  ['review', /\b(review|check|audit|look at|examine)\b/i],
  ['config', /\b(config|setup|install|deploy|ci|pipeline)\b/i],
];

export function classifyPrompt(text: string): PromptCategory {
  for (const [cat, pattern] of CATEGORY_PATTERNS) {
    if (pattern.test(text)) return cat;
  }
  return 'other';
}

// ── Complexity Score ─────────────────────────────────────────────────

export function computeComplexity(text: string, outputTokens: number, toolCount: number): number {
  let score = 0;
  score += Math.min(25, text.split(/\s+/).length / 4);
  const techMatches =
    (text.match(/\b(function|class|interface|type|module|component|endpoint)\b/gi) || []).length +
    (text.match(/[a-zA-Z]+\.[a-zA-Z]+/g) || []).length +
    (text.match(/`[^`]+`/g) || []).length;
  score += Math.min(25, techMatches * 3);
  score += Math.min(25, outputTokens / 200);
  score += Math.min(25, toolCount * 5);
  return Math.min(100, Math.max(0, Math.round(score)));
}

// ── Cache Rate ───────────────────────────────────────────────────────

export function computeCacheRate(inputTokens: number, cacheReadTokens: number): number {
  const total = inputTokens + cacheReadTokens;
  return total > 0 ? (cacheReadTokens / total) * 100 : 0;
}
