// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Synapse Contributors

import fs from 'fs';
import path from 'path';
import os from 'os';
import type {
  TranscriptTurn,
  TranscriptSummary,
  ModelUsage,
  ContentBlock,
  ConversationRecord,
  ExtendedUsage,
  ProgressRecord,
  SystemRecord,
  FileHistoryRecord,
  FileChange,
  QueueOperationRecord,
  FullTranscript,
} from '@synapse-ai/core';
import { MODEL_PRICING, DEFAULT_PRICING } from '@synapse-ai/core';

/** Only allow safe session IDs (alphanumeric + dash + underscore) */
const SESSION_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;

// ─── Path derivation ──────────────────────────────────────────────

/** Derive the Claude projects directory hash from a project path */
function projectHash(projectPath: string): string {
  // c:\Workspace\Coding → c--Workspace-Coding
  return projectPath.replace(/[:\\/]/g, '-');
}

// ─── Transcript path cache (5-min TTL) ──────────────────────────────

const PATH_CACHE_TTL_MS = 5 * 60 * 1000;
const pathCache = new Map<string, { path: string | null; expiry: number }>();

/** Find the JSONL transcript file for a given session (cached) */
export function findTranscriptPath(sessionId: string, projectDir?: string): string | null {
  const cacheKey = `${sessionId}:${projectDir ?? ''}`;
  const cached = pathCache.get(cacheKey);
  if (cached && Date.now() < cached.expiry) return cached.path;

  const result = findTranscriptPathUncached(sessionId, projectDir);
  pathCache.set(cacheKey, { path: result, expiry: Date.now() + PATH_CACHE_TTL_MS });
  return result;
}

function findTranscriptPathUncached(sessionId: string, projectDir?: string): string | null {
  // Reject unsafe session IDs to prevent path traversal
  if (!SESSION_ID_PATTERN.test(sessionId)) return null;

  const claudeDir = path.join(os.homedir(), '.claude', 'projects');

  if (projectDir) {
    const hash = projectHash(projectDir);
    const direct = path.join(claudeDir, hash, `${sessionId}.jsonl`);
    if (!path.resolve(direct).startsWith(path.resolve(claudeDir))) return null;
    if (fs.existsSync(direct)) return direct;
  }

  // Fallback: scan all project dirs for this session
  if (!fs.existsSync(claudeDir)) return null;

  for (const dir of fs.readdirSync(claudeDir)) {
    const candidate = path.join(claudeDir, dir, `${sessionId}.jsonl`);
    if (!path.resolve(candidate).startsWith(path.resolve(claudeDir))) return null;
    if (fs.existsSync(candidate)) return candidate;

    // Check subdirectory (session may have its own folder)
    const sub = path.join(claudeDir, dir, sessionId, `${sessionId}.jsonl`);
    if (!path.resolve(sub).startsWith(path.resolve(claudeDir))) return null;
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

  // Context flags (v2)
  isSidechain?: boolean;
  isMeta?: boolean;
  isCompactSummary?: boolean;
  isApiErrorMessage?: boolean;
  permissionMode?: string;
  cwd?: string;
  gitBranch?: string;
  error?: string;
  slug?: string;
  version?: string;

  // System record fields
  subtype?: string;
  compactMetadata?: { trigger?: string; preTokens?: number };

  // Progress record fields
  toolUseID?: string;
  data?: {
    type?: string;
    output?: string;
    elapsedTimeSeconds?: number;
    totalLines?: number;
    totalBytes?: number;
    agentId?: string;
    message?: string;
    prompt?: string;
    hookEvent?: string;
    hookName?: string;
    command?: string;
  };

  // File history fields
  snapshot?: {
    messageId?: string;
    timestamp?: string;
    trackedFileBackups?: Record<string, {
      backupFileName?: string;
      version?: number;
      backupTime?: string;
    }>;
  };

  // Queue operation fields
  operation?: string;
  content?: string;

  // Stop hook summary
  hookCount?: number;
  hookErrors?: string[];
  stopReason?: string;

  message?: {
    model?: string;
    role?: string;
    content?: Array<{
      type: string;
      text?: string;
      thinking?: string;
      signature?: string;
      name?: string;
      id?: string;
      input?: unknown;
      tool_use_id?: string;
      content?: string | Array<{ type: string; source?: { media_type?: string; data?: string } }>;
      is_error?: boolean;
    }>;
    stop_reason?: string;
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      cache_read_input_tokens?: number;
      cache_creation_input_tokens?: number;
      cache_creation?: {
        ephemeral_5m_input_tokens?: number;
        ephemeral_1h_input_tokens?: number;
      };
      server_tool_use?: {
        web_search_requests?: number;
        web_fetch_requests?: number;
      };
    };
  };
}

