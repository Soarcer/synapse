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
const os = require('os');

// Parse --port from command line
function getCliPort() {
  const idx = process.argv.indexOf('--port');
  if (idx !== -1 && process.argv[idx + 1]) {
    return parseInt(process.argv[idx + 1], 10);
  }
  return null;
}

// Read port from .claude/.synapse-port file (written by VS Code extension or CLI).
function getPortFromFile() {
  try {
    const portFile = path.join(process.cwd(), '.claude', '.synapse-port');
    const content = fs.readFileSync(portFile, 'utf-8').trim();
    const port = parseInt(content, 10);
    if (port > 0 && port < 65536) return port;
  } catch { /* file doesn't exist or unreadable */ }
  return null;
}

// Read port from global ~/.synapse/port file (written by standalone daemon).
function getGlobalPort() {
  try {
    const portFile = path.join(os.homedir(), '.synapse', 'port');
    const content = fs.readFileSync(portFile, 'utf-8').trim();
    const port = parseInt(content, 10);
    if (port > 0 && port < 65536) return port;
  } catch { /* file doesn't exist or unreadable */ }
  return null;
}

const SERVER_URL = (() => {
  if (process.env.SYNAPSE_URL) return process.env.SYNAPSE_URL;
  // Port file takes priority over CLI arg
  const filePort = getPortFromFile();
  if (filePort) return `http://localhost:${filePort}/api/events`;
  const globalPort = getGlobalPort();
  if (globalPort) return `http://localhost:${globalPort}/api/events`;
  const cliPort = getCliPort();
  if (cliPort) return `http://localhost:${cliPort}/api/events`;
  return 'http://localhost:4000/api/events';
})();
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
