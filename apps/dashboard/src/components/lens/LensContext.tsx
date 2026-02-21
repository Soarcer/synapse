// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Synapse Contributors

import { createContext, useContext } from 'react';
import type { AgentNodeData, UserPromptData, AgentEvent, TranscriptSummary } from '@synapse-ai/core';

// ── Data types for the Lens Panel ───────────────────────────

export type LensTab = 'tree' | 'heatmap' | 'treemap' | 'sankey' | 'compaction' | 'cost' | 'alerts'; // [notifications]
export type LensNodeKind = 'session' | 'prompt' | 'agent' | 'tool';
export type ProfileMetric = 'tokens' | 'duration' | 'count';

export interface CompactEvent {
  id: string;
  sessionId: string;
  timestamp: number;
  trigger?: string;              // 'manual' | 'auto'
  preTokens?: number;            // Token count before compaction (from transcript v2)
}

export interface CostTurn {
  promptId: string;
  promptText: string;
  sessionId: string;
  timestamp: number;
  turnIndex: number;             // 0-based within session
  inputTokens: number;           // tokens for this turn's agents
  outputTokens: number;
  cumulativeInput: number;       // running total across session
  cumulativeOutput: number;
  toolCount: number;             // number of tool calls in this turn
  compactionBefore: boolean;     // true if a compaction happened before this turn
  // Transcript-sourced data (richer than hook-only)
  cacheReadTokens?: number;      // from JSONL transcript
  cacheCreationTokens?: number;
  model?: string;                // model used this turn
  responseLatencyMs?: number;    // user→assistant delay
  thinkingLength?: number;       // chars of thinking content
  textLength?: number;           // chars of text output
  dataSource: 'hook' | 'transcript';
}

export interface LensTreeNode {
  id: string;
  kind: LensNodeKind;
  label: string;
  status: 'running' | 'success' | 'error' | 'stopped' | 'ended';
  tokens: number;
  count: number;       // leaf=1, parent=sum of children counts
  startTime: number;
  endTime?: number;
  duration: number;
  depth: number;
  children: LensTreeNode[];
  groupCount?: number;
  groupedIds?: string[];
}

export interface WaterfallSpan {
  id: string;
  label: string;
  kind: LensNodeKind;
  status: string;
  startTime: number;
  endTime?: number;
  depth: number;
  color: string;
  parentId?: string;
  tokens: number;
}

export interface HeatmapCell {
  count: number;
  ids: string[];    // graph node IDs that fall in this cell
}

export interface SankeyNode {
  id: string;
  label: string;
  kind: LensNodeKind;
  layer: number;     // 0=session, 1=prompt, 2=agent, 3=tool
  value: number;     // tokens or duration
  color: string;
}

export interface SankeyLink {
  source: string;    // node id
  target: string;    // node id
  value: number;     // tokens or duration flowing through
}

export interface SankeyData {
  nodes: SankeyNode[];
  links: SankeyLink[];
}

export interface HeatmapData {
  /** Row labels (action names, sorted by total count desc) */
  actions: string[];
  /** Column labels (time bucket labels) */
  bucketLabels: string[];
  /** grid[actionIdx][bucketIdx] = cell */
  grid: HeatmapCell[][];
  /** Max count across all cells (for color scaling) */
  maxCount: number;
  /** Token usage grid: tokenGrid[actionIdx][bucketIdx] = total tokens */
  tokenGrid: number[][];
  /** Max token value across all cells */
  maxTokens: number;
}

// ── Context value ───────────────────────────────────────────

export interface LensContextValue {
  // Shared derived data
  treeRoots: LensTreeNode[];
  transcripts: Map<string, TranscriptSummary>;

  // Raw data for views to compute locally
  agents: Map<string, AgentNodeData>;
  events: AgentEvent[];
  prompts: Map<string, UserPromptData[]>;
  paletteIndex: number;

  // Selection
  selectedId: string | null;
  onSelect: (id: string | null) => void;

  // Panel state
  activeTab: LensTab;
  onTabChange: (tab: LensTab) => void;
  searchQuery: string;
  onSearchChange: (query: string) => void;

  // Metric toggle (used by treemap, sankey)
  profileMetric: ProfileMetric;
  onProfileMetricChange: (m: ProfileMetric) => void;

  // Whether any agents have token data (false for hook-only sessions)
  hasTokenData: boolean;

  // Status summary for tab bar strip
  statusCounts: { running: number; success: number; error: number; stopped: number };

  // Spawn dialog
  onSpawnClick: () => void;
}

const LensCtx = createContext<LensContextValue | null>(null);

export const LensProvider = LensCtx.Provider;

export function useLens(): LensContextValue {
  const ctx = useContext(LensCtx);
  if (!ctx) throw new Error('useLens must be used within a LensProvider');
  return ctx;
}
