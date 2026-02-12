import { useEffect, useState, useMemo, lazy, Suspense } from 'react';
import { Header } from './components/layout/Header';
import { LensAdapter } from './components/lens/LensAdapter';
import { AgentDetailPanel } from './components/panels/AgentDetailPanel';

const AgentGraph = lazy(() => import('./components/graph/AgentGraph'));
import { ToolLogPanel } from './components/panels/ToolLogPanel';
import { SpawnAgentDialog } from './components/panels/SpawnAgentDialog';
import { TimelinePanel } from './components/panels/TimelinePanel';
import { ToastContainer } from './components/Toast';
import { ErrorBoundary } from './components/ErrorBoundary';
import { useAgentStore } from './store/agentStore';
import { wsClient } from './store/wsClient';
import { apiUrl } from './utils/api';

/** Layout modes: full (browser), lens (VS Code sidebar), graph (VS Code editor) */
type ViewMode = 'full' | 'lens' | 'graph';

function getViewMode(): ViewMode {
  const params = new URLSearchParams(window.location.search);
  const view = params.get('view');
  if (view === 'lens' || view === 'graph') return view;
  return 'full';
}

function isEditableTarget(event: KeyboardEvent) {
  return (
    event.target instanceof HTMLInputElement ||
    event.target instanceof HTMLTextAreaElement ||
    (event.target instanceof HTMLElement && event.target.isContentEditable)
  );
}

function GraphLoadingPlaceholder() {
  return (
    <div className="flex-1 flex items-center justify-center bg-[#0d1117] text-gray-500 text-sm">
      Loading graph...
    </div>
  );
}

