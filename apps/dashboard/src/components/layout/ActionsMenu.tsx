// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bernhard

import { useState, useRef, useEffect } from 'react';
import { Tooltip } from '../ui/Tooltip';

interface ActionsMenuProps {
  onExport: () => void;
  onImportClick: () => void;
  onClear: () => void;
}

export function ActionsMenu({ onExport, onImportClick, onClear }: ActionsMenuProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handle = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <Tooltip content="Actions menu">
        <button
          onClick={() => setOpen(!open)}
          className="flex items-center justify-center w-7 h-7 text-gray-400 hover:text-gray-200 bg-gray-800 hover:bg-gray-700 rounded transition-colors"
          aria-label="More actions"
          aria-expanded={open}
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24">
            <circle cx="12" cy="5" r="1.5" fill="currentColor" />
            <circle cx="12" cy="12" r="1.5" fill="currentColor" />
            <circle cx="12" cy="19" r="1.5" fill="currentColor" />
          </svg>
        </button>
      </Tooltip>

      {open && (
        <div className="absolute right-0 top-full mt-1 w-48 bg-[#1c2128] border border-gray-700 rounded-lg shadow-xl z-30 py-1">
          <button
            id="snapshot-export-btn"
            onClick={() => {
              onExport();
              setOpen(false);
            }}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-green-400 hover:bg-gray-800/80 transition-colors text-left"
          >
            <span className="flex-1">Export Snapshot</span>
            <kbd className="text-[10px] text-gray-600 bg-gray-800 px-1 rounded">E</kbd>
          </button>
          <button
            onClick={() => {
              onImportClick();
              setOpen(false);
            }}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-blue-400 hover:bg-gray-800/80 transition-colors text-left"
          >
            <span className="flex-1">Import Snapshot</span>
            <kbd className="text-[10px] text-gray-600 bg-gray-800 px-1 rounded">I</kbd>
          </button>
          <div className="border-t border-gray-700 my-1" />
          <button
            onClick={() => {
              onClear();
              setOpen(false);
            }}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-red-400 hover:bg-gray-800/80 transition-colors text-left"
          >
            Clear All
          </button>
        </div>
      )}
    </div>
  );
}
