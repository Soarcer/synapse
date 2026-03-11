// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bernhard

// ─── Tool Usage Rules (7 rules) ──────────────────────────────────────
// Detect misuse of Claude Code's tool system
//
// ATTRIBUTION: Tool selection is ALWAYS an agent decision. The user says
// "look at this file" — the agent chooses cat vs Read. The user says
// "search for X" — the agent chooses grep vs Grep. Users don't type
// technical tool names. Nudges here should help the user train the agent
// (via CLAUDE.md, hooks, or mid-session corrections), never blame the user
// for the agent's tool choices.

import type { AgentEventType } from '@synapse-ai/core';
import type { NudgeRule, RuleContext } from '../nudgeEngine.js';
import { BASH_FILE_OPS_RE, extractBashCommand, extractFilePath } from '../nudgeEngine.js';

// ── tool.bash-file-ops ───────────────────────────────────────────────
// Single Bash call using cat/grep/find/sed when dedicated tools exist

export const bashFileOps: NudgeRule = {
  meta: {
    id: 'tool.bash-file-ops',
    name: 'Bash for File Operations',
    description:
      'Agent used Bash commands (cat, grep, find, sed) instead of dedicated tools (Read, Grep, Glob, Edit).',
    dimension: 'toolCraft',
    defaultSeverity: 'suggestion',
    defaultCooldownMs: 10 * 60 * 1000,
    category: 'tool-usage',
    tags: ['bash', 'dedicated-tools'],
  },
  subscribes: () => ['tool_start'] as AgentEventType[],
  evaluate(ctx: RuleContext) {
    if (ctx.event.toolName !== 'Bash') return null;
    const cmd = extractBashCommand(ctx.event);
    if (!BASH_FILE_OPS_RE.test(cmd)) return null;

    const toolMap: Record<string, string> = {
      cat: 'Read',
      head: 'Read',
      tail: 'Read',
      grep: 'Grep',
      rg: 'Grep',
      find: 'Glob',
      sed: 'Edit',
      awk: 'Edit',
    };
    const match = cmd.match(BASH_FILE_OPS_RE);
    const bashCmd = match?.[1] ?? 'cat';
    const replacement = toolMap[bashCmd] ?? 'a dedicated tool';

    return {
      severity: 'suggestion',
      title: `Agent used ${bashCmd} instead of ${replacement}`,
      message: `The agent chose Bash "${bashCmd}" instead of the ${replacement} tool. Dedicated tools are faster, use less context, and have better permissions.`,
      recommendation: `You can prevent this permanently with a CLAUDE.md instruction:\n\`\`\`\nIMPORTANT: Never use Bash for file operations.\nUse Read instead of cat, Grep instead of grep,\nGlob instead of find, and Edit instead of sed.\n\`\`\`\nOr correct the agent mid-session:\n\`\`\`\nStop. Use the ${replacement} tool, not Bash.\n\`\`\``,
    };
  },
};

// ── tool.bash-streak ─────────────────────────────────────────────────
// 3+ consecutive Bash file-op calls

export const bashStreak: NudgeRule = {
  meta: {
    id: 'tool.bash-streak',
    name: 'Consecutive Bash File Ops',
    description:
      'Agent made 3+ consecutive Bash calls for file operations instead of using dedicated tools.',
    dimension: 'toolCraft',
    defaultSeverity: 'suggestion',
    defaultCooldownMs: 10 * 60 * 1000,
    category: 'tool-usage',
    tags: ['bash', 'streak'],
  },
  subscribes: () => ['tool_end'] as AgentEventType[],
  evaluate(ctx: RuleContext) {
    if (ctx.accumulator.consecutiveBashFileOps < 3) return null;
    const count = ctx.accumulator.consecutiveBashFileOps;
    return {
      severity: 'suggestion',
      title: `Agent: ${count}x Bash file-op streak`,
      message: `The agent made ${count} consecutive Bash calls for file operations. This is an agent habit — dedicated tools are faster and more reliable.`,
      recommendation:
        'Add this to your CLAUDE.md to train the agent:\n```\nIMPORTANT: Do NOT use Bash for file operations.\nUse Read instead of cat, Grep instead of grep,\nGlob instead of find, and Edit instead of sed.\n```\nOr interrupt the session:\n```\nStop using Bash for file reads. Use the Read tool.\n```',
    };
  },
};

