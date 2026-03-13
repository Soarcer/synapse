// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bernhard

import { useMemo, useEffect, useState } from 'react';
import { useAgentStore } from '../../store/agentStore';
import { formatTokens, formatDuration, computeCostUsd, getPrice } from '@synapse-ai/core';
import { Tooltip } from '../ui/Tooltip';
import { apiUrl } from '../../utils/api';

interface PlanInfo {
  plan: string;
  source: 'auto' | 'manual';
  monthlyLimit: number | null;
}

const PLAN_LABELS: Record<string, string> = {
  free: 'Free',
  pro: 'Pro $20/mo',
  max_5x: 'Max 5× $100/mo',
  max_20x: 'Max 20× $200/mo',
  api: 'API (pay-per-use)',
};

export function GraphStats() {
  const nodes = useAgentStore((s) => s.nodes);
  const agents = useAgentStore((s) => s.agents);
  const timePresetLabel = useAgentStore((s) => s.timePresetLabel);
  const costDisplayMode = useAgentStore((s) => s.costDisplayMode);

  const [plan, setPlan] = useState<PlanInfo | null>(null);

  useEffect(() => {
    fetch(apiUrl('/api/analytics/budget'))
      .then((r) => r.json())
      .then((data) => {
        const planData = data?.data?.plan;
        if (planData && typeof planData.plan === 'string') {
          setPlan({
            plan: planData.plan,
            source: planData.source ?? 'auto',
            monthlyLimit: planData.monthlyLimit ?? null,
          });
        } else {
          // Fallback if endpoint returns no plan info
          setPlan({ plan: 'pro', source: 'auto', monthlyLimit: 20 });
        }
      })
      .catch(() => {
        // Fallback on error
        setPlan({ plan: 'pro', source: 'auto', monthlyLimit: 20 });
      });
  }, []);

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
      const price = getPrice(agent.model ?? 'claude-sonnet-4-5');
      const breakdown = computeCostUsd({
        inputTokens: t.input,
        outputTokens: t.output,
        cacheReadTokens: t.cacheRead ?? 0,
        cacheCreationTokens: t.cacheCreation ?? 0,
        thinkingTokens: t.thinking ?? 0,
        price,
      });
      totalCost += breakdown.total;
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
  const isApiPlan = plan?.plan === 'api';

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
          <Tooltip
            content={
              costDisplayMode === 'cost'
                ? isApiPlan
                  ? 'API cost'
                  : 'API-equivalent cost'
                : 'Combined input + output tokens'
            }
          >
            <span className="hidden md:inline tabular-nums whitespace-nowrap text-gray-400">
              {costDisplayMode === 'cost' ? (
                <span title={isApiPlan ? 'API cost' : 'API-equivalent cost'}>
                  {isApiPlan ? '' : '≈'}${stats.totalCost.toFixed(2)}
                </span>
              ) : (
                <span>{formatTokens(stats.totalTokens)} tokens</span>
              )}
            </span>
          </Tooltip>
        </>
      )}
      {costDisplayMode !== 'cost' && stats.totalCost > 0 && (
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
      {plan && (
        <>
          <span className="hidden lg:inline text-gray-600">&middot;</span>
          <span
            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium
            ${
              plan.plan === 'api'
                ? 'bg-blue-500/20 text-blue-300'
                : plan.source === 'auto'
                  ? 'bg-green-500/20 text-green-300'
                  : 'bg-amber-500/20 text-amber-300'
            }`}
            title={plan.source === 'auto' ? 'Auto-detected' : 'Manually set'}
          >
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                plan.plan === 'api'
                  ? 'bg-blue-400'
                  : plan.source === 'auto'
                    ? 'bg-green-400'
                    : 'bg-amber-400'
              }`}
            />
            {PLAN_LABELS[plan.plan] ?? plan.plan}
          </span>
        </>
      )}
      {isFiltered && (
        <span className="text-blue-400/60 text-[10px] whitespace-nowrap">(filtered)</span>
      )}
    </div>
  );
}
