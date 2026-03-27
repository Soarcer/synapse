// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bernhard

// Daemon lifecycle: start, stop, status for the Synapse server process.

import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import http from 'http';
import { SYNAPSE_PORT } from '@synapse-ai/core/config';
import {
  SYNAPSE_HOME,
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

function writePid(pid: number): void {
  fs.mkdirSync(SYNAPSE_HOME, { recursive: true });
  fs.writeFileSync(GLOBAL_PID_FILE, String(pid));
}

function cleanupFiles(): void {
  try {
    fs.unlinkSync(GLOBAL_PID_FILE);
  } catch {
    /* ok */
  }
}

/** Remove relay file, offset file, and circuit breaker from $TEMP. */
function cleanupRelayFiles(port: number): void {
  const tmpDir = os.tmpdir();
  const files = [
    path.join(tmpDir, `synapse_relay_${port}.jsonl`),
    path.join(tmpDir, `synapse_relay_offset_${port}.json`),
    path.join(tmpDir, `synapse_cb_${port}.json`),
  ];
  for (const f of files) {
    try {
      fs.unlinkSync(f);
    } catch {
      /* ok — may not exist */
    }
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
  port: number;
}> {
  const pid = readPid();

  if (pid && !isProcessAlive(pid)) {
    cleanupFiles();
    return { running: false, pid: null, port: SYNAPSE_PORT };
  }

  const healthy = await healthCheck(SYNAPSE_PORT);
  if (healthy) return { running: true, pid, port: SYNAPSE_PORT };

  if (pid) return { running: true, pid, port: SYNAPSE_PORT };

  return { running: false, pid: null, port: SYNAPSE_PORT };
}

// ── Start ────────────────────────────────────────────────────

export interface StartOptions {
  port?: number;
  background?: boolean;
  open?: boolean;
  lan?: boolean;
}

export async function start(opts: StartOptions = {}): Promise<number> {
  const preferredPort = opts.port ?? 27246;

  // Check if already running (PID file or health check on the port)
  const current = await status();
  if (current.running && current.port) {
    console.log(`\nSynapse already running  →  http://localhost:${current.port}`);
    console.log(`Run "synapse open" to open the dashboard.\n`);
    return current.port;
  }

  // No PID file, but port might be held by a dev server or another instance.
  // Health-check the port directly — if a Synapse server is there, just reuse it.
  const portAlive = await healthCheck(preferredPort);
  if (portAlive) {
    console.log(`\nSynapse server detected on port ${preferredPort} (not started by CLI)`);
    console.log(`Hooking this project to the existing server.\n`);
    return preferredPort;
  }

  // Clean up stale state
  cleanupFiles();

  if (!fs.existsSync(SERVER_ENTRY)) {
    console.error(`Server bundle not found: ${SERVER_ENTRY}`);
    console.error('Run "pnpm --filter @synapse-ai/cli build" first.');
    process.exit(1);
  }

  const host = opts.lan ? '0.0.0.0' : '127.0.0.1';

  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    HOST: host,
    SYNAPSE_PORT: String(preferredPort),
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

    // Wait for server to come up
    const actualPort = await waitForServer(preferredPort, 10_000);

    console.log(`\nSynapse started (PID ${child.pid})`);
    if (opts.lan) {
      console.log(`  Network: LAN-accessible (0.0.0.0) — other devices can reach this server`);
    }
    console.log(`Logs: ${path.join(SYNAPSE_HOME, 'server.log')}\n`);
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

    // Pipe stdout
    child.stdout?.on('data', (data: Buffer) => {
      process.stdout.write(data.toString());
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
    const actualPort = await waitForServer(preferredPort, 10_000);

    console.log(`Synapse running on http://localhost:${actualPort}`);
    if (opts.lan) {
      console.log(`  Network: LAN-accessible (0.0.0.0) — other devices can reach this server`);
    }
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
    cleanupRelayFiles(SYNAPSE_PORT);
    return;
  }

  console.log(`Stopping Synapse (PID ${pid})...`);

  try {
    process.kill(pid, 'SIGTERM');
  } catch {
    console.error(`Could not stop process ${pid}`);
    cleanupFiles();
    cleanupRelayFiles(SYNAPSE_PORT);
    return;
  }

  // Wait up to 10s for graceful shutdown
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 500));
    if (!isProcessAlive(pid)) {
      cleanupFiles();
      cleanupRelayFiles(SYNAPSE_PORT);
      console.log('Synapse stopped');
      return;
    }
  }

  // Force kill — use taskkill on Windows where SIGKILL is a no-op
  try {
    if (process.platform === 'win32') {
      const { spawnSync } = await import('child_process');
      spawnSync('taskkill', ['/F', '/T', '/PID', String(pid)], { stdio: 'ignore' });
    } else {
      process.kill(pid, 'SIGKILL');
    }
  } catch {
    /* already gone */
  }
  cleanupFiles();
  cleanupRelayFiles(SYNAPSE_PORT);
  console.log('Synapse force-stopped');
}

// ── Helpers ──────────────────────────────────────────────────

async function waitForServer(port: number, timeoutMs: number): Promise<number> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ok = await healthCheck(port);
    if (ok) return port;
    await new Promise((r) => setTimeout(r, 500));
  }
  console.warn('Server did not respond to health check in time; assuming port', port);
  return port;
}
