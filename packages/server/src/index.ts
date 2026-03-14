// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bernhard

import { createServer as createHttpServer } from 'http';
import { createServer as createHttpsServer } from 'https';
import { WebSocketServer, WebSocket } from 'ws';
import type { IncomingMessage } from 'http';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { fileURLToPath } from 'url';
import { timingSafeEqual } from 'crypto';
import express from 'express';
import { logger } from './lib/logger.js';
import { Broadcaster } from './services/broadcaster.js';
import { AgentManager } from './services/agentManager.js';
import { createApp } from './app.js';
import { initDb, closeDb, startPruneTimer } from './db.js';
import { seedBuiltInTemplates } from './services/playbookService.js';
import { registerAllRules } from './services/rules/index.js';
import { createHookApp } from './hookServer.js';
import { pending, stopConnectionMonitor } from './state/permissionState.js';
import { initPush } from './services/pushService.js';
import { selectLanIp } from './routes/network.js';

import {
  SYNAPSE_PORT,
  HOOK_PORT as CONFIG_HOOK_PORT,
  HTTP_FALLBACK_PORT,
  USE_TLS,
} from '@synapse-ai/core/config';

const HOST = process.env.HOST || '0.0.0.0';

// --- Initialize database (async — sql.js requires WASM init) ---
await initDb();

// Register all 30 nudge rules with the engine
registerAllRules();

// Seed built-in session templates if none exist
seedBuiltInTemplates();

// Start periodic DB pruning
const pruneTimer = startPruneTimer();

// Initialize push notification service (reads VAPID keys from env)
initPush();

// --- Services ---

const broadcaster = new Broadcaster();
const agentManager = new AgentManager();

// --- Express App ---

const app = createApp({ broadcaster, agentManager });

// --- Hook server status on main server (must be before catch-all SPA route) ---
let hookServerRunning = false;
app.get('/api/hook-server/status', (_req, res) => {
  res.json({ running: hookServerRunning, port: CONFIG_HOOK_PORT, pending: pending.size });
});

// --- Serve built frontend OR dev status page ---

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const explicitDashDir = process.env.SYNAPSE_DASHBOARD_DIR;
const defaultDistPath = path.resolve(__dirname, '..', '..', '..', 'apps', 'dashboard', 'dist');

const dashDir =
  explicitDashDir && fs.existsSync(explicitDashDir)
    ? explicitDashDir
    : fs.existsSync(defaultDistPath)
      ? defaultDistPath
      : null;

if (dashDir) {
  // Serve the built dashboard (production, VS Code extension, or local dist)
  app.use(express.static(dashDir));
  app.get('{*path}', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path === '/ws') return next();
    res.sendFile(path.join(dashDir, 'index.html'));
  });
  logger.info({ distPath: dashDir }, 'Serving frontend from dist');
} else {
  // No built dashboard found — show minimal status page
  app.get('/', (_req, res) => {
    res.type('html').send(`<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>Synapse Server</title>
<style>
  body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
    background:#0d1117;color:#c9d1d9;font-family:system-ui,sans-serif}
  .card{background:#161b22;border:1px solid #30363d;border-radius:12px;padding:2.5rem;
    max-width:420px;width:100%;text-align:center}
  h1{font-size:1.25rem;margin:0 0 .25rem;color:#e6edf3}
  .status{color:#3fb950;font-size:.875rem;margin-bottom:1.5rem}
  .hint{font-size:.75rem;color:#8b949e}
  code{background:#21262d;padding:.125rem .375rem;border-radius:4px;font-size:.75rem}
</style></head><body>
<div class="card">
  <h1>Synapse Server</h1>
  <div class="status">Running on port ${_req.socket.localPort}</div>
  <div class="hint">No built dashboard found. Run <code>pnpm --filter dashboard build</code> then restart.</div>
</div></body></html>`);
  });
}

// --- HTTP(S) + WebSocket Server ---

