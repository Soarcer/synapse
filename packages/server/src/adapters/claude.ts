// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bernhard

// ─── Claude Code Hook Adapter ───────────────────────────────────────
// Normalizes Claude Code hook events into AgentEvent.
// Extracted from eventStore.ts — zero behavioral change.

import { nanoid } from 'nanoid';
import type { AgentEvent, AgentEventType } from '@synapse-ai/core';
import type { Adapter } from './types.js';

// ─── Hook Event Name → AgentEventType Mapping ──────────────────────

export const CLAUDE_HOOK_EVENT_MAP: Record<string, AgentEventType> = {
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
  AssistantResponse: 'assistant_response',
};

export const CLAUDE_HOOK_EVENT_NAMES = new Set(Object.keys(CLAUDE_HOOK_EVENT_MAP));

// ─── Extract text from prompt (may be string, content block, or array) ──

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

// ─── Claude Adapter ─────────────────────────────────────────────────

export class ClaudeAdapter implements Adapter {
  readonly id = 'claude';
  readonly vendor = 'anthropic';

  detect(raw: Record<string, unknown>): boolean {
    // Claude is the catch-all adapter — accepts anything with a hook_event_name.
    // Register last so more specific adapters (Gemini, Codex) match first.
    const hookName = raw.hook_event_name as string | undefined;
    return !!hookName;
  }

  normalize(raw: Record<string, unknown>): AgentEvent {
    const hookEventName = (raw.hook_event_name as string) || 'unknown';
    // Stop events with last_assistant_message are really assistant responses
    const eventType =
      hookEventName === 'Stop' && raw.last_assistant_message
        ? 'assistant_response'
        : CLAUDE_HOOK_EVENT_MAP[hookEventName] || 'result';
    const now = Date.now();

    const event: AgentEvent = {
      id: nanoid(),
      type: eventType,
      sessionId: (raw.session_id as string) || 'unknown',
      timestamp: now,
      eventSource: 'hook',
      vendor: 'anthropic',
    };

    // ── Common metadata ──
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

      case 'Stop':
        if (raw.last_assistant_message) event.text = raw.last_assistant_message as string;
        if (raw.model) event.model = raw.model as string;
        break;

      case 'AssistantResponse':
        if (raw.assistant_text) event.text = raw.assistant_text as string;
        if (raw.model) event.model = raw.model as string;
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

  dedupeFingerprint(raw: Record<string, unknown>): string | null {
    const sessionId = raw.session_id ?? '';
    const hookName = raw.hook_event_name ?? '';
    const toolUseId = raw.tool_use_id ?? '';
    const agentId = raw.agent_id ?? '';
    // Include text content for prompts and responses to avoid false dedup
    let textKey = '';
    if (hookName === 'UserPromptSubmit') {
      textKey = String(typeof raw.prompt === 'string' ? raw.prompt : '').slice(0, 200);
    } else if (hookName === 'AssistantResponse') {
      textKey = String(raw.assistant_text ?? '').slice(0, 200);
    } else if (hookName === 'Stop' && raw.last_assistant_message) {
      textKey = String(raw.last_assistant_message).slice(0, 200);
    }
    return `${sessionId}:${hookName}:${toolUseId}:${agentId}:${textKey}`;
  }
}
