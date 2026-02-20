# Mobile-Responsive Dashboard Design

## Problem Statement

The Synapse dashboard runs on a desktop PC at `localhost:4000`. The user wants to access it from their phone on the same LAN — monitoring agent activity, viewing lens visualizations, and watching the pixel scene — without degrading the desktop experience.

## Decision Record

| Question | Decision |
|----------|----------|
| Usage mode | Hybrid — rich monitoring with selective interaction (no agent spawning) |
| Target views | Node graph (simplified), Lens views (all 6), Pixel scene. NOT analytics. |
| Navigation | Bottom tab bar (3 tabs: Graph, Lenses, Pixel) |
| Lens switching | Dropdown selector (saves vertical space) |
| Detail interaction | Bottom sheet (drag-up, snap to peek/full/closed) |
| Architecture | New `?view=mobile` view mode (Approach A) |

## Architecture

### Integration with Existing Code

The `?view=mobile` mode plugs into the existing `ViewMode` dispatch in `App.tsx`. Changes to existing files are minimal:

1. Add `'mobile'` to the `ViewMode` union type (line 16)
2. Add `view === 'mobile'` to `getViewMode()` (line 21)
3. Add `if (viewMode === 'mobile')` render branch before `FullView` (before line 248)
4. Add `'mobile'` to the WS connect condition (line 40)
5. Skip keyboard shortcuts for mobile (early return in handler at line 136)
6. Update viewport meta tag: add `viewport-fit=cover` in `index.html`

### Auto-Detection

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

Uses `pointer: coarse` media query + max-width 1024px to catch phones in landscape (852px) while excluding tablets and touch laptops. Manual override via `?view=full` link in the mobile status bar.

### Component Tree

```
MobileView                          ← new top-level shell
├── MobileStatusBar                 ← connection status, agent count, cost
├── MobileTabContent                ← renders ONLY the active tab (unmounts others)
│   ├── MobileGraphView             ← simplified React Flow wrapper
│   ├── MobileLensView              ← dropdown selector + lens content
│   └── PixelPage                   ← reuse existing (already CSS-scales)
├── MobileBottomSheet               ← drag-up detail panel
└── MobileTabBar                    ← 3 fixed tabs at bottom
```

All new components go in `apps/dashboard/src/components/mobile/`.

### Data Layer — Fully Reused

- **WebSocket**: Same `wsClient.connect()` + event fetch on mount, identical to `full` mode
- **Store**: Same `agentStore` Zustand store, same selectors
- **Lens computation**: Same `LensAdapter` / `LensContext` — mobile lens views consume the same `treeRoots` data
- **API**: `apiUrl()` derives URLs from `window.location`, works correctly when phone hits `http://<PC-IP>:4000`
- **No new API endpoints** needed

### Network Access

The server already binds to all interfaces (no host argument to `server.listen()`). Phone connects over LAN to `http://<PC-IP>:4000`. WebSocket URL derived from `window.location.host` works automatically. In dev mode, `wsClient.ts` uses `window.location.hostname:4000`.

## Component Designs

### MobileStatusBar (40px)

Compact top bar replacing the desktop `Header`:

```
┌─────────────────────────────────┐
│ 🟢 Connected  2 agents  $0.42  │
└─────────────────────────────────┘
```

- Connection status dot (from `connectionStatus` in store)
- Active agent count (agents filtered by `status === 'running'`)
- Cumulative token count
- Tap to expand: session ID, total tokens, duration
- "Switch to desktop" link sets `?view=full`

### MobileTabBar (56px)

Fixed at bottom, three equal-width tabs:

| Tab | Label | Content |
|-----|-------|---------|
| 1 | Graph | `MobileGraphView` |
| 2 | Lenses | `MobileLensView` |
| 3 | Pixel | `PixelPage` (reused) |

- Active tab state is local (not in Zustand — mobile-only UI)
- Default tab: Graph
- **Only the active tab is mounted** — inactive tabs unmount to save memory on constrained devices
- Safe area padding: `pb-[env(safe-area-inset-bottom)]`
- Status dot on Graph tab shows connection state
- Badge on Lenses tab shows active agent count

Styling: `bg-[#161b22] border-t border-gray-800`, active `text-blue-400`, inactive `text-gray-500`.

### MobileGraphView

Wraps React Flow with mobile-specific configuration. Creates its own `ReactFlowProvider` (separate from the desktop `AgentGraph`).

```typescript
<ReactFlow
  nodes={visibleNodes}
  edges={edges}
  panOnDrag={true}          // single-finger pan
  zoomOnPinch={true}        // native pinch-to-zoom
  zoomOnScroll={false}      // disable (conflicts with page scroll)
  zoomOnDoubleClick={true}  // double-tap to zoom
  selectNodesOnDrag={false}
  minZoom={0.15}
  maxZoom={2}
  fitView
  fitViewOptions={{ padding: 0.3 }}
  nodesDraggable={false}    // read-only
  nodesConnectable={false}
/>
```

- **No** MiniMap, Controls panel, or Background dots
- **No** node dragging, edge creation, or multi-select
- Touch: single-finger pan, pinch zoom, tap to select (→ bottom sheet), double-tap to zoom
- CSS: `touch-action: none` on the React Flow container (prevents browser intercepting pinch)
- Reuses existing `nodeTypes` and `edgeTypes` from `graph/nodeTypes.ts`
- Reuses `useAutoLayout` hook for Dagre positioning
- Filters out `__spawn__` node (no spawning on mobile)
- Floating search button (replaces `/` keyboard shortcut) — icon that expands to search input
- Empty state when no sessions: "Waiting for Claude Code activity..." with connection status