// ── tool.no-parallelization ──────────────────────────────────────────
// Sequential single-tool calls that could be parallelized

export const noParallelization: NudgeRule = {
  meta: {
    id: 'tool.no-parallelization',
    name: 'Sequential Independent Calls',
    description:
      'Agent made 3+ sequential single-tool calls to independent files that could be parallelized.',
    dimension: 'toolCraft',
    defaultSeverity: 'info',
    defaultCooldownMs: 15 * 60 * 1000,
    category: 'tool-usage',
    tags: ['parallelization', 'efficiency'],
    minEvents: 10,
  },
  subscribes: () => ['tool_end'] as AgentEventType[],
  evaluate(ctx: RuleContext) {
    const recent = ctx.countWindow.slice(-6);
    const reads = recent.filter((e) => e.toolName === 'Read' && e.type === 'tool_end');
    if (reads.length < 3) return null;

    const files = new Set(reads.map((e) => extractFilePath(e)).filter(Boolean));
    if (files.size < 3) return null;

    return {
      severity: 'info',
      title: 'Agent: sequential reads could be parallelized',
      message: `The agent made ${reads.length} sequential Read calls to different files. It could batch these in a single turn for faster execution.`,
      recommendation:
        'You can hint in your prompt:\n```\nRead all the relevant files in parallel first,\nthen make changes.\n```\nOr add to CLAUDE.md:\n```\nWhen reading multiple independent files, batch\nthem in a single turn for efficiency.\n```',
    };
  },
};

// ── tool.excessive-bash-output ───────────────────────────────────────
// Bash output wastes context tokens

export const excessiveBashOutput: NudgeRule = {
  meta: {
    id: 'tool.excessive-bash-output',
    name: 'Large Bash Output',
    description: 'Bash command produced very large output, consuming context window tokens.',
    dimension: 'contextManagement',
    defaultSeverity: 'info',
    defaultCooldownMs: 15 * 60 * 1000,
    category: 'tool-usage',
    tags: ['bash', 'context-waste'],
  },
  subscribes: () => ['tool_end'] as AgentEventType[],
  evaluate(ctx: RuleContext) {
    if (ctx.event.toolName !== 'Bash') return null;
    const response = ctx.event.toolResponse as Record<string, unknown> | undefined;
    const content = JSON.stringify(response ?? {});
    if (content.length < 5000) return null;

    const sizeKb = Math.round(content.length / 1024);
    return {
      severity: 'info',
      title: `Large output (~${sizeKb}KB)`,
      message: `A Bash command produced ~${sizeKb}KB of output, consuming context window tokens and reducing space for reasoning.`,
      recommendation:
        'Add to CLAUDE.md:\n```\nWhen running commands that may produce large output,\npipe through head -50 or tail -20 to limit the result.\nUse Grep for targeted searches instead of dumping files.\n```',
    };
  },
};

// ── tool.edit-without-read ───────────────────────────────────────────
// Edit/Write without prior Read of the file

export const editWithoutRead: NudgeRule = {
  meta: {
    id: 'tool.edit-without-read',
    name: 'Edit Without Read',
    description:
      'Agent is editing a file without reading it first, which often causes failed edits.',
    dimension: 'planning',
    defaultSeverity: 'warning',
    defaultCooldownMs: 10 * 60 * 1000,
    category: 'tool-usage',
    tags: ['read-before-edit', 'best-practice'],
  },
  subscribes: () => ['tool_start'] as AgentEventType[],
  evaluate(ctx: RuleContext) {
    if (ctx.event.toolName !== 'Edit' && ctx.event.toolName !== 'Write') return null;
    const filePath = extractFilePath(ctx.event);
    if (!filePath) return null;

    if (ctx.accumulator.filesRead.has(filePath)) return null;

    const fileName = filePath.split(/[/\\]/).pop() ?? filePath;
    return {
      severity: 'warning',
      title: 'Agent editing unread file',
      message: `The agent is editing "${fileName}" without reading it first. This commonly causes string match failures and broken edits.`,
      recommendation:
        "Add to CLAUDE.md:\n```\nIMPORTANT: Always Read a file before using Edit on it.\nNever Edit a file you haven't Read in this session.\n```\nOr tell the agent:\n```\nRead the file first, then make the change.\n```",
    };
  },
};

