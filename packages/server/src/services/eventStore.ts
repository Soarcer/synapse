import { nanoid } from 'nanoid';
import { insertEvent, queryEvents, updateDailyRollup, type EventRow } from '../db.js';
import type { Broadcaster } from './broadcaster.js';
import { normalizeCwd } from '@synapse-ai/core';
import type { AgentEvent, AgentEventType } from '@synapse-ai/core';
import { computeCostUsd } from './costService.js';
import { checkNudges, updateEventBuffer } from './nudgeEngine.js';
import { logger } from '../lib/logger.js';

// ─── Extract text from prompt (may be string, content block, or array of blocks) ──

function extractPromptText(prompt: unknown): string | undefined {
  if (typeof prompt === 'string') return prompt;
  if (Array.isArray(prompt)) {
    return prompt
      .map((block) =>
        typeof block === 'string' ? block :
        block && typeof block === 'object' && 'text' in block ? String(block.text) : '',
      )
      .filter(Boolean)
      .join('\n');
  }
  if (prompt && typeof prompt === 'object' && 'text' in prompt) {
    return String((prompt as { text: unknown }).text);
  }
  return undefined;
}

// ─── Hook Event Name → AgentEventType Mapping ──────────────────────

const HOOK_EVENT_MAP: Record<string, AgentEventType> = {
  SessionStart: 'session_start',
  SessionEnd: 'session_end',
  UserPromptSubmit: 'user_prompt',
  SubagentStart: 'agent_start',
  SubagentStop: 'agent_stop',
  PreToolUse: 'tool_start',
  PostToolUse: 'tool_end',
  PostToolUseFailure: 'tool_error',
  PermissionRequest: 'permission_request',
  Notification: 'notification',
  PreCompact: 'compact',
  Stop: 'stop',
};

const HOOK_EVENT_NAMES = new Set(Object.keys(HOOK_EVENT_MAP));

// ─── Normalize Raw Hook Payload ─────────────────────────────────────

export function normalizeHookPayload(raw: Record<string, unknown>): AgentEvent {
  const hookEventName = (raw.hook_event_name as string) || 'unknown';
  const eventType = HOOK_EVENT_MAP[hookEventName] || 'result';
  const now = Date.now();

  const event: AgentEvent = {
    id: nanoid(),
    type: eventType,
    sessionId: (raw.session_id as string) || 'unknown',
    timestamp: now,
    eventSource: 'hook',
    vendor: 'anthropic',
  };

  // ── Common metadata (present on all hook events) ──
  if (raw.cwd) event.cwd = raw.cwd as string;
  if (raw.permission_mode) event.permissionMode = raw.permission_mode as string;
  if (raw.transcript_path) event.transcriptPath = raw.transcript_path as string;

  // ── Agent fields ──
  if (raw.agent_id) event.agentId = raw.agent_id as string;
  if (raw.agent_type) event.agentType = raw.agent_type as string;
  if (raw.parent_agent_id) event.parentAgentId = raw.parent_agent_id as string;
  if (raw.agent_transcript_path) event.agentTranscriptPath = raw.agent_transcript_path as string;

  // ── Tool fields ──
  if (raw.tool_name) event.toolName = raw.tool_name as string;
  if (raw.tool_use_id) event.toolUseId = raw.tool_use_id as string;
  if (raw.tool_input && typeof raw.tool_input === 'object') {
    event.toolInput = raw.tool_input as Record<string, unknown>;
  }
  if (raw.tool_response && typeof raw.tool_response === 'object') {
    event.toolResponse = raw.tool_response as Record<string, unknown>;
  }

  // ── Event-specific fields ──
  switch (hookEventName) {
    case 'SessionStart':
      if (raw.model) event.model = raw.model as string;
      if (raw.source) event.source = raw.source as string;
      break;

    case 'SessionEnd':
      if (raw.reason) event.reason = raw.reason as string;
      break;

    case 'UserPromptSubmit': {
      const promptText = extractPromptText(raw.prompt);
      if (promptText) event.text = promptText;
      break;
    }

    case 'Notification':
      if (raw.message) event.text = raw.message as string;
      if (raw.notification_type) event.notificationType = raw.notification_type as string;
      break;

    case 'PreCompact':
      if (raw.trigger) event.compactTrigger = raw.trigger as string;
      break;

    case 'PostToolUseFailure':
      if (raw.error) event.error = String(raw.error);
      break;
  }

  // ── Status mapping ──
  if (hookEventName === 'SubagentStart' || hookEventName === 'PreToolUse') {
    event.status = 'running';
  } else if (hookEventName === 'PostToolUse' || hookEventName === 'SubagentStop') {
    event.status = 'success';
  } else if (hookEventName === 'PostToolUseFailure') {
    event.status = 'error';
  }

  return event;
}

// ─── Deduplication (multiple hook sources can fire the same event) ──

const DEDUPE_WINDOW_MS = 2000;
const recentEvents = new Map<string, number>(); // fingerprint → timestamp

/** Clear the dedup cache — exposed for test isolation. */
export function clearDedupeCache(): void {
  recentEvents.clear();
}

