import { useRef, useState, useEffect } from 'react';
import { useAgentStore } from '../../store/agentStore';

export function GraphSearchBox({ matchCount }: { matchCount: number | null }) {
  const setGraphSearchQuery = useAgentStore((s) => s.setGraphSearchQuery);
  const inputRef = useRef<HTMLInputElement>(null);
  const [localQuery, setLocalQuery] = useState('');
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    debounceRef.current = setTimeout(() => {
      setGraphSearchQuery(localQuery);
    }, 250);
    return () => clearTimeout(debounceRef.current);
  }, [localQuery, setGraphSearchQuery]);

  return (
    <div className="absolute top-3 left-3 z-10 flex items-center gap-2">
      <div className="relative">
        <input
          ref={inputRef}
          id="graph-search-input"
          value={localQuery}
          onChange={(e) => setLocalQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setLocalQuery('');
              setGraphSearchQuery('');
              inputRef.current?.blur();
            }
          }}
          placeholder="Search nodes... (/)"
          className="w-56 px-3 py-1.5 bg-gray-900/90 border border-gray-700 rounded-lg text-xs text-gray-200 placeholder-gray-500 backdrop-blur-sm focus:outline-none focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/25"
        />
        {localQuery && (
          <button
            onClick={() => {
              setLocalQuery('');
              setGraphSearchQuery('');
              inputRef.current?.focus();
            }}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300 text-xs"
          >
            ✕
          </button>
        )}
      </div>
      {matchCount !== null && (
        <span className="text-[10px] text-gray-500 tabular-nums">
          {matchCount} match{matchCount !== 1 ? 'es' : ''}
        </span>
      )}
    </div>
  );
}
