import express, { type Request, type Response, type NextFunction } from 'express';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import type { IncomingMessage } from 'http';
import rateLimit from 'express-rate-limit';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { timingSafeEqual } from 'crypto';
import { logger } from './lib/logger.js';
import { apiKeyAuth } from './lib/auth.js';
import { requestIdMiddleware } from './lib/requestId.js';
import { Broadcaster } from './services/broadcaster.js';
import { AgentManager } from './services/agentManager.js';
import { createEventsRouter } from './routes/events.js';
import { createAgentsRouter } from './routes/agents.js';
import { createTranscriptRouter } from './routes/transcript.js';
import { createSnapshotRouter } from './routes/snapshot.js';
import { createAnalyticsRouter } from './routes/analytics.js';

import { initDb, getDbStats, closeDb, startPruneTimer } from './db.js';

const PORT = parseInt(process.env.PORT || '4000', 10);

// --- Initialize database (async — sql.js requires WASM init) ---
await initDb();

// Start periodic DB pruning
const pruneTimer = startPruneTimer();

// --- Services ---

const broadcaster = new Broadcaster();
const agentManager = new AgentManager();

// --- Express App ---

const app = express();

// Request ID middleware
app.use(requestIdMiddleware);

// Default body parser (1MB limit for most endpoints)
app.use(express.json({ limit: '1mb' }));

// CORS for client
const clientOrigin = process.env.CORS_ORIGIN || process.env.CLIENT_ORIGIN || 'http://localhost:5173';
const allowedOrigins = clientOrigin.split(',').map((o) => o.trim()).filter(Boolean);

app.use((_req, res, next) => {
  const origin = _req.headers.origin;
  if (allowedOrigins.includes('*')) {
    res.header('Access-Control-Allow-Origin', '*');
  } else if (origin && allowedOrigins.includes(origin)) {
    res.header('Access-Control-Allow-Origin', origin);
  }
  // Non-matching origins get no CORS header — browser will block naturally
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (_req.method === 'OPTIONS') {
    res.sendStatus(204);
    return;
  }
  next();
});

// API key auth (no-op if SYNAPSE_API_KEY not set)
app.use('/api', apiKeyAuth);

// Rate limiting — general API limiter + per-endpoint limiters
const apiLimiter = rateLimit({ windowMs: 60_000, max: 300, standardHeaders: 'draft-8', message: { error: 'Too many requests' } });
const hookLimiter = rateLimit({ windowMs: 60_000, max: 200, standardHeaders: 'draft-8', message: { error: 'Too many requests' } });
const spawnLimiter = rateLimit({ windowMs: 60_000, max: 30, standardHeaders: 'draft-8', message: { error: 'Too many spawn requests' } });
app.use('/api', apiLimiter);
app.use('/api/events', hookLimiter);
app.use('/api/agents/spawn', spawnLimiter);

// Routes (snapshot import gets its own larger body limit)
app.use('/api/events', createEventsRouter(broadcaster));
app.use('/api/agents', createAgentsRouter(agentManager, broadcaster));
app.use('/api/transcript', createTranscriptRouter());
app.use('/api/snapshot/import', express.json({ limit: '50mb' }));
app.use('/api/snapshot', createSnapshotRouter());
app.use('/api/analytics', createAnalyticsRouter());

// Health check
app.get('/api/health', (_req, res) => {
  const dbStats = getDbStats();
  res.json({
    ok: true,
    clients: broadcaster.clientCount,
    agents: agentManager.getActive().length,
    mode: process.env.SYNAPSE_MODE || 'standalone',
    db: dbStats,
  });
});

// --- Serve built frontend (if dist/ exists) ---

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distPath = process.env.SYNAPSE_DASHBOARD_DIR
  || path.resolve(__dirname, '..', '..', '..', 'apps', 'dashboard', 'dist');

if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));
  // SPA fallback: non-API routes serve index.html
  app.get('{*path}', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path === '/ws') return next();
    res.sendFile(path.join(distPath, 'index.html'));
  });
  logger.info({ distPath }, 'Serving frontend from dist');
}

// Global error handler (must be after all route registrations)
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  logger.error({ err }, 'Unhandled error');
  res.status(500).json({ error: 'Internal server error' });
});

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
const wss = new WebSocketServer({ server, path: '/ws' });

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
