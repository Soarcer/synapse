# Mobile-Responsive Dashboard Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a `?view=mobile` view mode to the Synapse dashboard with bottom tab navigation, touch-optimized graph, mobile lens views, and a bottom sheet detail panel.

**Architecture:** New view mode alongside existing `full`/`lens`/`graph`/`analytics`/`pixel`. Auto-detects phone browsers via `pointer: coarse` media query. All new components in `apps/dashboard/src/components/mobile/`. Reuses the existing Zustand store, WebSocket client, lens computation layer, and node types — only the shell and interaction model change.

**Tech Stack:** React 19, @xyflow/react v12, Zustand 5, Tailwind CSS 4

**Design doc:** `docs/plans/2026-02-20-mobile-responsive-design.md`

---

### Task 1: Viewport Meta + App.tsx Plumbing

Wire up the `mobile` view mode so `?view=mobile` renders a placeholder shell. This is the foundation.

**Files:**
- Modify: `apps/dashboard/index.html:5`
- Modify: `apps/dashboard/src/App.tsx:16, 18-23, 40, 70, 98, 114, 136, before 248`
- Create: `apps/dashboard/src/components/mobile/MobileView.tsx`

**Step 1: Update viewport meta tag**

In `apps/dashboard/index.html`, change line 5:

```html
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
```

**Step 2: Add `'mobile'` view mode to App.tsx**

a) Update the type (line 16):
```typescript
type ViewMode = 'full' | 'lens' | 'graph' | 'analytics' | 'pixel' | 'mobile';
```

b) Replace `getViewMode()` (lines 18-23):
```typescript
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
```

c) Add `'mobile'` to the WS connect condition (line 40):
```typescript
if (viewMode !== 'full' && viewMode !== 'pixel' && viewMode !== 'mobile') return;
```

d) Exclude mobile from VS Code postMessage listener (line 70):
```typescript
if (viewMode === 'full' || viewMode === 'mobile') return;
```

e) Exclude mobile from VS Code selection broadcast (line 98):
```typescript
if (viewMode === 'full' || viewMode === 'mobile') return;
```

f) Exclude mobile from VS Code keyboard forwarding (line 114):
```typescript
if (viewMode === 'full' || viewMode === 'mobile') return;
```

g) Skip ALL keyboard shortcuts for mobile. At the top of `handleKey` (after line 137):
```typescript
if (viewMode === 'mobile') return;
```

h) Add lazy import at top (after line 8):
```typescript
const MobileView = lazy(() => import('./components/mobile/MobileView'));
```

i) Add mobile render branch before the `FullView` fallback (before line 248):
```typescript
  // ── Mobile view (phone browser) ──────────────────────────────
  if (viewMode === 'mobile') {
    return (
      <div className="h-screen w-screen flex flex-col bg-[#0d1117] text-gray-200 overflow-hidden">
        <ErrorBoundary name="MobileView">
          <Suspense fallback={<div className="flex-1 flex items-center justify-center text-gray-500 text-sm">Loading mobile view...</div>}>
            <MobileView />
          </Suspense>
        </ErrorBoundary>
        <ToastContainer />
      </div>
    );
  }
```

**Step 3: Create placeholder MobileView**

Create `apps/dashboard/src/components/mobile/MobileView.tsx`:
```typescript
export default function MobileView() {
  return (
    <div className="flex-1 flex items-center justify-center text-gray-500 text-sm">
      Mobile view placeholder
    </div>
  );
}
```

**Step 4: Verify**

Run `pnpm --filter @synapse-ai/dashboard build` — should compile without errors. Open `http://localhost:4000?view=mobile` — should show placeholder. Desktop view at `http://localhost:4000` unchanged.

**Step 5: Commit**

```bash
git add apps/dashboard/index.html apps/dashboard/src/App.tsx apps/dashboard/src/components/mobile/MobileView.tsx
git commit -m "feat(mobile): add ?view=mobile view mode with auto-detection"
```

---

### Task 2: MobileTabBar + MobileStatusBar

Build the fixed bottom tab bar and compact top status bar.

**Files:**
- Create: `apps/dashboard/src/components/mobile/MobileTabBar.tsx`
- Create: `apps/dashboard/src/components/mobile/MobileStatusBar.tsx`
- Modify: `apps/dashboard/src/components/mobile/MobileView.tsx`

