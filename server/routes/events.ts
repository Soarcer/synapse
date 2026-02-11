import { Router, type Request, type Response } from 'express';
import { storeAndBroadcast, storePreNormalized, getStoredEvents } from '../services/eventStore.js';
import { deleteEventsBySession, deleteAllEvents, listSessions } from '../db.js';
import type { Broadcaster } from '../services/broadcaster.js';

export function createEventsRouter(broadcaster: Broadcaster): Router {
  const router = Router();

  // POST /api/events — receives raw hook JSON body
  router.post('/', (req: Request, res: Response) => {
    try {
      const raw = req.body;
      if (!raw || typeof raw !== 'object') {
        res.status(400).json({ error: 'Invalid JSON body' });
        return;
      }

      // Pre-normalized events from OpenClaw plugin skip hook normalization
      if (raw.eventSource === 'openclaw' && raw.id && raw.type && raw.sessionId) {
        storePreNormalized(raw, broadcaster);
        console.log(`[Events] openclaw -> ${raw.type} (${raw.sessionId})`);
        res.status(200).json({ ok: true, eventId: raw.id });
        return;
      }

      const event = storeAndBroadcast(raw, broadcaster);
      console.log(`[Events] ${raw.hook_event_name || 'unknown'} -> ${event.type} (${event.sessionId})`);
      res.status(200).json({ ok: true, eventId: event.id });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      console.error('[Events] Error processing event:', err);
      res.status(500).json({ error: message });
    }
  });

  // GET /api/events — query stored events
  router.get('/', (req: Request, res: Response) => {
    try {
      const events = getStoredEvents({
        sessionId: req.query.sessionId as string | undefined,
        agentId: req.query.agentId as string | undefined,
        type: req.query.type as string | undefined,
        limit: req.query.limit ? parseInt(req.query.limit as string, 10) : undefined,
        offset: req.query.offset ? parseInt(req.query.offset as string, 10) : undefined,
      });
      res.json(events);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      console.error('[Events] Error querying events:', err);
      res.status(500).json({ error: message });
    }
  });

  // GET /api/events/sessions — list all sessions with summary
  router.get('/sessions', (_req: Request, res: Response) => {
    try {
      res.json(listSessions());
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      res.status(500).json({ error: message });
    }
  });

  // DELETE /api/events — delete all events
  router.delete('/', (_req: Request, res: Response) => {
    try {
      const deleted = deleteAllEvents();
      console.log(`[Events] Deleted all events (${deleted} rows)`);
      res.json({ ok: true, deleted });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      res.status(500).json({ error: message });
    }
  });

  // DELETE /api/events/session/:sessionId — delete events for a session
  router.delete('/session/:sessionId', (req: Request, res: Response) => {
    try {
      const sessionId = req.params.sessionId as string;
      const deleted = deleteEventsBySession(sessionId);
      console.log(`[Events] Deleted session ${sessionId} (${deleted} rows)`);
      res.json({ ok: true, deleted });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      res.status(500).json({ error: message });
    }
  });

  return router;
}