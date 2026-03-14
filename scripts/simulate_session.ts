/**
 * Simulates a realistic Claude Code session with user prompts, subagents, and tools.
 * Run with: npx tsx scripts/simulate_session.ts
 *
 * Hierarchy:
 *   Session → UserPrompt → tool (main agent) + Explore subagent → tool + tool
 *   Session → UserPrompt → tool (main agent)
 */

import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

// Load .env from project root
const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, '..', '.env');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq > 0) {
      const key = trimmed.slice(0, eq).trim();
      const val = trimmed.slice(eq + 1).trim();
      if (!process.env[key]) process.env[key] = val;
    }
  }
}

// Allow self-signed TLS certs
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const port = process.env.SYNAPSE_PORT || '27246';
const protocol = (process.env.SYNAPSE_TLS_CERT && process.env.SYNAPSE_TLS_KEY) ? 'https' : 'http';
const API_URL = process.env.API_URL ?? `${protocol}://localhost:${port}/api/events`;

const ts = Date.now().toString(36);
const SESSION_ID = `sim-${ts}`;
const AGENT_ID = `agent-explore-${ts}`;
const CWD = process.cwd();

interface HookPayload {
  hook_event_name: string;
  session_id: string;
  cwd?: string;
  permission_mode?: string;
  transcript_path?: string;
  [key: string]: unknown;
}

let stepNum = 0;