**Step 1: Create MobileTabBar**

Create `apps/dashboard/src/components/mobile/MobileTabBar.tsx`:
```typescript
import { useAgentStore } from '../../store/agentStore';

export type MobileTab = 'graph' | 'lenses' | 'pixel';

interface MobileTabBarProps {
  activeTab: MobileTab;
  onTabChange: (tab: MobileTab) => void;
}

const TABS: Array<{ id: MobileTab; label: string; icon: string }> = [
  { id: 'graph', label: 'Graph', icon: '⬡' },
  { id: 'lenses', label: 'Lenses', icon: '◑' },
  { id: 'pixel', label: 'Pixel', icon: '▦' },
];

export function MobileTabBar({ activeTab, onTabChange }: MobileTabBarProps) {
  const connectionStatus = useAgentStore((s) => s.connectionStatus);
  const agents = useAgentStore((s) => s.agents);

  const runningCount = [...agents.values()].filter((a) => a.status === 'running').length;

  return (
    <nav
      className="flex-shrink-0 bg-[#161b22] border-t border-gray-800 flex"
      style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
    >
      {TABS.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onTabChange(tab.id)}
          className={`flex-1 flex flex-col items-center justify-center py-2 text-xs transition-colors ${
            activeTab === tab.id ? 'text-blue-400' : 'text-gray-500'
          }`}
        >
          <span className="text-lg relative">
            {tab.icon}
            {tab.id === 'graph' && (
              <span
                className={`absolute -top-0.5 -right-1.5 w-2 h-2 rounded-full ${
                  connectionStatus === 'connected' ? 'bg-green-500' : 'bg-red-500'
                }`}
              />
            )}
            {tab.id === 'lenses' && runningCount > 0 && (
              <span className="absolute -top-1 -right-2 bg-blue-600 text-white text-[9px] rounded-full w-3.5 h-3.5 flex items-center justify-center font-bold">
                {runningCount > 9 ? '9+' : runningCount}
              </span>
            )}
          </span>
          <span className="mt-0.5">{tab.label}</span>
        </button>
      ))}
    </nav>
  );
}
```

**Step 2: Create MobileStatusBar**

Create `apps/dashboard/src/components/mobile/MobileStatusBar.tsx`:
```typescript
import { useState } from 'react';
import { useAgentStore } from '../../store/agentStore';

export function MobileStatusBar() {
  const connectionStatus = useAgentStore((s) => s.connectionStatus);
  const agents = useAgentStore((s) => s.agents);
  const sessions = useAgentStore((s) => s.sessions);
  const [expanded, setExpanded] = useState(false);

  const runningCount = [...agents.values()].filter((a) => a.status === 'running').length;
  const totalAgents = agents.size;

  const totalTokens = [...agents.values()].reduce(
    (sum, a) => sum + a.tokenUsage.input + a.tokenUsage.output,
    0,
  );

  const statusColor =
    connectionStatus === 'connected' ? 'bg-green-500' :
    connectionStatus === 'reconnecting' ? 'bg-yellow-500 animate-pulse' :
    'bg-red-500';

  const statusLabel =
    connectionStatus === 'connected' ? 'Connected' :
    connectionStatus === 'reconnecting' ? 'Reconnecting...' :
    connectionStatus === 'failed' ? 'Failed' : 'Disconnected';

  return (
    <div className="flex-shrink-0 bg-[#161b22] border-b border-gray-800">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full px-3 py-2 flex items-center gap-3 text-xs text-gray-400"
      >
        <span className={`w-2 h-2 rounded-full flex-shrink-0 ${statusColor}`} />
        <span>{statusLabel}</span>
        <span className="text-gray-600">|</span>
        <span>{runningCount > 0 ? `${runningCount} running` : `${totalAgents} agents`}</span>
        {totalTokens > 0 && (
          <>
            <span className="text-gray-600">|</span>
            <span>{(totalTokens / 1000).toFixed(1)}k tok</span>
          </>
        )}
        <span className="ml-auto text-gray-600">{expanded ? '▲' : '▼'}</span>
      </button>

      {expanded && (
        <div className="px-3 pb-2 text-xs text-gray-500 space-y-1 border-t border-gray-800/50 pt-1.5">
          <div>Sessions: {sessions.size}</div>
          <div>Total agents: {totalAgents} ({runningCount} running)</div>
          <div>Tokens: {totalTokens.toLocaleString()}</div>
          <a
            href={`${window.location.pathname}?view=full`}
            className="text-blue-400 hover:underline inline-block mt-1"
          >
            Switch to desktop view →
          </a>
        </div>
      )}
    </div>
  );
}
```

