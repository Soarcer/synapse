// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Synapse Contributors

import type { StructuredThinking } from '@synapse-ai/core';

/**
 * Heuristic extraction of structured sections from raw thinking text.
 * Best-effort — returns null for any section it can't extract.
 */
export function parseThinking(text: string | null): StructuredThinking | null {
  if (!text || text.trim().length === 0) return null;

  return {
    intent: extractIntent(text),
    planSteps: extractPlanSteps(text),
    decision: extractDecision(text),
    confidence: extractConfidence(text),
  };
}

// ─── Intent ──────────────────────────────────────────────────────

const INTENT_PATTERNS = [
  /^(I need to .+?)(?:\.|$)/m,
  /^(The user wants? .+?)(?:\.|$)/m,
  /^(The task is .+?)(?:\.|$)/m,
  /^(I should .+?)(?:\.|$)/m,
  /^(Let me .+?)(?:\.|$)/m,
];

function extractIntent(text: string): string | null {
  for (const pattern of INTENT_PATTERNS) {
    const match = text.match(pattern);
    if (match) return match[1].trim();
  }
  // Fallback: first sentence
  const firstSentence = text.match(/^(.+?[.!?])\s/);
  if (firstSentence) return firstSentence[1].trim();
  // Ultra-fallback: first line
  const firstLine = text.split('\n')[0].trim();
  return firstLine.length > 0 ? firstLine : null;
}

// ─── Plan steps ──────────────────────────────────────────────────

function extractPlanSteps(text: string): Array<{ text: string; done: boolean }> {
  const steps: Array<{ text: string; done: boolean }> = [];

  // Numbered lists: "1. Do something", "2. Do another thing"
  const numberedPattern = /^\s*(\d+)[.)]\s+(.+)/gm;
  let match;
  while ((match = numberedPattern.exec(text)) !== null) {
    steps.push({ text: match[2].trim(), done: false });
  }
  if (steps.length > 0) return steps;

  // Bullet lists after plan/steps keywords
  const planSection = text.match(
    /(?:plan|steps|approach|strategy)[:\s]*\n((?:\s*[-*•]\s+.+\n?)+)/i,
  );
  if (planSection) {
    const bulletPattern = /^\s*[-*•]\s+(.+)/gm;
    while ((match = bulletPattern.exec(planSection[1])) !== null) {
      steps.push({ text: match[1].trim(), done: false });
    }
  }

  // Checkbox patterns: "- [ ] task" or "- [x] task"
  const checkboxPattern = /^\s*-\s+\[([ xX])\]\s+(.+)/gm;
  while ((match = checkboxPattern.exec(text)) !== null) {
    steps.push({
      text: match[2].trim(),
      done: match[1].toLowerCase() === 'x',
    });
  }

  return steps;
}

// ─── Decision ────────────────────────────────────────────────────

const DECISION_PATTERNS = [
  /(?:^|[.,]\s+)(I'll (?:use|start with|go with|try|apply|create|implement) .+?)(?:\.|$)/m,
  /(?:^|[.,]\s+)(The best approach (?:is|would be) .+?)(?:\.|$)/m,
  /(?:^|[.,]\s+)(I (?:should|will) .+?)(?:\.|$)/m,
  /(?:^|[.,]\s+)(Let me .+?)(?:\.|$)/m,
];

function extractDecision(text: string): string | null {
  // Search from the end of the text (decisions tend to come last)
  const sentences = text.split(/(?<=[.!?])\s+/);
  for (let i = sentences.length - 1; i >= 0; i--) {
    for (const pattern of DECISION_PATTERNS) {
      const match = sentences[i].match(pattern);
      if (match) return match[1].trim();
    }
  }
  return null;
}

// ─── Confidence ──────────────────────────────────────────────────

const HIGH_CONFIDENCE = [
  /\bconfident\b/i,
  /\bclearly\b/i,
  /\bdefinitely\b/i,
  /\bcertain\b/i,
  /\bthis is the (?:issue|bug|problem|fix)\b/i,
  /\bno doubt\b/i,
  /\bobviously\b/i,
];

const MEDIUM_CONFIDENCE = [
  /\bprobably\b/i,
  /\blikely\b/i,
  /\bI think\b/i,
  /\bshould work\b/i,
  /\bseems like\b/i,
  /\bappears to\b/i,
];

const LOW_CONFIDENCE = [
  /\bnot sure\b/i,
  /\bunsure\b/i,
  /\bmight\b/i,
  /\blet me try\b/i,
  /\bguessing\b/i,
  /\bperhaps\b/i,
  /\bnot certain\b/i,
  /\bcould be\b/i,
];

function extractConfidence(text: string): number | null {
  let highCount = 0;
  let medCount = 0;
  let lowCount = 0;

  for (const p of HIGH_CONFIDENCE) {
    if (p.test(text)) highCount++;
  }
  for (const p of MEDIUM_CONFIDENCE) {
    if (p.test(text)) medCount++;
  }
  for (const p of LOW_CONFIDENCE) {
    if (p.test(text)) lowCount++;
  }

  const total = highCount + medCount + lowCount;
  if (total === 0) return null;

  if (highCount > 0 && highCount >= medCount && highCount >= lowCount) {
    return 0.8 + (highCount / (total + 2)) * 0.2; // 0.80–1.0
  }
  if (lowCount > 0 && lowCount >= highCount && lowCount >= medCount) {
    return 0.1 + (medCount / (total + 2)) * 0.3; // 0.10–0.40
  }
  return 0.5 + (highCount / (total + 2)) * 0.3; // 0.50–0.80
}
