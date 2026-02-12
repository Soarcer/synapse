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

// ─── Persistence ──────────────────────────────────────────────────────

function scheduleSave(): void {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      const data = db.export();
      const dir = path.dirname(DB_PATH);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(DB_PATH, Buffer.from(data));
    } catch (err) {
      logger.error({ err }, 'Failed to save database');
    }
  }, 1000);
}

function saveNow(): void {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  try {
    const data = db.export();
    const dir = path.dirname(DB_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(DB_PATH, Buffer.from(data));
  } catch (err) {
    logger.error({ err }, 'Failed to save database on shutdown');
  }
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
          try { fs.unlinkSync(oldFile); } catch { /* ignore */ }
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
  try { db.run('ALTER TABLE events ADD COLUMN vendor TEXT'); } catch { /* column already exists */ }
  // Migration: add cwd column to existing databases
  try { db.run('ALTER TABLE events ADD COLUMN cwd TEXT'); } catch { /* column already exists */ }

  db.run('CREATE INDEX IF NOT EXISTS idx_events_vendor ON events(vendor)');
  db.run('CREATE INDEX IF NOT EXISTS idx_events_cwd ON events(cwd)');

  logger.info({ path: DB_PATH }, 'Database initialized');
}

// ─── Query Helpers ───────────────────────────────────────────────────

function queryAll(sql: string, params?: unknown[]): Record<string, unknown>[] {
  const stmt = db.prepare(sql);
  if (params) stmt.bind(params as initSqlJs.BindParams);
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
  db.run(sql, params as initSqlJs.BindParams);
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
  vendor?: string | null;
  cwd?: string | null;
  raw_payload: string;
  created_at: number;
}): void {
  execute(`
    INSERT INTO events (
      event_id, session_id, hook_event_name, event_type,
      agent_id, agent_type, parent_agent_id,
      tool_name, tool_use_id, tool_input, tool_response,
      status, error, token_input, token_output, duration_ms,
      vendor, cwd, raw_payload, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
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
    params.vendor ?? null,
    params.cwd ?? null,
    params.raw_payload,
    params.created_at,
  ]);
  scheduleSave();
}

export function getEventsBySession(sessionId: string): EventRow[] {
  return queryAll(
    'SELECT * FROM events WHERE session_id = ? ORDER BY created_at ASC',
    [sessionId],
  ) as unknown as EventRow[];
}

export function getEventsByAgent(agentId: string): EventRow[] {
  return queryAll(
    'SELECT * FROM events WHERE agent_id = ? ORDER BY created_at ASC',
    [agentId],
  ) as unknown as EventRow[];
}

export function queryEvents(params: {
  sessionId?: string;
  agentId?: string;
  type?: string;
  cwd?: string;
  limit?: number;
  offset?: number;
}): EventRow[] {
  const limit = Math.min(Math.max(params.limit ?? 100, 1), 2000);
  const offset = Math.min(Math.max(params.offset ?? 0, 0), 100000);

  if (params.cwd) {
    return queryAll(
      'SELECT * FROM events WHERE cwd = ? ORDER BY created_at DESC LIMIT ? OFFSET ?',
      [params.cwd, limit, offset],
    ) as unknown as EventRow[];
  }
  if (params.sessionId) {
    return queryAll(
      'SELECT * FROM events WHERE session_id = ? ORDER BY created_at ASC',
      [params.sessionId],
    ) as unknown as EventRow[];
  }
  if (params.agentId) {
    return queryAll(
      'SELECT * FROM events WHERE agent_id = ? ORDER BY created_at ASC',
      [params.agentId],
    ) as unknown as EventRow[];
  }
  if (params.type) {
    return queryAll(
      'SELECT * FROM events WHERE event_type = ? ORDER BY created_at DESC LIMIT ? OFFSET ?',
      [params.type, limit, offset],
    ) as unknown as EventRow[];
  }
  return queryAll(
    'SELECT * FROM events ORDER BY created_at DESC LIMIT ? OFFSET ?',
    [limit, offset],
  ) as unknown as EventRow[];
}

// ─── Delete Helpers ─────────────────────────────────────────────────

export function deleteEventsBySession(sessionId: string): number {
  const changes = execute('DELETE FROM events WHERE session_id = ?', [sessionId]);
  scheduleSave();
  return changes;
}

export function deleteAllEvents(): number {
  const changes = execute('DELETE FROM events');
  scheduleSave();
  return changes;
}

export interface SessionSummary {
  session_id: string;
  first_event: number;
  last_event: number;
  event_count: number;
}

export function listSessions(): SessionSummary[] {
  return queryAll(
    `SELECT session_id, MIN(created_at) as first_event, MAX(created_at) as last_event, COUNT(*) as event_count
     FROM events GROUP BY session_id ORDER BY last_event DESC`,
  ) as unknown as SessionSummary[];
}

// ─── Database Stats (for health check) ──────────────────────────────

export interface DbStats {
  totalEvents: number;
  totalSessions: number;
  dbSizeBytes: number;
}

export function getDbStats(): DbStats {
  const eventCount = queryGet('SELECT COUNT(*) as count FROM events') as { count: number } | undefined;
  const sessionCount = queryGet('SELECT COUNT(DISTINCT session_id) as count FROM events') as { count: number } | undefined;

  let dbSizeBytes = 0;
  try {
    if (fs.existsSync(DB_PATH)) {
      dbSizeBytes = fs.statSync(DB_PATH).size;
    }
  } catch { /* ignore */ }

  return {
    totalEvents: eventCount?.count ?? 0,
    totalSessions: sessionCount?.count ?? 0,
    dbSizeBytes,
  };
}

// ─── Shutdown ─────────────────────────────────────────────────────────

export function closeDb(): void {
  saveNow();
  try { db.close(); } catch { /* already closed */ }
}