const tlsCert = process.env.SYNAPSE_TLS_CERT;
const tlsKey = process.env.SYNAPSE_TLS_KEY;

let server: import('http').Server;
let httpFallbackServer: import('http').Server | null = null;
const usingTls = !!(tlsCert && tlsKey && fs.existsSync(tlsCert) && fs.existsSync(tlsKey));

if (usingTls) {
  server = createHttpsServer(
    { cert: fs.readFileSync(tlsCert!), key: fs.readFileSync(tlsKey!) },
    app,
  );
  logger.info('HTTPS enabled — push notifications available on LAN');
  // Also start an HTTP fallback for mobile Safari (self-signed certs block ES module loads)
  httpFallbackServer = createHttpServer(app);
} else {
  server = createHttpServer(app);
  if (tlsCert || tlsKey) {
    logger.warn('TLS cert/key specified but files not found — falling back to HTTP');
  }
}

// --- Start (fail-loud — no port auto-increment) ---

function failLoudBind(
  srv: import('http').Server,
  port: number,
  host: string,
  label: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    srv.once('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        logger.error({ port, label }, `Port ${port} (${label}) is already in use`);
        console.error(`
ERROR: Port ${port} (${label}) is already in use.
Is another Synapse instance running?

To use a different port:
  $env:SYNAPSE_PORT=${port + 100}; .\\start-server.ps1

All three services will shift together:
  Server:   ${port + 100}
  Hooks:    ${port + 101}
  Fallback: ${port + 102}
`);
        process.exit(1);
      }
      reject(err);
    });
    srv.once('listening', resolve);
    srv.listen(port, host);
  });
}

await failLoudBind(server, SYNAPSE_PORT, HOST, 'main server');
// Stdout protocol: VS Code extension parses this to learn the port
process.stdout.write(`SYNAPSE_PORT=${SYNAPSE_PORT}\n`);
logger.info({ host: HOST, port: SYNAPSE_PORT }, 'Synapse server started');

// --- HTTP fallback for mobile Safari (self-signed certs block ES module loads in CORS mode) ---
if (httpFallbackServer) {
  try {
    await new Promise<void>((resolve, reject) => {
      httpFallbackServer!.once('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'EADDRINUSE') {
          logger.warn(
            { port: HTTP_FALLBACK_PORT },
            'HTTP fallback port in use — mobile may not load',
          );
          resolve();
        } else {
          reject(err);
        }
      });
      httpFallbackServer!.once('listening', resolve);
      httpFallbackServer!.listen(HTTP_FALLBACK_PORT, HOST);
    });
    if (httpFallbackServer.listening) {
      const lanIp = selectLanIp(os.networkInterfaces());
      const mobileUrl = lanIp
        ? `http://${lanIp}:${HTTP_FALLBACK_PORT}`
        : `http://localhost:${HTTP_FALLBACK_PORT}`;
      logger.info(
        { host: HOST, port: HTTP_FALLBACK_PORT, mobileUrl },
        'HTTP fallback started — use this URL on mobile Safari',
      );
    }
  } catch (err) {
    logger.error({ err }, 'HTTP fallback server failed to start');
    httpFallbackServer = null;
  }
}

// --- Hook Server (fixed port for Claude Code HTTP hooks) ---
const hookApp = createHookApp({ broadcaster });
const hookHttpServer = createHttpServer(hookApp);
hookHttpServer.timeout = 0; // No request timeout — permissions can be held for 30+ min

try {
  await new Promise<void>((resolve, reject) => {
    hookHttpServer.once('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        logger.warn(
          { port: CONFIG_HOOK_PORT },
          'Hook server port in use — permission routing unavailable',
        );
        resolve(); // Graceful degradation
      } else {
        reject(err);
      }
    });
    hookHttpServer.once('listening', () => {
      hookServerRunning = true;
      resolve();
    });
    hookHttpServer.listen(CONFIG_HOOK_PORT, HOST);
  });
  if (hookServerRunning) {
    logger.info({ host: HOST, port: CONFIG_HOOK_PORT }, 'Hook server started');
  }
} catch (err) {
  logger.error({ err }, 'Hook server failed to start');
}

