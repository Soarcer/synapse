import { useState, useEffect, useMemo, useCallback } from 'react';
import { useAgentStore } from '../../../store/agentStore';
import { apiUrl } from '../../../utils/api';
import type { CoachingNudge, NudgeSeverity } from '@synapse-ai/core';

type Sensitivity = 'low' | 'medium' | 'high';

// ─── Types ──────────────────────────────────────────────────────────

interface NudgeStats {
  byDetector: { detector_id: string; fire_count: number; dismiss_count: number }[];
  totalFired: number;
  totalDismissed: number;
}

interface NudgeRuleConfig {
  id: string;
  label: string;
  description: string;
  enabled: boolean;
}

// ─── Constants ──────────────────────────────────────────────────────

const SEVERITY_STYLES: Record<NudgeSeverity, { border: string; bg: string; icon: string; text: string }> = {
  info: { border: 'border-blue-500/30', bg: 'bg-blue-500/5', icon: 'text-blue-400', text: 'text-blue-300' },
  suggestion: { border: 'border-amber-500/30', bg: 'bg-amber-500/5', icon: 'text-amber-400', text: 'text-amber-300' },
  warning: { border: 'border-red-500/30', bg: 'bg-red-500/5', icon: 'text-red-400', text: 'text-red-300' },
};

const SEVERITY_ICONS: Record<NudgeSeverity, string> = {
  info: '\u2139',
  suggestion: '\u26A0',
  warning: '\u26D4',
};

const DEFAULT_RULES: NudgeRuleConfig[] = [
  { id: 'nudge.bash-streak', label: 'Bash Streak', description: '3+ consecutive Bash calls for file operations', enabled: true },
  { id: 'nudge.file-reread', label: 'File Re-read', description: 'Same file read 3+ times in a session', enabled: true },
  { id: 'nudge.error-spiral', label: 'Error Spiral', description: '3+ tool errors in recent calls', enabled: true },
  { id: 'nudge.long-session', label: 'Long Session', description: 'Session running >60 minutes', enabled: true },
  { id: 'nudge.write-without-read', label: 'Edit Without Read', description: 'Editing a file without reading it first', enabled: true },
  { id: 'nudge.no-verification', label: 'No Verification', description: '5+ edits without running tests', enabled: true },
  { id: 'nudge.rapid-prompts', label: 'Rapid Prompts', description: '3+ prompts in 2 minutes', enabled: true },
  { id: 'nudge.large-file-edit', label: 'Large File Edit', description: 'Editing a very large file', enabled: true },
];

const EMPTY_STATS: NudgeStats = { byDetector: [], totalFired: 0, totalDismissed: 0 };

// ─── Component ──────────────────────────────────────────────────────

