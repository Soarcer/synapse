// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bernhard

import { useState, useEffect, useRef } from 'react';
import { apiUrl } from '../../../utils/api';

interface ProjectFilterProps {
  value: string | undefined;
  onChange: (cwd: string | undefined) => void;
}

export function ProjectFilter({ value, onChange }: ProjectFilterProps) {
  const [projects, setProjects] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(apiUrl('/api/analytics/projects'))
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled && Array.isArray(d.data)) setProjects(d.data);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  if (projects.length === 0) return null;

  const displayValue = value ? (value.split(/[/\\]/).pop() ?? value) : 'All Projects';

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className={`px-3 py-1.5 text-xs rounded-lg border transition-colors ${
          value
            ? 'bg-blue-500/10 border-blue-500/30 text-blue-400'
            : 'bg-[#161b22] border-gray-700 text-gray-400 hover:text-gray-300 hover:border-gray-600'
        }`}
      >
        {displayValue}
        <span className="ml-1.5 text-[10px]">{open ? '\u25B2' : '\u25BC'}</span>
      </button>
      {open && (
        <div className="absolute top-full left-0 mt-1 z-30 w-64 bg-[#161b22] border border-gray-700 rounded-lg shadow-xl overflow-hidden">
          <button
            onClick={() => {
              onChange(undefined);
              setOpen(false);
            }}
            className={`w-full text-left px-3 py-2 text-xs hover:bg-gray-800/50 transition-colors ${
              !value ? 'text-blue-400 bg-blue-500/5' : 'text-gray-300'
            }`}
          >
            All Projects
          </button>
          {projects.map((p) => (
            <button
              key={p}
              onClick={() => {
                onChange(p);
                setOpen(false);
              }}
              className={`w-full text-left px-3 py-2 text-xs hover:bg-gray-800/50 transition-colors truncate ${
                value === p ? 'text-blue-400 bg-blue-500/5' : 'text-gray-300'
              }`}
              title={p}
            >
              {p.split(/[/\\]/).pop() ?? p}
              <span className="block text-[10px] text-gray-600 truncate">{p}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
