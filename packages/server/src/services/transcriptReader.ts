import fs from 'fs';
import path from 'path';
import os from 'os';
import type {
  TranscriptTurn,
  TranscriptSummary,
  ModelUsage,
} from '@synapse-ai/core';
import { MODEL_PRICING, DEFAULT_PRICING } from '@synapse-ai/core';

// ─── Path derivation ──────────────────────────────────────────────

/** Derive the Claude projects directory hash from a project path */
function projectHash(projectPath: string): string {
  // c:\Workspace\Coding → c--Workspace-Coding
  return projectPath.replace(/[:\\/]/g, '-');
}

/** Find the JSONL transcript file for a given session */
export function findTranscriptPath(sessionId: string, projectDir?: string): string | null {
  const claudeDir = path.join(os.homedir(), '.claude', 'projects');

  if (projectDir) {
    const hash = projectHash(projectDir);
    const direct = path.join(claudeDir, hash, `${sessionId}.jsonl`);
    if (fs.existsSync(direct)) return direct;
  }

  // Fallback: scan all project dirs for this session
  if (!fs.existsSync(claudeDir)) return null;

  for (const dir of fs.readdirSync(claudeDir)) {
    const candidate = path.join(claudeDir, dir, `${sessionId}.jsonl`);
    if (fs.existsSync(candidate)) return candidate;

    // Check subdirectory (session may have its own folder)
    const sub = path.join(claudeDir, dir, sessionId, `${sessionId}.jsonl`);
    if (fs.existsSync(sub)) return sub;
  }

  return null;
}

// ─── JSONL Parsing ────────────────────────────────────────────────

interface RawRecord {
  sessionId?: string;
  timestamp?: string;
  type?: string;
  uuid?: string;
  parentUuid?: string;
  message?: {
    model?: string;
    role?: string;
    content?: Array<{
      type: string;
      text?: string;
      thinking?: string;
      name?: string;
      id?: string;
      input?: unknown;
    }>;
    stop_reason?: string;
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      cache_read_input_tokens?: number;
      cache_creation_input_tokens?: number;
    };
  };
}

function parseTurn(record: RawRecord): TranscriptTurn | null {
  if (record.type !== 'user' && record.type !== 'assistant') return null;
  if (!record.message) return null;

  const msg = record.message;
  const usage = msg.usage;
  const content = msg.content ?? [];

  const contentTypes = [...new Set(content.map((c) => c.type))];
  const toolNames: string[] = [];
  let textLength = 0;
  let thinkingLength = 0;
  let toolUseCount = 0;

  for (const block of content) {
    if (block.type === 'text' && block.text) textLength += block.text.length;
    if (block.type === 'thinking' && block.thinking) thinkingLength += block.thinking.length;
    if (block.type === 'tool_use') {
      toolUseCount++;
      if (block.name) toolNames.push(block.name);
    }
  }

  const inputTokens = usage?.input_tokens ?? 0;
  const outputTokens = usage?.output_tokens ?? 0;
  const cacheReadTokens = usage?.cache_read_input_tokens ?? 0;
  const cacheCreationTokens = usage?.cache_creation_input_tokens ?? 0;
  const totalInputTokens = inputTokens + cacheReadTokens;
  const cacheHitRate = totalInputTokens > 0 ? cacheReadTokens / totalInputTokens : 0;

  return {
    uuid: record.uuid ?? '',
    timestamp: record.timestamp ? new Date(record.timestamp).getTime() : 0,
    type: record.type as 'user' | 'assistant',
    model: msg.model,
    stopReason: msg.stop_reason,
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheCreationTokens,
    contentTypes,
    toolNames,
    toolUseCount,
    textLength,
    thinkingLength,
    totalInputTokens,
    cacheHitRate,
  };
}

// ─── Cost calculation ─────────────────────────────────────────────

