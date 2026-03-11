// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bernhard

import { useState, useRef, useEffect, useMemo } from 'react';
import { useAgentStore } from '../../store/agentStore';
import { formatRelativeTime, formatDuration, getVendorColor } from '@synapse-ai/core';
import { Tooltip } from '../ui/Tooltip';

export function SessionSelector() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const sessions = useAgentStore((s) => s.sessions);
  const filter = useAgentStore((s) => s.filter);
  const setFilter = useAgentStore((s) => s.setFilter);
  const events = useAgentStore((s) => s.events);

  useEffect(() => {
    if (!open) return;
    const handle = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [open]);

  const sessionList = useMemo(() => {
    const list = [...sessions.values()];
    // Sort by start time, newest first
    list.sort((a, b) => b.startTime - a.startTime);

    // Count events per session
    const eventCounts = new Map<string, number>();
    for (const event of events) {
      eventCounts.set(event.sessionId, (eventCounts.get(event.sessionId) ?? 0) + 1);
    }

    return list.map((s) => {
      const duration = (s.endTime ?? Date.now()) - s.startTime;
      const eventCount = eventCounts.get(s.sessionId) ?? 0;
      const isRunning = s.status === 'running';
      return { ...s, duration, eventCount, isRunning };
    });
  }, [sessions, events]);

  // Unique vendors across all sessions (for filter pills)
  const vendors = useMemo(() => {
    const set = new Set<string>();
    for (const s of sessionList) {
      if (s.vendor) set.add(s.vendor);
    }
    return [...set].sort();
  }, [sessionList]);

  const filteredSessions = useMemo(() => {
    if (!filter.vendor) return sessionList;
    return sessionList.filter((s) => s.vendor === filter.vendor);
  }, [sessionList, filter.vendor]);

  if (sessionList.length === 0) return null;

  const selectedSession = filter.sessionId
    ? sessionList.find((s) => s.sessionId === filter.sessionId)
    : null;

  const triggerLabel = selectedSession
    ? selectedSession.title
      ? selectedSession.title.slice(0, 24) + (selectedSession.title.length > 24 ? '...' : '')
      : selectedSession.isRunning
        ? `Running · ${formatDuration(selectedSession.duration)}`
        : `${formatRelativeTime(selectedSession.startTime)} · ${formatDuration(selectedSession.duration)}`
    : 'All sessions';

  return (
    <div ref={ref} className="relative">
      <Tooltip
        content={filter.sessionId ? `Session: ${filter.sessionId.slice(0, 8)}` : 'All sessions'}
      >
        <button
          onClick={() => setOpen(!open)}
          aria-label="Session selector"
          aria-expanded={open}
          className={`flex items-center gap-1.5 px-2.5 py-1 text-xs rounded transition-colors max-w-[200px] ${
            filter.sessionId
              ? 'text-cyan-300 bg-cyan-900/30 hover:bg-cyan-800/40 border border-cyan-700/30'
              : 'text-gray-400 hover:text-gray-200 bg-gray-800 hover:bg-gray-700'
          }`}
        >
          <span className="truncate">{triggerLabel}</span>
          <svg
            className="w-3 h-3 flex-shrink-0"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path d="M19 9l-7 7-7-7" />
          </svg>
        </button>
      </Tooltip>

      {open && (
        <div
          role="listbox"
          aria-label="Available sessions"
          className="absolute right-0 top-full mt-1 w-64 bg-[#1c2128] border border-gray-700 rounded-lg shadow-xl z-30 py-1 max-h-64 overflow-auto"
        >
          {vendors.length > 1 && (
            <>
              <div className="flex items-center gap-1 px-3 py-1.5 flex-wrap">
                <button
                  onClick={() => setFilter({ ...filter, vendor: undefined })}
                  className={`px-1.5 py-0.5 rounded text-[10px] font-medium transition-colors ${
                    !filter.vendor ? 'bg-gray-600 text-white' : 'text-gray-400 hover:text-gray-200'
                  }`}
                >
                  All
                </button>
                {vendors.map((v) => (
                  <button
                    key={v}
                    onClick={() =>
                      setFilter({ ...filter, vendor: filter.vendor === v ? undefined : v })
                    }
                    className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium transition-colors"
                    style={
                      filter.vendor === v
                        ? { backgroundColor: getVendorColor(v) + '30', color: getVendorColor(v) }
                        : { color: '#9ca3af' }
                    }
                  >
                    <span
                      className="w-1.5 h-1.5 rounded-full"
                      style={{ backgroundColor: getVendorColor(v) }}
                    />
                    {v}
                  </button>
                ))}
              </div>
              <div className="border-t border-gray-700 my-1" />
            </>
          )}
          <button
            onClick={() => {
              setFilter({ ...filter, sessionId: undefined });
              setOpen(false);
            }}
            className={`w-full px-3 py-2 text-xs text-left transition-colors ${
              !filter.sessionId
                ? 'text-blue-300 bg-blue-900/30'
                : 'text-gray-300 hover:bg-gray-800/80'
            }`}
          >
            All sessions
          </button>
          <div className="border-t border-gray-700 my-1" />
          {filteredSessions.map((s) => (
            <button
              key={s.sessionId}
              onClick={() => {
                setFilter({ ...filter, sessionId: s.sessionId });
                setOpen(false);
              }}
              className={`w-full px-3 py-2 text-left transition-colors ${
                filter.sessionId === s.sessionId ? 'bg-blue-900/30' : 'hover:bg-gray-800/80'
              }`}
            >
              <div className="flex items-center gap-1.5">
                <span
                  className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${s.isRunning ? 'animate-pulse' : ''}`}
                  style={{
                    backgroundColor: s.vendor
                      ? getVendorColor(s.vendor)
                      : s.isRunning
                        ? '#4ade80'
                        : '#6b7280',
                  }}
                />
                <span
                  className={`text-xs truncate max-w-[160px] ${filter.sessionId === s.sessionId ? 'text-blue-300' : 'text-gray-200'}`}
                >
                  {s.title ?? s.sessionId.slice(0, 8)}
                </span>
              </div>
              <div className="flex items-center gap-2 mt-0.5 ml-3">
                <span className="text-[10px] text-gray-500">
                  {s.isRunning ? 'Running' : formatRelativeTime(s.startTime)} ·{' '}
                  {formatDuration(s.duration)}
                </span>
                {s.gitBranch && <span className="text-[10px] text-indigo-400">{s.gitBranch}</span>}
                {s.model && <span className="text-[10px] text-gray-600">{s.model}</span>}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
