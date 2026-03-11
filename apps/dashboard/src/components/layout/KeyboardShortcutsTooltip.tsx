// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bernhard

import { useState } from 'react';

const SHORTCUTS = [
  { key: 'Space', action: 'Pause / Resume' },
  { key: 'T', action: 'Tool log' },
  { key: 'L', action: 'Toggle lens panel' },
  { key: 'V', action: 'Lock viewport' },
  { key: 'F', action: 'Show all tools' },
  { key: 'H', action: 'Hook events' },
  { key: 'C', action: 'Collapse prompts' },
  { key: 'N', action: 'Spawn agent' },
  { key: 'W', action: 'Prompt Lab' },
  { key: 'E', action: 'Export snapshot' },
  { key: 'I', action: 'Import snapshot' },
  { key: '/', action: 'Focus search' },
  { key: '1-6', action: 'Switch lens tab' },
  { key: 'Esc', action: 'Close panels' },
] as const;

export function KeyboardShortcutsTooltip() {
  const [visible, setVisible] = useState(false);

  return (
    <span
      className="relative inline-flex items-center cursor-help"
      aria-label="Keyboard shortcuts"
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
    >
      <span className="flex items-center justify-center w-5 h-5 rounded-full border border-gray-600 text-[10px] text-gray-500 hover:text-gray-300 hover:border-gray-400 transition-colors">
        ?
      </span>
      {visible && (
        <div className="absolute right-0 top-full mt-2 z-30 w-64 bg-[#1c2128] border border-gray-700 rounded-lg shadow-xl p-3 pointer-events-none">
          <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-2">
            Keyboard Shortcuts
          </div>
          <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
            {SHORTCUTS.map(({ key, action }) => (
              <div key={key} className="contents">
                <kbd className="text-[11px] text-gray-300 bg-gray-800 px-1.5 py-0.5 rounded font-mono text-right">
                  {key}
                </kbd>
                <span className="text-[11px] text-gray-400">{action}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </span>
  );
}
