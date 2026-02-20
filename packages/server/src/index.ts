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
import { seedBuiltInTemplates } from './services/playbookService.js';
import { registerAllRules } from './services/rules/index.js';

const PORT = parseInt(process.env.PORT || '4000', 10);

// --- Initialize database (async — sql.js requires WASM init) ---
await initDb();

// Register all 30 nudge rules with the engine
registerAllRules();

// Seed built-in session templates if none exist
seedBuiltInTemplates();

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

const dashDir = (explicitDashDir && fs.existsSync(explicitDashDir))
  ? explicitDashDir
  : fs.existsSync(defaultDistPath) ? defaultDistPath : null;

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
