import { createHash } from 'crypto';
import { logger } from '../lib/logger.js';
import { resolveApiKey, getAiCoachModel, isAiCoachEnabled } from './settingsService.js';
import { getAiCacheEntry, setAiCacheEntry, pruneAiCache } from '../db.js';
import type { PromptAnalysis, SessionSummary, EnrichedNudge, CoachingNudge, AiCoachStatus } from '@synapse-ai/core';

// ─── Rate Limiting ───────────────────────────────────────────────────

const MAX_CONCURRENT = 10;
let activeCalls = 0;
const BACKOFF_BASE_MS = 1000;

// ─── Helpers ─────────────────────────────────────────────────────────

function contentHash(data: unknown): string {
  return createHash('sha256').update(JSON.stringify(data)).digest('hex').slice(0, 16);
}

async function callAnthropic(params: {
  model: string;
  system: string;
  userMessage: string;
  maxTokens?: number;
}): Promise<string> {
  const { key } = resolveApiKey();
  if (!key) throw new Error('No Anthropic API key configured');

  if (activeCalls >= MAX_CONCURRENT) {
    throw new Error('Too many concurrent AI calls, try again later');
  }

  activeCalls++;
  let retries = 0;
  const maxRetries = 3;

  try {
    while (retries < maxRetries) {
      try {
        const response = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': key,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model: params.model,
            max_tokens: params.maxTokens ?? 1024,
            system: params.system,
            messages: [{ role: 'user', content: params.userMessage }],
          }),
        });

        if (response.status === 429) {
          retries++;
          const delay = BACKOFF_BASE_MS * Math.pow(2, retries);
          logger.warn({ retries, delay }, 'Rate limited by Anthropic, backing off');
          await new Promise((resolve) => setTimeout(resolve, delay));
          continue;
        }

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`Anthropic API error (${response.status}): ${errorText.slice(0, 200)}`);
        }

        const data = await response.json() as {
          content: { type: string; text: string }[];
        };

        const textBlock = data.content.find((c) => c.type === 'text');
        return textBlock?.text ?? '';
      } catch (err) {
        if (retries >= maxRetries - 1) throw err;
        retries++;
        const delay = BACKOFF_BASE_MS * Math.pow(2, retries);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
    throw new Error('Max retries exceeded');
  } finally {
    activeCalls--;
  }
}

// ─── Public API ──────────────────────────────────────────────────────

export function getStatus(): AiCoachStatus {
  const { key, source } = resolveApiKey();
  const model = getAiCoachModel();
  return {
    available: !!key && isAiCoachEnabled(),
    source,
    model,
    maskedKey: key ? `${key.slice(0, 4)}...${key.slice(-4)}` : '',
  };
}

export function isAvailable(): boolean {
  const { key } = resolveApiKey();
  return !!key && isAiCoachEnabled();
}

/**
 * Generate a 3-sentence summary of session activity.
 */
export async function summarizeSession(context: {
  sessionId: string;
  totalCost: number;
  totalTokens: number;
  promptCount: number;
  toolCalls: number;
  model: string;
  topTools: string[];
  durationMinutes: number;
}): Promise<SessionSummary> {
  const hash = contentHash(context);
  const cacheKey = `summarize:${context.sessionId}:${hash}`;

  // Check cache
  const cached = getAiCacheEntry(cacheKey);
  if (cached) {
    return JSON.parse(cached) as SessionSummary;
  }

  if (!isAvailable()) {
    return {
      summary: 'AI summary unavailable — configure an API key in Settings to enable AI-powered insights.',
      roiMetrics: { timeSaved: 'N/A', costPerTask: 'N/A', successRate: 'N/A' },
    };
  }

  const model = getAiCoachModel();
  const text = await callAnthropic({
    model,
    system: 'You are an expert AI coding assistant analyst. Provide concise, actionable summaries. Respond in JSON format.',
    userMessage: `Summarize this coding session in exactly 3 sentences, and estimate ROI metrics.

Session data:
- Cost: $${context.totalCost.toFixed(4)}
- Total tokens: ${context.totalTokens.toLocaleString()}
- Prompts: ${context.promptCount}
- Tool calls: ${context.toolCalls}
- Model: ${context.model}
- Top tools: ${context.topTools.join(', ')}
- Duration: ${context.durationMinutes} minutes

Respond with JSON: { "summary": "3 sentences...", "roiMetrics": { "timeSaved": "e.g. ~2 hours", "costPerTask": "e.g. $0.15", "successRate": "e.g. 85%" } }`,
    maxTokens: 512,
  });

  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    const result = JSON.parse(jsonMatch?.[0] ?? '{}') as SessionSummary;
    if (result.summary) {
      setAiCacheEntry({ cacheKey, method: 'summarize', sessionId: context.sessionId, contentHash: hash, response: JSON.stringify(result) });
      return result;
    }
  } catch { /* parse error, fall through */ }

  return {
    summary: text.slice(0, 500),
    roiMetrics: { timeSaved: 'N/A', costPerTask: `$${context.totalCost.toFixed(4)}`, successRate: 'N/A' },
  };
}

/**
 * Analyze a single prompt for quality, rewrite, and savings.
 */
