// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Synapse Contributors

// ─── Gemini CLI Hook Adapter ────────────────────────────────────────
// Normalizes Gemini CLI hook events into AgentEvent.
// Gemini hooks use stdin JSON delivery identical to Claude Code,
// with different event names and ISO-8601 timestamps.

import { nanoid } from 'nanoid';
import type { AgentEvent, AgentEventType } from '@synapse-ai/core';
import type { Adapter } from './types.js';

// ─── Gemini Hook Event Name → AgentEventType Mapping ────────────────

const GEMINI_EVENT_MAP: Record<string, AgentEventType> = {
  SessionStart: 'session_start',
  SessionEnd: 'session_end',
  BeforeModel: 'user_prompt',
  BeforeTool: 'tool_start',
  AfterTool: 'tool_end', // Promoted to tool_error if error present
  BeforeToolSelection: 'notification',
};

// Hook names that only Gemini uses (not shared with Claude)
const GEMINI_EXCLUSIVE_HOOKS = new Set([
  'BeforeModel',
  'BeforeTool',
  'AfterTool',
  'BeforeToolSelection',
]);

// ─── Gemini Adapter ─────────────────────────────────────────────────

export class GeminiAdapter implements Adapter {
  readonly id = 'gemini';
  readonly vendor = 'google';

  detect(raw: Record<string, unknown>): boolean {
    const hookName = raw.hook_event_name as string | undefined;
    if (!hookName) return false;

    // Gemini-exclusive hook names are unambiguous
    if (GEMINI_EXCLUSIVE_HOOKS.has(hookName)) return true;

    // Disambiguate shared names (SessionStart/SessionEnd) by transcript_path
    if (hookName === 'SessionStart' || hookName === 'SessionEnd') {
      const transcriptPath = (raw.transcript_path as string) ?? '';
      return transcriptPath.includes('/.gemini/') || transcriptPath.includes('\\.gemini\\');
    }

    return false;
  }

  normalize(raw: Record<string, unknown>): AgentEvent {
    const hookEventName = (raw.hook_event_name as string) || 'unknown';
    let eventType: AgentEventType = GEMINI_EVENT_MAP[hookEventName] ?? 'notification';

    // Promote AfterTool to tool_error if error field is present
    if (hookEventName === 'AfterTool') {
      const toolResponse = raw.tool_response as Record<string, unknown> | undefined;
      if (raw.error || (toolResponse && toolResponse.error)) {
        eventType = 'tool_error';
      }
    }

    // Gemini timestamps are ISO-8601 strings, not Unix ms
    const timestamp = parseTimestamp(raw.timestamp);

    // Session ID prefixing for namespace isolation
    const rawSessionId = (raw.session_id as string) || nanoid();
    const sessionId = rawSessionId.startsWith('gemini-') ? rawSessionId : `gemini-${rawSessionId}`;

    const event: AgentEvent = {
      id: nanoid(),
      type: eventType,
      sessionId,
      timestamp,
      eventSource: 'hook',
      vendor: 'google',
    };

    // ── Common metadata ──
    if (raw.cwd) event.cwd = raw.cwd as string;
    if (raw.transcript_path) event.transcriptPath = raw.transcript_path as string;

    // ── Tool fields (same snake_case as Claude) ──
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
        // Model from top-level or nested llm_request
        if (raw.model) event.model = raw.model as string;
        if (raw.source) event.source = raw.source as string;
        break;

      case 'SessionEnd':
        if (raw.reason) event.reason = raw.reason as string;
        break;

      case 'BeforeModel': {
        // Extract model and last user message from llm_request
        const llmRequest = raw.llm_request as Record<string, unknown> | undefined;
        if (llmRequest) {
          if (llmRequest.model) event.model = llmRequest.model as string;
          // Extract last user message as prompt text
          const messages = llmRequest.messages as Array<Record<string, unknown>> | undefined;
          if (messages && messages.length > 0) {
            // Find the last user message
            for (let i = messages.length - 1; i >= 0; i--) {
              if (messages[i].role === 'user') {
                event.text = String(messages[i].content ?? '');
                break;
              }
            }
          }
        }
        // Fallback: direct prompt field
        if (!event.text && raw.prompt) event.text = String(raw.prompt);
        break;
      }

      case 'BeforeToolSelection':
        if (raw.message) event.text = raw.message as string;
        event.notificationType = 'tool_selection';
        break;

      case 'AfterTool': {
        const toolResp = raw.tool_response as Record<string, unknown> | undefined;
        if (toolResp && toolResp.error) {
          event.error = String(toolResp.error);
        } else if (raw.error) {
          event.error = String(raw.error);
        }
        break;
      }
    }

    // ── Status mapping ──
    if (hookEventName === 'BeforeTool') {
      event.status = 'running';
    } else if (hookEventName === 'AfterTool') {
      event.status = event.error ? 'error' : 'success';
    }

    return event;
  }

  dedupeFingerprint(raw: Record<string, unknown>): string | null {
    const sessionId = raw.session_id ?? '';
    const hookName = raw.hook_event_name ?? '';
    const toolName = raw.tool_name ?? '';
    const promptText = hookName === 'BeforeModel' ? String(raw.prompt ?? '').slice(0, 200) : '';
    return `${sessionId}:${hookName}:${toolName}:${promptText}`;
  }
}

// ─── Helpers ────────────────────────────────────────────────────────

function parseTimestamp(ts: unknown): number {
  if (typeof ts === 'number') return ts;
  if (typeof ts === 'string') {
    const parsed = new Date(ts).getTime();
    return isNaN(parsed) ? Date.now() : parsed;
  }
  return Date.now();
}
