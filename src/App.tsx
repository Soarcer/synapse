import { useEffect, useState } from 'react';
import { Header } from './components/layout/Header';
import { LensAdapter } from './components/lens/LensAdapter';
import { AgentGraph } from './components/graph/AgentGraph';
import { AgentDetailPanel } from './components/panels/AgentDetailPanel';
import { ToolLogPanel } from './components/panels/ToolLogPanel';
import { SpawnAgentDialog } from './components/panels/SpawnAgentDialog';
import { TimelinePanel } from './components/panels/TimelinePanel';
import { ToastContainer } from './components/Toast';
import { ErrorBoundary } from './components/ErrorBoundary';
import { useAgentStore } from './store/agentStore';
import { wsClient } from './store/wsClient';
import { apiUrl } from './utils/api';

function isInputFocused() {
  const tag = document.activeElement?.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

export default function App() {
  const selectedNodeId = useAgentStore((s) => s.selectedNodeId);
  const loadEvents = useAgentStore((s) => s.loadEvents);
  const paused = useAgentStore((s) => s.paused);
  const [showToolLog, setShowToolLog] = useState(false);

  // Connect WebSocket and load existing events on mount
  useEffect(() => {
    wsClient.connect();

    const { setLoading, setLoadError } = useAgentStore.getState();
    setLoading(true);
    setLoadError(null);

    fetch(apiUrl('/api/events?limit=2000'))
      .then((r) => r.json())
      .then((data) => {
        const events = Array.isArray(data) ? data : data?.events;
        if (Array.isArray(events)) {
          loadEvents(events);
        }
        setLoading(false);
      })
      .catch((err) => {
        console.warn('[App] Server not running:', err.message);
        setLoadError(err.message || 'Failed to connect to server');
        setLoading(false);
      });

    return () => {
      wsClient.disconnect();
    };
  }, [loadEvents]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      // Escape — close panels and dialogs
      if (e.key === 'Escape') {
        useAgentStore.getState().selectNode(null);
        useAgentStore.getState().setShowSpawnDialog(false);
      }

      // Skip shortcuts when typing in inputs
      if (isInputFocused()) return;

      // T — toggle tool log
      if (e.key === 't' && !e.ctrlKey && !e.metaKey) {
        setShowToolLog((prev) => !prev);
      }

      // Space — pause/resume live updates
      if (e.key === ' ') {
        e.preventDefault();
        const store = useAgentStore.getState();
        store.setPaused(!store.paused);
      }

      // N — open spawn dialog
      if (e.key === 'n' && !e.ctrlKey && !e.metaKey) {
        useAgentStore.getState().setShowSpawnDialog(true);
      }

      // L — toggle layout mode
      if (e.key === 'l' && !e.ctrlKey && !e.metaKey) {
        const store = useAgentStore.getState();
        store.setLayoutMode(store.layoutMode === 'graph' ? 'list' : 'graph');
      }

      // V — toggle viewport lock
      if (e.key === 'v' && !e.ctrlKey && !e.metaKey) {
        const store = useAgentStore.getState();
        store.setLockViewport(!store.lockViewport);
      }

      // F — toggle show all tools
      if (e.key === 'f' && !e.ctrlKey && !e.metaKey) {
        const store = useAgentStore.getState();
        store.setShowAllTools(!store.showAllTools);
      }

      // H — toggle hook event visibility
      if (e.key === 'h' && !e.ctrlKey && !e.metaKey) {
        const store = useAgentStore.getState();
        store.setShowHookEvents(!store.showHookEvents);
      }

      // C — toggle auto-close prompts
      if (e.key === 'c' && !e.ctrlKey && !e.metaKey) {
        const store = useAgentStore.getState();
        store.setAutoClosePrompts(!store.autoClosePrompts);
      }

      // E — export snapshot
      if (e.key === 'e' && !e.ctrlKey && !e.metaKey) {
        (document.getElementById('snapshot-export-btn') as HTMLButtonElement)?.click();
      }

      // I — import snapshot
      if (e.key === 'i' && !e.ctrlKey && !e.metaKey) {
        (document.getElementById('snapshot-import-input') as HTMLInputElement)?.click();
      }

      // / — focus graph search
      if (e.key === '/') {
        e.preventDefault();
        document.getElementById('graph-search-input')?.focus();
      }

      // 1-9 — switch Lens Panel tabs
      const tabKeys = ['tree', 'profile', 'heatmap', 'treemap', 'sankey', 'compaction', 'cost'];
      const tabIdx = parseInt(e.key, 10) - 1;
      if (tabIdx >= 0 && tabIdx < tabKeys.length) {
        useAgentStore.getState().setActiveLensTab(tabKeys[tabIdx]);
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, []);

  return (
    <div className="h-screen w-screen flex flex-col bg-[#0d1117] text-gray-200 overflow-hidden">
      <ErrorBoundary name="Header">
        <Header />
      </ErrorBoundary>

      <div className="flex flex-1 overflow-hidden">
        <ErrorBoundary name="LensAdapter">
          <LensAdapter />
        </ErrorBoundary>

        {/* Main content */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Graph + Detail panel */}
          <div className="flex-1 flex overflow-hidden">
            <div className="flex-1 relative">
              <ErrorBoundary name="AgentGraph">
                <AgentGraph />
              </ErrorBoundary>

              {/* Paused indicator */}
              {paused && (
                <div className="absolute top-3 left-1/2 -translate-x-1/2 z-10 px-3 py-1.5 bg-yellow-900/80 border border-yellow-600/50 rounded-lg text-xs text-yellow-200 backdrop-blur-sm">
                  Paused — press Space to resume
                </div>
              )}

              {/* Tool log toggle */}
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

          {/* Tool log drawer */}
          {showToolLog && (
            <div className="h-64 border-t border-gray-800 bg-[#161b22] flex-shrink-0">
              <ErrorBoundary name="ToolLogPanel">
                <ToolLogPanel />
              </ErrorBoundary>
            </div>
          )}

          {/* Timeline */}
          <ErrorBoundary name="TimelinePanel">
            <TimelinePanel />
          </ErrorBoundary>
        </div>
      </div>

      {/* Spawn dialog */}
      <SpawnAgentDialog />

      {/* Toast notifications */}
      <ToastContainer />
    </div>
  );
}