**Step 3: Wire into MobileView**

Update `apps/dashboard/src/components/mobile/MobileView.tsx`:
```typescript
import { useState } from 'react';
import { MobileStatusBar } from './MobileStatusBar';
import { MobileTabBar, type MobileTab } from './MobileTabBar';

export default function MobileView() {
  const [activeTab, setActiveTab] = useState<MobileTab>('graph');

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <MobileStatusBar />

      <div className="flex-1 overflow-hidden flex flex-col">
        {activeTab === 'graph' && (
          <div className="flex-1 flex items-center justify-center text-gray-500 text-sm">
            Graph placeholder
          </div>
        )}
        {activeTab === 'lenses' && (
          <div className="flex-1 flex items-center justify-center text-gray-500 text-sm">
            Lenses placeholder
          </div>
        )}
        {activeTab === 'pixel' && (
          <div className="flex-1 flex items-center justify-center text-gray-500 text-sm">
            Pixel placeholder
          </div>
        )}
      </div>

      <MobileTabBar activeTab={activeTab} onTabChange={setActiveTab} />
    </div>
  );
}
```

**Step 4: Verify**

Build and open `?view=mobile`. Status bar at top, tab bar at bottom, switching tabs changes placeholder text.

**Step 5: Commit**

```bash
git add apps/dashboard/src/components/mobile/
git commit -m "feat(mobile): add tab bar and status bar shell"
```

---

### Task 3: MobileBottomSheet

Build the drag-to-resize bottom sheet for node details.

**Files:**
- Create: `apps/dashboard/src/components/mobile/MobileBottomSheet.tsx`
- Modify: `apps/dashboard/src/components/mobile/MobileView.tsx`

**Step 1: Create MobileBottomSheet**

