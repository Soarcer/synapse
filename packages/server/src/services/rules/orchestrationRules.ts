// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Synapse Contributors

// ─── Agent Orchestration Rules (2 rules) ─────────────────────────────
// Detect poor subagent usage patterns

import type { AgentEventType } from '@synapse-ai/core';
import type { NudgeRule, RuleContext } from '../nudgeEngine.js';

// ── agent.vague-delegation ───────────────────────────────────────────

export const vagueDelegation: NudgeRule = {
  meta: {
    id: 'agent.vague-delegation',
    name: 'Vague Subagent Instructions',
    description:
      'Subagent spawned with a very short prompt (< 100 chars). Subagents need clear scope and success criteria.',
    dimension: 'precision',
    defaultSeverity: 'suggestion',
    defaultCooldownMs: 10 * 60 * 1000,
    category: 'orchestration',
    tags: ['subagents', 'prompt-quality'],
  },
  subscribes: () => ['agent_start'] as AgentEventType[],
  evaluate(ctx: RuleContext) {
    // Look at the most recent Task tool_start to get the prompt
    const recentTask = ctx.countWindow
      .filter((e) => e.toolName === 'Task' && e.type === 'tool_start')
      .pop();

    if (!recentTask) return null;

    const input = recentTask.toolInput as Record<string, unknown> | undefined;
    const prompt = (input?.prompt as string) ?? '';

    if (prompt.length >= 100) return null;

    return {
      severity: 'suggestion',
      title: 'Vague subagent prompt',
      message: `Subagent spawned with a ${prompt.length}-character prompt. Short prompts lead to unfocused results and wasted tokens.`,
      recommendation:
        'Give subagents detailed instructions with scope, file references, and expected output:\n```\n"Search packages/server/src/ for all usages of the\nAuthService class. List each file, the function name,\nand how auth tokens are validated. Focus on the\ntoken refresh flow — I need to modify the expiry logic."\n```\nGood subagent prompts include:\n- Specific file/directory scope\n- What information you need back\n- Why you need it (context for the subagent)',
    };
  },
};

// ── agent.redundant-reads ────────────────────────────────────────────

export const redundantReads: NudgeRule = {
  meta: {
    id: 'agent.redundant-reads',
    name: 'Redundant Subagent Work',
    description: 'Multiple subagents accessing the same files, suggesting overlapping work.',
    dimension: 'costEfficiency',
    defaultSeverity: 'info',
    defaultCooldownMs: 20 * 60 * 1000,
    category: 'orchestration',
    tags: ['subagents', 'efficiency'],
    minEvents: 15,
  },
  subscribes: () => ['tool_end'] as AgentEventType[],
  evaluate(ctx: RuleContext) {
    // Check for overlapping file access across subagents
    const subagentFiles = ctx.accumulator.subagentFiles;
    if (subagentFiles.size < 2) return null;

    // Find overlapping files
    const allFiles = new Map<string, string[]>(); // file → agentIds that accessed it
    for (const [agentId, files] of subagentFiles) {
      for (const file of files) {
        const agents = allFiles.get(file) ?? [];
        agents.push(agentId);
        allFiles.set(file, agents);
      }
    }

    const overlaps = Array.from(allFiles.entries()).filter(([, agents]) => agents.length > 1);
    if (overlaps.length < 2) return null;

    return {
      severity: 'info',
      title: 'Redundant subagent work',
      message: `${overlaps.length} files accessed by multiple subagents. Overlapping work wastes tokens and may produce inconsistent results.`,
      recommendation:
        'Give each subagent a distinct scope:\n```\n// Instead of:\n// Agent 1: "Explore the auth system"\n// Agent 2: "Find security issues in auth"\n\n// Use clear file boundaries:\n// Agent 1: "Explore packages/auth/src/login.ts and token.ts"\n// Agent 2: "Review packages/auth/src/middleware.ts and permissions.ts"\n```\nDefine explicit file boundaries to prevent overlap.',
    };
  },
};

export const orchestrationRules: NudgeRule[] = [vagueDelegation, redundantReads];
