// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bernhard

import { logger } from '../lib/logger.js';
import {
  getEventsBySession,
  getEventsBySessionIds,
  getCachedReportCard,
  upsertReportCard,
  getReportCardsInRange,
  type EventRow,
} from '../db.js';
import type {
  ReportCard,
  DimensionScore,
  DetectorResult,
  CoachingDimension,
} from '@synapse-ai/core';

// ─── Session Context ─────────────────────────────────────────────────

export interface SessionContext {
  sessionId: string;
  events: EventRow[];
  toolCounts: Map<string, number>;
  toolErrors: Map<string, number>;
  promptTexts: string[];
  totalInputTokens: number;
  totalOutputTokens: number;
  durationMs: number;
  compactionCount: number;
  model: string | null;
  eventCount: number;
  agentStartCount: number;
  agentStopCount: number;
  distinctFilesEdited: Set<string>;
  distinctFilesRead: Set<string>;
  readBeforeEditFiles: Set<string>;
  editWithoutReadFiles: Set<string>;
  bashFileOps: number;
  permissionMode: string | null;
}

// ─── Context Cache ───────────────────────────────────────────────────

const contextCache = new Map<string, { ctx: SessionContext; expiry: number }>();
const CONTEXT_TTL_MS = 60_000;

export function buildSessionContext(sessionId: string): SessionContext {
  const cached = contextCache.get(sessionId);
  if (cached && cached.expiry > Date.now()) {
    return cached.ctx;
  }

  const events = getEventsBySession(sessionId);
  if (events.length > 5000) {
    logger.warn(
      { sessionId, eventCount: events.length },
      'Session exceeds 5000 events, truncated for report card',
    );
  }
  const limited = events.slice(0, 5000);

  const toolCounts = new Map<string, number>();
  const toolErrors = new Map<string, number>();
  const promptTexts: string[] = [];
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let compactionCount = 0;
  let model: string | null = null;
  let agentStartCount = 0;
  let agentStopCount = 0;
  let permissionMode: string | null = null;
  const distinctFilesRead = new Set<string>();
  const distinctFilesEdited = new Set<string>();
  const readBeforeEditFiles = new Set<string>();
  const editWithoutReadFiles = new Set<string>();
  let bashFileOps = 0;

  const BASH_FILE_OPS = /\b(cat|head|tail|sed|awk|grep|find|ls)\b/;

  for (const evt of limited) {
    // Tool counts
    if (evt.tool_name) {
      toolCounts.set(evt.tool_name, (toolCounts.get(evt.tool_name) ?? 0) + 1);
    }

    // Tool errors
    if (evt.event_type === 'tool_error' && evt.tool_name) {
      toolErrors.set(evt.tool_name, (toolErrors.get(evt.tool_name) ?? 0) + 1);
    }

    // Tokens
    if (evt.token_input != null) totalInputTokens += evt.token_input;
    if (evt.token_output != null) totalOutputTokens += evt.token_output;

    // Model
    if (!model && evt.model) model = evt.model;

    // Compactions
    if (evt.event_type === 'compact') compactionCount++;

    // Agent tracking
    if (evt.event_type === 'agent_start') agentStartCount++;
    if (evt.event_type === 'agent_stop') agentStopCount++;

    // Prompts
    if (evt.event_type === 'user_prompt') {
      try {
        const raw = JSON.parse(evt.raw_payload);
        if (raw.prompt) promptTexts.push(raw.prompt);
      } catch {
        /* ignore */
      }
    }

    // Permission mode
    if (!permissionMode) {
      try {
        const raw = JSON.parse(evt.raw_payload);
        if (raw.permission_mode) permissionMode = raw.permission_mode;
      } catch {
        /* ignore */
      }
    }

    // File tracking
    if (evt.tool_name && evt.tool_input) {
      try {
        const input = JSON.parse(evt.tool_input);
        const filePath = input.file_path || input.path;
        if (filePath && typeof filePath === 'string') {
          if (evt.tool_name === 'Read' || evt.tool_name === 'Glob' || evt.tool_name === 'Grep') {
            distinctFilesRead.add(filePath);
          }
          if (evt.tool_name === 'Edit' || evt.tool_name === 'Write') {
            distinctFilesEdited.add(filePath);
            if (distinctFilesRead.has(filePath)) {
              readBeforeEditFiles.add(filePath);
            } else {
              editWithoutReadFiles.add(filePath);
            }
          }
        }
      } catch {
        /* ignore */
      }
    }

    // Bash file ops detection
    if (evt.tool_name === 'Bash' && evt.tool_input) {
      try {
        const input = JSON.parse(evt.tool_input);
        const cmd = input.command || '';
        if (BASH_FILE_OPS.test(cmd)) {
          bashFileOps++;
        }
      } catch {
        /* ignore */
      }
    }
  }

  const firstTime = limited[0]?.created_at ?? 0;
  const lastTime = limited[limited.length - 1]?.created_at ?? 0;
  const durationMs = lastTime - firstTime;

  const ctx: SessionContext = {
    sessionId,
    events: limited,
    toolCounts,
    toolErrors,
    promptTexts,
    totalInputTokens,
    totalOutputTokens,
    durationMs,
    compactionCount,
    model,
    eventCount: limited.length,
    agentStartCount,
    agentStopCount,
    distinctFilesEdited,
    distinctFilesRead,
    readBeforeEditFiles,
    editWithoutReadFiles,
    bashFileOps,
    permissionMode,
  };

  contextCache.set(sessionId, { ctx, expiry: Date.now() + CONTEXT_TTL_MS });
  return ctx;
}

// ─── Dimension Configuration ─────────────────────────────────────────

interface DimensionConfig {
  dimension: CoachingDimension;
  label: string;
  weight: number;
}

const DIMENSIONS: DimensionConfig[] = [
  { dimension: 'planning', label: 'Planning & Preparation', weight: 0.15 },
  { dimension: 'precision', label: 'Prompt Precision', weight: 0.15 },
  { dimension: 'toolCraft', label: 'Tool Craft', weight: 0.12 },
  { dimension: 'contextManagement', label: 'Context Management', weight: 0.13 },
  { dimension: 'costEfficiency', label: 'Cost Efficiency', weight: 0.15 },
  { dimension: 'verification', label: 'Verification & Quality', weight: 0.12 },
  { dimension: 'sessionStrategy', label: 'Session Strategy', weight: 0.1 },
  { dimension: 'configuration', label: 'Configuration', weight: 0.08 },
];

// ─── Grade Mapping ───────────────────────────────────────────────────

function scoreToGrade(score: number): string {
  if (score >= 95) return 'A+';
  if (score >= 90) return 'A';
  if (score >= 85) return 'A-';
  if (score >= 80) return 'B+';
  if (score >= 75) return 'B';
  if (score >= 70) return 'B-';
  if (score >= 65) return 'C+';
  if (score >= 60) return 'C';
  if (score >= 55) return 'C-';
  if (score >= 45) return 'D';
  return 'F';
}

// ─── Detector Helper ─────────────────────────────────────────────────

