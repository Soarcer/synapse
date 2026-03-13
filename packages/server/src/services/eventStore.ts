// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bernhard

import {
  insertEvent,
  queryEvents,
  updateDailyRollup,
  upsertSessionSummary,
  type EventRow,
} from '../db.js';
import type { Broadcaster } from './broadcaster.js';
import { normalizeCwd } from '@synapse-ai/core';
import type { AgentEvent, AgentEventType } from '@synapse-ai/core';
import { computeCostUsd } from './costService.js';
import { checkNudges, updateEventBuffer } from './nudgeEngine.js';
import { CLAUDE_HOOK_EVENT_NAMES } from '../adapters/index.js';
import { logger, type Logger } from '../lib/logger.js';

// ─── Token Validation ────────────────────────────────────────────────

interface TokenCounts {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  thinkingTokens: number;
}

export function validateTokenCounts(tokens: TokenCounts, log: Logger): TokenCounts {
  const validated = {
    inputTokens: Math.max(0, tokens.inputTokens),
    outputTokens: Math.max(0, tokens.outputTokens),
    cacheReadTokens: Math.max(0, tokens.cacheReadTokens),
    cacheCreationTokens: Math.max(0, tokens.cacheCreationTokens),
    thinkingTokens: Math.max(0, tokens.thinkingTokens),
  };

  if (validated.cacheCreationTokens > validated.inputTokens) {
    log.warn({ tokens: validated }, 'cacheCreationTokens > inputTokens — possible misparse');
  }
  if (tokens.cacheReadTokens < 0) {
    log.warn({ raw: tokens.cacheReadTokens }, 'Negative cacheReadTokens clamped to 0');
  }
  const maxPerTurn = 10_000_000;
  for (const [key, val] of Object.entries(validated)) {
    if (val > maxPerTurn) {
      log.warn({ key, val }, 'Token count exceeds 10M per turn — possible bug');
    }
  }

  return validated;
}

// ─── Extract text from prompt (used by rowToAgentEvent for raw_payload recovery) ──

function extractPromptText(prompt: unknown): string | undefined {
  if (typeof prompt === 'string') return prompt;
  if (Array.isArray(prompt)) {
    return prompt
      .map((block) =>
        typeof block === 'string'
          ? block
          : block && typeof block === 'object' && 'text' in block
            ? String(block.text)
            : '',
      )
      .filter(Boolean)
      .join('\n');
  }
  if (prompt && typeof prompt === 'object' && 'text' in prompt) {
    return String((prompt as { text: unknown }).text);
  }
  return undefined;
}

// ─── Store Normalized Event ─────────────────────────────────────────
// Unified storage path for all event sources (hook adapters + OpenClaw).

export function storeNormalized(
  event: AgentEvent,
  broadcaster: Broadcaster,
  options: {
    /** Adapter id or 'openclaw' — stored in hook_event_name column */
    hookEventName: string;
    /** Raw payload to persist for metadata recovery */
    rawPayload: Record<string, unknown>;
  },
): void {
  const normalizedCwd = event.cwd ? normalizeCwd(event.cwd) : null;

  // Persist to SQLite
  insertEvent({
    event_id: event.id,
    session_id: event.sessionId,
    hook_event_name: options.hookEventName,
    event_type: event.type,
    agent_id: event.agentId,
    agent_type: event.agentType,
    parent_agent_id: event.parentAgentId,
    tool_name: event.toolName,
    tool_use_id: event.toolUseId,
    tool_input: event.toolInput ? JSON.stringify(event.toolInput) : null,
    tool_response: event.toolResponse ? JSON.stringify(event.toolResponse) : null,
    status: event.status,
    error: event.error,
    token_input: event.tokenUsage?.input,
    token_output: event.tokenUsage?.output,
    duration_ms: event.duration,
    model: event.model,
    vendor: event.vendor,
    cwd: normalizedCwd,
    raw_payload: JSON.stringify(options.rawPayload),
    created_at: event.timestamp,
  });

  // Update materialized session summary
  upsertSessionSummary({
    session_id: event.sessionId,
    created_at: event.timestamp,
    event_type: event.type,
    token_input: event.tokenUsage?.input,
    token_output: event.tokenUsage?.output,
    model: event.model,
    cwd: normalizedCwd,
  });

  // Update daily analytics rollup
  const rawTokens: TokenCounts = {
    inputTokens: event.tokenUsage?.input ?? 0,
    outputTokens: event.tokenUsage?.output ?? 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    thinkingTokens: 0,
  };
  const validatedTokens = validateTokenCounts(rawTokens, logger);

  const costUsd =
    validatedTokens.inputTokens > 0
      ? computeCostUsd(
          event.model ?? 'claude-sonnet-4-5',
          validatedTokens.inputTokens,
          validatedTokens.outputTokens,
          validatedTokens.cacheReadTokens,
          validatedTokens.cacheCreationTokens,
          validatedTokens.thinkingTokens,
          event.timestamp,
        ).total
      : 0;

  updateDailyRollup({
    created_at: event.timestamp,
    cwd: normalizedCwd,
    model: event.model,
    vendor: event.vendor,
    event_type: event.type,
    token_input: validatedTokens.inputTokens,
    token_output: validatedTokens.outputTokens,
    cache_read_tokens: validatedTokens.cacheReadTokens,
    cache_creation_tokens: validatedTokens.cacheCreationTokens,
    thinking_tokens: validatedTokens.thinkingTokens,
    duration_ms: event.duration,
    tool_name: event.toolName,
    status: event.status,
    cost_usd: costUsd,
  });

  // Broadcast to all WebSocket clients
  broadcaster.broadcast(event);

  // Coaching nudge engine — disabled (too noisy)
  // updateEventBuffer(event);
  // checkNudges(event, broadcaster);
}

