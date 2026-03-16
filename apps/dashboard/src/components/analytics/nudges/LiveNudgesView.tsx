// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bernhard

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useAgentStore } from '../../../store/agentStore';
import { apiUrl } from '../../../utils/api';
import { copyToClipboard } from '../../../utils/clipboard';
import type { CoachingNudge, NudgeSeverity, NudgeRuleCategory } from '@synapse-ai/core';

type Sensitivity = 'off' | 'low' | 'medium' | 'high';

// ─── Types ──────────────────────────────────────────────────────────

interface NudgeStats {
  byDetector: { detector_id: string; fire_count: number; dismiss_count: number }[];
  totalFired: number;
  totalDismissed: number;
}

interface ServerRule {
  id: string;
  name: string;
  description: string;
  dimension: string;
  defaultSeverity: NudgeSeverity;
  defaultCooldownMs: number;
  category: NudgeRuleCategory;
  tags: string[];
  subscribes: string[];
  enabled: boolean;
  severityOverride: string | null;
  cooldownOverride: number | null;
  suppressed: boolean;
  options: Record<string, unknown> | null;
}

interface CrossSessionInsight {
  type: 'habit' | 'improvement' | 'regression' | 'personal-best';
  severity: 'info' | 'suggestion' | 'warning';
  title: string;
  message: string;
  recommendation: string;
  dimension?: string;
  data?: Record<string, unknown>;
}

// ─── Constants ──────────────────────────────────────────────────────

const SEVERITY_STYLES: Record<
  NudgeSeverity,
  { border: string; bg: string; icon: string; text: string }
> = {
  info: {
    border: 'border-blue-500/30',
    bg: 'bg-blue-500/5',
    icon: 'text-blue-400',
    text: 'text-blue-300',
  },
  suggestion: {
    border: 'border-amber-500/30',
    bg: 'bg-amber-500/5',
    icon: 'text-amber-400',
    text: 'text-amber-300',
  },
  warning: {
    border: 'border-red-500/30',
    bg: 'bg-red-500/5',
    icon: 'text-red-400',
    text: 'text-red-300',
  },
};

const SEVERITY_ICONS: Record<NudgeSeverity, string> = {
  info: '\u2139',
  suggestion: '\u26A0',
  warning: '\u26D4',
};

const INSIGHT_STYLES: Record<
  CrossSessionInsight['type'],
  { border: string; bg: string; icon: string }
> = {
  habit: { border: 'border-amber-500/30', bg: 'bg-amber-500/5', icon: '\uD83D\uDD01' },
  improvement: { border: 'border-green-500/30', bg: 'bg-green-500/5', icon: '\uD83D\uDCC8' },
  regression: { border: 'border-red-500/30', bg: 'bg-red-500/5', icon: '\uD83D\uDCC9' },
  'personal-best': { border: 'border-purple-500/30', bg: 'bg-purple-500/5', icon: '\uD83C\uDFC6' },
};

const CATEGORY_LABELS: Record<NudgeRuleCategory, string> = {
  'tool-usage': 'Tool Usage',
  planning: 'Planning & Prompts',
  verification: 'Verification',
  git: 'Git & Workflow',
  security: 'Security',
  efficiency: 'Efficiency',
  orchestration: 'Orchestration',
};

const CATEGORY_ORDER: NudgeRuleCategory[] = [
  'tool-usage',
  'planning',
  'verification',
  'git',
  'security',
  'efficiency',
  'orchestration',
];

const EMPTY_STATS: NudgeStats = { byDetector: [], totalFired: 0, totalDismissed: 0 };
const EMPTY_RULES: ServerRule[] = [];
const EMPTY_INSIGHTS: CrossSessionInsight[] = [];

// ─── Component ──────────────────────────────────────────────────────

