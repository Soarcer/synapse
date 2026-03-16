// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bernhard

import { useState, useMemo, useCallback, useRef } from 'react';
import { useAgentStore } from '../../store/agentStore';
import { usePermissionStore } from '../../store/permissionStore';
import { wsClient } from '../../store/wsClient';
import { MobileSessionSelector } from './MobileSessionSelector';
import { GAME_MODE_REGISTRY } from '../graph/nodes/game-modes';
import { toast } from '../Toast';
import { formatDuration, computeCostUsd, getPrice } from '@synapse-ai/core';

export function MobileStatusBar() {
  const connectionStatus = useAgentStore((s) => s.connectionStatus);
  const agents = useAgentStore((s) => s.agents);
  const sessions = useAgentStore((s) => s.sessions);
  const paused = useAgentStore((s) => s.paused);
  const pendingCount = usePermissionStore((s) => s.pending.length);
  const [expanded, setExpanded] = useState(false);

  // Easter egg: 7 rapid taps on the Synapse title unlocks arcade mode
  const clickTimesRef = useRef<number[]>([]);
  const handleTitleTap = useCallback(() => {
    const now = Date.now();
    clickTimesRef.current.push(now);
    clickTimesRef.current = clickTimesRef.current.filter((t) => now - t < 2000);
    if (clickTimesRef.current.length >= 7) {
      clickTimesRef.current = [];
      const store = useAgentStore.getState();
      if (store.arcadeMode) return;
      store.setArcadeUnlocked(true);
      store.setArcadeMode(true);
      store.setShowAllTools(true);
      const modes = GAME_MODE_REGISTRY.map((m) => m.id);
      store.setToolGroupMode(modes[Math.floor(Math.random() * modes.length)]);
      toast('SECRET UNLOCKED — Arcade mode activated!', 'info');
    }
  }, []);

  const handleReconnect = useCallback(
    (e: React.MouseEvent) => {
      if (connectionStatus !== 'connected') {
        e.stopPropagation();
        wsClient.resetAndReconnect();
      }
    },
    [connectionStatus],
  );

  const nodes = useAgentStore((s) => s.nodes);

  const stats = useMemo(() => {
    let running = 0;
    let tokens = 0;
    let earliest = Infinity;
    let latest = 0;
    let totalCost = 0;
    for (const a of agents.values()) {
      if (a.status === 'running') running++;
      const t = a.tokenUsage;
      tokens += t.input + t.output;
      const price = getPrice(a.model ?? 'claude-sonnet-4-5', []);
      totalCost += computeCostUsd({
        inputTokens: t.input,
        outputTokens: t.output,
        cacheReadTokens: t.cacheRead ?? 0,
        cacheCreationTokens: t.cacheCreation ?? 0,
        thinkingTokens: t.thinking ?? 0,
        price,
      }).total;
      if (a.startTime < earliest) earliest = a.startTime;
      const end = a.endTime ?? Date.now();
      if (end > latest) latest = end;
    }
    let prompts = 0,
      agentCount = 0,
      tools = 0;
    for (const n of nodes) {
      if (n.type === 'userPrompt') prompts++;
      else if (n.type === 'agent') agentCount++;
      else if (n.type === 'toolCall') tools++;
    }
    const durationMs = latest > earliest ? latest - earliest : 0;
    // Compact: "6A · 35P · 262T"
    const parts: string[] = [];
    if (prompts > 0) parts.push(`${prompts}Pr`);
    if (agentCount > 0) parts.push(`${agentCount}Ag`);
    if (tools > 0) parts.push(`${tools}To`);
    return {
      runningCount: running,
      totalAgents: agents.size,
      totalTokens: tokens,
      totalCost,
      durationMs,
      prompts,
      agentCount,
      tools,
      nodeTotal: prompts + agentCount + tools,
      compact: parts.join('\u00b7'),
    };
  }, [agents, nodes]);

  const statusColor =
    connectionStatus === 'connected'
      ? 'bg-green-500'
      : connectionStatus === 'reconnecting'
        ? 'bg-yellow-500 animate-pulse'
        : 'bg-red-500';

  const statusLabel =
    connectionStatus === 'connected'
      ? 'Connected'
      : connectionStatus === 'reconnecting'
        ? 'Reconnecting...'
        : connectionStatus === 'failed'
          ? 'Failed'
          : 'Disconnected';

  return (
    <div
      className="flex-shrink-0 bg-syn-bg-surface border-b border-gray-800"
      style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}
    >
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full px-3 py-2 flex items-center gap-3 text-xs text-gray-400"
      >
        <span
          onClick={(e) => {
            e.stopPropagation();
            handleTitleTap();
          }}
          className="font-semibold text-gray-300 tracking-wide mr-1 select-none"
        >
          Synapse
        </span>
        <span className={`w-2 h-2 rounded-full flex-shrink-0 ${statusColor}`} />
        <span
          onClick={handleReconnect}
          className={connectionStatus !== 'connected' ? 'underline decoration-dotted' : ''}
        >
          {connectionStatus !== 'connected' ? `${statusLabel} (tap to retry)` : statusLabel}
        </span>
        {paused && (
          <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-yellow-500/20 text-yellow-400">
            Paused
          </span>
        )}
        {stats.nodeTotal > 0 && (
          <>
            <span className="text-gray-600">&middot;</span>
            <span className="tabular-nums">{stats.compact}</span>
          </>
        )}
        {stats.durationMs > 0 && (
          <>
            <span className="text-gray-600">&middot;</span>
            <span className="tabular-nums">{formatDuration(stats.durationMs)}</span>
          </>
        )}
        {pendingCount > 0 && (
          <>
            <span className="text-gray-600">&middot;</span>
            <span className="text-amber-400 font-medium">{pendingCount} perm</span>
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
          <div>
            {stats.nodeTotal} nodes: {stats.agentCount} agents, {stats.prompts} prompts,{' '}
            {stats.tools} tools
          </div>
          <div>{stats.runningCount > 0 ? `${stats.runningCount} running` : 'None running'}</div>
          {stats.totalTokens > 0 && (
            <div>
              Tokens: {stats.totalTokens.toLocaleString()}
              {stats.totalCost > 0 && (
                <span className="text-amber-400/70 ml-2">
                  $
                  {stats.totalCost < 0.01 ? stats.totalCost.toFixed(4) : stats.totalCost.toFixed(2)}
                </span>
              )}
            </div>
          )}
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
