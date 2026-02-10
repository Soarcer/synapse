import express, { type Request, type Response, type NextFunction } from 'express';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import rateLimit from 'express-rate-limit';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { Broadcaster } from './services/broadcaster.js';
import { AgentManager } from './services/agentManager.js';
import { createEventsRouter } from './routes/events.js';
import { createAgentsRouter } from './routes/agents.js';
import { createTranscriptRouter } from './routes/transcript.js';
import { createSnapshotRouter } from './routes/snapshot.js';

// Import db.ts to trigger schema initialization
import db from './db.js';

const PORT = parseInt(process.env.PORT || '4000', 10);

// --- Services ---

const broadcaster = new Broadcaster();
const agentManager = new AgentManager();

// --- Express App ---

const app = express();
app.use(express.json({ limit: '50mb' }));

// CORS for client
const clientOrigin = process.env.CLIENT_ORIGIN || 'http://localhost:5173';
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
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (_req.method === 'OPTIONS') {
    res.sendStatus(204);
    return;
  }
  next();
});

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
  res.json({ ok: true, clients: broadcaster.clientCount });
});

// --- Serve built frontend (if dist/ exists) ---

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distPath = path.resolve(__dirname, '..', 'dist');

if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));
  // SPA fallback: non-API routes serve index.html
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path === '/ws') return next();
    res.sendFile(path.join(distPath, 'index.html'));
  });
  console.log(`[Server] Serving frontend from ${distPath}`);
}

// Global error handler (must be after all route registrations)
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('[Server] Unhandled error:', err.stack);
  res.status(500).json({ error: 'Internal server error' });
});

// --- HTTP + WebSocket Server ---

const server = createServer(app);

const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws: WebSocket) => {
  console.log(`[WS] Client connected (total: ${broadcaster.clientCount + 1})`);
  broadcaster.addClient(ws, agentManager.getActive());

  ws.on('close', () => {
    broadcaster.removeClient(ws);
    console.log(`[WS] Client disconnected (total: ${broadcaster.clientCount})`);
  });

  ws.on('error', (err) => {
    console.error('[WS] Client error:', err);
    broadcaster.removeClient(ws);
  });
});

// --- Start ---

server.listen(PORT, () => {
  console.log('');
  console.log('  Synapse Server');
  console.log(`  HTTP:  http://localhost:${PORT}`);
  console.log(`  WS:    ws://localhost:${PORT}/ws`);
  console.log('');
});

// --- Graceful Shutdown ---

function shutdown() {
  console.log('\n[Server] Shutting down...');

  // 1. Stop all running agents
  agentManager.stopAll();

  // 2. Close all WebSocket connections
  for (const client of wss.clients) {
    client.close(1001, 'Server shutting down');
  }
  wss.close();

  // 3. Close HTTP server
  server.close(() => {
    // 4. Close SQLite database
    try { db.close(); } catch { /* already closed */ }
    console.log('[Server] Shutdown complete.');
    process.exit(0);
  });

  // Force exit after 5 seconds if graceful shutdown stalls
  setTimeout(() => {
    console.error('[Server] Forced shutdown after timeout.');
    process.exit(1);
  }, 5000);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

process.on('uncaughtException', (err) => {
  console.error('[Server] Uncaught exception:', err);
  shutdown();
});
process.on('unhandledRejection', (reason) => {
  console.error('[Server] Unhandled rejection:', reason);
});