Create `apps/dashboard/src/components/mobile/MobileBottomSheet.tsx`:
```typescript
import { useRef, useEffect, useCallback, useState } from 'react';
import { useAgentStore } from '../../store/agentStore';
import { AgentDetailPanel } from '../panels/AgentDetailPanel';
import { ErrorBoundary } from '../ErrorBoundary';

type SnapPoint = 'closed' | 'peek' | 'full';

const SNAP_FRACTIONS: Record<SnapPoint, number> = {
  closed: 0,
  peek: 0.4,
  full: 0.9,
};

export function MobileBottomSheet() {
  const selectedNodeId = useAgentStore((s) => s.selectedNodeId);
  const selectNode = useAgentStore((s) => s.selectNode);
  const [snap, setSnap] = useState<SnapPoint>('closed');
  const sheetRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    startY: number;
    startTranslate: number;
    rafId: number | null;
    currentY: number;
  } | null>(null);

  const isOpen = snap !== 'closed';

  // Open to peek when a node is selected
  useEffect(() => {
    if (selectedNodeId && selectedNodeId !== '__spawn__') {
      setSnap('peek');
    } else {
      setSnap('closed');
    }
  }, [selectedNodeId]);

  const getSheetHeight = useCallback(() => window.innerHeight, []);

  const getTranslateForSnap = useCallback(
    (s: SnapPoint) => {
      const h = getSheetHeight();
      return h * (1 - SNAP_FRACTIONS[s]);
    },
    [getSheetHeight],
  );

  const snapToNearest = useCallback(
    (currentTranslateY: number) => {
      const h = getSheetHeight();
      const fraction = 1 - currentTranslateY / h;
      let closest: SnapPoint = 'closed';
      let minDist = Infinity;
      for (const [sp, frac] of Object.entries(SNAP_FRACTIONS) as Array<[SnapPoint, number]>) {
        const dist = Math.abs(fraction - frac);
        if (dist < minDist) {
          minDist = dist;
          closest = sp;
        }
      }
      setSnap(closest);
      if (closest === 'closed') {
        selectNode(null);
      }
    },
    [getSheetHeight, selectNode],
  );

  const onTouchStart = useCallback(
    (e: React.TouchEvent) => {
      const touch = e.touches[0];
      const currentTranslate = getTranslateForSnap(snap);
      dragRef.current = {
        startY: touch.clientY,
        startTranslate: currentTranslate,
        rafId: null,
        currentY: currentTranslate,
      };
      if (sheetRef.current) {
        sheetRef.current.style.transition = 'none';
      }
    },
    [snap, getTranslateForSnap],
  );

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    if (!dragRef.current || !sheetRef.current) return;
    const touch = e.touches[0];
    const delta = touch.clientY - dragRef.current.startY;
    const newY = Math.max(0, dragRef.current.startTranslate + delta);
    dragRef.current.currentY = newY;

    if (dragRef.current.rafId === null) {
      dragRef.current.rafId = requestAnimationFrame(() => {
        if (sheetRef.current && dragRef.current) {
          sheetRef.current.style.transform = `translateY(${dragRef.current.currentY}px)`;
        }
        if (dragRef.current) dragRef.current.rafId = null;
      });
    }
  }, []);

  const onTouchEnd = useCallback(() => {
    if (!dragRef.current) return;
    if (dragRef.current.rafId !== null) {
      cancelAnimationFrame(dragRef.current.rafId);
    }
    if (sheetRef.current) {
      sheetRef.current.style.transition = '';
    }
    snapToNearest(dragRef.current.currentY);
    dragRef.current = null;
  }, [snapToNearest]);

  // Recalculate on orientation change
  useEffect(() => {
    const handler = () => {
      if (sheetRef.current && snap !== 'closed') {
        sheetRef.current.style.transform = `translateY(${getTranslateForSnap(snap)}px)`;
      }
    };
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, [snap, getTranslateForSnap]);

  if (!isOpen) return null;

  const translateY = getTranslateForSnap(snap);

  return (
    <>
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/20 z-40"
        onClick={() => selectNode(null)}
      />

      {/* Sheet */}
      <div
        ref={sheetRef}
        className="absolute inset-x-0 bottom-0 z-50 bg-[#161b22] rounded-t-2xl flex flex-col transition-transform duration-300 ease-out"
        style={{
          height: '100%',
          transform: `translateY(${translateY}px)`,
        }}
      >
        {/* Drag handle */}
        <div
          className="flex-shrink-0 flex justify-center py-3 cursor-grab active:cursor-grabbing"
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
        >
          <div className="w-10 h-1 bg-gray-600 rounded-full" />
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-1">
          <ErrorBoundary name="AgentDetailPanel">
            <AgentDetailPanel />
          </ErrorBoundary>
        </div>
      </div>
    </>
  );
}
```

**Step 2: Add to MobileView**

In `MobileView.tsx`, add import and render the bottom sheet. Add `relative` to the outer div:
```typescript
import { MobileBottomSheet } from './MobileBottomSheet';
```
Add `<MobileBottomSheet />` before `<MobileTabBar>`, and add `relative` class to the outer container div.

**Step 3: Verify**

Open `?view=mobile`. Simulate selection via console: `useAgentStore.getState().selectNode('agent-test')`. Sheet slides up. Drag handle resizes. Tap backdrop dismisses.

**Step 4: Commit**

```bash
git add apps/dashboard/src/components/mobile/
git commit -m "feat(mobile): add drag-to-resize bottom sheet for node details"
```

---

### Task 4: MobileGraphView

Build the touch-optimized React Flow graph.

**Files:**
- Create: `apps/dashboard/src/components/mobile/MobileGraphView.tsx`
- Create: `apps/dashboard/src/components/mobile/MobileSearchButton.tsx`
- Modify: `apps/dashboard/src/components/mobile/MobileView.tsx`

**Step 1: Create MobileSearchButton**

Create `apps/dashboard/src/components/mobile/MobileSearchButton.tsx`:
```typescript
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
        ✕
      </button>
    </div>
  );
}
```

**Step 2: Create MobileGraphView**

