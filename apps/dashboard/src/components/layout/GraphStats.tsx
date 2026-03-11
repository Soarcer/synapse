// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bernhard

import { useMemo } from 'react';
import { useAgentStore } from '../../store/agentStore';
import { formatTokens, formatDuration } from '@synapse-ai/core';
import { computeCostUsd } from '../analytics/shared/promptUtils';
import { Tooltip } from '../ui/Tooltip';

export function GraphStats() {
  const nodes = useAgentStore((s) => s.nodes);
  const agents = useAgentStore((s) => s.agents);
  const timePresetLabel = useAgentStore((s) => s.timePresetLabel);

  const stats = useMemo(() => {
    let prompts = 0,
      agentCount = 0,
      tools = 0;
    for (const node of nodes) {
      switch (node.type) {
        case 'userPrompt':
          prompts++;
          break;
        case 'agent':
          agentCount++;
          break;
        case 'toolCall':
          tools++;
          break;
      }
    }
    const total = prompts + agentCount + tools;
    const parts: string[] = [];
    if (prompts > 0) parts.push(`${prompts} prompt${prompts !== 1 ? 's' : ''}`);
    if (agentCount > 0) parts.push(`${agentCount} agent${agentCount !== 1 ? 's' : ''}`);
    if (tools > 0) parts.push(`${tools} tool${tools !== 1 ? 's' : ''}`);

    // Aggregate tokens, cost, and time span from agents
    let totalTokens = 0;
    let totalCost = 0;
    let earliest = Infinity;
    let latest = 0;
    for (const agent of agents.values()) {
      const t = agent.tokenUsage;
      totalTokens += t.input + t.output;
      totalCost += computeCostUsd(
        t.input,
        t.output,
        t.cacheRead ?? 0,
        agent.model ?? 'claude-sonnet-4-5-20250929',
      );
      if (agent.startTime < earliest) earliest = agent.startTime;
      const end = agent.endTime ?? Date.now();
      if (end > latest) latest = end;
    }
    const durationMs = latest > earliest ? latest - earliest : 0;

    return {
      total,
      breakdown: parts.join(', '),
      totalTokens,
      totalCost,
      durationMs,
    };
  }, [nodes, agents]);

  const isFiltered = timePresetLabel !== 'All time';

  if (stats.total === 0) return null;

  return (
    <div className="flex items-center gap-1.5 text-xs text-gray-500 min-w-0 graph-stats">
      <Tooltip content="Total nodes in current view">
        <span className="tabular-nums whitespace-nowrap">
          {stats.total} node{stats.total !== 1 ? 's' : ''}
        </span>
      </Tooltip>
      {stats.breakdown && (
        <>
          <span className="hidden lg:inline text-gray-600">&middot;</span>
          <Tooltip content="Prompts, agents, and tool calls">
            <span className="hidden lg:inline tabular-nums whitespace-nowrap text-gray-500">
              {stats.breakdown}
            </span>
          </Tooltip>
        </>
      )}
      {stats.totalTokens > 0 && (
        <>
          <span className="hidden md:inline text-gray-600">&middot;</span>
          <Tooltip content="Combined input + output tokens">
            <span className="hidden md:inline tabular-nums whitespace-nowrap text-gray-400">
              {formatTokens(stats.totalTokens)} tok
            </span>
          </Tooltip>
        </>
      )}
      {stats.totalCost > 0 && (
        <>
          <span className="hidden md:inline text-gray-600">&middot;</span>
          <Tooltip content="Estimated API cost">
            <span className="hidden md:inline tabular-nums whitespace-nowrap text-amber-400/70">
              ${stats.totalCost < 0.01 ? stats.totalCost.toFixed(4) : stats.totalCost.toFixed(2)}
            </span>
          </Tooltip>
        </>
      )}
      {stats.durationMs > 0 && (
        <>
          <span className="hidden xl:inline text-gray-600">&middot;</span>
          <Tooltip content="Wall-clock time from first to last event">
            <span className="hidden xl:inline tabular-nums whitespace-nowrap text-gray-400">
              {formatDuration(stats.durationMs)}
            </span>
          </Tooltip>
        </>
      )}
      {isFiltered && (
        <span className="text-blue-400/60 text-[10px] whitespace-nowrap">(filtered)</span>
      )}
    </div>
  );
}