export default function App() {
  const viewMode = useMemo(getViewMode, []);
  const selectedNodeId = useAgentStore((s) => s.selectedNodeId);
  const loadEvents = useAgentStore((s) => s.loadEvents);
  const paused = useAgentStore((s) => s.paused);
  const [showToolLog, setShowToolLog] = useState(false);

  // Connect WebSocket and load existing events on mount
  // In VS Code mode (lens/graph), events arrive via postMessage from the extension — skip direct WS/fetch
  useEffect(() => {
    if (viewMode !== 'full') return; // VS Code relay handles data delivery

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
  }, [loadEvents, viewMode]);

  // Listen for messages from VS Code extension (cross-panel sync + event relay)
  useEffect(() => {
    if (viewMode === 'full') return;

    const handleMessage = (e: MessageEvent) => {
      const msg = e.data;
      if (!msg || typeof msg !== 'object') return;

      if (msg.type === 'selectNode') {
        useAgentStore.getState().selectNode(msg.nodeId ?? null);
      }
      if (msg.type === 'switchLens' && msg.lens) {
        useAgentStore.getState().setActiveLensTab(msg.lens);
      }
      // Extension relays real-time events from its single WS connection
      if (msg.type === 'synapseEvent' && msg.data) {
        useAgentStore.getState().addEvent(msg.data);
      }
      // Extension sends bulk hydration on connect / iframe ready
      if (msg.type === 'hydrateEvents' && Array.isArray(msg.events)) {
        useAgentStore.getState().loadEvents(msg.events);
        useAgentStore.getState().setLoading(false);
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [viewMode]);

  // Broadcast selection changes back to VS Code extension host
  useEffect(() => {
    if (viewMode === 'full') return;

    let prev = useAgentStore.getState().selectedNodeId;
    const unsub = useAgentStore.subscribe((state) => {
      if (state.selectedNodeId !== prev) {
        prev = state.selectedNodeId;
        window.parent.postMessage({ type: 'selectionChanged', nodeId: prev }, '*');
      }
    });
    return unsub;
  }, [viewMode]);

  // Forward modifier keyboard shortcuts to VS Code when running inside an iframe.
  // The cross-origin iframe traps keyboard events; we re-post them so VS Code can handle them.
  useEffect(() => {
    if (viewMode === 'full') return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Forward Ctrl/Cmd combos (command palette, extensions panel, etc.)
      if (e.ctrlKey || e.metaKey) {
        window.parent.postMessage({
          type: 'forwardKeydown',
          key: e.key,
          code: e.code,
          ctrlKey: e.ctrlKey,
          shiftKey: e.shiftKey,
          altKey: e.altKey,
          metaKey: e.metaKey,
        }, '*');
      }
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [viewMode]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (isEditableTarget(e)) return;

      if (e.key === 'Escape') {
        useAgentStore.getState().selectNode(null);
        useAgentStore.getState().setShowSpawnDialog(false);
      }
      if (e.key === 't' && !e.ctrlKey && !e.metaKey) {
        setShowToolLog((prev) => !prev);
      }
      if (e.key === ' ') {
        e.preventDefault();
        const store = useAgentStore.getState();
        store.setPaused(!store.paused);
      }
      if (e.key === 'n' && !e.ctrlKey && !e.metaKey) {
        useAgentStore.getState().setShowSpawnDialog(true);
      }
      if (e.key === 'l' && !e.ctrlKey && !e.metaKey) {
        const store = useAgentStore.getState();
        store.setLayoutMode(store.layoutMode === 'graph' ? 'list' : 'graph');
      }
      if (e.key === 'v' && !e.ctrlKey && !e.metaKey) {
        const store = useAgentStore.getState();
        store.setLockViewport(!store.lockViewport);
      }
      if (e.key === 'f' && !e.ctrlKey && !e.metaKey) {
        const store = useAgentStore.getState();
        store.setShowAllTools(!store.showAllTools);
      }
      if (e.key === 'h' && !e.ctrlKey && !e.metaKey) {
        const store = useAgentStore.getState();
        store.setShowHookEvents(!store.showHookEvents);
      }
      if (e.key === 'c' && !e.ctrlKey && !e.metaKey) {
        const store = useAgentStore.getState();
        store.setAutoClosePrompts(!store.autoClosePrompts);
      }
      if (e.key === 'e' && !e.ctrlKey && !e.metaKey) {
        (document.getElementById('snapshot-export-btn') as HTMLButtonElement)?.click();
      }
      if (e.key === 'i' && !e.ctrlKey && !e.metaKey) {
        (document.getElementById('snapshot-import-input') as HTMLInputElement)?.click();
      }
      if (e.key === '/') {
        e.preventDefault();
        document.getElementById('graph-search-input')?.focus();
      }
      const tabKeys = ['tree', 'heatmap', 'treemap', 'sankey', 'compaction', 'cost'];
      const tabIdx = parseInt(e.key, 10) - 1;
      if (tabIdx >= 0 && tabIdx < tabKeys.length) {
        useAgentStore.getState().setActiveLensTab(tabKeys[tabIdx]);
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, []);

  // ── Lens-only view (VS Code sidebar) ────────────────────────
  if (viewMode === 'lens') {
    return (
      <div className="h-screen w-screen flex flex-col bg-[#0d1117] text-gray-200 overflow-hidden">
        <ErrorBoundary name="LensAdapter">
          <div className="flex-1 overflow-hidden flex">
            <LensAdapter fillWidth />
          </div>
        </ErrorBoundary>
        <ToastContainer />
      </div>
    );
  }

  // ── Graph-only view (VS Code editor panel) ──────────────────
  if (viewMode === 'graph') {
    return (
      <div className="h-screen w-screen flex flex-col bg-[#0d1117] text-gray-200 overflow-hidden">
        <ErrorBoundary name="Header">
          <Header />
        </ErrorBoundary>

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
        <ToastContainer />
      </div>
    );
  }

  // ── Full view (browser / VS Code single-panel mode) ─────────
  return (
    <div className="h-screen w-screen flex flex-col bg-[#0d1117] text-gray-200 overflow-hidden">
      <ErrorBoundary name="Header">
        <Header />
      </ErrorBoundary>

      <div className="flex flex-1 overflow-hidden">
        <ErrorBoundary name="LensAdapter">
          <LensAdapter />
        </ErrorBoundary>

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
      </div>

      <SpawnAgentDialog />
      <ToastContainer />
    </div>
  );
}
