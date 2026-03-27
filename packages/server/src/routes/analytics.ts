// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bernhard

import { Router, type Request, type Response } from 'express';
import { logger } from '../lib/logger.js';
import { validateQuery, validateBody } from '../lib/validate.js';
import { AnalyticsQuerySchema, PriceCreateSchema, normalizeCwd } from '@synapse-ai/core';
import {
  analyticsQueryAll,
  analyticsQueryGet,
  getAllPriceHistory,
  insertPriceHistory,
  deletePriceHistory,
} from '../db.js';
import { computeCostUsd } from '../services/costService.js';
import { getTranscriptSummaries, aggregateTranscripts } from '../services/transcriptCache.js';
import {
  computeSessionVelocity,
  computeTurnVelocity,
  computeAggregateVelocity,
} from '../services/velocityService.js';
import {
  analyzeSessionPrompts,
  analyzePromptsInRange,
  generatePromptInsights,
} from '../services/promptAnalyzer.js';
import { getInsightsForRange } from '../services/insightsEngine.js';
import { getBudgetStatus, setBudget } from '../services/budgetService.js';
import { getAllBadgeDefinitions, checkAndAwardBadges } from '../services/badgeService.js';
import { importCsv, importJson } from '../services/importService.js';
import { detectPlan, setPlan, getPlanLabels, getPlanLimits } from '../services/planDetector.js';
import {
  summarizeSession,
  analyzePrompt,
  generateRecommendations,
  isAvailable as isAiAvailable,
} from '../services/aiCoachService.js';
import { computeModelOptimization } from '../services/modelOptimizationService.js';
import type { Broadcaster } from '../services/broadcaster.js';

// ─── Helpers ────────────────────────────────────────────────────────

function parseTimeRange(query: Record<string, unknown>): { from: number; to: number } {
  const now = Date.now();
  const rawTo = Number(query.to);
  const rawFrom = Number(query.from);
  const to = Number.isFinite(rawTo) ? rawTo : now;
  const from = Number.isFinite(rawFrom) ? rawFrom : to - 7 * 86_400_000; // default 7d
  return { from, to };
}

function buildWhereClause(
  from: number,
  to: number,
  cwd?: string,
  extra?: { model?: string; vendor?: string },
): { clause: string; params: unknown[] } {
  const conditions: string[] = ['created_at >= ? AND created_at <= ?'];
  const params: unknown[] = [from, to];

  if (cwd) {
    conditions.push('cwd = ?');
    params.push(normalizeCwd(cwd));
  }
  if (extra?.model) {
    conditions.push('model = ?');
    params.push(extra.model);
  }
  if (extra?.vendor) {
    conditions.push('vendor = ?');
    params.push(extra.vendor);
  }

  return { clause: conditions.join(' AND '), params };
}

function envelope<T>(data: T, from: number, to: number, totalCount: number) {
  return { data, meta: { from, to, totalCount } };
}

function getISOWeek(d: Date): number {
  const date = new Date(d.getTime());
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + 3 - ((date.getDay() + 6) % 7));
  const week1 = new Date(date.getFullYear(), 0, 4);
  return (
    1 +
    Math.round(
      ((date.getTime() - week1.getTime()) / 86_400_000 - 3 + ((week1.getDay() + 6) % 7)) / 7,
    )
  );
}

// ─── Router ─────────────────────────────────────────────────────────

