// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Synapse Contributors

// Mock data generators for analytics prototypes
// Produces realistic AI coding assistant usage data

export interface MockSession {
  id: string;
  name: string;
  startTime: number;
  endTime: number;
  model: string;
  vendor: string;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheReadTokens: number;
  totalCost: number;
  toolCalls: number;
  promptCount: number;
  compactions: number;
  avgLatencyMs: number;
}

export interface MockTurn {
  sessionId: string;
  turnIndex: number;
  timestamp: number;
  promptText: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  thinkingTokens: number;
  toolCount: number;
  toolNames: string[];
  latencyMs: number;
  costUsd: number;
  model: string;
  compactionBefore: boolean;
}

export interface MockToolCall {
  sessionId: string;
  toolName: string;
  timestamp: number;
  durationMs: number;
  status: 'success' | 'error';
  inputTokens: number;
}

export interface MockDailyRollup {
  date: string;
  sessions: number;
  totalCost: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheRead: number;
  totalToolCalls: number;
  avgLatencyMs: number;
  models: Record<string, { cost: number; tokens: number; calls: number }>;
}

export interface MockData {
  sessions: MockSession[];
  turns: MockTurn[];
  toolCalls: MockToolCall[];
  dailyRollups: MockDailyRollup[];
  timeRange: { start: number; end: number };
}

// ── Pricing ──────────────────────────────────────────────────

const MODEL_INFO: Record<
  string,
  { inputPer1M: number; outputPer1M: number; cachedPer1M: number; vendor: string }
> = {
  'claude-opus-4-6': { inputPer1M: 15, outputPer1M: 75, cachedPer1M: 1.5, vendor: 'anthropic' },
  'claude-sonnet-4-5': { inputPer1M: 3, outputPer1M: 15, cachedPer1M: 0.3, vendor: 'anthropic' },
  'claude-haiku-4-5': { inputPer1M: 0.8, outputPer1M: 4, cachedPer1M: 0.08, vendor: 'anthropic' },
};

// Tool probability weights (Read is most common)
const TOOL_WEIGHTS: Record<string, number> = {
  Read: 30,
  Grep: 18,
  Glob: 12,
  Edit: 15,
  Write: 8,
  Bash: 10,
  Task: 4,
  WebFetch: 2,
  WebSearch: 1,
  TodoWrite: 3,
  NotebookEdit: 1,
};

const PROMPT_TEMPLATES = [
  'Fix the failing test in auth module',
  'Add dark mode toggle to settings page',
  'Refactor the database connection pooling',
  'Review the PR changes for security issues',
  'Implement pagination for the events API',
  'Debug the WebSocket reconnection logic',
  'Add TypeScript types for the new schema',
  'Optimize the React Flow rendering performance',
  'Write unit tests for the event normalizer',
  'Update the deployment documentation',
  'Create a new API endpoint for analytics',
  'Fix the CSS overflow issue in the sidebar',
  'Implement rate limiting middleware',
  'Add error boundaries to all panels',
  'Migrate from CommonJS to ESM',
  'Set up the CI/CD pipeline with GitHub Actions',
  'Add input validation with Zod schemas',
  'Fix memory leak in the event listener',
  'Implement graceful shutdown for the server',
  'Add WebSocket heartbeat mechanism',
];

const SESSION_NAMES = [
  'Feature: Auth System',
  'Bugfix: WS Reconnect',
  'Refactor: DB Layer',
  'Feature: Analytics Dashboard',
  'Chore: CI/CD Pipeline',
  'Feature: Export System',
  'Bugfix: Memory Leak',
  'Feature: Rate Limiting',
];

// ── Helpers ──────────────────────────────────────────────────

function seededRandom(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 16807 + 0) % 2147483647;
    return s / 2147483647;
  };
}

function pickWeighted(rand: () => number, weights: Record<string, number>): string {
  const entries = Object.entries(weights);
  const total = entries.reduce((sum, [, w]) => sum + w, 0);
  let r = rand() * total;
  for (const [name, weight] of entries) {
    r -= weight;
    if (r <= 0) return name;
  }
  return entries[entries.length - 1][0];
}

function logNormal(rand: () => number, median: number, sigma: number): number {
  // Box-Muller transform
  const u1 = rand();
  const u2 = rand();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return Math.exp(Math.log(median) + sigma * z);
}

function computeCost(model: string, input: number, output: number, cacheRead: number): number {
  const info = MODEL_INFO[model] ?? MODEL_INFO['claude-sonnet-4-5'];
  const freshInput = input - cacheRead;
  return (
    (freshInput / 1_000_000) * info.inputPer1M +
    (cacheRead / 1_000_000) * info.cachedPer1M +
    (output / 1_000_000) * info.outputPer1M
  );
}

// ── Generator ────────────────────────────────────────────────