Create `apps/dashboard/src/components/mobile/MobileGraphView.tsx`:
```typescript
import { useCallback, useEffect, useMemo, useRef } from 'react';
import {
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useAgentStore } from '../../store/agentStore';
import { useAutoLayout } from '../../hooks/useAutoLayout';
import { nodeTypes, edgeTypes } from '../graph/nodeTypes';
import { MobileSearchButton } from './MobileSearchButton';

function MobileEmptyState() {
  const connectionStatus = useAgentStore((s) => s.connectionStatus);
  return (
    <div className="flex-1 flex flex-col items-center justify-center text-gray-500 text-sm gap-2 p-8 text-center">
      <div className="text-2xl mb-2">⬡</div>
      <div>Waiting for Claude Code activity...</div>
      <div className="text-xs text-gray-600">
        {connectionStatus === 'connected'
          ? 'Connected — nodes will appear when a session starts'
          : 'Not connected to server'}
      </div>
    </div>
  );
}

function MobileGraphInner() {
  const rawNodes = useAgentStore((s) => s.nodes);
  const rawEdges = useAgentStore((s) => s.edges);
  const selectNode = useAgentStore((s) => s.selectNode);
  const { fitView } = useReactFlow();

  const layoutNodes = useAutoLayout(rawNodes, rawEdges);

  // Filter out spawn node on mobile
  const visibleNodes = useMemo(
    () => layoutNodes.filter((n) => n.id !== '__spawn__'),
    [layoutNodes],
  );

  const onNodeClick = useCallback(
    (_: React.MouseEvent, node: { id: string }) => {
      selectNode(node.id, 'graph');
    },
    [selectNode],
  );

  // Fit view on first render with measured nodes
  const initialFitDone = useRef(false);
  useEffect(() => {
    if (!initialFitDone.current && visibleNodes.length > 1) {
      const hasMeasured = visibleNodes.some((n) => n.measured?.width);
      if (hasMeasured) {
        initialFitDone.current = true;
        setTimeout(() => fitView({ padding: 0.3, duration: 300 }), 50);
      }
    }
  }, [visibleNodes, fitView]);

  if (visibleNodes.length === 0) {
    return <MobileEmptyState />;
  }

  return (
    <div className="flex-1 relative" style={{ touchAction: 'none' }}>
      <ReactFlow
        nodes={visibleNodes}
        edges={rawEdges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodeClick={onNodeClick}
        panOnDrag
        zoomOnPinch
        zoomOnScroll={false}
        zoomOnDoubleClick
        selectNodesOnDrag={false}
        minZoom={0.15}
        maxZoom={2}
        fitView
        fitViewOptions={{ padding: 0.3 }}
        nodesDraggable={false}
        nodesConnectable={false}
        edgesReconnectable={false}
        elementsSelectable
        proOptions={{ hideAttribution: true }}
      />
      <MobileSearchButton />
    </div>
  );
}

export function MobileGraphView() {
  return (
    <ReactFlowProvider>
      <MobileGraphInner />
    </ReactFlowProvider>
  );
}
```

**Step 3: Wire into MobileView**

Replace graph placeholder in `MobileView.tsx` with lazy-loaded `MobileGraphView`:
```typescript
import { useState, lazy, Suspense } from 'react';
// ...existing imports...

const MobileGraphView = lazy(() =>
  import('./MobileGraphView').then((m) => ({ default: m.MobileGraphView })),
);
```
And in the render:
```typescript
{activeTab === 'graph' && (
  <Suspense fallback={<div className="flex-1 flex items-center justify-center text-gray-500 text-sm">Loading graph...</div>}>
    <MobileGraphView />
  </Suspense>
)}
```

**Step 4: Verify**

1. Run `npx tsx scripts/simulate_session.ts` to create test data
2. Open `?view=mobile` — graph renders with nodes
3. Verify: single-finger pan, pinch-to-zoom (Chrome DevTools mobile emulation), tap node opens bottom sheet
4. Verify: no MiniMap, no Controls, no Background
5. Verify: search button works

**Step 5: Commit**

```bash
git add apps/dashboard/src/components/mobile/
git commit -m "feat(mobile): add touch-optimized React Flow graph view"
```

---

### Task 5: MobileLensView

Build the lens tab with dropdown selector and full-width lens content.