function dedupeFingerprint(raw: Record<string, unknown>): string {
  const sessionId = raw.session_id ?? '';
  const hookName = raw.hook_event_name ?? '';
  const toolUseId = raw.tool_use_id ?? '';
  const agentId = raw.agent_id ?? '';
  // For UserPromptSubmit, include prompt text so two different rapid prompts
  // aren't falsely deduped (toolUseId and agentId are both empty for prompts)
  const promptText = hookName === 'UserPromptSubmit'
    ? String(typeof raw.prompt === 'string' ? raw.prompt : '').slice(0, 200)
    : '';
  return `${sessionId}:${hookName}:${toolUseId}:${agentId}:${promptText}`;
}

function isDuplicate(raw: Record<string, unknown>): boolean {
  const fp = dedupeFingerprint(raw);
  const now = Date.now();

  // Prune stale entries periodically
  if (recentEvents.size > 500) {
    for (const [key, ts] of recentEvents) {
      if (now - ts > DEDUPE_WINDOW_MS) recentEvents.delete(key);
    }
  }

  const prev = recentEvents.get(fp);
  if (prev && now - prev < DEDUPE_WINDOW_MS) {
    logger.info({ fp, deltaMs: now - prev }, 'Duplicate event dropped');
    return true;
  }
  if (prev) {
    logger.info({ fp, deltaMs: now - prev }, 'Dedup window expired — treating as new');
  }
  recentEvents.set(fp, now);
  return false;
}

// ─── Store and Broadcast ────────────────────────────────────────────

export function storeAndBroadcast(
  raw: Record<string, unknown>,
  broadcaster: Broadcaster,
): AgentEvent {
  const event = normalizeHookPayload(raw);
  const hookEventName = (raw.hook_event_name as string) || 'unknown';

  // Drop duplicate events from multiple hook sources (settings.json + settings.local.json)
  if (isDuplicate(raw)) {
    return event;
  }

  const normalizedCwd = event.cwd ? normalizeCwd(event.cwd) : null;

  // Persist to SQLite
  insertEvent({
    event_id: event.id,
    session_id: event.sessionId,
    hook_event_name: hookEventName,
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
    raw_payload: JSON.stringify(raw),
    created_at: event.timestamp,
  });

  // Update daily analytics rollup
  const inputTokens = event.tokenUsage?.input ?? 0;
  const outputTokens = event.tokenUsage?.output ?? 0;
  const cacheRead = Math.round(inputTokens * 0.5);
  const costUsd = inputTokens > 0
    ? computeCostUsd(event.model ?? 'claude-sonnet-4-5', inputTokens, outputTokens, cacheRead, event.timestamp)
    : 0;

  updateDailyRollup({
    created_at: event.timestamp,
    cwd: normalizedCwd,
    model: event.model,
    vendor: event.vendor,
    event_type: event.type,
    token_input: event.tokenUsage?.input,
    token_output: event.tokenUsage?.output,
    duration_ms: event.duration,
    tool_name: event.toolName,
    status: event.status,
    cost_usd: costUsd,
  });

  // Broadcast to all WebSocket clients
  broadcaster.broadcast(event);

  // Coaching nudge engine
  updateEventBuffer(event);
  checkNudges(event, broadcaster);

  return event;
}

// ─── Row → AgentEvent Conversion ────────────────────────────────────

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
    try { event.toolInput = JSON.parse(row.tool_input); } catch { /* corrupted data */ }
  }
  if (row.tool_response) {
    try { event.toolResponse = JSON.parse(row.tool_response); } catch { /* corrupted data */ }
  }
  if (row.status) event.status = row.status as AgentEvent['status'];
  if (row.error) event.error = row.error;
  if (row.token_input != null && row.token_output != null) {
    event.tokenUsage = { input: row.token_input, output: row.token_output };
  }
  if (row.duration_ms != null) event.duration = row.duration_ms;

  // Infer event source from hook_event_name
  if (row.hook_event_name === 'openclaw') {
    event.eventSource = 'openclaw';
  } else {
    event.eventSource = HOOK_EVENT_NAMES.has(row.hook_event_name) ? 'hook' : 'sdk';
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
  } catch { /* ignore parse errors */ }

  return event;
}

// ─── Store Pre-Normalized Event (for OpenClaw plugin) ───────────────

export function storePreNormalized(
  event: AgentEvent,
  broadcaster: Broadcaster,
): void {
  const normalizedCwd = event.cwd ? normalizeCwd(event.cwd) : null;

  insertEvent({
    event_id: event.id,
    session_id: event.sessionId,
    hook_event_name: event.eventSource ?? 'openclaw',
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
    raw_payload: JSON.stringify(event),
    created_at: event.timestamp,
  });

  // Update daily analytics rollup
  const inputTokens = event.tokenUsage?.input ?? 0;
  const outputTokens = event.tokenUsage?.output ?? 0;
  const cacheRead = Math.round(inputTokens * 0.5);
  const costUsd = inputTokens > 0
    ? computeCostUsd(event.model ?? 'claude-sonnet-4-5', inputTokens, outputTokens, cacheRead, event.timestamp)
    : 0;

  updateDailyRollup({
    created_at: event.timestamp,
    cwd: normalizedCwd,
    model: event.model,
    vendor: event.vendor,
    event_type: event.type,
    token_input: event.tokenUsage?.input,
    token_output: event.tokenUsage?.output,
    duration_ms: event.duration,
    tool_name: event.toolName,
    status: event.status,
    cost_usd: costUsd,
  });

  broadcaster.broadcast(event);

  // Coaching nudge engine (same as storeAndBroadcast)
  updateEventBuffer(event);
  checkNudges(event, broadcaster);
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
