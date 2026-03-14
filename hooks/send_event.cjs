#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bernhard

// Claude Code hook script — reads JSON from stdin, POSTs to Synapse server.
// No dependencies. Fire and forget (exit 0 regardless).
//
// Claude Code sends hook events as JSON on stdin with fields like:
//   session_id, hook_event_name, tool_name, tool_input, tool_response,
//   tool_use_id, agent_id, agent_type, cwd, transcript_path, etc.

const fs = require('fs');
const path = require('path');

// Hook events POST to the hook server (SYNAPSE_PORT + 1), which is always HTTP —
// no TLS issues regardless of whether the main server uses HTTPS.
// Override with SYNAPSE_URL if you need a custom endpoint.
const basePort = parseInt(process.env.SYNAPSE_PORT || '27246', 10);
const hookPort = basePort + 1;
const SERVER_URL = process.env.SYNAPSE_URL || `http://localhost:${hookPort}/api/events`;
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
    // Fire and forget — never block Claude Code, but warn on stderr so failures aren't invisible
    if (err.code === 'ECONNREFUSED') {
      process.stderr.write(`[synapse-hook] Server unreachable at ${SERVER_URL} — is the server running?\n`);
    } else if (err.name !== 'AbortError') {
      process.stderr.write(`[synapse-hook] ${err.message}\n`);
    }
  }
}

main().then(() => process.exit(0));