**Files:**
- Create: `apps/dashboard/src/components/mobile/MobileLensView.tsx`
- Modify: `apps/dashboard/src/components/lens/LensContext.tsx:110-143`
- Modify: `apps/dashboard/src/components/lens/LensAdapter.tsx:315, 403-441`
- Modify: `apps/dashboard/src/components/lens/LensPanel.tsx:18-57`
- Modify: `apps/dashboard/src/components/mobile/MobileView.tsx`

**Step 1: Add `mobile` to LensContextValue**

In `apps/dashboard/src/components/lens/LensContext.tsx`, add to the `LensContextValue` interface (after line 142, before the closing `}`):
```typescript
  mobile: boolean;
```

**Step 2: Add `mobile` prop to LensAdapter**

In `apps/dashboard/src/components/lens/LensAdapter.tsx`:

a) Change function signature (line 315):
```typescript
export function LensAdapter({ fillWidth, mobile }: { fillWidth?: boolean; mobile?: boolean } = {}) {
```

b) Add `mobile` to context value (inside `contextValue` useMemo, after `onSpawnClick`):
```typescript
      mobile: mobile ?? false,
```

c) Add `mobile` to the deps array of the `contextValue` useMemo.

**Step 3: Update LensPanel for mobile mode**

Replace `apps/dashboard/src/components/lens/LensPanel.tsx`:
```typescript
import { useLens } from './LensContext';
import { LensTabBar } from './LensTabBar';
import { LensBreadcrumb } from './LensBreadcrumb';
import { LensResizeHandle } from './LensResizeHandle';
import { TreeView } from './tree/TreeView';
import { HeatmapView } from './heatmap/HeatmapView';
import { TreemapView } from './treemap/TreemapView';
import { SankeyView } from './sankey/SankeyView';
import { CompactionView } from './compaction/CompactionView';
import { CostWaterfallView } from './cost/CostWaterfallView';
import type { LensTab } from './LensContext';

const LENS_OPTIONS: Array<{ value: LensTab; label: string }> = [
  { value: 'treemap', label: 'Treemap' },
  { value: 'heatmap', label: 'Heatmap' },
  { value: 'compaction', label: 'Compaction' },
  { value: 'cost', label: 'Cost Waterfall' },
  { value: 'sankey', label: 'Sankey' },
  { value: 'tree', label: 'Tree' },
];

interface LensPanelProps {
  width?: number;
  onWidthChange?: (w: number) => void;
  fillWidth?: boolean;
}

export function LensPanel({ width, onWidthChange, fillWidth }: LensPanelProps) {
  const { activeTab, onTabChange, searchQuery, onSearchChange, mobile } = useLens();

  return (
    <aside
      className={`bg-[#161b22] ${mobile ? '' : 'border-r border-gray-800'} flex flex-col relative overflow-hidden ${fillWidth ? 'flex-1' : 'flex-shrink-0'}`}
      style={fillWidth ? undefined : { width }}
    >
      {!fillWidth && onWidthChange && (
        <LensResizeHandle width={width ?? 320} onWidthChange={onWidthChange} />
      )}

      {/* Mobile: dropdown selector. Desktop: tab bar */}
      {mobile ? (
        <div className="px-3 py-2 border-b border-gray-800 flex-shrink-0 flex gap-2">
          <select
            value={activeTab}
            onChange={(e) => onTabChange(e.target.value as LensTab)}
            className="flex-1 bg-gray-900 border border-gray-700 rounded-lg px-2 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-blue-500 appearance-none"
          >
            {LENS_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
          {activeTab === 'tree' && (
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="Filter..."
              className="flex-1 bg-gray-900 border border-gray-700 rounded-lg px-2 py-1.5 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-blue-500"
            />
          )}
        </div>
      ) : (
        <>
          <LensTabBar />
          {activeTab === 'tree' && (
            <div className="px-2 py-1.5 border-b border-gray-800 flex-shrink-0">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => onSearchChange(e.target.value)}
                placeholder="Filter..."
                className="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1 text-xs text-gray-200 placeholder-gray-600 focus:outline-none focus:border-blue-500"
              />
            </div>
          )}
        </>
      )}

      <div className="flex-1 overflow-hidden">
        {activeTab === 'tree' && <TreeView />}
        {activeTab === 'heatmap' && <HeatmapView />}
        {activeTab === 'treemap' && <TreemapView />}
        {activeTab === 'sankey' && <SankeyView />}
        {activeTab === 'compaction' && <CompactionView />}
        {activeTab === 'cost' && <CostWaterfallView />}
      </div>

      {!mobile && <LensBreadcrumb />}
    </aside>
  );
}
```

**Step 4: Create MobileLensView**

Create `apps/dashboard/src/components/mobile/MobileLensView.tsx`:
```typescript
import { LensAdapter } from '../lens/LensAdapter';