// Attach WebSocket server AFTER port is bound (avoids WSS catching EADDRINUSE errors)
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 1 * 1024 * 1024 }); // 1MB max message

// Also attach WS to HTTP fallback so mobile Safari gets live updates
const httpFallbackWss = httpFallbackServer?.listening
  ? new WebSocketServer({ server: httpFallbackServer, path: '/ws', maxPayload: 1 * 1024 * 1024 })
  : null;

function handleWsConnection(ws: WebSocket, req: IncomingMessage) {
  // WS authentication: validate token query param when API key is set
  const apiKey = process.env.SYNAPSE_API_KEY;
  if (apiKey) {
    const url = new URL(req.url ?? '', `http://${req.headers.host}`);
    const token = url.searchParams.get('token') ?? '';
    const a = Buffer.from(token);
    const b = Buffer.from(apiKey);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      ws.close(4001, 'Unauthorized');
      return;
    }
  }

  logger.info({ clients: broadcaster.clientCount + 1 }, 'WS client connected');
  broadcaster.addClient(ws, agentManager.getActive());

  ws.on('close', () => {
    broadcaster.removeClient(ws);
    logger.info({ clients: broadcaster.clientCount }, 'WS client disconnected');
  });

  ws.on('error', (err) => {
    logger.error({ err }, 'WS client error');
    broadcaster.removeClient(ws);
  });
}

wss.on('connection', handleWsConnection);
httpFallbackWss?.on('connection', handleWsConnection);

// --- Graceful Shutdown ---

function shutdown() {
  logger.info('Shutting down...');

  // 0. Stop prune timer and connection monitor
  if (pruneTimer) clearInterval(pruneTimer);
  stopConnectionMonitor();

  // 1. Drain pending permissions — deny all before shutdown
  for (const [, entry] of pending.entries()) {
    clearTimeout(entry.timer);
    try {
      entry.res.json({
        hookSpecificOutput: {
          hookEventName: 'PermissionRequest',
          decision: { behavior: 'deny', message: 'Synapse server is shutting down.' },
        },
      });
    } catch {
      // Response may already be closed
    }
  }
  pending.clear();

  // 2. Close hook server
  if (hookServerRunning) {
    hookHttpServer.close(() => {
      logger.info('Hook server closed');
    });
  }

  // 3. Stop all running agents (clears timeout + cleanup timers)
  agentManager.stopAll();

  // 4. Stop heartbeat and close all WebSocket connections
  broadcaster.destroy();
  for (const client of wss.clients) {
    client.close(1001, 'Server shutting down');
  }
  wss.close();
  if (httpFallbackWss) {
    for (const client of httpFallbackWss.clients) {
      client.close(1001, 'Server shutting down');
    }
    httpFallbackWss.close();
  }

  // 5. Close HTTP(S) servers (stop accepting new connections)
  server.close(() => {
    logger.info('HTTP server closed, draining...');
  });
  httpFallbackServer?.close();

  // 6. Drain period: close DB after 5s, then exit
  const drainTimer = setTimeout(() => {
    closeDb();
    logger.info('Shutdown complete');
    process.exit(0);
  }, 5000);

  // Force exit after 10 seconds if graceful shutdown stalls
  const forceTimer = setTimeout(() => {
    logger.error('Forced shutdown after timeout');
    process.exit(1);
  }, 10_000);

  // Don't let these timers prevent exit if everything else is done
  if (drainTimer.unref) drainTimer.unref();
  if (forceTimer.unref) forceTimer.unref();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

process.on('uncaughtException', (err) => {
  logger.error({ err }, 'Uncaught exception');
  shutdown();
});
process.on('unhandledRejection', (reason) => {
  logger.error({ err: reason }, 'Unhandled rejection');
  shutdown();
});
