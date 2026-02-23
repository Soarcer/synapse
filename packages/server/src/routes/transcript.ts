// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Synapse Contributors

import fs from 'fs';
import { Router, type Request, type Response } from 'express';
import { logger } from '../lib/logger.js';
import {
  findTranscriptPath,
  readTranscript,
  readFullTranscript,
} from '../services/transcriptReader.js';
import { parseThinking } from '../services/thinkingParser.js';
import {
  scanProjectTranscripts,
  getHistorySessions,
  isScanInProgress,
} from '../services/transcriptScanner.js';
import { queryEvents } from '../db.js';
import type { ReasoningTurn, ReasoningToolCall, ReasoningData } from '@synapse-ai/core';

/** Resolve transcript path for a session, checking DB then scanning dirs */
async function resolveTranscriptPath(sessionId: string): Promise<string | null> {
  let transcriptPath: string | null = null;

  const rows = queryEvents({ sessionId, type: 'session_start', limit: 1 });
  if (rows.length > 0) {
    try {
      const raw = JSON.parse(rows[0].raw_payload);
      if (raw.transcript_path && fs.existsSync(raw.transcript_path)) {
        transcriptPath = raw.transcript_path;
      }
    } catch {
      /* ignore */
    }
  }

  if (!transcriptPath) {
    transcriptPath = await findTranscriptPath(sessionId, process.cwd());
  }

  if (!transcriptPath || !fs.existsSync(transcriptPath)) return null;
  return transcriptPath;
}

