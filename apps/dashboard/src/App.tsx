import { useEffect, useMemo, lazy, Suspense } from 'react';
import { Header } from './components/layout/Header';
import { GraphLayout } from './components/layout/GraphLayout';
import { LensAdapter } from './components/lens/LensAdapter';
import { useBreakpoint } from './hooks/useBreakpoint';

const AnalyticsPage = lazy(() => import('./components/analytics/AnalyticsPageLazy'));
import { ToastContainer } from './components/Toast';
import { WorkshopModal } from './components/WorkshopModal';
import { ErrorBoundary } from './components/ErrorBoundary';
import { useAgentStore, reloadAllEvents } from './store/agentStore';
import { wsClient } from './store/wsClient';

/** Layout modes: full (browser), lens (VS Code sidebar), graph (VS Code editor), analytics (reporting dashboard) */
type ViewMode = 'full' | 'lens' | 'graph' | 'analytics';

function getViewMode(): ViewMode {
  const params = new URLSearchParams(window.location.search);
  const view = params.get('view');
  if (view === 'lens' || view === 'graph' || view === 'analytics') return view;
  return 'full';
}

function isEditableTarget(event: KeyboardEvent) {
  return (
    event.target instanceof HTMLInputElement ||
    event.target instanceof HTMLTextAreaElement ||
    (event.target instanceof HTMLElement && event.target.isContentEditable)
  );
}

export default function App() {
  const viewMode = useMemo(getViewMode, []);
  // Connect WebSocket and load existing events on mount
  // In VS Code mode (lens/graph), events arrive via postMessage from the extension — skip direct WS/fetch
  useEffect(() => {
    if (viewMode !== 'full') return; // VS Code relay handles data delivery

    wsClient.connect();
    reloadAllEvents({ showLoading: true });

    return () => {
      wsClient.disconnect();
    };
  }, [viewMode]);

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
        // VS Code webview requires '*' (cross-origin iframe); this effect only runs for non-full modes
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
        useAgentStore.getState().setShowWorkshop(false);
      }
      if (e.key === ' ') {
        const store = useAgentStore.getState();
        // Don't toggle pause when navigating tools inside an expanded group
        if (store.selectedNodeId?.startsWith('tool-') && store.showAllTools) return;
        e.preventDefault();
        store.setPaused(!store.paused);
      }
      if (e.key === 'n' && !e.ctrlKey && !e.metaKey) {
        useAgentStore.getState().setShowSpawnDialog(true);
      }
      if (e.key === 'w' && !e.ctrlKey && !e.metaKey) {
        useAgentStore.getState().setShowWorkshop(true);
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
      // Number keys switch lens tabs only when no modifier is held
      if (!e.ctrlKey && !e.metaKey && !e.altKey) {
        const tabKeys = ['treemap', 'heatmap', 'compaction', 'cost', 'sankey', 'tree'];
        const tabIdx = parseInt(e.key, 10) - 1;
        if (tabIdx >= 0 && tabIdx < tabKeys.length) {
          useAgentStore.getState().setActiveLensTab(tabKeys[tabIdx]);
        }
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, []);

  // ── Analytics view ──────────────────────────────────────────
  if (viewMode === 'analytics') {
    return (
      <div className="h-screen w-screen flex flex-col bg-[#0d1117] text-gray-200 overflow-hidden">
        <ErrorBoundary name="AnalyticsPage">
          <Suspense fallback={<div className="flex-1 flex items-center justify-center text-gray-500 text-sm">Loading analytics...</div>}>
            <AnalyticsPage />
          </Suspense>
        </ErrorBoundary>
        <ToastContainer />
      </div>
    );
  }

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

        <GraphLayout />
        <WorkshopModal />
        <ToastContainer />
      </div>
    );
  }

  // ── Full view (browser / VS Code single-panel mode) ─────────
  return <FullView />;
}

function FullView() {
  const bp = useBreakpoint();
  const showLens = bp !== 'sm';

  return (
    <div className="h-screen w-screen flex flex-col bg-[#0d1117] text-gray-200 overflow-hidden">
      <a href="#main-graph" className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:top-1 focus:left-1 focus:px-3 focus:py-1.5 focus:bg-blue-600 focus:text-white focus:rounded focus:text-sm">
        Skip to main content
      </a>

      <ErrorBoundary name="Header">
        <Header />
      </ErrorBoundary>

      <div className="flex flex-1 overflow-hidden">
        {showLens && (
          <ErrorBoundary name="LensAdapter">
            <nav aria-label="Lens panels">
              <LensAdapter />
            </nav>
          </ErrorBoundary>
        )}

        <main id="main-graph" role="main" className="flex-1 flex flex-col min-w-0">
          <GraphLayout />
        </main>
      </div>

      <WorkshopModal />
      <ToastContainer />
    </div>
  );
}
