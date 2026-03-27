// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bernhard

import { useEffect, useRef, useMemo, lazy, Suspense } from 'react';
import { Header } from './components/layout/Header';
import { GraphLayout } from './components/layout/GraphLayout';
import { LensAdapter } from './components/lens/LensAdapter';
import { useBreakpoint } from './hooks/useBreakpoint';
import { useUrlSync } from './hooks/useUrlSync';
import { Features } from '@synapse-ai/core';

const AnalyticsPage = lazy(() => import('./components/analytics/AnalyticsPageLazy'));
const MobileView = lazy(() => import('./components/mobile/MobileView'));
import { ToastContainer, toast } from './components/Toast';
import { PermissionStack } from './components/permissions/PermissionStack';
import { usePermissionStore, createAdaptiveSync } from './store/permissionStore';
import { WorkshopModal } from './components/WorkshopModal';
import { ErrorBoundary } from './components/ErrorBoundary';
import {
  useAgentStore,
  reloadAllEvents,
  SLIDING_REFRESH_MS,
  slidingRefreshTick,
} from './store/agentStore';
import { wsClient } from './store/wsClient';
import { initNotifications, useNotificationStore } from './features/notifications'; // [notifications]
import { initTour, TourOverlay, TourLauncher } from './features/tour'; // [tour]

initNotifications(); // [notifications]
initTour(); // [tour]

/** Layout modes: full (browser), lens (VS Code sidebar), graph (VS Code editor), analytics, mobile */
type ViewMode = 'full' | 'lens' | 'graph' | 'analytics' | 'mobile';

