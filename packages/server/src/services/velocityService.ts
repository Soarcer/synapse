// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bernhard

// ─── Velocity Service ───────────────────────────────────────────────
// Computes token velocity, cost velocity, context utilization, and efficiency scores.

import { analyticsQueryAll } from '../db.js';
import { computeCostUsd } from './costService.js';

export interface VelocityMetrics {
  tokensPerMinute: number;
  costPerMinute: number;
  contextUtilization: number; // 0-1 ratio of tokens used vs context window
  efficiencyScore: number; // 0-100 composite score
  cacheHitRate: number; // 0-1
  avgTurnLatencyMs: number;
  turnsPerSession: number;
}

export interface TurnVelocity {
  turnIndex: number;
  timestamp: number;
  tokensPerMinute: number;
  cumulativeTokens: number;
  cumulativeCost: number;
  contextSize: number;
}

// Context window sizes by model family
const CONTEXT_WINDOWS: Record<string, number> = {
  'claude-opus-4': 200_000,
  'claude-sonnet-4': 200_000,
  'claude-haiku-4': 200_000,
  'gpt-4o': 128_000,
  'gpt-4o-mini': 128_000,
  o1: 200_000,
  'o3-mini': 200_000,
  'gemini-2.5-pro': 1_000_000,
  'gemini-2.5-flash': 1_000_000,
};

function getContextWindow(model: string): number {
  const m = model.toLowerCase();
  for (const [prefix, size] of Object.entries(CONTEXT_WINDOWS)) {
    if (m.startsWith(prefix)) return size;
  }
  return 200_000; // default
}

// ─── Session Velocity ───────────────────────────────────────────────

export function computeSessionVelocity(sessionId: string): VelocityMetrics {
  const rows = analyticsQueryAll(
    `
    SELECT token_input, token_output, duration_ms, model, created_at, event_type
    FROM events
    WHERE session_id = ? AND (token_input > 0 OR event_type = 'user_prompt')
    ORDER BY created_at ASC
  `,
    [sessionId],
  ) as Array<Record<string, unknown>>;

  if (rows.length === 0) {
    return {
      tokensPerMinute: 0,
      costPerMinute: 0,
      contextUtilization: 0,
      efficiencyScore: 0,
      cacheHitRate: 0,
      avgTurnLatencyMs: 0,
      turnsPerSession: 0,
    };
  }

  let totalInput = 0;
  let totalOutput = 0;
  let totalLatency = 0;
  let latencyCount = 0;
  let promptCount = 0;
  let maxContextSize = 0;
  let model = 'claude-sonnet-4-5';

  for (const row of rows) {
    const input = Number(row.token_input ?? 0);
    const output = Number(row.token_output ?? 0);
    totalInput += input;
    totalOutput += output;
    if (input > maxContextSize) maxContextSize = input;
    if (row.model) model = row.model as string;
    if (row.duration_ms && Number(row.duration_ms) > 0) {
      totalLatency += Number(row.duration_ms);
      latencyCount++;
    }
    if (row.event_type === 'user_prompt') promptCount++;
  }

  const firstTs = Number(rows[0].created_at);
  const lastTs = Number(rows[rows.length - 1].created_at);
  const durationMinutes = Math.max(1, (lastTs - firstTs) / 60_000);

  const totalTokens = totalInput + totalOutput;
  const tokensPerMinute = Math.round(totalTokens / durationMinutes);
  const cacheRead = Math.round(totalInput * 0.5);
  const totalCost = computeCostUsd(model, totalInput, totalOutput, cacheRead);
  const costPerMinute = totalCost / durationMinutes;
  const contextWindow = getContextWindow(model);
  const contextUtilization = Math.min(1, maxContextSize / contextWindow);
  const cacheHitRate = totalInput > 0 ? cacheRead / totalInput : 0;
  const avgTurnLatencyMs = latencyCount > 0 ? Math.round(totalLatency / latencyCount) : 0;

  // Efficiency score: composite of cache hit rate, tokens per dollar, and context utilization
  const tokensPerDollar = totalCost > 0 ? totalTokens / totalCost : 0;
  const normalizedTpd = Math.min(1, tokensPerDollar / 500_000); // 500k tokens/$ is "good"
  const efficiencyScore = Math.round(
    cacheHitRate * 40 + normalizedTpd * 35 + (1 - contextUtilization) * 25,
  );

  return {
    tokensPerMinute,
    costPerMinute: Math.round(costPerMinute * 10000) / 10000,
    contextUtilization: Math.round(contextUtilization * 1000) / 1000,
    efficiencyScore: Math.min(100, Math.max(0, efficiencyScore)),
    cacheHitRate: Math.round(cacheHitRate * 1000) / 1000,
    avgTurnLatencyMs,
    turnsPerSession: promptCount,
  };
}

