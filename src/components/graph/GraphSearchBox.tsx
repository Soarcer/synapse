import { useRef } from 'react';
import { useAgentStore } from '../../store/agentStore';

export function GraphSearchBox({ matchCount }: { matchCount: number | null }) {
  const graphSearchQuery = useAgentStore((s) => s.graphSearchQuery);
  const setGraphSearchQuery = useAgentStore((s) => s.setGraphSearchQuery);
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="absolute top-3 left-3 z-10 flex items-center gap-2">
      <div className="relative">
        <input
          ref={inputRef}
          id="graph-search-input"
          value={graphSearchQuery}
          onChange={(e) => setGraphSearchQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setGraphSearchQuery('');
              inputRef.current?.blur();
            }
          }}
          placeholder="Search nodes... (/)"
          className="w-56 px-3 py-1.5 bg-gray-900/90 border border-gray-700 rounded-lg text-xs text-gray-200 placeholder-gray-500 backdrop-blur-sm focus:outline-none focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/25"
        />
        {graphSearchQuery && (
          <button
            onClick={() => {
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