function getViewMode(): ViewMode {
  const params = new URLSearchParams(window.location.search);
  const view = params.get('view');
  if (view === 'mobile' || view === 'lens' || view === 'graph' || view === 'analytics') return view;

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

// ── Easter egg: Konami Code ─────────────────────────────────
const KONAMI = [
  'ArrowUp',
  'ArrowUp',
  'ArrowDown',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'ArrowLeft',
  'ArrowRight',
  'b',
  'a',
];
// ── Easter egg: DOOM god-mode ───────────────────────────────
const IDDQD = ['i', 'd', 'd', 'q', 'd'];

function activateArcadeEasterEgg(label: string) {
  const store = useAgentStore.getState();
  if (store.arcadeMode) return; // already active
  store.setArcadeUnlocked(true);
  store.setArcadeMode(true);
  store.setShowAllTools(true);
  // Pick a random game mode
  const modes = ['bubbles', 'tetris', 'snake', 'breakout'];
  store.setToolGroupMode(modes[Math.floor(Math.random() * modes.length)]);
  toast(`${label} — Arcade mode unlocked!`, 'info');
}

export default function App() {
  const viewMode = useMemo(getViewMode, []);
  useUrlSync();
  const konamiIdx = useRef(0);
  const iddqdIdx = useRef(0);
  // Connect WebSocket and load existing events on mount
  // In VS Code mode (lens/graph), events arrive via postMessage from the extension — skip direct WS/fetch
  useEffect(() => {
    if (viewMode !== 'full' && viewMode !== 'mobile') return; // VS Code relay handles data delivery

    wsClient.connect();
    reloadAllEvents({ showLoading: true });

    // Adaptive sync: poll every 5s when permission cards are visible, 30s otherwise.
    // Primary auto-dismiss is server-side (resolveIfSessionAdvanced + connection monitor),
    // so this poll only catches edge cases (e.g. WS drops, server restart).
    const adaptiveSync = createAdaptiveSync();
    adaptiveSync.start();

    // Subscribe to pending count changes — switches between 5s/30s intervals.
    let prevCount = usePermissionStore.getState().pending.length;
    const unsub = usePermissionStore.subscribe((s) => {
      const count = s.pending.length;
      if (count !== prevCount) {
        prevCount = count;
        adaptiveSync.notifyPendingChange(count);
      }
    });

    // Sliding time window refresh (was module-level setInterval — now with cleanup)
    const slidingTimer = setInterval(slidingRefreshTick, SLIDING_REFRESH_MS);

    return () => {
      wsClient.disconnect();
      adaptiveSync.stop();
      unsub();
      clearInterval(slidingTimer);
    };
  }, [viewMode]);

  // Listen for messages from VS Code extension (cross-panel sync + event relay)
  useEffect(() => {
    if (viewMode === 'full' || viewMode === 'mobile') return;

    const handleMessage = (e: MessageEvent) => {
      const msg = e.data;
      if (!msg || typeof msg !== 'object') return;

      if (msg.type === 'selectNode') {
        useAgentStore.getState().selectNode(msg.nodeId ?? null, msg.source ?? null);
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
    let prevSource = useAgentStore.getState().selectSource;
    const unsub = useAgentStore.subscribe((state) => {
      if (state.selectedNodeId !== prev || state.selectSource !== prevSource) {
        prev = state.selectedNodeId;
        prevSource = state.selectSource;
        // VS Code webview requires '*' (cross-origin iframe); this effect only runs for non-full modes
        window.parent.postMessage(
          { type: 'selectionChanged', nodeId: prev, source: state.selectSource },
          '*',
        );
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
        window.parent.postMessage(
          {
            type: 'forwardKeydown',
            key: e.key,
            code: e.code,
            ctrlKey: e.ctrlKey,
            shiftKey: e.shiftKey,
            altKey: e.altKey,
            metaKey: e.metaKey,
          },
          '*',
        );
        return;
      }

      // Forward function keys (F1–F12) to VS Code
      if (e.key.startsWith('F') && e.key.length <= 3 && !isNaN(Number(e.key.slice(1)))) {
        e.preventDefault();
        e.stopPropagation();
        window.parent.postMessage(
          {
            type: 'forwardKeydown',
            key: e.key,
            code: e.code,
            ctrlKey: false,
            shiftKey: e.shiftKey,
            altKey: false,
            metaKey: false,
          },
          '*',
        );
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

      // Number keys switch lens tabs (all modes) — heatmap excluded when feature is off
      if (!e.ctrlKey && !e.metaKey && !e.altKey) {
        const tabKeys = [
          'treemap',
          ...(Features.lensHeatmap ? ['heatmap'] : []),
          'compaction',
          'cost',
          'sankey',
          'tree',
          'alerts', // [notifications]
        ];
        const tabIdx = parseInt(e.key, 10) - 1;
        if (tabIdx >= 0 && tabIdx < tabKeys.length) {
          useAgentStore.getState().setActiveLensTab(tabKeys[tabIdx]);
        }
      }

      // ── Easter egg sequences (work in all modes) ──
      // Konami code: ↑↑↓↓←→←→BA
      if (e.key === KONAMI[konamiIdx.current]) {
        konamiIdx.current++;
        if (konamiIdx.current === KONAMI.length) {
          konamiIdx.current = 0;
          activateArcadeEasterEgg('KONAMI CODE');
        }
      } else {
        konamiIdx.current = e.key === KONAMI[0] ? 1 : 0;
      }
      // IDDQD (DOOM god mode)
      if (e.key === IDDQD[iddqdIdx.current]) {
        iddqdIdx.current++;
        if (iddqdIdx.current === IDDQD.length) {
          iddqdIdx.current = 0;
          activateArcadeEasterEgg('IDDQD');
        }
      } else {
        iddqdIdx.current = e.key === IDDQD[0] ? 1 : 0;
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
      if (Features.spawnAgent && e.key === 'n' && !e.ctrlKey && !e.metaKey) {
        useAgentStore.getState().setShowSpawnDialog(true);
      }
      if (Features.promptLab && e.key === 'w' && !e.ctrlKey && !e.metaKey) {
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
      if (e.key === 'l' && !e.ctrlKey && !e.metaKey) {
        const store = useAgentStore.getState();
        store.setLensVisible(!store.lensVisible);
      }
      if (e.key === 'a' && !e.ctrlKey && !e.metaKey) {
        // [notifications]
        const s = useNotificationStore.getState();
        s.setEnabled(!s.enabled);
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
      if (Features.costDisplayMode && e.key === '$') {
        useAgentStore.getState().toggleCostDisplayMode();
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only: viewMode is stable (set once from URL)
  }, []);

  // ── Analytics view ──────────────────────────────────────────
  if (viewMode === 'analytics') {
    return (
      <div className="h-screen w-screen flex flex-col bg-syn-bg-primary text-gray-200 overflow-hidden">
        <ErrorBoundary name="AnalyticsPage">
          <Suspense
            fallback={
              <div className="flex-1 flex items-center justify-center text-gray-500 text-sm">
                Loading analytics...
              </div>
            }
          >
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
      <div className="h-screen w-screen flex flex-col bg-syn-bg-primary text-gray-200 overflow-hidden">
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
      <div className="h-screen w-screen flex flex-col bg-syn-bg-primary text-gray-200 overflow-hidden">
        <ErrorBoundary name="Header">
          <Header />
        </ErrorBoundary>

        <GraphLayout />
        {Features.promptLab && <WorkshopModal />}
        <ToastContainer />
      </div>
    );
  }

  // ── Mobile view (phone browser) ─────────────────────────────
  if (viewMode === 'mobile') {
    return (
      <div
        className="h-screen w-screen flex flex-col bg-syn-bg-primary text-gray-200 overflow-hidden"
        style={{ height: '100dvh', overscrollBehavior: 'none', touchAction: 'manipulation' }}
      >
        <ErrorBoundary name="MobileView">
          <Suspense
            fallback={
              <div className="flex-1 flex items-center justify-center text-gray-500 text-sm">
                Loading mobile view...
              </div>
            }
          >
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
  const lensVisible = useAgentStore((s) => s.lensVisible);
  const showLens = bp !== 'sm' && lensVisible;

  return (
    <div className="h-screen w-screen flex flex-col bg-syn-bg-primary text-gray-200 overflow-hidden">
      <a
        href="#main-graph"
        className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:top-1 focus:left-1 focus:px-3 focus:py-1.5 focus:bg-blue-600 focus:text-white focus:rounded focus:text-sm"
      >
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
      <PermissionStack />
      <ToastContainer />
      <TourOverlay /> {/* [tour] */}
      <TourLauncher /> {/* [tour] */}
    </div>
  );
}
