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

const ALLOWED_MODELS = new Set([
  'claude-haiku-4-5-20251001',
  'claude-sonnet-4-5-20250929',
  'claude-opus-4-6',
  'claude-3-5-haiku-20241022',
  'claude-3-5-sonnet-20241022',
]);

async function callAnthropic(params: {
  model: string;
  system: string;
  userMessage: string;
  maxTokens?: number;
}): Promise<string> {
  const { key } = resolveApiKey();
  if (!key) throw new Error('No Anthropic API key configured');
  if (!ALLOWED_MODELS.has(params.model)) {
    throw new Error(`Model "${params.model}" is not in the allowed list`);
  }

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
          // Log only status code — response body may contain sensitive data
          throw new Error(`Anthropic API error (${response.status})`);
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
    const cleaned = text.replace(/```(?:json)?\s*/g, '').trim();
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
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
  mode?: 'developer' | 'vibe';
  skipCache?: boolean;
  modelOverride?: string;
  sessionContext: {
    model: string;
    toolCount: number;
    category: string;
    cost: number;
  };
  conversationContext?: {
    recentPrompts: string[];       // last 3 prompts before the current one
    sessionGoal: string;           // extracted from prompt 1
    turnNumber: number;            // 1-based prompt count
    isConversationalMode: boolean;
  };
}): Promise<PromptAnalysis> {
  const mode = params.mode ?? 'developer';
  const hash = contentHash({ ...params, mode, _v: 3 });
  const convHash = params.conversationContext ? contentHash(params.conversationContext) : 'no-ctx';
  const cacheKey = `prompt:${mode}:${hash}:${convHash}`;

  if (!params.skipCache) {
    const cached = getAiCacheEntry(cacheKey);
    if (cached) return JSON.parse(cached) as PromptAnalysis;
  }

  if (!isAvailable()) {
    return {
      score: 0,
      explanation: 'AI analysis unavailable — configure an API key in Settings.',
      rewrite: '',
      estimatedSavings: 'N/A',
      historyComparison: 'N/A',
    };
  }

  const isVibe = mode === 'vibe';

  const system = isVibe
    ? `You are a friendly prompt coach. Your audience uses AI coding tools but thinks in plain English, not code.

YOU MUST FOLLOW THESE RULES — VIOLATION MEANS FAILURE:

1. BANNED WORDS/PATTERNS in ALL fields (explanation AND rewrite):
   - Framework/library names: React, Vue, Angular, D3, Express, etc.
   - Code terms: algorithm, API, component, data structure, function, layout engine, x-axis, offset, horizontal spacing, DOM, state, props, etc.
   - Bracket placeholders: [anything], [COMPONENT], [framework], [language]
   - Template structures: bullet lists, numbered steps, "Technology Stack:", "Current Issue:", headers
   - Developer jargon: "underspecified", "back-and-forth", "tokens", "code snippet", "implementation"

2. REWRITE RULES:
   - Be as long as needed — use bullets, dashes, or numbered items if the original had multiple requests. Natural formatting is fine.
   - Sound like a confident person who knows what they want. Think "sophisticated vibe coder" — clear, direct, opinionated.
   - Be DIRECT: commands, not questions. "Fix the spacing" NOT "Can you fix the spacing?". NEVER start with "Can you", "Could you", "I'd like to", "I would like", "Please help me".
   - Start with a verb or context: "Clean up...", "Group...", "The toolbar needs..." — not "I'm working on X and want to..."
   - Don't just rephrase into better grammar — add the missing clarity. If something was vague, make it specific. If something was clear, keep it as-is.
   - The AI already has the codebase — the user doesn't need to re-explain their project or specify languages/frameworks.

3. EXAMPLES:
   GOOD explanation: "You said what you wanted but not which part of the screen you meant. The AI probably had to guess."
   BAD explanation: "This lacks context about the framework being used and the data structure layout."

   GOOD rewrite: "Clean up the toolbar:
- Group import/export/clear into one dropdown
- Put shortcuts behind a ? hover icon
- Add a time filter popup with presets like 'last hour', 'today', 'this week'
- Make session names useful — show time, duration, or a summary instead of random IDs"
   BAD rewrite: "I'm working on Synapse and want to clean up the interface. Can you group the import/export/clear buttons into one dropdown..."
   BAD rewrite: "Modify the layout algorithm to double the horizontal spacing between tool nodes and parent nodes in [JavaScript] using [D3.js]"

Be warm and brief. Respond in JSON format.`
    : 'You are an expert at crafting effective prompts for AI coding assistants. Rate and improve prompts. Respond in JSON format.';

  // Build conversation context block for both modes
  const convCtx = params.conversationContext;
  const contextBlock = convCtx && convCtx.recentPrompts.length > 0
    ? `\nConversation context:
- Turn number: ${convCtx.turnNumber} of the session
- Session goal: ${convCtx.sessionGoal || 'unknown'}
- Conversational mode: ${convCtx.isConversationalMode ? 'yes (iterative feedback loop — rapid short prompts are expected)' : 'no'}
- Recent prior prompts:
${convCtx.recentPrompts.map((p, i) => `  [${i + 1}] ${p.slice(0, 200)}`).join('\n')}

IMPORTANT: If conversational mode is active, short or referential prompts ("make it black", "yes do that", "now the header") are entirely appropriate. Do not penalize brevity when the conversation context makes the intent clear.\n`
    : '';

  const userMessage = isVibe
    ? `Rate this prompt someone sent to an AI coding assistant:

"${params.promptText.slice(0, 2000)}"
${contextBlock}
Context: This cost $${params.sessionContext.cost.toFixed(4)} and the AI used ${params.sessionContext.toolCount} tools to complete it.

Was the intent clear? Could they have said it more simply?

Remember: The user is talking to an AI that ALREADY HAS their codebase open. They don't need to specify the language, framework, or paste code. They just need to say what they want changed. A vibe coder says "fix it" or "make it work" — not "show me the code to modify the algorithm".

Respond with JSON:
{
  "score": 1-10,
  "explanation": "2-3 casual sentences. What was clear, what was vague. Use everyday words only — never say 'framework', 'library', 'algorithm', 'data structure', 'component', etc.",
  "rewrite": "A better version of the prompt — as long as needed, with bullets or dashes for multiple items. Direct and commanding, never start with 'Can you' or 'I want'. Sound like a confident person who knows what they want.",
  "estimatedSavings": "e.g. 'Could save you a bit on each use'",
  "historyComparison": "e.g. 'Pretty typical — most people keep it short like this'"
}`
    : `Analyze this prompt sent to an AI coding assistant:

"${params.promptText.slice(0, 2000)}"
${contextBlock}
Context: Model=${params.sessionContext.model}, tools=${params.sessionContext.toolCount}, category=${params.sessionContext.category}, cost=$${params.sessionContext.cost.toFixed(4)}

Respond with JSON: { "score": 1-10, "explanation": "why this score", "rewrite": "improved version of the prompt", "estimatedSavings": "e.g. 30% fewer tokens", "historyComparison": "how this compares to typical prompts" }`;

  const aiModel = (params.modelOverride && ALLOWED_MODELS.has(params.modelOverride))
    ? params.modelOverride
    : getAiCoachModel();
  const text = await callAnthropic({
    model: aiModel,
    system,
    userMessage,
    maxTokens: 768,
  });

  try {
    const cleaned = text.replace(/```(?:json)?\s*/g, '').trim();
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
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
}): Promise<{ title: string; description: string; impact: string; howTo: string[] }[]> {
  const hash = contentHash(context);
  const cacheKey = `recommendations:${hash}`;

  const cached = getAiCacheEntry(cacheKey);
  if (cached) return JSON.parse(cached) as { title: string; description: string; impact: string; howTo: string[] }[];

  if (!isAvailable()) return [];

  const model = getAiCoachModel();
  const text = await callAnthropic({
    model,
    system: 'You are an AI coding efficiency expert. Provide exactly 3 recommendations. Each MUST include a "howTo" array with 2-3 short, concrete examples. Keep each howTo step under 30 words. Respond with a raw JSON array only — no markdown, no code fences, no extra text.',
    userMessage: `Based on this usage data, provide 3 actionable recommendations:

- Total cost: $${context.totalCost.toFixed(2)}
- Cache hit rate: ${(context.cacheHitRate * 100).toFixed(0)}%
- Top tools: ${context.topTools.map((t) => `${t.name}(${t.count}, ${(t.errorRate * 100).toFixed(0)}% errors)`).join(', ')}
- Model usage: ${context.modelUsage.map((m) => `${m.model}($${m.cost.toFixed(2)}, ${m.sessions} sessions)`).join(', ')}
- Avg prompt length: ${context.avgPromptLength} words
- Compaction rate: ${(context.compactionRate * 100).toFixed(0)}%

Respond with ONLY a JSON array (no markdown): [{ "title": "short title", "description": "1 sentence", "impact": "estimated savings", "howTo": ["Concrete step with exact command or example", "Another specific step"] }]

howTo must be specific: "Type /fast to switch to Haiku" not "use a cheaper model". "Add a CLAUDE.md with your project structure" not "document your project".`,
    maxTokens: 2048,
  });

  try {
    // Strip markdown code fences if present
    const cleaned = text.replace(/```(?:json)?\s*/g, '').trim();
    const jsonMatch = cleaned.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      logger.warn({ textPreview: cleaned.slice(0, 200) }, 'AI recommendations: no JSON array found in response');
      return [];
    }
    const result = JSON.parse(jsonMatch[0]) as { title: string; description: string; impact: string; howTo: string[] }[];
    if (result.length > 0) {
      setAiCacheEntry({ cacheKey, method: 'recommendations', contentHash: hash, response: JSON.stringify(result) });
      return result;
    }
  } catch (err) {
    logger.warn({ err, textPreview: text.slice(0, 200) }, 'AI recommendations: failed to parse response');
  }

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