function estimateCost(turns: TranscriptTurn[]): number {
  let cost = 0;
  for (const turn of turns) {
    if (turn.type !== 'assistant' || !turn.model) continue;
    const pricing = MODEL_PRICING[turn.model] ?? DEFAULT_PRICING;
    // input_tokens are non-cached fresh tokens
    cost += (turn.inputTokens / 1_000_000) * pricing.input;
    // cache_read tokens charged at cached rate
    cost += (turn.cacheReadTokens / 1_000_000) * pricing.cachedInput;
    // cache_creation tokens charged at write rate (same as input for most models, but billed at input rate)
    cost += (turn.cacheCreationTokens / 1_000_000) * pricing.input;
    // output tokens
    cost += (turn.outputTokens / 1_000_000) * pricing.output;
  }
  return cost;
}

// ─── Main reader ──────────────────────────────────────────────────

export function readTranscript(
  filePath: string,
  sessionId: string,
): TranscriptSummary {
  const raw = fs.readFileSync(filePath, 'utf-8');
  const lines = raw.split('\n').filter((l) => l.trim());

  const turns: TranscriptTurn[] = [];

  for (const line of lines) {
    try {
      const record: RawRecord = JSON.parse(line);
      const turn = parseTurn(record);
      if (turn) turns.push(turn);
    } catch {
      // Skip malformed lines
    }
  }

  // Sort by timestamp
  turns.sort((a, b) => a.timestamp - b.timestamp);

  // Compute aggregates
  const assistantTurns = turns.filter((t) => t.type === 'assistant');

  let totalInput = 0;
  let totalOutput = 0;
  let totalCacheRead = 0;
  let totalCacheCreation = 0;
  let totalThinkingChars = 0;
  let totalTextChars = 0;
  let totalToolCalls = 0;
  let peakCacheHitRate = 0;
  const toolNameSet = new Set<string>();
  const modelMap = new Map<string, ModelUsage>();

  for (const t of assistantTurns) {
    totalInput += t.inputTokens;
    totalOutput += t.outputTokens;
    totalCacheRead += t.cacheReadTokens;
    totalCacheCreation += t.cacheCreationTokens;
    totalThinkingChars += t.thinkingLength;
    totalTextChars += t.textLength;
    totalToolCalls += t.toolUseCount;
    if (t.cacheHitRate > peakCacheHitRate) peakCacheHitRate = t.cacheHitRate;
    for (const name of t.toolNames) toolNameSet.add(name);

    if (t.model) {
      const existing = modelMap.get(t.model);
      if (existing) {
        existing.calls++;
        existing.inputTokens += t.inputTokens;
        existing.outputTokens += t.outputTokens;
        existing.cacheReadTokens += t.cacheReadTokens;
        existing.cacheCreationTokens += t.cacheCreationTokens;
      } else {
        modelMap.set(t.model, {
          model: t.model,
          calls: 1,
          inputTokens: t.inputTokens,
          outputTokens: t.outputTokens,
          cacheReadTokens: t.cacheReadTokens,
          cacheCreationTokens: t.cacheCreationTokens,
        });
      }
    }
  }

  // Response latency: time between consecutive user→assistant messages
  let totalLatency = 0;
  let latencyCount = 0;
  for (let i = 1; i < turns.length; i++) {
    if (turns[i].type === 'assistant' && turns[i - 1].type === 'user') {
      const lat = turns[i].timestamp - turns[i - 1].timestamp;
      if (lat > 0 && lat < 600_000) { // sanity: < 10min
        totalLatency += lat;
        latencyCount++;
      }
    }
  }

  const totalDuration = turns.length > 1 ? turns[turns.length - 1].timestamp - turns[0].timestamp : 0;
  const cacheRateSum = assistantTurns.reduce((s, t) => s + t.cacheHitRate, 0);

  return {
    sessionId,
    transcriptPath: filePath,
    turns,
    totalInputTokens: totalInput,
    totalOutputTokens: totalOutput,
    totalCacheReadTokens: totalCacheRead,
    totalCacheCreationTokens: totalCacheCreation,
    modelUsage: [...modelMap.values()],
    estimatedCostUsd: estimateCost(assistantTurns),
    avgCacheHitRate: assistantTurns.length > 0 ? cacheRateSum / assistantTurns.length : 0,
    peakCacheHitRate,
    totalDurationMs: totalDuration,
    avgResponseLatencyMs: latencyCount > 0 ? totalLatency / latencyCount : 0,
    totalThinkingChars,
    totalTextChars,
    totalToolCalls,
    uniqueToolNames: [...toolNameSet].sort(),
  };
}
