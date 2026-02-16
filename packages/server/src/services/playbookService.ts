import { logger } from '../lib/logger.js';
import {
  getAllPlaybooks as dbGetAllPlaybooks,
  getPlaybookById as dbGetPlaybookById,
  insertPlaybook as dbInsertPlaybook,
  deletePlaybook as dbDeletePlaybook,
  type PlaybookRow,
} from '../db.js';
import { buildSessionContext } from './reportCardEngine.js';
import type { Playbook, PlaybookPattern, PlaybookCategory } from '@synapse-ai/core';

// ─── Default Pattern ─────────────────────────────────────────────────

const DEFAULT_PATTERN: PlaybookPattern = {
  toolSequence: [],
  modelStrategy: 'unknown',
  avgTurns: 0,
  avgDurationMinutes: 0,
  readBeforeEdit: false,
  testAfterEdit: false,
  usedSubagents: false,
  compactionCount: 0,
};

// ─── Row → Playbook Conversion ───────────────────────────────────────

function rowToPlaybook(row: PlaybookRow): Playbook {
  let pattern: PlaybookPattern = { ...DEFAULT_PATTERN };
  let tags: string[] = [];

  try { pattern = JSON.parse(row.pattern); } catch { /* ignore */ }
  try { tags = row.tags ? JSON.parse(row.tags) : []; } catch { /* ignore */ }

  return {
    id: row.id,
    name: row.name,
    description: row.description,
    category: row.category as PlaybookCategory,
    sourceSessionId: row.source_session_id ?? undefined,
    pattern,
    tags,
    score: row.score ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ─── CRUD ────────────────────────────────────────────────────────────

export function getAllPlaybooks(): Playbook[] {
  const rows = dbGetAllPlaybooks();
  return rows.map(rowToPlaybook);
}

export function getPlaybookById(id: number): Playbook | undefined {
  const row = dbGetPlaybookById(id);
  return row ? rowToPlaybook(row) : undefined;
}

export function createPlaybook(params: {
  name: string;
  description: string;
  category: PlaybookCategory;
  sourceSessionId?: string;
  tags?: string[];
}): Playbook {
  let pattern: PlaybookPattern = { ...DEFAULT_PATTERN };

  if (params.sourceSessionId) {
    try {
      pattern = generatePlaybookFromSession(params.sourceSessionId);
    } catch (err) {
      logger.warn({ err, sessionId: params.sourceSessionId }, 'Failed to generate pattern from session, using defaults');
    }
  }

  const id = dbInsertPlaybook({
    name: params.name,
    description: params.description,
    category: params.category,
    source_session_id: params.sourceSessionId,
    pattern: JSON.stringify(pattern),
    tags: params.tags ? JSON.stringify(params.tags) : undefined,
  });

  logger.info({ id, name: params.name, category: params.category }, 'Playbook created');

  return getPlaybookById(id)!;
}

export function removePlaybook(id: number): number {
  const result = dbDeletePlaybook(id);
  if (result > 0) {
    logger.info({ id }, 'Playbook deleted');
  }
  return result;
}

// ─── Pattern Generation ──────────────────────────────────────────────

export function generatePlaybookFromSession(sessionId: string): PlaybookPattern {
  const ctx = buildSessionContext(sessionId);

  // Tool sequence (deduplicated consecutive tools)
  const toolSequence: string[] = [];
  let lastTool = '';
  for (const evt of ctx.events) {
    if (evt.tool_name && evt.tool_name !== lastTool) {
      toolSequence.push(evt.tool_name);
      lastTool = evt.tool_name;
    }
  }

  // Model strategy
  const modelStrategy = ctx.model ?? 'unknown';

  // Average turns (prompts)
  const avgTurns = ctx.promptTexts.length;

  // Duration in minutes
  const avgDurationMinutes = Math.round(ctx.durationMs / 60_000);

  // Read before edit
  const readBeforeEdit = ctx.distinctFilesEdited.size > 0 &&
    ctx.readBeforeEditFiles.size / ctx.distinctFilesEdited.size >= 0.8;

  // Test after edit
  const editEvents = ctx.events.filter(e => e.tool_name === 'Edit' || e.tool_name === 'Write');
  const testEvents = ctx.events.filter(e => {
    if (e.tool_name !== 'Bash') return false;
    try {
      const input = JSON.parse(e.tool_input ?? '{}');
      return /\b(test|jest|vitest|pytest)\b/i.test(input.command ?? '');
    } catch { return false; }
  });
  const testAfterEdit = editEvents.length > 0 && testEvents.some(t => {
    const lastEdit = editEvents[editEvents.length - 1];
    return t.created_at > lastEdit.created_at;
  });

  // Subagents
  const usedSubagents = ctx.agentStartCount > 0;

  return {
    toolSequence: toolSequence.slice(0, 50), // Cap to avoid huge arrays
    modelStrategy,
    avgTurns,
    avgDurationMinutes,
    readBeforeEdit,
    testAfterEdit,
    usedSubagents,
    compactionCount: ctx.compactionCount,
  };
}
