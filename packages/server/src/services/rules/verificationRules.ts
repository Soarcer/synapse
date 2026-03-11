// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bernhard

// ─── Verification Rules (5 rules) ────────────────────────────────────
// Detect missing tests, error spirals, and unverified changes

import type { AgentEventType } from '@synapse-ai/core';
import type { NudgeRule, RuleContext } from '../nudgeEngine.js';
import { extractBashCommand, extractFilePath, GIT_COMMIT_RE } from '../nudgeEngine.js';

// ── verify.no-tests-after-edits ──────────────────────────────────────
// 5+ edits without running tests

export const noTestsAfterEdits: NudgeRule = {
  meta: {
    id: 'verify.no-tests-after-edits',
    name: 'No Tests After Edits',
    description:
      '5+ file edits without running any test or build command. Changes may introduce regressions.',
    dimension: 'verification',
    defaultSeverity: 'warning',
    defaultCooldownMs: 15 * 60 * 1000,
    category: 'verification',
    tags: ['testing', 'verification'],
    minEvents: 10,
  },
  subscribes: () => ['tool_end'] as AgentEventType[],
  evaluate(ctx: RuleContext) {
    if (ctx.accumulator.editsSinceLastTest < 5) return null;

    return {
      severity: 'warning',
      title: 'No verification',
      message: `${ctx.accumulator.editsSinceLastTest} file modifications without running tests. Changes may have introduced bugs.`,
      recommendation:
        'Run your test suite to verify changes:\n```\nRun the tests to make sure nothing is broken.\nIf any tests fail, fix the root cause before continuing.\n```\nOr be specific about which tests:\n```\nRun the tests in src/auth/__tests__/ to verify\nthe login changes work correctly.\n```',
    };
  },
};

// ── verify.error-spiral ──────────────────────────────────────────────
// 3+ consecutive tool errors

export const errorSpiral: NudgeRule = {
  meta: {
    id: 'verify.error-spiral',
    name: 'Error Spiral',
    description: '3+ consecutive tool errors suggesting the current approach needs rethinking.',
    dimension: 'verification',
    defaultSeverity: 'warning',
    defaultCooldownMs: 5 * 60 * 1000,
    category: 'verification',
    tags: ['errors', 'debugging'],
  },
  subscribes: () => ['tool_error'] as AgentEventType[],
  evaluate(ctx: RuleContext) {
    if (ctx.accumulator.consecutiveErrors < 3) return null;

    return {
      severity: 'warning',
      title: 'Error spiral detected',
      message: `${ctx.accumulator.consecutiveErrors} consecutive tool errors. The current approach may need a different strategy.`,
      recommendation:
        "Stop and rethink the approach:\n```\nStop. Read the error messages carefully and explain\nwhat's actually going wrong. Then suggest a different\napproach instead of retrying the same thing.\n```\nOr reset context and start fresh:\n```\n/clear\n```",
    };
  },
};

// ── verify.same-error-retry ──────────────────────────────────────────
// Same tool+file error repeated without trying a different approach

export const sameErrorRetry: NudgeRule = {
  meta: {
    id: 'verify.same-error-retry',
    name: 'Retrying Same Approach',
    description:
      'Same tool error on the same file repeated, suggesting a different approach is needed.',
    dimension: 'verification',
    defaultSeverity: 'warning',
    defaultCooldownMs: 5 * 60 * 1000,
    category: 'verification',
    tags: ['errors', 'retry'],
  },
  subscribes: () => ['tool_error'] as AgentEventType[],
  evaluate(ctx: RuleContext) {
    const filePath = extractFilePath(ctx.event);
    const toolName = ctx.event.toolName;
    if (!filePath || !toolName) return null;

    // Look for same tool+file errors in recent window
    const sameErrors = ctx.countWindow.filter(
      (e) => e.type === 'tool_error' && e.toolName === toolName && extractFilePath(e) === filePath,
    );

    if (sameErrors.length < 2) return null;

    const fileName = filePath.split(/[/\\]/).pop() ?? filePath;
    return {
      severity: 'warning',
      title: 'Same error repeated',
      message: `${toolName} failed on "${fileName}" ${sameErrors.length} times. Retrying the same approach won't fix the underlying issue.`,
      recommendation:
        'Read the error message carefully. Try a different approach: re-read the file, check assumptions, or use a different tool.',
    };
  },
};