// ─── Per-Turn Velocity (for sparkline) ──────────────────────────────

export function computeTurnVelocity(sessionId: string): TurnVelocity[] {
  const rows = analyticsQueryAll(
    `
    SELECT token_input, token_output, created_at, event_type
    FROM events
    WHERE session_id = ? AND token_input > 0
    ORDER BY created_at ASC
  `,
    [sessionId],
  ) as Array<Record<string, unknown>>;

  if (rows.length === 0) return [];

  const velocities: TurnVelocity[] = [];
  let cumulativeTokens = 0;
  let cumulativeCost = 0;
  let prevTimestamp = Number(rows[0].created_at);

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const ts = Number(row.created_at);
    const input = Number(row.token_input ?? 0);
    const output = Number(row.token_output ?? 0);
    const tokens = input + output;
    cumulativeTokens += tokens;

    const cost = computeCostUsd('claude-sonnet-4-5', input, output, Math.round(input * 0.5));
    cumulativeCost += cost;

    const deltaMinutes = Math.max(0.01, (ts - prevTimestamp) / 60_000);
    const tokensPerMinute = Math.round(tokens / deltaMinutes);

    velocities.push({
      turnIndex: i,
      timestamp: ts,
      tokensPerMinute,
      cumulativeTokens,
      cumulativeCost: Math.round(cumulativeCost * 10000) / 10000,
      contextSize: input,
    });

    prevTimestamp = ts;
  }

  return velocities;
}

// ─── Aggregate Velocity (across all sessions in time range) ─────────

export function computeAggregateVelocity(from: number, to: number, cwd?: string): VelocityMetrics {
  const conditions: string[] = ['created_at >= ? AND created_at <= ?'];
  const params: unknown[] = [from, to];
  if (cwd) {
    conditions.push('cwd = ?');
    params.push(cwd);
  }
  const clause = conditions.join(' AND ');

  const row = analyticsQueryAll(
    `
    SELECT
      SUM(COALESCE(token_input, 0)) as totalInput,
      SUM(COALESCE(token_output, 0)) as totalOutput,
      COUNT(DISTINCT session_id) as sessionCount,
      SUM(CASE WHEN event_type = 'user_prompt' THEN 1 ELSE 0 END) as promptCount,
      AVG(CASE WHEN duration_ms > 0 THEN duration_ms END) as avgLatency,
      MAX(COALESCE(token_input, 0)) as maxContext,
      MIN(created_at) as firstTs,
      MAX(created_at) as lastTs
    FROM events WHERE ${clause}
  `,
    params,
  )[0] as Record<string, unknown> | undefined;

  if (!row || !row.totalInput) {
    return {
      tokensPerMinute: 0,
      costPerMinute: 0,
      contextUtilization: 0,
      efficiencyScore: 0,
      cacheHitRate: 0,
      avgTurnLatencyMs: 0,
      turnsPerSession: 0,
    };
  }

  const totalInput = Number(row.totalInput);
  const totalOutput = Number(row.totalOutput);
  const totalTokens = totalInput + totalOutput;
  const durationMinutes = Math.max(1, (Number(row.lastTs) - Number(row.firstTs)) / 60_000);
  const cacheRead = Math.round(totalInput * 0.5);
  const totalCost = computeCostUsd('claude-sonnet-4-5', totalInput, totalOutput, cacheRead);
  const sessionCount = Number(row.sessionCount ?? 1);
  const promptCount = Number(row.promptCount ?? 0);

  return {
    tokensPerMinute: Math.round(totalTokens / durationMinutes),
    costPerMinute: Math.round((totalCost / durationMinutes) * 10000) / 10000,
    contextUtilization: Math.min(1, Number(row.maxContext ?? 0) / 200_000),
    efficiencyScore: Math.min(100, Math.round((cacheRead / Math.max(1, totalInput)) * 60 + 40)),
    cacheHitRate: totalInput > 0 ? Math.round((cacheRead / totalInput) * 1000) / 1000 : 0,
    avgTurnLatencyMs: Math.round(Number(row.avgLatency ?? 0)),
    turnsPerSession: sessionCount > 0 ? Math.round(promptCount / sessionCount) : 0,
  };
}
