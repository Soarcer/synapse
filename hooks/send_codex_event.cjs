#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bernhard

// Codex CLI notify hook — reads JSON from the LAST CLI ARGUMENT (not stdin!).
// Codex invokes notify hooks as: node send_codex_event.cjs '{"type":"agent-turn-complete",...}'
// No dependencies. Fire and forget (exit 0 regardless).
//
// Install in ~/.codex/config.toml:
//   notify = ["node", "/path/to/send_codex_event.cjs"]

const fs = require('fs');
const path = require('path');

// Note: if the server uses TLS, set SYNAPSE_TLS_CERT in your shell profile
// or use SYNAPSE_URL=https://localhost:27246/api/events
const port = process.env.SYNAPSE_PORT || '27246';
const protocol = process.env.SYNAPSE_TLS_CERT ? 'https' : 'http';
const SERVER_URL = process.env.SYNAPSE_URL || `${protocol}://localhost:${port}/api/events`;
const DEBUG = process.env.SYNAPSE_DEBUG === '1';
const DEBUG_LOG = path.join(__dirname, '..', 'codex_hook_debug.log');

function debugLog(msg) {
  if (!DEBUG) return;
  try {
    fs.appendFileSync(DEBUG_LOG, `[${new Date().toISOString()}] ${msg}\n`);
  } catch { /* ignore */ }
}

async function main() {
  debugLog('Codex notify hook invoked');
  try {
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

    // POST with a 3-second timeout so we never block Codex CLI
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);

    const resp = await fetch(SERVER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    debugLog(`POST response: ${resp.status} ${resp.statusText}`);
    clearTimeout(timer);
  } catch (err) {
    debugLog(`Error: ${err.message}`);
    if (err.code === 'ECONNREFUSED') {
      process.stderr.write(`[synapse-codex-hook] Server unreachable at ${SERVER_URL} — is the server running?\n`);
    } else if (err.name !== 'AbortError') {
      process.stderr.write(`[synapse-codex-hook] ${err.message}\n`);
    }
  }
}

main().then(() => process.exit(0));
