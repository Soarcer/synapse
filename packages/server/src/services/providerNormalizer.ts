// ─── Provider Normalizer ────────────────────────────────────────────
// Normalizes events from different AI providers into Synapse's AgentEvent shape.

import { nanoid } from 'nanoid';
import type { AgentEvent, AgentEventType } from '@synapse-ai/core';
import { logger } from '../lib/logger.js';

// ─── Provider Detection ─────────────────────────────────────────────

export type ProviderFormat = 'openai' | 'google' | 'groq' | 'anthropic' | 'generic';

export function detectProvider(data: Record<string, unknown>): ProviderFormat {
  // OpenAI format markers
  if (data.object === 'chat.completion' || data.model?.toString().startsWith('gpt') || data.model?.toString().startsWith('o1') || data.model?.toString().startsWith('o3')) {
    return 'openai';
  }
  // Google/Gemini format markers
  if (data.model?.toString().includes('gemini') || data.candidates !== undefined || data.promptFeedback !== undefined) {
    return 'google';
  }
  // Groq format markers
  if (data['x_groq'] !== undefined || (data.model?.toString().includes('llama') && data.object === 'chat.completion')) {
    return 'groq';
  }
  // Anthropic format (our native format)
  if (data.hook_event_name || data.model?.toString().includes('claude')) {
    return 'anthropic';
  }
  return 'generic';
}

// ─── OpenAI Normalizer ──────────────────────────────────────────────

function normalizeOpenAI(data: Record<string, unknown>, sessionId?: string): AgentEvent {
  const usage = data.usage as Record<string, unknown> | undefined;
  const model = (data.model as string) || 'gpt-4o';
  const choices = data.choices as Array<Record<string, unknown>> | undefined;

  const event: AgentEvent = {
    id: nanoid(),
    type: 'result' as AgentEventType,
    sessionId: sessionId || (data.id as string) || nanoid(),
    timestamp: data.created ? (data.created as number) * 1000 : Date.now(),
    model,
    vendor: 'openai',
    eventSource: 'openclaw',
  };

  if (usage) {
    event.tokenUsage = {
      input: Number(usage.prompt_tokens ?? 0),
      output: Number(usage.completion_tokens ?? 0),
    };
  }

  // Extract tool calls from choices
  if (choices && choices.length > 0) {
    const choice = choices[0];
    const message = choice.message as Record<string, unknown> | undefined;
    if (message) {
      const toolCalls = message.tool_calls as Array<Record<string, unknown>> | undefined;
      if (toolCalls && toolCalls.length > 0) {
        event.type = 'tool_end';
        const tc = toolCalls[0];
        const fn = tc.function as Record<string, unknown> | undefined;
        event.toolName = fn?.name as string;
        event.toolUseId = tc.id as string;
        try {
          event.toolInput = JSON.parse((fn?.arguments as string) || '{}');
        } catch { /* ignore */ }
      }
      if (message.content) {
        event.text = message.content as string;
      }
    }
    if (choice.finish_reason === 'stop') event.status = 'success';
    else if (choice.finish_reason === 'tool_calls') event.status = 'success';
  }

  return event;
}

// ─── Google/Gemini Normalizer ───────────────────────────────────────

