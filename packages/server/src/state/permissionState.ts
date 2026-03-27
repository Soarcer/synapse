// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bernhard

import type { Response } from 'express';
import type { ClaudeHookEvent } from '@synapse-ai/core';
import { logger } from '../lib/logger.js';
import type { Broadcaster } from '../services/broadcaster.js';
import { hasCompletionForSessionSince } from '../db.js';
import { buildPermissionResolved } from './permissionResolved.js';

export interface PendingEntry {
  res: Response;
  event: ClaudeHookEvent;
  timer: NodeJS.Timeout;
  createdAt: number;
}

export interface DecisionEntry {
  behavior: 'allow' | 'deny';
  expiresAt: number;
}

export const pending = new Map<string, PendingEntry>();
export const decisions = new Map<string, DecisionEntry>();
export const MAX_PENDING = 50;

/** Default 30 min. Overridable via env var. */
export const PERMISSION_TIMEOUT_MS = parseInt(
  process.env.SYNAPSE_PERMISSION_TIMEOUT_MS ?? '1800000',
  10,
);

export function purgeExpiredDecisions(): void {
  const now = Date.now();
  for (const [id, d] of decisions.entries()) {
    if (d.expiresAt < now) decisions.delete(id);
  }
}

// ── Layer 2: Connection monitor ───────────────────────────────
// Periodically checks if the held HTTP response socket is still alive.
// When Claude Code answers locally and closes the connection, this detects
// the dead socket and resolves the permission within ~2 seconds.

const CONNECTION_CHECK_INTERVAL_MS = 2000;
let connectionMonitor: ReturnType<typeof setInterval> | null = null;
let monitorBroadcaster: Broadcaster | null = null;

export function startConnectionMonitor(broadcaster: Broadcaster): void {
  monitorBroadcaster = broadcaster;
  if (connectionMonitor) return; // Already running

  connectionMonitor = setInterval(() => {
    purgeExpiredDecisions();

    if (pending.size === 0) {
      stopConnectionMonitor();
      return;
    }

    for (const [id, entry] of pending) {
      const res = entry.res as unknown as {
        writableEnded?: boolean;
        socket?: { destroyed?: boolean } | null;
      };
      const socketDead = res.socket?.destroyed ?? false;
      const writableEnded = res.writableEnded ?? false;

      // Layer 2a: socket closed (Claude Code dropped the connection)
      // Layer 2b: session advanced in DB (events arrived after permission was created,
      //           but socket stayed alive — e.g. Claude Code answered locally and proceeded
      //           without aborting the HTTP hook request)
      const sessionId = entry.event.session_id as string | undefined;
      const sessionAdvanced =
        sessionId != null && hasCompletionForSessionSince(sessionId, entry.createdAt);

      if (socketDead || writableEnded || sessionAdvanced) {
        const reason = socketDead || writableEnded ? 'connection closed' : 'session advanced (DB)';
        clearTimeout(entry.timer);
        pending.delete(id);

        // Only send HTTP response if socket is still alive
        if (sessionAdvanced && !socketDead && !writableEnded) {
          try {
            entry.res.json({
              hookSpecificOutput: {
                hookEventName: 'PermissionRequest',
                decision: { behavior: 'allow' },
              },
            });
          } catch {
            // Response may already be closed
          }
        }

        const behavior = sessionAdvanced ? 'allow' : 'auto-dismissed';
        monitorBroadcaster?.broadcastRaw(buildPermissionResolved(id, behavior, entry.event));
        logger.info({ id, reason }, 'Permission auto-dismissed (Layer 2)');
      }
    }
  }, CONNECTION_CHECK_INTERVAL_MS);
}

export function stopConnectionMonitor(): void {
  if (connectionMonitor) {
    clearInterval(connectionMonitor);
    connectionMonitor = null;
  }
}
