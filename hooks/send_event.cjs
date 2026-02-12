#!/usr/bin/env node

// Claude Code hook script — reads JSON from stdin, POSTs to Synapse server.
// No dependencies. Fire and forget (exit 0 regardless).
//
// Claude Code sends hook events as JSON on stdin with fields like:
//   session_id, hook_event_name, tool_name, tool_input, tool_response,
//   tool_use_id, agent_id, agent_type, cwd, transcript_path, etc.

const fs = require('fs');
const path = require('path');

// Parse --port from command line (set by VS Code extension hookManager)
function getCliPort() {
  const idx = process.argv.indexOf('--port');
  if (idx !== -1 && process.argv[idx + 1]) {
    return parseInt(process.argv[idx + 1], 10);
  }
  return null;
}

const SERVER_URL = (() => {
  if (process.env.SYNAPSE_URL) return process.env.SYNAPSE_URL;
  if (process.env.AGENTVIZ_URL) {
    process.stderr.write('[hook] AGENTVIZ_URL is deprecated, use SYNAPSE_URL instead\n');
    return process.env.AGENTVIZ_URL;
  }
  const cliPort = getCliPort();
  if (cliPort) return `http://localhost:${cliPort}/api/events`;
  return 'http://localhost:4000/api/events';
})();
const DEBUG = process.env.SYNAPSE_DEBUG === '1';
const DEBUG_LOG = path.join(__dirname, '..', 'hook_debug.log');

function debugLog(msg) {
  if (!DEBUG) return;
  try {
    fs.appendFileSync(DEBUG_LOG, `[${new Date().toISOString()}] ${msg}\n`);
  } catch { /* ignore */ }
}

async function main() {
  debugLog('Hook invoked');
  try {
    const chunks = [];
    for await (const chunk of process.stdin) {
      chunks.push(chunk);
    }
    const body = Buffer.concat(chunks).toString('utf-8');
    debugLog(`Received body (${body.length} chars): ${body.slice(0, 200)}`);
    if (!body.trim()) {
      debugLog('Empty body, skipping');
      return;
    }

    // Validate JSON before sending
    JSON.parse(body);

    // POST with a 3-second timeout so we never block Claude Code
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);

    const resp = await fetch(SERVER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      signal: controller.signal,
    });

    debugLog(`POST response: ${resp.status} ${resp.statusText}`);
    clearTimeout(timer);
  } catch (err) {
    debugLog(`Error: ${err.message}`);
    // Fire and forget — never block Claude Code
  }
}

main().then(() => process.exit(0));
