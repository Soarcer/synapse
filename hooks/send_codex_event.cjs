#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bernhard

// Codex CLI notify hook — reads JSON from the LAST CLI ARGUMENT (not stdin!).
// Codex invokes notify hooks as: node send_codex_event.cjs '{"type":"agent-turn-complete",...}'
// Writes to the Synapse relay file. Falls back to HTTP POST if the file write fails.
// No dependencies. Fire and forget (exit 0 regardless).
//
// Install in ~/.codex/config.toml:
//   notify = ["node", "/path/to/send_codex_event.cjs"]

const fs = require('fs');
const path = require('path');
const os = require('os');

const basePort = Number(process.env.SYNAPSE_PORT || '27246');
const httpPort = basePort + 2; // HTTP fallback always plain HTTP
const SERVER_URL = process.env.SYNAPSE_URL || `http://localhost:${httpPort}/api/events`;
const RELAY_PATH = process.env.SYNAPSE_RELAY_FILE
  || path.join(os.tmpdir(), `synapse_relay_${basePort}.jsonl`);
const DEBUG = process.env.SYNAPSE_DEBUG === '1';
const DEBUG_LOG = path.join(os.tmpdir(), 'synapse_codex_hook_debug.log');
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
      process.stderr.write(`[synapse-codex-hook] Server unreachable at ${SERVER_URL}\n`);
    } else if (err.name !== 'AbortError') {
      process.stderr.write(`[synapse-codex-hook] ${err.message}\n`);
    }
    if (tripped) {
      process.stderr.write(`[synapse-codex-hook] Circuit breaker tripped — hooks disabled until server restarts\n`);
    }
  }
}

async function main() {
  debugLog('Codex notify hook invoked');

  // Codex passes the event JSON as the LAST CLI argument
  const lastArg = process.argv[process.argv.length - 1];
  if (!lastArg || lastArg.endsWith('.cjs') || lastArg.endsWith('.js')) {
    debugLog('No JSON argument found, skipping');
    return;
  }

  debugLog(`Raw arg (${lastArg.length} chars): ${lastArg.slice(0, 200)}`);

  // Parse and tag as codex source
  const payload = JSON.parse(lastArg);
  payload.codex_source = 'notify';
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
    process.stderr.write(`[synapse-codex-hook] Relay write failed: ${err.message} — falling back to HTTP\n`);
  }

  // Fallback: HTTP POST with circuit breaker
  await sendHttp(tagged);
}

main().then(() => process.exit(0));
