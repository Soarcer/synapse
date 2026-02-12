import { useState, useEffect, useCallback, lazy, Suspense } from 'react';
import { AgentDetailPanel } from '../panels/AgentDetailPanel';
import { ToolLogPanel } from '../panels/ToolLogPanel';
import { SpawnAgentDialog } from '../panels/SpawnAgentDialog';
import { TimelinePanel } from '../panels/TimelinePanel';
import { ErrorBoundary } from '../ErrorBoundary';
import { useAgentStore } from '../../store/agentStore';

const AgentGraph = lazy(() => import('../graph/AgentGraph'));

function GraphLoadingPlaceholder() {
  return (
    <div className="flex-1 flex items-center justify-center bg-[#0d1117] text-gray-500 text-sm">
      Loading graph...
    </div>
  );
}

/** Shared graph + panels layout used by both "graph" and "full" view modes. */
export function GraphLayout() {
  const selectedNodeId = useAgentStore((s) => s.selectedNodeId);
  const paused = useAgentStore((s) => s.paused);
  const [showToolLog, setShowToolLog] = useState(false);

  const toggleToolLog = useCallback(() => setShowToolLog((prev) => !prev), []);

  // Handle the 'T' keyboard shortcut (local to this component's state)
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        (e.target instanceof HTMLElement && e.target.isContentEditable)
      ) return;
      if (e.key === 't' && !e.ctrlKey && !e.metaKey) {
        toggleToolLog();
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [toggleToolLog]);

  return (
    <>
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="flex-1 flex overflow-hidden">
          <div className="flex-1 relative">
            <ErrorBoundary name="AgentGraph">
              <Suspense fallback={<GraphLoadingPlaceholder />}>
                <AgentGraph />
              </Suspense>
            </ErrorBoundary>

            {paused && (
              <div className="absolute top-3 left-1/2 -translate-x-1/2 z-10 px-3 py-1.5 bg-yellow-900/80 border border-yellow-600/50 rounded-lg text-xs text-yellow-200 backdrop-blur-sm">
                Paused — press Space to resume
              </div>
            )}

            <button
              onClick={() => setShowToolLog(!showToolLog)}
              className="absolute bottom-3 right-3 z-10 px-3 py-1.5 bg-gray-800/90 hover:bg-gray-700/90 border border-gray-700 rounded-lg text-xs text-gray-400 hover:text-gray-200 transition-colors backdrop-blur-sm"
              title="Toggle tool log (T)"
            >
              {showToolLog ? 'Hide' : 'Show'} Tool Log
            </button>
          </div>

          {selectedNodeId && selectedNodeId !== '__spawn__' && (
            <ErrorBoundary name="AgentDetailPanel">
              <AgentDetailPanel />
            </ErrorBoundary>
          )}
        </div>

        {showToolLog && (
          <div className="h-64 border-t border-gray-800 bg-[#161b22] flex-shrink-0">
            <ErrorBoundary name="ToolLogPanel">
              <ToolLogPanel />
            </ErrorBoundary>
          </div>
        )}

        <ErrorBoundary name="TimelinePanel">
          <TimelinePanel />
        </ErrorBoundary>
      </div>

      <SpawnAgentDialog />
    </>
  );
}