// ─── Legacy Aliases (backward compatibility for existing callers) ────

/** @deprecated Use storeNormalized() via the AdapterRegistry instead. */
export function storePreNormalized(event: AgentEvent, broadcaster: Broadcaster): void {
  storeNormalized(event, broadcaster, {
    hookEventName: event.eventSource ?? 'openclaw',
    rawPayload: event as unknown as Record<string, unknown>,
  });
}

// ─── Row → AgentEvent Conversion ────────────────────────────────────

// Adapter IDs that correspond to hook-sourced events
const HOOK_ADAPTER_IDS = new Set(['claude', 'gemini', 'codex']);

export function rowToAgentEvent(row: EventRow): AgentEvent {
  const event: AgentEvent = {
    id: row.event_id,
    type: row.event_type as AgentEventType,
    sessionId: row.session_id,
    timestamp: row.created_at,
  };
  if (row.agent_id) event.agentId = row.agent_id;
  if (row.agent_type) event.agentType = row.agent_type;
  if (row.parent_agent_id) event.parentAgentId = row.parent_agent_id;
  if (row.tool_name) event.toolName = row.tool_name;
  if (row.tool_use_id) event.toolUseId = row.tool_use_id;
  if (row.tool_input) {
    try {
      event.toolInput = JSON.parse(row.tool_input);
    } catch {
      /* corrupted data */
    }
  }
  if (row.tool_response) {
    try {
      event.toolResponse = JSON.parse(row.tool_response);
    } catch {
      /* corrupted data */
    }
  }
  if (row.status) event.status = row.status as AgentEvent['status'];
  if (row.error) event.error = row.error;
  if (row.token_input != null && row.token_output != null) {
    event.tokenUsage = { input: row.token_input, output: row.token_output };
  }
  if (row.duration_ms != null) event.duration = row.duration_ms;

  // Infer event source from hook_event_name column.
  // New rows store adapter id ('claude', 'gemini'); legacy rows store raw
  // Claude hook names ('SessionStart', 'PreToolUse', etc.).
  const hen = row.hook_event_name;
  if (hen === 'openclaw') {
    event.eventSource = 'openclaw';
  } else if (HOOK_ADAPTER_IDS.has(hen) || CLAUDE_HOOK_EVENT_NAMES.has(hen)) {
    event.eventSource = 'hook';
  } else {
    event.eventSource = 'sdk';
  }
  if (row.vendor) event.vendor = row.vendor;
  if (row.cwd) event.cwd = row.cwd;

  // Restore rich metadata from raw_payload
  try {
    const raw = JSON.parse(row.raw_payload);
    if (raw.model) event.model = raw.model;
    if (raw.source) event.source = raw.source;
    if (raw.reason) event.reason = raw.reason;
    if (!event.cwd && raw.cwd) event.cwd = raw.cwd; // fallback for old rows
    if (raw.permission_mode) event.permissionMode = raw.permission_mode;
    const promptText = extractPromptText(raw.prompt);
    if (promptText) event.text = promptText;
    if (raw.message && event.type === 'notification') event.text = raw.message;
    if (raw.notification_type) event.notificationType = raw.notification_type;
    if (raw.trigger) event.compactTrigger = raw.trigger;
    if (raw.agent_transcript_path) event.agentTranscriptPath = raw.agent_transcript_path;
  } catch {
    /* ignore parse errors */
  }

  return event;
}

// ─── Query Events (returns AgentEvent[]) ────────────────────────────

export function getStoredEvents(params: {
  sessionId?: string;
  agentId?: string;
  type?: string;
  cwd?: string;
  from?: number;
  to?: number;
  limit?: number;
  offset?: number;
}): AgentEvent[] {
  const rows = queryEvents(params);
  return rows.map(rowToAgentEvent);
}