export function MobileLensView() {
  return (
    <div className="flex-1 overflow-hidden flex flex-col">
      <LensAdapter fillWidth mobile />
    </div>
  );
}
```

**Step 5: Wire into MobileView**

Replace lenses placeholder:
```typescript
import { MobileLensView } from './MobileLensView';
```
```typescript
{activeTab === 'lenses' && <MobileLensView />}
```

**Step 6: Verify**

Open `?view=mobile`, switch to Lenses tab. Dropdown with 6 lenses, full-width content. Desktop view unchanged (still uses tab bar).

**Step 7: Commit**

```bash
git add apps/dashboard/src/components/mobile/ apps/dashboard/src/components/lens/
git commit -m "feat(mobile): add lens view with dropdown selector"
```

---

### Task 6: Pixel Tab + Final MobileView Assembly

Wire up the pixel tab and finalize MobileView.

**Files:**
- Modify: `apps/dashboard/src/components/mobile/MobileView.tsx`

**Step 1: Final MobileView**

```typescript
import { useState, lazy, Suspense } from 'react';
import { MobileStatusBar } from './MobileStatusBar';
import { MobileTabBar, type MobileTab } from './MobileTabBar';
import { MobileBottomSheet } from './MobileBottomSheet';
import { MobileLensView } from './MobileLensView';

const MobileGraphView = lazy(() =>
  import('./MobileGraphView').then((m) => ({ default: m.MobileGraphView })),
);
const PixelPage = lazy(() => import('../pixel/PixelPageLazy'));

function TabFallback() {
  return (
    <div className="flex-1 flex items-center justify-center text-gray-500 text-sm">
      Loading...
    </div>
  );
}

