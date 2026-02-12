// ─── Badge System ───────────────────────────────────────────────────
// Gamification through achievement badges earned by usage patterns.

import { analyticsQueryAll, analyticsQueryGet, analyticsExecute } from '../db.js';
import { logger } from '../lib/logger.js';

export interface Badge {
  id: string;
  name: string;
  description: string;
  icon: string;                  // emoji
  category: 'usage' | 'efficiency' | 'streak' | 'milestone' | 'explorer';
  condition: (stats: BadgeCheckStats) => boolean;
}

export interface EarnedBadge {
  badgeId: string;
  name: string;
  description: string;
  icon: string;
  category: string;
  earnedAt: number;
}

interface BadgeCheckStats {
  totalSessions: number;
  totalTokens: number;
  totalCost: number;
  totalToolCalls: number;
  uniqueModels: number;
  uniqueTools: number;
  maxStreak: number;
  avgCacheHitRate: number;
  totalErrors: number;
}

// ─── Badge Definitions ──────────────────────────────────────────────

const BADGE_DEFINITIONS: Badge[] = [
  // Usage milestones
  { id: 'first-session', name: 'Hello World', description: 'Complete your first AI coding session', icon: '\u{1F680}', category: 'milestone', condition: (s) => s.totalSessions >= 1 },
  { id: 'ten-sessions', name: 'Getting Started', description: 'Complete 10 sessions', icon: '\u{1F4DD}', category: 'milestone', condition: (s) => s.totalSessions >= 10 },
  { id: 'fifty-sessions', name: 'Power User', description: 'Complete 50 sessions', icon: '\u26A1', category: 'milestone', condition: (s) => s.totalSessions >= 50 },
  { id: 'hundred-sessions', name: 'Centurion', description: 'Complete 100 sessions', icon: '\u{1F3DB}\uFE0F', category: 'milestone', condition: (s) => s.totalSessions >= 100 },
  { id: 'five-hundred-sessions', name: 'AI Veteran', description: 'Complete 500 sessions', icon: '\u{1F396}\uFE0F', category: 'milestone', condition: (s) => s.totalSessions >= 500 },

  // Token milestones
  { id: 'million-tokens', name: 'Token Millionaire', description: 'Process 1M tokens total', icon: '\u{1F4B0}', category: 'milestone', condition: (s) => s.totalTokens >= 1_000_000 },
  { id: 'ten-million-tokens', name: 'Token Whale', description: 'Process 10M tokens', icon: '\u{1F40B}', category: 'milestone', condition: (s) => s.totalTokens >= 10_000_000 },

  // Efficiency badges
  { id: 'cache-master', name: 'Cache Master', description: 'Achieve >70% cache hit rate', icon: '\u{1F3AF}', category: 'efficiency', condition: (s) => s.avgCacheHitRate > 0.7 },
  { id: 'cost-effective', name: 'Budget Hawk', description: 'Complete 20+ sessions with <$10 total', icon: '\u{1F985}', category: 'efficiency', condition: (s) => s.totalSessions >= 20 && s.totalCost < 10 },

  // Streak badges
  { id: 'week-streak', name: 'Week Warrior', description: 'Use AI coding 7 days in a row', icon: '\u{1F525}', category: 'streak', condition: (s) => s.maxStreak >= 7 },
  { id: 'month-streak', name: 'Unstoppable', description: 'Use AI coding 30 days in a row', icon: '\u{1F31F}', category: 'streak', condition: (s) => s.maxStreak >= 30 },

  // Explorer badges
  { id: 'multi-model', name: 'Model Explorer', description: 'Use 3+ different AI models', icon: '\u{1F9EA}', category: 'explorer', condition: (s) => s.uniqueModels >= 3 },
  { id: 'tool-master', name: 'Tool Belt', description: 'Use 8+ different tools', icon: '\u{1F6E0}\uFE0F', category: 'explorer', condition: (s) => s.uniqueTools >= 8 },
  { id: 'hundred-tools', name: 'Tool Collector', description: 'Make 100+ tool calls', icon: '\u{1F9F0}', category: 'explorer', condition: (s) => s.totalToolCalls >= 100 },
];

// ─── Public API ─────────────────────────────────────────────────────

