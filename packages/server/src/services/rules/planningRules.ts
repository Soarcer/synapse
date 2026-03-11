// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bernhard

// ─── Planning & Prompt Rules (5 rules) ───────────────────────────────
// Detect poor planning, vague prompts, and workflow issues

import type { AgentEventType } from '@synapse-ai/core';
import type { NudgeRule, RuleContext } from '../nudgeEngine.js';

// ── plan.no-plan-mode ────────────────────────────────────────────────
// Complex multi-file task without using Plan Mode

export const noPlanMode: NudgeRule = {
  meta: {
    id: 'plan.no-plan-mode',
    name: 'Complex Task Without Planning',
    description:
      'Modifying 5+ files without using Plan Mode first. Complex tasks benefit from upfront planning.',
    dimension: 'planning',
    defaultSeverity: 'suggestion',
    defaultCooldownMs: 30 * 60 * 1000,
    category: 'planning',
    tags: ['plan-mode', 'workflow'],
    minEvents: 15,
  },
  subscribes: () => ['tool_start'] as AgentEventType[],
  evaluate(ctx: RuleContext) {
    if (ctx.accumulator.usedPlanMode) return null;
    if (ctx.accumulator.distinctFilesModified < 5) return null;

    return {
      severity: 'suggestion',
      title: 'Consider Plan Mode',
      message: `${ctx.accumulator.distinctFilesModified} files modified without Plan Mode. Complex multi-file changes benefit from upfront planning.`,
      recommendation:
        'Use EnterPlanMode or press Ctrl+G for complex tasks. Plan first, then implement with verification.',
    };
  },
};

// ── plan.no-todo-tracking ────────────────────────────────────────────
// Many tool calls without structured tracking

export const noTodoTracking: NudgeRule = {
  meta: {
    id: 'plan.no-todo-tracking',
    name: 'No Task Tracking',
    description:
      'Long task with 10+ tool calls but no TodoWrite usage for structured progress tracking.',
    dimension: 'sessionStrategy',
    defaultSeverity: 'info',
    defaultCooldownMs: 20 * 60 * 1000,
    category: 'planning',
    tags: ['todo', 'tracking'],
    minEvents: 20,
  },
  subscribes: () => ['tool_end'] as AgentEventType[],
  evaluate(ctx: RuleContext) {
    if (ctx.accumulator.usedTodoWrite) return null;
    let totalToolCalls = 0;
    for (const count of ctx.accumulator.toolCounts.values()) totalToolCalls += count;
    if (totalToolCalls < 10) return null;

    return {
      severity: 'info',
      title: 'No task tracking',
      message: `${totalToolCalls} tool calls without TodoWrite. Structured task lists help maintain focus and prevent missed steps.`,
      recommendation:
        'Ask Claude to use TodoWrite for tasks with 3+ steps. This keeps objectives visible even after context compaction.',
    };
  },
};

// ── plan.vague-prompt ────────────────────────────────────────────────
// Very short prompt that generates large output

export const vaguePrompt: NudgeRule = {
  meta: {
    id: 'plan.vague-prompt',
    name: 'Vague Prompt',
    description:
      'Short prompt (< 30 tokens) that generated extensive output. Specific prompts get better results.',
    dimension: 'precision',
    defaultSeverity: 'suggestion',
    defaultCooldownMs: 15 * 60 * 1000,
    category: 'planning',
    tags: ['prompt-quality', 'specificity'],
    minEvents: 5,
  },
  subscribes: () => ['user_prompt'] as AgentEventType[],
  evaluate(ctx: RuleContext) {
    // Check prompt text length as proxy for token count
    const promptText = ctx.event.text ?? '';
    const wordCount = promptText.split(/\s+/).filter(Boolean).length;
    if (wordCount >= 15) return null; // Not vague if 15+ words

    // In conversation mode, only flag truly degenerate prompts (<3 words)
    // Short follow-ups like "make it black" are appropriate in iterative sessions
    const fireThreshold =
      ctx.accumulator.conversationMode && ctx.accumulator.promptCount > 1 ? 3 : 10;

    // Check if previous prompt was also short and generated large output
    // We track this via pattern state
    const prevOutputTokens = ctx.getPatternState('lastOutputTokens') as number | undefined;
    ctx.setPatternState('lastOutputTokens', ctx.accumulator.totalOutputTokens);

    if (prevOutputTokens !== undefined) {
      const outputSinceLastPrompt = ctx.accumulator.totalOutputTokens - prevOutputTokens;
      if (outputSinceLastPrompt > 2000 && wordCount < fireThreshold) {
        return {
          severity: 'suggestion',
          title: 'Vague prompt detected',
          message: `Short prompt (${wordCount} words) generated extensive output. Specific prompts with file references and constraints get better results.`,
          recommendation:
            'Include specific file paths, describe the desired behavior, mention constraints, and provide success criteria.',
        };
      }
    }
    return null;
  },
};

