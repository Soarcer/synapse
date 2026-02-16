import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import type { IncomingMessage } from 'http';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { timingSafeEqual } from 'crypto';
import express from 'express';
import { logger } from './lib/logger.js';
import { Broadcaster } from './services/broadcaster.js';
import { AgentManager } from './services/agentManager.js';
import { createApp } from './app.js';
import { initDb, closeDb, startPruneTimer, getDbStats } from './db.js';

const PORT = parseInt(process.env.PORT || '4000', 10);

// --- Initialize database (async — sql.js requires WASM init) ---
await initDb();

// Start periodic DB pruning
const pruneTimer = startPruneTimer();

// --- Services ---

const broadcaster = new Broadcaster();
const agentManager = new AgentManager();

// --- Express App ---

const app = createApp({ broadcaster, agentManager });

// --- Serve built frontend OR dev status page ---

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const explicitDashDir = process.env.SYNAPSE_DASHBOARD_DIR;
const defaultDistPath = path.resolve(__dirname, '..', '..', '..', 'apps', 'dashboard', 'dist');

if (explicitDashDir && fs.existsSync(explicitDashDir)) {
  // Production / VS Code extension: serve the bundled dashboard
  app.use(express.static(explicitDashDir));
  app.get('{*path}', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path === '/ws') return next();
    res.sendFile(path.join(explicitDashDir, 'index.html'));
  });
  logger.info({ distPath: explicitDashDir }, 'Serving frontend from dist');
} else {
  // Standalone dev: minimal status page with link to Vite dev server
  const devPort = process.env.VITE_DEV_PORT || '5173';
  app.get('/', (_req, res) => {
    const dbStats = getDbStats();
    res.type('html').send(`<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>Synapse Server</title>
<style>
  body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
    background:#0d1117;color:#c9d1d9;font-family:system-ui,sans-serif}
  .card{background:#161b22;border:1px solid #30363d;border-radius:12px;padding:2.5rem;
    max-width:420px;width:100%;text-align:center}
  h1{font-size:1.25rem;margin:0 0 .25rem;color:#e6edf3}
  .status{color:#3fb950;font-size:.875rem;margin-bottom:1.5rem}
  .stats{display:grid;grid-template-columns:1fr 1fr;gap:.75rem;margin-bottom:1.5rem;text-align:left}
  .stat{background:#0d1117;border:1px solid #21262d;border-radius:8px;padding:.75rem}
  .stat-label{font-size:.625rem;text-transform:uppercase;letter-spacing:.05em;color:#8b949e}
  .stat-value{font-size:1.125rem;font-weight:600;color:#e6edf3;margin-top:.125rem}
  a.btn{display:inline-block;padding:.625rem 1.5rem;background:#238636;color:#fff;
    border-radius:6px;text-decoration:none;font-weight:500;font-size:.875rem}
  a.btn:hover{background:#2ea043}
  .hint{margin-top:1rem;font-size:.75rem;color:#8b949e}
  code{background:#21262d;padding:.125rem .375rem;border-radius:4px;font-size:.75rem}
</style></head><body>
<div class="card">
  <h1>Synapse Server</h1>
  <div class="status">Running on port ${_req.socket.localPort}</div>
  <div class="stats">
    <div class="stat"><div class="stat-label">Events</div><div class="stat-value">${dbStats?.totalEvents ?? 0}</div></div>
    <div class="stat"><div class="stat-label">Sessions</div><div class="stat-value">${dbStats?.totalSessions ?? 0}</div></div>
    <div class="stat"><div class="stat-label">WS Clients</div><div class="stat-value">${broadcaster.clientCount}</div></div>
    <div class="stat"><div class="stat-label">Agents</div><div class="stat-value">${agentManager.getActive().length}</div></div>
  </div>
  <a class="btn" href="http://localhost:${devPort}">Open Dashboard</a>
  <div class="hint">Dev server: <code>http://localhost:${devPort}</code></div>
</div></body></html>`);
  });
  if (fs.existsSync(defaultDistPath)) {
    logger.info({ distPath: defaultDistPath }, 'Stale dist/ found but ignored in dev mode (set SYNAPSE_DASHBOARD_DIR to serve it)');
  }
}

// --- HTTP + WebSocket Server ---

const server = createServer(app);

// --- Start (auto-scan ports if preferred is busy) ---

const MAX_PORT_RETRIES = 20;

function tryListen(preferredPort: number): Promise<number> {
  return new Promise((resolve, reject) => {
    let attempt = 0;
    const tryPort = (port: number) => {
      const onError = (err: NodeJS.ErrnoException) => {
        server.removeListener('listening', onListening);
        if (err.code === 'EADDRINUSE' && attempt < MAX_PORT_RETRIES) {
          attempt++;
          logger.info({ port, nextPort: port + 1 }, 'Port in use, trying next');
          tryPort(port + 1);
        } else {
          reject(err);
        }
      };
      const onListening = () => {
        server.removeListener('error', onError);
        resolve(port);
      };
      server.once('error', onError);
      server.once('listening', onListening);
      server.listen(port);
    };
    tryPort(preferredPort);
  });
}

const actualPort = await tryListen(PORT);
// Stdout protocol: VS Code extension parses this to learn the actual port
process.stdout.write(`SYNAPSE_PORT=${actualPort}\n`);
logger.info({ port: actualPort }, 'Synapse server started');

// Attach WebSocket server AFTER port is bound (avoids WSS catching EADDRINUSE errors)
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 1 * 1024 * 1024 }); // 1MB max message

wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
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
});

// --- Graceful Shutdown ---

function shutdown() {
  logger.info('Shutting down...');

  // 0. Stop prune timer
  if (pruneTimer) clearInterval(pruneTimer);

  // 1. Stop all running agents (clears timeout + cleanup timers)
  agentManager.stopAll();

  // 2. Stop heartbeat and close all WebSocket connections
  broadcaster.destroy();
  for (const client of wss.clients) {
    client.close(1001, 'Server shutting down');
  }
  wss.close();

  // 3. Close HTTP server first (stop accepting new connections)
  server.close(() => {
    logger.info('HTTP server closed, draining...');
  });

  // 4. Drain period: close DB after 5s, then exit
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