export function getEarnedBadges(): EarnedBadge[] {
  const rows = analyticsQueryAll(
    'SELECT * FROM badges_earned ORDER BY earned_at DESC',
  ) as Array<Record<string, unknown>>;

  return rows.map((r) => ({
    badgeId: r.badge_id as string,
    name: r.name as string,
    description: r.description as string,
    icon: r.icon as string,
    category: r.category as string,
    earnedAt: r.earned_at as number,
  }));
}

export function getAllBadgeDefinitions(): Array<Badge & { earned: boolean; earnedAt?: number }> {
  const earned = getEarnedBadges();
  const earnedMap = new Map(earned.map((b) => [b.badgeId, b.earnedAt]));

  return BADGE_DEFINITIONS.map((badge) => ({
    ...badge,
    earned: earnedMap.has(badge.id),
    earnedAt: earnedMap.get(badge.id),
  }));
}

export function checkAndAwardBadges(): EarnedBadge[] {
  const stats = gatherStats();
  const earned = getEarnedBadges();
  const earnedIds = new Set(earned.map((b) => b.badgeId));
  const newBadges: EarnedBadge[] = [];

  for (const badge of BADGE_DEFINITIONS) {
    if (earnedIds.has(badge.id)) continue;

    try {
      if (badge.condition(stats)) {
        const now = Date.now();
        analyticsExecute(`
          INSERT OR IGNORE INTO badges_earned (badge_id, name, description, icon, category, earned_at)
          VALUES (?, ?, ?, ?, ?, ?)
        `, [badge.id, badge.name, badge.description, badge.icon, badge.category, now]);

        const newBadge: EarnedBadge = {
          badgeId: badge.id,
          name: badge.name,
          description: badge.description,
          icon: badge.icon,
          category: badge.category,
          earnedAt: now,
        };
        newBadges.push(newBadge);
        logger.info({ badge: badge.id, name: badge.name }, 'Badge earned!');
      }
    } catch { /* condition check failed, skip */ }
  }

  return newBadges;
}

// ─── Stats Gathering ────────────────────────────────────────────────

function gatherStats(): BadgeCheckStats {
  const overview = analyticsQueryGet(`
    SELECT
      SUM(total_sessions) as sessions,
      SUM(total_input_tokens + total_output_tokens) as tokens,
      SUM(total_cost_usd) as cost,
      SUM(total_tool_calls) as toolCalls,
      SUM(total_errors) as errors,
      SUM(total_cache_read_tokens) as cacheRead,
      SUM(total_input_tokens) as inputTokens
    FROM analytics_daily
  `) as Record<string, unknown> | undefined;

  const models = analyticsQueryAll(`
    SELECT DISTINCT model FROM analytics_daily WHERE model IS NOT NULL AND model != '__all__'
  `) as Array<{ model: string }>;

  const tools = analyticsQueryAll(`
    SELECT DISTINCT tool_name FROM analytics_tool_daily WHERE tool_name IS NOT NULL
  `) as Array<{ tool_name: string }>;

  // Calculate max streak
  const days = analyticsQueryAll(`
    SELECT DISTINCT date FROM analytics_daily WHERE total_sessions > 0 ORDER BY date DESC
  `) as Array<{ date: string }>;

  let maxStreak = 0;
  let currentStreak = 0;
  let prevDate: Date | null = null;

  for (const row of days) {
    const d = new Date(row.date);
    if (prevDate && (prevDate.getTime() - d.getTime()) === 86_400_000) {
      currentStreak++;
    } else {
      currentStreak = 1;
    }
    if (currentStreak > maxStreak) maxStreak = currentStreak;
    prevDate = d;
  }

  const inputTokens = Number(overview?.inputTokens ?? 0);
  const cacheRead = Number(overview?.cacheRead ?? 0);

  return {
    totalSessions: Number(overview?.sessions ?? 0),
    totalTokens: Number(overview?.tokens ?? 0),
    totalCost: Number(overview?.cost ?? 0),
    totalToolCalls: Number(overview?.toolCalls ?? 0),
    uniqueModels: models.length,
    uniqueTools: tools.length,
    maxStreak,
    avgCacheHitRate: inputTokens > 0 ? cacheRead / inputTokens : 0,
    totalErrors: Number(overview?.errors ?? 0),
  };
}
