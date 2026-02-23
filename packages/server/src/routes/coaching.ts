// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Synapse Contributors

import { Router, type Request, type Response } from 'express';
import { logger } from '../lib/logger.js';
import { validateQuery, validateBody } from '../lib/validate.js';
import {
  CoachingQuerySchema,
  CoachingMultiQuerySchema,
  PlaybookCreateSchema,
  NudgeDismissSchema,
  AnalyticsQuerySchema,
} from '@synapse-ai/core';
import {
  getNudgesBySession,
  dismissNudge as dbDismissNudge,
  getNudgeStats,
  getAllRuleConfigs,
  upsertRuleConfig,
  resetAllRuleConfigs,
} from '../db.js';
import {
  computeReportCard,
  computeMultiReportCard,
  getReportCardHistory,
} from '../services/reportCardEngine.js';
import { getSensitivity, setSensitivity, type Sensitivity } from '../services/aiNudgeEscalator.js';
import { getRegisteredRules } from '../services/nudgeEngine.js';
import { analyzeCrossSessions } from '../services/crossSessionAnalyzer.js';
import {
  getAllPlaybooks,
  getPlaybookById,
  createPlaybook,
  removePlaybook,
  generatePlaybookFromSession,
} from '../services/playbookService.js';

// ─── Helpers ─────────────────────────────────────────────────────────

function parseTimeRange(query: Record<string, unknown>): { from: number; to: number } {
  const now = Date.now();
  const rawTo = Number(query.to);
  const rawFrom = Number(query.from);
  const to = Number.isFinite(rawTo) ? rawTo : now;
  const from = Number.isFinite(rawFrom) ? rawFrom : to - 7 * 86_400_000;
  return { from, to };
}

function envelope<T>(data: T, meta?: Record<string, unknown>) {
  return { data, meta: meta ?? {} };
}

// ─── Router ──────────────────────────────────────────────────────────