export default function MobileView() {
  const [activeTab, setActiveTab] = useState<MobileTab>('graph');

  return (
    <div className="flex-1 flex flex-col overflow-hidden relative">
      <MobileStatusBar />

      <div className="flex-1 overflow-hidden flex flex-col">
        {activeTab === 'graph' && (
          <Suspense fallback={<TabFallback />}>
            <MobileGraphView />
          </Suspense>
        )}
        {activeTab === 'lenses' && <MobileLensView />}
        {activeTab === 'pixel' && (
          <Suspense fallback={<TabFallback />}>
            <PixelPage />
          </Suspense>
        )}
      </div>

      <MobileBottomSheet />
      <MobileTabBar activeTab={activeTab} onTabChange={setActiveTab} />
    </div>
  );
}
```

**Step 2: Verify all three tabs**

1. `pnpm dev` and `npx tsx scripts/simulate_all_nodes.ts`
2. Open `?view=mobile` — graph, lenses, pixel all work
3. Tapping node in graph → bottom sheet
4. Tab switching unmounts previous view
5. Desktop view unchanged

**Step 3: Commit**

```bash
git add apps/dashboard/src/components/mobile/MobileView.tsx
git commit -m "feat(mobile): wire up all three tabs (graph, lenses, pixel)"
```

---

### Task 7: Heatmap Mobile Touch Adaptation

Make heatmap cells large enough for touch targets.

**Files:**
- Modify: `apps/dashboard/src/components/lens/heatmap/HeatmapView.tsx:7, 29-30`

**Step 1: Make cell size responsive**

In `HeatmapView.tsx`:

a) Change the constant at line 7:
```typescript
const CELL_SIZE_DESKTOP = 18;
const CELL_SIZE_MOBILE = 32;
```

b) Inside `HeatmapView()` (around line 29-30), get mobile flag and compute cell size:
```typescript
const { treeRoots, paletteIndex, selectedId, onSelect, mobile } = useLens();
const CELL_SIZE = mobile ? CELL_SIZE_MOBILE : CELL_SIZE_DESKTOP;
```

Remove the old `const CELL_SIZE = 18;` module-level constant. All existing references to `CELL_SIZE` in the component now use the local variable.

**Step 2: Verify**

`?view=mobile` → Lenses → Heatmap: cells are 32px. Desktop: still 18px.

**Step 3: Commit**

```bash
git add apps/dashboard/src/components/lens/heatmap/HeatmapView.tsx
git commit -m "feat(mobile): enlarge heatmap cells for touch targets"
```

---

### Task 8: Treemap + Sankey Tap-to-Select

Replace hover tooltips with tap + persistent info bar on mobile.

**Files:**
- Modify: `apps/dashboard/src/components/lens/treemap/TreemapView.tsx`
- Modify: `apps/dashboard/src/components/lens/sankey/SankeyView.tsx`

**Step 1: TreemapView mobile adaptation**

In `TreemapView.tsx`, get `mobile` from `useLens()`. When `mobile`:
- Remove `onMouseEnter`/`onMouseLeave` handlers from rects
- Add `onClick`/`onTouchEnd` that sets a local `tappedNode` state
- Render a fixed info bar below the SVG showing tapped node's label, tokens, duration

**Step 2: SankeyView mobile adaptation**

Same pattern: replace hover highlight with tap highlight, persistent info bar for tapped node/link.

**Step 3: Verify**

`?view=mobile` → Treemap/Sankey: tapping shows info bar, no hover tooltips. Desktop unchanged.

**Step 4: Commit**

```bash
git add apps/dashboard/src/components/lens/treemap/ apps/dashboard/src/components/lens/sankey/
git commit -m "feat(mobile): replace hover tooltips with tap-to-select on treemap/sankey"
```

---

### Task 9: Integration Test + Polish

Final verification across the complete mobile experience.

**Step 1: Run test suite**

```bash
pnpm test
```

All existing tests should pass.

**Step 2: Build**

```bash
pnpm --filter @synapse-ai/dashboard build
```

No errors or warnings.

**Step 3: Manual testing checklist (Chrome DevTools → iPhone 14 Pro, 390×844)**

- [ ] `localhost:4000` auto-detects mobile on phone-sized screen with touch
- [ ] `?view=full` overrides to desktop
- [ ] `?view=mobile` forces mobile
- [ ] Status bar: connection dot, agent count, token count
- [ ] Status bar expands on tap, "Switch to desktop" link works
- [ ] Tab bar: 3 tabs, correct highlighting, connection dot on Graph
- [ ] Graph: nodes render, pinch-to-zoom, single-finger pan
- [ ] Graph: tap node → bottom sheet opens at peek
- [ ] Graph: search button → input → filters
- [ ] Graph: empty state when no sessions
- [ ] Lenses: dropdown shows 6 options, switching works
- [ ] Lenses: Tree, Heatmap (32px cells), Treemap, Sankey, Compaction, Cost all render
- [ ] Lenses: Treemap/Sankey tap shows info bar
- [ ] Pixel: scene renders, CSS-scales to viewport
- [ ] Bottom sheet: drag peek ↔ full, swipe down dismisses
- [ ] Bottom sheet: backdrop tap dismisses
- [ ] Bottom sheet: snap points recalculate on rotation
- [ ] Desktop: `localhost:4000` on wide browser completely unchanged

**Step 4: Commit polish fixes**

```bash
git add -A
git commit -m "fix(mobile): integration test polish"
```

---

## Summary

| Task | What | New Files | Modified Files |
|------|------|-----------|----------------|
| 1 | ViewMode plumbing | 1 | 2 |
| 2 | TabBar + StatusBar | 2 | 1 |
| 3 | BottomSheet | 1 | 1 |
| 4 | MobileGraphView + search | 2 | 1 |
| 5 | MobileLensView + dropdown | 1 | 4 |
| 6 | Pixel tab + assembly | 0 | 1 |
| 7 | Heatmap touch cells | 0 | 1 |
| 8 | Treemap/Sankey tap | 0 | 2 |
| 9 | Integration test | 0 | 0 |

**Total: 7 new files, ~6 modified files, 9 tasks**
