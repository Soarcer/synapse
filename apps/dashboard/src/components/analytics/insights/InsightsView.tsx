import { useState, useMemo, useEffect } from 'react';
import type { MockData } from '../mockData';

interface InsightsViewProps {
  data: MockData;
}

// ─── Types ──────────────────────────────────────────────────────────

interface Insight {
  id: string;
  category: 'cost' | 'efficiency' | 'usage' | 'streak' | 'milestone';
  severity: 'info' | 'success' | 'warning' | 'critical';
  title: string;
  description: string;
  metric?: number;
  delta?: number;
  date: string;
  actionable?: string;
}

interface Badge {
  id: string;
  name: string;
  description: string;
  icon: string;
  category: string;
  earned: boolean;
  earnedAt?: number;
}

interface BudgetStatus {
  daily: { spent: number; limit: number; percentUsed: number; isOverBudget: boolean };
  weekly: { spent: number; limit: number; percentUsed: number; isOverBudget: boolean };
  monthly: { spent: number; limit: number; percentUsed: number; isOverBudget: boolean };
  forecast: { predictedDailyCost: number; trend: 'rising' | 'stable' | 'falling'; confidence: number };
}

// ─── Mock generators (used when API unavailable) ────────────────────

function generateMockInsights(data: MockData): Insight[] {
  const totalCost = data.sessions.reduce((s, sess) => s + sess.totalCost, 0);
  const totalSessions = data.sessions.length;
  const avgCacheHit = data.turns.reduce((s, t) => s + (t.inputTokens > 0 ? t.cacheReadTokens / t.inputTokens : 0), 0) / Math.max(1, data.turns.length);
  const today = new Date().toISOString().split('T')[0];

  const insights: Insight[] = [];

  if (totalCost > 5) {
    insights.push({
      id: 'cost-note',
      category: 'cost',
      severity: totalCost > 20 ? 'warning' : 'info',
      title: totalCost > 20 ? 'Above Average Spending' : 'Cost Summary',
      description: `Total spend this period: $${totalCost.toFixed(2)} across ${totalSessions} sessions.`,
      metric: totalCost,
      date: today,
      actionable: totalCost > 20 ? 'Consider using Haiku for simple tasks to reduce costs.' : undefined,
    });
  }

  if (avgCacheHit > 0.6) {
    insights.push({
      id: 'cache-good',
      category: 'efficiency',
      severity: 'success',
      title: 'Great Cache Efficiency',
      description: `${Math.round(avgCacheHit * 100)}% average cache hit rate — your prompts are cache-friendly!`,
      metric: avgCacheHit,
      date: today,
    });
  } else if (avgCacheHit < 0.3 && data.turns.length > 5) {
    insights.push({
      id: 'cache-low',
      category: 'efficiency',
      severity: 'warning',
      title: 'Low Cache Utilization',
      description: `Only ${Math.round(avgCacheHit * 100)}% cache hits. Consistent prompt prefixes improve caching.`,
      metric: avgCacheHit,
      date: today,
      actionable: 'Use system prompts and consistent prefixes to increase cache hits.',
    });
  }

  if (totalSessions >= 7) {
    insights.push({
      id: 'streak',
      category: 'streak',
      severity: 'success',
      title: `${Math.min(totalSessions, 7)}-Day Active Streak`,
      description: `You've been coding with AI for ${Math.min(totalSessions, 7)} consecutive days!`,
      metric: Math.min(totalSessions, 7),
      date: today,
    });
  }

  const toolErrors = data.toolCalls.filter((t) => t.status === 'error').length;
  if (toolErrors > 5) {
    insights.push({
      id: 'errors',
      category: 'usage',
      severity: 'warning',
      title: 'Tool Errors Detected',
      description: `${toolErrors} tool call errors in this period. Most common: Bash, Write.`,
      metric: toolErrors,
      date: today,
      actionable: 'Check error patterns — file paths and permissions are common causes.',
    });
  }

  insights.push({
    id: 'milestone-sessions',
    category: 'milestone',
    severity: 'info',
    title: `${totalSessions} Sessions Completed`,
    description: `You've completed ${totalSessions} AI coding sessions this period.`,
    metric: totalSessions,
    date: today,
  });

  return insights;
}