export function LiveNudgesView() {
  const liveNudges = useAgentStore((s) => s.liveNudges);
  const dismissNudge = useAgentStore((s) => s.dismissNudge);
  const undismissNudge = useAgentStore((s) => s.undismissNudge);

  const [stats, setStats] = useState<NudgeStats>(EMPTY_STATS);
  const [serverRules, setServerRules] = useState<ServerRule[]>(EMPTY_RULES);
  const [insights, setInsights] = useState<CrossSessionInsight[]>(EMPTY_INSIGHTS);
  const [statsLoading, setStatsLoading] = useState(true);
  const [rulesLoading, setRulesLoading] = useState(true);
  const [sensitivity, setSensitivity] = useState<Sensitivity>('off');
  const [sensitivitySaving, setSensitivitySaving] = useState(false);
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set());
  const [ruleSearch, setRuleSearch] = useState('');

  // Fetch stats + sensitivity + rules + cross-session on mount
  useEffect(() => {
    let cancelled = false;
    fetch(apiUrl('/api/analytics/coaching/nudges/stats'))
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled && d.data) setStats(d.data);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setStatsLoading(false);
      });

    fetch(apiUrl('/api/analytics/coaching/sensitivity'))
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled && d.data?.level) setSensitivity(d.data.level);
      })
      .catch(() => {});

    fetch(apiUrl('/api/analytics/coaching/rules'))
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled && d.data) setServerRules(d.data);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setRulesLoading(false);
      });

    fetch(apiUrl('/api/analytics/coaching/cross-session?limit=10'))
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled && d.data) setInsights(d.data);
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, []);

  const updateSensitivity = useCallback((level: Sensitivity) => {
    setSensitivity(level);
    setSensitivitySaving(true);
    fetch(apiUrl('/api/analytics/coaching/sensitivity'), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ level }),
    })
      .catch(() => {})
      .finally(() => setSensitivitySaving(false));
  }, []);

  const toggleRule = useCallback((ruleId: string) => {
    setServerRules((prev) => {
      const updated = prev.map((r) => (r.id === ruleId ? { ...r, enabled: !r.enabled } : r));
      // Persist to server
      const rule = updated.find((r) => r.id === ruleId);
      if (rule) {
        fetch(apiUrl(`/api/analytics/coaching/rules/${ruleId}`), {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ enabled: rule.enabled }),
        }).catch(() => {});
      }
      return updated;
    });
  }, []);

  const resetRules = useCallback(() => {
    fetch(apiUrl('/api/analytics/coaching/rules/reset'), { method: 'POST' })
      .then(() =>
        fetch(apiUrl('/api/analytics/coaching/rules'))
          .then((r) => r.json())
          .then((d) => {
            if (d.data) setServerRules(d.data);
          }),
      )
      .catch(() => {});
  }, []);

  const toggleCategory = useCallback((cat: string) => {
    setCollapsedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  }, []);

  // Sort nudges newest-first
  const sortedNudges = useMemo(
    () => [...liveNudges].sort((a, b) => b.firedAt - a.firedAt),
    [liveNudges],
  );

  const activeNudges = useMemo(() => sortedNudges.filter((n) => !n.dismissed), [sortedNudges]);
  const dismissedNudges = useMemo(() => sortedNudges.filter((n) => n.dismissed), [sortedNudges]);

  const handleDismiss = (nudge: CoachingNudge) => {
    dismissNudge(nudge.id);
    fetch(apiUrl('/api/analytics/coaching/nudges/dismiss'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: nudge.sessionId, nudgeId: nudge.id }),
    }).catch(() => {
      undismissNudge(nudge.id);
    });
  };

  // Group rules by category
  const rulesByCategory = useMemo(() => {
    const search = ruleSearch.toLowerCase();
    const filtered = search
      ? serverRules.filter(
          (r) =>
            r.name.toLowerCase().includes(search) ||
            r.id.toLowerCase().includes(search) ||
            r.description.toLowerCase().includes(search) ||
            r.tags.some((t) => t.toLowerCase().includes(search)),
        )
      : serverRules;
    const map = new Map<NudgeRuleCategory, ServerRule[]>();
    for (const rule of filtered) {
      const list = map.get(rule.category) ?? [];
      list.push(rule);
      map.set(rule.category, list);
    }
    return map;
  }, [serverRules, ruleSearch]);

  // Compute quick wins: top 3 most-fired rules with their details
  const quickWins = useMemo(() => {
    if (stats.byDetector.length === 0 || serverRules.length === 0) return [];
    return stats.byDetector
      .filter((d) => d.fire_count >= 2)
      .sort((a, b) => b.fire_count - a.fire_count)
      .slice(0, 3)
      .map((d) => {
        const rule = serverRules.find((r) => r.id === d.detector_id);
        return { ...d, rule };
      });
  }, [stats.byDetector, serverRules]);

  const dismissRate =
    stats.totalFired > 0 ? ((stats.totalDismissed / stats.totalFired) * 100).toFixed(1) : '0';
  const enabledCount = serverRules.filter((r) => r.enabled).length;
  const totalRules = serverRules.length;

  return (
    <div className="max-w-[1400px] mx-auto p-4 space-y-4">
      {/* Stats overview */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <StatCard label="Total Fired" value={statsLoading ? '...' : String(stats.totalFired)} />
        <StatCard label="Dismissed" value={statsLoading ? '...' : String(stats.totalDismissed)} />
        <StatCard label="Dismiss Rate" value={statsLoading ? '...' : `${dismissRate}%`} />
        <StatCard
          label="Active Now"
          value={String(activeNudges.length)}
          highlight={activeNudges.length > 0}
        />
        <StatCard
          label="Rules"
          value={rulesLoading ? '...' : `${enabledCount}/${totalRules}`}
          subtitle="enabled"
        />
      </div>

      {/* Cross-session insights banner */}
      {insights.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
            Cross-Session Insights
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {insights.slice(0, 4).map((insight, i) => (
              <InsightCard key={i} insight={insight} />
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Left: Nudge Timeline + Quick Wins */}
        <div className="lg:col-span-2 space-y-4">
          {/* Nudge timeline dots */}
          {sortedNudges.length > 0 && <NudgeTimeline nudges={sortedNudges.slice(0, 40)} />}

          {/* Quick Wins */}
          {quickWins.length > 0 && (
            <div>
              <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
                Quick Wins — Most Frequent Patterns
              </h3>
              <div className="space-y-2">
                {quickWins.map((qw) => (
                  <div
                    key={qw.detector_id}
                    className="bg-syn-bg-surface border border-gray-800 rounded-xl p-3"
                  >
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2">
                        <span className="text-amber-400 text-sm">{'\u26A1'}</span>
                        <span className="text-xs font-medium text-gray-200">
                          {qw.rule?.name ?? qw.detector_id}
                        </span>
                        <SeverityBadge severity={qw.rule?.defaultSeverity ?? 'info'} />
                      </div>
                      <span className="text-[10px] text-gray-500">{qw.fire_count} fires</span>
                    </div>
                    <p className="text-[11px] text-gray-400 mb-1.5">
                      {qw.rule?.description ?? 'No description'}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Active nudges */}
          <div>
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
              Active Nudges ({activeNudges.length})
            </h3>
            {activeNudges.length === 0 ? (
              <div className="bg-syn-bg-surface border border-gray-800 rounded-xl p-6 text-center">
                <div className="text-gray-600 text-2xl mb-2">{'\u2705'}</div>
                <p className="text-sm text-gray-400">No active nudges</p>
                <p className="text-xs text-gray-600 mt-1">
                  Nudges appear in real-time during active sessions
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {activeNudges.map((nudge) => (
                  <NudgeCard key={nudge.id} nudge={nudge} onDismiss={() => handleDismiss(nudge)} />
                ))}
              </div>
            )}
          </div>

          {/* Dismissed nudges */}
          {dismissedNudges.length > 0 && (
            <div>
              <h3 className="text-xs font-semibold text-gray-600 uppercase tracking-wider mb-2">
                Dismissed ({dismissedNudges.length})
              </h3>
              <div className="space-y-2">
                {dismissedNudges.slice(0, 10).map((nudge) => (
                  <NudgeCard key={nudge.id} nudge={nudge} dismissed />
                ))}
                {dismissedNudges.length > 10 && (
                  <p className="text-xs text-gray-600 text-center py-2">
                    +{dismissedNudges.length - 10} more dismissed nudges
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Rule effectiveness stats */}
          {stats.byDetector.length > 0 && (
            <div>
              <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
                Rule Breakdown
              </h3>
              <div className="bg-syn-bg-surface border border-gray-800 rounded-xl overflow-hidden">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-gray-800">
                      <th className="text-left p-3 text-gray-500 font-medium">Rule</th>
                      <th className="text-left p-3 text-gray-500 font-medium">Category</th>
                      <th className="text-right p-3 text-gray-500 font-medium">Fired</th>
                      <th className="text-right p-3 text-gray-500 font-medium">Dismissed</th>
                      <th className="text-right p-3 text-gray-500 font-medium">Rate</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.byDetector.map((row) => {
                      const rule = serverRules.find((r) => r.id === row.detector_id);
                      const rate =
                        row.fire_count > 0
                          ? ((row.dismiss_count / row.fire_count) * 100).toFixed(0)
                          : '0';
                      return (
                        <tr key={row.detector_id} className="border-b border-gray-800/50">
                          <td className="p-3 text-gray-300">{rule?.name ?? row.detector_id}</td>
                          <td className="p-3">
                            {rule && (
                              <span className="text-[10px] text-gray-500 bg-gray-800/50 px-1.5 py-0.5 rounded">
                                {CATEGORY_LABELS[rule.category] ?? rule.category}
                              </span>
                            )}
                          </td>
                          <td className="p-3 text-right text-gray-400">{row.fire_count}</td>
                          <td className="p-3 text-right text-gray-400">{row.dismiss_count}</td>
                          <td className="p-3 text-right text-gray-400">{rate}%</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* Right: Configuration */}
        <div className="space-y-4">
          {/* AI Coaching Sensitivity */}
          <div className="bg-syn-bg-surface border border-gray-800 rounded-xl p-4">
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
              AI Coaching Sensitivity
            </h3>
            <p className="text-[10px] text-gray-600 mb-3">
              Controls how aggressively AI analyzes tool patterns and escalates nudges.
            </p>
            <div className="flex gap-1.5">
              {(['off', 'low', 'medium', 'high'] as const).map((level) => (
                <button
                  key={level}
                  onClick={() => updateSensitivity(level)}
                  disabled={sensitivitySaving}
                  className={`flex-1 px-2 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                    sensitivity === level
                      ? level === 'off'
                        ? 'bg-gray-500/20 text-gray-300 border border-gray-500/30'
                        : level === 'low'
                          ? 'bg-green-500/20 text-green-400 border border-green-500/30'
                          : level === 'medium'
                            ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
                            : 'bg-red-500/20 text-red-400 border border-red-500/30'
                      : 'bg-gray-800/50 text-gray-500 border border-gray-800 hover:text-gray-400'
                  }`}
                >
                  {level.charAt(0).toUpperCase() + level.slice(1)}
                </button>
              ))}
            </div>
            <div className="mt-2 text-[10px] text-gray-600">
              {sensitivity === 'off' && 'AI coaching disabled. No automatic checks.'}
              {sensitivity === 'low' && 'Checks every 20 tool calls. Fewer interruptions.'}
              {sensitivity === 'medium' && 'Checks every 10 tool calls. Balanced coverage.'}
              {sensitivity === 'high' && 'Checks every 5 tool calls. Maximum oversight.'}
            </div>
          </div>

          {/* Dynamic Rule Configuration */}
          <div className="bg-syn-bg-surface border border-gray-800 rounded-xl p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
                Nudge Rules ({enabledCount}/{totalRules})
              </h3>
              <button
                onClick={resetRules}
                className="text-[10px] text-gray-600 hover:text-gray-400 transition-colors"
                title="Reset all rules to defaults"
              >
                Reset
              </button>
            </div>

            {/* Search */}
            <input
              type="text"
              value={ruleSearch}
              onChange={(e) => setRuleSearch(e.target.value)}
              placeholder="Search rules..."
              className="w-full px-2.5 py-1.5 bg-syn-bg-primary border border-gray-800 rounded-lg text-xs text-gray-300 placeholder-gray-600 mb-3 outline-none focus:border-gray-700"
            />

            {rulesLoading ? (
              <p className="text-xs text-gray-600 text-center py-4">Loading rules...</p>
            ) : (
              <div className="space-y-1">
                {CATEGORY_ORDER.map((cat) => {
                  const catRules = rulesByCategory.get(cat);
                  if (!catRules || catRules.length === 0) return null;
                  const collapsed = collapsedCategories.has(cat);
                  const enabledInCat = catRules.filter((r) => r.enabled).length;

                  return (
                    <div key={cat}>
                      <button
                        onClick={() => toggleCategory(cat)}
                        className="w-full flex items-center justify-between px-2 py-1.5 rounded-lg hover:bg-gray-800/30 transition-colors"
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] text-gray-600">
                            {collapsed ? '\u25B6' : '\u25BC'}
                          </span>
                          <span className="text-[11px] font-medium text-gray-300">
                            {CATEGORY_LABELS[cat]}
                          </span>
                        </div>
                        <span className="text-[10px] text-gray-600">
                          {enabledInCat}/{catRules.length}
                        </span>
                      </button>

                      {!collapsed && (
                        <div className="ml-2 space-y-0.5">
                          {catRules.map((rule) => (
                            <RuleToggle
                              key={rule.id}
                              rule={rule}
                              fireCount={
                                stats.byDetector.find((d) => d.detector_id === rule.id)
                                  ?.fire_count ?? 0
                              }
                              onToggle={() => toggleRule(rule.id)}
                            />
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* How nudges work */}
          <div className="bg-syn-bg-surface border border-gray-800 rounded-xl p-4">
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
              How It Works
            </h3>
            <div className="space-y-3 text-[11px] text-gray-400 leading-relaxed">
              <p>
                <span className="text-gray-200">30 rules</span> across 7 categories monitor your
                Claude Code sessions in real-time, detecting anti-patterns like using Bash for file
                ops, editing without reading, and committing without review.
              </p>
              <p>
                Rules use a <span className="text-gray-200">visitor pattern</span> — only rules
                subscribed to the incoming event type are evaluated, keeping overhead near zero.
              </p>
              <p>
                The <span className="text-gray-200">delivery manager</span> prevents nudge fatigue
                with per-rule cooldowns, exponential backoff, and auto-suppression after repeated
                dismissals.
              </p>
              <p>
                Rule toggles are <span className="text-gray-200">persisted server-side</span> and
                affect all sessions.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Sub-components ─────────────────────────────────────────────────

function StatCard({
  label,
  value,
  highlight,
  subtitle,
}: {
  label: string;
  value: string;
  highlight?: boolean;
  subtitle?: string;
}) {
  return (
    <div className="bg-syn-bg-surface border border-gray-800 rounded-xl p-3">
      <div className="text-[10px] text-gray-500 uppercase tracking-wider">{label}</div>
      <div className="flex items-baseline gap-1">
        <div className={`text-lg font-bold mt-1 ${highlight ? 'text-amber-400' : 'text-gray-100'}`}>
          {value}
        </div>
        {subtitle && <span className="text-[10px] text-gray-600">{subtitle}</span>}
      </div>
    </div>
  );
}

function SeverityBadge({ severity }: { severity: NudgeSeverity }) {
  const colors: Record<NudgeSeverity, string> = {
    info: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
    suggestion: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
    warning: 'bg-red-500/20 text-red-400 border-red-500/30',
  };
  return (
    <span className={`px-1.5 py-0.5 rounded border text-[9px] font-medium ${colors[severity]}`}>
      {severity}
    </span>
  );
}

// ─── NudgeTimeline ──────────────────────────────────────────────────

function NudgeTimeline({ nudges }: { nudges: CoachingNudge[] }) {
  const DOT_COLORS: Record<NudgeSeverity, string> = {
    info: 'bg-blue-400',
    suggestion: 'bg-amber-400',
    warning: 'bg-red-400',
  };

  // Group by time buckets (5-min intervals)
  const buckets = useMemo(() => {
    if (nudges.length === 0) return [];
    const sorted = [...nudges].sort((a, b) => a.firedAt - b.firedAt);
    const first = sorted[0].firedAt;
    const last = sorted[sorted.length - 1].firedAt;
    const span = Math.max(last - first, 60_000); // at least 1 minute
    const bucketCount = Math.min(20, nudges.length);
    const bucketSize = span / bucketCount;

    const result: { time: number; nudges: CoachingNudge[] }[] = [];
    for (let i = 0; i < bucketCount; i++) {
      const bucketStart = first + i * bucketSize;
      const bucketEnd = bucketStart + bucketSize;
      const inBucket = sorted.filter((n) => n.firedAt >= bucketStart && n.firedAt < bucketEnd);
      result.push({ time: bucketStart + bucketSize / 2, nudges: inBucket });
    }
    return result.filter((b) => b.nudges.length > 0);
  }, [nudges]);

  if (buckets.length === 0) return null;

  return (
    <div className="bg-syn-bg-surface border border-gray-800 rounded-xl p-3">
      <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
        Nudge Timeline
      </h3>
      <div className="flex items-end gap-1 h-12">
        {buckets.map((bucket, i) => {
          const maxSeverity = bucket.nudges.reduce<NudgeSeverity>((max, n) => {
            const order: Record<NudgeSeverity, number> = { info: 0, suggestion: 1, warning: 2 };
            return order[n.severity] > order[max] ? n.severity : max;
          }, 'info');
          const height = Math.min(100, bucket.nudges.length * 25 + 25);
          return (
            <div
              key={i}
              className="flex-1 flex flex-col items-center justify-end gap-0.5"
              title={`${new Date(bucket.time).toLocaleTimeString()} — ${bucket.nudges.length} nudge(s)`}
            >
              <div
                className={`w-full rounded-sm ${DOT_COLORS[maxSeverity]} opacity-80 min-h-[4px] transition-all`}
                style={{ height: `${height}%` }}
              />
            </div>
          );
        })}
      </div>
      <div className="flex justify-between mt-1">
        <span className="text-[9px] text-gray-600">
          {new Date(buckets[0].time).toLocaleTimeString()}
        </span>
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1 text-[9px] text-gray-600">
            <span className="w-2 h-2 rounded-sm bg-blue-400 inline-block" /> info
          </span>
          <span className="flex items-center gap-1 text-[9px] text-gray-600">
            <span className="w-2 h-2 rounded-sm bg-amber-400 inline-block" /> suggestion
          </span>
          <span className="flex items-center gap-1 text-[9px] text-gray-600">
            <span className="w-2 h-2 rounded-sm bg-red-400 inline-block" /> warning
          </span>
        </div>
        <span className="text-[9px] text-gray-600">
          {new Date(buckets[buckets.length - 1].time).toLocaleTimeString()}
        </span>
      </div>
    </div>
  );
}

// ─── InsightCard ────────────────────────────────────────────────────

function InsightCard({ insight }: { insight: CrossSessionInsight }) {
  const style = INSIGHT_STYLES[insight.type];
  return (
    <div className={`rounded-lg border ${style.border} ${style.bg} p-3`}>
      <div className="flex items-start gap-2">
        <span className="text-sm">{style.icon}</span>
        <div className="flex-1 min-w-0">
          <h4 className="text-xs font-medium text-gray-200">{insight.title}</h4>
          <p className="text-[11px] text-gray-400 mt-0.5">{insight.message}</p>
          {insight.recommendation && (
            <p className="text-[10px] text-gray-500 mt-1">{insight.recommendation}</p>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── RuleToggle ─────────────────────────────────────────────────────

function RuleToggle({
  rule,
  fireCount,
  onToggle,
}: {
  rule: ServerRule;
  fireCount: number;
  onToggle: () => void;
}) {
  return (
    <button
      onClick={onToggle}
      className="w-full flex items-start gap-2.5 px-2 py-1.5 rounded-lg hover:bg-gray-800/30 transition-colors text-left"
    >
      <div
        className={`mt-0.5 w-7 h-3.5 rounded-full relative flex-shrink-0 transition-colors ${
          rule.enabled ? 'bg-blue-500' : 'bg-gray-700'
        }`}
      >
        <div
          className={`absolute top-0.5 w-2.5 h-2.5 rounded-full bg-white transition-transform ${
            rule.enabled ? 'translate-x-3.5' : 'translate-x-0.5'
          }`}
        />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] text-gray-300">{rule.name}</span>
          <SeverityBadge severity={rule.defaultSeverity} />
          {fireCount > 0 && (
            <span className="text-[9px] text-gray-600 bg-gray-800/50 px-1 py-0.5 rounded">
              {fireCount}x
            </span>
          )}
          {rule.suppressed && (
            <span className="text-[9px] text-red-500/70 bg-red-500/10 px-1 py-0.5 rounded">
              suppressed
            </span>
          )}
        </div>
        <div className="text-[10px] text-gray-600 mt-0.5 line-clamp-1">{rule.description}</div>
      </div>
    </button>
  );
}

// ─── NudgeCard ──────────────────────────────────────────────────────

function NudgeCard({
  nudge,
  onDismiss,
  dismissed = false,
}: {
  nudge: CoachingNudge;
  onDismiss?: () => void;
  dismissed?: boolean;
}) {
  const styles = SEVERITY_STYLES[nudge.severity];
  const icon = SEVERITY_ICONS[nudge.severity];
  const isAiEnriched = nudge.recommendation?.includes('AI Analysis:');

  // Split recommendation into base + AI parts if enriched
  const recParts = isAiEnriched
    ? nudge.recommendation.split('\n\nAI Analysis:')
    : [nudge.recommendation];
  const baseRec = recParts[0];
  const aiAnalysis = recParts.length > 1 ? recParts[1] : null;

  return (
    <div
      className={`rounded-lg border ${styles.border} ${styles.bg} p-3 ${dismissed ? 'opacity-50' : ''}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-2 flex-1">
          <span className={`${styles.icon} text-sm mt-0.5`}>{icon}</span>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h4 className={`text-xs font-medium ${styles.text}`}>{nudge.title}</h4>
              {isAiEnriched && (
                <span className="px-1.5 py-0.5 bg-purple-500/20 border border-purple-500/30 rounded text-[9px] font-medium text-purple-400">
                  {'\u2728'} AI
                </span>
              )}
              <span className="text-[10px] text-gray-600">
                {new Date(nudge.firedAt).toLocaleTimeString()}
              </span>
            </div>
            <p className="text-xs text-gray-400 mt-1">{nudge.message}</p>
            {nudge.triggerPrompt && (
              <div className="mt-1.5 px-2 py-1 bg-gray-800/40 border-l-2 border-gray-600/40 rounded-r">
                <span className="text-[10px] text-gray-600 font-medium uppercase tracking-wide">
                  Triggered by
                </span>
                <p className="text-[11px] text-gray-500 mt-0.5 italic truncate">
                  &ldquo;{nudge.triggerPrompt}&rdquo;
                </p>
              </div>
            )}
            {baseRec && <RecommendationBlock text={baseRec} />}
            {aiAnalysis && (
              <div className="mt-1.5 px-2 py-1.5 bg-purple-500/5 border-l-2 border-purple-500/40 rounded-r text-[11px] text-purple-300">
                <span className="text-[9px] text-purple-500 uppercase tracking-wider font-medium">
                  AI Analysis
                </span>
                <div className="mt-0.5 whitespace-pre-line">{aiAnalysis.trim()}</div>
              </div>
            )}
          </div>
        </div>
        {!dismissed && onDismiss && (
          <button
            onClick={onDismiss}
            className="text-gray-600 hover:text-gray-400 transition-colors text-xs px-1"
            title="Dismiss"
          >
            {'\u2715'}
          </button>
        )}
      </div>
    </div>
  );
}

// ─── RecommendationBlock ────────────────────────────────────────────

function RecommendationBlock({ text }: { text: string }) {
  // Parse text into segments: normal text and code blocks
  const segments = useMemo(() => {
    const result: { type: 'text' | 'code'; content: string }[] = [];
    const codeBlockRegex = /```(?:\w*\n)?([\s\S]*?)```/g;
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = codeBlockRegex.exec(text)) !== null) {
      // Text before code block
      if (match.index > lastIndex) {
        const before = text.slice(lastIndex, match.index).trim();
        if (before) result.push({ type: 'text', content: before });
      }
      result.push({ type: 'code', content: match[1].trim() });
      lastIndex = match.index + match[0].length;
    }

    // Remaining text
    if (lastIndex < text.length) {
      const remaining = text.slice(lastIndex).trim();
      if (remaining) result.push({ type: 'text', content: remaining });
    }

    // Fallback: if no segments, treat whole thing as text
    if (result.length === 0) result.push({ type: 'text', content: text });

    return result;
  }, [text]);

  return (
    <div className="mt-2 space-y-1.5">
      {segments.map((seg, i) =>
        seg.type === 'code' ? (
          <CopyableCodeBlock key={i} code={seg.content} />
        ) : (
          <div
            key={i}
            className="px-2 py-1.5 bg-syn-bg-primary border-l-2 border-blue-500/50 rounded-r text-[11px] text-blue-300 whitespace-pre-line"
          >
            {seg.content}
          </div>
        ),
      )}
    </div>
  );
}

// ─── CopyableCodeBlock ──────────────────────────────────────────────

function CopyableCodeBlock({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleCopy = useCallback(async () => {
    const ok = await copyToClipboard(code);
    if (ok) {
      setCopied(true);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setCopied(false), 2000);
    }
  }, [code]);

  return (
    <div className="relative group">
      <pre className="px-3 py-2 bg-syn-bg-primary border border-gray-800 rounded-lg text-[11px] text-emerald-300 font-mono whitespace-pre-wrap overflow-x-auto">
        {code}
      </pre>
      <button
        onClick={handleCopy}
        className="absolute top-1.5 right-1.5 px-1.5 py-0.5 bg-gray-800/80 border border-gray-700 rounded text-[9px] text-gray-400 hover:text-gray-200 opacity-0 group-hover:opacity-100 transition-opacity"
        title="Copy to clipboard"
      >
        {copied ? '\u2713 Copied' : 'Copy'}
      </button>
    </div>
  );
}
