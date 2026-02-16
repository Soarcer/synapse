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
  id: string;                    // e.g. "planning.read-before-edit"
  dimension: CoachingDimension;
  name: string;
  passed: boolean;
  score: number;                 // 0-100
  weight: number;                // 0-1
  evidence?: string;
  recommendation?: string;
}

export interface DimensionScore {
  dimension: CoachingDimension;
  score: number;                 // 0-100
  label: string;
  detectors: DetectorResult[];
  recommendation: string;
}

export interface ReportCard {
  sessionId: string;
  computedAt: number;
  overallScore: number;
  grade: string;                 // A+ through F
  dimensions: DimensionScore[];
  summary: string;
  topStrengths: string[];
  topImprovements: string[];
}

// ─── Live Nudges ────────────────────────────────────────────────────

export type NudgeSeverity = 'info' | 'suggestion' | 'warning';

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
