import { useState, useMemo } from 'react';
import { useAgentStore } from '../../store/agentStore';
import { apiUrl } from '../../utils/api';
import type { CoachingNudge, NudgeSeverity } from '@synapse-ai/core';
import { Tooltip } from '../ui/Tooltip';

const SEVERITY_STYLES: Record<NudgeSeverity, { border: string; bg: string; text: string }> = {
  info: { border: 'border-blue-500/40', bg: 'bg-blue-500/10', text: 'text-blue-300' },
  suggestion: { border: 'border-amber-500/40', bg: 'bg-amber-500/10', text: 'text-amber-300' },
  warning: { border: 'border-red-500/40', bg: 'bg-red-500/10', text: 'text-red-300' },
};

export function NudgeBadge() {
  const liveNudges = useAgentStore((s) => s.liveNudges);
  const dismissNudge = useAgentStore((s) => s.dismissNudge);
  const [expanded, setExpanded] = useState(false);

  const activeNudges = useMemo(() => liveNudges.filter((n) => !n.dismissed), [liveNudges]);

  if (activeNudges.length === 0) return null;

  const handleDismiss = (nudge: CoachingNudge) => {
    dismissNudge(nudge.id);
    fetch(apiUrl('/api/analytics/coaching/nudges/dismiss'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: nudge.sessionId, nudgeId: nudge.id }),
    }).catch(() => {});
  };

  const worstSeverity: NudgeSeverity = activeNudges.some((n) => n.severity === 'warning')
    ? 'warning'
    : activeNudges.some((n) => n.severity === 'suggestion')
      ? 'suggestion'
      : 'info';

  const badgeColor =
    worstSeverity === 'warning' ? 'bg-red-500' : worstSeverity === 'suggestion' ? 'bg-amber-500' : 'bg-blue-500';

  return (
    <div className="absolute top-2 right-2 z-20">
      {/* Badge button */}
      <Tooltip content="Coaching nudges — click to view">
        <button
          onClick={() => setExpanded(!expanded)}
          className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg ${badgeColor}/20 border ${badgeColor}/40 backdrop-blur-sm hover:brightness-125 transition-all`}
        >
          <span className={`w-2 h-2 rounded-full ${badgeColor} animate-pulse`} />
          <span className="text-xs text-gray-200 font-medium">
            {activeNudges.length} nudge{activeNudges.length !== 1 ? 's' : ''}
          </span>
        </button>
      </Tooltip>

      {/* Expanded panel */}
      {expanded && (
        <div className="mt-1 w-[320px] max-h-[300px] overflow-y-auto bg-[#0d1117] border border-gray-700 rounded-lg shadow-xl">
          {activeNudges.slice(0, 5).map((nudge) => {
            const styles = SEVERITY_STYLES[nudge.severity];
            return (
              <div key={nudge.id} className={`p-3 border-b border-gray-800/50 ${styles.bg}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <h4 className={`text-xs font-medium ${styles.text}`}>{nudge.title}</h4>
                    <p className="text-[10px] text-gray-400 mt-0.5 line-clamp-2">{nudge.message}</p>
                  </div>
                  <Tooltip content="Dismiss this nudge">
                    <button
                      onClick={() => handleDismiss(nudge)}
                      className="text-gray-600 hover:text-gray-400 text-xs px-1 flex-shrink-0"
                    >
                      &#x2715;
                    </button>
                  </Tooltip>
                </div>
              </div>
            );
          })}
          {activeNudges.length > 5 && (
            <div className="px-3 py-2 text-center text-[10px] text-gray-600">
              +{activeNudges.length - 5} more nudges
            </div>
          )}
        </div>
      )}
    </div>
  );
}
