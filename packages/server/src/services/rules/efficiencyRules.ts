// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bernhard

// ─── Efficiency Rules (3 rules) ──────────────────────────────────────
// Detect context waste, cost spikes, and missed optimization opportunities

import type { AgentEventType } from '@synapse-ai/core';
import type { NudgeRule, RuleContext } from '../nudgeEngine.js';

// ── efficiency.long-session ──────────────────────────────────────────

export const longSession: NudgeRule = {
  meta: {
    id: 'efficiency.long-session',
    name: 'Overlong Session',
    description:
      'Session running 60+ minutes without context reset. Performance degrades as context fills.',
    dimension: 'contextManagement',
    defaultSeverity: 'info',
    defaultCooldownMs: 30 * 60 * 1000,
    category: 'efficiency',
    tags: ['context', 'session-length'],
    minEvents: 10,
  },
  subscribes: () => ['tool_end', 'user_prompt'] as AgentEventType[],
  evaluate(ctx: RuleContext) {
    const durationMs = ctx.event.timestamp - ctx.accumulator.startTime;
    if (durationMs < 60 * 60 * 1000) return null; // Less than 60 minutes

    const minutes = Math.round(durationMs / 60_000);

    return {
      severity: 'info',
      title: 'Long session',
      message: `Session running for ${minutes} minutes. Long sessions fill the context window, degrading Claude's performance.`,
      recommendation:
        'Consider resetting context for unrelated tasks:\n```\n/clear          # Reset context, keep session\n/compact        # Manually compact context\n```\nOr commit your work and start a fresh session for the next task.',
    };
  },
};

// ── efficiency.no-subagents ──────────────────────────────────────────

export const noSubagents: NudgeRule = {
  meta: {
    id: 'efficiency.no-subagents',
    name: 'No Subagent Delegation',
    description:
      '30+ Read/Grep calls without using subagents. Research tasks should be delegated to keep the main context clean.',
    dimension: 'toolCraft',
    defaultSeverity: 'suggestion',
    defaultCooldownMs: 30 * 60 * 1000,
    category: 'efficiency',
    tags: ['subagents', 'context-management'],
    minEvents: 30,
  },
  subscribes: () => ['tool_end'] as AgentEventType[],
  evaluate(ctx: RuleContext) {
    if (ctx.accumulator.usedSubagents) return null;

    const readCount = ctx.accumulator.toolCounts.get('Read') ?? 0;
    const grepCount = ctx.accumulator.toolCounts.get('Grep') ?? 0;
    const globCount = ctx.accumulator.toolCounts.get('Glob') ?? 0;
    const totalResearch = readCount + grepCount + globCount;

    if (totalResearch < 30) return null;

    return {
      severity: 'suggestion',
      title: 'Delegate research',
      message: `${totalResearch} search/read calls in the main context. Subagents run in separate context windows and return condensed summaries.`,
      recommendation:
        'Delegate research-heavy tasks to subagents to keep your main context clean:\n```\n"Use a Task agent to explore the authentication\nsystem and summarize how login tokens are managed.\nI need to modify the refresh flow."\n```\nSubagents can read dozens of files but return a focused summary (1-2K tokens vs 30K+ tokens in main context).',
    };
  },
};

// ── efficiency.cost-spike ────────────────────────────────────────────

export const costSpike: NudgeRule = {
  meta: {
    id: 'efficiency.cost-spike',
    name: 'Cost Spike',
    description:
      'A single turn cost 3x more than the session average, suggesting an unusually expensive operation.',
    dimension: 'costEfficiency',
    defaultSeverity: 'info',
    defaultCooldownMs: 15 * 60 * 1000,
    category: 'efficiency',
    tags: ['cost', 'tokens'],
    minEvents: 10,
  },
  subscribes: () => ['tool_end'] as AgentEventType[],
  evaluate(ctx: RuleContext) {
    if (!ctx.event.costUsd || ctx.accumulator.turnCosts.length < 5) return null;

    const avg = ctx.accumulator.totalCostUsd / ctx.accumulator.turnCosts.length;
    if (avg === 0) return null;

    const ratio = ctx.event.costUsd / avg;
    if (ratio < 3) return null;

    const costCents = Math.round(ctx.event.costUsd * 100);
    const avgCents = Math.round(avg * 100);

    return {
      severity: 'info',
      title: 'Cost spike',
      message: `This turn cost ~${costCents}¢ (${ratio.toFixed(1)}x the session average of ${avgCents}¢). Large operations consume more tokens.`,
      recommendation:
        'Reduce costs by:\n- Reading specific line ranges instead of entire large files:\n  ```\n  "Read lines 50-100 of src/bigfile.ts"\n  ```\n- Using Haiku/Sonnet subagents for research tasks:\n  ```\n  "Use a Haiku Task agent to find all uses of LoginService"\n  ```\n- Limiting Bash output with head/tail.',
    };
  },
};

export const efficiencyRules: NudgeRule[] = [longSession, noSubagents, costSpike];
