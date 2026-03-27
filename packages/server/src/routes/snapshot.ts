// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bernhard

import fs from 'fs';
import { Router, type Request, type Response } from 'express';
import { logger } from '../lib/logger.js';
import { getEventsBySessionIds, listSessions, insertEvent } from '../db.js';
import { rowToAgentEvent } from '../services/eventStore.js';
import { findTranscriptPath, readTranscript } from '../services/transcriptReader.js';
import type { TranscriptSummary } from '@synapse-ai/core';
import { SnapshotImportSchema, AgentEventSchema } from '@synapse-ai/core';
import { validateBody } from '../lib/validate.js';

// ─── Snapshot format ─────────────────────────────────────────

interface SessionSnapshot {
  sessionId: string;
  events: ReturnType<typeof rowToAgentEvent>[];
  transcript: TranscriptSummary | null;
}

interface SnapshotFile {
  version: 1;
  exportedAt: string;
  projectDir: string;
  sessions: SessionSnapshot[];
}

// ─── Router ──────────────────────────────────────────────────

export function createSnapshotRouter(): Router {
  const router = Router();

  // GET /api/snapshot/export — export all sessions (or one via ?sessionId=...)
  router.get('/export', async (req: Request, res: Response) => {
    try {
      const rawSessionId = req.query.sessionId as string | undefined;
      const SESSION_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;
      const filterSessionId =
        rawSessionId && SESSION_ID_PATTERN.test(rawSessionId) ? rawSessionId : undefined;
      const allSessions = listSessions();
      const sessions = filterSessionId
        ? allSessions.filter((s) => s.session_id === filterSessionId)
        : allSessions;

      // Batch query: single query for all sessions (fixes N+1)
      const sessionIds = sessions.map((s) => s.session_id);
      const groupedRows = getEventsBySessionIds(sessionIds);

      const snapshots: SessionSnapshot[] = [];

      for (const s of sessions) {
        const rows = groupedRows.get(s.session_id) ?? [];
        const events = rows.map(rowToAgentEvent);

        // Try to find and include transcript
        let transcript: TranscriptSummary | null = null;
        try {
          let transcriptPath: string | null = null;
          const startRow = rows.find((r) => r.event_type === 'session_start');
          if (startRow) {
            try {
              const raw = JSON.parse(startRow.raw_payload);
              if (raw.transcript_path && fs.existsSync(raw.transcript_path)) {
                transcriptPath = raw.transcript_path;
              }
            } catch {
              /* ignore */
            }
          }
          if (!transcriptPath) {
            transcriptPath = await findTranscriptPath(s.session_id, process.cwd());
          }
          if (transcriptPath && fs.existsSync(transcriptPath)) {
            transcript = await readTranscript(transcriptPath, s.session_id);
          }
        } catch {
          /* transcript not available */
        }

        snapshots.push({
          sessionId: s.session_id,
          events,
          transcript,
        });
      }

      const snapshot: SnapshotFile = {
        version: 1,
        exportedAt: new Date().toISOString(),
        projectDir: process.cwd(),
        sessions: snapshots,
      };

      res.setHeader('Content-Type', 'application/json');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="synapse-snapshot-${new Date().toISOString().replace(/[:.]/g, '-')}.json"`,
      );
      res.json(snapshot);
    } catch (err: unknown) {
      logger.error({ err }, 'Export error');
      res.status(500).json({ error: 'Export failed' });
    }
  });

  // POST /api/snapshot/import — import a snapshot file
  router.post('/import', validateBody(SnapshotImportSchema), (req: Request, res: Response) => {
    try {
      const snapshot = req.body as SnapshotFile;

      let importedEvents = 0;
      let importedSessions = 0;
      let skippedEvents = 0;

      for (const session of snapshot.sessions) {
        if (!session.events || session.events.length === 0) continue;
        importedSessions++;

        for (const event of session.events) {
          try {
            // Validate event structure and reject oversized events
            const parsed = AgentEventSchema.safeParse(event);
            if (!parsed.success) {
              skippedEvents++;
              continue;
            }
            if (JSON.stringify(event).length > 100_000) {
              skippedEvents++;
              continue;
            }

            insertEvent({
              event_id: event.id,
              session_id: event.sessionId,
              hook_event_name:
                event.eventSource === 'hook'
                  ? event.type === 'session_start'
                    ? 'SessionStart'
                    : event.type
                  : 'imported',
              event_type: event.type,
              agent_id: event.agentId ?? null,
              agent_type: event.agentType ?? null,
              parent_agent_id: event.parentAgentId ?? null,
              tool_name: event.toolName ?? null,
              tool_use_id: event.toolUseId ?? null,
              tool_input: event.toolInput ? JSON.stringify(event.toolInput) : null,
              tool_response: event.toolResponse ? JSON.stringify(event.toolResponse) : null,
              status: event.status ?? null,
              error: event.error ?? null,
              token_input: event.tokenUsage?.input ?? null,
              token_output: event.tokenUsage?.output ?? null,
              duration_ms: event.duration ?? null,
              raw_payload: JSON.stringify(event),
              created_at: event.timestamp,
            });
            importedEvents++;
          } catch {
            // Skip duplicate event_id (UNIQUE constraint)
            skippedEvents++;
          }
        }
      }

      if (skippedEvents > 0) {
        logger.info({ skippedEvents }, 'Import skipped duplicate events');
      }

      // Re-query imported events from DB rather than echoing raw user input
      const importedSessionIds = snapshot.sessions.map((s) => s.sessionId);
      const groupedRows = getEventsBySessionIds(importedSessionIds);
      const allEvents = [...groupedRows.values()].flat().map(rowToAgentEvent);

      res.json({
        imported: true,
        sessions: importedSessions,
        events: importedEvents,
        skipped: skippedEvents,
        allEvents,
        transcripts: snapshot.sessions
          .filter((s) => s.transcript && typeof s.transcript === 'object')
          .map((s) => ({ sessionId: s.sessionId, transcript: s.transcript })),
      });
    } catch (err: unknown) {
      logger.error({ err }, 'Import error');
      res.status(500).json({ error: 'Import failed' });
    }
  });

  return router;
}
