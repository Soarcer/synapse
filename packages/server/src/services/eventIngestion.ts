// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bernhard

/**
 * eventIngestion.ts — shared event processing pipeline.
 *
 * Extracted from routes/events.ts so both the HTTP route and the
 * FileEventRelay can call the same normalization + storage logic
 * without going through an HTTP round-trip.
 */

import { storeNormalized, storePreNormalized } from './eventStore.js';
import type { Broadcaster } from './broadcaster.js';
import { logger } from '../lib/logger.js';
import { registry } from '../routes/events.js';
import { pending } from '../state/permissionState.js';
import { buildPermissionResolved } from '../state/permissionResolved.js';

/**
 * Auto-resolve pending permissions when there is clear evidence the tool
 * completed or the session ended — meaning the user answered locally.
 */
const RESOLVE_EVENTS = new Set(['PostToolUse', 'PostToolUseFailure', 'Stop']);

export function resolveIfSessionAdvanced(
  raw: Record<string, unknown>,
  broadcaster: Broadcaster,
): void {
  if (pending.size === 0) return;

  const hookName = raw.hook_event_name as string | undefined;
  if (!hookName || !RESOLVE_EVENTS.has(hookName)) return;

  const sessionId = raw.session_id as string | undefined;
  if (!sessionId) return;

  for (const [id, entry] of pending) {
    if (entry.event.session_id !== sessionId) continue;

    const behavior = hookName === 'PostToolUseFailure' ? 'deny' : 'allow';
    clearTimeout(entry.timer);
    pending.delete(id);
    try {
      entry.res.json({
        hookSpecificOutput: {
          hookEventName: 'PermissionRequest',
          decision: { behavior },
        },
      });
    } catch {
      // Response already closed
    }
    broadcaster.broadcastRaw(buildPermissionResolved(id, behavior, entry.event));
    logger.info({ id, sessionId, hookName }, 'Permission auto-resolved: session advanced');
  }
}

export type IngestResult =
  | { ok: true; eventId: string; deduplicated?: boolean }
  | { ok: false; reason: 'no_adapter' }
  | { ok: false; reason: 'error'; err: unknown };

/**
 * Process a raw hook payload through the full normalization + storage pipeline.
 * Called by both the HTTP /api/events route and the FileEventRelay.
 *
 * Returns a result object — callers can log or ignore it.
 * Never throws.
 */
export function ingestRawEvent(
  raw: Record<string, unknown>,
  broadcaster: Broadcaster,
): IngestResult {
  try {
    // Pre-normalized events from OpenClaw plugin bypass the adapter registry
    if (raw.eventSource === 'openclaw' && raw.id && raw.type && raw.sessionId) {
      storePreNormalized(raw as Parameters<typeof storePreNormalized>[0], broadcaster);
      logger.info(
        { eventSource: 'openclaw', type: raw.type, sessionId: raw.sessionId },
        'Event received',
      );
      return { ok: true, eventId: raw.id as string };
    }

    const result = registry.dispatch(raw);

    if (!result) {
      logger.warn({ keys: Object.keys(raw) }, 'No adapter matched payload');
      return { ok: false, reason: 'no_adapter' };
    }

    const { event, adapter, isDuplicate } = result;

    if (isDuplicate) {
      return { ok: true, eventId: event.id, deduplicated: true };
    }

    storeNormalized(event, broadcaster, {
      hookEventName: adapter.id,
      rawPayload: raw,
    });

    logger.info(
      {
        adapter: adapter.id,
        hookEvent: raw.hook_event_name || 'unknown',
        type: event.type,
        sessionId: event.sessionId,
      },
      'Event received',
    );

    resolveIfSessionAdvanced(raw, broadcaster);

    return { ok: true, eventId: event.id };
  } catch (err: unknown) {
    logger.error({ err }, 'ingestRawEvent: unexpected error');
    return { ok: false, reason: 'error', err };
  }
}
