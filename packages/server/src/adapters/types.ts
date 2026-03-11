// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bernhard

// ─── Adapter Interface ──────────────────────────────────────────────
// An Adapter translates raw POST /api/events payloads from a specific vendor
// or hook format into a normalized AgentEvent.

import type { AgentEvent } from '@synapse-ai/core';

export interface Adapter {
  /**
   * Unique identifier stored as hook_event_name in the DB for roundtrip
   * source recovery. Convention: lowercase — 'claude', 'gemini', 'codex'.
   */
  readonly id: string;

  /**
   * Canonical vendor string written to AgentEvent.vendor.
   * Must match VENDOR_COLORS keys in @synapse-ai/core.
   */
  readonly vendor: string;

  /**
   * Return true if this adapter should handle the given raw payload.
   * Must be pure, synchronous, and side-effect-free.
   * Must NOT throw — return false on any error.
   */
  detect(raw: Record<string, unknown>): boolean;

  /**
   * Translate the raw payload into a fully-formed AgentEvent.
   * Must assign id, timestamp, vendor, and eventSource.
   */
  normalize(raw: Record<string, unknown>): AgentEvent;

  /**
   * Compute a deduplication fingerprint for the raw payload.
   * The registry applies a 2-second window using this fingerprint.
   * Return null to skip deduplication for this adapter.
   */
  dedupeFingerprint(raw: Record<string, unknown>): string | null;
}
