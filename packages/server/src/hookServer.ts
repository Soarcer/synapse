// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bernhard

import express from 'express';
import crypto from 'crypto';
import os from 'os';
import rateLimit from 'express-rate-limit';
import { logger } from './lib/logger.js';
import type { Broadcaster } from './services/broadcaster.js';
import {
  pending,
  MAX_PENDING,
  PERMISSION_TIMEOUT_MS,
  startConnectionMonitor,
} from './state/permissionState.js';
import { sendToAll } from './services/pushService.js';
import { selectLanIp } from './routes/network.js';
import { createEventsRouter } from './routes/events.js';
import { HOOK_PORT, SYNAPSE_PORT, PROTOCOL } from '@synapse-ai/core/config';

export interface HookAppDeps {
  broadcaster: Broadcaster;
  /** Disable rate limiting (useful for tests) */
  disableRateLimiting?: boolean;
}

/**
 * Creates the hook server Express app (separate from main app).
 * Exported for testing — listen() is called separately in index.ts.
 */
export function createHookApp(deps: HookAppDeps): express.Express {
  const { broadcaster } = deps;
  const app = express();

  app.use(express.json({ limit: '1mb' }));

  // Rate limit: 60 req/min (prevents runaway hook loops)
  if (!deps.disableRateLimiting) {
    app.use(
      rateLimit({
        windowMs: 60_000,
        max: 60,
        standardHeaders: 'draft-8',
        message: { error: 'Too many requests' },
      }),
    );
  }

  // ─── POST /api/hooks/permission ─────────────────────────────────
  // Claude Code POSTs here and BLOCKS waiting for the response.
  // We hold the response open until a user approves/denies via the dashboard.
  app.post('/api/hooks/permission', (req, res) => {
    if (pending.size >= MAX_PENDING) {
      res.status(429).json({ error: 'Too many pending permissions' });
      return;
    }

    const id = crypto.randomUUID();
    const createdAt = Date.now();
    const expiresAt = createdAt + PERMISSION_TIMEOUT_MS;

    const timer = setTimeout(() => {
      pending.delete(id);
      try {
        res.json({
          hookSpecificOutput: {
            hookEventName: 'PermissionRequest',
            decision: {
              behavior: 'deny',
              message: 'Synapse approval timed out. Re-run the task or approve in terminal.',
            },
          },
        });
      } catch {
        // Response may already be closed
      }
    }, PERMISSION_TIMEOUT_MS);

    pending.set(id, { res, event: req.body, timer, createdAt });
    startConnectionMonitor(broadcaster);

    // Note: req.on('close') was removed — it fired unreliably (long delay after
    // local answer in VS Code). Auto-dismiss is handled by resolveIfSessionAdvanced()
    // in events.ts: ANY event from the same session resolves the pending permission.
    // Layer 2 (connection monitor) catches cases where no further events arrive.

    // Broadcast to dashboard via WS
    const toolName = (req.body.tool_name as string) ?? '';
    const rawInput = req.body.tool_input ?? '';
    const toolInput = typeof rawInput === 'string' ? rawInput : JSON.stringify(rawInput);
    broadcaster.broadcastRaw({
      type: 'pendingPermission',
      data: {
        id,
        tool_name: toolName,
        tool_input_preview: toolInput.slice(0, 200),
        tool_input_raw: rawInput,
        createdAt,
        expiresAt,
      },
    });

    // Fire-and-forget push notification with absolute URLs
    const lanIp = selectLanIp(os.networkInterfaces()) ?? 'localhost';
    const baseUrl = `${PROTOCOL}://${lanIp}:${SYNAPSE_PORT}`;

    // Format notification based on tool type
    const isQuestion = toolName === 'AskUserQuestion';
    const timeoutMin = Math.round(PERMISSION_TIMEOUT_MS / 60000);
    const title = isQuestion ? `💬 Claude needs your input` : `🔒 Approve ${toolName || 'action'}?`;
    const body = isQuestion
      ? toolInput.slice(0, 120)
      : `${toolInput.slice(0, 100)}\n⏱ ${timeoutMin}m to respond`;

    sendToAll({
      title,
      body,
      requestId: id,
      decisionUrl: `${baseUrl}/api/permissions/${id}/decision`,
      url: baseUrl,
    }).catch((err) => logger.error({ err }, 'Push send failed'));

    // res intentionally NOT called — held until decision or timeout
  });

  // ─── POST /api/events — event ingestion (same as main server) ───
  // Hook scripts POST here over HTTP, avoiding TLS issues with the main HTTPS server.
  app.use('/api/events', createEventsRouter(broadcaster));

  // ─── GET /api/hook-server/status ────────────────────────────────
  app.get('/api/hook-server/status', (_req, res) => {
    res.json({ running: true, port: HOOK_PORT, pending: pending.size });
  });

  return app;
}