export function generateMockData(seed = 42): MockData {
  const rand = seededRandom(seed);
  const now = Date.now();
  const DAY = 86_400_000;
  const HOUR = 3_600_000;

  // Generate 7 days of data, ending today
  const startDate = now - 6 * DAY;
  const sessions: MockSession[] = [];
  const turns: MockTurn[] = [];
  const toolCalls: MockToolCall[] = [];
  const dailyMap = new Map<string, MockDailyRollup>();

  // 2-4 sessions per day across 7 days
  for (let day = 0; day < 7; day++) {
    const dayStart = startDate + day * DAY + 8 * HOUR; // Start at 8 AM
    const dateKey = new Date(dayStart).toISOString().split('T')[0];
    const sessionCount = 2 + Math.floor(rand() * 3); // 2-4

    const dayRollup: MockDailyRollup = {
      date: dateKey,
      sessions: sessionCount,
      totalCost: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalCacheRead: 0,
      totalToolCalls: 0,
      avgLatencyMs: 0,
      models: {},
    };

    let latencySum = 0;
    let latencyCount = 0;

    for (let s = 0; s < sessionCount; s++) {
      const sessionStart = dayStart + s * (2 * HOUR + rand() * HOUR);
      const sessionDuration = 30 * 60_000 + rand() * 120 * 60_000; // 30min - 2.5hr
      const sessionEnd = sessionStart + sessionDuration;

      // Model selection: 40% Sonnet, 35% Opus, 25% Haiku
      const modelRoll = rand();
      const model =
        modelRoll < 0.4
          ? 'claude-sonnet-4-5'
          : modelRoll < 0.75
            ? 'claude-opus-4-6'
            : 'claude-haiku-4-5';
      const vendor = MODEL_INFO[model].vendor;

      const sessionId = `session-${dateKey}-${s}`;
      const promptCount = 5 + Math.floor(rand() * 15); // 5-19 prompts

      let totalInput = 0;
      let totalOutput = 0;
      let totalCacheRead = 0;
      let totalCost = 0;
      let totalToolCallCount = 0;
      let sessionLatencySum = 0;
      let compactionCount = 0;

      for (let p = 0; p < promptCount; p++) {
        const turnTime = sessionStart + (p / promptCount) * sessionDuration;
        const promptText = PROMPT_TEMPLATES[Math.floor(rand() * PROMPT_TEMPLATES.length)];

        // Token usage with realistic distribution
        // Input grows as context accumulates, cache hits improve over time
        const contextGrowth = 1 + (p / promptCount) * 3; // Context grows 1x-4x
        const baseInput = logNormal(rand, 2000, 0.5) * contextGrowth;
        const cacheRate = Math.min(0.9, 0.1 + (p / promptCount) * 0.7 + rand() * 0.1);

        // Compaction: happens when context gets large (turn > 60% through session)
        const compactionBefore = p > 0 && p / promptCount > 0.6 && rand() < 0.15;
        if (compactionBefore) compactionCount++;

        const inputTokens = Math.round(compactionBefore ? baseInput * 0.3 : baseInput);
        const cacheReadTokens = Math.round(inputTokens * cacheRate);
        const cacheCreationTokens = Math.round((inputTokens - cacheReadTokens) * 0.3);
        const outputTokens = Math.round(logNormal(rand, 800, 0.6));
        const thinkingTokens = model.includes('opus') ? Math.round(outputTokens * 0.4) : 0;

        // Tool calls for this turn
        const turnToolCount = Math.floor(rand() * 6); // 0-5 tools per turn
        const turnToolNames: string[] = [];
        for (let t = 0; t < turnToolCount; t++) {
          const toolName = pickWeighted(rand, TOOL_WEIGHTS);
          turnToolNames.push(toolName);

          const toolDuration = logNormal(rand, 200, 0.8);
          const toolStatus: 'success' | 'error' = rand() < 0.05 ? 'error' : 'success';

          toolCalls.push({
            sessionId,
            toolName,
            timestamp: turnTime + t * 500 + rand() * 2000,
            durationMs: Math.round(toolDuration),
            status: toolStatus,
            inputTokens: Math.round(logNormal(rand, 100, 0.5)),
          });
          totalToolCallCount++;
        }

        const latencyMs = logNormal(rand, 1500, 0.4);
        const turnCost = computeCost(model, inputTokens, outputTokens, cacheReadTokens);

        totalInput += inputTokens;
        totalOutput += outputTokens;
        totalCacheRead += cacheReadTokens;
        totalCost += turnCost;
        sessionLatencySum += latencyMs;

        turns.push({
          sessionId,
          turnIndex: p,
          timestamp: turnTime,
          promptText,
          inputTokens,
          outputTokens,
          cacheReadTokens,
          cacheCreationTokens,
          thinkingTokens,
          toolCount: turnToolCount,
          toolNames: turnToolNames,
          latencyMs: Math.round(latencyMs),
          costUsd: turnCost,
          model,
          compactionBefore,
        });

        // Update day rollup
        dayRollup.totalInputTokens += inputTokens;
        dayRollup.totalOutputTokens += outputTokens;
        dayRollup.totalCacheRead += cacheReadTokens;
        dayRollup.totalCost += turnCost;
        dayRollup.totalToolCalls += turnToolCount;
        latencySum += latencyMs;
        latencyCount++;

        if (!dayRollup.models[model]) {
          dayRollup.models[model] = { cost: 0, tokens: 0, calls: 0 };
        }
        dayRollup.models[model].cost += turnCost;
        dayRollup.models[model].tokens += inputTokens + outputTokens;
        dayRollup.models[model].calls++;
      }

      sessions.push({
        id: sessionId,
        name: SESSION_NAMES[Math.floor(rand() * SESSION_NAMES.length)],
        startTime: sessionStart,
        endTime: sessionEnd,
        model,
        vendor,
        totalInputTokens: totalInput,
        totalOutputTokens: totalOutput,
        totalCacheReadTokens: totalCacheRead,
        totalCost,
        toolCalls: totalToolCallCount,
        promptCount,
        compactions: compactionCount,
        avgLatencyMs: Math.round(sessionLatencySum / promptCount),
      });
    }

    dayRollup.avgLatencyMs = latencyCount > 0 ? Math.round(latencySum / latencyCount) : 0;
    dailyMap.set(dateKey, dayRollup);
  }

  const dailyRollups = [...dailyMap.values()].sort((a, b) => a.date.localeCompare(b.date));

  return {
    sessions: sessions.sort((a, b) => a.startTime - b.startTime),
    turns: turns.sort((a, b) => a.timestamp - b.timestamp),
    toolCalls: toolCalls.sort((a, b) => a.timestamp - b.timestamp),
    dailyRollups,
    timeRange: { start: startDate, end: now },
  };
}

