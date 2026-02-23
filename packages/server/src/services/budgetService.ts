// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Synapse Contributors

// ─── Budget Service ─────────────────────────────────────────────────
// Budget tracking with weighted moving average prediction and threshold alerts.

import { analyticsQueryAll, analyticsQueryGet } from '../db.js';
import { logger } from '../lib/logger.js';

export interface BudgetConfig {
  dailyLimitUsd: number;
  weeklyLimitUsd: number;
  monthlyLimitUsd: number;
  alertThresholds: number[]; // e.g. [0.5, 0.75, 0.9] for 50%, 75%, 90%
}

export interface BudgetStatus {
  daily: BudgetPeriod;
  weekly: BudgetPeriod;
  monthly: BudgetPeriod;
  forecast: BudgetForecast;
}

export interface BudgetPeriod {
  spent: number;
  limit: number;
  remaining: number;
  percentUsed: number;
  isOverBudget: boolean;
  activeAlerts: string[];
}

export interface BudgetForecast {
  predictedDailyCost: number;
  predictedWeeklyCost: number;
  predictedMonthlyCost: number;
  trend: 'rising' | 'stable' | 'falling';
  confidence: number; // 0-1
}

const DEFAULT_BUDGET: BudgetConfig = {
  dailyLimitUsd: 50,
  weeklyLimitUsd: 250,
  monthlyLimitUsd: 1000,
  alertThresholds: [0.5, 0.75, 0.9],
};

// In-memory budget config (could be persisted to DB in future)
let budgetConfig: BudgetConfig = { ...DEFAULT_BUDGET };

// ─── Public API ─────────────────────────────────────────────────────

export function setBudget(config: Partial<BudgetConfig>): BudgetConfig {
  budgetConfig = { ...budgetConfig, ...config };
  logger.info({ budget: budgetConfig }, 'Budget updated');
  return budgetConfig;
}

export function getBudget(): BudgetConfig {
  return { ...budgetConfig };
}

export function getBudgetStatus(cwd?: string): BudgetStatus {
  const now = new Date();
  const todayStr = now.toISOString().split('T')[0];

  // Calculate period boundaries
  const weekStart = new Date(now.getTime() - now.getDay() * 86_400_000).toISOString().split('T')[0];
  const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;

  const cwdClause = cwd ? ' AND cwd = ?' : '';
  const cwdParams = cwd ? [cwd] : [];

  // Daily spend
  const dailyRow = analyticsQueryGet(
    `
    SELECT SUM(total_cost_usd) as spent FROM analytics_daily
    WHERE date = ?${cwdClause}
  `,
    [todayStr, ...cwdParams],
  ) as Record<string, unknown> | undefined;

  // Weekly spend
  const weeklyRow = analyticsQueryGet(
    `
    SELECT SUM(total_cost_usd) as spent FROM analytics_daily
    WHERE date >= ?${cwdClause}
  `,
    [weekStart, ...cwdParams],
  ) as Record<string, unknown> | undefined;

  // Monthly spend
  const monthlyRow = analyticsQueryGet(
    `
    SELECT SUM(total_cost_usd) as spent FROM analytics_daily
    WHERE date >= ?${cwdClause}
  `,
    [monthStart, ...cwdParams],
  ) as Record<string, unknown> | undefined;

  const daily = buildPeriod(
    Number(dailyRow?.spent ?? 0),
    budgetConfig.dailyLimitUsd,
    budgetConfig.alertThresholds,
  );
  const weekly = buildPeriod(
    Number(weeklyRow?.spent ?? 0),
    budgetConfig.weeklyLimitUsd,
    budgetConfig.alertThresholds,
  );
  const monthly = buildPeriod(
    Number(monthlyRow?.spent ?? 0),
    budgetConfig.monthlyLimitUsd,
    budgetConfig.alertThresholds,
  );

  const forecast = computeForecast(cwd);

  return { daily, weekly, monthly, forecast };
}

// ─── Forecast (Weighted Moving Average) ─────────────────────────────

function computeForecast(cwd?: string): BudgetForecast {
  const cwdClause = cwd ? ' AND cwd = ?' : '';
  const cwdParams = cwd ? [cwd] : [];

  // Get last 14 days of spending
  const rows = analyticsQueryAll(
    `
    SELECT date, SUM(total_cost_usd) as cost
    FROM analytics_daily
    WHERE date >= date('now', '-14 days')${cwdClause}
    GROUP BY date
    ORDER BY date ASC
  `,
    [...cwdParams],
  ) as Array<{ date: string; cost: number }>;

  if (rows.length === 0) {
    return {
      predictedDailyCost: 0,
      predictedWeeklyCost: 0,
      predictedMonthlyCost: 0,
      trend: 'stable',
      confidence: 0,
    };
  }

  // Weighted moving average (recent days have higher weight)
  let weightedSum = 0;
  let weightTotal = 0;
  for (let i = 0; i < rows.length; i++) {
    const weight = i + 1; // linearly increasing weight
    weightedSum += Number(rows[i].cost) * weight;
    weightTotal += weight;
  }

  const predictedDaily = weightTotal > 0 ? weightedSum / weightTotal : 0;

  // Trend detection
  let trend: 'rising' | 'stable' | 'falling' = 'stable';
  if (rows.length >= 3) {
    const recent = rows.slice(-3).reduce((s, r) => s + Number(r.cost), 0) / 3;
    const older =
      rows.slice(0, Math.min(3, rows.length)).reduce((s, r) => s + Number(r.cost), 0) /
      Math.min(3, rows.length);
    if (recent > older * 1.2) trend = 'rising';
    else if (recent < older * 0.8) trend = 'falling';
  }

  // Confidence based on data points
  const confidence = Math.min(1, rows.length / 14);

  return {
    predictedDailyCost: Math.round(predictedDaily * 100) / 100,
    predictedWeeklyCost: Math.round(predictedDaily * 7 * 100) / 100,
    predictedMonthlyCost: Math.round(predictedDaily * 30 * 100) / 100,
    trend,
    confidence: Math.round(confidence * 100) / 100,
  };
}

// ─── Internal Helpers ───────────────────────────────────────────────

function buildPeriod(spent: number, limit: number, thresholds: number[]): BudgetPeriod {
  const remaining = Math.max(0, limit - spent);
  const percentUsed = limit > 0 ? spent / limit : 0;
  const isOverBudget = spent > limit;

  const activeAlerts: string[] = [];
  for (const t of thresholds) {
    if (percentUsed >= t) {
      activeAlerts.push(
        `${Math.round(t * 100)}% of budget used ($${spent.toFixed(2)} / $${limit.toFixed(2)})`,
      );
    }
  }

  return {
    spent: Math.round(spent * 100) / 100,
    limit,
    remaining: Math.round(remaining * 100) / 100,
    percentUsed: Math.round(percentUsed * 1000) / 1000,
    isOverBudget,
    activeAlerts,
  };
}
