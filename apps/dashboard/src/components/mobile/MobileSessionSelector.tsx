// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bernhard

import { useMemo } from 'react';
import { useAgentStore } from '../../store/agentStore';
import { formatRelativeTime, formatDuration } from '@synapse-ai/core';

export function MobileSessionSelector() {
  const sessions = useAgentStore((s) => s.sessions);
  const filter = useAgentStore((s) => s.filter);
  const events = useAgentStore((s) => s.events);

  const sessionList = useMemo(() => {
    const list = [...sessions.values()];
    list.sort((a, b) => b.startTime - a.startTime);
    const eventCounts = new Map<string, number>();
    for (const event of events) {
      eventCounts.set(event.sessionId, (eventCounts.get(event.sessionId) ?? 0) + 1);
    }
    return list.map((s) => ({
      ...s,
      duration: (s.endTime ?? Date.now()) - s.startTime,
      eventCount: eventCounts.get(s.sessionId) ?? 0,
      isRunning: s.status === 'running',
    }));
  }, [sessions, events]);

  if (sessions.size <= 1) return null;

  return (
    <select
      value={filter.sessionId ?? ''}
      onChange={(e) => {
        const sessionId = e.target.value || undefined;
        useAgentStore.getState().setFilter({ ...filter, sessionId });
      }}
      className={`flex-1 min-w-0 bg-gray-900 border border-gray-700 rounded px-1.5 py-0.5 text-[10px] focus:outline-none focus:border-blue-500 appearance-none truncate ${
        filter.sessionId ? 'text-cyan-400' : 'text-gray-400'
      }`}
    >
      <option value="">All sessions ({sessions.size})</option>
      {sessionList.map((s) => (
        <option key={s.sessionId} value={s.sessionId}>
          {s.isRunning ? '\u25CF ' : '\u25CB '}
          {formatRelativeTime(s.startTime)} \u00B7 {formatDuration(s.duration)} \u00B7{' '}
          {s.eventCount} events
        </option>
      ))}
    </select>
  );
}
