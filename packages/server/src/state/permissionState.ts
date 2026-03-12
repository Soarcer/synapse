// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bernhard

import type { Response } from 'express';
import type { ClaudeHookEvent } from '@synapse-ai/core';

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
