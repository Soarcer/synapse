// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bernhard

import { nanoid } from 'nanoid';
import type { TranscriptLine, TranscriptContentBlock } from '../types.js';

// ─── Types from Synapse core ────────────────────────────────────────

interface AgentEvent {
  id: string;
  type: string;
  sessionId: string;
  agentId?: string;
  agentType?: string;
  parentAgentId?: string;
  toolName?: string;
  toolInput?: Record<string, unknown>;
  toolResponse?: Record<string, unknown>;
  toolUseId?: string;
  text?: string;
  status?: 'running' | 'success' | 'error' | 'stopped';
  error?: string;
  tokenUsage?: { input: number; output: number };
  duration?: number;
  timestamp: number;
  model?: string;
  eventSource?: 'hook' | 'sdk' | 'openclaw';
  vendor?: string;
  costUsd?: number;
}

// ─── Vendor Inference ───────────────────────────────────────────────

export function inferVendor(model?: string): string {
  if (!model) return 'custom';
  const m = model.toLowerCase();
  if (m.includes('claude') || m.startsWith('anthropic/')) return 'anthropic';
  if (m.includes('gpt') || m.startsWith('openai/')) return 'openai';
  if (m.includes('gemini') || m.startsWith('google/')) return 'google';
  if (m.startsWith('groq/')) return 'groq';
  if (m.startsWith('openrouter/')) return 'openrouter';
  return 'custom';
}

// ─── Pricing Table (per 1M tokens) ─────────────────────────────────

const PRICING: Record<string, { input: number; output: number }> = {
  'claude-opus-4-6': { input: 15, output: 75 },
  'claude-sonnet-4-5': { input: 3, output: 15 },
  'claude-haiku-4-5': { input: 0.8, output: 4 },
  'gpt-4o': { input: 2.5, output: 10 },
  'gpt-4-turbo': { input: 10, output: 30 },
  'gpt-3.5-turbo': { input: 0.5, output: 1.5 },
  'gemini-2.0-flash': { input: 0.075, output: 0.3 },
  'gemini-2.0-pro': { input: 1.25, output: 5 },
};

function estimateCost(model: string, inputTokens: number, outputTokens: number): number {
  // Strip vendor prefix (e.g., "anthropic/claude-opus-4-6" → "claude-opus-4-6")
  const modelName = model.includes('/') ? model.split('/').pop()! : model;

  // Find pricing by prefix match (handles versioned model names)
  const pricing =
    PRICING[modelName] ?? Object.entries(PRICING).find(([k]) => modelName.startsWith(k))?.[1];

  if (!pricing) return 0;
  return (inputTokens * pricing.input + outputTokens * pricing.output) / 1_000_000;
}

// ─── Session State Tracker ──────────────────────────────────────────

interface SessionState {
  sessionId: string;
  agentId: string;
  started: boolean;
  lastModel?: string;
  lastVendor?: string;
  pendingToolCalls: Map<
    string,
    { name: string; input: Record<string, unknown>; startTime: number }
  >;
}

const sessionStates = new Map<string, SessionState>();

function getSessionState(agentId: string, sessionFile: string): SessionState {
  const key = `${agentId}:${sessionFile}`;
  let state = sessionStates.get(key);
  if (!state) {
    // Generate deterministic session ID from agent + file
    const sessionId = `oc-${agentId}-${hashCode(sessionFile)}`;
    state = {
      sessionId,
      agentId,
      started: false,
      pendingToolCalls: new Map(),
    };
    sessionStates.set(key, state);
  }
  return state;
}

function hashCode(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return Math.abs(hash).toString(36).slice(0, 8);
}

// ─── Main Normalizer ────────────────────────────────────────────────

