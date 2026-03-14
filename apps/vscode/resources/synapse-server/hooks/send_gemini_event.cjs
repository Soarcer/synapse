#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bernhard

// Gemini CLI hook script — reads JSON from stdin, POSTs to Synapse server.
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

// Hook events POST to the hook server (SYNAPSE_PORT + 1), which is always HTTP —
// no TLS issues regardless of whether the main server uses HTTPS.
const basePort = parseInt(process.env.SYNAPSE_PORT || '27246', 10);
const hookPort = basePort + 1;
const SERVER_URL = process.env.SYNAPSE_URL || `http://localhost:${hookPort}/api/events`;
const DEBUG = process.env.SYNAPSE_DEBUG === '1';
const DEBUG_LOG = path.join(__dirname, '..', 'gemini_hook_debug.log');

function debugLog(msg) {
  if (!DEBUG) return;
  try {
    fs.appendFileSync(DEBUG_LOG, `[${new Date().toISOString()}] ${msg}\n`);
  } catch { /* ignore */ }
}

async function main() {
  debugLog('Gemini hook invoked');
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

    // POST with a 3-second timeout so we never block Gemini CLI
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
    // Fire and forget — never block Gemini CLI
    if (err.code === 'ECONNREFUSED') {
      process.stderr.write(`[synapse-gemini-hook] Server unreachable at ${SERVER_URL} — is the server running?\n`);
    } else if (err.name !== 'AbortError') {
      process.stderr.write(`[synapse-gemini-hook] ${err.message}\n`);
    }
  }
}

main().then(() => process.exit(0));