export function createCoachingRouter(): Router {
  const router = Router();

  // GET /report-card?sessionId=X — compute/return report card for a session
  router.get('/report-card', validateQuery(CoachingQuerySchema), (req: Request, res: Response) => {
    try {
      const sessionId = req.query.sessionId as string;
      const reportCard = computeReportCard(sessionId);
      res.json(envelope(reportCard));
    } catch (err: unknown) {
      logger.error({ err }, 'Error computing report card');
      res.status(500).json({ error: 'Failed to compute report card' });
    }
  });

  // GET /report-card/multi?sessionIds=id1,id2,id3 — merged report card
  router.get(
    '/report-card/multi',
    validateQuery(CoachingMultiQuerySchema),
    (req: Request, res: Response) => {
      try {
        const raw = req.query.sessionIds as string;
        const sessionIds = raw
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
        if (sessionIds.length === 0) {
          res.status(400).json({ error: 'No session IDs provided' });
          return;
        }
        if (sessionIds.length > 20) {
          res.status(400).json({ error: 'Maximum 20 session IDs allowed' });
          return;
        }
        const reportCard = computeMultiReportCard(sessionIds);
        res.json(envelope(reportCard));
      } catch (err: unknown) {
        logger.error({ err }, 'Error computing multi-session report card');
        res.status(500).json({ error: 'Failed to compute report card' });
      }
    },
  );

  // GET /report-cards?from=X&to=Y — cached report cards for time range
  router.get(
    '/report-cards',
    validateQuery(AnalyticsQuerySchema),
    (req: Request, res: Response) => {
      try {
        const { from, to } = parseTimeRange(req.query);
        const reportCards = getReportCardHistory(from, to);
        res.json(envelope(reportCards, { from, to, totalCount: reportCards.length }));
      } catch (err: unknown) {
        logger.error({ err }, 'Error fetching report card history');
        res.status(500).json({ error: 'Failed to fetch report cards' });
      }
    },
  );

  // GET /nudges?sessionId=X — historical nudges for a session
  router.get('/nudges', validateQuery(CoachingQuerySchema), (req: Request, res: Response) => {
    try {
      const sessionId = req.query.sessionId as string;
      const rows = getNudgesBySession(sessionId);
      const nudges = rows.map((row) => ({
        id: row.nudge_id,
        sessionId: row.session_id,
        detectorId: row.detector_id,
        severity: row.severity,
        title: row.title,
        message: row.message,
        recommendation: row.recommendation ?? '',
        firedAt: row.fired_at,
        dismissed: row.dismissed === 1,
      }));
      res.json(envelope(nudges));
    } catch (err: unknown) {
      logger.error({ err }, 'Error fetching nudges');
      res.status(500).json({ error: 'Failed to fetch nudges' });
    }
  });

  // POST /nudges/dismiss — dismiss a nudge
  router.post(
    '/nudges/dismiss',
    validateBody(NudgeDismissSchema),
    (req: Request, res: Response) => {
      try {
        const { sessionId, nudgeId } = req.body;
        const updated = dbDismissNudge(sessionId, nudgeId);
        res.json({ ok: true, updated });
      } catch (err: unknown) {
        logger.error({ err }, 'Error dismissing nudge');
        res.status(500).json({ error: 'Failed to dismiss nudge' });
      }
    },
  );

  // GET /nudges/stats — aggregate nudge statistics
  router.get('/nudges/stats', (_req: Request, res: Response) => {
    try {
      const stats = getNudgeStats();
      res.json(envelope(stats));
    } catch (err: unknown) {
      logger.error({ err }, 'Error fetching nudge stats');
      res.status(500).json({ error: 'Failed to fetch nudge stats' });
    }
  });

  // GET /playbooks — list all playbooks
  router.get('/playbooks', (_req: Request, res: Response) => {
    try {
      const playbooks = getAllPlaybooks();
      res.json(envelope(playbooks));
    } catch (err: unknown) {
      logger.error({ err }, 'Error fetching playbooks');
      res.status(500).json({ error: 'Failed to fetch playbooks' });
    }
  });

  // GET /playbooks/:id — get specific playbook
  router.get('/playbooks/:id', (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id as string, 10);
      if (isNaN(id)) {
        res.status(400).json({ error: 'Invalid playbook ID' });
        return;
      }
      const playbook = getPlaybookById(id);
      if (!playbook) {
        res.status(404).json({ error: 'Playbook not found' });
        return;
      }
      res.json(envelope(playbook));
    } catch (err: unknown) {
      logger.error({ err }, 'Error fetching playbook');
      res.status(500).json({ error: 'Failed to fetch playbook' });
    }
  });

  // POST /playbooks — create a playbook manually
  router.post('/playbooks', validateBody(PlaybookCreateSchema), (req: Request, res: Response) => {
    try {
      const { name, description, category, sourceSessionId, tags } = req.body;
      const playbook = createPlaybook({ name, description, category, sourceSessionId, tags });
      res.status(201).json(envelope(playbook));
    } catch (err: unknown) {
      logger.error({ err }, 'Error creating playbook');
      res.status(500).json({ error: 'Failed to create playbook' });
    }
  });

  // POST /playbooks/from-session?sessionId=X — auto-generate from session
  router.post(
    '/playbooks/from-session',
    validateQuery(CoachingQuerySchema),
    (req: Request, res: Response) => {
      try {
        const sessionId = req.query.sessionId as string;
        generatePlaybookFromSession(sessionId);
        const playbook = createPlaybook({
          name: `Session ${sessionId.slice(0, 8)} Playbook`,
          description: `Auto-generated from session ${sessionId}`,
          category: 'custom',
          sourceSessionId: sessionId,
        });
        res.status(201).json(envelope(playbook));
      } catch (err: unknown) {
        logger.error({ err }, 'Error generating playbook from session');
        res.status(500).json({ error: 'Failed to generate playbook' });
      }
    },
  );

  // DELETE /playbooks/:id — delete a playbook
  router.delete('/playbooks/:id', (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id as string, 10);
      if (isNaN(id)) {
        res.status(400).json({ error: 'Invalid playbook ID' });
        return;
      }
      const deleted = removePlaybook(id);
      res.json({ ok: true, deleted });
    } catch (err: unknown) {
      logger.error({ err }, 'Error deleting playbook');
      res.status(500).json({ error: 'Failed to delete playbook' });
    }
  });

  // ─── Rule Configuration ─────────────────────────────────────────

  // GET /rules — list all rules with metadata + config overrides
  router.get('/rules', (_req: Request, res: Response) => {
    try {
      const rules = getRegisteredRules();
      const configs = getAllRuleConfigs();
      const configMap = new Map(configs.map((c) => [c.rule_id, c]));

      const result = rules.map((rule) => {
        const config = configMap.get(rule.meta.id);
        return {
          ...rule.meta,
          subscribes: rule.subscribes(),
          // Config overrides (null = use default)
          enabled: config ? config.enabled === 1 : true,
          severityOverride: config?.severity ?? null,
          cooldownOverride: config?.cooldown_ms ?? null,
          suppressed: config ? config.suppressed === 1 : false,
          options: config?.options ? JSON.parse(config.options) : null,
        };
      });

      res.json(envelope(result, { totalRules: result.length }));
    } catch (err: unknown) {
      logger.error({ err }, 'Error fetching rules');
      res.status(500).json({ error: 'Failed to fetch rules' });
    }
  });

  // PUT /rules/:id — update rule configuration
  router.put('/rules/:id', (req: Request, res: Response) => {
    try {
      const ruleId = req.params.id as string;

      // Verify rule exists
      const rules = getRegisteredRules();
      const rule = rules.find((r) => r.meta.id === ruleId);
      if (!rule) {
        res.status(404).json({ error: `Rule "${ruleId}" not found` });
        return;
      }

      const { enabled, severity, cooldownMs, options } = req.body as {
        enabled?: boolean;
        severity?: string;
        cooldownMs?: number;
        options?: Record<string, unknown>;
      };

      // Validate severity if provided
      if (severity !== undefined && !['info', 'suggestion', 'warning', null].includes(severity)) {
        res
          .status(400)
          .json({ error: 'Invalid severity. Must be: info, suggestion, warning, or null' });
        return;
      }

      upsertRuleConfig({
        rule_id: ruleId,
        enabled: enabled !== undefined ? (enabled ? 1 : 0) : undefined,
        severity: severity !== undefined ? severity : undefined,
        cooldown_ms: cooldownMs !== undefined ? cooldownMs : undefined,
        options: options !== undefined ? JSON.stringify(options) : undefined,
      });

      res.json({ ok: true, ruleId });
    } catch (err: unknown) {
      logger.error({ err }, 'Error updating rule config');
      res.status(500).json({ error: 'Failed to update rule config' });
    }
  });

  // POST /rules/reset — reset all rule configs to defaults
  router.post('/rules/reset', (_req: Request, res: Response) => {
    try {
      resetAllRuleConfigs();
      res.json({ ok: true });
    } catch (err: unknown) {
      logger.error({ err }, 'Error resetting rule configs');
      res.status(500).json({ error: 'Failed to reset rule configs' });
    }
  });

  // ─── Cross-Session Analysis ────────────────────────────────────────

  // GET /cross-session — analyze patterns across recent sessions
  router.get('/cross-session', (req: Request, res: Response) => {
    try {
      const limit = parseInt(String(req.query.limit ?? '10'), 10);
      const insights = analyzeCrossSessions(Math.min(limit, 50));
      res.json(envelope(insights, { totalInsights: insights.length }));
    } catch (err: unknown) {
      logger.error({ err }, 'Error analyzing cross-session patterns');
      res.status(500).json({ error: 'Failed to analyze cross-session patterns' });
    }
  });

  // ─── Sensitivity Config ──────────────────────────────────────────

  // GET /api/analytics/coaching/sensitivity
  router.get('/sensitivity', (_req: Request, res: Response) => {
    try {
      res.json({ data: { level: getSensitivity() } });
    } catch (err: unknown) {
      logger.error({ err }, 'Error fetching sensitivity');
      res.status(500).json({ error: 'Failed to fetch sensitivity' });
    }
  });

  // PUT /api/analytics/coaching/sensitivity
  router.put('/sensitivity', (req: Request, res: Response) => {
    try {
      const { level } = req.body as { level: string };
      if (!['off', 'low', 'medium', 'high'].includes(level)) {
        res.status(400).json({ error: 'Invalid level. Must be: off, low, medium, high' });
        return;
      }
      setSensitivity(level as Sensitivity);
      res.json({ data: { level } });
    } catch (err: unknown) {
      logger.error({ err }, 'Error updating sensitivity');
      res.status(500).json({ error: 'Failed to update sensitivity' });
    }
  });

  return router;
}
