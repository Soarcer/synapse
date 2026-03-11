// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bernhard

import initSqlJs, { type Database as SqlJsDatabase } from 'sql.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { logger } from './lib/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Env var resolution with deprecation warning
const envDbPath = (() => {
  if (process.env.SYNAPSE_DB_PATH) return process.env.SYNAPSE_DB_PATH;
  if (process.env.AGENTVIZ_DB_PATH) {
    logger.warn('AGENTVIZ_DB_PATH is deprecated, use SYNAPSE_DB_PATH instead');
    return process.env.AGENTVIZ_DB_PATH;
  }
  return undefined;
})();

const DB_PATH = envDbPath ? path.resolve(envDbPath) : path.join(__dirname, '..', 'synapse.db');

let db: SqlJsDatabase;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let lastSaveTime = 0;
const MAX_SAVE_DELAY_MS = 5000; // Force save after 5s under continuous writes

// ─── Persistence ──────────────────────────────────────────────────────
// sql.js runs single-threaded; all queries are synchronous against the
// in-memory WASM database.  `scheduleSave()` debounces disk persistence
// via `db.export()` → `fs.writeFileSync()`.  Under continuous writes the
// debounce could delay indefinitely, so we force a save after 5 seconds.

function scheduleSave(): void {
  const now = Date.now();
  const sinceLast = now - lastSaveTime;

  // Force immediate save if too long since last save
  if (lastSaveTime > 0 && sinceLast >= MAX_SAVE_DELAY_MS) {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    performSave();
    return;
  }

  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    performSave();
  }, 1000);
}

