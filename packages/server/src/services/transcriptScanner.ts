// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bernhard

import fs from 'fs';
import path from 'path';
import os from 'os';
import { logger } from '../lib/logger.js';
import { readTranscript } from './transcriptReader.js';
import {
  getTranscriptIndexEntry,
  upsertTranscriptIndex,
  isLiveSession,
  getAllTranscriptIndex,
  type TranscriptIndexRow,
} from '../db.js';

const SESSION_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;
const MAX_FILE_SIZE_BYTES = 200 * 1024 * 1024; // 200 MB
const MAX_FILES_PER_SCAN = 500;

export interface ScanError {
  sessionId: string;
  reason: 'file_too_large' | 'parse_error' | 'permission_denied' | 'file_locked';
}

export interface ScanResult {
  scanned: number;
  indexed: number;
  skipped: number;
  errors: ScanError[];
  truncated: boolean;
  durationMs: number;
}

/** Module-level concurrency guard */
let scanning = false;

export function isScanInProgress(): boolean {
  return scanning;
}

/** Derive the Claude projects directory hash from a project path */
function projectHash(projectPath: string): string {
  return projectPath.replace(/[:\\/]/g, '-');
}

/**
 * Scan a directory of JSONL files and index them into transcript_index.
 * Exported for direct testing — the route handler calls scanProjectTranscripts().
 */
export async function scanTranscriptsInDir(scanDir: string, hash = ''): Promise<ScanResult> {
  const start = Date.now();
  const result: ScanResult = {
    scanned: 0,
    indexed: 0,
    skipped: 0,
    errors: [],
    truncated: false,
    durationMs: 0,
  };

  if (!fs.existsSync(scanDir)) {
    result.durationMs = Date.now() - start;
    return result;
  }

  let files: string[];
  try {
    files = fs.readdirSync(scanDir).filter((f) => f.endsWith('.jsonl'));
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'EACCES' || code === 'EPERM') {
      logger.error({ err, scanDir }, 'Permission denied reading scan directory');
      throw err;
    }
    throw err;
  }

  if (files.length > MAX_FILES_PER_SCAN) {
    files = files.slice(0, MAX_FILES_PER_SCAN);
    result.truncated = true;
  }

  for (const file of files) {
    const sessionId = file.replace(/\.jsonl$/, '');
    result.scanned++;

    if (!SESSION_ID_PATTERN.test(sessionId)) {
      logger.warn({ sessionId, file }, 'Skipping file with invalid session ID');
      result.skipped++;
      continue;
    }

    if (isLiveSession(sessionId)) {
      result.skipped++;
      continue;
    }

    const filePath = path.join(scanDir, file);
    let fileSize: number;
    try {
      fileSize = fs.statSync(filePath).size;
    } catch (err: unknown) {
      const code = (err as NodeJS.ErrnoException).code;
      const reason = code === 'EBUSY' ? 'file_locked' : 'permission_denied';
      result.errors.push({ sessionId, reason });
      continue;
    }

    if (fileSize > MAX_FILE_SIZE_BYTES) {
      result.errors.push({ sessionId, reason: 'file_too_large' });
      continue;
    }

    const existing = getTranscriptIndexEntry(sessionId);
    if (existing && existing.file_size_bytes === fileSize) {
      result.skipped++;
      continue;
    }

    try {
      const summary = await readTranscript(filePath, sessionId);

      let startedAt: number | null = null;
      let endedAt: number | null = null;
      if (summary.turns.length > 0) {
        startedAt = summary.turns[0].timestamp;
        endedAt = summary.turns[summary.turns.length - 1].timestamp;
      }

      upsertTranscriptIndex({
        session_id: sessionId,
        project_hash: hash,
        transcript_path: filePath,
        started_at: startedAt,
        ended_at: endedAt,
        model: summary.modelUsage?.[0]?.model ?? null,
        permission_mode: summary.permissionMode ?? null,
        git_branch: summary.gitBranch ?? null,
        slug: summary.slug ?? null,
        total_turns: summary.turns.length,
        total_tool_calls: summary.totalToolCalls,
        estimated_cost_usd: summary.estimatedCostUsd,
        total_input_tokens: summary.totalInputTokens,
        total_output_tokens: summary.totalOutputTokens,
        file_size_bytes: fileSize,
        scanned_at: Date.now(),
      });

      result.indexed++;
    } catch (err: unknown) {
      const code = (err as NodeJS.ErrnoException).code;
      const reason = code === 'EBUSY' ? 'file_locked' : 'parse_error';
      result.errors.push({ sessionId, reason });
      logger.warn({ err, sessionId, filePath }, 'Failed to parse transcript');
    }
  }

  result.durationMs = Date.now() - start;
  return result;
}

/**
 * Scan the current project's transcripts. Main entry point for the route.
 * Manages the concurrency guard.
 */
export async function scanProjectTranscripts(projectDir: string): Promise<ScanResult> {
  if (scanning) {
    throw new Error('SCAN_IN_PROGRESS');
  }

  scanning = true;
  try {
    const hash = projectHash(projectDir);
    const claudeDir = path.join(os.homedir(), '.claude', 'projects');
    const scanDir = path.join(claudeDir, hash);

    if (!path.resolve(scanDir).startsWith(path.resolve(claudeDir))) {
      return { scanned: 0, indexed: 0, skipped: 0, errors: [], truncated: false, durationMs: 0 };
    }

    return await scanTranscriptsInDir(scanDir, hash);
  } finally {
    scanning = false;
  }
}

/**
 * Get paginated historical sessions from the index.
 */
export function getHistorySessions(
  limit = 100,
  offset = 0,
): { sessions: TranscriptIndexRow[]; total: number } {
  const { rows, total } = getAllTranscriptIndex(limit, offset);
  return { sessions: rows, total };
}