const MOCK_BADGES: Badge[] = [
  { id: 'first-session', name: 'Hello World', description: 'Complete your first session', icon: '🚀', category: 'milestone', earned: true, earnedAt: Date.now() - 7 * 86_400_000 },
  { id: 'ten-sessions', name: 'Getting Started', description: 'Complete 10 sessions', icon: '📝', category: 'milestone', earned: true, earnedAt: Date.now() - 5 * 86_400_000 },
  { id: 'cache-master', name: 'Cache Master', description: 'Achieve >70% cache hit rate', icon: '🎯', category: 'efficiency', earned: true, earnedAt: Date.now() - 2 * 86_400_000 },
  { id: 'multi-model', name: 'Model Explorer', description: 'Use 3+ different models', icon: '🧪', category: 'explorer', earned: true, earnedAt: Date.now() - 86_400_000 },
  { id: 'fifty-sessions', name: 'Power User', description: 'Complete 50 sessions', icon: '⚡', category: 'milestone', earned: false },
  { id: 'week-streak', name: 'Week Warrior', description: '7-day coding streak', icon: '🔥', category: 'streak', earned: false },
  { id: 'tool-master', name: 'Tool Belt', description: 'Use 8+ different tools', icon: '🛠️', category: 'explorer', earned: false },
  { id: 'million-tokens', name: 'Token Millionaire', description: 'Process 1M tokens', icon: '💰', category: 'milestone', earned: false },
];

function generateMockBudget(data: MockData): BudgetStatus {
  const dailyCost = data.dailyRollups.length > 0 ? data.dailyRollups[data.dailyRollups.length - 1].totalCost : 0;
  const weeklyCost = data.dailyRollups.reduce((s, d) => s + d.totalCost, 0);
  return {
    daily: { spent: dailyCost, limit: 50, percentUsed: dailyCost / 50, isOverBudget: dailyCost > 50 },
    weekly: { spent: weeklyCost, limit: 250, percentUsed: weeklyCost / 250, isOverBudget: weeklyCost > 250 },
    monthly: { spent: weeklyCost * 4, limit: 1000, percentUsed: (weeklyCost * 4) / 1000, isOverBudget: weeklyCost * 4 > 1000 },
    forecast: { predictedDailyCost: dailyCost * 1.1, trend: 'stable', confidence: 0.7 },
  };
}

// ─── Severity styling ───────────────────────────────────────────────

const SEVERITY_STYLES: Record<string, { bg: string; border: string; icon: string; text: string }> = {
  critical: { bg: 'bg-red-500/10', border: 'border-red-500/30', icon: '🚨', text: 'text-red-400' },
  warning: { bg: 'bg-amber-500/10', border: 'border-amber-500/30', icon: '⚠️', text: 'text-amber-400' },
  success: { bg: 'bg-emerald-500/10', border: 'border-emerald-500/30', icon: '✅', text: 'text-emerald-400' },
  info: { bg: 'bg-blue-500/10', border: 'border-blue-500/30', icon: 'ℹ️', text: 'text-blue-400' },
};

// ─── Budget Gauge ───────────────────────────────────────────────────