export function normalizeOpenClawJsonl(
  line: TranscriptLine,
  context: { agentId: string; sessionFile: string },
): AgentEvent[] {
  const events: AgentEvent[] = [];
  const state = getSessionState(context.agentId, context.sessionFile);
  const now = Date.now();
  const ts = line.timestamp ? new Date(line.timestamp).getTime() : now;

  // Extract model and vendor
  const model = line.model ?? state.lastModel;
  const vendor = model ? inferVendor(model) : (state.lastVendor ?? 'custom');
  if (line.model) {
    state.lastModel = line.model;
    state.lastVendor = vendor;
  }

  // ── Auto-generate session_start on first message ──
  if (!state.started) {
    state.started = true;
    events.push({
      id: nanoid(),
      type: 'session_start',
      sessionId: state.sessionId,
      agentId: context.agentId,
      agentType: 'openclaw',
      model,
      vendor,
      timestamp: ts,
      eventSource: 'openclaw',
    });
  }

  switch (line.role) {
    case 'user': {
      const text =
        typeof line.content === 'string'
          ? line.content
          : (line.content?.map((b) => b.text ?? '').join('') ?? '');
      events.push({
        id: nanoid(),
        type: 'user_prompt',
        sessionId: state.sessionId,
        text: text.slice(0, 2000),
        timestamp: ts,
        eventSource: 'openclaw',
        vendor,
      });
      break;
    }

    case 'assistant': {
      if (typeof line.content === 'string') {
        // Text response
        events.push({
          id: nanoid(),
          type: 'text_delta',
          sessionId: state.sessionId,
          agentId: context.agentId,
          agentType: 'openclaw',
          text: line.content.slice(0, 500),
          model,
          vendor,
          timestamp: ts,
          eventSource: 'openclaw',
        });
      } else if (Array.isArray(line.content)) {
        // Content blocks — may contain text and/or tool_use
        for (const block of line.content as TranscriptContentBlock[]) {
          if (block.type === 'text' && block.text) {
            events.push({
              id: nanoid(),
              type: 'text_delta',
              sessionId: state.sessionId,
              agentId: context.agentId,
              agentType: 'openclaw',
              text: block.text.slice(0, 500),
              model,
              vendor,
              timestamp: ts,
              eventSource: 'openclaw',
            });
          } else if (block.type === 'tool_use' && block.id && block.name) {
            state.pendingToolCalls.set(block.id, {
              name: block.name,
              input: (block.input ?? {}) as Record<string, unknown>,
              startTime: ts,
            });
            events.push({
              id: nanoid(),
              type: 'tool_start',
              sessionId: state.sessionId,
              agentId: context.agentId,
              agentType: 'openclaw',
              toolName: block.name,
              toolUseId: block.id,
              toolInput: (block.input ?? {}) as Record<string, unknown>,
              status: 'running',
              model,
              vendor,
              timestamp: ts,
              eventSource: 'openclaw',
            });
          }
        }
      }

      // Token usage from this turn
      if (line.usage) {
        const inputTokens =
          (line.usage.input_tokens ?? 0) +
          (line.usage.cache_creation_input_tokens ?? 0) +
          (line.usage.cache_read_input_tokens ?? 0);
        const outputTokens = line.usage.output_tokens ?? 0;
        const cost = model ? estimateCost(model, inputTokens, outputTokens) : 0;

        events.push({
          id: nanoid(),
          type: 'result',
          sessionId: state.sessionId,
          agentId: context.agentId,
          agentType: 'openclaw',
          tokenUsage: { input: inputTokens, output: outputTokens },
          costUsd: cost > 0 ? cost : undefined,
          model,
          vendor,
          timestamp: ts,
          eventSource: 'openclaw',
        });
      }
      break;
    }

    case 'tool': {
      const toolUseId = line.tool_use_id;
      if (toolUseId) {
        const pending = state.pendingToolCalls.get(toolUseId);
        const duration = pending ? ts - pending.startTime : undefined;

        events.push({
          id: nanoid(),
          type: 'tool_end',
          sessionId: state.sessionId,
          agentId: context.agentId,
          agentType: 'openclaw',
          toolName: pending?.name,
          toolUseId,
          toolResponse:
            typeof line.content === 'string' ? { output: line.content.slice(0, 5000) } : undefined,
          status: 'success',
          duration,
          vendor,
          timestamp: ts,
          eventSource: 'openclaw',
        });

        state.pendingToolCalls.delete(toolUseId);
      }
      break;
    }

    // system messages are ignored
  }

  return events;
}

/** Reset all tracked session state (for testing) */
export function resetSessionStates(): void {
  sessionStates.clear();
}
