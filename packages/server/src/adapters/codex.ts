// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Synapse Contributors

// ─── Codex CLI Adapter ────────────────────────────────────────────
// Normalizes Codex CLI events into AgentEvent.
// Codex uses two data sources:
//   1. Notify hook (argv-based, fires on `agent-turn-complete` only)
//   2. JSONL session files (~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl)
// This adapter handles events POSTed to /api/events from either source.

import { nanoid } from 'nanoid';
import type { AgentEvent, AgentEventType } from '@synapse-ai/core';
import type { Adapter } from './types.js';

// ─── Codex Notify Hook Type ─────────────────────────────────────

const CODEX_NOTIFY_TYPES = new Set(['agent-turn-complete']);

// ─── Codex JSONL event_msg payload types ────────────────────────

const EVENT_MSG_TYPE_MAP: Record<string, AgentEventType> = {
  user_message: 'user_prompt',
  token_count: 'result',
  turn_context: 'session_start',
};

// ─── Codex direct message role mapping ──────────────────────────

const ROLE_TYPE_MAP: Record<string, AgentEventType> = {
  user: 'user_prompt',
  // assistant handled specially (text vs tool_use)
  tool: 'tool_end',
};

// ─── Token Tracker (cumulative → delta) ─────────────────────────

export class TokenTracker {
  private lastCounts = new Map<string, { input: number; output: number; cached: number }>();

  computeDelta(
    sessionId: string,
    cumulative: { input: number; output: number; cached?: number },
  ): {
    input: number;
    output: number;
    cached: number;
  } {
    const prev = this.lastCounts.get(sessionId) ?? { input: 0, output: 0, cached: 0 };
    const delta = {
      input: Math.max(0, cumulative.input - prev.input),
      output: Math.max(0, cumulative.output - prev.output),
      cached: Math.max(0, (cumulative.cached ?? 0) - prev.cached),
    };
    this.lastCounts.set(sessionId, {
      input: cumulative.input,
      output: cumulative.output,
      cached: cumulative.cached ?? 0,
    });
    return delta;
  }

  reset(sessionId: string): void {
    this.lastCounts.delete(sessionId);
  }

  resetAll(): void {
    this.lastCounts.clear();
  }
}

// ─── Codex Adapter ──────────────────────────────────────────────

export class CodexAdapter implements Adapter {
  readonly id = 'codex';
  readonly vendor = 'openai';

  private readonly tokenTracker = new TokenTracker();

  detect(raw: Record<string, unknown>): boolean {
    // 1. Codex notify hook: { type: 'agent-turn-complete', ... }
    if (typeof raw.type === 'string' && CODEX_NOTIFY_TYPES.has(raw.type)) return true;

    // 2. Codex JSONL event_msg wrapper: { type: 'event_msg', payload: { type: '...' } }
    if (raw.type === 'event_msg' && raw.payload && typeof raw.payload === 'object') return true;

    // 3. Codex direct role message: { type: 'message', role: '...' }
    if (raw.type === 'message' && typeof raw.role === 'string') return true;

    // 4. Codex state record: { record_type: 'state', data: { ... } }
    if (raw.record_type === 'state' && raw.data && typeof raw.data === 'object') return true;

    // 5. Explicitly tagged as codex (from file watcher or hook script)
    if (raw._codex === true || raw.codex_source === 'notify' || raw.codex_source === 'watcher')
      return true;

    return false;
  }

  normalize(raw: Record<string, unknown>): AgentEvent {
    // Route to the correct normalizer based on payload shape
    if (raw.type === 'agent-turn-complete') return this.normalizeTurnComplete(raw);
    if (raw.type === 'event_msg') return this.normalizeEventMsg(raw);
    if (raw.type === 'message') return this.normalizeRoleMessage(raw);
    if (raw.record_type === 'state') return this.normalizeState(raw);

    // Fallback: treat as generic notification
    return this.makeEvent('notification', raw);
  }

  dedupeFingerprint(raw: Record<string, unknown>): string | null {
    const sessionId = this.extractSessionId(raw);
    const type = (raw.type as string) ?? '';
    const role = (raw.role as string) ?? '';
    const toolId = (raw.tool_use_id as string) ?? '';
    return `${sessionId}:${type}:${role}:${toolId}`;
  }

  /** Expose token tracker for test isolation. */
  resetTokenTracker(): void {
    this.tokenTracker.resetAll();
  }

  // ── Normalize: agent-turn-complete (notify hook) ──────────────

  private normalizeTurnComplete(raw: Record<string, unknown>): AgentEvent {
    const event = this.makeEvent('result', raw);
    const lastMsg = raw['last-assistant-message'] ?? raw.last_assistant_message;
    if (typeof lastMsg === 'string') event.text = lastMsg;
    return event;
  }

  // ── Normalize: event_msg wrapper ──────────────────────────────

