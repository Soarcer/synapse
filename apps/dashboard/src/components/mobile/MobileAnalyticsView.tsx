// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bernhard

import { useMemo } from 'react';
import { useAgentStore } from '../../store/agentStore';
import { useAnalyticsData } from '../analytics/useAnalyticsData';
import { KpiCard } from '../analytics/shared/KpiCard';
import { TokenBreakdownBar } from '../analytics/shared/TokenBreakdownBar';
import { ModelBadge } from '../analytics/shared/ModelBadge';
import { fmtTokens } from '../analytics/shared/constants';
import { formatCostDisplay } from '../analytics/shared/costFormat';
import { formatRelativeTime, formatDuration } from '@synapse-ai/core';

const TIME_RANGE_MAP: Record<string, string> = {
  'Last hour': '1h',
  'Last 4h': '6h',
  Today: '24h',
  'This week': '7d',
  'Last 30 days': '30d',
  'All time': 'all',
};

function formatUsd(n: number): string {
  if (n === 0) return '$0.00';
  if (n < 0.01) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(2)}`;
}

export function MobileAnalyticsView() {
  const timePresetLabel = useAgentStore((s) => s.timePresetLabel);
  const filter = useAgentStore((s) => s.filter);
  const costDisplayMode = useAgentStore((s) => s.costDisplayMode);
  // API plan assumed for now — extend when plan endpoint is wired to the mobile view
  const isApiPlan = true;

  const timeRange = TIME_RANGE_MAP[timePresetLabel] ?? '7d';
  const { overview, sessions, models, isLoading, error } = useAnalyticsData({
    timeRange,
    sessionId: filter.sessionId,
  });

  const totalTokens = useMemo(() => {
    if (!overview) return 0;
    return (
      overview.totalTokens.input + overview.totalTokens.output + overview.totalTokens.cacheRead
    );
  }, [overview]);

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-500 text-sm">
        Loading analytics...
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex-1 flex items-center justify-center text-red-400 text-sm px-4 text-center">
        {error}
      </div>
    );
  }

  if (!overview) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-gray-500 text-sm gap-2 px-4">
        <span className="text-2xl">&#x2261;</span>
        <span>No analytics data yet</span>
        <span className="text-[10px] text-gray-600">Start a Claude session to see stats here</span>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-3 space-y-3" style={{ overscrollBehavior: 'contain' }}>
      {/* KPI Grid - 2x2 — layout switches based on costDisplayMode */}
      <div className="grid grid-cols-2 gap-2">
        {costDisplayMode === 'cost' ? (
          <>
            <KpiCard label="API Cost" value={formatCostDisplay(overview.totalCost, isApiPlan)} />
            <KpiCard
              label="Avg/Session"
              value={
                overview.totalSessions > 0
                  ? formatCostDisplay(overview.totalCost / overview.totalSessions, isApiPlan)
                  : formatCostDisplay(0, isApiPlan)
              }
            />
            <KpiCard
              label="Cache Savings"
              value={formatCostDisplay((overview.totalTokens.cacheRead / 1_000_000) * 3, isApiPlan)}
            />
            <KpiCard label="Tokens" value={fmtTokens(totalTokens)} />
          </>
        ) : (
          <>
            <KpiCard label="Tokens" value={fmtTokens(totalTokens)} />
            <KpiCard label="Sessions" value={String(overview.totalSessions)} />
            <KpiCard
              label="Cache %"
              value={
                totalTokens > 0
                  ? `${Math.round((overview.totalTokens.cacheRead / totalTokens) * 100)}%`
                  : '0%'
              }
            />
            <KpiCard label="Tool Calls" value={String(overview.totalToolCalls)} />
          </>
        )}
      </div>

      {/* Token Breakdown */}
      <div className="bg-syn-bg-surface border border-gray-800 rounded-xl p-3">
        <TokenBreakdownBar
          inputTokens={overview.totalTokens.input}
          outputTokens={overview.totalTokens.output}
          cacheReadTokens={overview.totalTokens.cacheRead}
        />
      </div>

      {/* Model Breakdown */}
      {models.length > 0 && (
        <div className="bg-syn-bg-surface border border-gray-800 rounded-xl p-3">
          <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-2">Models</div>
          <div className="flex flex-wrap gap-2">
            {models.map((m) => (
              <div key={m.model} className="flex items-center gap-1.5">
                <ModelBadge model={m.model} />
                <span className="text-[10px] text-gray-400">{formatUsd(m.cost)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Session List */}
      {sessions.length > 0 && (
        <div className="bg-syn-bg-surface border border-gray-800 rounded-xl p-3">
          <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-2">
            Recent sessions ({sessions.length})
          </div>
          <div className="space-y-1.5 max-h-60 overflow-y-auto">
            {sessions.map((s) => {
              const duration = s.endTime ? s.endTime - s.startTime : Date.now() - s.startTime;
              const isActive = filter.sessionId === s.id;
              return (
                <button
                  key={s.id}
                  onClick={() => useAgentStore.getState().setFilter({ sessionId: s.id })}
                  className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-left transition-colors ${
                    isActive
                      ? 'bg-cyan-500/10 border border-cyan-500/30'
                      : 'bg-gray-900/50 border border-transparent hover:bg-gray-800'
                  }`}
                >
                  <span
                    className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                      s.endTime ? 'bg-gray-500' : 'bg-green-500 animate-pulse'
                    }`}
                  />
                  <span className="text-[10px] text-gray-400 flex-shrink-0">
                    {formatRelativeTime(s.startTime)}
                  </span>
                  <ModelBadge model={s.model} />
                  <span className="text-[10px] text-gray-500 flex-shrink-0">
                    {formatDuration(duration)}
                  </span>
                  <span className="ml-auto text-[10px] text-gray-400 flex-shrink-0">
                    {formatUsd(s.totalCost)}
                  </span>
                  <span className="text-[10px] text-gray-500 flex-shrink-0">
                    {fmtTokens(s.totalInputTokens + s.totalOutputTokens)}
                  </span>
                </button>
              );
            })}
          </div>
          {filter.sessionId && (
            <button
              onClick={() => useAgentStore.getState().setFilter({ sessionId: undefined })}
              className="mt-2 w-full text-[10px] text-cyan-400 hover:text-cyan-300 transition-colors"
            >
              Clear session filter
            </button>
          )}
        </div>
      )}
    </div>
  );
}
