// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bernhard

import { Router, type Request, type Response } from 'express';
import { logger } from '../lib/logger.js';
import { analyticsExecute } from '../db.js';
import type { Broadcaster } from '../services/broadcaster.js';
import {
  pending,
  decisions,
  PERMISSION_TIMEOUT_MS,
  purgeExpiredDecisions,
} from '../state/permissionState.js';

export function createPermissionsRouter(broadcaster: Broadcaster): Router {
  const router = Router();

  // PUT /api/permissions/:id/decision — resolve a pending permission
  router.put('/:id/decision', (req: Request, res: Response) => {
    try {
      const id = String(req.params.id);
      const behavior = req.body?.behavior;

      if (behavior !== 'allow' && behavior !== 'deny') {
        res.status(400).json({ error: 'behavior must be "allow" or "deny"' });
        return;
      }

      purgeExpiredDecisions();

      const entry = pending.get(id);
      if (!entry) {
        res.status(404).json({ error: 'already resolved or not found' });
        return;
      }

      const latencyMs = Date.now() - entry.createdAt;

      clearTimeout(entry.timer);
      pending.delete(id);
      decisions.set(id, { behavior, expiresAt: Date.now() + 30_000 });

      // Store analytics event
      try {
        analyticsExecute(
          `INSERT INTO permission_events (id, session_id, tool_name, tool_input, behavior, latency_ms, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [
            id,
            entry.event.session_id,
            (entry.event.tool_name as string) ?? '',
            String(entry.event.tool_input ?? '').slice(0, 500),
            behavior,
            latencyMs,
            Date.now(),
          ],
        );
      } catch (dbErr) {
        logger.error({ err: dbErr }, 'Failed to store permission event');
      }

      // Broadcast resolution to all dashboard clients
      broadcaster.broadcastRaw({
        type: 'permissionResolved',
        data: { id, behavior },
      });

      // Resolve the held hook response to Claude Code.
      // For AskUserQuestion with answers: use behavior "deny" with message containing
      // the user's selections. Per Claude Code docs, PermissionRequest "message" is only
      // forwarded to Claude on "deny" — on "allow" it's ignored. So we "deny" the tool
      // but include the full answer in the message, which Claude sees and uses.
      const answers = req.body?.answers as Record<string, string> | undefined;
      const hasAnswers = answers && Object.keys(answers).length > 0;

      const hookDecision: Record<string, unknown> = { behavior };
      if (hasAnswers) {
        const answerLines = Object.entries(answers)
          .map(([q, a]) => `Q: ${q}\nA: ${a}`)
          .join('\n\n');
        // Override behavior to "deny" so Claude sees the message
        hookDecision.behavior = 'deny';
        hookDecision.message =
          `The user answered this question remotely via the Synapse dashboard. ` +
          `Do NOT re-ask this question. Use these answers and continue:\n\n${answerLines}`;
        logger.info({ id, answers }, 'Permission resolved with remote answers (deny+message)');
      }
      try {
        entry.res.json({
          hookSpecificOutput: {
            hookEventName: 'PermissionRequest',
            decision: hookDecision,
          },
        });
      } catch {
        logger.warn({ id }, 'Hook response already closed');
      }

      res.json({ ok: true, latencyMs });
    } catch (err) {
      logger.error({ err }, 'Error resolving permission');
      res.status(500).json({ error: 'Internal error' });
    }
  });

  // GET /api/permissions/pending — hydration endpoint (summary shape)
  router.get('/pending', (_req: Request, res: Response) => {
    const summaries = [...pending.entries()].map(([id, entry]) => {
      const rawInput = entry.event.tool_input ?? '';
      const toolInput = typeof rawInput === 'string' ? rawInput : JSON.stringify(rawInput);
      return {
        id,
        tool_name: (entry.event.tool_name as string) ?? '',
        tool_input_preview: toolInput.slice(0, 200),
        tool_input_raw: rawInput,
        createdAt: entry.createdAt,
        expiresAt: entry.createdAt + PERMISSION_TIMEOUT_MS,
      };
    });
    res.json(summaries);
  });

  // GET /api/permissions/:id — full detail for a single pending entry
  router.get('/:id', (req: Request, res: Response) => {
    const id = String(req.params.id);
    const entry = pending.get(id);
    if (!entry) {
      res.status(404).json({ error: 'not found' });
      return;
    }
    res.json({
      id,
      event: entry.event,
      createdAt: entry.createdAt,
      expiresAt: entry.createdAt + PERMISSION_TIMEOUT_MS,
    });
  });

  return router;
}