function BudgetGauge({ label, spent, limit, isOverBudget }: { label: string; spent: number; limit: number; isOverBudget: boolean }) {
  const pct = Math.min(1, spent / limit);
  const color = isOverBudget ? '#ef4444' : pct > 0.75 ? '#f97316' : pct > 0.5 ? '#eab308' : '#22c55e';
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-gray-500 uppercase tracking-wider">{label}</span>
        <span className="text-xs text-gray-400">${spent.toFixed(2)} / ${limit}</span>
      </div>
      <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${pct * 100}%`, backgroundColor: color }}
        />
      </div>
    </div>
  );
}

// ─── Component ──────────────────────────────────────────────────────

export function InsightsView({ data }: InsightsViewProps) {
  const [summaryExpanded, setSummaryExpanded] = useState(true);

  const insights = useMemo(() => generateMockInsights(data), [data]);
  const badges = MOCK_BADGES;
  const budget = useMemo(() => generateMockBudget(data), [data]);

  const earnedBadges = badges.filter((b) => b.earned);
  const unearnedBadges = badges.filter((b) => !b.earned);

  // AI Summary
  const summary = useMemo(() => {
    const totalCost = data.sessions.reduce((s, sess) => s + sess.totalCost, 0);
    const totalSessions = data.sessions.length;
    const avgCost = totalSessions > 0 ? totalCost / totalSessions : 0;
    const topModel = data.sessions.reduce((acc, s) => {
      acc.set(s.model, (acc.get(s.model) || 0) + 1);
      return acc;
    }, new Map<string, number>());
    const topModelName = [...topModel.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || 'N/A';

    return `This period: ${totalSessions} sessions, $${totalCost.toFixed(2)} total cost ($${avgCost.toFixed(2)}/session avg). Primary model: ${topModelName}. ${insights.filter(i => i.severity === 'warning').length > 0 ? `${insights.filter(i => i.severity === 'warning').length} item(s) need attention.` : 'All systems looking good!'}`;
  }, [data.sessions, insights]);

  return (
    <div className="max-w-[1400px] mx-auto p-4 space-y-4">
      {/* AI Summary Banner */}
      <div className="bg-gradient-to-r from-blue-500/10 to-purple-500/10 border border-blue-500/20 rounded-xl p-4">
        <button
          onClick={() => setSummaryExpanded(!summaryExpanded)}
          className="flex items-center justify-between w-full text-left"
        >
          <div className="flex items-center gap-2">
            <span className="text-sm">🤖</span>
            <span className="text-sm font-medium text-gray-200">AI Summary</span>
          </div>
          <span className="text-gray-500 text-xs">{summaryExpanded ? '▼' : '▶'}</span>
        </button>
        {summaryExpanded && (
          <p className="text-xs text-gray-400 mt-2 leading-relaxed">{summary}</p>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Insight Cards */}
        <div className="lg:col-span-2 space-y-3">
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Insights</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {insights.map((insight) => {
              const style = SEVERITY_STYLES[insight.severity] || SEVERITY_STYLES.info;
              return (
                <div key={insight.id} className={`${style.bg} border ${style.border} rounded-xl p-4`}>
                  <div className="flex items-start gap-2">
                    <span className="text-sm flex-shrink-0">{style.icon}</span>
                    <div className="min-w-0">
                      <h4 className={`text-xs font-semibold ${style.text}`}>{insight.title}</h4>
                      <p className="text-[11px] text-gray-400 mt-1 leading-relaxed">{insight.description}</p>
                      {insight.actionable && (
                        <p className="text-[10px] text-gray-500 mt-2 italic">💡 {insight.actionable}</p>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Budget Sidebar */}
        <div className="space-y-4">
          <div className="bg-[#161b22] border border-gray-800 rounded-xl p-4 space-y-4">
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Budget</h3>
            <BudgetGauge label="Daily" spent={budget.daily.spent} limit={budget.daily.limit} isOverBudget={budget.daily.isOverBudget} />
            <BudgetGauge label="Weekly" spent={budget.weekly.spent} limit={budget.weekly.limit} isOverBudget={budget.weekly.isOverBudget} />
            <BudgetGauge label="Monthly" spent={budget.monthly.spent} limit={budget.monthly.limit} isOverBudget={budget.monthly.isOverBudget} />
            <div className="pt-2 border-t border-gray-800">
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-gray-500">Forecast (daily)</span>
                <span className="text-xs text-gray-300">${budget.forecast.predictedDailyCost.toFixed(2)}</span>
              </div>
              <div className="flex items-center justify-between mt-1">
                <span className="text-[10px] text-gray-500">Trend</span>
                <span className={`text-xs ${budget.forecast.trend === 'rising' ? 'text-red-400' : budget.forecast.trend === 'falling' ? 'text-emerald-400' : 'text-gray-400'}`}>
                  {budget.forecast.trend === 'rising' ? '📈 Rising' : budget.forecast.trend === 'falling' ? '📉 Falling' : '➡️ Stable'}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Badge Shelf */}
      <div className="bg-[#161b22] border border-gray-800 rounded-xl p-4">
        <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Badges</h3>
        <div className="flex flex-wrap gap-3">
          {earnedBadges.map((badge) => (
            <div key={badge.id} className="flex items-center gap-2 px-3 py-2 bg-[#0d1117] border border-gray-700 rounded-lg hover:border-gray-600 transition-colors group">
              <span className="text-lg">{badge.icon}</span>
              <div>
                <div className="text-xs font-medium text-gray-200">{badge.name}</div>
                <div className="text-[10px] text-gray-500">{badge.description}</div>
              </div>
            </div>
          ))}
          {unearnedBadges.map((badge) => (
            <div key={badge.id} className="flex items-center gap-2 px-3 py-2 bg-[#0d1117] border border-gray-800 rounded-lg opacity-40 group">
              <span className="text-lg grayscale">{badge.icon}</span>
              <div>
                <div className="text-xs font-medium text-gray-500">{badge.name}</div>
                <div className="text-[10px] text-gray-600">{badge.description}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
