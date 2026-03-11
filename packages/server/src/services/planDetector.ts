// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bernhard

import fs from 'fs';
import path from 'path';
import os from 'os';
import { logger } from '../lib/logger.js';
import { getSetting, setSetting } from '../db.js';

// ─── Plan Types ──────────────────────────────────────────────────────

export interface ClaudePlan {
  plan: string;
  monthlyLimit: number | null; // null = unlimited (API pay-as-you-go)
  detected: boolean;
  source: 'auto' | 'manual';
}

const PLAN_LIMITS: Record<string, number | null> = {
  free: 0,
  pro: 20, // $20/mo
  max_5x: 100, // $100/mo
  max_20x: 200, // $200/mo
  team: 30, // $30/user/mo
  api: null, // pay-as-you-go, no fixed limit
};

const PLAN_LABELS: Record<string, string> = {
  free: 'Free',
  pro: 'Pro ($20/mo)',
  max_5x: 'Max 5x ($100/mo)',
  max_20x: 'Max 20x ($200/mo)',
  team: 'Team ($30/user/mo)',
  api: 'API (pay-as-you-go)',
};

// ─── Detection ──────────────────────────────────────────────────────

function findClaudeConfig(): string | undefined {
  const candidates: string[] = [];

  // macOS / Linux
  const home = os.homedir();
  candidates.push(path.join(home, '.claude', 'settings.json'));
  candidates.push(path.join(home, '.claude.json'));

  // Windows AppData
  const appData = process.env.APPDATA;
  if (appData) {
    candidates.push(path.join(appData, 'Claude', 'settings.json'));
    candidates.push(path.join(appData, 'claude-code', 'settings.json'));
  }

  // Windows LocalAppData
  const localAppData = process.env.LOCALAPPDATA;
  if (localAppData) {
    candidates.push(path.join(localAppData, 'Claude', 'settings.json'));
  }

  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) return candidate;
    } catch {
      // Permission denied, etc.
    }
  }
  return undefined;
}

function inferPlanFromConfig(configPath: string): string | undefined {
  try {
    const raw = fs.readFileSync(configPath, 'utf-8');
    const config = JSON.parse(raw);

    // Look for plan-related fields
    if (config.plan) return normalizePlanName(config.plan);
    if (config.subscription?.plan) return normalizePlanName(config.subscription.plan);

    // Infer from API key presence
    if (config.apiKey || process.env.ANTHROPIC_API_KEY) return 'api';

    return undefined;
  } catch (err) {
    logger.debug({ err, configPath }, 'Could not read Claude config');
    return undefined;
  }
}

function normalizePlanName(raw: string): string {
  const lower = raw.toLowerCase().replace(/[^a-z0-9]/g, '_');
  if (lower.includes('max') && lower.includes('20')) return 'max_20x';
  if (lower.includes('max') && lower.includes('5')) return 'max_5x';
  if (lower.includes('max')) return 'max_5x';
  if (lower.includes('team')) return 'team';
  if (lower.includes('pro')) return 'pro';
  if (lower.includes('free')) return 'free';
  if (lower.includes('api')) return 'api';
  return 'pro'; // default assumption
}

// ─── Public API ─────────────────────────────────────────────────────

const SETTING_KEY = 'claude_plan';

export function detectPlan(): ClaudePlan {
  // Check manual override first
  const manual = getSetting(SETTING_KEY);
  if (manual && PLAN_LIMITS[manual] !== undefined) {
    return {
      plan: manual,
      monthlyLimit: PLAN_LIMITS[manual] ?? null,
      detected: true,
      source: 'manual',
    };
  }

  // Try auto-detection
  const configPath = findClaudeConfig();
  if (configPath) {
    const plan = inferPlanFromConfig(configPath);
    if (plan && PLAN_LIMITS[plan] !== undefined) {
      return {
        plan,
        monthlyLimit: PLAN_LIMITS[plan] ?? null,
        detected: true,
        source: 'auto',
      };
    }
  }

  // Check if API key exists → assume API plan
  if (process.env.ANTHROPIC_API_KEY) {
    return { plan: 'api', monthlyLimit: null, detected: true, source: 'auto' };
  }

  // Fallback: Pro plan assumption
  return { plan: 'pro', monthlyLimit: 20, detected: false, source: 'auto' };
}

export function setPlan(plan: string): ClaudePlan {
  if (!Object.hasOwn(PLAN_LIMITS, plan)) {
    throw new Error(`Unknown plan: ${plan}. Valid: ${Object.keys(PLAN_LIMITS).join(', ')}`);
  }
  setSetting(SETTING_KEY, plan);
  return {
    plan,
    monthlyLimit: PLAN_LIMITS[plan] ?? null,
    detected: true,
    source: 'manual',
  };
}

export function getPlanLabels(): Record<string, string> {
  return { ...PLAN_LABELS };
}

export function getPlanLimits(): Record<string, number | null> {
  return { ...PLAN_LIMITS };
}
