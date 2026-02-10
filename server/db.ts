import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envDbPath = process.env.SYNAPSE_DB_PATH || process.env.AGENTVIZ_DB_PATH;
const DB_PATH = envDbPath ? path.resolve(envDbPath) : path.join(__dirname, 'agentviz.db');

const db = new Database(DB_PATH);

// Enable WAL mode for better concurrent read/write performance
db.pragma('journal_mode = WAL');

// ─── Schema ─────────────────────────────────────────────────────────

db.exec(`
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
    raw_payload TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_events_session ON events(session_id);
  CREATE INDEX IF NOT EXISTS idx_events_agent ON events(agent_id);
  CREATE INDEX IF NOT EXISTS idx_events_type ON events(event_type);
  CREATE INDEX IF NOT EXISTS idx_events_time ON events(created_at);
`);

// ─── Prepared Statements ────────────────────────────────────────────

const insertStmt = db.prepare(`
  INSERT INTO events (
    event_id, session_id, hook_event_name, event_type,
    agent_id, agent_type, parent_agent_id,
    tool_name, tool_use_id, tool_input, tool_response,
    status, error, token_input, token_output, duration_ms,
    raw_payload, created_at
  ) VALUES (
    @event_id, @session_id, @hook_event_name, @event_type,
    @agent_id, @agent_type, @parent_agent_id,
    @tool_name, @tool_use_id, @tool_input, @tool_response,
    @status, @error, @token_input, @token_output, @duration_ms,
    @raw_payload, @created_at
  )
`);

const queryBySessionStmt = db.prepare(
  'SELECT * FROM events WHERE session_id = ? ORDER BY created_at ASC'
);

const queryByAgentStmt = db.prepare(
  'SELECT * FROM events WHERE agent_id = ? ORDER BY created_at ASC'
);

const queryByTypeStmt = db.prepare(
  'SELECT * FROM events WHERE event_type = ? ORDER BY created_at DESC LIMIT ? OFFSET ?'
);

const queryAllStmt = db.prepare(
  'SELECT * FROM events ORDER BY created_at DESC LIMIT ? OFFSET ?'
);

// ─── Exported Helpers ───────────────────────────────────────────────

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
  raw_payload: string;
  created_at: number;
}): void {
  insertStmt.run({
    event_id: params.event_id,
    session_id: params.session_id,
    hook_event_name: params.hook_event_name,
    event_type: params.event_type,
    agent_id: params.agent_id ?? null,
    agent_type: params.agent_type ?? null,
    parent_agent_id: params.parent_agent_id ?? null,
    tool_name: params.tool_name ?? null,
    tool_use_id: params.tool_use_id ?? null,
    tool_input: params.tool_input ?? null,
    tool_response: params.tool_response ?? null,
    status: params.status ?? null,
    error: params.error ?? null,
    token_input: params.token_input ?? null,
    token_output: params.token_output ?? null,
    duration_ms: params.duration_ms ?? null,
    raw_payload: params.raw_payload,
    created_at: params.created_at,
  });
}

export function getEventsBySession(sessionId: string): EventRow[] {
  return queryBySessionStmt.all(sessionId) as EventRow[];
}

export function getEventsByAgent(agentId: string): EventRow[] {
  return queryByAgentStmt.all(agentId) as EventRow[];
}

export function queryEvents(params: {
  sessionId?: string;
  agentId?: string;
  type?: string;
  limit?: number;
  offset?: number;
}): EventRow[] {
  const limit = Math.min(Math.max(params.limit ?? 100, 1), 2000);
  const offset = Math.min(Math.max(params.offset ?? 0, 0), 100000);

  if (params.sessionId) {
    return queryBySessionStmt.all(params.sessionId) as EventRow[];
  }
  if (params.agentId) {
    return queryByAgentStmt.all(params.agentId) as EventRow[];
  }
  if (params.type) {
    return queryByTypeStmt.all(params.type, limit, offset) as EventRow[];
  }
  return queryAllStmt.all(limit, offset) as EventRow[];
}

// ─── Delete Helpers ─────────────────────────────────────────────────

const deleteBySessionStmt = db.prepare(
  'DELETE FROM events WHERE session_id = ?'
);

const deleteAllStmt = db.prepare('DELETE FROM events');

const listSessionsStmt = db.prepare(
  `SELECT session_id, MIN(created_at) as first_event, MAX(created_at) as last_event, COUNT(*) as event_count
   FROM events GROUP BY session_id ORDER BY last_event DESC`
);

export function deleteEventsBySession(sessionId: string): number {
  const result = deleteBySessionStmt.run(sessionId);
  return result.changes;
}

export function deleteAllEvents(): number {
  const result = deleteAllStmt.run();
  return result.changes;
}

export interface SessionSummary {
  session_id: string;
  first_event: number;
  last_event: number;
  event_count: number;
}

export function listSessions(): SessionSummary[] {
  return listSessionsStmt.all() as SessionSummary[];
}

export default db;
