// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bernhard

// ─── Adapter Registry ───────────────────────────────────────────────
// Manages vendor adapters and dispatches raw events to the correct normalizer.

import type { Adapter } from './types.js';
import type { AgentEvent } from '@synapse-ai/core';
import { logger } from '../lib/logger.js';

const DEDUPE_WINDOW_MS = 2000;

export class AdapterRegistry {
  private readonly adapters: Adapter[] = [];
  private readonly recentEvents = new Map<string, number>();

  /** Register an adapter. First match wins — register specific adapters before catch-all. */
  register(adapter: Adapter): this {
    this.adapters.push(adapter);
    return this;
  }

  /** Find the first adapter that accepts this raw payload. */
  findAdapter(raw: Record<string, unknown>): Adapter | null {
    for (const adapter of this.adapters) {
      try {
        if (adapter.detect(raw)) return adapter;
      } catch {
        logger.warn({ adapterId: adapter.id }, 'Adapter.detect() threw unexpectedly');
      }
    }
    return null;
  }

  /**
   * Full dispatch: detect → dedupe → normalize.
   * Returns null if no adapter matches.
   */
  dispatch(raw: Record<string, unknown>): {
    event: AgentEvent;
    adapter: Adapter;
    isDuplicate: boolean;
  } | null {
    const adapter = this.findAdapter(raw);
    if (!adapter) return null;
    const event = adapter.normalize(raw);
    const isDuplicate = this.checkDedupe(adapter, raw);
    return { event, adapter, isDuplicate };
  }

  /** Clear the dedup cache — exposed for test isolation. */
  clearDedupeCache(): void {
    this.recentEvents.clear();
  }

  private checkDedupe(adapter: Adapter, raw: Record<string, unknown>): boolean {
    const fp = adapter.dedupeFingerprint(raw);
    if (fp === null) return false;

    const now = Date.now();

    // Prune stale entries periodically
    if (this.recentEvents.size > 500) {
      for (const [key, ts] of this.recentEvents) {
        if (now - ts > DEDUPE_WINDOW_MS) this.recentEvents.delete(key);
      }
    }

    const qualifiedFp = `${adapter.id}:${fp}`;
    const prev = this.recentEvents.get(qualifiedFp);
    if (prev && now - prev < DEDUPE_WINDOW_MS) {
      logger.info({ fp: qualifiedFp, deltaMs: now - prev }, 'Duplicate event dropped');
      return true;
    }
    if (prev) {
      logger.info(
        { fp: qualifiedFp, deltaMs: now - prev },
        'Dedup window expired — treating as new',
      );
    }
    this.recentEvents.set(qualifiedFp, now);
    return false;
  }
}

export type { Adapter } from './types.js';
export { ClaudeAdapter, CLAUDE_HOOK_EVENT_NAMES } from './claude.js';
export { GeminiAdapter } from './gemini.js';
export { CodexAdapter, TokenTracker } from './codex.js';
