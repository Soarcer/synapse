// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bernhard

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
import type {
  ReasoningTurn,
  ReasoningToolCall,
  ReasoningData,
  PromptTurnGroup,
  PromptTurnData,
  ConversationRecord,
  FullTranscript,
} from '@synapse-ai/core';

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

// ─── Transcript Cache ────────────────────────────────────────────

const transcriptCache = new Map<
  string,
  { mtime: number; size: number; result: FullTranscript; cachedAt: number }
>();
const CACHE_TTL = 5000; // 5 seconds

async function getCachedTranscript(
  transcriptPath: string,
  sessionId: string,
): Promise<FullTranscript> {
  const stat = await fs.promises.stat(transcriptPath);
  const cached = transcriptCache.get(transcriptPath);
  if (
    cached &&
    cached.mtime === stat.mtimeMs &&
    cached.size === stat.size &&
    Date.now() - cached.cachedAt < CACHE_TTL
  ) {
    return cached.result;
  }
  const result = await readFullTranscript(transcriptPath, sessionId);
  transcriptCache.set(transcriptPath, {
    mtime: stat.mtimeMs,
    size: stat.size,
    result,
    cachedAt: Date.now(),
  });
  return result;
}

// ─── Shared Helpers ──────────────────────────────────────────────

/** Build tool_use_id → tool_result lookup from conversation records */
function buildToolResultMap(
  conversations: ConversationRecord[],
): Map<string, { content: string; is_error: boolean; timestamp: number }> {
  const map = new Map<string, { content: string; is_error: boolean; timestamp: number }>();
  for (const conv of conversations) {
    for (const block of conv.content) {
      if (block.type === 'tool_result') {
        map.set(block.tool_use_id, {
          content: block.content,
          is_error: block.is_error,
          timestamp: conv.timestamp,
        });
      }
    }
  }
  return map;
}

/**
 * Convert an assistant ConversationRecord into a ReasoningTurn.
 * @param keepTextOnly - If true, keep turns that are pure text (no thinking/tools).
 *   /reasoning passes false (original behavior), /prompt-turns passes true
 *   so simple replies like "Done." aren't dropped.
 */
function buildReasoningTurn(
  conv: ConversationRecord,
  toolResultMap: Map<string, { content: string; is_error: boolean; timestamp: number }>,
  keepTextOnly = false,
): ReasoningTurn | null {
  const thinkingBlocks = conv.content.filter((b) => b.type === 'thinking');
  const textBlocks = conv.content.filter((b) => b.type === 'text');
  const toolUseBlocks = conv.content.filter((b) => b.type === 'tool_use');

  // Skip empty turns; skip text-only turns unless keepTextOnly is set
  const hasContent = thinkingBlocks.length > 0 || toolUseBlocks.length > 0;
  if (!hasContent && (!keepTextOnly || textBlocks.length === 0)) return null;

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

  return {
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
      cacheCreationTokens: conv.usage.cacheCreationTokens ?? 0,
      thinkingTokens: conv.usage.thinkingTokens ?? 0,
    },
  };
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

      const full = await getCachedTranscript(transcriptPath, sessionId);
      const toolResultMap = buildToolResultMap(full.conversations);

      const turns: ReasoningTurn[] = [];
      for (const conv of full.conversations) {
        if (conv.type !== 'assistant') continue;
        const turn = buildReasoningTurn(conv, toolResultMap);
        if (turn) turns.push(turn);
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

  // GET /api/transcript/:sessionId/prompt-turns — responses grouped by parent prompt
  router.get('/:sessionId/prompt-turns', async (req: Request, res: Response) => {
    try {
      const sessionId = req.params.sessionId as string;
      const transcriptPath = await resolveTranscriptPath(sessionId);
      if (!transcriptPath) {
        res.status(404).json({ error: 'Transcript not found', sessionId });
        return;
      }
      const full = await getCachedTranscript(transcriptPath, sessionId);
      const toolResultMap = buildToolResultMap(full.conversations);

      // Index ALL conversation records by uuid for chain walking
      const allRecords = new Map<string, ConversationRecord>();
      for (const conv of full.conversations) {
        allRecords.set(conv.uuid, conv);
      }

      // Index user messages by uuid
      const userMessages = new Map<string, { uuid: string; timestamp: number; text: string }>();
      for (const conv of full.conversations) {
        if (conv.type !== 'user') continue;
        const text = conv.content
          .filter((b) => b.type === 'text')
          .map((b) => (b.type === 'text' ? b.text : ''))
          .join('\n');
        userMessages.set(conv.uuid, { uuid: conv.uuid, timestamp: conv.timestamp, text });
      }

      // Walk parentUuid chain to find the root user message
      function findRootUserUuid(startUuid: string): string | null {
        let current = startUuid;
        const visited = new Set<string>(); // cycle guard
        while (current && !visited.has(current)) {
          if (userMessages.has(current)) return current;
          visited.add(current);
          const record = allRecords.get(current);
          if (!record?.parentUuid) return null;
          current = record.parentUuid;
        }
        return null;
      }

      // Group assistant turns by root user message
      const groupMap = new Map<string, ReasoningTurn[]>();
      for (const conv of full.conversations) {
        if (conv.type !== 'assistant') continue;
        if (!conv.parentUuid) continue;

        const turn = buildReasoningTurn(conv, toolResultMap, /* keepTextOnly */ true);
        if (!turn) continue;

        const rootUuid = findRootUserUuid(conv.parentUuid);
        if (!rootUuid) continue;

        const existing = groupMap.get(rootUuid) ?? [];
        existing.push(turn);
        groupMap.set(rootUuid, existing);
      }

      // Build PromptTurnGroup[] ordered by timestamp
      const groups: PromptTurnGroup[] = [];
      for (const [uuid, turns] of groupMap) {
        const user = userMessages.get(uuid);
        if (!user) continue;
        const allResponseText =
          turns
            .map((t) => t.responseText)
            .filter(Boolean)
            .join('\n\n') || null;
        groups.push({
          promptUuid: uuid,
          promptTimestamp: user.timestamp,
          promptText: user.text,
          turns: turns.sort((a, b) => a.timestamp - b.timestamp),
          responseText: allResponseText,
        });
      }
      groups.sort((a, b) => a.promptTimestamp - b.promptTimestamp);

      res.json({ sessionId, groups } satisfies PromptTurnData);
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
      logger.error({ err }, 'Prompt-turns endpoint error');
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
