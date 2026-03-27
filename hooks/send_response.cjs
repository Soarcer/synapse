#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bernhard

// Claude Code Stop hook — reads transcript JSONL, extracts last assistant
// response text, and writes it as an AssistantResponse event to the relay file.
// Falls back to HTTP POST if the file write fails.
// No dependencies. Fire and forget (exit 0 regardless).

const fs = require('fs');
const path = require('path');
const os = require('os');

const DEBUG = process.env.SYNAPSE_DEBUG === '1';
const basePort = parseInt(process.env.SYNAPSE_PORT || '27246', 10);
const hookPort = basePort + 1;
const SERVER_URL = process.env.SYNAPSE_URL || `http://localhost:${hookPort}/api/events`;
const RELAY_PATH = process.env.SYNAPSE_RELAY_FILE
  || path.join(os.tmpdir(), `synapse_relay_${basePort}.jsonl`);
const DEBUG_LOG = path.join(os.tmpdir(), 'synapse_response_hook_debug.log');
const FORCE_HTTP = process.env.SYNAPSE_TRANSPORT === 'http';

// Circuit breaker — guards the HTTP fallback path.
// Trips permanently after CB_MAX_FAILURES consecutive failures. Only resets when
// the Synapse server starts and deletes the CB file (see index.ts).
const CB_FILE = path.join(os.tmpdir(), `synapse_cb_${basePort}.json`);
const CB_MAX_FAILURES = 3;

function debugLog(msg) {
  if (!DEBUG) return;
  try { fs.appendFileSync(DEBUG_LOG, `[${new Date().toISOString()}] [send_response] ${msg}\n`); } catch { /* ignore */ }
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

function extractLastAssistantResponse(transcriptPath) {
  try {
    const normalized = path.resolve(transcriptPath);
    if (!fs.existsSync(normalized)) {
      debugLog(`Transcript not found: ${normalized}`);
      return null;
    }
    const content = fs.readFileSync(normalized, 'utf-8');
    const lines = content.trim().split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const entry = JSON.parse(lines[i]);
        if (entry.type === 'assistant' && entry.message?.content) {
          const textBlocks = entry.message.content
            .filter((block) => block.type === 'text')
            .map((block) => block.text);
          if (textBlocks.length > 0) {
            return { text: textBlocks.join('\n'), model: entry.message?.model || undefined };
          }
        }
      } catch { /* skip malformed lines */ }
    }
    debugLog('No assistant text found in transcript');
    return null;
  } catch (err) {
    debugLog(`Error reading transcript: ${err.message}`);
    return null;
  }
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
      process.stderr.write(`[synapse-response-hook] Server unreachable at ${SERVER_URL}\n`);
    } else if (err.name !== 'AbortError') {
      process.stderr.write(`[synapse-response-hook] ${err.message}\n`);
    }
    if (tripped) {
      process.stderr.write(`[synapse-response-hook] Circuit breaker tripped — hooks disabled until server restarts\n`);
    }
  }
}

async function main() {
  debugLog('send_response hook invoked');

  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const body = Buffer.concat(chunks).toString('utf-8');
  if (!body.trim()) return;

  const hookEvent = JSON.parse(body);
  if (hookEvent.hook_event_name !== 'Stop') {
    debugLog(`Skipping non-Stop event: ${hookEvent.hook_event_name}`);
    return;
  }

  const transcriptPath = hookEvent.transcript_path;
  if (!transcriptPath) {
    debugLog('No transcript_path in Stop event');
    return;
  }

  const response = extractLastAssistantResponse(transcriptPath);
  if (!response || !response.text) {
    debugLog('No assistant response extracted');
    return;
  }

  const MAX_TEXT = 10000;
  const truncated = response.text.length > MAX_TEXT;
  const text = truncated ? response.text.slice(0, MAX_TEXT) + '\n\n… (truncated)' : response.text;

  const syntheticEvent = {
    hook_event_name: 'AssistantResponse',
    session_id: hookEvent.session_id,
    transcript_path: transcriptPath,
    cwd: hookEvent.cwd,
    permission_mode: hookEvent.permission_mode,
    assistant_text: text,
    model: response.model,
    truncated,
  };

  debugLog(`Sending assistant response (${text.length} chars, truncated=${truncated})`);
  const eventBody = JSON.stringify(syntheticEvent);

  if (FORCE_HTTP) {
    debugLog('SYNAPSE_TRANSPORT=http — using HTTP POST');
    await sendHttp(eventBody);
    return;
  }

  // Primary path: append to relay file
  try {
    fs.appendFileSync(RELAY_PATH, eventBody + '\n');
    debugLog(`Appended to relay file: ${RELAY_PATH}`);
    return;
  } catch (err) {
    debugLog(`Relay file write failed (${err.message}) — falling back to HTTP`);
    process.stderr.write(`[synapse-response-hook] Relay write failed: ${err.message} — falling back to HTTP\n`);
  }

  // Fallback: HTTP POST with circuit breaker
  await sendHttp(eventBody);
}

main().then(() => process.exit(0));
