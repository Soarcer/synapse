// ─── Git & Workflow Rules (5 rules) ──────────────────────────────────
// Detect dangerous git operations and poor workflow habits

import type { AgentEventType } from '@synapse-ai/core';
import type { NudgeRule, RuleContext } from '../nudgeEngine.js';
import { extractBashCommand, GIT_ADD_ALL_RE, GIT_FORCE_RE, GIT_COMMIT_RE, MAIN_BRANCH_RE, userExplicitlyRequested, USER_ASKED_GIT_ADD_ALL, USER_ASKED_FORCE_PUSH } from '../nudgeEngine.js';

// ── git.force-push ───────────────────────────────────────────────────

export const forcePush: NudgeRule = {
  meta: {
    id: 'git.force-push',
    name: 'Force Push',
    description: 'Using git push --force which can overwrite remote history and cause data loss for collaborators.',
    dimension: 'sessionStrategy',
    defaultSeverity: 'warning',
    defaultCooldownMs: 5 * 60 * 1000,
    category: 'git',
    tags: ['git', 'destructive'],
  },
  subscribes: () => ['tool_start'] as AgentEventType[],
  evaluate(ctx: RuleContext) {
    if (ctx.event.toolName !== 'Bash') return null;
    const cmd = extractBashCommand(ctx.event);
    if (!GIT_FORCE_RE.test(cmd)) return null;

    // Extra dangerous on main/master
    const onMain = MAIN_BRANCH_RE.test(cmd);
    const userAsked = userExplicitlyRequested(ctx.accumulator, USER_ASKED_FORCE_PUSH);

    if (onMain) {
      return {
        severity: 'warning',
        title: 'Force push to main!',
        message: userAsked
          ? 'You asked for a force push to main — this rewrites shared history and can destroy collaborators\' work!'
          : 'The agent is force pushing to main/master! This rewrites shared history and can destroy collaborators\' work.',
        recommendation: 'NEVER force push to main. Create a new commit instead:\n```\ngit revert HEAD\ngit push origin main\n```',
      };
    }

    return {
      severity: 'warning',
      title: userAsked ? 'Force push' : 'Agent: force push',
      message: userAsked
        ? 'You asked for a force push. Consider --force-with-lease for a safer alternative.'
        : 'The agent chose to force push without being asked. This rewrites remote history.',
      recommendation: 'Use --force-with-lease instead, which fails if the remote has changed:\n```\ngit push --force-with-lease origin <branch>\n```',
    };
  },
};

// ── git.no-commits ───────────────────────────────────────────────────

export const noCommits: NudgeRule = {
  meta: {
    id: 'git.no-commits',
    name: 'Long Session Without Commits',
    description: '20+ file edits without any git commits. Use commits as checkpoints for easy recovery.',
    dimension: 'sessionStrategy',
    defaultSeverity: 'suggestion',
    defaultCooldownMs: 30 * 60 * 1000,
    category: 'git',
    tags: ['git', 'workflow'],
    minEvents: 20,
  },
  subscribes: () => ['tool_end'] as AgentEventType[],
  evaluate(ctx: RuleContext) {
    if (ctx.accumulator.editsSinceLastCommit < 20) return null;

    return {
      severity: 'suggestion',
      title: 'Commit your progress',
      message: `${ctx.accumulator.editsSinceLastCommit} edits without a commit. Frequent commits create recovery points.`,
      recommendation: 'Commit completed work to create recovery checkpoints. Try:\n```\ngit add -p  # Stage specific changes\ngit commit -m "wip: describe what works so far"\n```',
    };
  },
};

// ── git.add-all ──────────────────────────────────────────────────────

