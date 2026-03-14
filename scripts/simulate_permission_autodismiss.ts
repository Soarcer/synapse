/**
 * Simulates the permission auto-dismiss flow:
 *
 *   1. Start a session (PostToolUse events need a known session)
 *   2. POST a PermissionRequest to the hook server (port 27247) — this BLOCKS
 *   3. Wait a few seconds so you can see the card on the dashboard
 *   4. POST a PostToolUse event to the main server (port 27246) with the same session_id
 *   5. The server detects the session moved past the permission → auto-resolves
 *   6. Dashboard card disappears via WS `permissionResolved`
 *
 * Run with:  npx tsx scripts/simulate_permission_autodismiss.ts
 *
 * Options:
 *   --delay <seconds>      Time between permission card appearing and auto-resolve (default: 5)
 *   --no-resolve           Send the permission but DON'T auto-resolve (test manual approve/deny)
 *   --tool <name>          Tool name for the permission request (default: Bash)
 *   --event-type <name>    Event type to send for auto-resolve (default: PostToolUse)
 */

const MAIN_API = process.env.API_URL ?? 'http://localhost:27246/api/events';
const HOOK_API = process.env.HOOK_URL ?? 'http://localhost:27247/api/hooks/permission';

const args = process.argv.slice(2);
const delaySeconds = parseInt(args[args.indexOf('--delay') + 1] || '5', 10);
const noResolve = args.includes('--no-resolve');
const toolName = args[args.indexOf('--tool') + 1] || 'Bash';
const resolveEvent = args[args.indexOf('--event-type') + 1] || 'PostToolUse';

const ts = Date.now().toString(36);
const SESSION_ID = `sim-perm-${ts}`;
const TOOL_USE_ID = `toolu_perm_${ts}`;
const CWD = process.cwd();

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function log(icon: string, msg: string): void {
  const time = new Date().toISOString().slice(11, 23);
  console.log(`  ${icon} [${time}] ${msg}`);
}

async function postEvent(payload: Record<string, unknown>, label: string): Promise<void> {
  const res = await fetch(MAIN_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = await res.json();
  const ok = res.ok ? '\x1b[32mOK\x1b[0m' : `\x1b[31m${res.status}\x1b[0m`;
  log('📡', `${label} [${ok}] → ${(body as Record<string, unknown>).eventId ?? 'n/a'}`);
}

async function main() {
  console.log(`\n\x1b[1m🔒 Permission Auto-Dismiss Simulator\x1b[0m`);
  console.log(`  Session:    ${SESSION_ID}`);
  console.log(`  Tool:       ${toolName}`);
  console.log(`  Delay:      ${delaySeconds}s`);
  console.log(`  Auto-resolve: ${noResolve ? 'NO (manual mode)' : 'YES'}`);
  console.log(`  Main API:   ${MAIN_API}`);
  console.log(`  Hook API:   ${HOOK_API}\n`);

  // ── Step 1: Start a session so the server knows about this session_id ──
  log('1️⃣', 'Starting session...');
  await postEvent(
    {
      hook_event_name: 'SessionStart',
      session_id: SESSION_ID,
      cwd: CWD,
      permission_mode: 'default',
      source: 'startup',
      model: 'claude-opus-4-6',
    },
    'SessionStart',
  );
  await sleep(300);

  // Send a user prompt so the graph looks realistic
  await postEvent(
    {
      hook_event_name: 'UserPromptSubmit',
      session_id: SESSION_ID,
      cwd: CWD,
      permission_mode: 'default',
      prompt: 'Delete all temp files and rebuild the project',
    },
    'UserPromptSubmit',
  );
  await sleep(300);

  // ── Step 2: Send PermissionRequest to hook server (blocks!) ──
  log('2️⃣', `Sending PermissionRequest (${toolName}) to hook server — this will block...`);

  const toolInput =
    toolName === 'Bash'
      ? {
          command: 'rm -rf /tmp/build && npm run build',
          description: 'Clean temp files and rebuild',
        }
      : toolName === 'Edit'
        ? { file_path: 'src/index.ts', old_string: 'const x = 1', new_string: 'const x = 2' }
        : { path: '/etc/config' };

  const permissionPromise = fetch(HOOK_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      hook_event_name: 'PermissionRequest',
      session_id: SESSION_ID,
      cwd: CWD,
      permission_mode: 'default',
      tool_name: toolName,
      tool_use_id: TOOL_USE_ID,
      tool_input: toolInput,
    }),
  })
    .then(async (res) => {
      const body = await res.json();
      const decision = (body as Record<string, unknown>).hookSpecificOutput as
        | Record<string, unknown>
        | undefined;
      const behavior = (decision?.decision as Record<string, unknown>)?.behavior ?? 'unknown';
      log('🔓', `PermissionRequest response: \x1b[1m${behavior}\x1b[0m (HTTP ${res.status})`);
      return body;
    })
    .catch((err) => {
      log('❌', `PermissionRequest failed: ${err.message}`);
    });

  // Give hook server time to broadcast the WS message
  await sleep(1000);
  log('👀', `Permission card should now be visible on the dashboard!`);

  if (noResolve) {
    console.log(`\n\x1b[33m  Manual mode: approve or deny the card on the dashboard.\x1b[0m`);
    console.log(`  Waiting for the hook server to respond...\n`);
    await permissionPromise;
  } else {
    // ── Step 3: Wait so the user can see the card ──
    log('⏳', `Waiting ${delaySeconds}s before simulating local answer...`);
    await sleep(delaySeconds * 1000);

    // ── Step 4: Send resolve event — simulates "user answered locally in terminal" ──
    log('3️⃣', `Sending ${resolveEvent} (same session) → should trigger auto-dismiss...`);
    await postEvent(
      {
        hook_event_name: resolveEvent,
        session_id: SESSION_ID,
        cwd: CWD,
        permission_mode: 'default',
        ...(resolveEvent.includes('Tool')
          ? { tool_name: toolName, tool_use_id: TOOL_USE_ID, tool_input: toolInput }
          : {}),
        ...(resolveEvent === 'PostToolUse'
          ? { tool_response: { stdout: 'Build complete', stderr: '', exitCode: 0 } }
          : {}),
        ...(resolveEvent === 'UserPromptSubmit' ? { prompt: 'next prompt after approval' } : {}),
      },
      `${resolveEvent} (local answer)`,
    );

    // ── Step 5: Wait for the blocked permission request to resolve ──
    log('⏳', 'Waiting for blocked PermissionRequest to resolve...');
    await permissionPromise;
  }

  // ── Cleanup: end the session ──
  await sleep(500);
  await postEvent(
    {
      hook_event_name: 'Stop',
      session_id: SESSION_ID,
      cwd: CWD,
      permission_mode: 'default',
      stop_hook_active: false,
    },
    'Stop',
  );

  console.log(`\n\x1b[32m✅ Simulation complete!\x1b[0m`);
  console.log(`\n  What to verify on the dashboard:`);
  console.log(`  • Permission card appeared after step 2`);
  console.log(`  • Card auto-dismissed after step 3 (${resolveEvent})`);
  console.log(`  • Card moved to "resolved" list (not just vanished)`);
  console.log(`\n  Try other event types: --event-type Stop`);
  console.log(`                         --event-type UserPromptSubmit`);
  console.log(`                         --event-type PreToolUse\n`);
}

main().catch((err) => {
  console.error('\x1b[31mSimulation failed:\x1b[0m', err.message);
  process.exit(1);
});
