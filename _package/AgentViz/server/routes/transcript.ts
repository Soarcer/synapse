import fs from 'fs';
import { Router, type Request, type Response } from 'express';
import { findTranscriptPath, readTranscript } from '../services/transcriptReader.js';
import { queryEvents } from '../db.js';

export function createTranscriptRouter(): Router {
  const router = Router();

  // GET /api/transcript/:sessionId — parse JSONL transcript for a session
  router.get('/:sessionId', (req: Request, res: Response) => {
    try {
      const sessionId = req.params.sessionId as string;

      // Try to find transcript_path from stored session_start event
      let transcriptPath: string | null = null;

      const rows = queryEvents({ sessionId, type: 'session_start', limit: 1 });
      if (rows.length > 0) {
        try {
          const raw = JSON.parse(rows[0].raw_payload);
          if (raw.transcript_path && fs.existsSync(raw.transcript_path)) {
            transcriptPath = raw.transcript_path;
          }
        } catch { /* ignore */ }
      }

      // Fallback: try to find by scanning project dirs
      if (!transcriptPath) {
        transcriptPath = findTranscriptPath(sessionId, process.cwd());
      }

      if (!transcriptPath || !fs.existsSync(transcriptPath)) {
        res.status(404).json({ error: 'Transcript not found', sessionId });
        return;
      }

      const summary = readTranscript(transcriptPath, sessionId);
      res.json(summary);
    } catch (err: any) {
      if (err?.code === 'ENOENT') {
        res.status(404).json({ error: 'Transcript not found', sessionId: req.params.sessionId });
        return;
      }
      console.error('[Transcript] Error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/transcript — list available transcripts for all known sessions
  router.get('/', (_req: Request, res: Response) => {
    try {
      // Get unique session IDs from events
      const rows = queryEvents({ type: 'session_start', limit: 100 });
      const available: Array<{ sessionId: string; transcriptPath: string | null }> = [];

      for (const row of rows) {
        let tp: string | null = null;
        try {
          const raw = JSON.parse(row.raw_payload);
          if (raw.transcript_path && fs.existsSync(raw.transcript_path)) tp = raw.transcript_path;
        } catch { /* ignore */ }

        if (!tp) tp = findTranscriptPath(row.session_id, process.cwd());

        available.push({ sessionId: row.session_id, transcriptPath: tp });
      }

      res.json(available);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}
