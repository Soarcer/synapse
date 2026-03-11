// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bernhard

import { useState, useRef, useEffect } from 'react';
import { useAgentStore } from '../../store/agentStore';
import { Tooltip } from '../ui/Tooltip';

function startOfDay(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function startOfWeek(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - d.getDay()); // Sunday start
  return d.getTime();
}

interface Preset {
  label: string;
  range: (() => { from: number; to: number }) | null;
}

const PRESETS: Preset[] = [
  { label: 'Last hour', range: () => ({ from: Date.now() - 3_600_000, to: Date.now() }) },
  { label: 'Last 4 hours', range: () => ({ from: Date.now() - 14_400_000, to: Date.now() }) },
  { label: 'Today', range: () => ({ from: startOfDay(), to: Date.now() }) },
  { label: 'This week', range: () => ({ from: startOfWeek(), to: Date.now() }) },
  { label: 'Last 30 days', range: () => ({ from: Date.now() - 30 * 86_400_000, to: Date.now() }) },
  { label: 'All time', range: null },
];

export function TimeFilterDropdown() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const activeLabel = useAgentStore((s) => s.timePresetLabel);
  const setTimeRange = useAgentStore((s) => s.setTimeRange);

  useEffect(() => {
    if (!open) return;
    const handle = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [open]);

  const handleSelect = (preset: Preset) => {
    const range = preset.range ? preset.range() : null;
    setTimeRange(range, preset.label);
    setOpen(false);
  };

  const isFiltered = activeLabel !== 'All time';

  return (
    <div ref={ref} className="relative">
      <Tooltip content="Time range filter">
        <button
          onClick={() => setOpen(!open)}
          aria-label="Time range filter"
          className={`flex items-center gap-1.5 px-2.5 py-1 text-xs rounded transition-colors ${
            isFiltered
              ? 'text-blue-300 bg-blue-900/40 hover:bg-blue-800/40 border border-blue-700/30'
              : 'text-gray-400 hover:text-gray-200 bg-gray-800 hover:bg-gray-700'
          }`}
        >
          <svg
            className="w-3 h-3"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <circle cx="12" cy="12" r="10" />
            <path d="M12 6v6l4 2" />
          </svg>
          {activeLabel}
        </button>
      </Tooltip>

      {open && (
        <div className="absolute right-0 top-full mt-1 w-44 bg-[#1c2128] border border-gray-700 rounded-lg shadow-xl z-30 py-1">
          {PRESETS.map((preset) => (
            <button
              key={preset.label}
              onClick={() => handleSelect(preset)}
              className={`w-full px-3 py-1.5 text-xs text-left transition-colors ${
                preset.label === activeLabel
                  ? 'text-blue-300 bg-blue-900/30'
                  : 'text-gray-300 hover:bg-gray-800/80'
              }`}
            >
              {preset.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
