// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bernhard

import { Router, type Request, type Response } from 'express';
import { logger } from '../lib/logger.js';
import { getStoredEvents } from '../services/eventStore.js';
import { deleteEventsBySession, deleteAllEvents, listSessions, listProjectCwds } from '../db.js';
import type { Broadcaster } from '../services/broadcaster.js';
import { AgentEventSchema, EventQuerySchema, normalizeCwd } from '@synapse-ai/core';
import { validateBody, validateQuery } from '../lib/validate.js';
import { AdapterRegistry } from '../adapters/index.js';
import { ClaudeAdapter } from '../adapters/claude.js';
import { GeminiAdapter } from '../adapters/gemini.js';
import { CodexAdapter } from '../adapters/codex.js';
import { ingestRawEvent } from '../services/eventIngestion.js';

// ─── Module-level adapter registry ──────────────────────────────────
// Register specific adapters first, catch-all Claude adapter last.

const registry = new AdapterRegistry()
  .register(new CodexAdapter()) // Codex JSONL / notify events
  .register(new GeminiAdapter()) // Gemini-specific hooks match first
  .register(new ClaudeAdapter()); // Catch-all for remaining hook events

export function createEventsRouter(broadcaster: Broadcaster): Router {
  const router = Router();

  // POST /api/events — receives raw hook JSON body
  router.post('/', validateBody(AgentEventSchema), (req: Request, res: Response) => {
    const result = ingestRawEvent(req.body, broadcaster);
    if (!result.ok) {
      if (result.reason === 'no_adapter') {
        res.status(400).json({ error: 'No adapter matched payload' });
        return;
      }
      res.status(500).json({ error: 'Internal server error' });
      return;
    }
    res.status(200).json({ ok: true, eventId: result.eventId, deduplicated: result.deduplicated });
  });

  // GET /api/events — query stored events
  router.get('/', validateQuery(EventQuerySchema), (req: Request, res: Response) => {
    try {
      const cwdParam = req.query.cwd as string | undefined;
      const fromParam = req.query.from ? parseInt(req.query.from as string, 10) : undefined;
      const toParam = req.query.to ? parseInt(req.query.to as string, 10) : undefined;
      const events = getStoredEvents({
        sessionId: req.query.sessionId as string | undefined,
        agentId: req.query.agentId as string | undefined,
        type: req.query.type as string | undefined,
        cwd: cwdParam ? normalizeCwd(cwdParam) : undefined,
        from: Number.isFinite(fromParam) ? fromParam : undefined,
        to: Number.isFinite(toParam) ? toParam : undefined,
        limit: req.query.limit ? parseInt(req.query.limit as string, 10) : undefined,
        offset: req.query.offset ? parseInt(req.query.offset as string, 10) : undefined,
      });
      res.json(events);
    } catch (err: unknown) {
      logger.error({ err }, 'Error querying events');
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // GET /api/events/sessions — list all sessions with summary
  router.get('/sessions', (req: Request, res: Response) => {
    try {
      const cwdParam = req.query.cwd as string | undefined;
      const cwd = cwdParam ? normalizeCwd(cwdParam) : undefined;
      res.json(listSessions(500, cwd));
    } catch (err: unknown) {
      logger.error({ err }, 'Error listing sessions');
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // GET /api/events/projects — list distinct project cwds
  router.get('/projects', (_req: Request, res: Response) => {
    try {
      const projects = listProjectCwds();
      res.json({ projects });
    } catch (err: unknown) {
      logger.error({ err }, 'Error listing projects');
      res.json({ projects: [] });
    }
  });

  // DELETE /api/events — delete all events
  router.delete('/', (_req: Request, res: Response) => {
    try {
      const deleted = deleteAllEvents();
      logger.info({ deleted }, 'Deleted all events');
      res.json({ ok: true, deleted });
    } catch (err: unknown) {
      logger.error({ err }, 'Error deleting all events');
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // DELETE /api/events/session/:sessionId — delete events for a session
  router.delete('/session/:sessionId', (req: Request, res: Response) => {
    try {
      const sessionId = req.params.sessionId as string;
      const deleted = deleteEventsBySession(sessionId);
      logger.info({ sessionId, deleted }, 'Deleted session events');
      res.json({ ok: true, deleted });
    } catch (err: unknown) {
      logger.error({ err }, 'Error deleting session events');
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  return router;
}

/** Expose registry for test isolation (clearDedupeCache). */
export { registry };
