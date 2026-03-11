// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bernhard

import { logger } from '../lib/logger.js';
import { findTranscriptPath, readTranscript } from './transcriptReader.js';
import { analyticsQueryAll } from '../db.js';
import type { TranscriptSummary } from '@synapse-ai/core';

// ─── In-Memory Cache ────────────────────────────────────────────────

interface CacheEntry {
  summary: TranscriptSummary;
  expiry: number;
}

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const MAX_CACHE_SIZE = 10_000;
const cache = new Map<string, CacheEntry>();

/** Get a single session transcript summary (cached). Returns null if transcript not found. */
export async function getTranscriptSummary(
  sessionId: string,
  cwd?: string,
): Promise<TranscriptSummary | null> {
  const cached = cache.get(sessionId);
  if (cached && Date.now() < cached.expiry) return cached.summary;

  // Try to find transcript path from DB first (session_start events store it)
  let transcriptPath: string | null = null;
  const rows = analyticsQueryAll(
    `SELECT raw_payload FROM events WHERE session_id = ? AND event_type = 'session_start' LIMIT 1`,
    [sessionId],
  );
  if (rows.length > 0) {
    try {
      const raw = JSON.parse(rows[0].raw_payload as string);
      if (raw.transcript_path) transcriptPath = raw.transcript_path;
    } catch {
      /* ignore */
    }
  }

  // Fallback: scan project dirs
  if (!transcriptPath) {
    transcriptPath = await findTranscriptPath(sessionId, cwd ?? process.cwd());
  }

  if (!transcriptPath) return null;

  try {
    const summary = await readTranscript(transcriptPath, sessionId);
    // Evict oldest entry if cache is full
    if (cache.size >= MAX_CACHE_SIZE) {
      const oldestKey = cache.keys().next().value;
      if (oldestKey !== undefined) cache.delete(oldestKey);
    }
    cache.set(sessionId, { summary, expiry: Date.now() + CACHE_TTL_MS });
    return summary;
  } catch (err) {
    logger.warn({ err, sessionId }, 'Failed to read transcript');
    return null;
  }
}

/** Batch-read transcript summaries for multiple sessions. */
export async function getTranscriptSummaries(
  sessionIds: string[],
  cwd?: string,
): Promise<Map<string, TranscriptSummary>> {
  const result = new Map<string, TranscriptSummary>();
  await Promise.all(
    sessionIds.map(async (id) => {
      const summary = await getTranscriptSummary(id, cwd);
      if (summary) result.set(id, summary);
    }),
  );
  return result;
}

// ─── Aggregate helpers ──────────────────────────────────────────────

export interface TranscriptOverview {
  totalCost: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheReadTokens: number;
  totalCacheCreationTokens: number;
  avgCacheHitRate: number;
  avgLatencyMs: number;
  modelBreakdown: Map<string, { sessions: number; cost: number; tokens: number; vendor: string }>;
}

/** Aggregate overview metrics from transcript summaries. */
export function aggregateTranscripts(
  summaries: Map<string, TranscriptSummary>,
): TranscriptOverview {
  let totalCost = 0;
  let totalInput = 0;
  let totalOutput = 0;
  let totalCacheRead = 0;
  let totalCacheCreation = 0;
  let cacheHitSum = 0;
  let latencySum = 0;
  let latencyCount = 0;
  const modelBreakdown = new Map<
    string,
    { sessions: number; cost: number; tokens: number; vendor: string }
  >();

  for (const summary of summaries.values()) {
    totalCost += summary.estimatedCostUsd;
    totalInput += summary.totalInputTokens;
    totalOutput += summary.totalOutputTokens;
    totalCacheRead += summary.totalCacheReadTokens;
    totalCacheCreation += summary.totalCacheCreationTokens;
    cacheHitSum += summary.avgCacheHitRate;
    if (summary.avgResponseLatencyMs > 0) {
      latencySum += summary.avgResponseLatencyMs;
      latencyCount++;
    }

    for (const mu of summary.modelUsage) {
      const existing = modelBreakdown.get(mu.model);
      const tokens = mu.inputTokens + mu.outputTokens + mu.cacheReadTokens;
      // Estimate cost per model from token counts
      if (existing) {
        existing.sessions++;
        existing.tokens += tokens;
      } else {
        modelBreakdown.set(mu.model, {
          sessions: 1,
          cost: 0, // will be computed below
          tokens,
          vendor: mu.model.startsWith('claude')
            ? 'anthropic'
            : mu.model.startsWith('gpt') || mu.model.startsWith('o1') || mu.model.startsWith('o3')
              ? 'openai'
              : mu.model.startsWith('gemini')
                ? 'google'
                : 'unknown',
        });
      }
    }
  }

  // Distribute total cost proportionally by tokens
  const totalAllTokens = [...modelBreakdown.values()].reduce((s, m) => s + m.tokens, 0);
  if (totalAllTokens > 0) {
    for (const entry of modelBreakdown.values()) {
      entry.cost = totalCost * (entry.tokens / totalAllTokens);
    }
  }

  return {
    totalCost,
    totalInputTokens: totalInput,
    totalOutputTokens: totalOutput,
    totalCacheReadTokens: totalCacheRead,
    totalCacheCreationTokens: totalCacheCreation,
    avgCacheHitRate: summaries.size > 0 ? cacheHitSum / summaries.size : 0,
    avgLatencyMs: latencyCount > 0 ? latencySum / latencyCount : 0,
    modelBreakdown,
  };
}

/** Clear the transcript cache (for tests). */
export function clearTranscriptCache(): void {
  cache.clear();
}
