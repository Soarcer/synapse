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

      // Resolve the held hook response to Claude Code
      try {
        entry.res.json({
          hookSpecificOutput: {
            hookEventName: 'PermissionRequest',
            decision: { behavior },
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
    const summaries = [...pending.entries()].map(([id, entry]) => ({
      id,
      tool_name: (entry.event.tool_name as string) ?? '',
      tool_input_preview: String(entry.event.tool_input ?? '').slice(0, 200),
      createdAt: entry.createdAt,
      expiresAt: entry.createdAt + PERMISSION_TIMEOUT_MS,
    }));
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
