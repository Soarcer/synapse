// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Synapse Contributors

import express, { type Request, type Response, type NextFunction } from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { apiKeyAuth } from './lib/auth.js';
import { requestIdMiddleware } from './lib/requestId.js';
import { Broadcaster } from './services/broadcaster.js';
import { AgentManager } from './services/agentManager.js';
import { createEventsRouter } from './routes/events.js';
import { createAgentsRouter } from './routes/agents.js';
import { createTranscriptRouter } from './routes/transcript.js';
import { createSnapshotRouter } from './routes/snapshot.js';
import { createAnalyticsRouter } from './routes/analytics.js';
import { createCoachingRouter } from './routes/coaching.js';
import { createSettingsRouter } from './routes/settings.js';
import { getDbStats } from './db.js';
import { logger } from './lib/logger.js';

export interface AppDeps {
  broadcaster: Broadcaster;
  agentManager: AgentManager;
  /** Comma-separated list of allowed origins (default 'http://localhost:5173') */
  corsOrigins?: string;
  /** Disable rate limiting (useful for tests) */
  disableRateLimiting?: boolean;
}

export function createApp(deps: AppDeps) {
  const { broadcaster, agentManager } = deps;
  const app = express();

  // Security headers (frameguard disabled — dashboard is loaded inside VS Code webview iframes)
  app.use(helmet({ contentSecurityPolicy: false, frameguard: false }));

  // Request ID middleware
  app.use(requestIdMiddleware);

  // Default body parser (1MB limit for most endpoints)
  app.use(express.json({ limit: '1mb' }));

  // CORS for client
  const clientOrigin =
    deps.corsOrigins ||
    process.env.CORS_ORIGIN ||
    process.env.CLIENT_ORIGIN ||
    'http://localhost:5173';
  const allowedOrigins = clientOrigin
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);

  app.use((_req, res, next) => {
    const origin = _req.headers.origin;
    if (allowedOrigins.includes('*')) {
      res.header('Access-Control-Allow-Origin', '*');
    } else if (origin && allowedOrigins.includes(origin)) {
      res.header('Access-Control-Allow-Origin', origin);
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

  // Rate limiting (can be disabled for tests)
  if (!deps.disableRateLimiting || process.env.NODE_ENV === 'production') {
    const apiLimiter = rateLimit({
      windowMs: 60_000,
      max: 300,
      standardHeaders: 'draft-8',
      message: { error: 'Too many requests' },
    });
    const hookLimiter = rateLimit({
      windowMs: 60_000,
      max: 200,
      standardHeaders: 'draft-8',
      message: { error: 'Too many requests' },
    });
    const spawnLimiter = rateLimit({
      windowMs: 60_000,
      max: 30,
      standardHeaders: 'draft-8',
      message: { error: 'Too many spawn requests' },
    });
    app.use('/api', apiLimiter);
    app.use('/api/events', hookLimiter);
    app.use('/api/agents/spawn', spawnLimiter);
  }

  // Routes (snapshot import gets its own larger body limit)
  app.use('/api/events', createEventsRouter(broadcaster));
  app.use('/api/agents', createAgentsRouter(agentManager, broadcaster));
  app.use('/api/transcript', createTranscriptRouter());
  app.use('/api/snapshot/import', express.json({ limit: '50mb' }));
  app.use('/api/snapshot', createSnapshotRouter());
  app.use('/api/analytics', createAnalyticsRouter(broadcaster));
  app.use('/api/analytics/coaching', createCoachingRouter());
  app.use('/api/settings', createSettingsRouter());

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

  // Global error handler (must be after all route registrations)
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    logger.error({ err }, 'Unhandled error');
    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}
