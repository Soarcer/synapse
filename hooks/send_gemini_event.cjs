#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bernhard

// Gemini CLI hook script — reads JSON from stdin, writes to the Synapse relay file.
// Falls back to HTTP POST if the file write fails.
// No dependencies. Fire and forget (exit 0 regardless).
//
// Gemini CLI sends hook events as JSON on stdin with fields like:
//   session_id, hook_event_name (BeforeModel/BeforeTool/AfterTool/BeforeToolSelection/
//   SessionStart/SessionEnd), tool_name, tool_input, tool_response, cwd, transcript_path
//
// Install by adding to ~/.gemini/settings.json:
// {
//   "hooks": {
//     "BeforeModel":         [{ "command": "node /path/to/hooks/send_gemini_event.cjs" }],
//     "BeforeTool":          [{ "command": "node /path/to/hooks/send_gemini_event.cjs" }],
//     "AfterTool":           [{ "command": "node /path/to/hooks/send_gemini_event.cjs" }],
//     "BeforeToolSelection": [{ "command": "node /path/to/hooks/send_gemini_event.cjs" }],
//     "SessionStart":        [{ "command": "node /path/to/hooks/send_gemini_event.cjs" }],
//     "SessionEnd":          [{ "command": "node /path/to/hooks/send_gemini_event.cjs" }]
//   }
// }

'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');

const basePort = Number(process.env.SYNAPSE_PORT || '27246');
const httpPort = basePort + 2; // HTTP fallback always plain HTTP
const SERVER_URL = process.env.SYNAPSE_URL || `http://localhost:${httpPort}/api/events`;
const RELAY_PATH = process.env.SYNAPSE_RELAY_FILE
  || path.join(os.tmpdir(), `synapse_relay_${basePort}.jsonl`);
const DEBUG = process.env.SYNAPSE_DEBUG === '1';
const DEBUG_LOG = path.join(os.tmpdir(), 'synapse_gemini_hook_debug.log');
const FORCE_HTTP = process.env.SYNAPSE_TRANSPORT === 'http';

// Circuit breaker — guards the HTTP fallback path.
// Trips permanently after CB_MAX_FAILURES consecutive failures. Only resets when
// the Synapse server starts and deletes the CB file (see index.ts).
const CB_FILE = path.join(os.tmpdir(), `synapse_cb_${basePort}.json`);
const CB_MAX_FAILURES = 3;

function debugLog(msg) {
  if (!DEBUG) return;
  try { fs.appendFileSync(DEBUG_LOG, `[${new Date().toISOString()}] ${msg}\n`); } catch { /* ignore */ }
}

function cbIsOpen() {
  return fs.existsSync(CB_FILE);
}
function cbRecordFailure() {
  let count = 0;
  try { count = JSON.parse(fs.readFileSync(CB_FILE, 'utf-8')).failures || 0; } catch { /* fresh */ }
  count++;
  try { fs.writeFileSync(CB_FILE, JSON.stringify({ failures: count, tripped: count >= CB_MAX_FAILURES, trippedAt: Date.now() })); } catch { /* ignore */ }
  return count >= CB_MAX_FAILURES;
}
function cbRecordSuccess() {
  try { fs.unlinkSync(CB_FILE); } catch { /* ignore */ }
}

async function sendHttp(body) {
  if (cbIsOpen()) {
    debugLog('Circuit breaker OPEN — skipping HTTP send');
    return;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3000);
  try {
    const resp = await fetch(SERVER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      signal: controller.signal,
    });
    debugLog(`HTTP POST response: ${resp.status}`);
    clearTimeout(timer);
    cbRecordSuccess();
  } catch (err) {
    clearTimeout(timer);
    const tripped = cbRecordFailure();
    if (err.code === 'ECONNREFUSED') {
      process.stderr.write(`[synapse-gemini-hook] Server unreachable at ${SERVER_URL}\n`);
    } else if (err.name !== 'AbortError') {
      process.stderr.write(`[synapse-gemini-hook] ${err.message}\n`);
    }
    if (tripped) {
      process.stderr.write(`[synapse-gemini-hook] Circuit breaker tripped — hooks disabled until server restarts\n`);
    }
  }
}

async function main() {
  debugLog('Gemini hook invoked');

  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const body = Buffer.concat(chunks).toString('utf-8');
  debugLog(`Received body (${body.length} chars)`);
  if (!body.trim()) return;

  // Validate JSON and tag as gemini source
  const payload = JSON.parse(body);
  payload.gemini_source = true;
  const tagged = JSON.stringify(payload);

  if (FORCE_HTTP) {
    debugLog('SYNAPSE_TRANSPORT=http — using HTTP POST');
    await sendHttp(tagged);
    return;
  }

  // Primary path: append to relay file (microseconds, no network)
  try {
    fs.appendFileSync(RELAY_PATH, tagged.trim() + '\n');
    debugLog(`Appended to relay file: ${RELAY_PATH}`);
    return;
  } catch (err) {
    debugLog(`Relay file write failed (${err.message}) — falling back to HTTP`);
    process.stderr.write(`[synapse-gemini-hook] Relay write failed: ${err.message} — falling back to HTTP\n`);
  }

  // Fallback: HTTP POST with circuit breaker
  await sendHttp(tagged);
}

main().then(() => process.exit(0));