// ── Derived metric helpers ───────────────────────────────────

export function totalCost(data: MockData): number {
  return data.sessions.reduce((sum, s) => sum + s.totalCost, 0);
}

export function totalTokens(data: MockData): { input: number; output: number; cacheRead: number } {
  return data.sessions.reduce(
    (acc, s) => ({
      input: acc.input + s.totalInputTokens,
      output: acc.output + s.totalOutputTokens,
      cacheRead: acc.cacheRead + s.totalCacheReadTokens,
    }),
    { input: 0, output: 0, cacheRead: 0 },
  );
}

export function totalToolCalls(data: MockData): number {
  return data.toolCalls.length;
}

export function toolBreakdown(
  data: MockData,
): { name: string; count: number; avgDuration: number; errorRate: number }[] {
  const map = new Map<string, { count: number; totalDuration: number; errors: number }>();
  for (const tc of data.toolCalls) {
    const entry = map.get(tc.toolName) ?? { count: 0, totalDuration: 0, errors: 0 };
    entry.count++;
    entry.totalDuration += tc.durationMs;
    if (tc.status === 'error') entry.errors++;
    map.set(tc.toolName, entry);
  }
  return [...map.entries()]
    .map(([name, stats]) => ({
      name,
      count: stats.count,
      avgDuration: Math.round(stats.totalDuration / stats.count),
      errorRate: stats.errors / stats.count,
    }))
    .sort((a, b) => b.count - a.count);
}

export function modelBreakdown(
  data: MockData,
): { model: string; sessions: number; cost: number; tokens: number }[] {
  const map = new Map<string, { sessions: number; cost: number; tokens: number }>();
  for (const s of data.sessions) {
    const entry = map.get(s.model) ?? { sessions: 0, cost: 0, tokens: 0 };
    entry.sessions++;
    entry.cost += s.totalCost;
    entry.tokens += s.totalInputTokens + s.totalOutputTokens;
    map.set(s.model, entry);
  }
  return [...map.entries()]
    .map(([model, stats]) => ({ model, ...stats }))
    .sort((a, b) => b.cost - a.cost);
}

export function latencyPercentiles(data: MockData): { p50: number; p90: number; p99: number } {
  const latencies = data.turns.map((t) => t.latencyMs).sort((a, b) => a - b);
  if (latencies.length === 0) return { p50: 0, p90: 0, p99: 0 };
  const p = (pct: number) => latencies[Math.floor(latencies.length * pct)] ?? 0;
  return { p50: p(0.5), p90: p(0.9), p99: p(0.99) };
}

export function avgCacheHitRate(data: MockData): number {
  const total = data.turns.reduce((sum, t) => sum + t.inputTokens, 0);
  const cached = data.turns.reduce((sum, t) => sum + t.cacheReadTokens, 0);
  return total > 0 ? cached / total : 0;
}