// ── tool.file-reread ─────────────────────────────────────────────────
// Same file read 3+ times in session

export const fileReread: NudgeRule = {
  meta: {
    id: 'tool.file-reread',
    name: 'Excessive File Re-Reading',
    description: 'Agent read the same file 3+ times in a session, wasting tokens.',
    dimension: 'contextManagement',
    defaultSeverity: 'suggestion',
    defaultCooldownMs: 15 * 60 * 1000,
    category: 'tool-usage',
    tags: ['context-waste', 'efficiency'],
  },
  subscribes: () => ['tool_end'] as AgentEventType[],
  evaluate(ctx: RuleContext) {
    if (ctx.event.toolName !== 'Read') return null;
    const filePath = extractFilePath(ctx.event);
    if (!filePath) return null;

    const readCount = ctx.accumulator.fileReadCounts.get(filePath) ?? 0;
    if (readCount < 3) return null;

    // After compaction, re-reads are expected — only flag excessive re-reads
    const hadCompaction = ctx.accumulator.compactionCount > 0;
    if (hadCompaction && readCount <= 3) return null;

    const fileName = filePath.split(/[/\\]/).pop() ?? filePath;
    return {
      severity: 'suggestion',
      title: `Agent: "${fileName}" read ${readCount} times`,
      message: `The agent read "${fileName}" ${readCount} times this session. ${hadCompaction ? 'Some re-reads after compaction are expected, but this is excessive.' : 'This wastes tokens re-loading the same content.'}`,
      recommendation:
        'You can front-load all needed file reads in one prompt:\n```\nRead these files so we have the full context:\n- src/auth/login.ts\n- src/auth/token.ts\n- src/auth/middleware.ts\nThen make all the changes.\n```',
    };
  },
};

// ── tool.write-over-edit ─────────────────────────────────────────────
// Using Write when Edit would be more appropriate

export const writeOverEdit: NudgeRule = {
  meta: {
    id: 'tool.write-over-edit',
    name: 'Write When Edit Would Work',
    description:
      'Agent used Write to overwrite an existing file when Edit (targeted replacement) would be safer.',
    dimension: 'precision',
    defaultSeverity: 'suggestion',
    defaultCooldownMs: 10 * 60 * 1000,
    category: 'tool-usage',
    tags: ['precision', 'edit-vs-write'],
  },
  subscribes: () => ['tool_start'] as AgentEventType[],
  evaluate(ctx: RuleContext) {
    if (ctx.event.toolName !== 'Write') return null;
    const filePath = extractFilePath(ctx.event);
    if (!filePath) return null;

    if (!ctx.accumulator.filesRead.has(filePath)) return null;

    const fileName = filePath.split(/[/\\]/).pop() ?? filePath;
    return {
      severity: 'suggestion',
      title: `Agent: Write vs Edit on "${fileName}"`,
      message: `The agent used Write to overwrite "${fileName}". Edit (targeted string replacement) is safer — Write replaces the entire file.`,
      recommendation:
        'Add to CLAUDE.md:\n```\nPrefer Edit over Write for modifying existing files.\nOnly use Write for creating new files or complete rewrites.\n```',
    };
  },
};

export const toolUsageRules: NudgeRule[] = [
  bashFileOps,
  bashStreak,
  noParallelization,
  excessiveBashOutput,
  editWithoutRead,
  fileReread,
  writeOverEdit,
];
