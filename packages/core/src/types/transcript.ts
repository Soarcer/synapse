// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Synapse Contributors

// ─── Transcript Turn (parsed from JSONL) ──────────────────────────

export interface TranscriptTurn {
  uuid: string;
  timestamp: number;               // Unix ms
  type: 'user' | 'assistant';

  // Assistant-only fields
  model?: string;
  stopReason?: string;             // 'end_turn' | 'tool_use'

  // Token usage (from message.usage)
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;

  // Content analysis
  contentTypes: string[];          // e.g. ['text', 'tool_use', 'thinking']
  toolNames: string[];             // tool names called this turn
  toolUseCount: number;
  textLength: number;              // total text output chars
  thinkingLength: number;          // thinking block chars
  promptText?: string;             // user prompt text (first 500 chars, user turns only)

  // Context flags (from v2 ConversationRecord, propagated to v1 for filtering)
  isMeta: boolean;

  // Derived
  totalInputTokens: number;        // input + cache_read
  cacheHitRate: number;            // cache_read / totalInput (0-1)
}

// ─── Per-model breakdown ──────────────────────────────────────────

export interface ModelUsage {
  model: string;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
}

// ─── Model pricing (USD per million tokens) ───────────────────────

export const MODEL_PRICING: Record<string, { input: number; cachedInput: number; output: number }> = {
  'claude-opus-4-6':              { input: 15,   cachedInput: 1.5,  output: 75 },
  'claude-opus-4-20250514':       { input: 15,   cachedInput: 1.5,  output: 75 },
  'claude-sonnet-4-5-20250929':   { input: 3,    cachedInput: 0.3,  output: 15 },
  'claude-sonnet-4-20250514':     { input: 3,    cachedInput: 0.3,  output: 15 },
  'claude-haiku-4-5-20251001':    { input: 0.8,  cachedInput: 0.08, output: 4 },
  'claude-haiku-3-5-20241022':    { input: 0.8,  cachedInput: 0.08, output: 4 },
};

// Fallback pricing for unknown models
export const DEFAULT_PRICING = { input: 3, cachedInput: 0.3, output: 15 };

// ─── Full transcript summary ──────────────────────────────────────

export interface TranscriptSummary {
  sessionId: string;
  transcriptPath: string;
  turns: TranscriptTurn[];

  // Aggregates
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheReadTokens: number;
  totalCacheCreationTokens: number;

  // Per-model breakdown
  modelUsage: ModelUsage[];

  // Dollar cost estimate
  estimatedCostUsd: number;

  // Cache stats
  avgCacheHitRate: number;
  peakCacheHitRate: number;

  // Timing
  totalDurationMs: number;
  avgResponseLatencyMs: number;

  // Content stats
  totalThinkingChars: number;
  totalTextChars: number;
  totalToolCalls: number;
  uniqueToolNames: string[];

  // Session metadata (from conversation records)
  permissionMode?: string;
  gitBranch?: string;
  slug?: string;
  version?: string;

  // Server tool use aggregates
  webSearchRequests?: number;
  webFetchRequests?: number;
}

// ─── Content blocks (v2) ─────────────────────────────────────────

export interface TextBlock {
  type: 'text';
  text: string;
}

export interface ThinkingBlock {
  type: 'thinking';
  thinking: string;
  signature?: string;
}

export interface ToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResultBlock {
  type: 'tool_result';
  tool_use_id: string;
  content: string;
  is_error: boolean;
}

export interface ImageBlock {
  type: 'image';
  mediaType: string;
  dataLength: number;
}

export type ContentBlock = TextBlock | ThinkingBlock | ToolUseBlock | ToolResultBlock | ImageBlock;

// ─── Extended usage (v2) ─────────────────────────────────────────

export interface ExtendedUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  ephemeral5mTokens: number;
  ephemeral1hTokens: number;
  serverToolUse: {
    webSearchRequests: number;
    webFetchRequests: number;
  };
}