function performSave(): void {
  try {
    const data = db.export();
    const dir = path.dirname(DB_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(DB_PATH, Buffer.from(data));
    lastSaveTime = Date.now();
  } catch (err) {
    logger.error({ err }, 'Failed to save database');
  }
}

function saveNow(): void {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  performSave();
}

// ─── Initialization ──────────────────────────────────────────────────

export async function initDb(): Promise<void> {
  // Auto-migrate agentviz.db → synapse.db if needed
  if (!envDbPath) {
    const oldDb = path.join(__dirname, '..', 'agentviz.db');
    const newDb = path.join(__dirname, '..', 'synapse.db');
    if (!fs.existsSync(newDb) && fs.existsSync(oldDb)) {
      logger.info('Migrating agentviz.db to synapse.db');
      fs.renameSync(oldDb, newDb);
      for (const suffix of ['-wal', '-shm']) {
        const oldFile = oldDb + suffix;
        if (fs.existsSync(oldFile)) {
          try {
            fs.unlinkSync(oldFile);
          } catch {
            /* ignore */
          }
        }
      }
      logger.info('DB migration complete');
    }
  }

  const SQL = await initSqlJs();

  // Load existing database or create new one
  if (fs.existsSync(DB_PATH)) {
    const buffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(buffer);
  } else {
    db = new SQL.Database();
  }

  // Schema
  db.run(`
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id TEXT UNIQUE NOT NULL,
      session_id TEXT NOT NULL,
      hook_event_name TEXT NOT NULL,
      event_type TEXT NOT NULL,
      agent_id TEXT,
      agent_type TEXT,
      parent_agent_id TEXT,
      tool_name TEXT,
      tool_use_id TEXT,
      tool_input TEXT,
      tool_response TEXT,
      status TEXT,
      error TEXT,
      token_input INTEGER,
      token_output INTEGER,
      duration_ms INTEGER,
      vendor TEXT,
      cwd TEXT,
      raw_payload TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )
  `);

  db.run('CREATE INDEX IF NOT EXISTS idx_events_session ON events(session_id)');
  db.run('CREATE INDEX IF NOT EXISTS idx_events_agent ON events(agent_id)');
  db.run('CREATE INDEX IF NOT EXISTS idx_events_type ON events(event_type)');
  db.run('CREATE INDEX IF NOT EXISTS idx_events_time ON events(created_at)');
  db.run('CREATE INDEX IF NOT EXISTS idx_events_session_time ON events(session_id, created_at)');
  db.run('CREATE INDEX IF NOT EXISTS idx_events_session_type ON events(session_id, event_type)');

  // Migration: add vendor column to existing databases
  try {
    db.run('ALTER TABLE events ADD COLUMN vendor TEXT');
  } catch {
    /* column already exists */
  }
  // Migration: add cwd column to existing databases
  try {
    db.run('ALTER TABLE events ADD COLUMN cwd TEXT');
  } catch {
    /* column already exists */
  }

  db.run('CREATE INDEX IF NOT EXISTS idx_events_vendor ON events(vendor)');
  db.run('CREATE INDEX IF NOT EXISTS idx_events_cwd ON events(cwd)');
  db.run('CREATE INDEX IF NOT EXISTS idx_events_tool_use_id ON events(tool_use_id)');

  // Migration: add model column to existing databases
  try {
    db.run('ALTER TABLE events ADD COLUMN model TEXT');
  } catch {
    /* column already exists */
  }
  db.run('CREATE INDEX IF NOT EXISTS idx_events_model ON events(model)');

  // ── Materialized session summary for O(1) listSessions ──────────
  db.run(`
    CREATE TABLE IF NOT EXISTS session_summary (
      session_id TEXT PRIMARY KEY,
      first_event INTEGER NOT NULL,
      last_event INTEGER NOT NULL,
      event_count INTEGER NOT NULL DEFAULT 0,
      tool_count INTEGER NOT NULL DEFAULT 0,
      total_tokens INTEGER NOT NULL DEFAULT 0,
      model TEXT,
      cwd TEXT,
      has_ended INTEGER NOT NULL DEFAULT 0
    )
  `);

  // ── Analytics rollup tables ──────────────────────────────────────
  db.run(`
    CREATE TABLE IF NOT EXISTS analytics_daily (
      date TEXT NOT NULL,
      cwd TEXT,
      model TEXT,
      vendor TEXT,
      total_events INTEGER DEFAULT 0,
      total_sessions INTEGER DEFAULT 0,
      total_input_tokens INTEGER DEFAULT 0,
      total_output_tokens INTEGER DEFAULT 0,
      total_cache_read_tokens INTEGER DEFAULT 0,
      total_cache_creation_tokens INTEGER DEFAULT 0,
      total_cost_usd REAL DEFAULT 0,
      total_tool_calls INTEGER DEFAULT 0,
      total_errors INTEGER DEFAULT 0,
      total_compactions INTEGER DEFAULT 0,
      sum_latency_ms INTEGER DEFAULT 0,
      count_latency INTEGER DEFAULT 0,
      min_latency_ms INTEGER,
      max_latency_ms INTEGER,
      PRIMARY KEY (date, cwd, model)
    )
  `);
  db.run('CREATE INDEX IF NOT EXISTS idx_daily_date ON analytics_daily(date)');
  db.run('CREATE INDEX IF NOT EXISTS idx_daily_cwd ON analytics_daily(cwd)');

  db.run(`
    CREATE TABLE IF NOT EXISTS analytics_tool_daily (
      date TEXT NOT NULL,
      cwd TEXT,
      tool_name TEXT NOT NULL,
      call_count INTEGER DEFAULT 0,
      error_count INTEGER DEFAULT 0,
      total_duration_ms INTEGER DEFAULT 0,
      avg_duration_ms REAL DEFAULT 0,
      PRIMARY KEY (date, cwd, tool_name)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS price_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      model TEXT NOT NULL,
      vendor TEXT NOT NULL,
      effective_from INTEGER NOT NULL,
      input_per_1m REAL NOT NULL,
      cached_input_per_1m REAL NOT NULL,
      output_per_1m REAL NOT NULL,
      source TEXT DEFAULT 'default',
      created_at INTEGER NOT NULL
    )
  `);
  db.run('CREATE INDEX IF NOT EXISTS idx_price_model ON price_history(model, effective_from)');

  // ── Badges table ──────────────────────────────────────────────────
  db.run(`
    CREATE TABLE IF NOT EXISTS badges_earned (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      badge_id TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      icon TEXT NOT NULL,
      category TEXT NOT NULL,
      earned_at INTEGER NOT NULL
    )
  `);

  // ── Coaching tables ────────────────────────────────────────────────
  db.run(`
    CREATE TABLE IF NOT EXISTS coaching_report_cards (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL UNIQUE,
      computed_at INTEGER NOT NULL,
      overall_score INTEGER NOT NULL,
      dimension_scores TEXT NOT NULL,
      detector_results TEXT NOT NULL,
      summary TEXT NOT NULL
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS coaching_nudges (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      nudge_id TEXT NOT NULL,
      detector_id TEXT NOT NULL,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      recommendation TEXT,
      severity TEXT NOT NULL,
      fired_at INTEGER NOT NULL,
      dismissed INTEGER DEFAULT 0,
      UNIQUE(session_id, nudge_id)
    )
  `);
  db.run('CREATE INDEX IF NOT EXISTS idx_nudges_session ON coaching_nudges(session_id)');

  db.run(`
    CREATE TABLE IF NOT EXISTS coaching_playbooks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      category TEXT NOT NULL,
      source_session_id TEXT,
      pattern TEXT NOT NULL,
      tags TEXT,
      score INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);

  // ── Nudge rule configuration table ─────────────────────────────────
  db.run(`
    CREATE TABLE IF NOT EXISTS nudge_rule_config (
      rule_id TEXT PRIMARY KEY,
      enabled INTEGER DEFAULT 1,
      severity TEXT,
      cooldown_ms INTEGER,
      options TEXT,
      suppressed INTEGER DEFAULT 0,
      updated_at INTEGER NOT NULL
    )
  `);

  // ── Settings table ──────────────────────────────────────────────────
  db.run(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);

  // ── AI coaching cache table ────────────────────────────────────────
  db.run(`
    CREATE TABLE IF NOT EXISTS ai_coaching_cache (
      cache_key TEXT PRIMARY KEY,
      method TEXT NOT NULL,
      session_id TEXT,
      content_hash TEXT NOT NULL,
      response TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    )
  `);
  db.run('CREATE INDEX IF NOT EXISTS idx_ai_cache_expires ON ai_coaching_cache(expires_at)');

  // ── Transcript index table ──────────────────────────────────────
  db.run(`
    CREATE TABLE IF NOT EXISTS transcript_index (
      session_id        TEXT PRIMARY KEY,
      project_hash      TEXT NOT NULL,
      transcript_path   TEXT NOT NULL,
      started_at        INTEGER,
      ended_at          INTEGER,
      model             TEXT,
      permission_mode   TEXT,
      git_branch        TEXT,
      slug              TEXT,
      total_turns       INTEGER DEFAULT 0,
      total_tool_calls  INTEGER DEFAULT 0,
      estimated_cost_usd REAL DEFAULT 0,
      total_input_tokens  INTEGER DEFAULT 0,
      total_output_tokens INTEGER DEFAULT 0,
      file_size_bytes   INTEGER DEFAULT 0,
      scanned_at        INTEGER NOT NULL
    )
  `);
  db.run(
    'CREATE INDEX IF NOT EXISTS idx_transcript_index_project ON transcript_index(project_hash)',
  );
  db.run(
    'CREATE INDEX IF NOT EXISTS idx_transcript_index_started ON transcript_index(started_at DESC)',
  );

  logger.info({ path: DB_PATH }, 'Database initialized');
}

// ─── Query Helpers ───────────────────────────────────────────────────

function queryAll(sql: string, params?: unknown[]): Record<string, unknown>[] {
  const stmt = db.prepare(sql);
  if (params) stmt.bind(params as unknown[]);
  const results: Record<string, unknown>[] = [];
  while (stmt.step()) {
    results.push(stmt.getAsObject() as Record<string, unknown>);
  }
  stmt.free();
  return results;
}

function queryGet(sql: string, params?: unknown[]): Record<string, unknown> | undefined {
  const results = queryAll(sql, params);
  return results[0];
}

function execute(sql: string, params?: unknown[]): number {
  db.run(sql, params as unknown[]);
  return db.getRowsModified();
}

// ─── Exported Helpers ────────────────────────────────────────────────

export interface EventRow {
  id: number;
  event_id: string;
  session_id: string;
  hook_event_name: string;
  event_type: string;
  agent_id: string | null;
  agent_type: string | null;
  parent_agent_id: string | null;
  tool_name: string | null;
  tool_use_id: string | null;
  tool_input: string | null;
  tool_response: string | null;
  status: string | null;
  error: string | null;
  token_input: number | null;
  token_output: number | null;
  duration_ms: number | null;
  model: string | null;
  vendor: string | null;
  cwd: string | null;
  raw_payload: string;
  created_at: number;
}

export function insertEvent(params: {
  event_id: string;
  session_id: string;
  hook_event_name: string;
  event_type: string;
  agent_id?: string | null;
  agent_type?: string | null;
  parent_agent_id?: string | null;
  tool_name?: string | null;
  tool_use_id?: string | null;
  tool_input?: string | null;
  tool_response?: string | null;
  status?: string | null;
  error?: string | null;
  token_input?: number | null;
  token_output?: number | null;
  duration_ms?: number | null;
  model?: string | null;
  vendor?: string | null;
  cwd?: string | null;
  raw_payload: string;
  created_at: number;
}): void {
  execute(
    `
    INSERT INTO events (
      event_id, session_id, hook_event_name, event_type,
      agent_id, agent_type, parent_agent_id,
      tool_name, tool_use_id, tool_input, tool_response,
      status, error, token_input, token_output, duration_ms,
      model, vendor, cwd, raw_payload, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
    [
      params.event_id,
      params.session_id,
      params.hook_event_name,
      params.event_type,
      params.agent_id ?? null,
      params.agent_type ?? null,
      params.parent_agent_id ?? null,
      params.tool_name ?? null,
      params.tool_use_id ?? null,
      params.tool_input ?? null,
      params.tool_response ?? null,
      params.status ?? null,
      params.error ?? null,
      params.token_input ?? null,
      params.token_output ?? null,
      params.duration_ms ?? null,
      params.model ?? null,
      params.vendor ?? null,
      params.cwd ?? null,
      params.raw_payload,
      params.created_at,
    ],
  );
  scheduleSave();
}

export function upsertSessionSummary(params: {
  session_id: string;
  created_at: number;
  event_type: string;
  token_input?: number | null;
  token_output?: number | null;
  model?: string | null;
  cwd?: string | null;
}): void {
  const isTool = ['tool_start', 'tool_end', 'tool_error'].includes(params.event_type);
  const tokens = (params.token_input ?? 0) + (params.token_output ?? 0);
  const isEnd = params.event_type === 'session_end' ? 1 : 0;

  execute(
    `
    INSERT INTO session_summary (session_id, first_event, last_event, event_count, tool_count, total_tokens, model, cwd, has_ended)
    VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?)
    ON CONFLICT(session_id) DO UPDATE SET
      first_event = MIN(session_summary.first_event, excluded.first_event),
      last_event = MAX(session_summary.last_event, excluded.last_event),
      event_count = session_summary.event_count + 1,
      tool_count = session_summary.tool_count + excluded.tool_count,
      total_tokens = session_summary.total_tokens + excluded.total_tokens,
      model = COALESCE(excluded.model, session_summary.model),
      cwd = COALESCE(excluded.cwd, session_summary.cwd),
      has_ended = MAX(session_summary.has_ended, excluded.has_ended)
  `,
    [
      params.session_id,
      params.created_at,
      params.created_at,
      isTool ? 1 : 0,
      tokens,
      params.model ?? null,
      params.cwd ?? null,
      isEnd,
    ],
  );
  scheduleSave();
}

export function getEventsBySession(sessionId: string, limit = 10_000): EventRow[] {
  return queryAll('SELECT * FROM events WHERE session_id = ? ORDER BY created_at ASC LIMIT ?', [
    sessionId,
    limit,
  ]) as unknown as EventRow[];
}

export function getEventsByAgent(agentId: string, limit = 10_000): EventRow[] {
  return queryAll('SELECT * FROM events WHERE agent_id = ? ORDER BY created_at ASC LIMIT ?', [
    agentId,
    limit,
  ]) as unknown as EventRow[];
}

export function queryEvents(params: {
  sessionId?: string;
  agentId?: string;
  type?: string;
  cwd?: string;
  from?: number;
  to?: number;
  limit?: number;
  offset?: number;
}): EventRow[] {
  const limit = Math.min(Math.max(params.limit ?? 100, 1), 2000);
  const offset = Math.min(Math.max(params.offset ?? 0, 0), 100000);

  const clauses: string[] = [];
  const values: unknown[] = [];

  if (params.cwd) {
    clauses.push('cwd = ?');
    values.push(params.cwd);
  }
  if (params.sessionId) {
    clauses.push('session_id = ?');
    values.push(params.sessionId);
  }
  if (params.agentId) {
    clauses.push('agent_id = ?');
    values.push(params.agentId);
  }
  if (params.type) {
    clauses.push('event_type = ?');
    values.push(params.type);
  }
  if (params.from != null) {
    clauses.push('created_at >= ?');
    values.push(params.from);
  }
  if (params.to != null) {
    clauses.push('created_at <= ?');
    values.push(params.to);
  }

  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  const order = params.sessionId || params.agentId ? 'ASC' : 'DESC';

  values.push(limit, offset);
  return queryAll(
    `SELECT * FROM events ${where} ORDER BY created_at ${order} LIMIT ? OFFSET ?`,
    values,
  ) as unknown as EventRow[];
}

// ─── Delete Helpers ─────────────────────────────────────────────────

export function deleteEventsBySession(sessionId: string): number {
  const changes = execute('DELETE FROM events WHERE session_id = ?', [sessionId]);
  execute('DELETE FROM session_summary WHERE session_id = ?', [sessionId]);
  scheduleSave();
  return changes;
}

export function deleteAllEvents(): number {
  const changes = execute('DELETE FROM events');
  execute('DELETE FROM session_summary');
  scheduleSave();
  return changes;
}

export function deleteAllPlaybooks(): number {
  const changes = execute('DELETE FROM coaching_playbooks');
  scheduleSave();
  return changes;
}

export interface SessionSummary {
  session_id: string;
  first_event: number;
  last_event: number;
  event_count: number;
  tool_count: number;
  total_tokens: number;
  model: string | null;
  cwd: string | null;
  has_ended: number; // 0 or 1 (SQLite boolean)
}

export function listSessions(limit = 500, cwd?: string): SessionSummary[] {
  const clauses: string[] = [];
  const values: unknown[] = [];

  if (cwd) {
    clauses.push('cwd = ?');
    values.push(cwd);
  }

  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  values.push(limit);

  // Try materialized summary first
  const summaries = queryAll(
    `SELECT session_id, first_event, last_event, event_count, tool_count, total_tokens, model, cwd, has_ended
     FROM session_summary ${where} ORDER BY last_event DESC LIMIT ?`,
    values,
  ) as unknown as SessionSummary[];

  if (summaries.length > 0) return summaries;

  // Fallback: legacy GROUP BY for databases that haven't been backfilled
  return queryAll(
    `SELECT session_id,
      MIN(created_at) as first_event,
      MAX(created_at) as last_event,
      COUNT(*) as event_count,
      SUM(CASE WHEN event_type IN ('tool_start','tool_end','tool_error') THEN 1 ELSE 0 END) as tool_count,
      COALESCE(SUM(COALESCE(token_input,0) + COALESCE(token_output,0)), 0) as total_tokens,
      MAX(model) as model,
      MAX(cwd) as cwd,
      MAX(CASE WHEN event_type = 'session_end' THEN 1 ELSE 0 END) as has_ended
     FROM events ${where} GROUP BY session_id ORDER BY last_event DESC LIMIT ?`,
    values,
  ) as unknown as SessionSummary[];
}

// ─── Database Stats (for health check) ──────────────────────────────

export interface DbStats {
  totalEvents: number;
  totalSessions: number;
  dbSizeBytes: number;
}

export function getDbStats(): DbStats {
  const eventCount = queryGet('SELECT COUNT(*) as count FROM events') as
    | { count: number }
    | undefined;
  const sessionCount = queryGet('SELECT COUNT(DISTINCT session_id) as count FROM events') as
    | { count: number }
    | undefined;

  let dbSizeBytes = 0;
  try {
    if (fs.existsSync(DB_PATH)) {
      dbSizeBytes = fs.statSync(DB_PATH).size;
    }
  } catch {
    /* ignore */
  }

  return {
    totalEvents: eventCount?.count ?? 0,
    totalSessions: sessionCount?.count ?? 0,
    dbSizeBytes,
  };
}

// ─── Analytics Query Helpers ─────────────────────────────────────────

export function analyticsQueryAll(sql: string, params?: unknown[]): Record<string, unknown>[] {
  return queryAll(sql, params);
}

export function analyticsQueryGet(
  sql: string,
  params?: unknown[],
): Record<string, unknown> | undefined {
  return queryGet(sql, params);
}

export function analyticsExecute(sql: string, params?: unknown[]): number {
  const result = execute(sql, params);
  scheduleSave();
  return result;
}

// ─── Daily Rollup Update ─────────────────────────────────────────────

export function updateDailyRollup(event: {
  created_at: number;
  cwd?: string | null;
  model?: string | null;
  vendor?: string | null;
  event_type: string;
  token_input?: number | null;
  token_output?: number | null;
  duration_ms?: number | null;
  tool_name?: string | null;
  status?: string | null;
  cost_usd?: number;
}): void {
  const date = new Date(event.created_at).toISOString().split('T')[0];
  const cwd = event.cwd ?? '__all__';
  const model = event.model ?? '__all__';
  const vendor = event.vendor ?? null;

  const isToolEvent =
    event.event_type === 'tool_start' ||
    event.event_type === 'tool_end' ||
    event.event_type === 'tool_error';
  const isError = event.event_type === 'tool_error' || event.status === 'error';
  const isCompaction = event.event_type === 'compact';
  const isSessionStart = event.event_type === 'session_start';

  const inputTokens = event.token_input ?? 0;
  const outputTokens = event.token_output ?? 0;
  const latencyMs = event.duration_ms ?? 0;
  const costUsd = event.cost_usd ?? 0;

  // Upsert daily rollup
  execute(
    `
    INSERT INTO analytics_daily (date, cwd, model, vendor, total_events, total_sessions,
      total_input_tokens, total_output_tokens, total_cost_usd, total_tool_calls,
      total_errors, total_compactions, sum_latency_ms, count_latency, min_latency_ms, max_latency_ms)
    VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (date, cwd, model)
    DO UPDATE SET
      total_events = total_events + 1,
      total_sessions = total_sessions + excluded.total_sessions,
      total_input_tokens = total_input_tokens + excluded.total_input_tokens,
      total_output_tokens = total_output_tokens + excluded.total_output_tokens,
      total_cost_usd = total_cost_usd + excluded.total_cost_usd,
      total_tool_calls = total_tool_calls + excluded.total_tool_calls,
      total_errors = total_errors + excluded.total_errors,
      total_compactions = total_compactions + excluded.total_compactions,
      sum_latency_ms = sum_latency_ms + excluded.sum_latency_ms,
      count_latency = count_latency + excluded.count_latency,
      min_latency_ms = MIN(COALESCE(min_latency_ms, excluded.min_latency_ms), excluded.min_latency_ms),
      max_latency_ms = MAX(COALESCE(max_latency_ms, excluded.max_latency_ms), excluded.max_latency_ms)
  `,
    [
      date,
      cwd,
      model,
      vendor,
      isSessionStart ? 1 : 0,
      inputTokens,
      outputTokens,
      costUsd,
      isToolEvent ? 1 : 0,
      isError ? 1 : 0,
      isCompaction ? 1 : 0,
      latencyMs,
      latencyMs > 0 ? 1 : 0,
      latencyMs > 0 ? latencyMs : null,
      latencyMs > 0 ? latencyMs : null,
    ],
  );

  // Update tool-level rollup
  if (isToolEvent && event.tool_name) {
    const durationMs = event.duration_ms ?? 0;
    const isToolError = event.event_type === 'tool_error' ? 1 : 0;

    execute(
      `
      INSERT INTO analytics_tool_daily (date, cwd, tool_name, call_count, error_count, total_duration_ms, avg_duration_ms)
      VALUES (?, ?, ?, 1, ?, ?, ?)
      ON CONFLICT (date, cwd, tool_name)
      DO UPDATE SET
        call_count = call_count + 1,
        error_count = error_count + excluded.error_count,
        total_duration_ms = total_duration_ms + excluded.total_duration_ms,
        avg_duration_ms = CAST((total_duration_ms + excluded.total_duration_ms) AS REAL) / (call_count + 1)
    `,
      [date, cwd, event.tool_name, isToolError, durationMs, durationMs],
    );
    // Note: `cwd` already uses '__all__' sentinel from above
  }

  scheduleSave();
}

// ─── Price History Helpers ────────────────────────────────────────────

export interface PriceHistoryRow {
  id: number;
  model: string;
  vendor: string;
  effective_from: number;
  input_per_1m: number;
  cached_input_per_1m: number;
  output_per_1m: number;
  source: string;
  created_at: number;
}

export function getAllPriceHistory(): PriceHistoryRow[] {
  return queryAll(
    'SELECT * FROM price_history ORDER BY model, effective_from DESC',
  ) as unknown as PriceHistoryRow[];
}

export function insertPriceHistory(params: {
  model: string;
  vendor: string;
  effective_from: number;
  input_per_1m: number;
  cached_input_per_1m: number;
  output_per_1m: number;
  source?: string;
}): number {
  execute(
    `
    INSERT INTO price_history (model, vendor, effective_from, input_per_1m, cached_input_per_1m, output_per_1m, source, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `,
    [
      params.model,
      params.vendor,
      params.effective_from,
      params.input_per_1m,
      params.cached_input_per_1m,
      params.output_per_1m,
      params.source ?? 'user',
      Date.now(),
    ],
  );
  scheduleSave();
  return db.getRowsModified();
}

export function deletePriceHistory(id: number): number {
  const result = execute('DELETE FROM price_history WHERE id = ?', [id]);
  scheduleSave();
  return result;
}

// ─── Event Retention / Pruning ────────────────────────────────────────

export function pruneOldEvents(maxAgeDays: number): number {
  const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
  const changes = execute('DELETE FROM events WHERE created_at < ?', [cutoff]);
  if (changes > 0) {
    logger.info({ pruned: changes, maxAgeDays }, 'Pruned old events');
    scheduleSave();
  }
  return changes;
}

export function pruneExcessEvents(maxCount: number): number {
  const countRow = queryGet('SELECT COUNT(*) as count FROM events') as
    | { count: number }
    | undefined;
  const total = countRow?.count ?? 0;
  if (total <= maxCount) return 0;
  const excess = total - maxCount;
  const changes = execute(
    'DELETE FROM events WHERE id IN (SELECT id FROM events ORDER BY created_at ASC LIMIT ?)',
    [excess],
  );
  if (changes > 0) {
    logger.info({ pruned: changes, maxCount, total }, 'Pruned excess events');
    scheduleSave();
  }
  return changes;
}

const PRUNE_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

export function startPruneTimer(): ReturnType<typeof setInterval> {
  const maxAgeDays = parseInt(process.env.SYNAPSE_MAX_EVENT_AGE_DAYS || '30', 10);
  const maxEvents = parseInt(process.env.SYNAPSE_MAX_EVENTS || '100000', 10);

  const timer = setInterval(() => {
    pruneOldEvents(maxAgeDays);
    pruneExcessEvents(maxEvents);
  }, PRUNE_INTERVAL_MS);

  if (timer.unref) timer.unref();
  return timer;
}

// ─── Batch Query for Snapshot Export ──────────────────────────────────

export function getEventsBySessionIds(sessionIds: string[]): Map<string, EventRow[]> {
  if (sessionIds.length === 0) return new Map();
  const placeholders = sessionIds.map(() => '?').join(',');
  const rows = queryAll(
    `SELECT * FROM events WHERE session_id IN (${placeholders}) ORDER BY session_id, created_at ASC`,
    sessionIds,
  ) as unknown as EventRow[];
  const grouped = new Map<string, EventRow[]>();
  for (const row of rows) {
    const list = grouped.get(row.session_id);
    if (list) list.push(row);
    else grouped.set(row.session_id, [row]);
  }
  return grouped;
}

// ─── Coaching: Report Card Helpers ────────────────────────────────────

export interface ReportCardRow {
  id: number;
  session_id: string;
  computed_at: number;
  overall_score: number;
  dimension_scores: string;
  detector_results: string;
  summary: string;
}

export function getCachedReportCard(sessionId: string): ReportCardRow | undefined {
  return queryGet('SELECT * FROM coaching_report_cards WHERE session_id = ?', [
    sessionId,
  ]) as unknown as ReportCardRow | undefined;
}

export function upsertReportCard(params: {
  session_id: string;
  computed_at: number;
  overall_score: number;
  dimension_scores: string;
  detector_results: string;
  summary: string;
}): void {
  execute(
    `
    INSERT INTO coaching_report_cards (session_id, computed_at, overall_score, dimension_scores, detector_results, summary)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT (session_id) DO UPDATE SET
      computed_at = excluded.computed_at,
      overall_score = excluded.overall_score,
      dimension_scores = excluded.dimension_scores,
      detector_results = excluded.detector_results,
      summary = excluded.summary
  `,
    [
      params.session_id,
      params.computed_at,
      params.overall_score,
      params.dimension_scores,
      params.detector_results,
      params.summary,
    ],
  );
  scheduleSave();
}

export function getReportCardsInRange(from: number, to: number): ReportCardRow[] {
  return queryAll(
    'SELECT * FROM coaching_report_cards WHERE computed_at >= ? AND computed_at <= ? ORDER BY computed_at DESC',
    [from, to],
  ) as unknown as ReportCardRow[];
}

export function getRecentReportCards(limit: number): ReportCardRow[] {
  return queryAll(
    'SELECT session_id, computed_at, overall_score, dimension_scores FROM coaching_report_cards ORDER BY computed_at DESC LIMIT ?',
    [limit],
  ) as unknown as ReportCardRow[];
}

// ─── Coaching: Nudge Helpers ─────────────────────────────────────────

export interface NudgeRow {
  id: number;
  session_id: string;
  nudge_id: string;
  detector_id: string;
  title: string;
  message: string;
  recommendation: string | null;
  severity: string;
  fired_at: number;
  dismissed: number;
}

export function insertNudge(params: {
  session_id: string;
  nudge_id: string;
  detector_id: string;
  title: string;
  message: string;
  recommendation?: string;
  severity: string;
  fired_at: number;
}): void {
  execute(
    `
    INSERT OR IGNORE INTO coaching_nudges (session_id, nudge_id, detector_id, title, message, recommendation, severity, fired_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `,
    [
      params.session_id,
      params.nudge_id,
      params.detector_id,
      params.title,
      params.message,
      params.recommendation ?? null,
      params.severity,
      params.fired_at,
    ],
  );
  scheduleSave();
}

export function getNudgesBySession(sessionId: string): NudgeRow[] {
  return queryAll('SELECT * FROM coaching_nudges WHERE session_id = ? ORDER BY fired_at DESC', [
    sessionId,
  ]) as unknown as NudgeRow[];
}

export function hasNudgeFired(sessionId: string, detectorId: string, sinceMs: number): boolean {
  const cutoff = Date.now() - sinceMs;
  const row = queryGet(
    'SELECT id FROM coaching_nudges WHERE session_id = ? AND detector_id = ? AND fired_at > ?',
    [sessionId, detectorId, cutoff],
  );
  return row !== undefined;
}

export function dismissNudge(sessionId: string, nudgeId: string): number {
  const result = execute(
    'UPDATE coaching_nudges SET dismissed = 1 WHERE session_id = ? AND nudge_id = ?',
    [sessionId, nudgeId],
  );
  scheduleSave();
  return result;
}

export interface NudgeStatsRow {
  detector_id: string;
  fire_count: number;
  dismiss_count: number;
}

export function getNudgeStats(): {
  byDetector: NudgeStatsRow[];
  totalFired: number;
  totalDismissed: number;
} {
  const byDetector = queryAll(`
    SELECT detector_id,
           COUNT(*) as fire_count,
           SUM(CASE WHEN dismissed = 1 THEN 1 ELSE 0 END) as dismiss_count
    FROM coaching_nudges
    GROUP BY detector_id
    ORDER BY fire_count DESC
  `) as unknown as NudgeStatsRow[];

  const totals = queryGet(`
    SELECT COUNT(*) as total_fired,
           SUM(CASE WHEN dismissed = 1 THEN 1 ELSE 0 END) as total_dismissed
    FROM coaching_nudges
  `) as { total_fired: number; total_dismissed: number } | undefined;

  return {
    byDetector,
    totalFired: totals?.total_fired ?? 0,
    totalDismissed: totals?.total_dismissed ?? 0,
  };
}

// ─── Coaching: Rule Config Helpers ───────────────────────────────────

export interface RuleConfigRow {
  rule_id: string;
  enabled: number;
  severity: string | null;
  cooldown_ms: number | null;
  options: string | null;
  suppressed: number;
  updated_at: number;
}

export function getAllRuleConfigs(): RuleConfigRow[] {
  return queryAll('SELECT * FROM nudge_rule_config') as unknown as RuleConfigRow[];
}

export function getRuleConfig(ruleId: string): RuleConfigRow | undefined {
  return queryGet('SELECT * FROM nudge_rule_config WHERE rule_id = ?', [ruleId]) as
    | RuleConfigRow
    | undefined;
}

export function upsertRuleConfig(params: {
  rule_id: string;
  enabled?: number;
  severity?: string | null;
  cooldown_ms?: number | null;
  options?: string | null;
  suppressed?: number;
}): void {
  const existing = getRuleConfig(params.rule_id);
  const now = Date.now();

  if (existing) {
    const fields: string[] = [];
    const values: unknown[] = [];

    if (params.enabled !== undefined) {
      fields.push('enabled = ?');
      values.push(params.enabled);
    }
    if (params.severity !== undefined) {
      fields.push('severity = ?');
      values.push(params.severity);
    }
    if (params.cooldown_ms !== undefined) {
      fields.push('cooldown_ms = ?');
      values.push(params.cooldown_ms);
    }
    if (params.options !== undefined) {
      fields.push('options = ?');
      values.push(params.options);
    }
    if (params.suppressed !== undefined) {
      fields.push('suppressed = ?');
      values.push(params.suppressed);
    }

    if (fields.length > 0) {
      fields.push('updated_at = ?');
      values.push(now);
      values.push(params.rule_id);
      execute(`UPDATE nudge_rule_config SET ${fields.join(', ')} WHERE rule_id = ?`, values);
    }
  } else {
    execute(
      `INSERT INTO nudge_rule_config (rule_id, enabled, severity, cooldown_ms, options, suppressed, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        params.rule_id,
        params.enabled ?? 1,
        params.severity ?? null,
        params.cooldown_ms ?? null,
        params.options ?? null,
        params.suppressed ?? 0,
        now,
      ],
    );
  }
  scheduleSave();
}

export function resetAllRuleConfigs(): void {
  execute('DELETE FROM nudge_rule_config', []);
  scheduleSave();
}

// ─── Coaching: Playbook Helpers ──────────────────────────────────────

export interface PlaybookRow {
  id: number;
  name: string;
  description: string;
  category: string;
  source_session_id: string | null;
  pattern: string;
  tags: string | null;
  score: number | null;
  created_at: number;
  updated_at: number;
}

export function getAllPlaybooks(): PlaybookRow[] {
  return queryAll(
    'SELECT * FROM coaching_playbooks ORDER BY updated_at DESC',
  ) as unknown as PlaybookRow[];
}

export function getPlaybookById(id: number): PlaybookRow | undefined {
  return queryGet('SELECT * FROM coaching_playbooks WHERE id = ?', [id]) as unknown as
    | PlaybookRow
    | undefined;
}

export function insertPlaybook(params: {
  name: string;
  description: string;
  category: string;
  source_session_id?: string;
  pattern: string;
  tags?: string;
  score?: number;
}): number {
  const now = Date.now();
  execute(
    `
    INSERT INTO coaching_playbooks (name, description, category, source_session_id, pattern, tags, score, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
    [
      params.name,
      params.description,
      params.category,
      params.source_session_id ?? null,
      params.pattern,
      params.tags ?? null,
      params.score ?? null,
      now,
      now,
    ],
  );
  scheduleSave();
  // Return the last inserted ID
  const row = queryGet('SELECT last_insert_rowid() as id');
  return (row as { id: number } | undefined)?.id ?? 0;
}

export function deletePlaybook(id: number): number {
  const result = execute('DELETE FROM coaching_playbooks WHERE id = ?', [id]);
  scheduleSave();
  return result;
}

// ─── Settings Helpers ─────────────────────────────────────────────────

export function getSetting(key: string): string | undefined {
  const row = queryGet('SELECT value FROM settings WHERE key = ?', [key]) as
    | { value: string }
    | undefined;
  return row?.value;
}

export function setSetting(key: string, value: string): void {
  execute(
    'INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at',
    [key, value, Date.now()],
  );
  scheduleSave();
}

export function getAllSettings(): Record<string, string> {
  const rows = queryAll('SELECT key, value FROM settings') as { key: string; value: string }[];
  const result: Record<string, string> = {};
  for (const row of rows) result[row.key] = row.value;
  return result;
}

export function deleteSetting(key: string): number {
  const result = execute('DELETE FROM settings WHERE key = ?', [key]);
  scheduleSave();
  return result;
}

// ─── AI Coaching Cache Helpers ────────────────────────────────────────

export function getAiCacheEntry(cacheKey: string): string | undefined {
  const now = Date.now();
  const row = queryGet(
    'SELECT response FROM ai_coaching_cache WHERE cache_key = ? AND expires_at > ?',
    [cacheKey, now],
  ) as { response: string } | undefined;
  return row?.response;
}

export function setAiCacheEntry(params: {
  cacheKey: string;
  method: string;
  sessionId?: string;
  contentHash: string;
  response: string;
  ttlMs?: number;
}): void {
  const now = Date.now();
  const ttl = params.ttlMs ?? 3_600_000; // 1 hour default
  execute(
    `INSERT INTO ai_coaching_cache (cache_key, method, session_id, content_hash, response, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(cache_key) DO UPDATE SET response = excluded.response, created_at = excluded.created_at, expires_at = excluded.expires_at`,
    [
      params.cacheKey,
      params.method,
      params.sessionId ?? null,
      params.contentHash,
      params.response,
      now,
      now + ttl,
    ],
  );
  scheduleSave();
}

export function pruneAiCache(): number {
  const changes = execute('DELETE FROM ai_coaching_cache WHERE expires_at < ?', [Date.now()]);
  if (changes > 0) scheduleSave();
  return changes;
}

// ─── Transcript Index Helpers ─────────────────────────────────────

export interface TranscriptIndexRow {
  session_id: string;
  project_hash: string;
  transcript_path: string;
  started_at: number | null;
  ended_at: number | null;
  model: string | null;
  permission_mode: string | null;
  git_branch: string | null;
  slug: string | null;
  total_turns: number;
  total_tool_calls: number;
  estimated_cost_usd: number;
  total_input_tokens: number;
  total_output_tokens: number;
  file_size_bytes: number;
  scanned_at: number;
}

export function getTranscriptIndexEntry(sessionId: string): TranscriptIndexRow | undefined {
  return queryGet('SELECT * FROM transcript_index WHERE session_id = ?', [sessionId]) as unknown as
    | TranscriptIndexRow
    | undefined;
}

export function upsertTranscriptIndex(params: TranscriptIndexRow): void {
  execute(
    `
    INSERT INTO transcript_index (
      session_id, project_hash, transcript_path, started_at, ended_at,
      model, permission_mode, git_branch, slug,
      total_turns, total_tool_calls, estimated_cost_usd,
      total_input_tokens, total_output_tokens, file_size_bytes, scanned_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(session_id) DO UPDATE SET
      transcript_path = excluded.transcript_path,
      started_at = excluded.started_at,
      ended_at = excluded.ended_at,
      model = excluded.model,
      permission_mode = excluded.permission_mode,
      git_branch = excluded.git_branch,
      slug = excluded.slug,
      total_turns = excluded.total_turns,
      total_tool_calls = excluded.total_tool_calls,
      estimated_cost_usd = excluded.estimated_cost_usd,
      total_input_tokens = excluded.total_input_tokens,
      total_output_tokens = excluded.total_output_tokens,
      file_size_bytes = excluded.file_size_bytes,
      scanned_at = excluded.scanned_at
  `,
    [
      params.session_id,
      params.project_hash,
      params.transcript_path,
      params.started_at,
      params.ended_at,
      params.model,
      params.permission_mode,
      params.git_branch,
      params.slug,
      params.total_turns,
      params.total_tool_calls,
      params.estimated_cost_usd,
      params.total_input_tokens,
      params.total_output_tokens,
      params.file_size_bytes,
      params.scanned_at,
    ],
  );
  scheduleSave();
}

export function getAllTranscriptIndex(
  limit = 100,
  offset = 0,
): { rows: TranscriptIndexRow[]; total: number } {
  const countRow = queryGet('SELECT COUNT(*) as count FROM transcript_index') as
    | { count: number }
    | undefined;
  const total = countRow?.count ?? 0;
  const rows = queryAll(
    `SELECT * FROM transcript_index
     ORDER BY CASE WHEN started_at IS NULL THEN 1 ELSE 0 END, started_at DESC
     LIMIT ? OFFSET ?`,
    [Math.min(Math.max(limit, 1), 500), Math.max(offset, 0)],
  ) as unknown as TranscriptIndexRow[];
  return { rows, total };
}

export function isLiveSession(sessionId: string): boolean {
  const row = queryGet(
    "SELECT id FROM events WHERE session_id = ? AND event_type = 'session_start' LIMIT 1",
    [sessionId],
  );
  return row !== undefined;
}

// ─── Shutdown ─────────────────────────────────────────────────────────

export function closeDb(): void {
  saveNow();
  try {
    db.close();
  } catch {
    /* already closed */
  }
}
