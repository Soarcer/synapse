// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bernhard

// Shared prompt analysis utilities used by both PromptAnalyzer and AgentDetailPanel

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
