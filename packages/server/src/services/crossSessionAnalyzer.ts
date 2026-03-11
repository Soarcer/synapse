// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bernhard

// ─── Cross-Session Pattern Analyzer ──────────────────────────────────
// Detects patterns that only emerge across multiple sessions:
// - Recurring bad habits (same rule fires repeatedly)
// - Improvement trends (dimension scores rising)
// - Regression alerts (dimension scores dropping)
// - Personal best highlights

import { logger } from '../lib/logger.js';
import { getNudgeStats, getRecentReportCards as dbGetRecentReportCards } from '../db.js';
import type { CoachingDimension } from '@synapse-ai/core';

// ─── Cross-Session Insight Types ─────────────────────────────────────

export interface CrossSessionInsight {
  type: 'habit' | 'improvement' | 'regression' | 'personal-best';
  severity: 'info' | 'suggestion' | 'warning';
  title: string;
  message: string;
  recommendation: string;
  dimension?: CoachingDimension;
  data?: Record<string, unknown>;
}

// ─── Analyze Recent Sessions ─────────────────────────────────────────

/**
 * Analyze patterns across recent sessions.
 * Returns insights about recurring habits, improvements, and regressions.
 */
export function analyzeCrossSessions(limit = 10): CrossSessionInsight[] {
  const insights: CrossSessionInsight[] = [];

  // Get recent report cards from DB
  const reportCards = getRecentReportCards(limit);
  if (reportCards.length < 2) return insights;

  // 1. Detect recurring bad habits (same nudge rule fires in 3+ of last 5 sessions)
  insights.push(...detectRecurringHabits());

  // 2. Detect improvement trends (dimension score improved 10+ pts)
  insights.push(...detectImprovementTrends(reportCards));

  // 3. Detect regression alerts (dimension score dropped 15+ pts)
  insights.push(...detectRegressions(reportCards));

  // 4. Detect personal best highlights
  insights.push(...detectPersonalBests(reportCards));

  return insights;
}

// ─── Recurring Habits ────────────────────────────────────────────────

function detectRecurringHabits(): CrossSessionInsight[] {
  const insights: CrossSessionInsight[] = [];

  try {
    const stats = getNudgeStats();
    for (const detector of stats.byDetector) {
      // If a rule has fired 5+ times total, it's a recurring pattern
      if (detector.fire_count >= 5) {
        const dismissRate = detector.dismiss_count / detector.fire_count;

        // If user dismisses > 50%, don't nag — they know
        if (dismissRate > 0.5) continue;

        insights.push({
          type: 'habit',
          severity: 'suggestion',
          title: `Recurring: ${detector.detector_id.replace(/^[^.]+\./, '')}`,
          message: `"${detector.detector_id}" has fired ${detector.fire_count} times across sessions. This is a consistent pattern.`,
          recommendation: `This pattern keeps recurring. Consider:\n1. Adding a CLAUDE.md instruction to prevent it\n2. Setting up a hook to enforce the behavior automatically\n3. Reviewing the specific rule guidance in the Nudge dashboard\n\nExample CLAUDE.md addition:\n\`\`\`\nIMPORTANT: Always use Read before Edit. Never use Bash for file operations.\n\`\`\``,
          data: { fireCount: detector.fire_count, dismissCount: detector.dismiss_count },
        });
      }
    }
  } catch (err) {
    logger.error({ err }, 'Error detecting recurring habits');
  }

  return insights;
}

// ─── Improvement Trends ──────────────────────────────────────────────