// ── plan.rapid-prompts ───────────────────────────────────────────────
// 3+ prompts within 2 minutes

export const rapidPrompts: NudgeRule = {
  meta: {
    id: 'plan.rapid-prompts',
    name: 'Rapid-Fire Prompts',
    description:
      '3+ prompts submitted within 2 minutes, suggesting insufficient time for Claude to complete each request.',
    dimension: 'sessionStrategy',
    defaultSeverity: 'info',
    defaultCooldownMs: 10 * 60 * 1000,
    category: 'planning',
    tags: ['pacing', 'patience'],
  },
  subscribes: () => ['user_prompt'] as AgentEventType[],
  evaluate(ctx: RuleContext) {
    // Rapid prompts during conversational iteration are expected — suppress entirely
    if (ctx.accumulator.conversationMode) return null;

    const now = ctx.event.timestamp;
    const twoMinAgo = now - 120_000;
    const recentPrompts = ctx.accumulator.promptTimestamps.filter((t: number) => t >= twoMinAgo);
    if (recentPrompts.length < 3) return null;

    return {
      severity: 'info',
      title: 'Rapid prompts',
      message: `${recentPrompts.length} prompts in 2 minutes. Give Claude time to complete each request before sending the next.`,
      recommendation:
        'Wait for Claude to finish before sending the next prompt. Combine related requests into one detailed prompt.',
    };
  },
};

// ── plan.kitchen-sink ────────────────────────────────────────────────
// Mixed concerns — modifying unrelated file clusters in one session

export const kitchenSink: NudgeRule = {
  meta: {
    id: 'plan.kitchen-sink',
    name: 'Mixed Concerns in Session',
    description:
      'Modifying files in many unrelated directories suggests mixing different tasks in one context window.',
    dimension: 'contextManagement',
    defaultSeverity: 'info',
    defaultCooldownMs: 30 * 60 * 1000,
    category: 'planning',
    tags: ['context', 'focus'],
    minEvents: 15,
  },
  subscribes: () => ['tool_end'] as AgentEventType[],
  evaluate(ctx: RuleContext) {
    // Count distinct top-level directories among edited files
    const dirs = new Set<string>();
    for (const f of ctx.accumulator.filesEdited) {
      const parts = f.replace(/\\/g, '/').split('/');
      // Use the first 2-3 path segments as the "cluster"
      const cluster = parts.slice(0, Math.min(3, parts.length - 1)).join('/');
      if (cluster) dirs.add(cluster);
    }

    if (dirs.size < 4) return null;

    return {
      severity: 'info',
      title: 'Mixed concerns',
      message: `Files modified across ${dirs.size} unrelated directories. Mixing tasks in one context wastes tokens on irrelevant content.`,
      recommendation:
        'Use /clear between unrelated tasks, or start separate sessions for each concern.',
    };
  },
};

export const planningRules: NudgeRule[] = [
  noPlanMode,
  noTodoTracking,
  vaguePrompt,
  rapidPrompts,
  kitchenSink,
];