// ── verify.test-deletion ─────────────────────────────────────────────
// Editing test files in a way that may be removing tests

export const testDeletion: NudgeRule = {
  meta: {
    id: 'verify.test-deletion',
    name: 'Test File Modification',
    description:
      'Editing a test file during implementation. Ensure tests are being added, not removed.',
    dimension: 'verification',
    defaultSeverity: 'warning',
    defaultCooldownMs: 15 * 60 * 1000,
    category: 'verification',
    tags: ['testing', 'test-integrity'],
  },
  subscribes: () => ['tool_end'] as AgentEventType[],
  evaluate(ctx: RuleContext) {
    if (ctx.event.toolName !== 'Edit' && ctx.event.toolName !== 'Write') return null;
    const filePath = extractFilePath(ctx.event);
    if (!filePath) return null;

    // Detect test files by naming convention
    const isTestFile = /\.(test|spec)\.(ts|tsx|js|jsx|py)$|__tests__|_test\.go$|_test\.rs$/i.test(
      filePath,
    );
    if (!isTestFile) return null;

    // If it's a Write (full overwrite) to a test file, flag it
    if (ctx.event.toolName === 'Write') {
      const fileName = filePath.split(/[/\\]/).pop() ?? filePath;
      return {
        severity: 'warning',
        title: 'Test file overwritten',
        message: `Test file "${fileName}" was overwritten with Write. Ensure existing tests weren't removed.`,
        recommendation:
          'Use Edit for targeted changes to test files. Never remove or suppress failing tests — fix the underlying code instead.',
      };
    }

    return null;
  },
};

// ── verify.no-review-before-commit ───────────────────────────────────
// Git commit without preceding git diff or review

export const noReviewBeforeCommit: NudgeRule = {
  meta: {
    id: 'verify.no-review-before-commit',
    name: 'Commit Without Review',
    description: 'Git commit without reviewing changes first (no git diff or subagent review).',
    dimension: 'verification',
    defaultSeverity: 'suggestion',
    defaultCooldownMs: 15 * 60 * 1000,
    category: 'verification',
    tags: ['git', 'review', 'commit'],
  },
  subscribes: () => ['tool_start'] as AgentEventType[],
  evaluate(ctx: RuleContext) {
    if (ctx.event.toolName !== 'Bash') return null;
    const cmd = extractBashCommand(ctx.event);
    if (!GIT_COMMIT_RE.test(cmd)) return null;

    // Check if git diff was run recently (within last 60 seconds)
    const now = ctx.event.timestamp;
    const recentDiff = now - ctx.accumulator.lastGitDiffTime < 60_000;
    if (recentDiff) return null;

    // Check if a subagent review was done recently
    if (ctx.accumulator.usedSubagents) {
      const recentReview = ctx.countWindow.some(
        (e) =>
          e.type === 'agent_start' &&
          e.agentType &&
          /review/i.test(e.agentType) &&
          now - e.timestamp < 120_000,
      );
      if (recentReview) return null;
    }

    return {
      severity: 'suggestion',
      title: 'Commit without review',
      message:
        'Committing without reviewing changes first. A quick git diff or code review subagent catches mistakes.',
      recommendation:
        'Run "git diff" before committing. For important changes, use a subagent to review the diff.',
    };
  },
};

export const verificationRules: NudgeRule[] = [
  noTestsAfterEdits,
  errorSpiral,
  sameErrorRetry,
  testDeletion,
  noReviewBeforeCommit,
];
