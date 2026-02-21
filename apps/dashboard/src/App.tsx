// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Synapse Contributors

import { useEffect, useMemo, lazy, Suspense } from 'react';
import { Header } from './components/layout/Header';
import { GraphLayout } from './components/layout/GraphLayout';
import { LensAdapter } from './components/lens/LensAdapter';
import { useBreakpoint } from './hooks/useBreakpoint';

const AnalyticsPage = lazy(() => import('./components/analytics/AnalyticsPageLazy'));
const PixelPage = lazy(() => import('./components/pixel/PixelPageLazy'));
const MobileView = lazy(() => import('./components/mobile/MobileView'));
import { ToastContainer } from './components/Toast';
import { WorkshopModal } from './components/WorkshopModal';
import { ErrorBoundary } from './components/ErrorBoundary';
import { useAgentStore, reloadAllEvents } from './store/agentStore';
import { wsClient } from './store/wsClient';

/** Layout modes: full (browser), lens (VS Code sidebar), graph (VS Code editor), analytics, pixel, mobile */
type ViewMode = 'full' | 'lens' | 'graph' | 'analytics' | 'pixel' | 'mobile';

function getViewMode(): ViewMode {
  const params = new URLSearchParams(window.location.search);
  const view = params.get('view');
  if (view === 'mobile' || view === 'lens' || view === 'graph' || view === 'analytics' || view === 'pixel') return view;

  // Auto-detect phone browsers (any orientation, excludes tablets/touch laptops)
  const isCoarsePointer = window.matchMedia('(pointer: coarse)').matches;
  const isSmallScreen = window.matchMedia('(max-width: 1024px)').matches;
  if (isCoarsePointer && isSmallScreen && navigator.maxTouchPoints > 0) return 'mobile';

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
    if (viewMode !== 'full' && viewMode !== 'pixel' && viewMode !== 'mobile') return; // VS Code relay handles data delivery

    wsClient.connect();
    reloadAllEvents({ showLoading: true });

    return () => {
      wsClient.disconnect();
    };
  }, [viewMode]);

  // Listen for messages from VS Code extension (cross-panel sync + event relay)
  useEffect(() => {
    if (viewMode === 'full' || viewMode === 'mobile') return;

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
        useAgentStore.getState().setConnectionStatus('connected');
      }
      // Extension sends bulk hydration on connect / iframe ready
      if (msg.type === 'hydrateEvents' && Array.isArray(msg.events)) {
        useAgentStore.getState().loadEvents(msg.events);
        useAgentStore.getState().setLoading(false);
        useAgentStore.getState().setConnectionStatus('connected');
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [viewMode]);

  // Broadcast selection changes back to VS Code extension host
  useEffect(() => {
    if (viewMode === 'full' || viewMode === 'mobile') return;

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

  // Forward keyboard events to VS Code when running inside an iframe.
  // Cross-origin iframes trap keyboard events; we relay them via postMessage so
  // VS Code can handle shortcuts like Ctrl+Shift+P, Ctrl+P, etc.
  // Synthetic KeyboardEvents don't work (isTrusted: false), so the webview HTML
  // relays these messages to the extension host which calls executeCommand().
  useEffect(() => {
    if (viewMode === 'full' || viewMode === 'mobile') return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (isEditableTarget(e)) return;

      // Forward all modifier combos (Ctrl/Cmd + key) to VS Code
      if (e.ctrlKey || e.metaKey || e.altKey) {
        e.preventDefault();
        e.stopPropagation();
        window.parent.postMessage({
          type: 'forwardKeydown',
          key: e.key,
          code: e.code,
          ctrlKey: e.ctrlKey,
          shiftKey: e.shiftKey,
          altKey: e.altKey,
          metaKey: e.metaKey,
        }, '*');
        return;
      }

      // Forward function keys (F1–F12) to VS Code
      if (e.key.startsWith('F') && e.key.length <= 3 && !isNaN(Number(e.key.slice(1)))) {
        e.preventDefault();
        e.stopPropagation();
        window.parent.postMessage({
          type: 'forwardKeydown',
          key: e.key,
          code: e.code,
          ctrlKey: false, shiftKey: e.shiftKey,
          altKey: false, metaKey: false,
        }, '*');
        return;
      }
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [viewMode]);

  // Keyboard shortcuts — full browser mode only.
  // In VS Code mode (lens/graph), only Escape and number-key lens tabs are active;
  // all other shortcuts are disabled to avoid swallowing VS Code hotkeys.
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (isEditableTarget(e)) return;
      if (viewMode === 'mobile') return; // No keyboard shortcuts on mobile

      // ── Shortcuts available in ALL modes ──

      if (e.key === 'Escape') {
        useAgentStore.getState().selectNode(null);
        useAgentStore.getState().setShowSpawnDialog(false);
        useAgentStore.getState().setShowWorkshop(false);
      }

      // Number keys switch lens tabs (all modes)
      if (!e.ctrlKey && !e.metaKey && !e.altKey) {
        const tabKeys = ['treemap', 'heatmap', 'compaction', 'cost', 'sankey', 'tree', 'alerts']; // [notifications]
        const tabIdx = parseInt(e.key, 10) - 1;
        if (tabIdx >= 0 && tabIdx < tabKeys.length) {
          useAgentStore.getState().setActiveLensTab(tabKeys[tabIdx]);
        }
      }

      // ── Shortcuts for full browser mode only ──

      if (viewMode !== 'full') return;

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
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, []);

  // ── Pixel office view ──────────────────────────────────────────
  if (viewMode === 'pixel') {
    return (
      <ErrorBoundary name="PixelScene">
        <Suspense fallback={<div className="h-screen w-screen bg-[#08080f] flex items-center justify-center text-gray-500 text-sm">Loading pixel office...</div>}>
          <PixelPage />
        </Suspense>
      </ErrorBoundary>
    );
  }

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

  // ── Mobile view (phone browser) ─────────────────────────────
  if (viewMode === 'mobile') {
    return (
      <div className="h-screen w-screen flex flex-col bg-[#0d1117] text-gray-200 overflow-hidden" style={{ height: '100dvh', overscrollBehavior: 'none', touchAction: 'manipulation' }}>
        <ErrorBoundary name="MobileView">
          <Suspense fallback={<div className="flex-1 flex items-center justify-center text-gray-500 text-sm">Loading mobile view...</div>}>
            <MobileView />
          </Suspense>
        </ErrorBoundary>
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
