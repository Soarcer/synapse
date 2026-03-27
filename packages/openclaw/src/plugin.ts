// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bernhard

import type { SynapseConfig, PluginLogger } from './types.js';
import { JsonlBridge } from './layers/jsonlBridge.js';
import { registerSynapseTools } from './layers/agentTools.js';
import { ProviderWrapper } from './layers/providerWrapper.js';
import { spawn, type ChildProcess } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── OpenClaw Plugin API type (minimal shape we depend on) ──────────
// The full type comes from 'openclaw/plugin-sdk/core' at runtime.
// We declare only the surface we use so the plugin builds without
// requiring openclaw as a build-time dependency.

interface OpenClawPluginApi {
  id: string;
  pluginConfig: unknown;
  logger: PluginLogger;
  resolvePath(input: string): string;
  registerTool(
    config: {
      name: string;
      description: string;
      parameters: Record<string, unknown>;
      execute: (
        runId: string,
        params: Record<string, unknown>,
      ) => Promise<{ content: Array<{ type: string; text: string }> }>;
    },
    options?: { optional: boolean },
  ): void;
  registerCommand?(config: {
    name: string;
    description: string;
    handler: (ctx: unknown) => Promise<{ text: string }>;
  }): void;
  on(hookName: string, handler: (...args: unknown[]) => void): void;
}

// ─── Plugin Entry Point ─────────────────────────────────────────────

export default async (api: OpenClawPluginApi) => {
  const config = api.pluginConfig as SynapseConfig;
  const logger = api.logger;
  const port = config.port || 27246;

  logger.info(`[Synapse] Initializing on port ${port}`);

  // ── 1. Detect port collision before spawning ──
  let serverProcess: ChildProcess | undefined;
  const existing = await probePort(port);

  if (existing === 'foreign') {
    throw new Error(
      `[Synapse] Port ${port} is in use by a non-Synapse process. Change the port in plugin config.`,
    );
  }

  if (existing === 'synapse') {
    logger.info(`[Synapse] Reusing existing server on port ${port}`);
  } else {
    // ── 2. Start server (non-blocking) ──
    const serverEntry = config.serverPath ?? path.join(__dirname, 'synapse-server.mjs');
    serverProcess = spawnServer(serverEntry, port, config, logger);
    logger.info(`[Synapse] Server starting on port ${port} (pid: ${serverProcess.pid})`);
  }

  // ── 3. Layer 1: JSONL Bridge ──
  let jsonlBridge: JsonlBridge | undefined;
  if (config.layers?.transcriptWatcher !== false) {
    jsonlBridge = new JsonlBridge(port, logger);
    const watchPaths = config.watchPaths?.length
      ? config.watchPaths
      : [path.join(api.resolvePath('.'), 'agents')];
    for (const wp of watchPaths) jsonlBridge.watchAgentsDir(wp);
    logger.info(`[Synapse] Layer 1: Transcript watcher active (${watchPaths.length} path(s))`);
  }

  // ── 4. Layer 2: Agent Tools (via api.registerTool) ──
  if (config.layers?.agentTools !== false) {
    registerSynapseTools(api, port);
    logger.info('[Synapse] Layer 2: Agent tools registered');
  }

  // ── 5. Layer 3: Provider Wrapper ──
  let providerWrapper: ProviderWrapper | undefined;
  if (config.layers?.providerWrapper && config.wrappedProviders?.length) {
    providerWrapper = new ProviderWrapper(port, config.wrappedProviders, logger);
    logger.info(`[Synapse] Layer 3: Provider wrapper for ${config.wrappedProviders.join(', ')}`);
  }

  // ── 6. Register /synapse command for discoverability ──
  if (typeof api.registerCommand === 'function') {
    api.registerCommand({
      name: 'synapse',
      description: 'Show Synapse dashboard URL and status',
      handler: async () => {
        try {
          const res = await fetch(`http://localhost:${port}/api/health`);
          const h = (await res.json()) as Record<string, unknown>;
          return {
            text: `Synapse dashboard: http://localhost:${port}  (status: ${h.ok ? 'running' : 'error'}, clients: ${h.clients})`,
          };
        } catch {
          return {
            text: `Synapse dashboard: http://localhost:${port}  (status: unreachable)`,
          };
        }
      },
    });
  }

  // ── 7. Cleanup via lifecycle hook ──
  api.on('shutdown', () => {
    jsonlBridge?.stop();
    providerWrapper?.stop();
    if (serverProcess?.pid && !serverProcess.killed) {
      serverProcess.kill('SIGTERM');
    }
  });
};

// ─── Helpers ────────────────────────────────────────────────────────

function spawnServer(
  entry: string,
  port: number,
  config: SynapseConfig,
  logger: PluginLogger,
): ChildProcess {
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    PORT: String(port),
    SYNAPSE_MODE: 'openclaw',
  };
  if (config.dbPath) env.SYNAPSE_DB_PATH = config.dbPath;

  const proc = spawn('node', [entry], {
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  proc.stdout?.on('data', (d: Buffer) => logger.info(`[Synapse Server] ${d.toString().trim()}`));
  proc.stderr?.on('data', (d: Buffer) => logger.warn(`[Synapse Server] ${d.toString().trim()}`));
  proc.on('error', (err) => logger.error(`[Synapse] Server error: ${err.message}`));
  proc.on('exit', (code) => {
    if (code && code !== 0) logger.error(`[Synapse] Server exited: ${code}`);
  });

  return proc;
}

/** Probe a port to detect existing servers. */
async function probePort(port: number): Promise<'synapse' | 'foreign' | 'free'> {
  try {
    const res = await fetch(`http://localhost:${port}/api/health`, {
      signal: AbortSignal.timeout(1000),
    });
    if (!res.ok) return 'foreign';
    const body = (await res.json()) as Record<string, unknown>;
    return body.mode === 'openclaw' || body.ok ? 'synapse' : 'foreign';
  } catch {
    return 'free';
  }
}

/** Wait for server to become healthy (used by tool execute on first call). */
export async function ensureServerReady(port: number, timeoutMs = 10_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`http://localhost:${port}/api/health`);
      if (res.ok) return;
    } catch {
      /* not ready */
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`Synapse server not ready on port ${port} after ${timeoutMs}ms`);
}
