// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bernhard

// ─── Security Rules (3 rules) ────────────────────────────────────────
// Detect security anti-patterns: secrets, env files, destructive commands

import type { AgentEventType } from '@synapse-ai/core';
import type { NudgeRule, RuleContext } from '../nudgeEngine.js';
import {
  extractBashCommand,
  extractFilePath,
  SECRET_PATTERN_RE,
  BEARER_RE,
  SENSITIVE_FILES_RE,
  PROCESS_KILL_ALL_RE,
} from '../nudgeEngine.js';

// ── security.hardcoded-secret ────────────────────────────────────────

export const hardcodedSecret: NudgeRule = {
  meta: {
    id: 'security.hardcoded-secret',
    name: 'Hardcoded Secret',
    description: 'Edit/Write content appears to contain hardcoded API keys, passwords, or tokens.',
    dimension: 'configuration',
    defaultSeverity: 'warning',
    defaultCooldownMs: 5 * 60 * 1000,
    category: 'security',
    tags: ['security', 'secrets', 'credentials'],
  },
  subscribes: () => ['tool_end'] as AgentEventType[],
  evaluate(ctx: RuleContext) {
    if (ctx.event.toolName !== 'Edit' && ctx.event.toolName !== 'Write') return null;

    // Check tool input for secret patterns
    const input = ctx.event.toolInput as Record<string, unknown> | undefined;
    const content = (input?.new_string as string) ?? (input?.content as string) ?? '';
    if (!content) return null;

    const hasSecret = SECRET_PATTERN_RE.test(content) || BEARER_RE.test(content);
    if (!hasSecret) return null;

    const filePath = extractFilePath(ctx.event);
    const fileName = filePath?.split(/[/\\]/).pop() ?? 'unknown file';

    return {
      severity: 'warning',
      title: 'Possible hardcoded secret',
      message: `"${fileName}" may contain a hardcoded secret (API key, password, or token). Secrets should never be in source code.`,
      recommendation:
        'Use environment variables instead of hardcoded secrets:\n```typescript\n// Bad: const key = "sk-abc123...";\n// Good: const key = process.env.API_KEY;\n```\nStore secrets in `.env` (gitignored) and load with `dotenv`:\n```\nnpm install dotenv\n```\nAdd to `.gitignore`:\n```\n.env\n.env.local\n```',
    };
  },
};

// ── security.env-in-commit ───────────────────────────────────────────

export const envInCommit: NudgeRule = {
  meta: {
    id: 'security.env-in-commit',
    name: 'Sensitive File in Git',
    description: 'Staging a .env, .pem, .key, or credentials file for git commit.',
    dimension: 'configuration',
    defaultSeverity: 'warning',
    defaultCooldownMs: 5 * 60 * 1000,
    category: 'security',
    tags: ['security', 'git', 'credentials'],
  },
  subscribes: () => ['tool_start'] as AgentEventType[],
  evaluate(ctx: RuleContext) {
    if (ctx.event.toolName !== 'Bash') return null;
    const cmd = extractBashCommand(ctx.event);
    if (!/\bgit\s+add\b/.test(cmd)) return null;

    // Check if any sensitive file patterns are in the command
    if (!SENSITIVE_FILES_RE.test(cmd)) return null;

    const match = cmd.match(SENSITIVE_FILES_RE);
    const fileName = match?.[0] ?? 'sensitive file';

    return {
      severity: 'warning',
      title: 'Sensitive file staged',
      message: `A sensitive file (${fileName}) is being staged for commit. This could expose credentials in your repository.`,
      recommendation:
        'Remove from staging and add to .gitignore:\n```\ngit reset HEAD .env\necho ".env" >> .gitignore\necho "*.pem" >> .gitignore\necho "*.key" >> .gitignore\ngit add .gitignore\n```',
    };
  },
};

// ── security.process-kill-all ────────────────────────────────────────

export const processKillAll: NudgeRule = {
  meta: {
    id: 'security.process-kill-all',
    name: 'Blanket Process Kill',
    description:
      'Using taskkill with //IM kills ALL processes of that type across the system, not just the target.',
    dimension: 'sessionStrategy',
    defaultSeverity: 'warning',
    defaultCooldownMs: 5 * 60 * 1000,
    category: 'security',
    tags: ['destructive', 'process-management'],
  },
  subscribes: () => ['tool_start'] as AgentEventType[],
  evaluate(ctx: RuleContext) {
    if (ctx.event.toolName !== 'Bash') return null;
    const cmd = extractBashCommand(ctx.event);
    if (!PROCESS_KILL_ALL_RE.test(cmd)) return null;

    return {
      severity: 'warning',
      title: 'Blanket process kill',
      message:
        'Using "taskkill //IM" kills ALL processes with that name across every project, terminal, and tool on the system.',
      recommendation:
        'Kill only the specific process by PID instead:\n```bash\n# Find the right PID:\nwmic process where "commandline like \'%your-script%\'" get processid\n\n# Kill only that process:\ntaskkill //F //PID <pid>\n```',
    };
  },
};

export const securityRules: NudgeRule[] = [hardcodedSecret, envInCommit, processKillAll];
