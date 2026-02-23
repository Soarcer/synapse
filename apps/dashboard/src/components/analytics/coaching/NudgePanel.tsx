// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Synapse Contributors

import { useAgentStore } from '../../../store/agentStore';
import { apiUrl } from '../../../utils/api';
import type { CoachingNudge, NudgeSeverity } from '@synapse-ai/core';

interface NudgePanelProps {
  nudges: CoachingNudge[];
  sessionId: string | null;
}

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
  info: '\u2139', // ℹ
  suggestion: '\u26A0', // ⚠
  warning: '\u26D4', // ⛔
};

export function NudgePanel({ nudges, sessionId }: NudgePanelProps) {
  const liveNudges = useAgentStore((s) => s.liveNudges);
  const dismissNudge = useAgentStore((s) => s.dismissNudge);

  // Combine live nudges (from WS) with historical nudges (from API)
  // Deduplicate by nudge ID
  const seenIds = new Set<string>();
  const allNudges: CoachingNudge[] = [];

  for (const n of liveNudges) {
    if (sessionId && n.sessionId !== sessionId) continue;
    if (!seenIds.has(n.id)) {
      seenIds.add(n.id);
      allNudges.push(n);
    }
  }
  for (const n of nudges) {
    if (!seenIds.has(n.id)) {
      seenIds.add(n.id);
      allNudges.push(n);
    }
  }

  // Sort by timestamp, newest first
  allNudges.sort((a, b) => b.firedAt - a.firedAt);

  const activeNudges = allNudges.filter((n) => !n.dismissed);
  const dismissedNudges = allNudges.filter((n) => n.dismissed);

  const handleDismiss = (nudge: CoachingNudge) => {
    dismissNudge(nudge.id);
    // Also persist to backend
    if (sessionId) {
      fetch(apiUrl('/api/analytics/coaching/nudges/dismiss'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, nudgeId: nudge.id }),
      }).catch(() => {
        /* ignore */
      });
    }
  };

  if (allNudges.length === 0) {
    return (
      <div className="flex items-center justify-center h-48">
        <div className="text-center">
          <div className="text-gray-600 text-3xl mb-3">&#x2705;</div>
          <p className="text-sm text-gray-400">No coaching nudges</p>
          <p className="text-xs text-gray-600 mt-1">
            Nudges appear in real-time during active sessions
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Active nudges */}
      {activeNudges.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-xs font-medium text-gray-400 uppercase tracking-wider">
            Active ({activeNudges.length})
          </h3>
          {activeNudges.map((nudge) => (
            <NudgeCard key={nudge.id} nudge={nudge} onDismiss={() => handleDismiss(nudge)} />
          ))}
        </div>
      )}

      {/* Dismissed nudges */}
      {dismissedNudges.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-xs font-medium text-gray-600 uppercase tracking-wider">
            Dismissed ({dismissedNudges.length})
          </h3>
          {dismissedNudges.map((nudge) => (
            <NudgeCard key={nudge.id} nudge={nudge} dismissed />
          ))}
        </div>
      )}
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
              <span className="text-[10px] text-gray-600">
                {new Date(nudge.firedAt).toLocaleTimeString()}
              </span>
            </div>
            <p className="text-xs text-gray-400 mt-1">{nudge.message}</p>
            {nudge.recommendation && (
              <div className="mt-2 px-2 py-1.5 bg-[#0d1117] border-l-2 border-blue-500/50 rounded-r text-[11px] text-blue-300">
                {nudge.recommendation}
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
