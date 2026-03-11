// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bernhard

import { useState, useRef, useCallback } from 'react';
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso';
import { useAgentStore } from '../../store/agentStore';
import { SkeletonLoader } from '../SkeletonLoader';
import type { AgentEvent } from '@synapse-ai/core';

export function ToolLogPanel() {
  const events = useAgentStore((s) => s.events);
  const agents = useAgentStore((s) => s.agents);
  const isLoading = useAgentStore((s) => s.isLoading);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [filterTool, setFilterTool] = useState<string>('');
  const [filterStatus, setFilterStatus] = useState<string>('');
  const virtuosoRef = useRef<VirtuosoHandle>(null);

  // Filter tool events
  const toolEvents = events.filter(
    (e) =>
      (e.type === 'tool_start' || e.type === 'tool_end' || e.type === 'tool_error') &&
      (!filterTool || e.toolName === filterTool) &&
      (!filterStatus || e.type === `tool_${filterStatus}`),
  );

  // Unique tool names for filter
  const toolNames = [...new Set(events.filter((e) => e.toolName).map((e) => e.toolName!))];

  const toggleExpand = useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  return (
    <div className="flex flex-col h-full" aria-label="Tool log panel">
      {/* Filters */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-800 flex-shrink-0">
        <span className="text-xs text-gray-500">Filter:</span>
        <select
          value={filterTool}
          onChange={(e) => setFilterTool(e.target.value)}
          aria-label="Filter by tool name"
          className="bg-gray-900 border border-gray-700 rounded px-2 py-1 text-xs text-gray-300"
        >
          <option value="">All tools</option>
          {toolNames.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
          aria-label="Filter by status"
          className="bg-gray-900 border border-gray-700 rounded px-2 py-1 text-xs text-gray-300"
        >
          <option value="">All statuses</option>
          <option value="start">Running</option>
          <option value="end">Success</option>
          <option value="error">Error</option>
        </select>
        <span className="ml-auto text-xs text-gray-600">{toolEvents.length} events</span>
      </div>

      {/* List — virtualized */}
      <div className="flex-1 overflow-hidden">
        {isLoading && toolEvents.length === 0 ? (
          <SkeletonLoader rows={4} />
        ) : toolEvents.length === 0 ? (
          <div className="p-8 text-center text-gray-600 text-sm">No tool events yet</div>
        ) : (
          <Virtuoso
            ref={virtuosoRef}
            data={toolEvents}
            followOutput="smooth"
            overscan={200}
            itemContent={(_idx, event) => (
              <div className="border-b border-gray-800/50">
                <ToolEventRow
                  key={event.id}
                  event={event}
                  agentType={agents.get(event.agentId ?? '')?.agentType}
                  isExpanded={expanded.has(event.id)}
                  onToggle={() => toggleExpand(event.id)}
                />
              </div>
            )}
          />
        )}
      </div>
    </div>
  );
}

function ToolEventRow({
  event,
  agentType,
  isExpanded,
  onToggle,
}: {
  event: AgentEvent;
  agentType?: string;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const time = new Date(event.timestamp).toLocaleTimeString();
  const statusBadge = (
    {
      tool_start: { text: 'running', cls: 'bg-purple-900/50 text-purple-300' },
      tool_end: { text: 'success', cls: 'bg-teal-900/50 text-teal-300' },
      tool_error: { text: 'error', cls: 'bg-red-900/50 text-red-300' },
    } as Record<string, { text: string; cls: string }>
  )[event.type] ?? { text: event.type, cls: 'bg-gray-700 text-gray-300' };

  const duration = event.duration != null ? `${(event.duration / 1000).toFixed(2)}s` : null;

  return (
    <div className="text-xs">
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-3 px-3 py-2 hover:bg-gray-800/50 text-left transition-colors"
      >
        <span className="text-gray-600 font-mono w-20 flex-shrink-0">{time}</span>
        <span className="text-gray-400 w-16 truncate flex-shrink-0">{agentType ?? '—'}</span>
        <span className="text-gray-200 font-medium flex-1 truncate">{event.toolName}</span>
        <span className={`px-1.5 py-0.5 rounded-full text-[10px] ${statusBadge.cls}`}>
          {statusBadge.text}
        </span>
        {duration && <span className="text-gray-500 w-14 text-right">{duration}</span>}
        <span className="text-gray-600">{isExpanded ? '▾' : '▸'}</span>
      </button>

      {isExpanded && (
        <div className="px-3 pb-3 space-y-2">
          {event.toolInput && (
            <div>
              <span className="text-gray-500 text-[10px]">Input</span>
              <pre className="bg-gray-900 rounded p-2 text-gray-300 overflow-auto max-h-32 font-mono text-[10px]">
                {JSON.stringify(event.toolInput, null, 2)}
              </pre>
            </div>
          )}
          {event.toolResponse && (
            <div>
              <span className="text-gray-500 text-[10px]">Response</span>
              <pre className="bg-gray-900 rounded p-2 text-gray-300 overflow-auto max-h-32 font-mono text-[10px]">
                {JSON.stringify(event.toolResponse, null, 2)}
              </pre>
            </div>
          )}
          {event.error && (
            <div>
              <span className="text-red-400 text-[10px]">Error</span>
              <pre className="bg-red-950/30 rounded p-2 text-red-300 font-mono text-[10px]">
                {event.error}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
