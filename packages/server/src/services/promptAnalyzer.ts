// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bernhard

// ─── Prompt Analyzer ────────────────────────────────────────────────
// Analyzes prompts for complexity, categorization, and optimization opportunities.

import { analyticsQueryAll } from '../db.js';
import { computeCostUsd } from './costService.js';

export interface PromptAnalysis {
  sessionId: string;
  turnIndex: number;
  timestamp: number;
  promptText: string;
  complexityScore: number; // 0-100
  category: PromptCategory;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  toolCount: number;
  model: string;
}

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

export interface PromptInsight {
  type: 'optimization' | 'pattern' | 'warning';
  message: string;
  impact: 'high' | 'medium' | 'low';
  relatedPrompts: number[]; // indices into PromptAnalysis[]
}

// ─── Category Detection ─────────────────────────────────────────────

const CATEGORY_PATTERNS: [PromptCategory, RegExp[]][] = [
  ['feature', [/\b(add|create|implement|build|new feature|introduce)\b/i]],
  ['bugfix', [/\b(fix|bug|broken|issue|error|crash|failing|not working)\b/i]],
  ['refactor', [/\b(refactor|rename|restructure|clean up|simplify|move|extract)\b/i]],
  ['test', [/\b(test|spec|coverage|assert|mock|stub|unit test|e2e)\b/i]],
  ['docs', [/\b(document|readme|comment|jsdoc|docs|explain|describe)\b/i]],
  ['debug', [/\b(debug|log|trace|inspect|investigate|why|what happened)\b/i]],
  ['review', [/\b(review|check|audit|look at|examine|verify|validate)\b/i]],
  ['config', [/\b(config|setup|install|deploy|ci|cd|pipeline|environment)\b/i]],
];

function classifyPrompt(text: string): PromptCategory {
  for (const [category, patterns] of CATEGORY_PATTERNS) {
    for (const pattern of patterns) {
      if (pattern.test(text)) return category;
    }
  }
  return 'other';
}

// ─── Complexity Scoring ─────────────────────────────────────────────

