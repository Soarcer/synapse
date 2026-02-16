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
}
