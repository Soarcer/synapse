// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Synapse Contributors

import { useState, useMemo } from 'react';
import { useAgentStore } from '../../store/agentStore';
import { MobileSessionSelector } from './MobileSessionSelector';

export function MobileStatusBar() {
  const connectionStatus = useAgentStore((s) => s.connectionStatus);
  const agents = useAgentStore((s) => s.agents);
  const sessions = useAgentStore((s) => s.sessions);
  const paused = useAgentStore((s) => s.paused);
  const [expanded, setExpanded] = useState(false);

  const { runningCount, totalAgents, totalTokens } = useMemo(() => {
    let running = 0;
    let tokens = 0;
    for (const a of agents.values()) {
      if (a.status === 'running') running++;
      tokens += a.tokenUsage.input + a.tokenUsage.output;
    }
    return { runningCount: running, totalAgents: agents.size, totalTokens: tokens };
  }, [agents]);

  const statusColor =
    connectionStatus === 'connected' ? 'bg-green-500' :
    connectionStatus === 'reconnecting' ? 'bg-yellow-500 animate-pulse' :
    'bg-red-500';

  const statusLabel =
    connectionStatus === 'connected' ? 'Connected' :
    connectionStatus === 'reconnecting' ? 'Reconnecting...' :
    connectionStatus === 'failed' ? 'Failed' : 'Disconnected';

  return (
    <div className="flex-shrink-0 bg-[#161b22] border-b border-gray-800">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full px-3 py-2 flex items-center gap-3 text-xs text-gray-400"
      >
        <span className={`w-2 h-2 rounded-full flex-shrink-0 ${statusColor}`} />
        <span>{statusLabel}</span>
        {paused && (
          <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-yellow-500/20 text-yellow-400">Paused</span>
        )}
        <span className="text-gray-600">|</span>
        <span>{runningCount > 0 ? `${runningCount} running` : `${totalAgents} agents`}</span>
        {totalTokens > 0 && (
          <>
            <span className="text-gray-600">|</span>
            <span>{(totalTokens / 1000).toFixed(1)}k tok</span>
          </>
        )}
        <span className="ml-auto text-gray-600">{expanded ? '\u25B2' : '\u25BC'}</span>
      </button>

      {sessions.size > 1 && (
        <div className="px-3 pb-1.5 flex">
          <MobileSessionSelector />
        </div>
      )}

      {expanded && (
        <div className="px-3 pb-2 text-xs text-gray-500 space-y-1 border-t border-gray-800/50 pt-1.5">
          <div>Sessions: {sessions.size}</div>
          <div>Total agents: {totalAgents} ({runningCount} running)</div>
          <div>Tokens: {totalTokens.toLocaleString()}</div>
          <a
            href={`${window.location.pathname}?view=full`}
            className="text-blue-400 hover:underline inline-block mt-1"
          >
            Switch to desktop view &rarr;
          </a>
        </div>
      )}
    </div>
  );
}