  private normalizeEventMsg(raw: Record<string, unknown>): AgentEvent {
    const payload = raw.payload as Record<string, unknown>;
    const payloadType = (payload.type as string) ?? '';
    const eventType = EVENT_MSG_TYPE_MAP[payloadType] ?? 'notification';

    const event = this.makeEvent(eventType, raw);

    switch (payloadType) {
      case 'user_message':
        event.text = (payload.message as string) ?? '';
        break;

      case 'token_count': {
        const sessionId = event.sessionId;
        const cumulative = {
          input: (payload.input_tokens as number) ?? 0,
          output: (payload.output_tokens as number) ?? 0,
          cached: (payload.cached_input_tokens as number) ?? 0,
        };
        const delta = this.tokenTracker.computeDelta(sessionId, cumulative);
        event.tokenUsage = { input: delta.input, output: delta.output };
        break;
      }

      case 'turn_context':
        if (payload.model) event.model = payload.model as string;
        if (payload.approval_policy) {
          event.permissionMode = payload.approval_policy as string;
        }
        break;
    }

    return event;
  }

  // ── Normalize: direct role message ────────────────────────────

  private normalizeRoleMessage(raw: Record<string, unknown>): AgentEvent {
    const role = raw.role as string;

    // assistant messages need content inspection
    if (role === 'assistant') {
      return this.normalizeAssistantMessage(raw);
    }

    // tool result
    if (role === 'tool') {
      const event = this.makeEvent('tool_end', raw);
      event.toolUseId = (raw.tool_use_id as string) ?? undefined;
      event.status = 'success';
      const content = raw.content;
      if (typeof content === 'string') {
        event.toolResponse = { result: content.slice(0, 500) };
      }
      return event;
    }

    // user or other roles
    const eventType = ROLE_TYPE_MAP[role] ?? 'notification';
    const event = this.makeEvent(eventType, raw);
    if (role === 'user') {
      const content = raw.content;
      event.text = typeof content === 'string' ? content : '';
    }
    return event;
  }

  private normalizeAssistantMessage(raw: Record<string, unknown>): AgentEvent {
    const content = raw.content;

    // Content can be a string (pure text) or array of content blocks
    if (typeof content === 'string') {
      const event = this.makeEvent('text_delta', raw);
      event.text = content;
      return event;
    }

    if (Array.isArray(content)) {
      // Look for tool_use blocks first — they're more interesting
      const toolBlock = content.find(
        (b: unknown) =>
          b && typeof b === 'object' && (b as Record<string, unknown>).type === 'tool_use',
      ) as Record<string, unknown> | undefined;

      if (toolBlock) {
        const event = this.makeEvent('tool_start', raw);
        event.toolName = (toolBlock.name as string) ?? 'unknown';
        event.toolUseId = (toolBlock.id as string) ?? undefined;
        event.status = 'running';
        if (toolBlock.input && typeof toolBlock.input === 'object') {
          event.toolInput = toolBlock.input as Record<string, unknown>;
        }
        return event;
      }

      // Otherwise extract text blocks
      const textParts = content
        .filter(
          (b: unknown) =>
            b && typeof b === 'object' && (b as Record<string, unknown>).type === 'text',
        )
        .map((b: unknown) => String((b as Record<string, unknown>).text ?? ''));

      const event = this.makeEvent('text_delta', raw);
      event.text = textParts.join('\n');
      return event;
    }

    // Fallback
    return this.makeEvent('text_delta', raw);
  }

  // ── Normalize: state record ───────────────────────────────────

  private normalizeState(raw: Record<string, unknown>): AgentEvent {
    const data = raw.data as Record<string, unknown>;
    const event = this.makeEvent('session_start', raw);
    if (data.model) event.model = data.model as string;
    if (data.cwd) event.cwd = data.cwd as string;
    if (data.session_id) event.sessionId = prefixSessionId(data.session_id as string);
    return event;
  }

  // ── Helpers ───────────────────────────────────────────────────

  private makeEvent(type: AgentEventType, raw: Record<string, unknown>): AgentEvent {
    return {
      id: nanoid(),
      type,
      sessionId: prefixSessionId(this.extractSessionId(raw)),
      timestamp: Date.now(),
      eventSource: 'hook',
      vendor: 'openai',
    };
  }

  private extractSessionId(raw: Record<string, unknown>): string {
    // Notify hook uses thread-id or thread_id
    if (raw['thread-id']) return raw['thread-id'] as string;
    if (raw.thread_id) return raw.thread_id as string;
    // JSONL events may carry session_id from the file watcher
    if (raw.session_id) return raw.session_id as string;
    // Fallback
    return 'unknown';
  }
}

// ─── Helpers ────────────────────────────────────────────────────

function prefixSessionId(id: string): string {
  return id.startsWith('codex-') ? id : `codex-${id}`;
}
