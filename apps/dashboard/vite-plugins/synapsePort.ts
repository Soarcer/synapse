// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Synapse Contributors

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { Plugin, ViteDevServer } from 'vite';

// Project-local port file — written by the server and VS Code extension.
const PROJECT_PORT_FILE = path.resolve(process.cwd(), '.claude', '.synapse-port');
// Global port file — written by the standalone CLI daemon.
const GLOBAL_PORT_FILE = path.join(os.homedir(), '.synapse', 'port');

/** Read and validate a port number from a file. Returns null if unreadable or invalid. */
function tryReadPortFile(filePath: string): string | null {
  try {
    const content = fs.readFileSync(filePath, 'utf-8').trim();
    const port = parseInt(content, 10);
    if (/^\d+$/.test(content) && port > 1023 && port < 65536) return String(port);
  } catch {
    // File doesn't exist or is unreadable — not an error in this context
  }
  return null;
}

/**
 * Read the server port from the port discovery chain:
 *   1. .claude/.synapse-port  (project-local, written by server + VS Code extension)
 *   2. ~/.synapse/port         (global, written by standalone CLI daemon)
 *   3. SYNAPSE_PORT env var    (explicit override)
 *   4. 4000                    (hardcoded default)
 *
 * Intentionally does NOT fall back to the generic PORT env var — that variable
 * is set by many unrelated tools (Docker, cloud CLIs, etc.) and causes silent misrouting.
 */
export function readServerPort(): string {
  return (
    tryReadPortFile(PROJECT_PORT_FILE) ??
    tryReadPortFile(GLOBAL_PORT_FILE) ??
    process.env.SYNAPSE_PORT ??
    '4000'
  );
}

// Module-level so `lastPort` survives across server.restart() calls
// (configureServer re-runs on each restart, but module scope persists).
let lastPort = '';
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

function handlePortFileChange(server: ViteDevServer): void {
  // Debounce: the VS Code extension may write the file multiple times in quick
  // succession (once per hook config pass). Wait 300 ms for writes to settle.
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    const newPort = readServerPort();
    if (newPort === lastPort) return; // No real change — ignore
    console.log(
      `\n[Synapse] Server port changed: ${lastPort} → ${newPort} — restarting Vite proxy…\n`,
    );
    lastPort = newPort;
    // Notify the browser first so it can show a toast and save viewport state.
    // The 300 ms grace period ensures the message reaches the client before the
    // WS connection is torn down by server.restart().
    server.ws.send({ type: 'custom', event: 'synapse:port-changing', data: { port: newPort } });
    setTimeout(() => server.restart(), 300);
  }, 300);
}

/**
 * Vite plugin that watches port discovery files and automatically restarts the
 * dev server proxy when the backend server port changes.
 *
 * Uses fs.watch (event-driven) on the .claude/ directory with fs.watchFile
 * (polling) as a fallback for environments where fs.watch is unreliable.
 */
export function synapsePortWatcher(): Plugin {
  return {
    name: 'synapse-port-watcher',
    configureServer(server) {
      lastPort = readServerPort();

      const portDir = path.dirname(PROJECT_PORT_FILE);
      const portFileName = path.basename(PROJECT_PORT_FILE);
      let dirWatcher: fs.FSWatcher | null = null;

      try {
        // Watch the .claude/ directory — more reliable than watching the file
        // directly (handles the case where the file doesn't exist yet on first start).
        dirWatcher = fs.watch(portDir, { persistent: false }, (event, filename) => {
          if (filename === portFileName) handlePortFileChange(server);
        });
      } catch {
        // .claude/ directory doesn't exist yet (very rare — server creates it on startup).
        // Fall back to polling both files at 1s intervals.
        for (const file of [PROJECT_PORT_FILE, GLOBAL_PORT_FILE]) {
          fs.watchFile(file, { interval: 1000, persistent: false }, () =>
            handlePortFileChange(server),
          );
        }
      }

      // Register cleanup AFTER the HTTP server has bound its port.
      // httpServer may be null during configureServer execution (before listen()).
      server.httpServer?.once('listening', () => {
        server.httpServer!.once('close', () => {
          dirWatcher?.close();
          for (const file of [PROJECT_PORT_FILE, GLOBAL_PORT_FILE]) {
            fs.unwatchFile(file);
          }
          if (debounceTimer) {
            clearTimeout(debounceTimer);
            debounceTimer = null;
          }
        });
      });
    },
  };
}
