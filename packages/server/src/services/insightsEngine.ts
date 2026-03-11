// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bernhard

// ─── Insights Engine ────────────────────────────────────────────────
// Rule-based daily insights: cost spikes, cache improvements, streak tracking.

import { analyticsQueryAll, analyticsQueryGet } from '../db.js';

export type InsightSeverity = 'info' | 'success' | 'warning' | 'critical';
export type InsightCategory = 'cost' | 'efficiency' | 'usage' | 'streak' | 'milestone';

export interface Insight {
  id: string;
  category: InsightCategory;
  severity: InsightSeverity;
  title: string;
  description: string;
  metric?: number;
  delta?: number; // % change from previous period
  date: string; // ISO date
  actionable?: string; // Suggestion for improvement
}

// ─── Generate Daily Insights ────────────────────────────────────────

export function generateDailyInsights(date?: string, cwd?: string): Insight[] {
  const targetDate = date || new Date().toISOString().split('T')[0];
  const insights: Insight[] = [];

  const prevDate = new Date(new Date(targetDate).getTime() - 86_400_000)
    .toISOString()
    .split('T')[0];

  const cwdClause = cwd ? ' AND cwd = ?' : '';
  const cwdParams = cwd ? [cwd] : [];

  // Get today's aggregated data
  const today = analyticsQueryGet(
    `
    SELECT
      SUM(total_cost_usd) as cost,
      SUM(total_input_tokens) as inputTokens,
      SUM(total_output_tokens) as outputTokens,
      SUM(total_cache_read_tokens) as cacheRead,
      SUM(total_sessions) as sessions,
      SUM(total_tool_calls) as toolCalls,
      SUM(total_errors) as errors,
      SUM(total_events) as events
    FROM analytics_daily
    WHERE date = ?${cwdClause}
  `,
    [targetDate, ...cwdParams],
  ) as Record<string, unknown> | undefined;

  const yesterday = analyticsQueryGet(
    `
    SELECT
      SUM(total_cost_usd) as cost,
      SUM(total_input_tokens) as inputTokens,
      SUM(total_output_tokens) as outputTokens,
      SUM(total_cache_read_tokens) as cacheRead,
      SUM(total_sessions) as sessions,
      SUM(total_tool_calls) as toolCalls,
      SUM(total_errors) as errors
    FROM analytics_daily
    WHERE date = ?${cwdClause}
  `,
    [prevDate, ...cwdParams],
  ) as Record<string, unknown> | undefined;

  const todayCost = Number(today?.cost ?? 0);
  const yesterdayCost = Number(yesterday?.cost ?? 0);
  const todaySessions = Number(today?.sessions ?? 0);
  const todayTokens = Number(today?.inputTokens ?? 0) + Number(today?.outputTokens ?? 0);
  const todayCacheRead = Number(today?.cacheRead ?? 0);
  const todayInputTokens = Number(today?.inputTokens ?? 0);
  const todayErrors = Number(today?.errors ?? 0);
  const todayToolCalls = Number(today?.toolCalls ?? 0);

  // If no data, return empty
  if (todaySessions === 0 && todayCost === 0) return insights;

  // ── Cost Insights ──────────────────────────────────────────────

  if (yesterdayCost > 0) {
    const costDelta = ((todayCost - yesterdayCost) / yesterdayCost) * 100;
    if (costDelta > 50) {
      insights.push({
        id: `cost-spike-${targetDate}`,
        category: 'cost',
        severity: 'warning',
        title: 'Cost Spike Detected',
        description: `Today's spending ($${todayCost.toFixed(2)}) is ${Math.round(costDelta)}% higher than yesterday ($${yesterdayCost.toFixed(2)}).`,
        metric: todayCost,
        delta: costDelta,
        date: targetDate,
        actionable: 'Consider using Haiku for simpler tasks or enabling prompt caching.',
      });
    } else if (costDelta < -30) {
      insights.push({
        id: `cost-savings-${targetDate}`,
        category: 'cost',
        severity: 'success',
        title: 'Great Cost Savings',
        description: `You saved ${Math.abs(Math.round(costDelta))}% compared to yesterday! Today: $${todayCost.toFixed(2)}.`,
        metric: todayCost,
        delta: costDelta,
        date: targetDate,
      });
    }
  }

  // ── Efficiency Insights ────────────────────────────────────────

  const cacheHitRate = todayInputTokens > 0 ? todayCacheRead / todayInputTokens : 0;
  if (cacheHitRate > 0.7) {
    insights.push({
      id: `cache-high-${targetDate}`,
      category: 'efficiency',
      severity: 'success',
      title: 'Excellent Cache Hit Rate',
      description: `${Math.round(cacheHitRate * 100)}% cache hit rate today — your prompt patterns are very cache-friendly!`,
      metric: cacheHitRate,
      date: targetDate,
    });
  } else if (cacheHitRate < 0.2 && todayInputTokens > 10_000) {
    insights.push({
      id: `cache-low-${targetDate}`,
      category: 'efficiency',
      severity: 'warning',
      title: 'Low Cache Hit Rate',
      description: `Only ${Math.round(cacheHitRate * 100)}% cache hits today. Consistent prompt prefixes can dramatically improve caching.`,
      metric: cacheHitRate,
      date: targetDate,
      actionable: 'Use system prompts and consistent prefixes to improve cache utilization.',
    });
  }

  // ── Error Rate ─────────────────────────────────────────────────

  if (todayToolCalls > 0) {
    const errorRate = todayErrors / todayToolCalls;
    if (errorRate > 0.1) {
      insights.push({
        id: `errors-high-${targetDate}`,
        category: 'usage',
        severity: 'warning',
        title: 'High Error Rate',
        description: `${Math.round(errorRate * 100)}% of tool calls failed today (${todayErrors} errors / ${todayToolCalls} calls).`,
        metric: errorRate,
        date: targetDate,
        actionable:
          'Review failing tool calls — common causes: file not found, permission denied, syntax errors.',
      });
    }
  }

  // ── Usage Milestones ───────────────────────────────────────────

  // Check cumulative milestones
  const cumulative = analyticsQueryGet(
    `
    SELECT
      SUM(total_cost_usd) as totalCost,
      SUM(total_input_tokens + total_output_tokens) as totalTokens,
      SUM(total_sessions) as totalSessions
    FROM analytics_daily
    WHERE date <= ?${cwdClause}
  `,
    [targetDate, ...cwdParams],
  ) as Record<string, unknown> | undefined;

  const totalSessions = Number(cumulative?.totalSessions ?? 0);
  const totalTokens = Number(cumulative?.totalTokens ?? 0);

  const milestones = [
    { threshold: 100, label: '100 Sessions' },
    { threshold: 500, label: '500 Sessions' },
    { threshold: 1000, label: '1K Sessions' },
  ];

  for (const m of milestones) {
    if (totalSessions >= m.threshold && totalSessions - todaySessions < m.threshold) {
      insights.push({
        id: `milestone-sessions-${m.threshold}-${targetDate}`,
        category: 'milestone',
        severity: 'info',
        title: `Milestone: ${m.label}`,
        description: `You've completed ${totalSessions} AI coding sessions!`,
        metric: totalSessions,
        date: targetDate,
      });
    }
  }

  const tokenMilestones = [
    { threshold: 1_000_000, label: '1M Tokens' },
    { threshold: 10_000_000, label: '10M Tokens' },
    { threshold: 100_000_000, label: '100M Tokens' },
  ];

  for (const m of tokenMilestones) {
    if (totalTokens >= m.threshold && totalTokens - todayTokens < m.threshold) {
      insights.push({
        id: `milestone-tokens-${m.threshold}-${targetDate}`,
        category: 'milestone',
        severity: 'info',
        title: `Milestone: ${m.label}`,
        description: `You've processed ${(totalTokens / 1_000_000).toFixed(1)}M tokens total!`,
        metric: totalTokens,
        date: targetDate,
      });
    }
  }

  // ── Streak Tracking ────────────────────────────────────────────

  const recentDays = analyticsQueryAll(
    `
    SELECT DISTINCT date FROM analytics_daily
    WHERE date <= ?${cwdClause} AND total_sessions > 0
    ORDER BY date DESC
    LIMIT 30
  `,
    [targetDate, ...cwdParams],
  ) as Array<{ date: string }>;

  let streak = 0;
  let checkDate = new Date(targetDate);
  for (const row of recentDays) {
    const expected = checkDate.toISOString().split('T')[0];
    if (row.date === expected) {
      streak++;
      checkDate = new Date(checkDate.getTime() - 86_400_000);
    } else {
      break;
    }
  }

  if (streak >= 7) {
    insights.push({
      id: `streak-${streak}-${targetDate}`,
      category: 'streak',
      severity: 'success',
      title: `${streak}-Day Coding Streak!`,
      description: `You've used AI coding assistance for ${streak} consecutive days. Keep it up!`,
      metric: streak,
      date: targetDate,
    });
  }

  return insights;
}

// ─── Get Insights for Date Range ────────────────────────────────────

export function getInsightsForRange(from: number, to: number, cwd?: string): Insight[] {
  const allInsights: Insight[] = [];
  const startDate = new Date(from);
  const endDate = new Date(to);

  // Generate insights for each day in range (max 30 days)
  let current = new Date(endDate);
  let count = 0;
  while (current >= startDate && count < 30) {
    const dateStr = current.toISOString().split('T')[0];
    allInsights.push(...generateDailyInsights(dateStr, cwd));
    current = new Date(current.getTime() - 86_400_000);
    count++;
  }

  // Sort by severity (critical first) then by date (newest first)
  const severityOrder: Record<InsightSeverity, number> = {
    critical: 0,
    warning: 1,
    success: 2,
    info: 3,
  };
  allInsights.sort((a, b) => {
    const sevDiff = severityOrder[a.severity] - severityOrder[b.severity];
    if (sevDiff !== 0) return sevDiff;
    return b.date.localeCompare(a.date);
  });

  return allInsights;
}
