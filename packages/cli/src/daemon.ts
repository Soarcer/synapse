// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Synapse Contributors

// Daemon lifecycle: start, stop, status for the Synapse server process.

import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import http from 'http';
import {
  SYNAPSE_HOME,
  GLOBAL_PORT_FILE,
  GLOBAL_PID_FILE,
  GLOBAL_DB_PATH,
  SERVER_ENTRY,
  DASHBOARD_DIR,
} from './paths.js';

// ── Read saved state ─────────────────────────────────────────

export function readPid(): number | null {
  try {
    const pid = parseInt(fs.readFileSync(GLOBAL_PID_FILE, 'utf-8').trim(), 10);
    return pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

export function readPort(): number | null {
  try {
    const port = parseInt(fs.readFileSync(GLOBAL_PORT_FILE, 'utf-8').trim(), 10);
    return port > 0 && port < 65536 ? port : null;
  } catch {
    return null;
  }
}

function writePid(pid: number): void {
  fs.mkdirSync(SYNAPSE_HOME, { recursive: true });
  fs.writeFileSync(GLOBAL_PID_FILE, String(pid));
}

function writePort(port: number): void {
  fs.mkdirSync(SYNAPSE_HOME, { recursive: true });
  fs.writeFileSync(GLOBAL_PORT_FILE, String(port));
}

function cleanupFiles(): void {
  try {
    fs.unlinkSync(GLOBAL_PID_FILE);
  } catch {
    /* ok */
  }
  try {
    fs.unlinkSync(GLOBAL_PORT_FILE);
  } catch {
    /* ok */
  }
}

// ── Process checks ───────────────────────────────────────────

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0); // signal 0 = check existence
    return true;
  } catch {
    return false;
  }
}

function healthCheck(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(`http://localhost:${port}/api/health`, (res) => {
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(2000, () => {
      req.destroy();
      resolve(false);
    });
  });
}

// ── Status ───────────────────────────────────────────────────

export async function status(): Promise<{
  running: boolean;
  pid: number | null;
  port: number | null;
}> {
  const pid = readPid();
  const port = readPort();

  if (!pid || !isProcessAlive(pid)) {
    // Stale PID file — clean up
    if (pid) cleanupFiles();
    return { running: false, pid: null, port: null };
  }

  // PID is alive — verify it's actually our server
  if (port) {
    const healthy = await healthCheck(port);
    if (healthy) return { running: true, pid, port };
  }

  return { running: true, pid, port: null };
}

// ── Start ────────────────────────────────────────────────────

export interface StartOptions {
  port?: number;
  background?: boolean;
  open?: boolean;
}

export async function start(opts: StartOptions = {}): Promise<number> {
  const preferredPort = opts.port ?? 4000;

  // Check if already running
  const current = await status();
  if (current.running && current.port) {
    console.log(`Synapse is already running on port ${current.port} (PID ${current.pid})`);
    return current.port;
  }

  // Clean up stale state
  cleanupFiles();

  if (!fs.existsSync(SERVER_ENTRY)) {
    console.error(`Server bundle not found: ${SERVER_ENTRY}`);
    console.error('Run "pnpm --filter @synapse-ai/cli build" first.');
    process.exit(1);
  }

  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    HOST: 'localhost',
    PORT: String(preferredPort),
    CLIENT_ORIGIN: '*',
    NODE_ENV: 'production',
    SYNAPSE_DB_PATH: GLOBAL_DB_PATH,
  };

  if (fs.existsSync(DASHBOARD_DIR)) {
    env.SYNAPSE_DASHBOARD_DIR = DASHBOARD_DIR;
  }

  if (opts.background) {
    // ── Background daemon mode ─────────────────────────────
    const logFile = fs.openSync(path.join(SYNAPSE_HOME, 'server.log'), 'a');

    const child = spawn(process.execPath, [SERVER_ENTRY], {
      env,
      detached: true,
      stdio: ['ignore', logFile, logFile],
    });

    child.unref();

    if (!child.pid) {
      console.error('Failed to start server process');
      process.exit(1);
    }

    writePid(child.pid);

    // Wait for server to come up and discover actual port
    const actualPort = await waitForServer(preferredPort, 10_000);
    writePort(actualPort);

    console.log(`Synapse started in background (PID ${child.pid}, port ${actualPort})`);
    return actualPort;
  } else {
    // ── Foreground mode ────────────────────────────────────
    const child = spawn(process.execPath, [SERVER_ENTRY], {
      env,
      stdio: ['ignore', 'pipe', 'inherit'],
    });

    if (!child.pid) {
      console.error('Failed to start server process');
      process.exit(1);
    }

    writePid(child.pid);

    // Parse port from server stdout (SYNAPSE_PORT=NNNN)
    let actualPort = preferredPort;
    child.stdout?.on('data', (data: Buffer) => {
      const text = data.toString();
      process.stdout.write(text);
      const match = text.match(/SYNAPSE_PORT=(\d+)/);
      if (match) {
        actualPort = parseInt(match[1], 10);
        writePort(actualPort);
      }
    });

    // Clean up on exit
    child.on('exit', (code) => {
      cleanupFiles();
      console.log(`\nServer exited (code ${code})`);
      process.exit(code ?? 0);
    });

    // Forward signals
    process.on('SIGINT', () => child.kill('SIGTERM'));
    process.on('SIGTERM', () => child.kill('SIGTERM'));

    // Wait for ready
    const readyPort = await waitForServer(preferredPort, 10_000);
    actualPort = readyPort;
    writePort(actualPort);

    console.log(`Synapse running on http://localhost:${actualPort}`);
    return actualPort;
  }
}

// ── Stop ─────────────────────────────────────────────────────

export async function stop(): Promise<void> {
  const pid = readPid();
  if (!pid) {
    console.log('Synapse is not running');
    return;
  }

  if (!isProcessAlive(pid)) {
    console.log('Stale PID file — cleaning up');
    cleanupFiles();
    return;
  }

  console.log(`Stopping Synapse (PID ${pid})...`);

  try {
    process.kill(pid, 'SIGTERM');
  } catch {
    console.error(`Could not stop process ${pid}`);
    cleanupFiles();
    return;
  }

  // Wait up to 10s for graceful shutdown
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 500));
    if (!isProcessAlive(pid)) {
      cleanupFiles();
      console.log('Synapse stopped');
      return;
    }
  }

  // Force kill
  try {
    process.kill(pid, 'SIGKILL');
  } catch {
    /* already gone */
  }
  cleanupFiles();
  console.log('Synapse force-stopped');
}

// ── Helpers ──────────────────────────────────────────────────

async function waitForServer(startPort: number, timeoutMs: number): Promise<number> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    // Try ports startPort through startPort+19 (matching server's MAX_PORT_RETRIES)
    for (let p = startPort; p < startPort + 20; p++) {
      const ok = await healthCheck(p);
      if (ok) return p;
    }
    await new Promise((r) => setTimeout(r, 500));
  }

  // Fallback — assume preferred port
  console.warn('Server did not respond to health check in time; assuming port', startPort);
  return startPort;
}
