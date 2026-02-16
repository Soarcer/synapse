import { Router, type Request, type Response } from 'express';
import { logger } from '../lib/logger.js';
import { storeAndBroadcast, storePreNormalized, getStoredEvents } from '../services/eventStore.js';
import { deleteEventsBySession, deleteAllEvents, listSessions } from '../db.js';
import type { Broadcaster } from '../services/broadcaster.js';
import { AgentEventSchema, EventQuerySchema, normalizeCwd } from '@synapse-ai/core';
import { validateBody, validateQuery } from '../lib/validate.js';

export function createEventsRouter(broadcaster: Broadcaster): Router {
  const router = Router();

  // POST /api/events — receives raw hook JSON body
  router.post('/', validateBody(AgentEventSchema), (req: Request, res: Response) => {
    try {
      const raw = req.body;

      // Pre-normalized events from OpenClaw plugin skip hook normalization
      if (raw.eventSource === 'openclaw' && raw.id && raw.type && raw.sessionId) {
        storePreNormalized(raw, broadcaster);
        logger.info({ eventSource: 'openclaw', type: raw.type, sessionId: raw.sessionId }, 'Event received');
        res.status(200).json({ ok: true, eventId: raw.id });
        return;
      }

      const event = storeAndBroadcast(raw, broadcaster);
      logger.info({ hookEvent: raw.hook_event_name || 'unknown', type: event.type, sessionId: event.sessionId }, 'Event received');
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
      const events = getStoredEvents({
        sessionId: req.query.sessionId as string | undefined,
        agentId: req.query.agentId as string | undefined,
        type: req.query.type as string | undefined,
        cwd: cwdParam ? normalizeCwd(cwdParam) : undefined,
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
  router.get('/sessions', (_req: Request, res: Response) => {
    try {
      res.json(listSessions());
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