// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bernhard

// ─── Coaching Types ─────────────────────────────────────────────────

// Dimensions & Report Card

export type CoachingDimension =
  | 'planning'
  | 'precision'
  | 'toolCraft'
  | 'contextManagement'
  | 'costEfficiency'
  | 'verification'
  | 'sessionStrategy'
  | 'configuration';

export interface DetectorResult {
  id: string; // e.g. "planning.read-before-edit"
  dimension: CoachingDimension;
  name: string;
  passed: boolean;
  score: number; // 0-100
  weight: number; // 0-1
  evidence?: string;
  recommendation?: string;
}

export interface DimensionScore {
  dimension: CoachingDimension;
  score: number; // 0-100
  label: string;
  detectors: DetectorResult[];
  recommendation: string;
}

export interface ReportCard {
  sessionId: string;
  computedAt: number;
  overallScore: number;
  grade: string; // A+ through F
  dimensions: DimensionScore[];
  summary: string;
  topStrengths: string[];
  topImprovements: string[];
}

// ─── Live Nudges ────────────────────────────────────────────────────

export type NudgeSeverity = 'info' | 'suggestion' | 'warning';

export type NudgeRuleCategory =
  | 'tool-usage'
  | 'planning'
  | 'verification'
  | 'git'
  | 'security'
  | 'efficiency'
  | 'orchestration';

export interface NudgeRuleMeta {
  id: string; // e.g., "tool.bash-file-ops"
  name: string; // "Bash for File Operations"
  description: string; // User-facing explanation
  dimension: CoachingDimension; // Links to report card dimension
  defaultSeverity: NudgeSeverity;
  defaultCooldownMs: number;
  category: NudgeRuleCategory;
  tags: string[];
  minEvents?: number; // Minimum events before rule can fire
}

export interface CoachingNudge {
  id: string;
  sessionId: string;
  detectorId: string;
  severity: NudgeSeverity;
  title: string;
  message: string;
  recommendation: string;
  firedAt: number;
  dismissed: boolean;
  triggerPrompt?: string; // Prompt text that caused this nudge (for display)
}

export interface NudgeCandidate {
  severity: NudgeSeverity;
  title: string;
  message: string;
  recommendation: string;
}

// ─── Session Accumulator ─────────────────────────────────────────

/**
 * In-memory runtime accumulator — NOT safe for JSON serialization.
 * Map and Set fields are silently dropped by JSON.stringify().
 * Do not persist this type directly; build a serializable summary instead.
 */
export interface SessionAccumulator {
  sessionId: string;
  startTime: number;
  lastEventTime: number;
  eventCount: number;

  // Tool tracking
  toolCounts: Map<string, number>;
  toolErrors: Map<string, number>;
  consecutiveBashFileOps: number;
  consecutiveErrors: number;
  lastToolName: string | null;

  // File tracking
  filesRead: Set<string>;
  filesEdited: Set<string>;
  readBeforeEdit: Set<string>;
  editWithoutRead: Set<string>;
  fileReadCounts: Map<string, number>;

  // Prompt tracking
  promptCount: number;
  promptTimestamps: number[];
  lastPromptTime: number;
  lastPromptText: string; // Last user prompt (first 500 chars) for attribution
  recentPromptTexts: string[]; // Sliding window: last 3 prompts (500 chars each)
  sessionGoalSummary: string; // First sentence / first 100 chars of prompt 1
  conversationMode: boolean; // True when prompts <2min apart AND avg word count <15
  totalPromptTokens: number;

  // Token/cost tracking
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCostUsd: number;
  turnCosts: number[]; // cost per tool call, for averaging

  // Agent tracking
  subagentCount: number;
  activeSubagents: Set<string>;
  subagentFiles: Map<string, Set<string>>; // agentId → files accessed

  // Planning signals
  usedPlanMode: boolean;
  usedTodoWrite: boolean;
  usedSubagents: boolean;
  distinctFilesModified: number;

  // Verification signals
  testRunCount: number;
  editsSinceLastTest: number;
  lastTestTime: number;

  // Git signals
  commitCount: number;
  editsSinceLastCommit: number;
  usedGitAddAll: boolean;
  usedForceOps: boolean;
  currentBranch: string | null;
  lastGitDiffTime: number;

  // Compaction
  compactionCount: number;

  // Permission mode
  permissionMode: string | null;
}

// ─── Delivery Manager Config ─────────────────────────────────────

export interface DeliveryConfig {
  maxNudgesPerSession: number;
  cooldownBackoffMultiplier: number;
  maxConsecutiveFiresBeforeSuppress: number;
  dismissalsBeforeAutoSuppress: number;
  warningBypassesRateLimit: boolean;
}

// ─── Playbooks ──────────────────────────────────────────────────────

export type PlaybookCategory =
  | 'feature'
  | 'bugfix'
  | 'refactor'
  | 'test'
  | 'review'
  | 'debug'
  | 'custom';

export interface PlaybookPattern {
  toolSequence: string[];
  modelStrategy: string;
  avgTurns: number;
  avgDurationMinutes: number;
  readBeforeEdit: boolean;
  testAfterEdit: boolean;
  usedSubagents: boolean;
  compactionCount: number;
}

export interface Playbook {
  id: number;
  name: string;
  description: string;
  category: PlaybookCategory;
  sourceSessionId?: string;
  pattern: PlaybookPattern;
  tags: string[];
  score?: number;
  createdAt: number;
  updatedAt: number;
}

// ─── AI Coaching Types ─────────────────────────────────────────────

export interface PromptAnalysis {
  score: number; // 1-10
  explanation: string;
  rewrite: string;
  estimatedSavings: string;
  historyComparison: string;
}

export interface SessionSummary {
  summary: string;
  roiMetrics: {
    timeSaved: string;
    costPerTask: string;
    successRate: string;
  };
}

export interface EnrichedNudge {
  originalNudge: CoachingNudge;
  aiAnalysis: string;
  actionItems: string[];
  source: 'rule' | 'ai-escalation' | 'ai-periodic' | 'ai-trigger';
}

export interface AiCoachStatus {
  available: boolean;
  source: 'env' | 'settings' | 'none';
  model: string;
  maskedKey: string;
}
