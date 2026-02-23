// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Synapse Contributors

import { useState, useEffect, useRef } from 'react';
import type { MockSession } from '../mockData';

interface SessionFilterProps {
  sessions: MockSession[];
  value: string[];
  onChange: (sessionIds: string[]) => void;
}

export function SessionFilter({ sessions, value, onChange }: SessionFilterProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  if (sessions.length === 0) return null;

  const filtered = search
    ? sessions.filter((s) => s.name.toLowerCase().includes(search.toLowerCase()))
    : sessions;

  const isAllSelected = value.length === 0;

  const toggle = (id: string) => {
    if (value.includes(id)) {
      onChange(value.filter((v) => v !== id));
    } else {
      onChange([...value, id]);
    }
  };

  const label = isAllSelected
    ? 'All Sessions'
    : value.length === 1
      ? (sessions.find((s) => s.id === value[0])?.name.slice(0, 20) ?? '1 session')
      : `${value.length} sessions`;

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className={`px-3 py-1.5 text-xs rounded-lg border transition-colors ${
          !isAllSelected
            ? 'bg-blue-500/10 border-blue-500/30 text-blue-400'
            : 'bg-[#161b22] border-gray-700 text-gray-400 hover:text-gray-300 hover:border-gray-600'
        }`}
      >
        {label}
        <span className="ml-1.5 text-[10px]">{open ? '\u25B2' : '\u25BC'}</span>
      </button>
      {open && (
        <div className="absolute top-full left-0 mt-1 z-30 w-72 bg-[#161b22] border border-gray-700 rounded-lg shadow-xl overflow-hidden">
          {/* Search */}
          <div className="p-2 border-b border-gray-800">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter sessions..."
              className="w-full bg-[#0d1117] border border-gray-700 rounded px-2 py-1 text-xs text-gray-300 focus:border-blue-500 focus:outline-none"
            />
          </div>

          {/* All sessions option */}
          <button
            onClick={() => {
              onChange([]);
              setOpen(false);
            }}
            className={`w-full text-left px-3 py-2 text-xs hover:bg-gray-800/50 transition-colors ${
              isAllSelected ? 'text-blue-400 bg-blue-500/5' : 'text-gray-300'
            }`}
          >
            All Sessions ({sessions.length})
          </button>

          {/* Session list */}
          <div className="max-h-48 overflow-y-auto">
            {filtered.slice(0, 20).map((s) => (
              <button
                key={s.id}
                onClick={() => toggle(s.id)}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-gray-800/50 transition-colors text-left"
              >
                <span
                  className={`w-3.5 h-3.5 rounded border flex items-center justify-center flex-shrink-0 ${
                    value.includes(s.id) ? 'bg-blue-500 border-blue-500' : 'border-gray-600'
                  }`}
                >
                  {value.includes(s.id) && <span className="text-white text-[9px]">&#x2713;</span>}
                </span>
                <span className="truncate flex-1 text-gray-300">{s.name}</span>
                <span className="text-[10px] text-gray-600 flex-shrink-0">
                  ${s.totalCost.toFixed(2)}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
