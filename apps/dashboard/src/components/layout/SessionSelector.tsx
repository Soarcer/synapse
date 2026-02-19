import { useState, useRef, useEffect, useMemo } from 'react';
import { useAgentStore } from '../../store/agentStore';
import { formatRelativeTime, formatDuration } from '@synapse-ai/core';
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

  if (sessionList.length === 0) return null;

  const selectedSession = filter.sessionId
    ? sessionList.find((s) => s.sessionId === filter.sessionId)
    : null;

  const triggerLabel = selectedSession
    ? selectedSession.isRunning
      ? `Running · ${formatDuration(selectedSession.duration)}`
      : `${formatRelativeTime(selectedSession.startTime)} · ${formatDuration(selectedSession.duration)}`
    : 'All sessions';

  return (
    <div ref={ref} className="relative">
      <Tooltip content={filter.sessionId ? `Session: ${filter.sessionId.slice(0, 8)}` : 'All sessions'}>
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
          <svg className="w-3 h-3 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path d="M19 9l-7 7-7-7" />
          </svg>
        </button>
      </Tooltip>

      {open && (
        <div role="listbox" aria-label="Available sessions" className="absolute right-0 top-full mt-1 w-64 bg-[#1c2128] border border-gray-700 rounded-lg shadow-xl z-30 py-1 max-h-64 overflow-auto">
          <button
            onClick={() => { setFilter({ ...filter, sessionId: undefined }); setOpen(false); }}
            className={`w-full px-3 py-2 text-xs text-left transition-colors ${
              !filter.sessionId ? 'text-blue-300 bg-blue-900/30' : 'text-gray-300 hover:bg-gray-800/80'
            }`}
          >
            All sessions
          </button>
          <div className="border-t border-gray-700 my-1" />
          {sessionList.map((s) => (
            <button
              key={s.sessionId}
              onClick={() => { setFilter({ ...filter, sessionId: s.sessionId }); setOpen(false); }}
              className={`w-full px-3 py-2 text-left transition-colors ${
                filter.sessionId === s.sessionId ? 'bg-blue-900/30' : 'hover:bg-gray-800/80'
              }`}
            >
              <div className="flex items-center gap-1.5">
                <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${s.isRunning ? 'bg-green-400 animate-pulse' : 'bg-gray-500'}`} />
                <span className={`text-xs ${filter.sessionId === s.sessionId ? 'text-blue-300' : 'text-gray-200'}`}>
                  {s.isRunning ? 'Running' : formatRelativeTime(s.startTime)}
                </span>
                <span className="text-[10px] text-gray-500">·</span>
                <span className="text-[10px] text-gray-400">{formatDuration(s.duration)}</span>
              </div>
              <div className="flex items-center gap-2 mt-0.5 ml-3">
                <span className="text-[10px] text-gray-500">{s.eventCount} events</span>
                {s.model && <span className="text-[10px] text-gray-600">{s.model}</span>}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
