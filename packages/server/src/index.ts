import express, { type Request, type Response, type NextFunction } from 'express';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import rateLimit from 'express-rate-limit';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { logger } from './lib/logger.js';
import { apiKeyAuth } from './lib/auth.js';
import { Broadcaster } from './services/broadcaster.js';
import { AgentManager } from './services/agentManager.js';
import { createEventsRouter } from './routes/events.js';
import { createAgentsRouter } from './routes/agents.js';
import { createTranscriptRouter } from './routes/transcript.js';
import { createSnapshotRouter } from './routes/snapshot.js';

import { initDb, getDbStats, closeDb } from './db.js';

const PORT = parseInt(process.env.PORT || '4000', 10);

// --- Initialize database (async — sql.js requires WASM init) ---
await initDb();

// --- Services ---

const broadcaster = new Broadcaster();
const agentManager = new AgentManager();

// --- Express App ---

const app = express();
app.use(express.json({ limit: '50mb' }));

// CORS for client
const clientOrigin = process.env.CORS_ORIGIN || process.env.CLIENT_ORIGIN || 'http://localhost:5173';
const allowedOrigins = clientOrigin.split(',').map((o) => o.trim()).filter(Boolean);

app.use((_req, res, next) => {
  const origin = _req.headers.origin;
  if (allowedOrigins.includes('*')) {
    res.header('Access-Control-Allow-Origin', '*');
  } else if (origin && allowedOrigins.includes(origin)) {
    res.header('Access-Control-Allow-Origin', origin);
  } else if (allowedOrigins.length > 0) {
    res.header('Access-Control-Allow-Origin', allowedOrigins[0]);
  }
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

// Rate limiting
const hookLimiter = rateLimit({ windowMs: 60_000, max: 200, message: { error: 'Too many requests' } });
const spawnLimiter = rateLimit({ windowMs: 60_000, max: 30, message: { error: 'Too many spawn requests' } });
app.use('/api/events', hookLimiter);
app.use('/api/agents/spawn', spawnLimiter);

// Routes
app.use('/api/events', createEventsRouter(broadcaster));
app.use('/api/agents', createAgentsRouter(agentManager, broadcaster));
app.use('/api/transcript', createTranscriptRouter());
app.use('/api/snapshot', createSnapshotRouter());

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

const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws: WebSocket) => {
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

// --- Start ---

server.listen(PORT, () => {
  logger.info({ port: PORT }, 'Synapse server started');
});

// --- Graceful Shutdown ---

function shutdown() {
  logger.info('Shutting down...');

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
});