function makeDetector(
  id: string,
  dimension: CoachingDimension,
  name: string,
  weight: number,
  evaluate: (ctx: SessionContext) => {
    score: number;
    passed: boolean;
    evidence?: string;
    recommendation?: string;
  },
): (ctx: SessionContext) => DetectorResult {
  return (ctx) => {
    try {
      const result = evaluate(ctx);
      return { id, dimension, name, weight, ...result };
    } catch (err) {
      logger.debug({ err, detectorId: id }, 'Detector error, scoring neutral');
      return {
        id,
        dimension,
        name,
        weight,
        score: 50,
        passed: false,
        evidence: 'Insufficient data',
      };
    }
  };
}

// ─── Detectors by Dimension ──────────────────────────────────────────

// PLANNING (5)
const planningDetectors = [
  makeDetector('planning.read-before-edit', 'planning', 'Read Before Edit', 0.25, (ctx) => {
    if (ctx.distinctFilesEdited.size === 0)
      return { score: 50, passed: true, evidence: 'No files edited' };
    const ratio = ctx.readBeforeEditFiles.size / ctx.distinctFilesEdited.size;
    const score = Math.round(ratio * 100);
    return {
      score,
      passed: ratio >= 0.8,
      evidence: `${ctx.readBeforeEditFiles.size}/${ctx.distinctFilesEdited.size} files read before edit`,
      recommendation:
        ratio < 0.8 ? 'Always read a file before editing it to avoid failed Edit calls' : undefined,
    };
  }),

  makeDetector('planning.context-frontloading', 'planning', 'Context Front-Loading', 0.2, (ctx) => {
    const readEvents = ctx.events.filter((e) => e.tool_name === 'Read');
    if (readEvents.length < 3)
      return { score: 50, passed: true, evidence: 'Too few reads to evaluate' };
    const totalEvents = ctx.events.length;
    const earlyThreshold = Math.floor(totalEvents * 0.3);
    const earlyReads = readEvents.filter((e) => {
      const idx = ctx.events.indexOf(e);
      return idx < earlyThreshold;
    }).length;
    const ratio = earlyReads / readEvents.length;
    const score = Math.round(Math.min(ratio * 1.5, 1) * 100);
    return {
      score,
      passed: ratio >= 0.5,
      evidence: `${Math.round(ratio * 100)}% of reads in first 30% of session`,
      recommendation:
        ratio < 0.5
          ? 'Front-load file reads in your first prompt to give Claude context upfront'
          : undefined,
    };
  }),

  makeDetector(
    'planning.prompt-specificity',
    'planning',
    'First Prompt Specificity',
    0.2,
    (ctx) => {
      if (ctx.promptTexts.length === 0) return { score: 50, passed: true, evidence: 'No prompts' };
      const first = ctx.promptTexts[0];
      const wordCount = first.split(/\s+/).length;
      const hasFilePath = /[a-zA-Z0-9_\-/.]+\.[a-zA-Z]+/.test(first);
      const hasConstraint = /\b(must|should|always|never|ensure|require|test|verify)\b/i.test(
        first,
      );
      let score = 30;
      if (wordCount >= 20) score += 20;
      if (wordCount >= 50) score += 10;
      if (hasFilePath) score += 20;
      if (hasConstraint) score += 20;
      return {
        score: Math.min(score, 100),
        passed: score >= 60,
        evidence: `First prompt: ${wordCount} words, ${hasFilePath ? 'has' : 'no'} file path, ${hasConstraint ? 'has' : 'no'} constraints`,
        recommendation:
          score < 60
            ? 'Include file paths, constraints, and success criteria in your first prompt'
            : undefined,
      };
    },
  ),

  makeDetector('planning.single-task-focus', 'planning', 'Single Task Focus', 0.15, (ctx) => {
    if (ctx.promptTexts.length <= 1)
      return { score: 80, passed: true, evidence: 'Single prompt session' };
    // Check for unrelated topic shifts
    const topics = ctx.promptTexts.map((p) => {
      const words = p
        .toLowerCase()
        .split(/\s+/)
        .filter((w) => w.length > 4);
      return new Set(words);
    });
    let shifts = 0;
    for (let i = 1; i < topics.length; i++) {
      const overlap = [...topics[i]].filter((w) => topics[i - 1].has(w)).length;
      const minSize = Math.min(topics[i].size, topics[i - 1].size);
      if (minSize > 0 && overlap / minSize < 0.1) shifts++;
    }
    const shiftRatio = shifts / (ctx.promptTexts.length - 1);
    const score = Math.round((1 - shiftRatio) * 100);
    return {
      score,
      passed: shiftRatio < 0.3,
      evidence: `${shifts} topic shifts across ${ctx.promptTexts.length} prompts`,
      recommendation:
        shiftRatio >= 0.3
          ? 'Start a new session for each distinct task to keep context focused'
          : undefined,
    };
  }),

  makeDetector('planning.plan-mode-used', 'planning', 'Plan Mode Used', 0.2, (ctx) => {
    const usedPlan = ctx.permissionMode === 'plan';
    const multiFile = ctx.distinctFilesEdited.size >= 3;
    if (!multiFile)
      return {
        score: 75,
        passed: true,
        evidence: "Task doesn't require plan mode (< 3 files edited)",
      };
    return {
      score: usedPlan ? 100 : 30,
      passed: usedPlan,
      evidence: usedPlan
        ? 'Plan mode was used for multi-file changes'
        : `Edited ${ctx.distinctFilesEdited.size} files without plan mode`,
      recommendation: !usedPlan
        ? 'Use Plan Mode (Shift+Tab twice) before tasks that touch 3+ files'
        : undefined,
    };
  }),
];

