import fs from 'fs';
import { Router, type Request, type Response } from 'express';
import { getEventsBySession, listSessions, insertEvent } from '../db.js';
import { rowToAgentEvent } from '../services/eventStore.js';
import { findTranscriptPath, readTranscript } from '../services/transcriptReader.js';
import type { TranscriptSummary } from '../../src/types/transcript.js';

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
  router.get('/export', (req: Request, res: Response) => {
    try {
      const filterSessionId = req.query.sessionId as string | undefined;
      const allSessions = listSessions();
      const sessions = filterSessionId
        ? allSessions.filter((s) => s.session_id === filterSessionId)
        : allSessions;

      const snapshots: SessionSnapshot[] = [];

      for (const s of sessions) {
        const rows = getEventsBySession(s.session_id);
        const events = rows.map(rowToAgentEvent);

        // Try to find and include transcript
        let transcript: TranscriptSummary | null = null;
        try {
          // Check if any session_start event has transcript_path
          let transcriptPath: string | null = null;
          const startRow = rows.find((r) => r.event_type === 'session_start');
          if (startRow) {
            try {
              const raw = JSON.parse(startRow.raw_payload);
              if (raw.transcript_path && fs.existsSync(raw.transcript_path)) {
                transcriptPath = raw.transcript_path;
              }
            } catch { /* ignore */ }
          }
          if (!transcriptPath) {
            transcriptPath = findTranscriptPath(s.session_id, process.cwd());
          }
          if (transcriptPath && fs.existsSync(transcriptPath)) {
            transcript = readTranscript(transcriptPath, s.session_id);
          }
        } catch { /* transcript not available */ }

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
      const message = err instanceof Error ? err.message : 'Unknown error';
      console.error('[Snapshot] Export error:', err);
      res.status(500).json({ error: message });
    }
  });

  // POST /api/snapshot/import — import a snapshot file
  router.post('/import', (req: Request, res: Response) => {
    try {
      const snapshot = req.body as SnapshotFile;

      if (!snapshot || snapshot.version !== 1 || !Array.isArray(snapshot.sessions)) {
        res.status(400).json({ error: 'Invalid snapshot format' });
        return;
      }

      let importedEvents = 0;
      let importedSessions = 0;

      for (const session of snapshot.sessions) {
        if (!session.events || session.events.length === 0) continue;
        importedSessions++;

        for (const event of session.events) {
          try {
            insertEvent({
              event_id: event.id,
              session_id: event.sessionId,
              hook_event_name: event.eventSource === 'hook' ? (event.type === 'session_start' ? 'SessionStart' : event.type) : 'imported',
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
          }
        }
      }

      res.json({
        imported: true,
        sessions: importedSessions,
        events: importedEvents,
        // Return the event data so the frontend can replay it
        allEvents: snapshot.sessions.flatMap((s) => s.events),
        transcripts: snapshot.sessions
          .filter((s) => s.transcript)
          .map((s) => ({ sessionId: s.sessionId, transcript: s.transcript })),
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      console.error('[Snapshot] Import error:', err);
      res.status(500).json({ error: message });
    }
  });

  return router;
}