export async function analyzePrompt(params: {
  promptText: string;
  sessionContext: {
    model: string;
    toolCount: number;
    category: string;
    cost: number;
  };
}): Promise<PromptAnalysis> {
  const hash = contentHash(params);
  const cacheKey = `prompt:${hash}`;

  const cached = getAiCacheEntry(cacheKey);
  if (cached) return JSON.parse(cached) as PromptAnalysis;

  if (!isAvailable()) {
    return {
      score: 0,
      explanation: 'AI analysis unavailable — configure an API key in Settings.',
      rewrite: '',
      estimatedSavings: 'N/A',
      historyComparison: 'N/A',
    };
  }

  const model = getAiCoachModel();
  const text = await callAnthropic({
    model,
    system: 'You are an expert at crafting effective prompts for AI coding assistants. Rate and improve prompts. Respond in JSON format.',
    userMessage: `Analyze this prompt sent to an AI coding assistant:

"${params.promptText.slice(0, 2000)}"

Context: Model=${params.sessionContext.model}, tools=${params.sessionContext.toolCount}, category=${params.sessionContext.category}, cost=$${params.sessionContext.cost.toFixed(4)}

Respond with JSON: { "score": 1-10, "explanation": "why this score", "rewrite": "improved version of the prompt", "estimatedSavings": "e.g. 30% fewer tokens", "historyComparison": "how this compares to typical prompts" }`,
    maxTokens: 768,
  });

  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    const result = JSON.parse(jsonMatch?.[0] ?? '{}') as PromptAnalysis;
    if (result.score) {
      setAiCacheEntry({ cacheKey, method: 'prompt', contentHash: hash, response: JSON.stringify(result) });
      return result;
    }
  } catch { /* parse error */ }

  return { score: 5, explanation: text.slice(0, 300), rewrite: '', estimatedSavings: 'N/A', historyComparison: 'N/A' };
}

/**
 * Generate actionable recommendations from session data.
 */
export async function generateRecommendations(context: {
  totalCost: number;
  cacheHitRate: number;
  topTools: { name: string; count: number; errorRate: number }[];
  modelUsage: { model: string; cost: number; sessions: number }[];
  avgPromptLength: number;
  compactionRate: number;
}): Promise<{ title: string; description: string; impact: string }[]> {
  const hash = contentHash(context);
  const cacheKey = `recommendations:${hash}`;

  const cached = getAiCacheEntry(cacheKey);
  if (cached) return JSON.parse(cached) as { title: string; description: string; impact: string }[];

  if (!isAvailable()) return [];

  const model = getAiCoachModel();
  const text = await callAnthropic({
    model,
    system: 'You are an AI coding efficiency expert. Provide 3-5 specific, actionable recommendations. Respond in JSON format.',
    userMessage: `Based on this usage data, provide actionable recommendations:

- Total cost: $${context.totalCost.toFixed(2)}
- Cache hit rate: ${(context.cacheHitRate * 100).toFixed(0)}%
- Top tools: ${context.topTools.map((t) => `${t.name}(${t.count}, ${(t.errorRate * 100).toFixed(0)}% errors)`).join(', ')}
- Model usage: ${context.modelUsage.map((m) => `${m.model}($${m.cost.toFixed(2)}, ${m.sessions} sessions)`).join(', ')}
- Avg prompt length: ${context.avgPromptLength} words
- Compaction rate: ${(context.compactionRate * 100).toFixed(0)}%

Respond with JSON array: [{ "title": "...", "description": "...", "impact": "..." }]`,
    maxTokens: 1024,
  });

  try {
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    const result = JSON.parse(jsonMatch?.[0] ?? '[]') as { title: string; description: string; impact: string }[];
    if (result.length > 0) {
      setAiCacheEntry({ cacheKey, method: 'recommendations', contentHash: hash, response: JSON.stringify(result) });
      return result;
    }
  } catch { /* parse error */ }

  return [];
}

/**
 * AI-enhance a nudge with deeper analysis.
 */
export async function escalateNudge(nudge: CoachingNudge, recentEvents: string[]): Promise<EnrichedNudge> {
  if (!isAvailable()) {
    return {
      originalNudge: nudge,
      aiAnalysis: 'AI analysis unavailable',
      actionItems: [nudge.recommendation],
      source: 'rule',
    };
  }

  const model = getAiCoachModel();
  const text = await callAnthropic({
    model,
    system: 'You are an AI coding coach. Analyze the situation and provide specific action items. Respond in JSON format.',
    userMessage: `A coaching nudge was triggered:

Title: ${nudge.title}
Message: ${nudge.message}
Severity: ${nudge.severity}
Rule recommendation: ${nudge.recommendation}

Recent events: ${recentEvents.slice(0, 10).join(', ')}

Respond with JSON: { "aiAnalysis": "deeper analysis of what's happening", "actionItems": ["specific action 1", "specific action 2"] }`,
    maxTokens: 512,
  });

  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(jsonMatch?.[0] ?? '{}') as { aiAnalysis: string; actionItems: string[] };
    return {
      originalNudge: nudge,
      aiAnalysis: parsed.aiAnalysis ?? text.slice(0, 300),
      actionItems: parsed.actionItems ?? [nudge.recommendation],
      source: 'ai-escalation',
    };
  } catch {
    return {
      originalNudge: nudge,
      aiAnalysis: text.slice(0, 300),
      actionItems: [nudge.recommendation],
      source: 'ai-escalation',
    };
  }
}

// Prune expired cache on startup (guarded — db may not be ready in tests)
try { pruneAiCache(); } catch { /* db not initialized yet */ }
