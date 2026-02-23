// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Synapse Contributors

import { Router, type Request, type Response } from 'express';
import { logger } from '../lib/logger.js';
import { storeNormalized, storePreNormalized, getStoredEvents } from '../services/eventStore.js';
import { deleteEventsBySession, deleteAllEvents, listSessions } from '../db.js';
import type { Broadcaster } from '../services/broadcaster.js';
import { AgentEventSchema, EventQuerySchema, normalizeCwd } from '@synapse-ai/core';
import { validateBody, validateQuery } from '../lib/validate.js';
import { AdapterRegistry } from '../adapters/index.js';
import { ClaudeAdapter } from '../adapters/claude.js';
import { GeminiAdapter } from '../adapters/gemini.js';
import { CodexAdapter } from '../adapters/codex.js';

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
    try {
      const raw = req.body;

      // Pre-normalized events from OpenClaw plugin skip the adapter registry
      if (raw.eventSource === 'openclaw' && raw.id && raw.type && raw.sessionId) {
        storePreNormalized(raw, broadcaster);
        logger.info(
          { eventSource: 'openclaw', type: raw.type, sessionId: raw.sessionId },
          'Event received',
        );
        res.status(200).json({ ok: true, eventId: raw.id });
        return;
      }

      // All hook events go through the adapter registry
      const result = registry.dispatch(raw);

      if (!result) {
        logger.warn({ keys: Object.keys(raw) }, 'No adapter matched payload');
        res.status(400).json({ error: 'No adapter matched payload' });
        return;
      }

      const { event, adapter, isDuplicate } = result;

      if (isDuplicate) {
        res.status(200).json({ ok: true, eventId: event.id, deduplicated: true });
        return;
      }

      storeNormalized(event, broadcaster, {
        hookEventName: adapter.id,
        rawPayload: raw,
      });

      logger.info(
        {
          adapter: adapter.id,
          hookEvent: raw.hook_event_name || 'unknown',
          type: event.type,
          sessionId: event.sessionId,
        },
        'Event received',
      );
      res.status(200).json({ ok: true, eventId: event.id });
    } catch (err: unknown) {
      logger.error({ err }, 'Error processing event');
      res.status(500).json({ error: 'Internal server error' });
    }
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