function detectImprovementTrends(cards: ReportCardSummary[]): CrossSessionInsight[] {
  const insights: CrossSessionInsight[] = [];
  if (cards.length < 3) return insights;

  const dimensions: CoachingDimension[] = [
    'planning',
    'precision',
    'toolCraft',
    'contextManagement',
    'costEfficiency',
    'verification',
    'sessionStrategy',
    'configuration',
  ];

  const recent = cards.slice(0, 3); // most recent 3
  const older = cards.slice(-3); // oldest 3 of our window

  for (const dim of dimensions) {
    const recentAvg = average(recent.map((c) => getDimensionScore(c, dim)));
    const olderAvg = average(older.map((c) => getDimensionScore(c, dim)));

    if (recentAvg - olderAvg >= 10) {
      insights.push({
        type: 'improvement',
        severity: 'info',
        title: `${dim} improving`,
        message: `Your ${dim} score improved from ${Math.round(olderAvg)} to ${Math.round(recentAvg)} over recent sessions.`,
        recommendation: `Great progress on ${dim}! Keep it up. Your practices in this area are becoming stronger.`,
        dimension: dim,
        data: { oldScore: Math.round(olderAvg), newScore: Math.round(recentAvg) },
      });
    }
  }

  return insights;
}

// ─── Regression Detection ────────────────────────────────────────────

function detectRegressions(cards: ReportCardSummary[]): CrossSessionInsight[] {
  const insights: CrossSessionInsight[] = [];
  if (cards.length < 3) return insights;

  const dimensions: CoachingDimension[] = [
    'planning',
    'precision',
    'toolCraft',
    'contextManagement',
    'costEfficiency',
    'verification',
    'sessionStrategy',
    'configuration',
  ];

  const recent = cards.slice(0, 3);
  const older = cards.slice(-3);

  for (const dim of dimensions) {
    const recentAvg = average(recent.map((c) => getDimensionScore(c, dim)));
    const olderAvg = average(older.map((c) => getDimensionScore(c, dim)));

    if (olderAvg - recentAvg >= 15) {
      insights.push({
        type: 'regression',
        severity: 'warning',
        title: `${dim} declining`,
        message: `Your ${dim} score dropped from ${Math.round(olderAvg)} to ${Math.round(recentAvg)} over recent sessions.`,
        recommendation: `Your ${dim} score has declined. Review what changed:\n- Check the Nudge dashboard for ${dim}-related nudges\n- Review your recent sessions for patterns\n- Consider revisiting the best practices for this dimension`,
        dimension: dim,
        data: { oldScore: Math.round(olderAvg), newScore: Math.round(recentAvg) },
      });
    }
  }

  return insights;
}

// ─── Personal Best Detection ─────────────────────────────────────────

function detectPersonalBests(cards: ReportCardSummary[]): CrossSessionInsight[] {
  const insights: CrossSessionInsight[] = [];
  if (cards.length < 2) return insights;

  const latest = cards[0];
  const previousBest = Math.max(...cards.slice(1).map((c) => c.overall_score));

  if (latest.overall_score > previousBest && latest.overall_score >= 70) {
    insights.push({
      type: 'personal-best',
      severity: 'info',
      title: 'New personal best!',
      message: `Score of ${latest.overall_score} is your highest yet (previous best: ${previousBest}).`,
      recommendation: `Excellent work! Your overall coding practices are at their best. Keep applying the patterns that got you here.`,
      data: { score: latest.overall_score, previousBest },
    });
  }

  return insights;
}

// ─── DB Helpers ──────────────────────────────────────────────────────

interface ReportCardSummary {
  session_id: string;
  computed_at: number;
  overall_score: number;
  dimension_scores: string; // JSON
}

function getRecentReportCards(limit: number): ReportCardSummary[] {
  return dbGetRecentReportCards(limit) as unknown as ReportCardSummary[];
}

function getDimensionScore(card: ReportCardSummary, dimension: CoachingDimension): number {
  try {
    const scores = JSON.parse(card.dimension_scores) as Array<{ dimension: string; score: number }>;
    const match = scores.find((s) => s.dimension === dimension);
    return match?.score ?? 50;
  } catch {
    return 50;
  }
}

function average(nums: number[]): number {
  if (nums.length === 0) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}
