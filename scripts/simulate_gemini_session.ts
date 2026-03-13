// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Synapse Contributors

// ─── Gemini CLI Session Simulator ───────────────────────────────────
// Simulates a Gemini CLI session with all supported hook event types.
// Run with: npx tsx scripts/simulate_gemini_session.ts

const API_URL = process.env.API_URL ?? 'http://localhost:27246/api/events';
const ts = Date.now().toString(36);
const SESSION_ID = `gemini-session-${ts}`;
const CWD = process.cwd();
const TRANSCRIPT_PATH = `~/.gemini/tmp/abc123/chats/${SESSION_ID}.jsonl`;

function now(): string {
  return new Date().toISOString();
}

async function postEvent(payload: Record<string, unknown>, label: string): Promise<void> {
  const resp = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const result = await resp.json();
  const status = resp.ok ? '\x1b[32mOK\x1b[0m' : `\x1b[31m${resp.status}\x1b[0m`;
  console.log(`  [${status}] ${label} → ${JSON.stringify(result)}`);
}

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  console.log(`\n\x1b[1m=== Gemini CLI Session Simulation ===\x1b[0m`);
  console.log(`Session: ${SESSION_ID}`);
  console.log(`Target:  ${API_URL}\n`);

  // 1. SessionStart (shared name — disambiguated by transcript_path containing .gemini/)
  await postEvent(
    {
      hook_event_name: 'SessionStart',
      session_id: SESSION_ID,
      timestamp: now(),
      cwd: CWD,
      model: 'gemini-2.5-pro',
      source: 'startup',
      transcript_path: TRANSCRIPT_PATH,
    },
    'SessionStart → session_start',
  );
  await sleep(100);

  // 2. BeforeModel (unambiguous Gemini hook — contains llm_request)
  await postEvent(
    {
      hook_event_name: 'BeforeModel',
      session_id: SESSION_ID,
      timestamp: now(),
      cwd: CWD,
      transcript_path: TRANSCRIPT_PATH,
      llm_request: {
        model: 'gemini-2.5-pro',
        messages: [
          { role: 'user', content: 'Refactor the authentication module to use JWT tokens' },
        ],
        config: { temperature: 0.7 },
        toolConfig: {
          mode: 'AUTO',
          allowedFunctionNames: ['read_file', 'write_file', 'run_shell_command'],
        },
      },
    },
    'BeforeModel → user_prompt',
  );
  await sleep(100);

  // 3. BeforeToolSelection (informational)
  await postEvent(
    {
      hook_event_name: 'BeforeToolSelection',
      session_id: SESSION_ID,
      timestamp: now(),
      cwd: CWD,
      transcript_path: TRANSCRIPT_PATH,
      message: 'Selecting tools: read_file, write_file, run_shell_command',
    },
    'BeforeToolSelection → notification',
  );
  await sleep(100);

  // 4. BeforeTool + AfterTool (success)
  const toolUseId1 = `gemini-tool-${ts}-1`;
  await postEvent(
    {
      hook_event_name: 'BeforeTool',
      session_id: SESSION_ID,
      timestamp: now(),
      cwd: CWD,
      transcript_path: TRANSCRIPT_PATH,
      tool_name: 'read_file',
      tool_use_id: toolUseId1,
      tool_input: { file_path: 'src/auth.ts' },
    },
    'BeforeTool → tool_start',
  );
  await sleep(200);

  await postEvent(
    {
      hook_event_name: 'AfterTool',
      session_id: SESSION_ID,
      timestamp: now(),
      cwd: CWD,
      transcript_path: TRANSCRIPT_PATH,
      tool_name: 'read_file',
      tool_use_id: toolUseId1,
      tool_input: { file_path: 'src/auth.ts' },
      tool_response: {
        llmContent: 'export function authenticate(token: string) { ... }',
        returnDisplay: 'Read 42 lines from auth.ts',
        error: null,
      },
    },
    'AfterTool → tool_end',
  );
  await sleep(100);

  // 5. BeforeTool + AfterTool (error)
  const toolUseId2 = `gemini-tool-${ts}-2`;
  await postEvent(
    {
      hook_event_name: 'BeforeTool',
      session_id: SESSION_ID,
      timestamp: now(),
      cwd: CWD,
      transcript_path: TRANSCRIPT_PATH,
      tool_name: 'run_shell_command',
      tool_use_id: toolUseId2,
      tool_input: { command: 'npm test' },
    },
    'BeforeTool → tool_start',
  );
  await sleep(200);

  await postEvent(
    {
      hook_event_name: 'AfterTool',
      session_id: SESSION_ID,
      timestamp: now(),
      cwd: CWD,
      transcript_path: TRANSCRIPT_PATH,
      tool_name: 'run_shell_command',
      tool_use_id: toolUseId2,
      tool_input: { command: 'npm test' },
      tool_response: {
        llmContent: null,
        returnDisplay: 'Tests failed',
        error: 'Exit code 1: 3 tests failed in auth.test.ts',
      },
    },
    'AfterTool (error) → tool_error',
  );
  await sleep(100);

  // 6. SessionEnd
  await postEvent(
    {
      hook_event_name: 'SessionEnd',
      session_id: SESSION_ID,
      timestamp: now(),
      cwd: CWD,
      transcript_path: TRANSCRIPT_PATH,
      reason: 'exit',
    },
    'SessionEnd → session_end',
  );

  console.log(`\n\x1b[1mExpected at http://localhost:5173:\x1b[0m`);
  console.log(`  Session: ${SESSION_ID}`);
  console.log(`  Vendor badge: google (blue)`);
  console.log(
    `  Events: session_start, user_prompt, notification, tool_start, tool_end, tool_start, tool_error, session_end`,
  );
  console.log();
}

main().catch((err) => {
  console.error(`\x1b[31mFatal: ${err.message}\x1b[0m`);
  process.exit(1);
});