export function createAnalyticsRouter(broadcaster?: Broadcaster): Router {
  const router = Router();

  // GET /api/analytics/overview
  router.get(
    '/overview',
    validateQuery(AnalyticsQuerySchema),
    async (req: Request, res: Response) => {
      try {
        const { from, to } = parseTimeRange(req.query);
        const cwd = req.query.cwd as string | undefined;
        const { clause, params } = buildWhereClause(from, to, cwd);

        // Aggregate event-level metrics (sessions, tool calls, event count)
        const row = analyticsQueryGet(
          `
        SELECT
          COUNT(DISTINCT session_id) as totalSessions,
          SUM(CASE WHEN event_type IN ('tool_start','tool_end','tool_error') THEN 1 ELSE 0 END) as totalToolCalls,
          COUNT(*) as totalEvents
        FROM events WHERE ${clause}
      `,
          params,
        );

        // Get distinct session IDs in range for transcript enrichment (capped at 500)
        const sessionRows = analyticsQueryAll(
          `
        SELECT DISTINCT session_id FROM events WHERE ${clause} LIMIT 500
      `,
          params,
        ) as { session_id: string }[];
        const sessionIds = sessionRows.map((r) => r.session_id);

        // Enrich with transcript data (tokens, cost, latency)
        const transcripts = await getTranscriptSummaries(sessionIds, cwd);
        const agg = aggregateTranscripts(transcripts);

        // Query analytics_daily for thinking/cache-creation tokens (not in transcripts)
        const fromDate = new Date(from).toISOString().slice(0, 10);
        const toDate = new Date(to).toISOString().slice(0, 10);
        const dailyConditions: string[] = ['date >= ? AND date <= ?'];
        const dailyParams: unknown[] = [fromDate, toDate];
        if (cwd) {
          dailyConditions.push('cwd = ?');
          dailyParams.push(normalizeCwd(cwd));
        }
        const dailyRow = analyticsQueryGet(
          `SELECT SUM(total_thinking_tokens) as thinking, SUM(total_cache_creation_tokens) as creation
           FROM analytics_daily WHERE ${dailyConditions.join(' AND ')}`,
          dailyParams,
        );

        const data = {
          totalCost: agg.totalCost,
          totalTokens: {
            input: agg.totalInputTokens,
            output: agg.totalOutputTokens,
            cacheRead: agg.totalCacheReadTokens,
          },
          totalThinkingTokens: Number(dailyRow?.thinking ?? 0),
          totalCacheCreationTokens: agg.totalCacheCreationTokens,
          totalSessions: Number(row?.totalSessions ?? 0),
          totalToolCalls: Number(row?.totalToolCalls ?? 0),
          avgLatencyMs: Math.round(agg.avgLatencyMs),
          totalEvents: Number(row?.totalEvents ?? 0),
        };

        res.json(envelope(data, from, to, data.totalEvents));
      } catch (err: unknown) {
        logger.error({ err }, 'Error in analytics overview');
        res.status(500).json({ error: 'Failed to compute overview' });
      }
    },
  );

  // GET /api/analytics/timeseries
  router.get(
    '/timeseries',
    validateQuery(AnalyticsQuerySchema),
    async (req: Request, res: Response) => {
      try {
        const { from, to } = parseTimeRange(req.query);
        const cwd = req.query.cwd as string | undefined;
        const VALID_GRANULARITIES = new Set(['hour', 'day', 'week']);
        const granularity = VALID_GRANULARITIES.has(req.query.granularity as string)
          ? (req.query.granularity as string)
          : 'day';
        const { clause, params } = buildWhereClause(from, to, cwd);

        // Build date truncation based on granularity
        let dateTrunc: string;
        if (granularity === 'hour') {
          dateTrunc = "strftime('%Y-%m-%dT%H:00:00', created_at / 1000, 'unixepoch')";
        } else if (granularity === 'week') {
          dateTrunc = "strftime('%Y-W%W', created_at / 1000, 'unixepoch')";
        } else {
          dateTrunc = "strftime('%Y-%m-%d', created_at / 1000, 'unixepoch')";
        }

        // Get event-level buckets (sessions, tool calls)
        const rows = analyticsQueryAll(
          `
        SELECT
          ${dateTrunc} as bucket,
          MIN(created_at) as timestamp,
          COUNT(DISTINCT session_id) as sessions,
          SUM(CASE WHEN event_type IN ('tool_start','tool_end','tool_error') THEN 1 ELSE 0 END) as toolCalls,
          GROUP_CONCAT(DISTINCT session_id) as sessionIdList
        FROM events
        WHERE ${clause}
        GROUP BY bucket
        ORDER BY bucket ASC
      `,
          params,
        ) as Record<string, unknown>[];

        // Enrich each bucket with transcript-derived token/cost data
        // Build a map of sessionId → transcript turns bucketed by date
        const allSessionIds = new Set<string>();
        for (const r of rows) {
          const ids = ((r.sessionIdList as string) || '').split(',').filter(Boolean);
          for (const id of ids) allSessionIds.add(id);
        }

        const transcripts = await getTranscriptSummaries([...allSessionIds], cwd);

        // Build per-bucket cost/tokens and model breakdown from transcript turns
        interface BucketData {
          input: number;
          output: number;
          cacheRead: number;
          cacheCreation: number;
          cost: number;
          models: Record<string, { cost: number; tokens: number; calls: number }>;
        }
        const bucketTokens = new Map<string, BucketData>();
        for (const [, summary] of transcripts) {
          for (const turn of summary.turns) {
            if (turn.type !== 'assistant' || turn.timestamp === 0) continue;
            let bucket: string;
            const d = new Date(turn.timestamp);
            if (granularity === 'hour') {
              bucket = d.toISOString().slice(0, 13) + ':00:00';
            } else if (granularity === 'week') {
              const week = String(getISOWeek(d)).padStart(2, '0');
              bucket = `${d.getFullYear()}-W${week}`;
            } else {
              bucket = d.toISOString().slice(0, 10);
            }
            const existing = bucketTokens.get(bucket) ?? {
              input: 0,
              output: 0,
              cacheRead: 0,
              cacheCreation: 0,
              cost: 0,
              models: {},
            };
            existing.input += turn.inputTokens;
            existing.output += turn.outputTokens;
            existing.cacheRead += turn.cacheReadTokens;
            existing.cacheCreation += turn.cacheCreationTokens;
            const model = turn.model ?? 'claude-sonnet-4-5';
            const turnCost = computeCostUsd(
              model,
              turn.inputTokens,
              turn.outputTokens,
              turn.cacheReadTokens,
              turn.cacheCreationTokens,
              turn.thinkingLength,
              turn.timestamp,
            ).total;
            existing.cost += turnCost;
            // Model breakdown
            if (!existing.models[model]) existing.models[model] = { cost: 0, tokens: 0, calls: 0 };
            existing.models[model].cost += turnCost;
            existing.models[model].tokens += turn.inputTokens + turn.outputTokens;
            existing.models[model].calls++;
            bucketTokens.set(bucket, existing);
          }
        }

        // Fetch thinking tokens per bucket from analytics_daily (transcript turns lack token counts)
        let dateTruncDaily: string;
        if (granularity === 'hour') {
          dateTruncDaily = 'date'; // analytics_daily is daily; best effort
        } else if (granularity === 'week') {
          dateTruncDaily = "strftime('%Y-W%W', date)";
        } else {
          dateTruncDaily = 'date';
        }
        const dailyFromDate = new Date(from).toISOString().slice(0, 10);
        const dailyToDate = new Date(to).toISOString().slice(0, 10);
        const dailyConditions2: string[] = ['date >= ? AND date <= ?'];
        const dailyParams2: unknown[] = [dailyFromDate, dailyToDate];
        if (cwd) {
          dailyConditions2.push('cwd = ?');
          dailyParams2.push(normalizeCwd(cwd));
        }
        const dailyBucketRows = analyticsQueryAll(
          `SELECT ${dateTruncDaily} as bucket, SUM(total_thinking_tokens) as thinking
           FROM analytics_daily WHERE ${dailyConditions2.join(' AND ')}
           GROUP BY bucket`,
          dailyParams2,
        ) as { bucket: string; thinking: number }[];
        const thinkingByBucket = new Map<string, number>(
          dailyBucketRows.map((r) => [r.bucket, Number(r.thinking ?? 0)]),
        );

        const data = rows.map((r) => {
          const bucket = r.bucket as string;
          const tokens = bucketTokens.get(bucket);
          return {
            timestamp: Number(r.timestamp ?? 0),
            bucket,
            cost: tokens?.cost ?? 0,
            inputTokens: tokens?.input ?? 0,
            outputTokens: tokens?.output ?? 0,
            cacheRead: tokens?.cacheRead ?? 0,
            cacheCreationTokens: tokens?.cacheCreation ?? 0,
            thinkingTokens: thinkingByBucket.get(bucket) ?? 0,
            sessions: Number(r.sessions ?? 0),
            toolCalls: Number(r.toolCalls ?? 0),
            models: tokens?.models ?? {},
          };
        });

        res.json(envelope(data, from, to, data.length));
      } catch (err: unknown) {
        logger.error({ err }, 'Error in analytics timeseries');
        res.status(500).json({ error: 'Failed to compute timeseries' });
      }
    },
  );

  // GET /api/analytics/sessions
  router.get(
    '/sessions',
    validateQuery(AnalyticsQuerySchema),
    async (req: Request, res: Response) => {
      try {
        const { from, to } = parseTimeRange(req.query);
        const cwd = req.query.cwd as string | undefined;
        const limit = Math.min(Number(req.query.limit ?? 50), 500);
        const offset = Number(req.query.offset ?? 0);
        const { clause, params } = buildWhereClause(from, to, cwd);

        const rows = analyticsQueryAll(
          `
        SELECT
          session_id,
          MIN(created_at) as startTime,
          MAX(created_at) as endTime,
          COUNT(*) as eventCount,
          SUM(COALESCE(token_input, 0)) as totalInputTokens,
          SUM(COALESCE(token_output, 0)) as totalOutputTokens,
          SUM(CASE WHEN event_type IN ('tool_start','tool_end','tool_error') THEN 1 ELSE 0 END) as toolCalls,
          SUM(CASE WHEN event_type = 'user_prompt' THEN 1 ELSE 0 END) as promptCount,
          SUM(CASE WHEN event_type = 'compact' THEN 1 ELSE 0 END) as compactions,
          AVG(CASE WHEN duration_ms > 0 THEN duration_ms END) as avgLatencyMs,
          MAX(model) as model,
          MAX(vendor) as vendor
        FROM events
        WHERE ${clause}
        GROUP BY session_id
        ORDER BY startTime DESC
        LIMIT ? OFFSET ?
      `,
          [...params, limit, offset],
        ) as Record<string, unknown>[];

        // Get total count for pagination
        const countRow = analyticsQueryGet(
          `
        SELECT COUNT(DISTINCT session_id) as total
        FROM events WHERE ${clause}
      `,
          params,
        );

        // Enrich with transcript data
        const sessionIds = rows.map((r) => r.session_id as string);
        const transcripts = await getTranscriptSummaries(sessionIds, cwd);

        const sessions = rows.map((r) => {
          const sid = r.session_id as string;
          const ts = transcripts.get(sid);
          const model = ts?.modelUsage[0]?.model ?? ((r.model as string) || 'claude-sonnet-4-5');
          const vendor = (r.vendor as string) || 'anthropic';
          return {
            id: sid,
            name: `Session ${sid.slice(0, 8)}`,
            startTime: Number(r.startTime ?? 0),
            endTime: Number(r.endTime ?? 0),
            model,
            vendor,
            totalInputTokens: ts?.totalInputTokens ?? 0,
            totalOutputTokens: ts?.totalOutputTokens ?? 0,
            totalCacheReadTokens: ts?.totalCacheReadTokens ?? 0,
            totalCost: ts?.estimatedCostUsd ?? 0,
            toolCalls: Number(r.toolCalls ?? 0),
            promptCount: Number(r.promptCount ?? 0),
            compactions: Number(r.compactions ?? 0),
            avgLatencyMs: ts ? Math.round(ts.avgResponseLatencyMs) : 0,
          };
        });

        res.json(envelope(sessions, from, to, Number(countRow?.total ?? 0)));
      } catch (err: unknown) {
        logger.error({ err }, 'Error in analytics sessions');
        res.status(500).json({ error: 'Failed to query sessions' });
      }
    },
  );

  // GET /api/analytics/tools
  router.get('/tools', validateQuery(AnalyticsQuerySchema), (req: Request, res: Response) => {
    try {
      const { from, to } = parseTimeRange(req.query);
      const cwd = req.query.cwd as string | undefined;
      const { clause, params } = buildWhereClause(from, to, cwd);

      const rows = analyticsQueryAll(
        `
        SELECT
          tool_name as name,
          COUNT(*) as count,
          AVG(COALESCE(duration_ms, 0)) as avgDuration,
          SUM(CASE WHEN event_type = 'tool_error' OR status = 'error' THEN 1 ELSE 0 END) as errors,
          SUM(CASE WHEN event_type IN ('tool_start','tool_end','tool_error') THEN 1 ELSE 0 END) as totalToolEvents
        FROM events
        WHERE ${clause} AND tool_name IS NOT NULL
        GROUP BY tool_name
        ORDER BY count DESC
      `,
        params,
      ) as Record<string, unknown>[];

      const tools = rows.map((r) => ({
        name: r.name as string,
        count: Number(r.count ?? 0),
        avgDuration: Math.round(Number(r.avgDuration ?? 0)),
        errorRate: Number(r.count) > 0 ? Number(r.errors ?? 0) / Number(r.count) : 0,
      }));

      res.json(envelope(tools, from, to, tools.length));
    } catch (err: unknown) {
      logger.error({ err }, 'Error in analytics tools');
      res.status(500).json({ error: 'Failed to query tools' });
    }
  });

  // GET /api/analytics/models
  router.get(
    '/models',
    validateQuery(AnalyticsQuerySchema),
    async (req: Request, res: Response) => {
      try {
        const { from, to } = parseTimeRange(req.query);
        const cwd = req.query.cwd as string | undefined;
        const { clause, params } = buildWhereClause(from, to, cwd);

        // Get session IDs in range for transcript enrichment (capped at 500)
        const sessionRows = analyticsQueryAll(
          `
        SELECT DISTINCT session_id FROM events WHERE ${clause} LIMIT 500
      `,
          params,
        ) as { session_id: string }[];
        const sessionIds = sessionRows.map((r) => r.session_id);
        const transcripts = await getTranscriptSummaries(sessionIds, cwd);

        // Aggregate model usage from transcripts
        const modelMap = new Map<
          string,
          { model: string; vendor: string; sessions: Set<string>; cost: number; tokens: number }
        >();

        for (const [sid, summary] of transcripts) {
          for (const mu of summary.modelUsage) {
            const key = mu.model;
            const tokens = mu.inputTokens + mu.outputTokens + mu.cacheReadTokens;
            const existing = modelMap.get(key);
            const vendor = key.startsWith('claude')
              ? 'anthropic'
              : key.startsWith('gpt') || key.startsWith('o1') || key.startsWith('o3')
                ? 'openai'
                : key.startsWith('gemini')
                  ? 'google'
                  : 'unknown';
            if (existing) {
              existing.sessions.add(sid);
              existing.tokens += tokens;
            } else {
              modelMap.set(key, { model: key, vendor, sessions: new Set([sid]), cost: 0, tokens });
            }
          }
        }

        // Distribute cost from transcript summaries
        for (const [, summary] of transcripts) {
          // Attribute cost to models proportionally
          const sessionTokens =
            summary.totalInputTokens + summary.totalOutputTokens + summary.totalCacheReadTokens;
          if (sessionTokens === 0) continue;
          for (const mu of summary.modelUsage) {
            const modelTokens = mu.inputTokens + mu.outputTokens + mu.cacheReadTokens;
            const entry = modelMap.get(mu.model);
            if (entry) entry.cost += summary.estimatedCostUsd * (modelTokens / sessionTokens);
          }
        }

        // Add sessions that have no transcript (as 'unknown' model)
        const sessionsWithTranscript = new Set(transcripts.keys());
        const unknownCount = sessionIds.filter((id) => !sessionsWithTranscript.has(id)).length;
        if (unknownCount > 0 && !modelMap.has('unknown')) {
          modelMap.set('unknown', {
            model: 'unknown',
            vendor: 'unknown',
            sessions: new Set(),
            cost: 0,
            tokens: 0,
          });
        }
        if (unknownCount > 0) {
          const entry = modelMap.get('unknown');
          if (entry) {
            for (const id of sessionIds) {
              if (!sessionsWithTranscript.has(id)) entry.sessions.add(id);
            }
          }
        }

        const models = [...modelMap.values()]
          .map((m) => ({
            model: m.model,
            vendor: m.vendor,
            sessions: m.sessions.size,
            cost: m.cost,
            tokens: m.tokens,
          }))
          .sort((a, b) => b.tokens - a.tokens);

        res.json(envelope(models, from, to, models.length));
      } catch (err: unknown) {
        logger.error({ err }, 'Error in analytics models');
        res.status(500).json({ error: 'Failed to query models' });
      }
    },
  );

  // GET /api/analytics/turns
  // With sessionId: returns turns for that session
  // Without sessionId: returns turns across all sessions in time range (bulk mode)
  router.get('/turns', validateQuery(AnalyticsQuerySchema), async (req: Request, res: Response) => {
    try {
      const sessionId = req.query.sessionId as string | undefined;
      const cwd = req.query.cwd as string | undefined;

      // Determine which sessions to fetch turns for
      let targetSessionIds: string[];
      let rangeFrom: number;
      let rangeTo: number;

      if (sessionId) {
        targetSessionIds = [sessionId];
        rangeFrom = 0;
        rangeTo = Date.now();
      } else {
        const { from, to } = parseTimeRange(req.query);
        rangeFrom = from;
        rangeTo = to;
        const { clause, params } = buildWhereClause(from, to, cwd);
        const sessLimit = Math.min(Number(req.query.limit ?? 50), 100);

        const sessionRows = analyticsQueryAll(
          `
          SELECT session_id FROM events
          WHERE ${clause} AND session_id IS NOT NULL
          GROUP BY session_id
          ORDER BY MAX(created_at) DESC
          LIMIT ?
        `,
          [...params, sessLimit],
        ) as { session_id: string }[];

        if (sessionRows.length === 0) {
          res.json(envelope([], rangeFrom, rangeTo, 0));
          return;
        }
        targetSessionIds = sessionRows.map((r) => r.session_id);
      }

      // Try to get turns from transcript files (rich token data)
      const transcripts = await getTranscriptSummaries(targetSessionIds, cwd);

      interface TurnData {
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

      const allTurns: TurnData[] = [];

      // For sessions with transcripts, aggregate all assistant records
      // belonging to the same prompt group into a single turn.
      // A new prompt group starts when we see a user record with actual
      // prompt text (not a tool_result which has no text blocks).
      for (const [sid, summary] of transcripts) {
        let turnIndex = 0;
        let promptTimestamp = 0;
        let promptText = '';
        let currentGroup: TurnData | null = null;
        const toolNameSet = new Set<string>();

        const flushGroup = () => {
          if (currentGroup) {
            currentGroup.toolNames = [...toolNameSet];
            allTurns.push(currentGroup);
            toolNameSet.clear();
          }
        };

        for (const turn of summary.turns) {
          if (turn.type === 'user') {
            // Real user prompt (has text) vs tool_result (no text)
            if (turn.promptText) {
              flushGroup();
              promptTimestamp = turn.timestamp;
              promptText = turn.promptText;
              currentGroup = null;
            }
            continue;
          }
          if (turn.type !== 'assistant') continue;

          const model = turn.model ?? 'claude-sonnet-4-5';
          const costUsd = computeCostUsd(
            model,
            turn.inputTokens,
            turn.outputTokens,
            turn.cacheReadTokens,
            turn.cacheCreationTokens,
            turn.thinkingLength,
            turn.timestamp,
          ).total;

          if (!currentGroup) {
            // First assistant record in this prompt group
            const latencyMs = promptTimestamp > 0 ? turn.timestamp - promptTimestamp : 0;
            currentGroup = {
              sessionId: sid,
              turnIndex: turnIndex++,
              timestamp: turn.timestamp,
              promptText,
              inputTokens: turn.inputTokens,
              outputTokens: turn.outputTokens,
              cacheReadTokens: turn.cacheReadTokens,
              cacheCreationTokens: turn.cacheCreationTokens,
              thinkingTokens: turn.thinkingLength,
              toolCount: turn.toolUseCount,
              toolNames: [], // filled on flush
              latencyMs: latencyMs > 0 && latencyMs < 600_000 ? latencyMs : 0,
              costUsd,
              model,
              compactionBefore: false,
            };
            for (const name of turn.toolNames) toolNameSet.add(name);
          } else {
            // Subsequent assistant record — aggregate into existing group
            currentGroup.inputTokens += turn.inputTokens;
            currentGroup.outputTokens += turn.outputTokens;
            currentGroup.cacheReadTokens += turn.cacheReadTokens;
            currentGroup.cacheCreationTokens += turn.cacheCreationTokens;
            currentGroup.thinkingTokens += turn.thinkingLength;
            currentGroup.toolCount += turn.toolUseCount;
            currentGroup.costUsd += costUsd;
            for (const name of turn.toolNames) toolNameSet.add(name);
          }
        }
        flushGroup();
      }

      // For sessions without transcripts, fall back to event-based turn construction
      const sessionsWithTranscript = new Set(transcripts.keys());
      const sessionsWithout = targetSessionIds.filter((id) => !sessionsWithTranscript.has(id));

      if (sessionsWithout.length > 0) {
        const placeholders = sessionsWithout.map(() => '?').join(',');
        const rows = analyticsQueryAll(
          `
          SELECT *, session_id FROM events
          WHERE session_id IN (${placeholders})
          ORDER BY session_id, created_at ASC
        `,
          sessionsWithout,
        ) as Record<string, unknown>[];

        // Group by session and build turns from events
        const rowsBySession = new Map<string, Record<string, unknown>[]>();
        for (const row of rows) {
          const sid = (row.session_id as string) || 'unknown';
          let bucket = rowsBySession.get(sid);
          if (!bucket) {
            bucket = [];
            rowsBySession.set(sid, bucket);
          }
          bucket.push(row);
        }

        for (const [sid, sessionEvts] of rowsBySession) {
          let turnIndex = 0;
          let currentTurn: TurnData | null = null;

          for (const row of sessionEvts) {
            const eventType = row.event_type as string;
            if (eventType === 'user_prompt') {
              if (currentTurn) allTurns.push(currentTurn);
              let promptText = '';
              try {
                const raw = JSON.parse((row.raw_payload as string) || '{}');
                promptText = raw.prompt || raw.message || raw.text || '';
              } catch {
                /* ignore */
              }
              currentTurn = {
                sessionId: sid,
                turnIndex: turnIndex++,
                timestamp: Number(row.created_at ?? 0),
                promptText,
                inputTokens: 0,
                outputTokens: 0,
                cacheReadTokens: 0,
                cacheCreationTokens: 0,
                thinkingTokens: 0,
                toolCount: 0,
                toolNames: [],
                latencyMs: 0,
                costUsd: 0,
                model: (row.model as string) || 'claude-sonnet-4-5',
                compactionBefore: false,
              };
              continue;
            }
            if (!currentTurn) {
              currentTurn = {
                sessionId: sid,
                turnIndex: turnIndex++,
                timestamp: Number(row.created_at ?? 0),
                promptText: '(session start)',
                inputTokens: 0,
                outputTokens: 0,
                cacheReadTokens: 0,
                cacheCreationTokens: 0,
                thinkingTokens: 0,
                toolCount: 0,
                toolNames: [],
                latencyMs: 0,
                costUsd: 0,
                model: (row.model as string) || 'claude-sonnet-4-5',
                compactionBefore: false,
              };
            }
            if (
              eventType === 'tool_start' ||
              eventType === 'tool_end' ||
              eventType === 'tool_error'
            ) {
              if (row.tool_name) {
                currentTurn.toolCount++;
                const tn = row.tool_name as string;
                if (!currentTurn.toolNames.includes(tn)) currentTurn.toolNames.push(tn);
              }
            }
          }
          if (currentTurn) allTurns.push(currentTurn);
        }
      }

      // Sort all turns by timestamp
      allTurns.sort((a, b) => a.timestamp - b.timestamp);

      const firstTs = allTurns.length > 0 ? allTurns[0].timestamp : rangeFrom;
      const lastTs = allTurns.length > 0 ? allTurns[allTurns.length - 1].timestamp : rangeTo;
      res.json(envelope(allTurns, firstTs, lastTs, allTurns.length));
    } catch (err: unknown) {
      logger.error({ err }, 'Error in analytics turns');
      res.status(500).json({ error: 'Failed to query turns' });
    }
  });

  // ─── Tool Call Details ──────────────────────────────────────────

  // GET /api/analytics/tool-calls
  // Returns individual tool call events paired (start→end) for error hotspot / detail analysis
  router.get('/tool-calls', validateQuery(AnalyticsQuerySchema), (req: Request, res: Response) => {
    try {
      const { from, to } = parseTimeRange(req.query);
      const cwd = req.query.cwd as string | undefined;
      const { clause, params } = buildWhereClause(from, to, cwd);
      const limit = Math.min(Number(req.query.limit ?? 2000), 5000);

      const rows = analyticsQueryAll(
        `
        SELECT session_id, tool_name, created_at, duration_ms, event_type, status, tool_use_id
        FROM events
        WHERE ${clause}
          AND event_type IN ('tool_start', 'tool_end', 'tool_error')
          AND tool_name IS NOT NULL
        ORDER BY created_at DESC
        LIMIT ?
      `,
        [...params, limit],
      ) as Record<string, unknown>[];

      // Pair tool_start with tool_end by tool_use_id, or emit unpaired entries
      const endMap = new Map<string, Record<string, unknown>>();
      const toolCalls: {
        sessionId: string;
        toolName: string;
        timestamp: number;
        durationMs: number;
        status: 'success' | 'error';
        inputTokens: number;
      }[] = [];

      // First pass: index end/error events by tool_use_id
      for (const row of rows) {
        const eventType = row.event_type as string;
        const toolUseId = row.tool_use_id as string | null;
        if (toolUseId && (eventType === 'tool_end' || eventType === 'tool_error')) {
          endMap.set(toolUseId, row);
        }
      }

      // Second pass: build tool calls from start events
      const seen = new Set<string>();
      for (const row of rows) {
        const eventType = row.event_type as string;
        const toolUseId = row.tool_use_id as string | null;

        if (eventType === 'tool_start' && toolUseId) {
          seen.add(toolUseId);
          const endRow = endMap.get(toolUseId);
          const isError = endRow
            ? endRow.event_type === 'tool_error' || endRow.status === 'error'
            : false;
          const duration = endRow ? Number(endRow.duration_ms ?? 0) : 0;

          toolCalls.push({
            sessionId: (row.session_id as string) || '',
            toolName: row.tool_name as string,
            timestamp: Number(row.created_at ?? 0),
            durationMs: duration,
            status: isError ? 'error' : 'success',
            inputTokens: 0,
          });
        }
      }

      // Include unpaired end/error events (tool_start might be outside time window)
      for (const row of rows) {
        const toolUseId = row.tool_use_id as string | null;
        if (toolUseId && !seen.has(toolUseId) && row.event_type !== 'tool_start') {
          seen.add(toolUseId);
          toolCalls.push({
            sessionId: (row.session_id as string) || '',
            toolName: row.tool_name as string,
            timestamp: Number(row.created_at ?? 0),
            durationMs: Number(row.duration_ms ?? 0),
            status: row.event_type === 'tool_error' || row.status === 'error' ? 'error' : 'success',
            inputTokens: 0,
          });
        }
      }

      res.json(envelope(toolCalls, from, to, toolCalls.length));
    } catch (err: unknown) {
      logger.error({ err }, 'Error in tool-calls');
      res.status(500).json({ error: 'Failed to query tool calls' });
    }
  });

  // ─── Price History CRUD ──────────────────────────────────────────

  // GET /api/analytics/prices
  router.get('/prices', (_req: Request, res: Response) => {
    try {
      const prices = getAllPriceHistory();
      res.json({ data: prices });
    } catch (err: unknown) {
      logger.error({ err }, 'Error fetching prices');
      res.status(500).json({ error: 'Failed to fetch prices' });
    }
  });

  // POST /api/analytics/prices
  router.post('/prices', validateBody(PriceCreateSchema), (req: Request, res: Response) => {
    try {
      const { model, vendor, effectiveFrom, inputPer1M, cachedInputPer1M, outputPer1M } = req.body;
      insertPriceHistory({
        model,
        vendor,
        effective_from: effectiveFrom,
        input_per_1m: inputPer1M,
        cached_input_per_1m: cachedInputPer1M,
        output_per_1m: outputPer1M,
        source: 'user',
      });
      logger.info({ model, vendor }, 'Price added');
      res.status(201).json({ ok: true });
    } catch (err: unknown) {
      logger.error({ err }, 'Error adding price');
      res.status(500).json({ error: 'Failed to add price' });
    }
  });

  // DELETE /api/analytics/prices/:id
  router.delete('/prices/:id', (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id as string, 10);
      if (isNaN(id)) {
        res.status(400).json({ error: 'Invalid price ID' });
        return;
      }
      const deleted = deletePriceHistory(id);
      res.json({ ok: true, deleted });
    } catch (err: unknown) {
      logger.error({ err }, 'Error deleting price');
      res.status(500).json({ error: 'Failed to delete price' });
    }
  });

  // ─── Velocity Endpoints ────────────────────────────────────────────

  // GET /api/analytics/velocity
  router.get('/velocity', validateQuery(AnalyticsQuerySchema), (req: Request, res: Response) => {
    try {
      const sessionId = req.query.sessionId as string | undefined;
      if (sessionId) {
        const velocity = computeSessionVelocity(sessionId);
        const turnVelocity = computeTurnVelocity(sessionId);
        res.json({ data: { ...velocity, turns: turnVelocity } });
      } else {
        const { from, to } = parseTimeRange(req.query);
        const cwd = req.query.cwd as string | undefined;
        const velocity = computeAggregateVelocity(from, to, cwd);
        res.json(envelope(velocity, from, to, 1));
      }
    } catch (err: unknown) {
      logger.error({ err }, 'Error in analytics velocity');
      res.status(500).json({ error: 'Failed to compute velocity' });
    }
  });

  // ─── Prompt Analysis Endpoints ────────────────────────────────────

  // GET /api/analytics/prompts
  router.get('/prompts', validateQuery(AnalyticsQuerySchema), (req: Request, res: Response) => {
    try {
      const sessionId = req.query.sessionId as string | undefined;
      if (sessionId) {
        const analyses = analyzeSessionPrompts(sessionId);
        const insights = generatePromptInsights(analyses);
        res.json({ data: { analyses, insights } });
      } else {
        const { from, to } = parseTimeRange(req.query);
        const cwd = req.query.cwd as string | undefined;
        const result = analyzePromptsInRange(from, to, cwd);
        res.json(envelope(result, from, to, result.analyses.length));
      }
    } catch (err: unknown) {
      logger.error({ err }, 'Error in analytics prompts');
      res.status(500).json({ error: 'Failed to analyze prompts' });
    }
  });

  // ─── Insights Endpoints ───────────────────────────────────────────

  // GET /api/analytics/insights
  router.get('/insights', validateQuery(AnalyticsQuerySchema), (req: Request, res: Response) => {
    try {
      const { from, to } = parseTimeRange(req.query);
      const cwd = req.query.cwd as string | undefined;
      const insights = getInsightsForRange(from, to, cwd);
      res.json(envelope(insights, from, to, insights.length));
    } catch (err: unknown) {
      logger.error({ err }, 'Error in analytics insights');
      res.status(500).json({ error: 'Failed to generate insights' });
    }
  });

  // ─── Budget Endpoints ─────────────────────────────────────────────

  // GET /api/analytics/budget
  router.get('/budget', (req: Request, res: Response) => {
    try {
      const cwd = req.query.cwd as string | undefined;
      const status = getBudgetStatus(cwd);
      const plan = detectPlan();
      res.json({ data: { ...status, plan } });
    } catch (err: unknown) {
      logger.error({ err }, 'Error in budget status');
      res.status(500).json({ error: 'Failed to get budget status' });
    }
  });

  // PUT /api/analytics/budget
  router.put('/budget', (req: Request, res: Response) => {
    try {
      const config = setBudget(req.body);
      res.json({ data: config });
    } catch (err: unknown) {
      logger.error({ err }, 'Error updating budget');
      res.status(500).json({ error: 'Failed to update budget' });
    }
  });

  // PUT /api/analytics/budget/plan — manual plan override
  router.put('/budget/plan', (req: Request, res: Response) => {
    try {
      const { plan: planName } = req.body as { plan: string };
      if (!planName || typeof planName !== 'string') {
        res.status(400).json({ error: 'Missing plan name' });
        return;
      }
      const result = setPlan(planName);
      res.json({ data: result });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      logger.error({ err }, 'Error setting plan');
      res.status(400).json({ error: message });
    }
  });

  // GET /api/analytics/budget/plans — available plan options
  router.get('/budget/plans', (_req: Request, res: Response) => {
    try {
      res.json({ data: { labels: getPlanLabels(), limits: getPlanLimits() } });
    } catch (err: unknown) {
      logger.error({ err }, 'Error fetching plan options');
      res.status(500).json({ error: 'Failed to fetch plan options' });
    }
  });

  // ─── Badge Endpoints ──────────────────────────────────────────────

  // GET /api/analytics/badges
  router.get('/badges', (_req: Request, res: Response) => {
    try {
      // Check and award new badges, then return all
      checkAndAwardBadges();
      const badges = getAllBadgeDefinitions();
      res.json({ data: badges });
    } catch (err: unknown) {
      logger.error({ err }, 'Error in badges');
      res.status(500).json({ error: 'Failed to get badges' });
    }
  });

  // ─── Import Endpoint ──────────────────────────────────────────────

  // POST /api/analytics/import
  router.post('/import', (req: Request, res: Response) => {
    try {
      const { format, data: importData, cwd } = req.body;

      if (!importData) {
        res.status(400).json({ error: 'Missing "data" field' });
        return;
      }

      let result;
      if (format === 'csv') {
        if (typeof importData !== 'string') {
          res.status(400).json({ error: 'CSV data must be a string' });
          return;
        }
        result = importCsv(importData, cwd);
      } else {
        result = importJson(importData, format, cwd);
      }

      res.json({ data: result });
    } catch (err: unknown) {
      logger.error({ err }, 'Error in import');
      res.status(500).json({ error: 'Failed to import data' });
    }
  });

  // GET /api/analytics/projects — distinct CWD values for project filtering
  router.get('/projects', (_req: Request, res: Response) => {
    try {
      const rows = analyticsQueryAll(
        `SELECT DISTINCT cwd FROM events WHERE cwd IS NOT NULL AND cwd != '' ORDER BY cwd`,
        [],
      ) as { cwd: string }[];
      res.json({ data: rows.map((r) => r.cwd) });
    } catch (err: unknown) {
      logger.error({ err }, 'Error fetching projects');
      res.status(500).json({ error: 'Failed to fetch projects' });
    }
  });

  // ─── Model Optimization ────────────────────────────────────────

  // GET /api/analytics/model-optimization — what-if model switching
  router.get(
    '/model-optimization',
    validateQuery(AnalyticsQuerySchema),
    (req: Request, res: Response) => {
      try {
        const { from, to } = parseTimeRange(req.query);
        const cwd = req.query.cwd as string | undefined;
        const result = computeModelOptimization(from, to, cwd);
        res.json({ data: result });
      } catch (err: unknown) {
        logger.error({ err }, 'Error computing model optimization');
        res.status(500).json({ error: 'Failed to compute model optimization' });
      }
    },
  );

  // ─── AI-Enhanced Endpoints ──────────────────────────────────────

  // GET /api/analytics/ai-summary — AI summary of time period
  router.get(
    '/ai-summary',
    validateQuery(AnalyticsQuerySchema),
    async (req: Request, res: Response) => {
      try {
        if (!isAiAvailable()) {
          res.json({ data: null, meta: { reason: 'AI features require an API key' } });
          return;
        }

        const { from, to } = parseTimeRange(req.query);
        const cwd = req.query.cwd as string | undefined;
        const { clause, params } = buildWhereClause(from, to, cwd);

        const sessionRows = analyticsQueryAll(
          `SELECT DISTINCT session_id FROM events WHERE ${clause} LIMIT 500`,
          params,
        ) as { session_id: string }[];
        const sessionIds = sessionRows.map((r) => r.session_id);

        if (sessionIds.length === 0) {
          res.json({ data: null, meta: { reason: 'No sessions in range' } });
          return;
        }

        const transcripts = await getTranscriptSummaries(sessionIds, cwd);
        const agg = aggregateTranscripts(transcripts);

        // Get event-level metrics for tool calls and top tools
        const eventStats = analyticsQueryGet(
          `
        SELECT
          SUM(CASE WHEN event_type IN ('tool_start','tool_end','tool_error') THEN 1 ELSE 0 END) as toolCalls,
          SUM(CASE WHEN event_type = 'prompt_submit' THEN 1 ELSE 0 END) as promptCount
        FROM events WHERE ${clause}
      `,
          params,
        ) as { toolCalls: number; promptCount: number } | undefined;

        // Find top model from modelBreakdown map
        let topModel = 'unknown';
        let topModelCost = 0;
        for (const [model, data] of agg.modelBreakdown) {
          if (data.cost > topModelCost) {
            topModel = model;
            topModelCost = data.cost;
          }
        }

        // Top tools
        const toolRows = analyticsQueryAll(
          `
        SELECT json_extract(data, '$.tool_name') as toolName, COUNT(*) as cnt
        FROM events WHERE ${clause} AND event_type = 'tool_start'
        GROUP BY toolName ORDER BY cnt DESC LIMIT 5
      `,
          params,
        ) as { toolName: string; cnt: number }[];

        const summary = await summarizeSession({
          sessionId: `aggregate-${from}-${to}`,
          totalCost: agg.totalCost,
          totalTokens: agg.totalInputTokens + agg.totalOutputTokens,
          promptCount: eventStats?.promptCount ?? 0,
          toolCalls: eventStats?.toolCalls ?? 0,
          model: topModel,
          topTools: toolRows.map((r) => r.toolName).filter(Boolean),
          durationMinutes: Math.round((to - from) / 60_000),
        });
        res.json({ data: summary });
      } catch (err: unknown) {
        logger.error({ err }, 'Error generating AI summary');
        res.status(500).json({ error: 'Failed to generate AI summary' });
      }
    },
  );

  // POST /api/analytics/ai-analyze-prompt — AI prompt analysis
  router.post('/ai-analyze-prompt', async (req: Request, res: Response) => {
    try {
      if (!isAiAvailable()) {
        res.json({ data: null, meta: { reason: 'AI features require an API key' } });
        return;
      }

      const {
        promptText,
        sessionContext,
        mode,
        skipCache,
        conversationContext,
        model: modelOverride,
      } = req.body as {
        promptText: string;
        mode?: 'developer' | 'vibe';
        skipCache?: boolean;
        model?: string;
        sessionContext?: { model?: string; toolCount?: number; category?: string; cost?: number };
        conversationContext?: {
          recentPrompts?: string[];
          sessionGoal?: string;
          turnNumber?: number;
          isConversationalMode?: boolean;
        };
      };

      if (!promptText || typeof promptText !== 'string') {
        res.status(400).json({ error: 'Missing promptText' });
        return;
      }

      const analysis = await analyzePrompt({
        promptText: promptText.slice(0, 4000), // Cap at 4K chars
        mode: mode === 'vibe' ? 'vibe' : 'developer',
        skipCache: !!skipCache,
        modelOverride: typeof modelOverride === 'string' ? modelOverride : undefined,
        sessionContext: {
          model: sessionContext?.model ?? 'unknown',
          toolCount: sessionContext?.toolCount ?? 0,
          category: sessionContext?.category ?? 'general',
          cost: sessionContext?.cost ?? 0,
        },
        conversationContext: conversationContext
          ? {
              recentPrompts: Array.isArray(conversationContext.recentPrompts)
                ? conversationContext.recentPrompts.slice(0, 3).map((p) => String(p).slice(0, 500))
                : [],
              sessionGoal: String(conversationContext.sessionGoal ?? '').slice(0, 150),
              turnNumber: Number(conversationContext.turnNumber) || 1,
              isConversationalMode: Boolean(conversationContext.isConversationalMode),
            }
          : undefined,
      });
      res.json({ data: analysis });
    } catch (err: unknown) {
      logger.error({ err }, 'Error analyzing prompt');
      res.status(500).json({ error: 'Failed to analyze prompt' });
    }
  });

  // POST /api/analytics/ai-insights — AI-generated recommendations
  router.post('/ai-insights', async (req: Request, res: Response) => {
    try {
      if (!isAiAvailable()) {
        res.json({ data: [], meta: { reason: 'AI features require an API key' } });
        return;
      }

      const body = req.body as Record<string, unknown>;
      const recommendations = await generateRecommendations({
        totalCost: Number(body.totalCost) || 0,
        cacheHitRate: Number(body.cacheHitRate) || 0,
        topTools: Array.isArray(body.topTools)
          ? (body.topTools as { name: string; count: number; errorRate: number }[])
          : [],
        modelUsage: Array.isArray(body.modelUsage)
          ? (body.modelUsage as { model: string; cost: number; sessions: number }[])
          : [],
        avgPromptLength: Number(body.avgPromptLength) || 0,
        compactionRate: Number(body.compactionRate) || 0,
      });
      res.json({ data: recommendations });
    } catch (err: unknown) {
      logger.error({ err }, 'Error generating AI insights');
      res.status(500).json({ error: 'Failed to generate AI insights' });
    }
  });

  // ── Workshop: Send to Claude terminal via WS relay ─────────────────
  router.post('/workshop/send-to-terminal', (req: Request, res: Response) => {
    const { text } = req.body as { text?: string };
    if (!text || typeof text !== 'string') {
      res.status(400).json({ error: 'text is required' });
      return;
    }
    if (!broadcaster) {
      res.status(503).json({ sent: false, reason: 'broadcaster_unavailable' });
      return;
    }
    const clientCount = broadcaster.clientCount;
    if (clientCount === 0) {
      res.json({ sent: false, clientCount: 0, reason: 'no_clients' });
      return;
    }
    broadcaster.broadcastTerminalSend(text);
    res.json({ sent: true, clientCount });
  });

  return router;
}
