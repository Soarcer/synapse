// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bernhard

import { Router, type Request, type Response } from 'express';
import { logger } from '../lib/logger.js';
import { storeNormalized, storePreNormalized, getStoredEvents } from '../services/eventStore.js';
import { deleteEventsBySession, deleteAllEvents, listSessions, listProjectCwds } from '../db.js';
import type { Broadcaster } from '../services/broadcaster.js';
import { AgentEventSchema, EventQuerySchema, normalizeCwd } from '@synapse-ai/core';
import { validateBody, validateQuery } from '../lib/validate.js';
import { AdapterRegistry } from '../adapters/index.js';
import { ClaudeAdapter } from '../adapters/claude.js';
import { GeminiAdapter } from '../adapters/gemini.js';
import { CodexAdapter } from '../adapters/codex.js';
import { pending } from '../state/permissionState.js';

// ─── Module-level adapter registry ──────────────────────────────────
// Register specific adapters first, catch-all Claude adapter last.

const registry = new AdapterRegistry()
  .register(new CodexAdapter()) // Codex JSONL / notify events
  .register(new GeminiAdapter()) // Gemini-specific hooks match first
  .register(new ClaudeAdapter()); // Catch-all for remaining hook events

/**
 * When ANY hook event arrives for a session that has a pending permission,
 * the user answered locally — the session moved past the blocked permission.
 *
 * Behavior mapping:
 *   PostToolUse          → allow (tool executed successfully)
 *   PostToolUseFailure   → deny  (tool was rejected or failed)
 *   Everything else      → allow (session advanced, tool was implicitly allowed)
 *
 * We match by session_id only (not tool_use_id) because the PermissionRequest
 * body may not include tool_use_id.
 */
function resolveIfSessionAdvanced(raw: Record<string, unknown>, broadcaster: Broadcaster): void {
  if (pending.size === 0) return;

  const sessionId = raw.session_id as string | undefined;
  if (!sessionId) return;

  // Skip the PermissionRequest event itself — it fires alongside the HTTP hook
  // and should NOT auto-resolve its own pending entry.
  const hookName = raw.hook_event_name as string | undefined;
  if (hookName === 'PermissionRequest') return;

  // Debug: log every event that reaches here when permissions are pending
  const pendingSessionIds = [...pending.values()].map((e) => e.event.session_id);
  logger.debug(
    { hookName, sessionId, pendingCount: pending.size, pendingSessionIds },
    'resolveIfSessionAdvanced: checking event against pending permissions',
  );

  // Resolve ALL matching permissions for this session — multiple can exist
  // (e.g. rapid-fire tool calls from a subagent).
  for (const [id, entry] of pending) {
    if (entry.event.session_id === sessionId) {
      const behavior = hookName === 'PostToolUseFailure' ? 'deny' : 'allow';
      clearTimeout(entry.timer);
      pending.delete(id);
      // Close the held HTTP response (Claude Code already moved on)
      try {
        entry.res.json({
          hookSpecificOutput: {
            hookEventName: 'PermissionRequest',
            decision: { behavior },
          },
        });
      } catch {
        // Response already closed
      }
      broadcaster.broadcastRaw({
        type: 'permissionResolved',
        data: { id, behavior },
      });
      logger.info({ id, sessionId, hookName }, 'Permission auto-resolved: session advanced');
    }
  }
}

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

      // Auto-resolve pending permissions when the session advances locally.
      // Any event from the same session (except PermissionRequest itself) triggers this.
      resolveIfSessionAdvanced(raw, broadcaster);

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
