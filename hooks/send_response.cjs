#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bernhard

// Claude Code Stop hook — reads transcript JSONL, extracts last assistant
// response text, and POSTs it as an AssistantResponse event to Synapse.
// No dependencies. Fire and forget (exit 0 regardless).

const fs = require('fs');
const path = require('path');

// Hook events POST to the hook server (SYNAPSE_PORT + 1), which is always HTTP —
// no TLS issues regardless of whether the main server uses HTTPS.
const basePort = parseInt(process.env.SYNAPSE_PORT || '27246', 10);
const hookPort = basePort + 1;
const SERVER_URL = process.env.SYNAPSE_URL || `http://localhost:${hookPort}/api/events`;
const DEBUG_LOG = path.join(__dirname, '..', 'hook_response_debug.log');

function debugLog(msg) {
  try {
    fs.appendFileSync(DEBUG_LOG, `[${new Date().toISOString()}] [send_response] ${msg}\n`);
  } catch { /* ignore */ }
}

/**
 * Read the transcript JSONL and extract the last assistant message text.
 * Returns { text, model } or null.
 */
function extractLastAssistantResponse(transcriptPath) {
  try {
    // On Windows the path may use forward slashes from Claude — normalize
    const normalized = path.resolve(transcriptPath);
    if (!fs.existsSync(normalized)) {
      debugLog(`Transcript not found: ${normalized}`);
      return null;
    }

    const content = fs.readFileSync(normalized, 'utf-8');
    const lines = content.trim().split('\n');

    // Walk backwards to find last assistant message
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const entry = JSON.parse(lines[i]);
        if (entry.type === 'assistant' && entry.message?.content) {
          const textBlocks = entry.message.content
            .filter((block) => block.type === 'text')
            .map((block) => block.text);

          if (textBlocks.length > 0) {
            return {
              text: textBlocks.join('\n'),
              model: entry.message?.model || undefined,
            };
          }
        }
      } catch {
        // Skip malformed lines
      }
    }

    debugLog('No assistant text found in transcript');
    return null;
  } catch (err) {
    debugLog(`Error reading transcript: ${err.message}`);
    return null;
  }
}

async function main() {
  debugLog('send_response hook invoked');
  try {
    const chunks = [];
    for await (const chunk of process.stdin) {
      chunks.push(chunk);
    }
    const body = Buffer.concat(chunks).toString('utf-8');
    if (!body.trim()) return;

    const hookEvent = JSON.parse(body);

    // Only process Stop events
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

    // Truncate very long responses to avoid payload bloat (keep first 10k chars)
    const MAX_TEXT = 10000;
    const truncated = response.text.length > MAX_TEXT;
    const text = truncated
      ? response.text.slice(0, MAX_TEXT) + '\n\n… (truncated)'
      : response.text;

    // Build synthetic AssistantResponse event
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

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);

    const resp = await fetch(SERVER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(syntheticEvent),
      signal: controller.signal,
    });

    debugLog(`POST response: ${resp.status} ${resp.statusText}`);
    clearTimeout(timer);
  } catch (err) {
    debugLog(`Error: ${err.message}`);
    if (err.code === 'ECONNREFUSED') {
      process.stderr.write(`[synapse-response-hook] Server unreachable at ${SERVER_URL}\n`);
    } else if (err.name !== 'AbortError') {
      process.stderr.write(`[synapse-response-hook] ${err.message}\n`);
    }
  }
}

main().then(() => process.exit(0));