function computeComplexity(text: string, outputTokens: number, toolCount: number): number {
  let score = 0;

  // Length factor (0-25): longer prompts tend to be more complex
  const words = text.split(/\s+/).length;
  score += Math.min(25, Math.round(words / 4));

  // Specificity factor (0-25): technical terms, file paths, code references
  const technicalPatterns = [
    /\b(function|class|interface|type|module|component|endpoint)\b/gi,
    /[a-zA-Z]+\.[a-zA-Z]+/g, // file references like "foo.ts"
    /`[^`]+`/g, // inline code
    /\b(async|await|promise|callback|stream|buffer)\b/gi,
  ];
  let technicalMatches = 0;
  for (const pattern of technicalPatterns) {
    const matches = text.match(pattern);
    technicalMatches += matches ? matches.length : 0;
  }
  score += Math.min(25, technicalMatches * 3);

  // Output factor (0-25): more output tokens = more complex response needed
  score += Math.min(25, Math.round(outputTokens / 200));

  // Tool factor (0-25): more tool calls = more complex task
  score += Math.min(25, toolCount * 5);

  return Math.min(100, Math.max(0, score));
}

// ─── Analyze Session Prompts ────────────────────────────────────────

export function analyzeSessionPrompts(sessionId: string): PromptAnalysis[] {
  const rows = analyticsQueryAll(
    `
    SELECT event_type, token_input, token_output, tool_name, model, created_at, raw_payload
    FROM events
    WHERE session_id = ?
    ORDER BY created_at ASC
  `,
    [sessionId],
  ) as Array<Record<string, unknown>>;

  const analyses: PromptAnalysis[] = [];
  let turnIndex = 0;
  let currentPrompt: { text: string; timestamp: number; model: string } | null = null;
  let turnTokenInput = 0;
  let turnTokenOutput = 0;
  let turnToolCount = 0;

  for (const row of rows) {
    const eventType = row.event_type as string;

    if (eventType === 'user_prompt') {
      // Flush previous turn
      if (currentPrompt) {
        const cacheRead = Math.round(turnTokenInput * 0.5);
        analyses.push({
          sessionId,
          turnIndex: turnIndex++,
          timestamp: currentPrompt.timestamp,
          promptText: currentPrompt.text,
          complexityScore: computeComplexity(currentPrompt.text, turnTokenOutput, turnToolCount),
          category: classifyPrompt(currentPrompt.text),
          inputTokens: turnTokenInput,
          outputTokens: turnTokenOutput,
          costUsd: computeCostUsd(
            currentPrompt.model,
            turnTokenInput,
            turnTokenOutput,
            cacheRead,
            currentPrompt.timestamp,
          ),
          toolCount: turnToolCount,
          model: currentPrompt.model,
        });
      }

      // Start new turn
      let promptText = '';
      try {
        const raw = JSON.parse((row.raw_payload as string) || '{}');
        promptText = raw.prompt || raw.message || '';
      } catch {
        /* ignore */
      }

      currentPrompt = {
        text: promptText,
        timestamp: Number(row.created_at),
        model: (row.model as string) || 'claude-sonnet-4-5',
      };
      turnTokenInput = 0;
      turnTokenOutput = 0;
      turnToolCount = 0;
      continue;
    }

    turnTokenInput += Number(row.token_input ?? 0);
    turnTokenOutput += Number(row.token_output ?? 0);
    if (eventType === 'tool_start' || eventType === 'tool_end' || eventType === 'tool_error') {
      turnToolCount++;
    }
  }

  // Flush last turn
  if (currentPrompt) {
    const cacheRead = Math.round(turnTokenInput * 0.5);
    analyses.push({
      sessionId,
      turnIndex: turnIndex,
      timestamp: currentPrompt.timestamp,
      promptText: currentPrompt.text,
      complexityScore: computeComplexity(currentPrompt.text, turnTokenOutput, turnToolCount),
      category: classifyPrompt(currentPrompt.text),
      inputTokens: turnTokenInput,
      outputTokens: turnTokenOutput,
      costUsd: computeCostUsd(
        currentPrompt.model,
        turnTokenInput,
        turnTokenOutput,
        cacheRead,
        currentPrompt.timestamp,
      ),
      toolCount: turnToolCount,
      model: currentPrompt.model,
    });
  }

  return analyses;
}

// ─── Generate Insights ──────────────────────────────────────────────

export function generatePromptInsights(analyses: PromptAnalysis[]): PromptInsight[] {
  const insights: PromptInsight[] = [];

  if (analyses.length === 0) return insights;

  // Find expensive prompts
  const avgCost = analyses.reduce((s, a) => s + a.costUsd, 0) / analyses.length;
  const expensive = analyses.filter((a) => a.costUsd > avgCost * 2);
  if (expensive.length > 0) {
    insights.push({
      type: 'optimization',
      message: `${expensive.length} prompt(s) cost more than 2x the average ($${avgCost.toFixed(4)}). Consider breaking complex tasks into smaller steps.`,
      impact: 'high',
      relatedPrompts: expensive.map((a) => a.turnIndex),
    });
  }

  // Find high-complexity low-tool prompts (might benefit from more tool usage)
  const complexNoTools = analyses.filter((a) => a.complexityScore > 60 && a.toolCount === 0);
  if (complexNoTools.length > 0) {
    insights.push({
      type: 'pattern',
      message: `${complexNoTools.length} complex prompt(s) used no tools. Tool use often reduces token costs for complex tasks.`,
      impact: 'medium',
      relatedPrompts: complexNoTools.map((a) => a.turnIndex),
    });
  }

  // Category distribution insight
  const categoryCount = new Map<PromptCategory, number>();
  for (const a of analyses) {
    categoryCount.set(a.category, (categoryCount.get(a.category) ?? 0) + 1);
  }
  const topCategory = [...categoryCount.entries()].sort((a, b) => b[1] - a[1])[0];
  if (topCategory && topCategory[1] > analyses.length * 0.5) {
    insights.push({
      type: 'pattern',
      message: `${Math.round((topCategory[1] / analyses.length) * 100)}% of prompts are "${topCategory[0]}" tasks. Consider batch processing similar requests.`,
      impact: 'low',
      relatedPrompts: analyses.filter((a) => a.category === topCategory[0]).map((a) => a.turnIndex),
    });
  }

  // Vague prompts (low complexity but high cost)
  const vague = analyses.filter((a) => a.complexityScore < 20 && a.costUsd > avgCost);
  if (vague.length > 0) {
    insights.push({
      type: 'warning',
      message: `${vague.length} simple prompt(s) had above-average cost. More specific prompts can reduce unnecessary output tokens.`,
      impact: 'medium',
      relatedPrompts: vague.map((a) => a.turnIndex),
    });
  }

  return insights;
}

// ─── Analyze Time Range ─────────────────────────────────────────────

export function analyzePromptsInRange(
  from: number,
  to: number,
  cwd?: string,
): {
  analyses: PromptAnalysis[];
  insights: PromptInsight[];
  categoryBreakdown: Record<PromptCategory, number>;
  avgComplexity: number;
} {
  // Get all sessions in range
  const conditions: string[] = ['created_at >= ? AND created_at <= ?'];
  const params: unknown[] = [from, to];
  if (cwd) {
    conditions.push('cwd = ?');
    params.push(cwd);
  }

  const sessions = analyticsQueryAll(
    `
    SELECT DISTINCT session_id FROM events WHERE ${conditions.join(' AND ')}
  `,
    params,
  ) as Array<{ session_id: string }>;

  const allAnalyses: PromptAnalysis[] = [];
  for (const s of sessions) {
    allAnalyses.push(...analyzeSessionPrompts(s.session_id));
  }

  const insights = generatePromptInsights(allAnalyses);

  const categoryBreakdown: Record<PromptCategory, number> = {
    feature: 0,
    bugfix: 0,
    refactor: 0,
    test: 0,
    docs: 0,
    debug: 0,
    review: 0,
    config: 0,
    other: 0,
  };
  for (const a of allAnalyses) {
    categoryBreakdown[a.category]++;
  }

  const avgComplexity =
    allAnalyses.length > 0
      ? Math.round(allAnalyses.reduce((s, a) => s + a.complexityScore, 0) / allAnalyses.length)
      : 0;

  return { analyses: allAnalyses, insights, categoryBreakdown, avgComplexity };
}
