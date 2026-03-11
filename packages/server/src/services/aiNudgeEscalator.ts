// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bernhard

import { escalateNudge, isAvailable } from './aiCoachService.js';
import { logger } from '../lib/logger.js';
import type { CoachingNudge, EnrichedNudge } from '@synapse-ai/core';

// ─── Rate Limiting ──────────────────────────────────────────────────

const sessionCallCounts = new Map<string, { count: number; lastReset: number }>();
const MAX_AI_CALLS_PER_SESSION = 5;
const MIN_AI_INTERVAL_MS = 2 * 60_000; // 2 minutes
const sessionLastAiCall = new Map<string, number>();

function canCallAi(sessionId: string): boolean {
  if (!isAvailable()) return false;

  const now = Date.now();

  // Check minimum interval
  const lastCall = sessionLastAiCall.get(sessionId) ?? 0;
  if (now - lastCall < MIN_AI_INTERVAL_MS) return false;

  // Check call count
  const counter = sessionCallCounts.get(sessionId);
  if (counter) {
    // Reset counter every hour
    if (now - counter.lastReset > 3_600_000) {
      sessionCallCounts.set(sessionId, { count: 0, lastReset: now });
    } else if (counter.count >= MAX_AI_CALLS_PER_SESSION) {
      return false;
    }
  }

  return true;
}

function recordAiCall(sessionId: string): void {
  const now = Date.now();
  sessionLastAiCall.set(sessionId, now);

  const counter = sessionCallCounts.get(sessionId) ?? { count: 0, lastReset: now };
  counter.count++;
  sessionCallCounts.set(sessionId, counter);
}

// ─── Sensitivity Thresholds ─────────────────────────────────────────

export type Sensitivity = 'off' | 'low' | 'medium' | 'high';

interface SensitivityConfig {
  periodicInterval: number; // Every N tool calls
  errorSpiralThreshold: number; // N errors to trigger
  costSpikeMultiplier: number; // N times average to trigger
}

const SENSITIVITY_CONFIGS: Record<Sensitivity, SensitivityConfig> = {
  off: { periodicInterval: 0, errorSpiralThreshold: Infinity, costSpikeMultiplier: Infinity },
  low: { periodicInterval: 20, errorSpiralThreshold: 5, costSpikeMultiplier: 3.0 },
  medium: { periodicInterval: 10, errorSpiralThreshold: 3, costSpikeMultiplier: 2.0 },
  high: { periodicInterval: 5, errorSpiralThreshold: 2, costSpikeMultiplier: 1.5 },
};

let currentSensitivity: Sensitivity = 'off';

export function getSensitivity(): Sensitivity {
  return currentSensitivity;
}

export function setSensitivity(level: Sensitivity): void {
  if (!SENSITIVITY_CONFIGS[level]) return;
  currentSensitivity = level;
  logger.info({ level }, 'AI coaching sensitivity updated');
}

export function getSensitivityConfig(): SensitivityConfig {
  return SENSITIVITY_CONFIGS[currentSensitivity];
}

// ─── Tool Call Counter ──────────────────────────────────────────────

const sessionToolCallCounts = new Map<string, number>();

export function incrementToolCallCount(sessionId: string): number {
  const count = (sessionToolCallCounts.get(sessionId) ?? 0) + 1;
  sessionToolCallCounts.set(sessionId, count);
  return count;
}

export function getToolCallCount(sessionId: string): number {
  return sessionToolCallCounts.get(sessionId) ?? 0;
}

export function shouldRunPeriodicCheck(sessionId: string): boolean {
  const config = getSensitivityConfig();
  if (config.periodicInterval <= 0) return false;
  const count = getToolCallCount(sessionId);
  return count > 0 && count % config.periodicInterval === 0;
}

// ─── Smart Triggers ─────────────────────────────────────────────────

interface SmartTriggerContext {
  sessionId: string;
  recentEvents: string[];
  errorCount: number;
  currentCost: number;
  avgCostPerTurn: number;
}

export function checkSmartTriggers(ctx: SmartTriggerContext): {
  triggered: boolean;
  reason: string;
  severity: 'suggestion' | 'warning';
} | null {
  const config = getSensitivityConfig();

  // Error spiral
  if (ctx.errorCount >= config.errorSpiralThreshold) {
    return {
      triggered: true,
      reason: `${ctx.errorCount} errors detected — possible error spiral`,
      severity: 'warning',
    };
  }

  // Cost spike
  if (ctx.avgCostPerTurn > 0 && ctx.currentCost > ctx.avgCostPerTurn * config.costSpikeMultiplier) {
    return {
      triggered: true,
      reason: `Current turn cost ($${ctx.currentCost.toFixed(4)}) is ${(ctx.currentCost / ctx.avgCostPerTurn).toFixed(1)}x the average`,
      severity: 'suggestion',
    };
  }

  return null;
}

// ─── AI Escalation ──────────────────────────────────────────────────

export async function tryEscalateNudge(
  nudge: CoachingNudge,
  recentEvents: string[],
): Promise<EnrichedNudge | null> {
  if (!canCallAi(nudge.sessionId)) return null;

  // Only escalate warnings and above
  if (nudge.severity === 'info') return null;

  try {
    recordAiCall(nudge.sessionId);
    const enriched = await escalateNudge(nudge, recentEvents);
    logger.info(
      { sessionId: nudge.sessionId, detectorId: nudge.detectorId },
      'Nudge escalated with AI',
    );
    return enriched;
  } catch (err) {
    logger.warn({ err, sessionId: nudge.sessionId }, 'AI nudge escalation failed');
    return null;
  }
}

// ─── Cleanup ────────────────────────────────────────────────────────

export function cleanupSession(sessionId: string): void {
  sessionCallCounts.delete(sessionId);
  sessionLastAiCall.delete(sessionId);
  sessionToolCallCounts.delete(sessionId);
}