// PRECISION (5)
const precisionDetectors = [
  makeDetector(
    'precision.one-concern-per-prompt',
    'precision',
    'One Concern Per Prompt',
    0.2,
    (ctx) => {
      if (ctx.promptTexts.length === 0) return { score: 50, passed: true, evidence: 'No prompts' };
      const multiConcern = ctx.promptTexts.filter((p) => {
        const sentences = p.split(/[.!?]+/).filter((s) => s.trim().length > 10);
        const hasList = /\d+\.\s|[-*]\s/.test(p);
        return sentences.length > 4 || (hasList && sentences.length > 2);
      });
      const ratio = 1 - multiConcern.length / ctx.promptTexts.length;
      const score = Math.round(ratio * 100);
      return {
        score,
        passed: ratio >= 0.7,
        evidence: `${multiConcern.length}/${ctx.promptTexts.length} prompts had multiple concerns`,
        recommendation:
          ratio < 0.7 ? 'Break complex requests into one prompt per concern' : undefined,
      };
    },
  ),

  makeDetector(
    'precision.verification-in-prompt',
    'precision',
    'Verification in Prompt',
    0.2,
    (ctx) => {
      if (ctx.promptTexts.length === 0) return { score: 50, passed: true, evidence: 'No prompts' };
      const withVerification = ctx.promptTexts.filter((p) =>
        /\b(test|verify|check|ensure|confirm|validate|run.*test|build)\b/i.test(p),
      );
      const ratio = withVerification.length / ctx.promptTexts.length;
      const score = Math.round(Math.min(ratio * 2, 1) * 100);
      return {
        score,
        passed: ratio >= 0.3,
        evidence: `${withVerification.length}/${ctx.promptTexts.length} prompts included verification criteria`,
        recommendation:
          ratio < 0.3 ? 'Include "test this" or "verify that" in your prompts' : undefined,
      };
    },
  ),

  makeDetector('precision.correction-chains', 'precision', 'Low Correction Chains', 0.25, (ctx) => {
    if (ctx.promptTexts.length < 3)
      return { score: 75, passed: true, evidence: 'Too few prompts to evaluate' };
    const corrections = ctx.promptTexts.filter((p) =>
      /\b(no|wrong|actually|instead|not what|try again|undo|revert|that's not)\b/i.test(p),
    );
    const ratio = corrections.length / ctx.promptTexts.length;
    const score = Math.round((1 - ratio) * 100);
    return {
      score,
      passed: ratio < 0.25,
      evidence: `${corrections.length} correction prompts out of ${ctx.promptTexts.length}`,
      recommendation:
        ratio >= 0.25 ? 'Be more specific upfront to reduce correction cycles' : undefined,
    };
  }),

  makeDetector(
    'precision.specific-file-references',
    'precision',
    'Specific File References',
    0.2,
    (ctx) => {
      if (ctx.promptTexts.length === 0) return { score: 50, passed: true, evidence: 'No prompts' };
      const withFiles = ctx.promptTexts.filter((p) =>
        /[a-zA-Z0-9_\-/]+\.(ts|tsx|js|jsx|py|rs|go|java|css|json|md|yaml|yml|toml)/.test(p),
      );
      const ratio = withFiles.length / ctx.promptTexts.length;
      const score = Math.round(Math.min(ratio * 2, 1) * 100);
      return {
        score,
        passed: ratio >= 0.3,
        evidence: `${withFiles.length}/${ctx.promptTexts.length} prompts referenced specific files`,
        recommendation:
          ratio < 0.3
            ? 'Reference file paths in your prompts for faster, more accurate responses'
            : undefined,
      };
    },
  ),

  makeDetector(
    'precision.clear-success-criteria',
    'precision',
    'Clear Success Criteria',
    0.15,
    (ctx) => {
      if (ctx.promptTexts.length === 0) return { score: 50, passed: true, evidence: 'No prompts' };
      const withCriteria = ctx.promptTexts.filter((p) =>
        /\b(should|must|expect|return|output|result|pass|fail|error|display|render)\b/i.test(p),
      );
      const ratio = withCriteria.length / ctx.promptTexts.length;
      const score = Math.round(Math.min(ratio * 1.5, 1) * 100);
      return {
        score,
        passed: ratio >= 0.4,
        evidence: `${withCriteria.length}/${ctx.promptTexts.length} prompts had success criteria`,
        recommendation:
          ratio < 0.4
            ? 'Define expected outcomes in your prompts: "it should return X when Y"'
            : undefined,
      };
    },
  ),
];

// TOOL CRAFT (6)
const toolCraftDetectors = [
  makeDetector('toolCraft.dedicated-tools', 'toolCraft', 'Use Dedicated Tools', 0.25, (ctx) => {
    const totalTools = Array.from(ctx.toolCounts.values()).reduce((a, b) => a + b, 0);
    if (totalTools === 0) return { score: 50, passed: true, evidence: 'No tool calls' };
    const ratio = ctx.bashFileOps / totalTools;
    const score = Math.round((1 - ratio * 3) * 100);
    return {
      score: Math.max(0, Math.min(100, score)),
      passed: ratio < 0.1,
      evidence: `${ctx.bashFileOps} Bash file ops out of ${totalTools} total tool calls`,
      recommendation:
        ratio >= 0.1 ? 'Use Read/Edit/Grep/Glob instead of Bash for file operations' : undefined,
    };
  }),

  makeDetector('toolCraft.edit-over-write', 'toolCraft', 'Edit Over Write', 0.2, (ctx) => {
    const editCount = ctx.toolCounts.get('Edit') ?? 0;
    const writeCount = ctx.toolCounts.get('Write') ?? 0;
    if (editCount + writeCount === 0)
      return { score: 50, passed: true, evidence: 'No file modifications' };
    // Write is fine for new files, but Edit should dominate for existing files
    const editRatio = editCount / (editCount + writeCount);
    const score = Math.round(Math.min(editRatio * 1.3, 1) * 100);
    return {
      score,
      passed: editRatio >= 0.6,
      evidence: `${editCount} Edits vs ${writeCount} Writes`,
      recommendation:
        editRatio < 0.6
          ? 'Prefer Edit over Write for existing files to preserve surrounding code'
          : undefined,
    };
  }),

  makeDetector('toolCraft.subagent-usage', 'toolCraft', 'Subagent Usage', 0.15, (ctx) => {
    const totalTokens = ctx.totalInputTokens + ctx.totalOutputTokens;
    if (totalTokens < 50_000)
      return { score: 75, passed: true, evidence: 'Session too small to benefit from subagents' };
    const used = ctx.agentStartCount > 0;
    return {
      score: used ? 90 : 40,
      passed: used,
      evidence: used
        ? `${ctx.agentStartCount} subagents used`
        : 'No subagents used in a large session',
      recommendation: !used
        ? 'Use Task tool with subagents for parallel research in large sessions'
        : undefined,
    };
  }),

  makeDetector('toolCraft.bash-minimization', 'toolCraft', 'Bash Minimization', 0.15, (ctx) => {
    const bashCount = ctx.toolCounts.get('Bash') ?? 0;
    const totalTools = Array.from(ctx.toolCounts.values()).reduce((a, b) => a + b, 0);
    if (totalTools === 0) return { score: 50, passed: true, evidence: 'No tool calls' };
    const ratio = bashCount / totalTools;
    // Some Bash is expected (git, npm, test commands), but > 40% is excessive
    const score = Math.round((1 - Math.max(0, ratio - 0.3) * 3) * 100);
    return {
      score: Math.max(0, Math.min(100, score)),
      passed: ratio < 0.4,
      evidence: `${bashCount}/${totalTools} calls were Bash (${Math.round(ratio * 100)}%)`,
      recommendation:
        ratio >= 0.4
          ? 'Use dedicated tools (Read, Edit, Grep, Glob) instead of Bash where possible'
          : undefined,
    };
  }),

  makeDetector('toolCraft.tool-error-rate', 'toolCraft', 'Low Tool Error Rate', 0.15, (ctx) => {
    const totalErrors = Array.from(ctx.toolErrors.values()).reduce((a, b) => a + b, 0);
    const totalTools = Array.from(ctx.toolCounts.values()).reduce((a, b) => a + b, 0);
    if (totalTools === 0) return { score: 50, passed: true, evidence: 'No tool calls' };
    const errorRate = totalErrors / totalTools;
    const score = Math.round((1 - errorRate * 5) * 100);
    return {
      score: Math.max(0, Math.min(100, score)),
      passed: errorRate < 0.1,
      evidence: `${totalErrors} errors in ${totalTools} tool calls (${Math.round(errorRate * 100)}%)`,
      recommendation:
        errorRate >= 0.1
          ? 'High error rate suggests prompts may be imprecise or context is stale'
          : undefined,
    };
  }),

  makeDetector('toolCraft.incremental-edits', 'toolCraft', 'Incremental Edits', 0.1, (ctx) => {
    const editCount = ctx.toolCounts.get('Edit') ?? 0;
    const writeCount = ctx.toolCounts.get('Write') ?? 0;
    const totalMods = editCount + writeCount;
    if (totalMods < 3) return { score: 70, passed: true, evidence: 'Too few edits to evaluate' };
    // Check if edits are incremental (many small edits) vs monolithic (few large writes)
    const score = editCount > writeCount * 2 ? 90 : writeCount > editCount ? 40 : 65;
    return {
      score,
      passed: score >= 60,
      evidence: `${editCount} incremental edits, ${writeCount} full writes`,
      recommendation:
        score < 60 ? 'Make incremental edits rather than rewriting entire files' : undefined,
    };
  }),
];

// CONTEXT MANAGEMENT (5)
const contextManagementDetectors = [
  makeDetector(
    'contextManagement.compaction-avoidance',
    'contextManagement',
    'Compaction Avoidance',
    0.25,
    (ctx) => {
      if (ctx.durationMs < 600_000)
        return { score: 80, passed: true, evidence: 'Short session (< 10 min)' };
      const score =
        ctx.compactionCount === 0
          ? 100
          : ctx.compactionCount === 1
            ? 70
            : Math.max(20, 70 - ctx.compactionCount * 15);
      return {
        score,
        passed: ctx.compactionCount <= 1,
        evidence: `${ctx.compactionCount} compaction events`,
        recommendation:
          ctx.compactionCount > 1
            ? 'Use /clear between tasks or start new sessions to avoid auto-compaction'
            : undefined,
      };
    },
  ),

  makeDetector(
    'contextManagement.clear-between-tasks',
    'contextManagement',
    'Clear Between Tasks',
    0.2,
    (ctx) => {
      if (ctx.promptTexts.length < 5)
        return { score: 70, passed: true, evidence: 'Too few prompts to evaluate' };
      // If many prompts and zero compactions and zero clear events, that's good context management
      const hasClear = ctx.events.some((e) => {
        try {
          const raw = JSON.parse(e.raw_payload);
          return raw.source === 'clear';
        } catch {
          return false;
        }
      });
      if (ctx.compactionCount === 0 && !hasClear) {
        return { score: 80, passed: true, evidence: 'Session stayed within context limits' };
      }
      if (hasClear) {
        return { score: 90, passed: true, evidence: 'Used /clear proactively' };
      }
      return {
        score: 50,
        passed: false,
        evidence: 'Session compacted without prior /clear',
        recommendation: 'Use /clear between distinct tasks to manage context proactively',
      };
    },
  ),

  makeDetector(
    'contextManagement.context-utilization',
    'contextManagement',
    'Context Utilization',
    0.2,
    (ctx) => {
      const totalTokens = ctx.totalInputTokens + ctx.totalOutputTokens;
      if (totalTokens === 0) return { score: 50, passed: true, evidence: 'No token data' };
      // Good utilization: prompts > 5, tokens used productively
      const promptsPerToken = ctx.promptTexts.length / (totalTokens / 1000);
      const score = Math.round(Math.min(promptsPerToken * 50, 100));
      return {
        score: Math.max(30, Math.min(100, score)),
        passed: score >= 50,
        evidence: `${ctx.promptTexts.length} prompts using ${Math.round(totalTokens / 1000)}K tokens`,
      };
    },
  ),

  makeDetector(
    'contextManagement.file-rereading',
    'contextManagement',
    'Minimal File Re-Reading',
    0.2,
    (ctx) => {
      // Count files read more than twice
      const readCounts = new Map<string, number>();
      for (const evt of ctx.events) {
        if (evt.tool_name === 'Read' && evt.tool_input) {
          try {
            const input = JSON.parse(evt.tool_input);
            const fp = input.file_path;
            if (fp) readCounts.set(fp, (readCounts.get(fp) ?? 0) + 1);
          } catch {
            /* ignore */
          }
        }
      }
      const reReads = [...readCounts.values()].filter((c) => c > 2).length;
      const totalFiles = readCounts.size;
      if (totalFiles === 0) return { score: 70, passed: true, evidence: 'No file reads' };
      const ratio = reReads / totalFiles;
      const score = Math.round((1 - ratio) * 100);
      return {
        score,
        passed: ratio < 0.2,
        evidence: `${reReads}/${totalFiles} files read 3+ times`,
        recommendation:
          ratio >= 0.2
            ? 'Reduce re-reading by front-loading all needed files in early prompts'
            : undefined,
      };
    },
  ),

  makeDetector(
    'contextManagement.focused-scope',
    'contextManagement',
    'Focused Scope',
    0.15,
    (ctx) => {
      const filesAccessed = new Set([...ctx.distinctFilesRead, ...ctx.distinctFilesEdited]);
      if (filesAccessed.size <= 10)
        return { score: 85, passed: true, evidence: `${filesAccessed.size} files accessed` };
      // Sessions touching > 20 files may be too broad
      const score = filesAccessed.size <= 15 ? 70 : filesAccessed.size <= 25 ? 50 : 30;
      return {
        score,
        passed: filesAccessed.size <= 15,
        evidence: `${filesAccessed.size} distinct files accessed`,
        recommendation:
          filesAccessed.size > 15
            ? 'Keep sessions focused; break large tasks into multiple sessions'
            : undefined,
      };
    },
  ),
];

// COST EFFICIENCY (6)
const costEfficiencyDetectors = [
  makeDetector('costEfficiency.model-matching', 'costEfficiency', 'Model Matching', 0.2, (ctx) => {
    if (!ctx.model) return { score: 50, passed: true, evidence: 'No model info' };
    const isOpus = ctx.model.includes('opus');
    const totalTokens = ctx.totalInputTokens + ctx.totalOutputTokens;
    // Opus for small tasks is wasteful
    if (isOpus && totalTokens < 20_000 && ctx.promptTexts.length <= 2) {
      return {
        score: 40,
        passed: false,
        evidence: `Using Opus for a ${Math.round(totalTokens / 1000)}K token task`,
        recommendation: 'Use Sonnet for simple tasks; reserve Opus for complex multi-file work',
      };
    }
    return {
      score: 80,
      passed: true,
      evidence: `Model ${ctx.model} appropriate for session complexity`,
    };
  }),

  makeDetector(
    'costEfficiency.cache-utilization',
    'costEfficiency',
    'Cache Utilization',
    0.15,
    (ctx) => {
      // We can only infer this from token patterns
      if (ctx.totalInputTokens === 0) return { score: 50, passed: true, evidence: 'No token data' };
      // Good cache usage means input tokens don't grow linearly with prompts
      const avgInputPerPrompt =
        ctx.promptTexts.length > 0 ? ctx.totalInputTokens / ctx.promptTexts.length : 0;
      const score = avgInputPerPrompt < 5000 ? 90 : avgInputPerPrompt < 15000 ? 70 : 50;
      return {
        score,
        passed: score >= 60,
        evidence: `Avg ${Math.round(avgInputPerPrompt)} input tokens per prompt`,
      };
    },
  ),

  makeDetector('costEfficiency.token-budget', 'costEfficiency', 'Token Budget', 0.2, (ctx) => {
    const totalTokens = ctx.totalInputTokens + ctx.totalOutputTokens;
    if (totalTokens === 0) return { score: 50, passed: true, evidence: 'No token data' };
    // Evaluate output/input ratio — high output ratios suggest verbose responses
    const ratio = ctx.totalOutputTokens / Math.max(ctx.totalInputTokens, 1);
    const score = ratio < 0.5 ? 90 : ratio < 1.0 ? 75 : ratio < 2.0 ? 55 : 35;
    return {
      score,
      passed: ratio < 1.0,
      evidence: `Output/input ratio: ${ratio.toFixed(2)} (${Math.round(ctx.totalOutputTokens / 1000)}K out / ${Math.round(ctx.totalInputTokens / 1000)}K in)`,
      recommendation:
        ratio >= 1.0
          ? 'Ask Claude to be concise or limit output scope to reduce token usage'
          : undefined,
    };
  }),

  makeDetector(
    'costEfficiency.incremental-testing',
    'costEfficiency',
    'Incremental Testing',
    0.15,
    (ctx) => {
      // Check if tests are run after edits, not all at the end
      const editEvents = ctx.events.filter(
        (e) => e.tool_name === 'Edit' || e.tool_name === 'Write',
      );
      const testEvents = ctx.events.filter((e) => {
        if (e.tool_name !== 'Bash') return false;
        try {
          const input = JSON.parse(e.tool_input ?? '{}');
          return /\b(test|jest|vitest|pytest|cargo test|go test|npm test|pnpm test)\b/i.test(
            input.command ?? '',
          );
        } catch {
          return false;
        }
      });
      if (editEvents.length < 3)
        return { score: 70, passed: true, evidence: 'Few edits in session' };
      if (testEvents.length === 0)
        return {
          score: 30,
          passed: false,
          evidence: 'No tests run',
          recommendation: 'Run tests incrementally after edits',
        };
      // Check distribution of test runs relative to edits
      const testAfterEdits = testEvents.filter(
        (t) => ctx.events.indexOf(t) > ctx.events.indexOf(editEvents[0]),
      );
      const ratio = testAfterEdits.length / editEvents.length;
      const score = Math.round(Math.min(ratio * 200, 100));
      return {
        score: Math.max(30, score),
        passed: testAfterEdits.length > 0,
        evidence: `${testAfterEdits.length} test runs after ${editEvents.length} edits`,
      };
    },
  ),

  makeDetector('costEfficiency.output-control', 'costEfficiency', 'Output Control', 0.15, (ctx) => {
    if (ctx.totalOutputTokens === 0) return { score: 50, passed: true, evidence: 'No output data' };
    const avgOutputPerPrompt =
      ctx.promptTexts.length > 0 ? ctx.totalOutputTokens / ctx.promptTexts.length : 0;
    const score =
      avgOutputPerPrompt < 2000
        ? 90
        : avgOutputPerPrompt < 5000
          ? 70
          : avgOutputPerPrompt < 10000
            ? 50
            : 30;
    return {
      score,
      passed: avgOutputPerPrompt < 5000,
      evidence: `Avg ${Math.round(avgOutputPerPrompt)} output tokens per prompt`,
      recommendation:
        avgOutputPerPrompt >= 5000 ? 'Ask Claude to be concise or focus output scope' : undefined,
    };
  }),

  makeDetector(
    'costEfficiency.large-file-editing',
    'costEfficiency',
    'Efficient Large File Editing',
    0.15,
    (ctx) => {
      // Check for Edit calls on files where Read returned many lines
      let largeFileEdits = 0;
      let totalEdits = 0;
      for (const evt of ctx.events) {
        if (evt.tool_name === 'Edit') {
          totalEdits++;
          // Check if the file was large based on prior Read
          try {
            const input = JSON.parse(evt.tool_input ?? '{}');
            const fp = input.file_path;
            if (fp) {
              // Look for prior Read of same file
              const priorRead = ctx.events.find(
                (e) =>
                  e.tool_name === 'Read' &&
                  e.created_at < evt.created_at &&
                  e.tool_input?.includes(fp) &&
                  e.tool_response,
              );
              if (priorRead?.tool_response) {
                const resp = JSON.parse(priorRead.tool_response);
                const lineCount =
                  resp.line_count ?? (typeof resp === 'string' ? resp.split('\n').length : 0);
                if (lineCount > 1000) largeFileEdits++;
              }
            }
          } catch {
            /* ignore */
          }
        }
      }
      if (totalEdits === 0) return { score: 70, passed: true, evidence: 'No edits to evaluate' };
      const score = largeFileEdits === 0 ? 90 : largeFileEdits <= 2 ? 65 : 40;
      return {
        score,
        passed: largeFileEdits <= 2,
        evidence: `${largeFileEdits} edits on files >1000 lines`,
        recommendation:
          largeFileEdits > 2
            ? 'Break large files into smaller modules, or use line offsets when reading'
            : undefined,
      };
    },
  ),
];

// VERIFICATION (5)
const verificationDetectors = [
  makeDetector('verification.test-after-edit', 'verification', 'Test After Edit', 0.25, (ctx) => {
    const editEvents = ctx.events.filter((e) => e.tool_name === 'Edit' || e.tool_name === 'Write');
    if (editEvents.length === 0)
      return { score: 70, passed: true, evidence: 'No edits in session' };
    const testEvents = ctx.events.filter((e) => {
      if (e.tool_name !== 'Bash') return false;
      try {
        const input = JSON.parse(e.tool_input ?? '{}');
        return /\b(test|jest|vitest|pytest|cargo test|go test|npm test|pnpm test)\b/i.test(
          input.command ?? '',
        );
      } catch {
        return false;
      }
    });
    if (testEvents.length === 0) {
      return {
        score: 20,
        passed: false,
        evidence: `${editEvents.length} edits, no test runs`,
        recommendation: 'Always run tests after making changes',
      };
    }
    const lastEdit = editEvents[editEvents.length - 1];
    const testAfterLastEdit = testEvents.some((t) => t.created_at > lastEdit.created_at);
    return {
      score: testAfterLastEdit ? 90 : 50,
      passed: testAfterLastEdit,
      evidence: testAfterLastEdit
        ? 'Tests run after final edit'
        : 'Tests were run, but not after the last edit',
      recommendation: !testAfterLastEdit
        ? 'Run tests after your final edit to verify the complete change'
        : undefined,
    };
  }),

  makeDetector('verification.reviewer-subagent', 'verification', 'Review Subagent', 0.15, (ctx) => {
    const hasReviewer = ctx.events.some(
      (e) =>
        e.agent_type?.toLowerCase().includes('review') ||
        e.agent_type?.toLowerCase().includes('code-reviewer'),
    );
    const totalTokens = ctx.totalInputTokens + ctx.totalOutputTokens;
    if (totalTokens < 30_000)
      return { score: 70, passed: true, evidence: 'Session too small to need reviewer' };
    return {
      score: hasReviewer ? 95 : 50,
      passed: hasReviewer,
      evidence: hasReviewer ? 'Code reviewer subagent was used' : 'No review step in large session',
      recommendation: !hasReviewer ? 'Use a code-reviewer subagent for complex changes' : undefined,
    };
  }),

  makeDetector('verification.quality-gates', 'verification', 'Quality Gates', 0.2, (ctx) => {
    // Check for build/lint/type-check commands
    const qualityCommands = ctx.events.filter((e) => {
      if (e.tool_name !== 'Bash') return false;
      try {
        const input = JSON.parse(e.tool_input ?? '{}');
        return /\b(build|lint|eslint|tsc|type-?check|prettier|format)\b/i.test(input.command ?? '');
      } catch {
        return false;
      }
    });
    const editCount = (ctx.toolCounts.get('Edit') ?? 0) + (ctx.toolCounts.get('Write') ?? 0);
    if (editCount === 0) return { score: 70, passed: true, evidence: 'No edits to verify' };
    const score = qualityCommands.length > 0 ? 85 : 35;
    return {
      score,
      passed: qualityCommands.length > 0,
      evidence: `${qualityCommands.length} quality gate commands run`,
      recommendation:
        qualityCommands.length === 0
          ? 'Run build/lint/typecheck after edits to catch errors early'
          : undefined,
    };
  }),

  makeDetector('verification.error-recovery', 'verification', 'Error Recovery', 0.2, (ctx) => {
    const totalErrors = Array.from(ctx.toolErrors.values()).reduce((a, b) => a + b, 0);
    if (totalErrors === 0)
      return { score: 90, passed: true, evidence: 'No errors to recover from' };
    // Check if errors were followed by successful retries
    let recoveredErrors = 0;
    for (let i = 0; i < ctx.events.length; i++) {
      const evt = ctx.events[i];
      if (evt.event_type === 'tool_error' && evt.tool_name) {
        // Look for a successful call to the same tool within the next 5 events
        for (let j = i + 1; j < Math.min(i + 6, ctx.events.length); j++) {
          if (ctx.events[j].tool_name === evt.tool_name && ctx.events[j].status === 'success') {
            recoveredErrors++;
            break;
          }
        }
      }
    }
    const recoveryRate = recoveredErrors / totalErrors;
    const score = Math.round(recoveryRate * 100);
    return {
      score: Math.max(30, score),
      passed: recoveryRate >= 0.5,
      evidence: `${recoveredErrors}/${totalErrors} errors recovered from`,
    };
  }),

  makeDetector('verification.build-checks', 'verification', 'Build Checks', 0.2, (ctx) => {
    const buildCommands = ctx.events.filter((e) => {
      if (e.tool_name !== 'Bash') return false;
      try {
        const input = JSON.parse(e.tool_input ?? '{}');
        return /\b(build|compile|tsc)\b/i.test(input.command ?? '');
      } catch {
        return false;
      }
    });
    const editCount = (ctx.toolCounts.get('Edit') ?? 0) + (ctx.toolCounts.get('Write') ?? 0);
    if (editCount < 3)
      return { score: 70, passed: true, evidence: 'Few edits, build check optional' };
    return {
      score: buildCommands.length > 0 ? 85 : 40,
      passed: buildCommands.length > 0,
      evidence:
        buildCommands.length > 0
          ? `${buildCommands.length} build commands run`
          : 'No build verification',
      recommendation:
        buildCommands.length === 0
          ? 'Run a build command to verify TypeScript compilation'
          : undefined,
    };
  }),
];

// SESSION STRATEGY (5)
const sessionStrategyDetectors = [
  makeDetector(
    'sessionStrategy.single-task',
    'sessionStrategy',
    'Single Task Session',
    0.25,
    (ctx) => {
      // Long sessions with many prompts suggest task sprawl
      if (ctx.promptTexts.length <= 5)
        return { score: 85, passed: true, evidence: 'Focused session' };
      if (ctx.promptTexts.length <= 10)
        return { score: 70, passed: true, evidence: `${ctx.promptTexts.length} prompts` };
      return {
        score: Math.max(30, 80 - ctx.promptTexts.length * 3),
        passed: false,
        evidence: `${ctx.promptTexts.length} prompts — consider splitting into focused sessions`,
        recommendation: 'Keep sessions to one task; use /clear or new sessions for distinct work',
      };
    },
  ),

  makeDetector(
    'sessionStrategy.frustration-detection',
    'sessionStrategy',
    'Low Frustration',
    0.2,
    (ctx) => {
      const frustrationPatterns = ctx.promptTexts.filter((p) =>
        /\b(no|wrong|ugh|stop|undo|revert|start over|why|that's not right)\b/i.test(p),
      );
      const ratio =
        ctx.promptTexts.length > 0 ? frustrationPatterns.length / ctx.promptTexts.length : 0;
      const score = Math.round((1 - ratio * 2) * 100);
      return {
        score: Math.max(20, Math.min(100, score)),
        passed: ratio < 0.2,
        evidence: `${frustrationPatterns.length} frustration signals in ${ctx.promptTexts.length} prompts`,
        recommendation:
          ratio >= 0.2
            ? 'High correction rate suggests prompts need more clarity upfront'
            : undefined,
      };
    },
  ),

  makeDetector(
    'sessionStrategy.session-length',
    'sessionStrategy',
    'Optimal Session Length',
    0.2,
    (ctx) => {
      const minutes = ctx.durationMs / 60_000;
      if (minutes < 5)
        return { score: 70, passed: true, evidence: `${Math.round(minutes)} min session` };
      if (minutes <= 30)
        return { score: 90, passed: true, evidence: `${Math.round(minutes)} min — optimal length` };
      if (minutes <= 60)
        return {
          score: 70,
          passed: true,
          evidence: `${Math.round(minutes)} min — approaching limit`,
        };
      return {
        score: Math.max(20, 70 - Math.round((minutes - 60) / 5)),
        passed: false,
        evidence: `${Math.round(minutes)} min session — consider splitting`,
        recommendation: 'Sessions over 60 minutes often benefit from a fresh start with /clear',
      };
    },
  ),

  makeDetector('sessionStrategy.warm-start', 'sessionStrategy', 'Warm Start', 0.15, (ctx) => {
    // Check if session was resumed rather than cold-started
    const isResume = ctx.events.some((e) => {
      try {
        const raw = JSON.parse(e.raw_payload);
        return raw.source === 'resume' || raw.source === 'continue';
      } catch {
        return false;
      }
    });
    return {
      score: isResume ? 85 : 65,
      passed: true,
      evidence: isResume ? 'Session resumed (warm start)' : 'Fresh session start',
    };
  }),

  makeDetector(
    'sessionStrategy.continue-usage',
    'sessionStrategy',
    'Continue Usage',
    0.2,
    (ctx) => {
      // Check if /continue was used (session source = continue)
      const usedContinue = ctx.events.some((e) => {
        try {
          const raw = JSON.parse(e.raw_payload);
          return raw.source === 'continue';
        } catch {
          return false;
        }
      });
      if (ctx.compactionCount === 0)
        return { score: 75, passed: true, evidence: 'No compactions (continue not needed)' };
      return {
        score: usedContinue ? 90 : 50,
        passed: usedContinue || ctx.compactionCount === 0,
        evidence: usedContinue
          ? 'Used /continue to preserve context'
          : `${ctx.compactionCount} compactions without /continue`,
        recommendation:
          !usedContinue && ctx.compactionCount > 0
            ? 'Use /continue to resume with full context after compaction'
            : undefined,
      };
    },
  ),
];

// CONFIGURATION (4)
const configurationDetectors = [
  makeDetector(
    'configuration.claude-md-present',
    'configuration',
    'CLAUDE.md Present',
    0.3,
    (ctx) => {
      // Check for CLAUDE.md indicators in session events
      const hasClaude = ctx.events.some((e) => {
        if (e.tool_name === 'Read' && e.tool_input) {
          try {
            const input = JSON.parse(e.tool_input);
            return (input.file_path ?? '').includes('CLAUDE.md');
          } catch {
            return false;
          }
        }
        return false;
      });
      // Also check for claudeMd in raw payloads (session context)
      const hasClaudeContext = ctx.events.some((e) => {
        try {
          return e.raw_payload.includes('claudeMd') || e.raw_payload.includes('CLAUDE.md');
        } catch {
          return false;
        }
      });
      const present = hasClaude || hasClaudeContext;
      return {
        score: present ? 90 : 40,
        passed: present,
        evidence: present ? 'CLAUDE.md detected in session' : 'No CLAUDE.md found',
        recommendation: !present
          ? 'Create a CLAUDE.md file with project conventions and constraints'
          : undefined,
      };
    },
  ),

  makeDetector('configuration.hooks-active', 'configuration', 'Hooks Active', 0.25, (ctx) => {
    const hasHookEvents = ctx.events.some((e) => e.hook_event_name !== 'openclaw');
    return {
      score: hasHookEvents ? 90 : 50,
      passed: hasHookEvents,
      evidence: hasHookEvents
        ? 'Hook events detected'
        : 'No hook events — hooks may not be configured',
      recommendation: !hasHookEvents
        ? 'Configure Claude Code hooks for automatic event monitoring'
        : undefined,
    };
  }),

  makeDetector('configuration.custom-commands', 'configuration', 'Custom Commands', 0.2, (ctx) => {
    // Check for repeated prompt patterns that could be custom commands
    if (ctx.promptTexts.length < 3)
      return { score: 60, passed: true, evidence: 'Too few prompts to evaluate' };
    // This is a simple heuristic — look for slash commands
    const slashCommands = ctx.promptTexts.filter((p) => /^\/[a-z]/.test(p.trim()));
    return {
      score: slashCommands.length > 0 ? 85 : 60,
      passed: true,
      evidence: `${slashCommands.length} slash commands used`,
    };
  }),

  makeDetector('configuration.permission-mode', 'configuration', 'Permission Mode', 0.25, (ctx) => {
    if (!ctx.permissionMode)
      return { score: 50, passed: true, evidence: 'No permission mode data' };
    // acceptEdits or bypassPermissions for trusted projects is efficient
    const efficient = ctx.permissionMode !== 'default';
    return {
      score: efficient ? 85 : 55,
      passed: true,
      evidence: `Permission mode: ${ctx.permissionMode}`,
      recommendation: !efficient
        ? 'Consider using acceptEdits mode for trusted projects to reduce permission prompts'
        : undefined,
    };
  }),
];

// ─── All Detectors ───────────────────────────────────────────────────

const ALL_DETECTORS: Array<(ctx: SessionContext) => DetectorResult> = [
  ...planningDetectors,
  ...precisionDetectors,
  ...toolCraftDetectors,
  ...contextManagementDetectors,
  ...costEfficiencyDetectors,
  ...verificationDetectors,
  ...sessionStrategyDetectors,
  ...configurationDetectors,
];

// ─── Shared: Compute from Context ────────────────────────────────────

function computeFromContext(ctx: SessionContext, cacheKey: string): ReportCard {
  const startTime = Date.now();

  // Run all detectors
  const results = ALL_DETECTORS.map((d) => d(ctx));

  // Compute dimension scores
  const dimensions: DimensionScore[] = DIMENSIONS.map((dim) => {
    const dimResults = results.filter((r) => r.dimension === dim.dimension);
    if (dimResults.length === 0) {
      return {
        dimension: dim.dimension,
        score: 50,
        label: dim.label,
        detectors: [],
        recommendation: 'Insufficient data for this dimension',
      };
    }

    const totalWeight = dimResults.reduce((sum, r) => sum + r.weight, 0);
    const weightedScore = dimResults.reduce((sum, r) => sum + r.score * r.weight, 0);
    const score = Math.round(totalWeight > 0 ? weightedScore / totalWeight : 50);

    const lowestScoring = [...dimResults].sort((a, b) => a.score - b.score)[0];
    const recommendation = lowestScoring?.recommendation ?? `${dim.label} is performing well`;

    return {
      dimension: dim.dimension,
      score,
      label: dim.label,
      detectors: dimResults,
      recommendation,
    };
  });

  // Compute overall score
  const totalDimWeight = DIMENSIONS.reduce((sum, d) => sum + d.weight, 0);
  const overallScore = Math.round(
    dimensions.reduce((sum, dim) => {
      const config = DIMENSIONS.find((d) => d.dimension === dim.dimension)!;
      return sum + dim.score * config.weight;
    }, 0) / totalDimWeight,
  );

  const grade = scoreToGrade(overallScore);
  const summary = generateSummary(dimensions, overallScore, grade, ctx);
  const topStrengths = dimensions
    .filter((d) => d.score >= 80)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map((d) => `${d.label}: ${d.score}/100`);
  const topImprovements = dimensions
    .filter((d) => d.score < 70)
    .sort((a, b) => a.score - b.score)
    .slice(0, 3)
    .map((d) => `${d.label}: ${d.recommendation}`);

  const reportCard: ReportCard = {
    sessionId: cacheKey,
    computedAt: Date.now(),
    overallScore,
    grade,
    dimensions,
    summary,
    topStrengths,
    topImprovements,
  };

  // Cache in DB
  upsertReportCard({
    session_id: cacheKey,
    computed_at: reportCard.computedAt,
    overall_score: overallScore,
    dimension_scores: JSON.stringify(dimensions),
    detector_results: JSON.stringify(results),
    summary,
  });

  const elapsedMs = Date.now() - startTime;
  logger.info({ sessionId: cacheKey, overallScore, grade, elapsedMs }, 'Report card computed');

  return reportCard;
}

// ─── Compute Report Card (single session) ────────────────────────────

export function computeReportCard(sessionId: string): ReportCard {
  const cached = getCachedReportCard(sessionId);
  if (cached) {
    logger.debug({ sessionId }, 'Report card cache hit');
    return rowToReportCard(cached);
  }
  const ctx = buildSessionContext(sessionId);
  return computeFromContext(ctx, sessionId);
}

// ─── Compute Multi-Session Report Card ───────────────────────────────

export function computeMultiReportCard(sessionIds: string[]): ReportCard {
  const sorted = [...sessionIds].sort();
  const cacheKey = sorted.join('+');

  const cached = getCachedReportCard(cacheKey);
  if (cached) {
    logger.debug({ cacheKey, count: sorted.length }, 'Multi report card cache hit');
    return rowToReportCard(cached);
  }

  const ctx = buildMultiSessionContext(sorted);
  return computeFromContext(ctx, cacheKey);
}

// ─── Multi-Session Context Builder ───────────────────────────────────

function buildMultiSessionContext(sessionIds: string[]): SessionContext {
  const cacheKey = sessionIds.join('+');
  const cached = contextCache.get(cacheKey);
  if (cached && cached.expiry > Date.now()) {
    return cached.ctx;
  }

  const eventsBySession = getEventsBySessionIds(sessionIds);
  const allEvents: EventRow[] = [];
  for (const events of eventsBySession.values()) {
    allEvents.push(...events);
  }
  allEvents.sort((a, b) => a.created_at - b.created_at);

  if (allEvents.length > 5000) {
    logger.warn(
      { sessionIds, eventCount: allEvents.length },
      'Multi-session exceeds 5000 events, truncated',
    );
  }
  const limited = allEvents.slice(0, 5000);

  // Build context using same logic as buildSessionContext
  const toolCounts = new Map<string, number>();
  const toolErrors = new Map<string, number>();
  const promptTexts: string[] = [];
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let compactionCount = 0;
  const modelCounts = new Map<string, number>();
  let agentStartCount = 0;
  let agentStopCount = 0;
  let permissionMode: string | null = null;
  const distinctFilesRead = new Set<string>();
  const distinctFilesEdited = new Set<string>();
  const readBeforeEditFiles = new Set<string>();
  const editWithoutReadFiles = new Set<string>();
  let bashFileOps = 0;

  const BASH_FILE_OPS = /\b(cat|head|tail|sed|awk|grep|find|ls)\b/;

  for (const evt of limited) {
    if (evt.tool_name) {
      toolCounts.set(evt.tool_name, (toolCounts.get(evt.tool_name) ?? 0) + 1);
    }
    if (evt.event_type === 'tool_error' && evt.tool_name) {
      toolErrors.set(evt.tool_name, (toolErrors.get(evt.tool_name) ?? 0) + 1);
    }
    if (evt.token_input != null) totalInputTokens += evt.token_input;
    if (evt.token_output != null) totalOutputTokens += evt.token_output;
    if (evt.model) {
      modelCounts.set(evt.model, (modelCounts.get(evt.model) ?? 0) + 1);
    }
    if (evt.event_type === 'compact') compactionCount++;
    if (evt.event_type === 'agent_start') agentStartCount++;
    if (evt.event_type === 'agent_stop') agentStopCount++;

    if (evt.event_type === 'user_prompt') {
      try {
        const raw = JSON.parse(evt.raw_payload);
        if (raw.prompt) promptTexts.push(raw.prompt);
      } catch {
        /* ignore */
      }
    }

    if (!permissionMode) {
      try {
        const raw = JSON.parse(evt.raw_payload);
        if (raw.permission_mode) permissionMode = raw.permission_mode;
      } catch {
        /* ignore */
      }
    }

    if (evt.tool_name && evt.tool_input) {
      try {
        const input = JSON.parse(evt.tool_input);
        const filePath = input.file_path || input.path;
        if (filePath && typeof filePath === 'string') {
          if (evt.tool_name === 'Read' || evt.tool_name === 'Glob' || evt.tool_name === 'Grep') {
            distinctFilesRead.add(filePath);
          }
          if (evt.tool_name === 'Edit' || evt.tool_name === 'Write') {
            distinctFilesEdited.add(filePath);
            if (distinctFilesRead.has(filePath)) {
              readBeforeEditFiles.add(filePath);
            } else {
              editWithoutReadFiles.add(filePath);
            }
          }
        }
      } catch {
        /* ignore */
      }
    }

    if (evt.tool_name === 'Bash' && evt.tool_input) {
      try {
        const input = JSON.parse(evt.tool_input);
        const cmd = input.command || '';
        if (BASH_FILE_OPS.test(cmd)) bashFileOps++;
      } catch {
        /* ignore */
      }
    }
  }

  // Pick most frequent model
  let model: string | null = null;
  let maxModelCount = 0;
  for (const [m, count] of modelCounts) {
    if (count > maxModelCount) {
      model = m;
      maxModelCount = count;
    }
  }

  const firstTime = limited[0]?.created_at ?? 0;
  const lastTime = limited[limited.length - 1]?.created_at ?? 0;

  const ctx: SessionContext = {
    sessionId: sessionIds.join('+'),
    events: limited,
    toolCounts,
    toolErrors,
    promptTexts,
    totalInputTokens,
    totalOutputTokens,
    durationMs: lastTime - firstTime,
    compactionCount,
    model,
    eventCount: limited.length,
    agentStartCount,
    agentStopCount,
    distinctFilesEdited,
    distinctFilesRead,
    readBeforeEditFiles,
    editWithoutReadFiles,
    bashFileOps,
    permissionMode,
  };

  contextCache.set(sessionIds.join('+'), { ctx, expiry: Date.now() + CONTEXT_TTL_MS });
  return ctx;
}

// ─── Get Report Card History ─────────────────────────────────────────

export function getReportCardHistory(from: number, to: number): ReportCard[] {
  const rows = getReportCardsInRange(from, to);
  return rows.map(rowToReportCard);
}

// ─── Row → ReportCard Conversion ─────────────────────────────────────

function rowToReportCard(row: {
  session_id: string;
  computed_at: number;
  overall_score: number;
  dimension_scores: string;
  detector_results: string;
  summary: string;
}): ReportCard {
  let dimensions: DimensionScore[] = [];

  try {
    dimensions = JSON.parse(row.dimension_scores);
  } catch {
    /* ignore */
  }
  // detector_results stored for future use but not yet surfaced in the ReportCard type

  const grade = scoreToGrade(row.overall_score);

  const topStrengths = dimensions
    .filter((d) => d.score >= 80)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map((d) => `${d.label}: ${d.score}/100`);

  const topImprovements = dimensions
    .filter((d) => d.score < 70)
    .sort((a, b) => a.score - b.score)
    .slice(0, 3)
    .map((d) => `${d.label}: ${d.recommendation}`);

  return {
    sessionId: row.session_id,
    computedAt: row.computed_at,
    overallScore: row.overall_score,
    grade,
    dimensions,
    summary: row.summary,
    topStrengths,
    topImprovements,
  };
}

// ─── Summary Generator ───────────────────────────────────────────────

function generateSummary(
  dimensions: DimensionScore[],
  overallScore: number,
  grade: string,
  ctx: SessionContext,
): string {
  const strongest = [...dimensions].sort((a, b) => b.score - a.score)[0];
  const weakest = [...dimensions].sort((a, b) => a.score - b.score)[0];

  const minutes = Math.round(ctx.durationMs / 60_000);
  const prompts = ctx.promptTexts.length;
  const totalTools = Array.from(ctx.toolCounts.values()).reduce((a, b) => a + b, 0);

  let summary = `Grade ${grade} (${overallScore}/100). `;
  summary += `${minutes} min session with ${prompts} prompts and ${totalTools} tool calls. `;

  if (strongest && strongest.score >= 80) {
    summary += `Strongest: ${strongest.label} (${strongest.score}/100). `;
  }
  if (weakest && weakest.score < 70) {
    summary += `Focus area: ${weakest.label} (${weakest.score}/100). `;
  }

  if (ctx.compactionCount > 0) {
    summary += `${ctx.compactionCount} compaction(s) detected. `;
  }

  return summary.trim();
}