### MobileLensView

Dropdown selector at top + full-width lens content below:

```
┌─────────────────────────────────┐
│ [▾ Treemap            ] [🔍]   │  ← native <select> + search
├─────────────────────────────────┤
│                                 │
│     [Active Lens Content]       │  ← full width, remaining height
│     (touch-scrollable)          │
│                                 │
└─────────────────────────────────┘
```

Dropdown is a native `<select>` styled for dark theme. Six options mapped to `activeLensTab` in store.

**Per-lens mobile adaptations:**

| Lens | Adaptation |
|------|------------|
| **Tree** | Works as-is. Tap = click. Already scrollable. |
| **Heatmap** | Cell size 18px → 32px (touch target). Pinch-zoom via CSS `transform` (replaces shift+scroll). |
| **Treemap** | Tap-to-select replaces hover. Persistent info bar below SVG showing tapped node details (replaces hover tooltip). |
| **Sankey** | Tap node/link to highlight flow. Persistent info bar for tapped item (replaces hover). |
| **Compaction** | Works as-is — vertical scroll layout. |
| **Cost** | Works as-is — vertical bar list, touch-scroll friendly. |

Key: `LensAdapter` computation is shared. Mobile lens views consume the same `LensContext` data. Only rendering/interaction differs where needed. The `LensAdapter` and `LensContext` get a `mobile` boolean prop to signal touch mode to child views.

### MobileBottomSheet

Replaces the desktop `AgentDetailPanel` sidebar. Slides up from bottom on node tap.

**Snap points:**
- **Closed** (0%): Hidden below screen
- **Peek** (40%): Summary — node type, name, status, key metrics
- **Full** (90%): Complete detail content — same as `AgentDetailPanel` internals

**Behavior:**
- Tap node → sheet opens at peek
- Drag handle (top 32px with pill indicator) to resize
- Swipe down to dismiss
- Tap backdrop (20% opacity) to dismiss
- Snap to nearest point on drag end

**Implementation:**
- CSS `transform: translateY()` + `transition` for smooth animation
- Drag uses `requestAnimationFrame` batching — never `setState` per `touchmove`
- Content scrolls independently (`overflow-y: auto`)
- Recalculates snap positions on orientation change (`resize` listener)
- Tab bar remains visible beneath the sheet

**Content reuse:** Renders `AgentDetailPanel` content inside the sheet container.

## Skipped on Mobile

These desktop features are intentionally excluded from mobile:

- **Agent spawning** (N shortcut, spawn dialog) — mobile is for monitoring
- **Tool log panel** (T shortcut) — power-user debugging feature
- **History browser panel** — desktop-only panel
- **All keyboard shortcuts** — no physical keyboard
- **Snapshot export/import** (E/I) — desktop workflow
- **View settings dropdown** — tool group modes, hook visibility, etc.

## Amendments from Review

These issues were identified during design review and are incorporated above:

| Issue | Resolution |
|-------|------------|
| Phone landscape breaks auto-detection | Use `pointer: coarse` media query, not just width < 768 |
| All 3 tabs mounted wastes memory | Mount only active tab; unmount inactive ones |
| No graph search on mobile | Floating search button on graph view |
| Tool log inaccessible | Skip on mobile (monitoring focus) |
| Hover-dependent UI on Treemap/Sankey | Tap + persistent info bar replaces hover tooltips |
| Keyboard shortcuts fire on mobile | Early return in keyboard handler for mobile mode |
| Viewport meta missing `viewport-fit` | Add `viewport-fit=cover` to index.html |
| Browser intercepts pinch on React Flow | `touch-action: none` on React Flow container |
| Bottom sheet drag causes excess re-renders | rAF batching, CSS transition for snap |
| Empty state when no sessions | Mobile-specific "waiting for activity" message |
| Orientation change breaks bottom sheet | Recalculate snap points on `resize` event |

## File Impact Summary

**Modified existing files (5):**
- `apps/dashboard/src/App.tsx` — add `'mobile'` view mode, render branch, keyboard skip
- `apps/dashboard/index.html` — add `viewport-fit=cover`
- `apps/dashboard/src/components/lens/LensAdapter.tsx` — add `mobile` prop
- `apps/dashboard/src/components/lens/LensContext.tsx` — add `mobile` to context interface
- `apps/dashboard/src/components/lens/LensPanel.tsx` — mobile dropdown vs desktop tab bar
- `apps/dashboard/src/components/lens/heatmap/HeatmapView.tsx` — larger cell size when `mobile`

**New files (~8):**
- `apps/dashboard/src/components/mobile/MobileView.tsx`
- `apps/dashboard/src/components/mobile/MobileStatusBar.tsx`
- `apps/dashboard/src/components/mobile/MobileTabBar.tsx`
- `apps/dashboard/src/components/mobile/MobileGraphView.tsx`
- `apps/dashboard/src/components/mobile/MobileLensView.tsx`
- `apps/dashboard/src/components/mobile/MobileBottomSheet.tsx`
- `apps/dashboard/src/components/mobile/MobileSearchButton.tsx`