// ─── Full conversation record (v2) ──────────────────────────────

export interface ConversationRecord {
  uuid: string;
  parentUuid: string | null;
  timestamp: number;
  type: 'user' | 'assistant';
  sessionId: string;

  // Context flags
  isSidechain: boolean;
  isMeta: boolean;
  isCompactSummary: boolean;
  isApiErrorMessage: boolean;
  permissionMode?: string;
  cwd?: string;
  gitBranch?: string;
  error?: string;
  slug?: string;
  version?: string;

  // Message content
  model?: string;
  stopReason?: string;
  content: ContentBlock[];

  // Token usage
  usage: ExtendedUsage;

  // Todo state snapshot
  todos?: Array<{ content: string; status: string }>;
}

// ─── Progress records (v2) ──────────────────────────────────────

export interface BashProgressRecord {
  type: 'bash_progress';
  timestamp: number;
  sessionId: string;
  toolUseId?: string;
  output: string;
  elapsedTimeSeconds: number;
  totalLines: number;
  totalBytes: number;
}

export interface AgentProgressRecord {
  type: 'agent_progress';
  timestamp: number;
  sessionId: string;
  agentId: string;
  message?: string;
  prompt?: string;
}

export interface HookProgressRecord {
  type: 'hook_progress';
  timestamp: number;
  sessionId: string;
  hookEvent: string;
  hookName: string;
  command: string;
}

export type ProgressRecord = BashProgressRecord | AgentProgressRecord | HookProgressRecord;

// ─── System records (v2) ────────────────────────────────────────

export interface CompactBoundaryRecord {
  type: 'compact_boundary';
  timestamp: number;
  sessionId: string;
  preTokens: number;
  trigger: string;
}

export interface StopHookSummaryRecord {
  type: 'stop_hook_summary';
  timestamp: number;
  sessionId: string;
  hookCount: number;
  hookErrors: string[];
  stopReason?: string;
}

export type SystemRecord = CompactBoundaryRecord | StopHookSummaryRecord;

// ─── File history (v2) ──────────────────────────────────────────

export interface FileChange {
  filePath: string;
  backupFileName: string;
  version: number;
  backupTime: string;
}

export interface FileHistoryRecord {
  type: 'file_history';
  timestamp: number;
  sessionId: string;
  messageId: string;
  files: FileChange[];
}

// ─── Queue operations (v2) ──────────────────────────────────────

export interface QueueOperationRecord {
  type: 'queue_operation';
  timestamp: number;
  sessionId: string;
  operation: 'enqueue' | 'dequeue';
  content?: string;
}

// ─── Full transcript (v2) ───────────────────────────────────────

export interface FullTranscript {
  sessionId: string;
  transcriptPath: string;
  summary: TranscriptSummary;
  conversations: ConversationRecord[];
  progress: ProgressRecord[];
  system: SystemRecord[];
  fileHistory: FileHistoryRecord[];
  queueOps: QueueOperationRecord[];
}

// ─── Reasoning data (v2) ────────────────────────────────────────

export interface StructuredThinking {
  intent: string | null;
  planSteps: Array<{ text: string; done: boolean }>;
  decision: string | null;
  confidence: number | null;
}

export interface ReasoningToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
  resultContent: string | null;
  isError: boolean;
  durationMs: number | null;
}

export interface ReasoningTurn {
  uuid: string;
  parentUuid: string | null;
  timestamp: number;
  model?: string;
  isSidechain: boolean;

  // Error flags
  isApiErrorMessage: boolean;
  error?: string;                // e.g. 'rate_limit', 'overloaded'

  thinkingText: string | null;
  structured: StructuredThinking | null;
  responseText: string | null;

  toolCalls: ReasoningToolCall[];

  usage: {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
  };
}

export interface ReasoningData {
  sessionId: string;
  turns: ReasoningTurn[];
}