async function postEvent(payload: HookPayload, label: string): Promise<void> {
  stepNum++;
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = await res.json();
  const status = res.ok ? '\x1b[32mOK\x1b[0m' : `\x1b[31m${res.status}\x1b[0m`;
  console.log(`  ${stepNum.toString().padStart(2)}. [${status}] ${label} → ${body.eventId ?? 'n/a'}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  console.log(`\n\x1b[1mSynapse Session Simulator\x1b[0m`);
  console.log(`  Session: ${SESSION_ID}`);
  console.log(`  Server:  ${API_URL}\n`);

  // ── Session Start ──
  await postEvent({
    hook_event_name: 'SessionStart',
    session_id: SESSION_ID,
    cwd: CWD,
    permission_mode: 'default',
    source: 'startup',
    model: 'claude-opus-4-6',
    transcript_path: `~/.claude/projects/sim/${SESSION_ID}.jsonl`,
  }, 'SessionStart (opus, startup)');
  await sleep(300);

  // ── First User Prompt ──
  await postEvent({
    hook_event_name: 'UserPromptSubmit',
    session_id: SESSION_ID,
    cwd: CWD,
    permission_mode: 'default',
    prompt: 'Search this codebase and explain how the WebSocket broadcasting works',
  }, 'UserPrompt: "Search this codebase..."');
  await sleep(500);

  // ── Main agent tool call (Read) — no agent_id (main agent) ──
  const mainReadId = `toolu_read_main_${ts}`;
  await postEvent({
    hook_event_name: 'PreToolUse',
    session_id: SESSION_ID,
    cwd: CWD,
    permission_mode: 'default',
    tool_name: 'Read',
    tool_use_id: mainReadId,
    tool_input: { file_path: 'package.json' },
  }, 'PreToolUse (Read — main agent)');
  await sleep(400);

  await postEvent({
    hook_event_name: 'PostToolUse',
    session_id: SESSION_ID,
    cwd: CWD,
    permission_mode: 'default',
    tool_name: 'Read',
    tool_use_id: mainReadId,
    tool_input: { file_path: 'package.json' },
    tool_response: { content: '{"name":"synapse-viz","version":"0.1.0"}' },
  }, 'PostToolUse (Read — main agent)');
  await sleep(300);

  // ── Spawn Explore subagent ──
  await postEvent({
    hook_event_name: 'SubagentStart',
    session_id: SESSION_ID,
    cwd: CWD,
    permission_mode: 'default',
    agent_id: AGENT_ID,
    agent_type: 'Explore',
  }, 'SubagentStart (Explore)');
  await sleep(600);

  // ── Explore agent: Glob ──
  const globId = `toolu_glob_${ts}`;
  await postEvent({
    hook_event_name: 'PreToolUse',
    session_id: SESSION_ID,
    cwd: CWD,
    permission_mode: 'default',
    agent_id: AGENT_ID,
    tool_name: 'Glob',
    tool_use_id: globId,
    tool_input: { pattern: 'server/**/*.ts' },
  }, 'PreToolUse (Glob — Explore)');
  await sleep(800);

  await postEvent({
    hook_event_name: 'PostToolUse',
    session_id: SESSION_ID,
    cwd: CWD,
    permission_mode: 'default',
    agent_id: AGENT_ID,
    tool_name: 'Glob',
    tool_use_id: globId,
    tool_input: { pattern: 'server/**/*.ts' },
    tool_response: { files: ['server/index.ts', 'server/services/broadcaster.ts', 'server/services/eventStore.ts'] },
  }, 'PostToolUse (Glob — Explore)');
  await sleep(300);

  // ── Explore agent: Read broadcaster ──
  const readBroadcasterId = `toolu_read_bc_${ts}`;
  await postEvent({
    hook_event_name: 'PreToolUse',
    session_id: SESSION_ID,
    cwd: CWD,
    permission_mode: 'default',
    agent_id: AGENT_ID,
    tool_name: 'Read',
    tool_use_id: readBroadcasterId,
    tool_input: { file_path: 'server/services/broadcaster.ts' },
  }, 'PreToolUse (Read broadcaster — Explore)');
  await sleep(1000);

  await postEvent({
    hook_event_name: 'PostToolUse',
    session_id: SESSION_ID,
    cwd: CWD,
    permission_mode: 'default',
    agent_id: AGENT_ID,
    tool_name: 'Read',
    tool_use_id: readBroadcasterId,
    tool_input: { file_path: 'server/services/broadcaster.ts' },
    tool_response: { content: 'export class Broadcaster { private clients = new Set<WebSocket>()... }' },
  }, 'PostToolUse (Read broadcaster — Explore)');
  await sleep(300);

  // ── Explore agent: Read index ──
  const readIndexId = `toolu_read_idx_${ts}`;
  await postEvent({
    hook_event_name: 'PreToolUse',
    session_id: SESSION_ID,
    cwd: CWD,
    permission_mode: 'default',
    agent_id: AGENT_ID,
    tool_name: 'Read',
    tool_use_id: readIndexId,
    tool_input: { file_path: 'server/index.ts' },
  }, 'PreToolUse (Read index — Explore)');
  await sleep(800);

  await postEvent({
    hook_event_name: 'PostToolUse',
    session_id: SESSION_ID,
    cwd: CWD,
    permission_mode: 'default',
    agent_id: AGENT_ID,
    tool_name: 'Read',
    tool_use_id: readIndexId,
    tool_input: { file_path: 'server/index.ts' },
    tool_response: { content: 'const wss = new WebSocketServer({ server, path: "/ws" })...' },
  }, 'PostToolUse (Read index — Explore)');
  await sleep(400);

  // ── Explore agent stops ──
  await postEvent({
    hook_event_name: 'SubagentStop',
    session_id: SESSION_ID,
    cwd: CWD,
    permission_mode: 'default',
    agent_id: AGENT_ID,
    agent_type: 'Explore',
    agent_transcript_path: `~/.claude/projects/sim/${AGENT_ID}.jsonl`,
    stop_hook_active: false,
  }, 'SubagentStop (Explore)');
  await sleep(300);

  // ── Stop (main agent finished first response) ──
  await postEvent({
    hook_event_name: 'Stop',
    session_id: SESSION_ID,
    cwd: CWD,
    permission_mode: 'default',
    stop_hook_active: false,
  }, 'Stop (response complete)');
  await sleep(500);

  // ── Second User Prompt ──
  await postEvent({
    hook_event_name: 'UserPromptSubmit',
    session_id: SESSION_ID,
    cwd: CWD,
    permission_mode: 'default',
    prompt: 'Now add a health check endpoint that returns the WebSocket client count',
  }, 'UserPrompt: "Now add a health check..."');
  await sleep(400);

  // ── Main agent: Edit ──
  const editId = `toolu_edit_${ts}`;
  await postEvent({
    hook_event_name: 'PreToolUse',
    session_id: SESSION_ID,
    cwd: CWD,
    permission_mode: 'default',
    tool_name: 'Edit',
    tool_use_id: editId,
    tool_input: {
      file_path: 'server/index.ts',
      old_string: '// Health check',
      new_string: 'app.get("/health", (req, res) => res.json({ ok: true, clients: broadcaster.clientCount }))',
    },
  }, 'PreToolUse (Edit — main agent)');
  await sleep(600);

  await postEvent({
    hook_event_name: 'PostToolUse',
    session_id: SESSION_ID,
    cwd: CWD,
    permission_mode: 'default',
    tool_name: 'Edit',
    tool_use_id: editId,
    tool_input: { file_path: 'server/index.ts' },
    tool_response: { success: true },
  }, 'PostToolUse (Edit — main agent)');
  await sleep(300);

  // ── Main agent: Bash (test) ──
  const bashId = `toolu_bash_${ts}`;
  await postEvent({
    hook_event_name: 'PreToolUse',
    session_id: SESSION_ID,
    cwd: CWD,
    permission_mode: 'default',
    tool_name: 'Bash',
    tool_use_id: bashId,
    tool_input: { command: 'curl -s http://localhost:27246/health', description: 'Test health endpoint' },
  }, 'PreToolUse (Bash curl — main agent)');
  await sleep(800);

  await postEvent({
    hook_event_name: 'PostToolUse',
    session_id: SESSION_ID,
    cwd: CWD,
    permission_mode: 'default',
    tool_name: 'Bash',
    tool_use_id: bashId,
    tool_input: { command: 'curl -s http://localhost:27246/health' },
    tool_response: { stdout: '{"ok":true,"clients":1}', stderr: '', exitCode: 0 },
  }, 'PostToolUse (Bash curl — main agent)');
  await sleep(300);

  // ── Stop (second response done) ──
  await postEvent({
    hook_event_name: 'Stop',
    session_id: SESSION_ID,
    cwd: CWD,
    permission_mode: 'default',
    stop_hook_active: false,
  }, 'Stop (second response)');
  await sleep(300);

  // ── Session End ──
  await postEvent({
    hook_event_name: 'SessionEnd',
    session_id: SESSION_ID,
    cwd: CWD,
    reason: 'prompt_input_exit',
  }, 'SessionEnd (user exited)');

  console.log(`\n\x1b[32mSimulation complete!\x1b[0m Open http://localhost:5173 to see the graph.\n`);
  console.log('Expected hierarchy:');
  console.log(`  Session (${SESSION_ID})`);
  console.log('  ├── Prompt: "Search this codebase..."');
  console.log('  │   ├── tool: Read (package.json) — main agent');
  console.log('  │   └── agent: Explore');
  console.log('  │       ├── tool: Glob (server/**/*.ts)');
  console.log('  │       ├── tool: Read (broadcaster.ts)');
  console.log('  │       └── tool: Read (index.ts)');
  console.log('  └── Prompt: "Now add a health check..."');
  console.log('      ├── tool: Edit (index.ts) — main agent');
  console.log('      └── tool: Bash (curl) — main agent\n');
}

main().catch((err) => {
  console.error('\x1b[31mSimulation failed:\x1b[0m', err.message);
  process.exit(1);
});