/** Strip IDE context tags (ide_opened_file, ide_selection, system-reminder) to get actual user text */
function stripIdeTags(text: string): string {
  return text
    .replace(/<ide_opened_file>[\s\S]*?<\/ide_opened_file>/g, '')
    .replace(/<ide_selection>[\s\S]*?<\/ide_selection>/g, '')
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '')
    .replace(/<user-prompt-submit-hook>[\s\S]*?<\/user-prompt-submit-hook>/g, '')
    .trim();
}

function parseTurn(record: RawRecord): TranscriptTurn | null {
  if (record.type !== 'user' && record.type !== 'assistant') return null;
  if (!record.message) return null;

  const msg = record.message;
  const usage = msg.usage;
  const content = Array.isArray(msg.content) ? msg.content : [];

  const contentTypes = [...new Set(content.map((c) => c.type))];
  const toolNames: string[] = [];
  let textLength = 0;
  let thinkingLength = 0;
  let toolUseCount = 0;

  let promptText = '';
  for (const block of content) {
    if (block.type === 'text' && block.text) {
      textLength += block.text.length;
      if (record.type === 'user' && !promptText) {
        const cleaned = stripIdeTags(block.text);
        if (cleaned) promptText = cleaned.slice(0, 500);
      }
    }
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
    promptText: promptText || undefined,
    isMeta: record.isMeta === true,
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

// ─── Content block parsing (v2) ──────────────────────────────────

const TOOL_RESULT_MAX_CHARS = 50 * 1024; // 50KB

type RawContentBlock = NonNullable<NonNullable<RawRecord['message']>['content']>;
type RawUsage = NonNullable<RawRecord['message']>['usage'];

function parseContentBlocks(rawContent: RawContentBlock | undefined): ContentBlock[] {
  if (!rawContent || !Array.isArray(rawContent)) return [];
  const blocks: ContentBlock[] = [];

  for (const raw of rawContent) {
    switch (raw.type) {
      case 'text':
        if (raw.text != null) blocks.push({ type: 'text', text: raw.text });
        break;
      case 'thinking':
        if (raw.thinking != null) blocks.push({
          type: 'thinking',
          thinking: raw.thinking,
          ...(raw.signature ? { signature: raw.signature } : {}),
        });
        break;
      case 'tool_use':
        blocks.push({
          type: 'tool_use',
          id: raw.id ?? '',
          name: raw.name ?? '',
          input: (raw.input && typeof raw.input === 'object' ? raw.input : {}) as Record<string, unknown>,
        });
        break;
      case 'tool_result': {
        let content = '';
        if (typeof raw.content === 'string') {
          content = raw.content;
        } else if (Array.isArray(raw.content)) {
          content = raw.content.map(c => ('text' in c ? (c as { text?: string }).text : '[binary]')).join('\n');
        }
        if (content.length > TOOL_RESULT_MAX_CHARS) {
          content = content.slice(0, TOOL_RESULT_MAX_CHARS);
        }
        blocks.push({
          type: 'tool_result',
          tool_use_id: raw.tool_use_id ?? '',
          content,
          is_error: raw.is_error ?? false,
        });
        break;
      }
      case 'image': {
        const source = (raw as { source?: { media_type?: string; data?: string } }).source;
        blocks.push({
          type: 'image',
          mediaType: source?.media_type ?? 'unknown',
          dataLength: source?.data?.length ?? 0,
        });
        break;
      }
    }
  }

  return blocks;
}

function parseExtendedUsage(usage: RawUsage | undefined): ExtendedUsage {
  if (!usage) {
    return {
      inputTokens: 0, outputTokens: 0,
      cacheReadTokens: 0, cacheCreationTokens: 0,
      ephemeral5mTokens: 0, ephemeral1hTokens: 0,
      serverToolUse: { webSearchRequests: 0, webFetchRequests: 0 },
    };
  }
  return {
    inputTokens: usage.input_tokens ?? 0,
    outputTokens: usage.output_tokens ?? 0,
    cacheReadTokens: usage.cache_read_input_tokens ?? 0,
    cacheCreationTokens: usage.cache_creation_input_tokens ?? 0,
    ephemeral5mTokens: usage.cache_creation?.ephemeral_5m_input_tokens ?? 0,
    ephemeral1hTokens: usage.cache_creation?.ephemeral_1h_input_tokens ?? 0,
    serverToolUse: {
      webSearchRequests: usage.server_tool_use?.web_search_requests ?? 0,
      webFetchRequests: usage.server_tool_use?.web_fetch_requests ?? 0,
    },
  };
}

function parseConversationRecord(record: RawRecord, sessionId: string): ConversationRecord | null {
  if (record.type !== 'user' && record.type !== 'assistant') return null;
  if (!record.message) return null;

  return {
    uuid: record.uuid ?? '',
    parentUuid: record.parentUuid ?? null,
    timestamp: record.timestamp ? new Date(record.timestamp).getTime() : 0,
    type: record.type as 'user' | 'assistant',
    sessionId: record.sessionId ?? sessionId,
    isSidechain: record.isSidechain ?? false,
    isMeta: record.isMeta ?? false,
    isCompactSummary: record.isCompactSummary ?? false,
    isApiErrorMessage: record.isApiErrorMessage ?? false,
    permissionMode: record.permissionMode,
    cwd: record.cwd,
    gitBranch: record.gitBranch,
    error: record.error,
    slug: record.slug,
    version: record.version,
    model: record.message.model,
    stopReason: record.message.stop_reason,
    content: parseContentBlocks(record.message.content),
    usage: parseExtendedUsage(record.message.usage),
  };
}

function parseProgressRecord(record: RawRecord, sessionId: string): ProgressRecord | null {
  if (record.type !== 'progress' || !record.data) return null;

  const ts = record.timestamp ? new Date(record.timestamp).getTime() : 0;
  const sid = record.sessionId ?? sessionId;

  switch (record.data.type) {
    case 'bash_progress':
      return {
        type: 'bash_progress',
        timestamp: ts,
        sessionId: sid,
        toolUseId: record.toolUseID,
        output: record.data.output ?? '',
        elapsedTimeSeconds: record.data.elapsedTimeSeconds ?? 0,
        totalLines: record.data.totalLines ?? 0,
        totalBytes: record.data.totalBytes ?? 0,
      };
    case 'agent_progress':
      return {
        type: 'agent_progress',
        timestamp: ts,
        sessionId: sid,
        agentId: record.data.agentId ?? '',
        message: record.data.message,
        prompt: record.data.prompt,
      };
    case 'hook_progress':
      return {
        type: 'hook_progress',
        timestamp: ts,
        sessionId: sid,
        hookEvent: record.data.hookEvent ?? '',
        hookName: record.data.hookName ?? '',
        command: record.data.command ?? '',
      };
    default:
      return null;
  }
}

function parseSystemRecord(record: RawRecord, sessionId: string): SystemRecord | null {
  if (record.type !== 'system') return null;

  const ts = record.timestamp ? new Date(record.timestamp).getTime() : 0;
  const sid = record.sessionId ?? sessionId;

  if (record.subtype === 'compact_boundary' && record.compactMetadata) {
    return {
      type: 'compact_boundary',
      timestamp: ts,
      sessionId: sid,
      preTokens: record.compactMetadata.preTokens ?? 0,
      trigger: record.compactMetadata.trigger ?? 'unknown',
    };
  }

  if (record.subtype === 'stop_hook_summary') {
    return {
      type: 'stop_hook_summary',
      timestamp: ts,
      sessionId: sid,
      hookCount: record.hookCount ?? 0,
      hookErrors: record.hookErrors ?? [],
      stopReason: record.stopReason,
    };
  }

  return null;
}

function parseFileHistoryRecord(record: RawRecord, sessionId: string): FileHistoryRecord | null {
  if (record.type !== 'file-history-snapshot' || !record.snapshot) return null;

  const ts = record.timestamp ? new Date(record.timestamp).getTime() : 0;
  const files: FileChange[] = [];

  if (record.snapshot.trackedFileBackups) {
    for (const [filePath, backup] of Object.entries(record.snapshot.trackedFileBackups)) {
      files.push({
        filePath,
        backupFileName: backup.backupFileName ?? '',
        version: backup.version ?? 0,
        backupTime: backup.backupTime ?? '',
      });
    }
  }

  return {
    type: 'file_history',
    timestamp: ts,
    sessionId: record.sessionId ?? sessionId,
    messageId: record.snapshot.messageId ?? '',
    files,
  };
}

function parseQueueOperationRecord(record: RawRecord, sessionId: string): QueueOperationRecord | null {
  if (record.type !== 'queue-operation') return null;

  return {
    type: 'queue_operation',
    timestamp: record.timestamp ? new Date(record.timestamp).getTime() : 0,
    sessionId: record.sessionId ?? sessionId,
    operation: (record.operation === 'enqueue' || record.operation === 'dequeue') ? record.operation : 'enqueue',
    content: record.content,
  };
}

// ─── Full transcript reader (v2) ─────────────────────────────────

export function readFullTranscript(
  filePath: string,
  sessionId: string,
): FullTranscript {
  const raw = fs.readFileSync(filePath, 'utf-8');
  const lines = raw.split('\n').filter((l) => l.trim());

  const conversations: ConversationRecord[] = [];
  const progress: ProgressRecord[] = [];
  const system: SystemRecord[] = [];
  const fileHistory: FileHistoryRecord[] = [];
  const queueOps: QueueOperationRecord[] = [];
  const turns: TranscriptTurn[] = [];

  for (const line of lines) {
    let record: RawRecord;
    try {
      record = JSON.parse(line);
    } catch {
      continue; // Skip malformed lines
    }

    // Parse into v1 turn (for backward-compatible summary)
    const turn = parseTurn(record);
    if (turn) turns.push(turn);

    // Parse into v2 records
    const conv = parseConversationRecord(record, sessionId);
    if (conv) { conversations.push(conv); continue; }

    const prog = parseProgressRecord(record, sessionId);
    if (prog) { progress.push(prog); continue; }

    const sys = parseSystemRecord(record, sessionId);
    if (sys) { system.push(sys); continue; }

    const fh = parseFileHistoryRecord(record, sessionId);
    if (fh) { fileHistory.push(fh); continue; }

    const qo = parseQueueOperationRecord(record, sessionId);
    if (qo) { queueOps.push(qo); continue; }
  }

  // Build backward-compatible summary from turns
  const summary = buildSummary(turns, filePath, sessionId, conversations);

  return {
    sessionId,
    transcriptPath: filePath,
    summary,
    conversations,
    progress,
    system,
    fileHistory,
    queueOps,
  };
}

// ─── Summary builder (extracted from readTranscript) ──────────────

function buildSummary(
  turns: TranscriptTurn[],
  filePath: string,
  sessionId: string,
  conversations?: ConversationRecord[],
): TranscriptSummary {
  // Sort by timestamp
  turns.sort((a, b) => a.timestamp - b.timestamp);

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

  let totalLatency = 0;
  let latencyCount = 0;
  for (let i = 1; i < turns.length; i++) {
    if (turns[i].type === 'assistant' && turns[i - 1].type === 'user') {
      const lat = turns[i].timestamp - turns[i - 1].timestamp;
      if (lat > 0 && lat < 600_000) {
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
    // Session metadata from conversation records
    ...extractSessionMetadata(conversations),
  };
}

/** Extract session-level metadata from conversation records */
function extractSessionMetadata(conversations?: ConversationRecord[]): {
  permissionMode?: string;
  gitBranch?: string;
  slug?: string;
  version?: string;
  webSearchRequests?: number;
  webFetchRequests?: number;
} {
  if (!conversations || conversations.length === 0) return {};

  // Find the first record that has metadata (skip error messages)
  const source = conversations.find(c => !c.isApiErrorMessage && (c.permissionMode || c.gitBranch || c.slug));

  // Aggregate server tool use across all turns
  let webSearches = 0;
  let webFetches = 0;
  for (const c of conversations) {
    webSearches += c.usage.serverToolUse?.webSearchRequests ?? 0;
    webFetches += c.usage.serverToolUse?.webFetchRequests ?? 0;
  }

  return {
    permissionMode: source?.permissionMode,
    gitBranch: source?.gitBranch,
    slug: source?.slug,
    version: source?.version,
    webSearchRequests: webSearches > 0 ? webSearches : undefined,
    webFetchRequests: webFetches > 0 ? webFetches : undefined,
  };
}

// ─── Main reader (v1 — delegates to v2) ──────────────────────────

export function readTranscript(
  filePath: string,
  sessionId: string,
): TranscriptSummary {
  return readFullTranscript(filePath, sessionId).summary;
}
