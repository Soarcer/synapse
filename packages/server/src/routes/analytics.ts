import { Router, type Request, type Response } from 'express';
import { logger } from '../lib/logger.js';
import { validateQuery, validateBody } from '../lib/validate.js';
import { AnalyticsQuerySchema, PriceCreateSchema, normalizeCwd } from '@synapse-ai/core';
import {
  analyticsQueryAll,
  analyticsQueryGet,
  analyticsExecute,
  getAllPriceHistory,
  insertPriceHistory,
  deletePriceHistory,
} from '../db.js';
import { computeCostUsd, getPrice } from '../services/costService.js';
import { computeSessionVelocity, computeTurnVelocity, computeAggregateVelocity } from '../services/velocityService.js';
import { analyzeSessionPrompts, analyzePromptsInRange, generatePromptInsights } from '../services/promptAnalyzer.js';
import { getInsightsForRange } from '../services/insightsEngine.js';
import { getBudgetStatus, setBudget, getBudget } from '../services/budgetService.js';
import { getEarnedBadges, getAllBadgeDefinitions, checkAndAwardBadges } from '../services/badgeService.js';
import { importCsv, importJson } from '../services/importService.js';

// ─── Helpers ────────────────────────────────────────────────────────

function parseTimeRange(query: Record<string, unknown>): { from: number; to: number } {
  const now = Date.now();
  const to = typeof query.to === 'number' ? query.to : now;
  const from = typeof query.from === 'number' ? query.from : to - 7 * 86_400_000; // default 7d
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

// ─── Router ─────────────────────────────────────────────────────────

export function createAnalyticsRouter(): Router {
  const router = Router();

  // GET /api/analytics/overview
  router.get('/overview', validateQuery(AnalyticsQuerySchema), (req: Request, res: Response) => {
    try {
      const { from, to } = parseTimeRange(req.query);
      const cwd = req.query.cwd as string | undefined;
      const { clause, params } = buildWhereClause(from, to, cwd);

      // Aggregate overview metrics
      const row = analyticsQueryGet(`
        SELECT
          COUNT(DISTINCT session_id) as totalSessions,
          SUM(CASE WHEN event_type IN ('tool_start','tool_end','tool_error') THEN 1 ELSE 0 END) as totalToolCalls,
          SUM(COALESCE(token_input, 0)) as totalInputTokens,
          SUM(COALESCE(token_output, 0)) as totalOutputTokens,
          AVG(CASE WHEN duration_ms > 0 THEN duration_ms END) as avgLatencyMs,
          COUNT(*) as totalEvents
        FROM events WHERE ${clause}
      `, params);

      // Compute cost from individual events with token data
      const tokenRows = analyticsQueryAll(`
        SELECT model, token_input, token_output, created_at
        FROM events WHERE ${clause} AND token_input > 0
      `, params) as { model: string | null; token_input: number; token_output: number; created_at: number }[];

      let totalCost = 0;
      let totalCacheRead = 0;
      for (const r of tokenRows) {
        const model = (r.model as string) || 'claude-sonnet-4-5';
        const cacheRead = Math.round((r.token_input as number) * 0.5); // estimate cache read as 50% of input
        totalCacheRead += cacheRead;
        totalCost += computeCostUsd(model, r.token_input as number, r.token_output as number, cacheRead, r.created_at as number);
      }

      const data = {
        totalCost,
        totalTokens: {
          input: Number(row?.totalInputTokens ?? 0),
          output: Number(row?.totalOutputTokens ?? 0),
          cacheRead: totalCacheRead,
        },
        totalSessions: Number(row?.totalSessions ?? 0),
        totalToolCalls: Number(row?.totalToolCalls ?? 0),
        avgLatencyMs: Math.round(Number(row?.avgLatencyMs ?? 0)),
        totalEvents: Number(row?.totalEvents ?? 0),
      };

      res.json(envelope(data, from, to, data.totalEvents));
    } catch (err: unknown) {
      logger.error({ err }, 'Error in analytics overview');
      res.status(500).json({ error: 'Failed to compute overview' });
    }
  });

  // GET /api/analytics/timeseries
  router.get('/timeseries', validateQuery(AnalyticsQuerySchema), (req: Request, res: Response) => {
    try {
      const { from, to } = parseTimeRange(req.query);
      const cwd = req.query.cwd as string | undefined;
      const granularity = (req.query.granularity as string) || 'day';
      const { clause, params } = buildWhereClause(from, to, cwd);

      // Build date truncation based on granularity
      let dateTrunc: string;
      if (granularity === 'hour') {
        // SQLite: truncate to hour
        dateTrunc = "strftime('%Y-%m-%dT%H:00:00', created_at / 1000, 'unixepoch')";
      } else if (granularity === 'week') {
        dateTrunc = "strftime('%Y-W%W', created_at / 1000, 'unixepoch')";
      } else {
        dateTrunc = "strftime('%Y-%m-%d', created_at / 1000, 'unixepoch')";
      }

      const rows = analyticsQueryAll(`
        SELECT
          ${dateTrunc} as bucket,
          MIN(created_at) as timestamp,
          SUM(COALESCE(token_input, 0)) as inputTokens,
          SUM(COALESCE(token_output, 0)) as outputTokens,
          COUNT(DISTINCT session_id) as sessions,
          SUM(CASE WHEN event_type IN ('tool_start','tool_end','tool_error') THEN 1 ELSE 0 END) as toolCalls,
          COUNT(*) as eventCount
        FROM events
        WHERE ${clause}
        GROUP BY bucket
        ORDER BY bucket ASC
      `, params) as Record<string, unknown>[];

      const data = rows.map((r) => {
        const inputTokens = Number(r.inputTokens ?? 0);
        const outputTokens = Number(r.outputTokens ?? 0);
        const cacheRead = Math.round(inputTokens * 0.5);
        const cost = computeCostUsd('claude-sonnet-4-5', inputTokens, outputTokens, cacheRead);
        return {
          timestamp: Number(r.timestamp ?? 0),
          bucket: r.bucket as string,
          cost,
          inputTokens,
          outputTokens,
          sessions: Number(r.sessions ?? 0),
          toolCalls: Number(r.toolCalls ?? 0),
        };
      });

      res.json(envelope(data, from, to, data.length));
    } catch (err: unknown) {
      logger.error({ err }, 'Error in analytics timeseries');
      res.status(500).json({ error: 'Failed to compute timeseries' });
    }
  });

  // GET /api/analytics/sessions
  router.get('/sessions', validateQuery(AnalyticsQuerySchema), (req: Request, res: Response) => {
    try {
      const { from, to } = parseTimeRange(req.query);
      const cwd = req.query.cwd as string | undefined;
      const limit = Math.min(Number(req.query.limit ?? 50), 500);
      const offset = Number(req.query.offset ?? 0);
      const { clause, params } = buildWhereClause(from, to, cwd);

      const rows = analyticsQueryAll(`
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
      `, [...params, limit, offset]) as Record<string, unknown>[];

      // Get total count for pagination
      const countRow = analyticsQueryGet(`
        SELECT COUNT(DISTINCT session_id) as total
        FROM events WHERE ${clause}
      `, params);

      const sessions = rows.map((r) => {
        const inputTokens = Number(r.totalInputTokens ?? 0);
        const outputTokens = Number(r.totalOutputTokens ?? 0);
        const model = (r.model as string) || 'claude-sonnet-4-5';
        const cacheRead = Math.round(inputTokens * 0.5);
        const cost = computeCostUsd(model, inputTokens, outputTokens, cacheRead);
        return {
          id: r.session_id as string,
          name: `Session ${(r.session_id as string).slice(0, 8)}`,
          startTime: Number(r.startTime ?? 0),
          endTime: Number(r.endTime ?? 0),
          model,
          vendor: (r.vendor as string) || 'anthropic',
          totalInputTokens: inputTokens,
          totalOutputTokens: outputTokens,
          totalCacheReadTokens: cacheRead,
          totalCost: cost,
          toolCalls: Number(r.toolCalls ?? 0),
          promptCount: Number(r.promptCount ?? 0),
          compactions: Number(r.compactions ?? 0),
          avgLatencyMs: Math.round(Number(r.avgLatencyMs ?? 0)),
        };
      });

      res.json(envelope(sessions, from, to, Number(countRow?.total ?? 0)));
    } catch (err: unknown) {
      logger.error({ err }, 'Error in analytics sessions');
      res.status(500).json({ error: 'Failed to query sessions' });
    }
  });

  // GET /api/analytics/tools
  router.get('/tools', validateQuery(AnalyticsQuerySchema), (req: Request, res: Response) => {
    try {
      const { from, to } = parseTimeRange(req.query);
      const cwd = req.query.cwd as string | undefined;
      const { clause, params } = buildWhereClause(from, to, cwd);

      const rows = analyticsQueryAll(`
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
      `, params) as Record<string, unknown>[];

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
  router.get('/models', validateQuery(AnalyticsQuerySchema), (req: Request, res: Response) => {
    try {
      const { from, to } = parseTimeRange(req.query);
      const cwd = req.query.cwd as string | undefined;
      const { clause, params } = buildWhereClause(from, to, cwd);

      const rows = analyticsQueryAll(`
        SELECT
          COALESCE(model, 'unknown') as model,
          COALESCE(vendor, 'unknown') as vendor,
          COUNT(DISTINCT session_id) as sessions,
          SUM(COALESCE(token_input, 0)) as totalInputTokens,
          SUM(COALESCE(token_output, 0)) as totalOutputTokens,
          COUNT(*) as eventCount
        FROM events
        WHERE ${clause}
        GROUP BY model, vendor
        ORDER BY totalInputTokens DESC
      `, params) as Record<string, unknown>[];

      const models = rows.map((r) => {
        const inputTokens = Number(r.totalInputTokens ?? 0);
        const outputTokens = Number(r.totalOutputTokens ?? 0);
        const model = r.model as string;
        const cacheRead = Math.round(inputTokens * 0.5);
        const cost = computeCostUsd(model, inputTokens, outputTokens, cacheRead);
        return {
          model,
          vendor: r.vendor as string,
          sessions: Number(r.sessions ?? 0),
          cost,
          tokens: inputTokens + outputTokens,
        };
      });

      res.json(envelope(models, from, to, models.length));
    } catch (err: unknown) {
      logger.error({ err }, 'Error in analytics models');
      res.status(500).json({ error: 'Failed to query models' });
    }
  });

  // GET /api/analytics/turns
  router.get('/turns', validateQuery(AnalyticsQuerySchema), (req: Request, res: Response) => {
    try {
      const sessionId = req.query.sessionId as string;
      if (!sessionId) {
        res.status(400).json({ error: 'sessionId is required' });
        return;
      }

      const rows = analyticsQueryAll(`
        SELECT *
        FROM events
        WHERE session_id = ?
        ORDER BY created_at ASC
      `, [sessionId]) as Record<string, unknown>[];

      // Group events into turns (delimited by user_prompt events)
      const turns: {
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
      }[] = [];

      let turnIndex = 0;
      let currentTurn: typeof turns[0] | null = null;
      let lastCompaction = false;

      for (const row of rows) {
        const eventType = row.event_type as string;

        if (eventType === 'compact') {
          lastCompaction = true;
          continue;
        }

        if (eventType === 'user_prompt') {
          if (currentTurn) turns.push(currentTurn);
          const model = (row.model as string) || 'claude-sonnet-4-5';
          // Try to extract prompt text from raw_payload
          let promptText = '';
          try {
            const raw = JSON.parse((row.raw_payload as string) || '{}');
            promptText = raw.prompt || raw.message || '';
          } catch { /* ignore */ }

          currentTurn = {
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
            model,
            compactionBefore: lastCompaction,
          };
          lastCompaction = false;
          continue;
        }

        if (!currentTurn) {
          // Events before first user_prompt — create synthetic turn
          const model = (row.model as string) || 'claude-sonnet-4-5';
          currentTurn = {
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
            model,
            compactionBefore: false,
          };
        }

        // Accumulate token data
        if (row.token_input) currentTurn.inputTokens += Number(row.token_input);
        if (row.token_output) currentTurn.outputTokens += Number(row.token_output);
        if (row.duration_ms) currentTurn.latencyMs = Math.max(currentTurn.latencyMs, Number(row.duration_ms));

        // Track tool calls
        if (eventType === 'tool_start' || eventType === 'tool_end' || eventType === 'tool_error') {
          if (row.tool_name) {
            currentTurn.toolCount++;
            const toolName = row.tool_name as string;
            if (!currentTurn.toolNames.includes(toolName)) {
              currentTurn.toolNames.push(toolName);
            }
          }
        }
      }

      // Push last turn
      if (currentTurn) turns.push(currentTurn);

      // Compute costs for each turn
      for (const turn of turns) {
        turn.cacheReadTokens = Math.round(turn.inputTokens * 0.5);
        turn.costUsd = computeCostUsd(
          turn.model, turn.inputTokens, turn.outputTokens, turn.cacheReadTokens, turn.timestamp,
        );
      }

      const firstTs = turns.length > 0 ? turns[0].timestamp : Date.now();
      const lastTs = turns.length > 0 ? turns[turns.length - 1].timestamp : Date.now();
      res.json(envelope(turns, firstTs, lastTs, turns.length));
    } catch (err: unknown) {
      logger.error({ err }, 'Error in analytics turns');
      res.status(500).json({ error: 'Failed to query turns' });
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
      insertPriceHistory({ model, vendor, effective_from: effectiveFrom, input_per_1m: inputPer1M, cached_input_per_1m: cachedInputPer1M, output_per_1m: outputPer1M, source: 'user' });
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
      res.json({ data: status });
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

  return router;
}