function normalizeGoogle(data: Record<string, unknown>, sessionId?: string): AgentEvent {
  const model = (data.model as string) || (data.modelVersion as string) || 'gemini-2.5-pro';
  const usageMeta = data.usageMetadata as Record<string, unknown> | undefined;

  const event: AgentEvent = {
    id: nanoid(),
    type: 'result' as AgentEventType,
    sessionId: sessionId || nanoid(),
    timestamp: Date.now(),
    model,
    vendor: 'google',
    eventSource: 'openclaw',
  };

  if (usageMeta) {
    event.tokenUsage = {
      input: Number(usageMeta.promptTokenCount ?? 0),
      output: Number(usageMeta.candidatesTokenCount ?? 0),
    };
  }

  const candidates = data.candidates as Array<Record<string, unknown>> | undefined;
  if (candidates && candidates.length > 0) {
    const content = candidates[0].content as Record<string, unknown> | undefined;
    if (content) {
      const parts = content.parts as Array<Record<string, unknown>> | undefined;
      if (parts && parts.length > 0) {
        const part = parts[0];
        if (part.text) event.text = part.text as string;
        if (part.functionCall) {
          event.type = 'tool_end';
          const fc = part.functionCall as Record<string, unknown>;
          event.toolName = fc.name as string;
          event.toolInput = fc.args as Record<string, unknown>;
        }
      }
    }
    if (candidates[0].finishReason === 'STOP') event.status = 'success';
  }

  return event;
}

// ─── Groq Normalizer ────────────────────────────────────────────────

function normalizeGroq(data: Record<string, unknown>, sessionId?: string): AgentEvent {
  // Groq uses OpenAI-compatible format, so delegate with vendor override
  const event = normalizeOpenAI(data, sessionId);
  event.vendor = 'groq';
  return event;
}

// ─── Generic Normalizer ─────────────────────────────────────────────

function normalizeGeneric(data: Record<string, unknown>, sessionId?: string): AgentEvent {
  return {
    id: nanoid(),
    type: (data.type as AgentEventType) || 'result',
    sessionId: sessionId || (data.sessionId as string) || (data.session_id as string) || nanoid(),
    timestamp: (data.timestamp as number) || (data.created_at as number) || Date.now(),
    model: (data.model as string) || 'unknown',
    vendor: (data.vendor as string) || 'unknown',
    eventSource: 'openclaw',
    text: data.text as string | undefined,
    tokenUsage: data.tokenUsage ? {
      input: Number((data.tokenUsage as Record<string, unknown>).input ?? 0),
      output: Number((data.tokenUsage as Record<string, unknown>).output ?? 0),
    } : undefined,
  };
}

// ─── Public API ─────────────────────────────────────────────────────

export function normalizeProviderEvent(
  data: Record<string, unknown>,
  sessionId?: string,
  providerHint?: ProviderFormat,
): AgentEvent {
  const provider = providerHint || detectProvider(data);
  logger.debug({ provider }, 'Normalizing provider event');

  switch (provider) {
    case 'openai': return normalizeOpenAI(data, sessionId);
    case 'google': return normalizeGoogle(data, sessionId);
    case 'groq': return normalizeGroq(data, sessionId);
    case 'anthropic': return normalizeGeneric(data, sessionId); // Anthropic events already in native format
    default: return normalizeGeneric(data, sessionId);
  }
}

// ─── CSV Row Normalizer (for OpenAI usage export) ───────────────────

export interface CsvUsageRow {
  date: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  requests: number;
  cost?: number;
}

export function normalizeCsvRow(row: CsvUsageRow, sessionId?: string): AgentEvent {
  const timestamp = new Date(row.date).getTime();
  return {
    id: nanoid(),
    type: 'result',
    sessionId: sessionId || `csv-import-${row.date}`,
    timestamp: isNaN(timestamp) ? Date.now() : timestamp,
    model: row.model || 'unknown',
    vendor: inferVendorFromModel(row.model),
    eventSource: 'openclaw',
    tokenUsage: {
      input: row.input_tokens || 0,
      output: row.output_tokens || 0,
    },
  };
}

function inferVendorFromModel(model: string): string {
  const m = model.toLowerCase();
  if (m.includes('claude') || m.startsWith('anthropic/')) return 'anthropic';
  if (m.includes('gpt') || m.includes('o1') || m.includes('o3') || m.startsWith('openai/')) return 'openai';
  if (m.includes('gemini') || m.startsWith('google/')) return 'google';
  if (m.includes('llama') || m.startsWith('groq/')) return 'groq';
  return 'unknown';
}
