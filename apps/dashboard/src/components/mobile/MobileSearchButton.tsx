// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Synapse Contributors

import { useState, useRef, useEffect } from 'react';
import { useAgentStore } from '../../store/agentStore';

export function MobileSearchButton() {
  const [open, setOpen] = useState(false);
  const graphSearchQuery = useAgentStore((s) => s.graphSearchQuery);
  const setGraphSearchQuery = useAgentStore((s) => s.setGraphSearchQuery);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open && inputRef.current) inputRef.current.focus();
  }, [open]);

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="absolute top-3 right-3 z-10 w-9 h-9 flex items-center justify-center bg-gray-800/90 border border-gray-700 rounded-full text-gray-400 text-sm backdrop-blur-sm"
        aria-label="Search graph"
      >
        /
      </button>
    );
  }

  return (
    <div className="absolute top-3 right-3 left-3 z-10 flex gap-2">
      <input
        ref={inputRef}
        type="text"
        value={graphSearchQuery}
        onChange={(e) => setGraphSearchQuery(e.target.value)}
        placeholder="Search nodes..."
        className="flex-1 bg-gray-800/90 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 placeholder-gray-500 backdrop-blur-sm focus:outline-none focus:border-blue-500"
      />
      <button
        onClick={() => { setGraphSearchQuery(''); setOpen(false); }}
        className="px-3 py-2 bg-gray-800/90 border border-gray-700 rounded-lg text-gray-400 text-sm backdrop-blur-sm"
      >
        &times;
      </button>
    </div>
  );
}