export function LiveNudgesView() {
  const liveNudges = useAgentStore((s) => s.liveNudges);
  const dismissNudge = useAgentStore((s) => s.dismissNudge);

  const [stats, setStats] = useState<NudgeStats>(EMPTY_STATS);
  const [rules, setRules] = useState<NudgeRuleConfig[]>(DEFAULT_RULES);
  const [statsLoading, setStatsLoading] = useState(true);
  const [sensitivity, setSensitivity] = useState<Sensitivity>('medium');
  const [sensitivitySaving, setSensitivitySaving] = useState(false);

  // Fetch stats + sensitivity on mount
  useEffect(() => {
    let cancelled = false;
    fetch(apiUrl('/api/analytics/coaching/nudges/stats'))
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled && d.data) setStats(d.data);
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setStatsLoading(false); });
    fetch(apiUrl('/api/analytics/coaching/sensitivity'))
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled && d.data?.level) setSensitivity(d.data.level);
      })
      .catch(() => {});
    return () => { cancelled = true; };
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

  // Load rules from localStorage
  useEffect(() => {
    try {
      const saved = localStorage.getItem('synapse-nudge-rules');
      if (saved) {
        const parsed = JSON.parse(saved) as Record<string, boolean>;
        setRules((prev) =>
          prev.map((r) => ({ ...r, enabled: parsed[r.id] ?? r.enabled })),
        );
      }
    } catch { /* ignore */ }
  }, []);

  const toggleRule = (id: string) => {
    setRules((prev) => {
      const updated = prev.map((r) => (r.id === id ? { ...r, enabled: !r.enabled } : r));
      try {
        const map: Record<string, boolean> = {};
        for (const r of updated) map[r.id] = r.enabled;
        localStorage.setItem('synapse-nudge-rules', JSON.stringify(map));
      } catch { /* ignore */ }
      return updated;
    });
  };

  // Sort nudges newest-first
  const sortedNudges = useMemo(() => {
    return [...liveNudges].sort((a, b) => b.firedAt - a.firedAt);
  }, [liveNudges]);

  const activeNudges = useMemo(() => sortedNudges.filter((n) => !n.dismissed), [sortedNudges]);
  const dismissedNudges = useMemo(() => sortedNudges.filter((n) => n.dismissed), [sortedNudges]);

  const handleDismiss = (nudge: CoachingNudge) => {
    dismissNudge(nudge.id);
    fetch(apiUrl('/api/analytics/coaching/nudges/dismiss'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: nudge.sessionId, nudgeId: nudge.id }),
    }).catch(() => {});
  };

  const dismissRate = stats.totalFired > 0 ? ((stats.totalDismissed / stats.totalFired) * 100).toFixed(1) : '0';

  return (
    <div className="max-w-[1400px] mx-auto p-4 space-y-4">
      {/* Stats overview */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Total Nudges Fired" value={statsLoading ? '...' : String(stats.totalFired)} />
        <StatCard label="Dismissed" value={statsLoading ? '...' : String(stats.totalDismissed)} />
        <StatCard label="Dismiss Rate" value={statsLoading ? '...' : `${dismissRate}%`} />
        <StatCard label="Active Now" value={String(activeNudges.length)} highlight={activeNudges.length > 0} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Left: Nudge Timeline */}
        <div className="lg:col-span-2 space-y-4">
          {/* Active nudges */}
          <div>
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
              Active Nudges ({activeNudges.length})
            </h3>
            {activeNudges.length === 0 ? (
              <div className="bg-[#161b22] border border-gray-800 rounded-xl p-6 text-center">
                <div className="text-gray-600 text-2xl mb-2">&#x2705;</div>
                <p className="text-sm text-gray-400">No active nudges</p>
                <p className="text-xs text-gray-600 mt-1">Nudges appear in real-time during active sessions</p>
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
              <div className="bg-[#161b22] border border-gray-800 rounded-xl overflow-hidden">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-gray-800">
                      <th className="text-left p-3 text-gray-500 font-medium">Rule</th>
                      <th className="text-right p-3 text-gray-500 font-medium">Fired</th>
                      <th className="text-right p-3 text-gray-500 font-medium">Dismissed</th>
                      <th className="text-right p-3 text-gray-500 font-medium">Rate</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.byDetector.map((row) => {
                      const rule = DEFAULT_RULES.find((r) => r.id === row.detector_id);
                      const rate = row.fire_count > 0 ? ((row.dismiss_count / row.fire_count) * 100).toFixed(0) : '0';
                      return (
                        <tr key={row.detector_id} className="border-b border-gray-800/50">
                          <td className="p-3 text-gray-300">{rule?.label ?? row.detector_id}</td>
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
          <div className="bg-[#161b22] border border-gray-800 rounded-xl p-4">
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
              AI Coaching Sensitivity
            </h3>
            <p className="text-[10px] text-gray-600 mb-3">
              Controls how aggressively AI analyzes tool patterns and escalates nudges.
            </p>
            <div className="flex gap-1.5">
              {(['low', 'medium', 'high'] as const).map((level) => (
                <button
                  key={level}
                  onClick={() => updateSensitivity(level)}
                  disabled={sensitivitySaving}
                  className={`flex-1 px-2 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                    sensitivity === level
                      ? level === 'low'
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
              {sensitivity === 'low' && 'Checks every 20 tool calls. Fewer interruptions.'}
              {sensitivity === 'medium' && 'Checks every 10 tool calls. Balanced coverage.'}
              {sensitivity === 'high' && 'Checks every 5 tool calls. Maximum oversight.'}
            </div>
          </div>

          <div className="bg-[#161b22] border border-gray-800 rounded-xl p-4">
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
              Nudge Rules
            </h3>
            <p className="text-[10px] text-gray-600 mb-3">
              Toggle individual nudge rules on/off. Changes are saved locally.
            </p>
            <div className="space-y-2">
              {rules.map((rule) => (
                <button
                  key={rule.id}
                  onClick={() => toggleRule(rule.id)}
                  className="w-full flex items-start gap-3 p-2 rounded-lg hover:bg-gray-800/30 transition-colors text-left"
                >
                  <div
                    className={`mt-0.5 w-8 h-4 rounded-full relative flex-shrink-0 transition-colors ${
                      rule.enabled ? 'bg-blue-500' : 'bg-gray-700'
                    }`}
                  >
                    <div
                      className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform ${
                        rule.enabled ? 'translate-x-4' : 'translate-x-0.5'
                      }`}
                    />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs text-gray-300">{rule.label}</div>
                    <div className="text-[10px] text-gray-600 mt-0.5">{rule.description}</div>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* How nudges work */}
          <div className="bg-[#161b22] border border-gray-800 rounded-xl p-4">
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
              How It Works
            </h3>
            <div className="space-y-3 text-[11px] text-gray-400 leading-relaxed">
              <p>
                Nudges fire <span className="text-gray-200">in real-time</span> during active Claude Code sessions.
                The nudge engine analyzes tool calls and patterns as they happen.
              </p>
              <p>
                Nudges appear here and as <span className="text-gray-200">toast notifications</span> in the graph view.
                Dismiss them when you've acknowledged the suggestion.
              </p>
              <p>
                Rule configuration is <span className="text-gray-200">local to this browser</span>.
                The server still detects all nudges; toggling rules here only affects display.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Sub-components ─────────────────────────────────────────────────

function StatCard({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="bg-[#161b22] border border-gray-800 rounded-xl p-3">
      <div className="text-[10px] text-gray-500 uppercase tracking-wider">{label}</div>
      <div className={`text-lg font-bold mt-1 ${highlight ? 'text-amber-400' : 'text-gray-100'}`}>{value}</div>
    </div>
  );
}

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
    <div className={`rounded-lg border ${styles.border} ${styles.bg} p-3 ${dismissed ? 'opacity-50' : ''}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-2 flex-1">
          <span className={`${styles.icon} text-sm mt-0.5`}>{icon}</span>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h4 className={`text-xs font-medium ${styles.text}`}>{nudge.title}</h4>
              {isAiEnriched && (
                <span className="px-1.5 py-0.5 bg-purple-500/20 border border-purple-500/30 rounded text-[9px] font-medium text-purple-400">
                  &#x2728; AI
                </span>
              )}
              <span className="text-[10px] text-gray-600">
                {new Date(nudge.firedAt).toLocaleTimeString()}
              </span>
            </div>
            <p className="text-xs text-gray-400 mt-1">{nudge.message}</p>
            {baseRec && (
              <div className="mt-2 px-2 py-1.5 bg-[#0d1117] border-l-2 border-blue-500/50 rounded-r text-[11px] text-blue-300">
                {baseRec}
              </div>
            )}
            {aiAnalysis && (
              <div className="mt-1.5 px-2 py-1.5 bg-purple-500/5 border-l-2 border-purple-500/40 rounded-r text-[11px] text-purple-300">
                <span className="text-[9px] text-purple-500 uppercase tracking-wider font-medium">AI Analysis</span>
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
            &#x2715;
          </button>
        )}
      </div>
    </div>
  );
}