export const addAll: NudgeRule = {
  meta: {
    id: 'git.add-all',
    name: 'Indiscriminate Staging',
    description: 'Using "git add -A" or "git add ." which can accidentally include sensitive files or unrelated changes.',
    dimension: 'sessionStrategy',
    defaultSeverity: 'suggestion',
    defaultCooldownMs: 15 * 60 * 1000,
    category: 'git',
    tags: ['git', 'security'],
  },
  subscribes: () => ['tool_start'] as AgentEventType[],
  evaluate(ctx: RuleContext) {
    if (ctx.event.toolName !== 'Bash') return null;
    const cmd = extractBashCommand(ctx.event);
    if (!GIT_ADD_ALL_RE.test(cmd)) return null;

    const userAsked = userExplicitlyRequested(ctx.accumulator, USER_ASKED_GIT_ADD_ALL);

    return {
      severity: 'suggestion',
      title: userAsked ? 'Staging all files' : 'Agent: staging all files',
      message: userAsked
        ? 'You asked to stage everything. "git add -A" includes .env files, credentials, and unrelated changes.'
        : 'The agent used "git add -A" or "git add ." which stages everything — including sensitive files.',
      recommendation: 'Stage files explicitly by name instead:\n```\ngit add src/feature.ts src/feature.test.ts\n```\nOr review what would be staged first:\n```\ngit status\ngit diff --cached\n```',
    };
  },
};

// ── git.main-branch-direct ───────────────────────────────────────────

export const mainBranchDirect: NudgeRule = {
  meta: {
    id: 'git.main-branch-direct',
    name: 'Direct Commit to Main',
    description: 'Committing directly to main/master branch instead of using feature branches.',
    dimension: 'sessionStrategy',
    defaultSeverity: 'warning',
    defaultCooldownMs: 15 * 60 * 1000,
    category: 'git',
    tags: ['git', 'branching'],
  },
  subscribes: () => ['tool_start'] as AgentEventType[],
  evaluate(ctx: RuleContext) {
    if (ctx.event.toolName !== 'Bash') return null;
    const cmd = extractBashCommand(ctx.event);
    if (!GIT_COMMIT_RE.test(cmd)) return null;

    // Check if current branch looks like main/master from recent git output
    // Look for branch hints in recent bash outputs
    const branchHints = ctx.countWindow.filter(e =>
      e.toolName === 'Bash' && e.type === 'tool_end',
    );

    for (const hint of branchHints.slice(-5)) {
      const response = hint.toolResponse as Record<string, unknown> | undefined;
      const output = String(response?.stdout ?? response?.output ?? '');
      // Look for "On branch main" or "* main" patterns
      if (/\bon branch (main|master)\b/i.test(output) || /^\* (main|master)$/m.test(output)) {
        return {
          severity: 'warning',
          title: 'Committing to main',
          message: 'Committing directly to main/master. Feature branches enable code review and easy rollback.',
          recommendation: 'Create a feature branch first:\n```\ngit checkout -b feat/your-feature-name\ngit commit -m "your commit message"\ngit push -u origin feat/your-feature-name\n```',
        };
      }
    }

    return null;
  },
};

// ── git.large-commit ─────────────────────────────────────────────────

export const largeCommit: NudgeRule = {
  meta: {
    id: 'git.large-commit',
    name: 'Oversized Commit',
    description: 'Commit touching many files across multiple directories — consider splitting into focused commits.',
    dimension: 'sessionStrategy',
    defaultSeverity: 'info',
    defaultCooldownMs: 20 * 60 * 1000,
    category: 'git',
    tags: ['git', 'commit-size'],
    minEvents: 10,
  },
  subscribes: () => ['tool_end'] as AgentEventType[],
  evaluate(ctx: RuleContext) {
    if (ctx.event.toolName !== 'Bash') return null;
    const cmd = extractBashCommand(ctx.event);
    if (!GIT_COMMIT_RE.test(cmd)) return null;

    // Check how many files were edited since last commit
    if (ctx.accumulator.editsSinceLastCommit < 10) return null;

    // Count distinct directories
    const dirs = new Set<string>();
    for (const f of ctx.accumulator.filesEdited) {
      const dir = f.replace(/\\/g, '/').split('/').slice(0, -1).join('/');
      if (dir) dirs.add(dir);
    }

    if (dirs.size < 3) return null;

    return {
      severity: 'info',
      title: 'Large commit',
      message: `Committing changes across ${ctx.accumulator.editsSinceLastCommit} files in ${dirs.size} directories. Smaller, focused commits are easier to review and revert.`,
      recommendation: 'Break large changes into focused commits:\n```\ngit add src/auth/  # Stage one feature area\ngit commit -m "feat: add authentication"\ngit add src/api/  # Stage another area\ngit commit -m "feat: add API endpoints"\n```',
    };
  },
};

export const gitRules: NudgeRule[] = [
  forcePush,
  noCommits,
  addAll,
  mainBranchDirect,
  largeCommit,
];
