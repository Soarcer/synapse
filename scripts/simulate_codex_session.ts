// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Synapse Contributors

// ─── Codex CLI Session Simulator ──────────────────────────────────
// Simulates a Codex CLI session with all supported JSONL event types.
// Run with: npx tsx scripts/simulate_codex_session.ts

const API_URL = process.env.API_URL ?? 'http://localhost:4000/api/events';
const ts = Date.now().toString(36);
const SESSION_ID = `codex-session-${ts}`;

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
  console.log(`\n\x1b[1m=== Codex CLI Session Simulation ===\x1b[0m`);
  console.log(`Session: ${SESSION_ID}`);
  console.log(`Target:  ${API_URL}\n`);

  // 1. State record (session metadata)
  await postEvent(
    {
      record_type: 'state',
      data: {
        session_id: SESSION_ID,
        model: 'o4-mini',
        cwd: process.cwd(),
      },
    },
    'state → session_start',
  );
  await sleep(100);

  // 2. event_msg: turn_context
  await postEvent(
    {
      type: 'event_msg',
      session_id: SESSION_ID,
      payload: {
        type: 'turn_context',
        model: 'o4-mini',
        approval_policy: 'auto-edit',
      },
    },
    'event_msg:turn_context → session_start',
  );
  await sleep(100);

  // 3. event_msg: user_message
  await postEvent(
    {
      type: 'event_msg',
      session_id: SESSION_ID,
      payload: {
        type: 'user_message',
        message: 'Fix the failing unit test in auth.test.ts',
        images: [],
      },
    },
    'event_msg:user_message → user_prompt',
  );
  await sleep(100);

  // 4. Direct role message: assistant with tool_use
  await postEvent(
    {
      type: 'message',
      session_id: SESSION_ID,
      role: 'assistant',
      content: [
        { type: 'text', text: 'Let me read the failing test first.' },
        {
          type: 'tool_use',
          id: `tu-${ts}-1`,
          name: 'read_file',
          input: { file_path: 'tests/auth.test.ts' },
        },
      ],
    },
    'message:assistant(tool_use) → tool_start',
  );
  await sleep(200);

  // 5. Direct role message: tool result
  await postEvent(
    {
      type: 'message',
      session_id: SESSION_ID,
      role: 'tool',
      tool_use_id: `tu-${ts}-1`,
      content:
        'describe("auth", () => { it("validates tokens", () => { expect(validate("abc")).toBe(true); }); });',
    },
    'message:tool → tool_end',
  );
  await sleep(100);

  // 6. event_msg: token_count (cumulative — turn 1)
  await postEvent(
    {
      type: 'event_msg',
      session_id: SESSION_ID,
      payload: {
        type: 'token_count',
        input_tokens: 1500,
        cached_input_tokens: 1200,
        output_tokens: 85,
      },
    },
    'event_msg:token_count (turn 1) → result',
  );
  await sleep(100);

  // 7. Direct role message: assistant with shell tool
  await postEvent(
    {
      type: 'message',
      session_id: SESSION_ID,
      role: 'assistant',
      content: [
        { type: 'text', text: 'The test expects `validate("abc")` to be true. Let me run it.' },
        {
          type: 'tool_use',
          id: `tu-${ts}-2`,
          name: 'shell',
          input: { command: 'npm test -- --grep auth' },
        },
      ],
    },
    'message:assistant(tool_use) → tool_start',
  );
  await sleep(200);

  // 8. Tool result (error)
  await postEvent(
    {
      type: 'message',
      session_id: SESSION_ID,
      role: 'tool',
      tool_use_id: `tu-${ts}-2`,
      content: 'FAIL tests/auth.test.ts\n  auth\n    ✕ validates tokens (5 ms)\n\nExit code: 1',
    },
    'message:tool → tool_end',
  );
  await sleep(100);

  // 9. event_msg: token_count (cumulative — turn 2, note values are CUMULATIVE)
  await postEvent(
    {
      type: 'event_msg',
      session_id: SESSION_ID,
      payload: {
        type: 'token_count',
        input_tokens: 3200,
        cached_input_tokens: 2800,
        output_tokens: 210,
      },
    },
    'event_msg:token_count (turn 2, cumulative) → result',
  );
  await sleep(100);

  // 10. Notify hook: agent-turn-complete
  await postEvent(
    {
      type: 'agent-turn-complete',
      'thread-id': SESSION_ID,
      'last-assistant-message':
        'I fixed the token validation by updating the regex pattern in validate().',
      codex_source: 'notify',
    },
    'agent-turn-complete → result',
  );

  console.log(`\n\x1b[1mExpected at http://localhost:5173:\x1b[0m`);
  console.log(`  Session: codex-${SESSION_ID}`);
  console.log(`  Vendor badge: openai (teal)`);
  console.log(
    `  Events: session_start, session_start, user_prompt, tool_start, tool_end, result, tool_start, tool_end, result, result`,
  );
  console.log(`  Token delta turn 1: input=1500, output=85`);
  console.log(`  Token delta turn 2: input=1700, output=125 (delta from cumulative)`);
  console.log();
}

main().catch((err) => {
  console.error(`\x1b[31mFatal: ${err.message}\x1b[0m`);
  process.exit(1);
});