export function createTranscriptRouter(): Router {
  const router = Router();

  // POST /api/transcript/scan — trigger a scan of historical transcripts
  router.post('/scan', async (_req: Request, res: Response) => {
    if (isScanInProgress()) {
      res.status(409).json({ error: 'Scan already in progress' });
      return;
    }

    try {
      const result = await scanProjectTranscripts(process.cwd());
      res.json(result);
    } catch (err: unknown) {
      logger.error({ err }, 'Transcript scan error');
      res.status(500).json({ error: 'Scan failed' });
    }
  });

  // GET /api/transcript/history — list indexed historical sessions
  router.get('/history', (req: Request, res: Response) => {
    try {
      const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 500);
      const offset = Math.max(Number(req.query.offset) || 0, 0);
      const { sessions, total } = getHistorySessions(limit, offset);

      res.json({
        sessions: sessions.map((s) => ({
          sessionId: s.session_id,
          projectHash: s.project_hash,
          transcriptPath: s.transcript_path,
          startedAt: s.started_at,
          endedAt: s.ended_at,
          model: s.model,
          permissionMode: s.permission_mode,
          gitBranch: s.git_branch,
          slug: s.slug,
          totalTurns: s.total_turns,
          totalToolCalls: s.total_tool_calls,
          estimatedCostUsd: s.estimated_cost_usd,
          totalInputTokens: s.total_input_tokens,
          totalOutputTokens: s.total_output_tokens,
          fileSizeBytes: s.file_size_bytes,
          scannedAt: s.scanned_at,
        })),
        total,
      });
    } catch (err: unknown) {
      logger.error({ err }, 'History list error');
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // POST /api/transcript/batch — fetch summaries for multiple sessions
  router.post('/batch', async (req: Request, res: Response) => {
    try {
      const { sessionIds } = req.body as { sessionIds?: string[] };

      if (!Array.isArray(sessionIds) || sessionIds.length === 0) {
        res.status(400).json({ error: 'sessionIds array required' });
        return;
      }
      if (sessionIds.length > 20) {
        res.status(400).json({ error: 'Maximum 20 session IDs per batch' });
        return;
      }

      const results: Record<string, unknown> = {};

      await Promise.all(
        sessionIds.map(async (sessionId) => {
          try {
            const transcriptPath = await resolveTranscriptPath(sessionId);
            if (!transcriptPath) {
              results[sessionId] = null;
              return;
            }
            results[sessionId] = await readTranscript(transcriptPath, sessionId);
          } catch {
            results[sessionId] = null;
          }
        }),
      );

      res.json(results);
    } catch (err: unknown) {
      logger.error({ err }, 'Batch transcript error');
      res.status(500).json({ error: 'Batch transcript read failed' });
    }
  });

  // GET /api/transcript/:sessionId/full — full transcript with all record types
  router.get('/:sessionId/full', async (req: Request, res: Response) => {
    try {
      const sessionId = req.params.sessionId as string;
      const transcriptPath = await resolveTranscriptPath(sessionId);

      if (!transcriptPath) {
        res.status(404).json({ error: 'Transcript not found', sessionId });
        return;
      }

      const fullTranscript = await readFullTranscript(transcriptPath, sessionId);
      res.json(fullTranscript);
    } catch (err: unknown) {
      if (
        err instanceof Error &&
        'code' in err &&
        (err as NodeJS.ErrnoException).code === 'ENOENT'
      ) {
        res
          .status(404)
          .json({ error: 'Transcript not found', sessionId: req.params.sessionId as string });
        return;
      }
      logger.error({ err }, 'Full transcript error');
      res.status(500).json({ error: 'Transcript read failed' });
    }
  });

  // GET /api/transcript/:sessionId/reasoning — thinking blocks + linked tool calls
  router.get('/:sessionId/reasoning', async (req: Request, res: Response) => {
    try {
      const sessionId = req.params.sessionId as string;
      const transcriptPath = await resolveTranscriptPath(sessionId);

      if (!transcriptPath) {
        res.status(404).json({ error: 'Transcript not found', sessionId });
        return;
      }

      const full = await readFullTranscript(transcriptPath, sessionId);

      // Build a map of tool_use_id → tool_result for linking
      const toolResultMap = new Map<
        string,
        { content: string; is_error: boolean; timestamp: number }
      >();
      for (const conv of full.conversations) {
        for (const block of conv.content) {
          if (block.type === 'tool_result') {
            toolResultMap.set(block.tool_use_id, {
              content: block.content,
              is_error: block.is_error,
              timestamp: conv.timestamp,
            });
          }
        }
      }

      // Transform assistant conversations with thinking blocks into ReasoningTurns
      const turns: ReasoningTurn[] = [];
      for (const conv of full.conversations) {
        if (conv.type !== 'assistant') continue;

        const thinkingBlocks = conv.content.filter((b) => b.type === 'thinking');
        const textBlocks = conv.content.filter((b) => b.type === 'text');
        const toolUseBlocks = conv.content.filter((b) => b.type === 'tool_use');

        // Skip turns with no thinking and no tool calls
        if (thinkingBlocks.length === 0 && toolUseBlocks.length === 0) continue;

        const thinkingText =
          thinkingBlocks.map((b) => (b.type === 'thinking' ? b.thinking : '')).join('\n\n') || null;

        const responseText =
          textBlocks.map((b) => (b.type === 'text' ? b.text : '')).join('\n\n') || null;

        const toolCalls: ReasoningToolCall[] = toolUseBlocks
          .filter((b): b is Extract<typeof b, { type: 'tool_use' }> => b.type === 'tool_use')
          .map((b) => {
            const result = toolResultMap.get(b.id);
            return {
              id: b.id,
              name: b.name,
              input: b.input,
              resultContent: result?.content ?? null,
              isError: result?.is_error ?? false,
              durationMs: result ? result.timestamp - conv.timestamp : null,
            };
          });

        turns.push({
          uuid: conv.uuid,
          parentUuid: conv.parentUuid,
          timestamp: conv.timestamp,
          model: conv.model,
          isSidechain: conv.isSidechain,
          isApiErrorMessage: conv.isApiErrorMessage,
          error: conv.error,
          thinkingText,
          structured: parseThinking(thinkingText),
          responseText,
          toolCalls,
          usage: {
            inputTokens: conv.usage.inputTokens,
            outputTokens: conv.usage.outputTokens,
            cacheReadTokens: conv.usage.cacheReadTokens,
          },
        });
      }

      const data: ReasoningData = { sessionId, turns };
      res.json(data);
    } catch (err: unknown) {
      if (
        err instanceof Error &&
        'code' in err &&
        (err as NodeJS.ErrnoException).code === 'ENOENT'
      ) {
        res
          .status(404)
          .json({ error: 'Transcript not found', sessionId: req.params.sessionId as string });
        return;
      }
      logger.error({ err }, 'Reasoning endpoint error');
      res.status(500).json({ error: 'Transcript read failed' });
    }
  });

  // GET /api/transcript/:sessionId — parse JSONL transcript for a session (summary)
  // Returns 200 with empty data when transcript is unavailable (not 404)
  // to avoid browser console errors from bulk-fetching all sessions.
  router.get('/:sessionId', async (req: Request, res: Response) => {
    try {
      const sessionId = req.params.sessionId as string;
      const transcriptPath = await resolveTranscriptPath(sessionId);

      if (!transcriptPath) {
        res.json({ sessionId, turns: [], found: false });
        return;
      }

      const summary = await readTranscript(transcriptPath, sessionId);
      res.json(summary);
    } catch (err: unknown) {
      if (
        err instanceof Error &&
        'code' in err &&
        (err as NodeJS.ErrnoException).code === 'ENOENT'
      ) {
        res.json({ sessionId: req.params.sessionId as string, turns: [], found: false });
        return;
      }
      logger.error({ err }, 'Transcript error');
      res.status(500).json({ error: 'Transcript read failed' });
    }
  });

  // GET /api/transcript — list available transcripts for all known sessions
  router.get('/', async (_req: Request, res: Response) => {
    try {
      // Get unique session IDs from events
      const rows = queryEvents({ type: 'session_start', limit: 100 });
      const available: Array<{ sessionId: string; transcriptPath: string | null }> = [];

      for (const row of rows) {
        let tp: string | null = null;
        try {
          const raw = JSON.parse(row.raw_payload);
          if (raw.transcript_path && fs.existsSync(raw.transcript_path)) tp = raw.transcript_path;
        } catch {
          /* ignore */
        }

        if (!tp) tp = await findTranscriptPath(row.session_id, process.cwd());

        available.push({ sessionId: row.session_id, transcriptPath: tp });
      }

      res.json(available);
    } catch (err: unknown) {
      logger.error({ err }, 'Transcript list error');
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  return router;
}
