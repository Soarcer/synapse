// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bernhard

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ReactFlow,
  MiniMap,
  Controls,
  Background,
  BackgroundVariant,
  useReactFlow,
  ReactFlowProvider,
} from '@xyflow/react';
import type { NodeChange, Viewport } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useAgentStore, reloadAllEvents } from '../../store/agentStore';
import { useAutoLayout } from '../../hooks/useAutoLayout';
import { useVisibleGraph } from '../../hooks/useVisibleGraph';
import { useGraphNavigation } from '../../hooks/useGraphNavigation';
import { nodeTypes, edgeTypes } from './nodeTypes';
import { NotificationPulse } from '../../features/notifications/NotificationPulse'; // [notifications]
import { GraphSearchBox } from './GraphSearchBox';
import { EdgeCostLegend } from './EdgeCostLegend';
import { NudgeBadge } from './NudgeBadge';
import { registerToastNavigator, unregisterToastNavigator } from '../Toast';
import { buildParentMap, collectAncestors } from '../../utils/graphSearch';
import type { AgentNodeData } from '@synapse-ai/core';

// ── Main graph component ─────────────────────────────────────

function AgentGraphInner() {
  const rawNodes = useAgentStore((s) => s.nodes);
  const rawEdges = useAgentStore((s) => s.edges);
  const selectNode = useAgentStore((s) => s.selectNode);
  const selectedNodeId = useAgentStore((s) => s.selectedNodeId);
  const selectSource = useAgentStore((s) => s.selectSource);
  const autoClosePrompts = useAgentStore((s) => s.autoClosePrompts);
  const collapsedNodes = useAgentStore((s) => s.collapsedNodes);
  const lockViewport = useAgentStore((s) => s.lockViewport);
  const { fitView, getViewport, setViewport } = useReactFlow();
  const prevNodeCountRef = useRef(rawNodes.length);
  const prevExpandedRef = useRef<string | null>(null);
  const [toolGroupDims, setToolGroupDims] = useState<
    Map<string, { width: number; height: number }>
  >(() => new Map());

  // Register toast click→node navigator so toasts can zoom to nodes
  useEffect(() => {
    registerToastNavigator((nodeId: string) => {
      // Defer to the lens-sync effect which handles toolgroup resolution
      useAgentStore.getState().selectNode(nodeId, 'lens');
    });
    return unregisterToastNavigator;
  }, []);

  // Restore viewport if we just returned from a port-change proxy restart.
  useEffect(() => {
    const saved = sessionStorage.getItem('synapse-viewport');
    if (!saved) return;
    sessionStorage.removeItem('synapse-viewport');
    try {
      setViewport(JSON.parse(saved) as Viewport);
    } catch {
      // Corrupt data — silently ignore
    }
  }, [setViewport]);

  // Save viewport just before the Vite proxy restarts.
  // The plugin sends synapse:port-changing ~300 ms before server.restart().
  useEffect(() => {
    if (!import.meta.hot) return;
    const cleanup = import.meta.hot.on('synapse:port-changing', () => {
      sessionStorage.setItem('synapse-viewport', JSON.stringify(getViewport()));
    });
    return cleanup;
  }, [getViewport]);

  // ── Tool collapse: hide leaf tools, keep structural tools (Task→child agent) ──

  const expandedParentId = useMemo(() => {
    if (!selectedNodeId) return null;
    if (selectedNodeId.startsWith('agent-') || selectedNodeId.startsWith('prompt-')) {
      return selectedNodeId;
    }
    if (selectedNodeId.startsWith('toolgroup-')) {
      return selectedNodeId.slice('toolgroup-'.length);
    }
    if (selectedNodeId.startsWith('tool-')) {
      for (const edge of rawEdges) {
        if (edge.target === selectedNodeId) return edge.source;
      }
    }
    return null;
  }, [selectedNodeId, rawEdges]);

  // ── Visibility filtering: shared hook (also used by MobileGraphView) ──

  const { visibleNodes, visibleEdges, searchMatchCount } = useVisibleGraph({
    autoClosePrompts,
    collapsedNodes,
    toolGroupDims,
  });

  const layoutNodes = useAutoLayout(visibleNodes, visibleEdges, expandedParentId);

  // Compute highlighted node IDs: selected + direct children + all ancestors up the hierarchy.
  // Stabilized: return previous ref when contents haven't changed, preventing cascading re-renders.
  const prevConnectedRef = useRef<Set<string> | null>(null);
  const connectedIds = useMemo(() => {
    if (!selectedNodeId) {
      prevConnectedRef.current = null;
      return null;
    }
    const ids = new Set<string>([selectedNodeId]);

    const parentOf = buildParentMap(visibleEdges);

    if (selectedNodeId.startsWith('tool-')) {
      // Selected a tool inside a group (from clicking a pill) — highlight the toolGroup + ancestors
      for (const edge of rawEdges) {
        if (edge.target === selectedNodeId) {
          const toolGroupId = `toolgroup-${edge.source}`;
          ids.add(toolGroupId);
          ids.add(edge.source);
          collectAncestors(edge.source, parentOf, ids);
          break;
        }
      }
    } else {
      // Add direct children
      for (const edge of visibleEdges) {
        if (edge.source === selectedNodeId) ids.add(edge.target);
      }
      // Walk up ancestors
      collectAncestors(selectedNodeId, parentOf, ids);
    }

    // Return previous ref if contents are identical
    const prev = prevConnectedRef.current;
    if (prev && prev.size === ids.size) {
      let same = true;
      for (const id of ids) {
        if (!prev.has(id)) {
          same = false;
          break;
        }
      }
      if (same) return prev;
    }
    prevConnectedRef.current = ids;
    return ids;
  }, [selectedNodeId, visibleEdges, rawEdges]);

  // Merge connectedIds (from single selection) with multiHighlightIds (from heatmap etc.)
  // Stabilized: only create a new Set when the actual contents change (not just the ref).
  const multiHighlightIds = useAgentStore((s) => s.multiHighlightIds);
  const prevMergedRef = useRef<Set<string> | null>(null);
  const mergedHighlightIds = useMemo(() => {
    if (!connectedIds && !multiHighlightIds) {
      prevMergedRef.current = null;
      return null;
    }
    const merged = new Set<string>();
    if (connectedIds) for (const id of connectedIds) merged.add(id);
    if (multiHighlightIds) for (const id of multiHighlightIds) merged.add(id);
    // Return previous ref if contents are identical — prevents downstream re-renders
    const prev = prevMergedRef.current;
    if (prev && prev.size === merged.size) {
      let same = true;
      for (const id of merged) {
        if (!prev.has(id)) {
          same = false;
          break;
        }
      }
      if (same) return prev;
    }
    prevMergedRef.current = merged;
    return merged;
  }, [connectedIds, multiHighlightIds]);

  // Sync highlighted IDs to store so node components can access them.
  // Use getState() to avoid including the setter function in deps — store
  // action refs change on every render, which would cause this effect to
  // fire in a loop and trigger cascading re-renders across all node components.
  useEffect(() => {
    useAgentStore.getState().setHighlightedNodeIds(mergedHighlightIds);
  }, [mergedHighlightIds]);

  // Apply dim styling to non-highlighted nodes
  const nodes = useMemo(() => {
    if (!mergedHighlightIds) return layoutNodes;
    return layoutNodes.map((n) => ({
      ...n,
      style: {
        ...n.style,
        opacity: mergedHighlightIds.has(n.id) ? 1 : 0.25,
        transition: 'opacity 0.2s ease',
      },
    }));
  }, [layoutNodes, mergedHighlightIds]);

  // Cost gradient: compute cumulative tokens per node for edge coloring
  const edgeCostMap = useMemo(() => {
    if (mergedHighlightIds) return null; // Don't color edges when highlight is active

    const childrenOf = new Map<string, string[]>();
    for (const edge of visibleEdges) {
      const kids = childrenOf.get(edge.source) ?? [];
      kids.push(edge.target);
      childrenOf.set(edge.source, kids);
    }

    const hasParent = new Set(visibleEdges.map((e) => e.target));
    const nodeMap = new Map(visibleNodes.map((n) => [n.id, n]));
    const roots = visibleNodes.filter((n) => !hasParent.has(n.id) && n.id !== '__spawn__');

    const cumTokens = new Map<string, number>();
    let maxCum = 0;

    function walk(nodeId: string, parentCum: number) {
      const node = nodeMap.get(nodeId);
      let selfTokens = 0;
      if (node?.type === 'agent') {
        const a = (node.data as Record<string, unknown>).agent as AgentNodeData;
        selfTokens = a.tokenUsage.input + a.tokenUsage.output;
      }
      const cum = parentCum + selfTokens;
      cumTokens.set(nodeId, cum);
      if (cum > maxCum) maxCum = cum;
      for (const childId of childrenOf.get(nodeId) ?? []) {
        walk(childId, cum);
      }
    }

    for (const root of roots) walk(root.id, 0);
    if (maxCum === 0) return null;
    return { cumTokens, maxCum };
  }, [visibleNodes, visibleEdges, mergedHighlightIds]);

  // Use smoothstep edges for clean routing; dim non-connected edges when selected; apply cost gradient
  const styledEdges = useMemo(() => {
    // Smoothstep edges route in L-shapes: edges from the same parent share the
    // horizontal segment and only diverge vertically, creating clean overlapping paths
    let result = visibleEdges.map((e) => ({
      ...e,
      type: 'smoothstep' as const,
      pathOptions: { borderRadius: 12 },
    }));
    // Cost gradient coloring (only when no highlight active)
    if (edgeCostMap && !mergedHighlightIds) {
      result = result.map((e) => {
        const cum = edgeCostMap.cumTokens.get(e.target) ?? 0;
        const ratio = cum / edgeCostMap.maxCum;
        // HSL: 220 (blue) → 0 (red) as cost accumulates
        const hue = Math.round(220 - ratio * 220);
        const width = 1 + ratio * 2;
        return {
          ...e,
          style: {
            ...e.style,
            stroke: `hsl(${hue}, 70%, 50%)`,
            strokeWidth: width,
            transition: 'stroke 0.3s ease, stroke-width 0.3s ease',
          },
        };
      });
    }
    if (mergedHighlightIds) {
      result = result.map((e) => ({
        ...e,
        style: {
          ...e.style,
          opacity: mergedHighlightIds.has(e.source) && mergedHighlightIds.has(e.target) ? 1 : 0.1,
          transition: 'opacity 0.2s ease',
        },
      }));
    }
    return result;
  }, [visibleEdges, mergedHighlightIds, edgeCostMap]);

  // Resolve a node ID to a visible ID — if the node is a grouped tool,
  // return its parent toolgroup ID instead so fitView can find it.
  const resolveVisibleId = useCallback(
    (nodeId: string): string | null => {
      if (visibleNodes.some((n) => n.id === nodeId)) return nodeId;
      if (nodeId.startsWith('tool-')) {
        for (const edge of rawEdges) {
          if (edge.target === nodeId) {
            const tgId = `toolgroup-${edge.source}`;
            if (visibleNodes.some((n) => n.id === tgId)) return tgId;
          }
        }
      }
      return null;
    },
    [visibleNodes, rawEdges],
  );

  // Zoom to newest node when nodes are added (unless viewport is locked or a node is selected).
  // Must resolve raw node IDs to visible IDs because tool nodes are replaced
  // by synthetic toolgroup nodes — fitView on a non-existent ID causes React
  // Flow to compute empty bounds at (0,0) and zoom to the canvas origin.
  const prevNodeIdsRef = useRef<Set<string>>(new Set(rawNodes.map((n) => n.id)));
  useEffect(() => {
    if (rawNodes.length > prevNodeCountRef.current && !lockViewport && !selectedNodeId) {
      const prevIds = prevNodeIdsRef.current;
      const newNodes = rawNodes.filter((n) => !prevIds.has(n.id));
      const target = newNodes[newNodes.length - 1];
      if (target) {
        const visibleId = resolveVisibleId(target.id);
        if (visibleId) {
          setTimeout(() => fitView({ nodes: [{ id: visibleId }], duration: 300, padding: 1 }), 100);
        }
        // No visible representation (collapsed/hidden) — skip zoom
      } else {
        setTimeout(() => fitView({ padding: 0.2, duration: 300 }), 100);
      }
    }
    prevNodeCountRef.current = rawNodes.length;
    prevNodeIdsRef.current = new Set(rawNodes.map((n) => n.id));
  }, [rawNodes, fitView, lockViewport, selectedNodeId, resolveVisibleId]);

  // One-time fitView after initial measurement pass — snaps layout into correct positions
  const initialMeasureDoneRef = useRef(false);
  useEffect(() => {
    if (initialMeasureDoneRef.current) return;
    const hasMeasured = layoutNodes.some((n) => n.measured?.width);
    if (hasMeasured && layoutNodes.length > 1) {
      initialMeasureDoneRef.current = true;
      setTimeout(() => fitView({ padding: 0.2, duration: 300 }), 50);
    }
  }, [layoutNodes, fitView]);

  // Center on node when selected from lens panel
  useEffect(() => {
    if (selectSource === 'lens' && selectedNodeId) {
      const zoomTarget = resolveVisibleId(selectedNodeId);
      if (zoomTarget) {
        setTimeout(() => fitView({ nodes: [{ id: zoomTarget }], duration: 300, padding: 1 }), 50);
      }
      useAgentStore.setState({ selectSource: null });
    }
  }, [selectSource, selectedNodeId, visibleNodes, fitView, resolveVisibleId]);

  const onNodeClick = useCallback(
    (_: React.MouseEvent, node: { id: string }) => {
      selectNode(node.id, 'graph');
    },
    [selectNode],
  );

  // #1: Double-click a node → expand if collapsed, then zoom to frame it
  //     If already framed, zoom out to show node + direct children.
  const onNodeDoubleClick = useCallback(
    (_: React.MouseEvent, node: { id: string }) => {
      useAgentStore.getState().expandNode(node.id);

      const containerEl = document.querySelector('.react-flow') as HTMLElement | null;
      const layoutNode = layoutNodes.find((n) => n.id === node.id);

      const zoomInPadding = 0.2;
      const maxZoom = 2;

      if (!containerEl || !layoutNode) {
        fitView({ nodes: [{ id: node.id }], duration: 400, padding: zoomInPadding, maxZoom });
        return;
      }

      const vp = getViewport();
      const width = layoutNode.width ?? 200;
      const height = layoutNode.height ?? 100;
      const nodeX =
        (layoutNode as unknown as { positionAbsolute?: { x: number } }).positionAbsolute?.x ??
        layoutNode.position.x;
      const nodeY =
        (layoutNode as unknown as { positionAbsolute?: { y: number } }).positionAbsolute?.y ??
        layoutNode.position.y;

      const targetZoom = Math.min(
        containerEl.clientWidth / (width * (1 + zoomInPadding * 2)),
        containerEl.clientHeight / (height * (1 + zoomInPadding * 2)),
      );
      const clampedTargetZoom = Math.min(maxZoom, Math.max(0.1, targetZoom));

      const viewLeft = -vp.x / vp.zoom;
      const viewTop = -vp.y / vp.zoom;
      const viewRight = (containerEl.clientWidth - vp.x) / vp.zoom;
      const viewBottom = (containerEl.clientHeight - vp.y) / vp.zoom;

      const margin = 20 / vp.zoom;
      const isWithinView =
        nodeX >= viewLeft + margin &&
        nodeY >= viewTop + margin &&
        nodeX + width <= viewRight - margin &&
        nodeY + height <= viewBottom - margin;

      const zoomClose = Math.abs(vp.zoom - clampedTargetZoom) <= clampedTargetZoom * 0.1;
      const isFramed = isWithinView && zoomClose;

      if (isFramed) {
        const childIds = visibleEdges.filter((e) => e.source === node.id).map((e) => e.target);

        if (childIds.length > 0) {
          fitView({
            nodes: [node.id, ...childIds].map((id) => ({ id })),
            duration: 400,
            padding: 0.3,
          });
          return;
        }
      }

      fitView({ nodes: [{ id: node.id }], duration: 400, padding: zoomInPadding, maxZoom });
    },
    [fitView, getViewport, layoutNodes, visibleEdges],
  );

  // #2 + #4: Auto-pan when tools expand or detail panel overlaps selected node
  useEffect(() => {
    const expansionHappened = expandedParentId !== prevExpandedRef.current;
    prevExpandedRef.current = expandedParentId;

    if (!selectedNodeId || selectSource !== 'graph') return;

    const timer = setTimeout(() => {
      const clickedToolGroup = selectedNodeId.startsWith('toolgroup-');
      if (clickedToolGroup) {
        // Zoom directly to the toolgroup container the user clicked
        fitView({ nodes: [{ id: selectedNodeId }], duration: 400, padding: 0.3 });
      } else if (expansionHappened && expandedParentId) {
        // Frame parent + its toolGroup child (or structural tool children)
        const nodeIds = [expandedParentId];
        for (const edge of visibleEdges) {
          if (
            edge.source === expandedParentId &&
            (edge.target.startsWith('tool-') || edge.target.startsWith('toolgroup-'))
          ) {
            nodeIds.push(edge.target);
          }
        }
        fitView({ nodes: nodeIds.map((id) => ({ id })), duration: 400, padding: 0.3 });
      } else {
        // Check if selected node is hidden behind the detail panel
        const vp = getViewport();
        const node = layoutNodes.find((n) => n.id === selectedNodeId);
        if (!node) return;

        const containerEl = document.querySelector('.react-flow') as HTMLElement | null;
        if (!containerEl) return;
        const containerWidth = containerEl.clientWidth;

        const nodeWidth = node.width ?? 200;
        const nodeRightScreen = (node.position.x + nodeWidth) * vp.zoom + vp.x;

        if (nodeRightScreen > containerWidth - 40) {
          const shift = nodeRightScreen - containerWidth + 100;
          setViewport({ x: vp.x - shift, y: vp.y, zoom: vp.zoom }, { duration: 300 });
        }
      }
    }, 200);

    return () => clearTimeout(timer);
  }, [
    selectedNodeId,
    selectSource,
    expandedParentId,
    visibleEdges,
    layoutNodes,
    fitView,
    getViewport,
    setViewport,
  ]);

  // ── Arrow-key graph navigation ──────────────────────────────
  useGraphNavigation(visibleNodes, visibleEdges, selectNode, fitView);

  const onPaneClick = useCallback(() => {
    selectNode(null);
  }, [selectNode]);

  const showHookEvents = useAgentStore((s) => s.showHookEvents);
  const events = useAgentStore((s) => s.events);
  const isLoading = useAgentStore((s) => s.isLoading);
  const loadError = useAgentStore((s) => s.loadError);

  const updateNodeDimensions = useAgentStore((s) => s.updateNodeDimensions);
  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      const dimUpdates: Array<{ id: string; width: number; height: number }> = [];
      const tgUpdates: Array<{ id: string; width: number; height: number }> = [];
      for (const c of changes) {
        if (c.type === 'dimensions' && c.dimensions?.width && c.dimensions?.height) {
          if (c.id.startsWith('toolgroup-')) {
            tgUpdates.push({ id: c.id, width: c.dimensions.width, height: c.dimensions.height });
            continue;
          }
          dimUpdates.push({ id: c.id, width: c.dimensions.width, height: c.dimensions.height });
        }
      }
      if (dimUpdates.length > 0) updateNodeDimensions(dimUpdates);
      if (tgUpdates.length > 0) {
        setToolGroupDims((prev) => {
          let changed = false;
          for (const { id, width, height } of tgUpdates) {
            const existing = prev.get(id);
            if (!existing || existing.width !== width || existing.height !== height) {
              changed = true;
              break;
            }
          }
          if (!changed) return prev; // same ref → no re-render
          const next = new Map(prev);
          for (const { id, width, height } of tgUpdates) next.set(id, { width, height });
          return next;
        });
      }
    },
    [updateNodeDimensions],
  );
  const onEdgesChange = useCallback(() => {}, []);

  // Show hint when graph has only the spawn node
  const hasContentNodes = nodes.length > 1;

  return (
    <>
      <GraphSearchBox matchCount={searchMatchCount} />
      {isLoading && nodes.length <= 1 && (
        <div className="absolute inset-0 flex items-center justify-center z-10">
          <div className="text-gray-500 text-sm flex items-center gap-2">
            <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
                fill="none"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
              />
            </svg>
            Loading events...
          </div>
        </div>
      )}
      {loadError && (
        <div className="absolute inset-0 flex items-center justify-center z-10">
          <div className="bg-gray-900 rounded-lg p-6 border border-red-900/30 text-center max-w-sm">
            <p className="text-red-400 text-sm mb-2">Failed to connect to server</p>
            <p className="text-gray-500 text-xs mb-4">{loadError}</p>
            <button
              onClick={() => reloadAllEvents({ showLoading: true })}
              className="px-4 py-2 text-xs bg-gray-800 hover:bg-gray-700 text-gray-300 rounded border border-gray-700"
            >
              Retry
            </button>
          </div>
        </div>
      )}
      {!hasContentNodes && !isLoading && !loadError && events.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center z-10 pointer-events-none">
          <div className="pointer-events-auto bg-gray-900/90 rounded-lg p-8 border border-gray-800 text-center max-w-sm backdrop-blur-sm">
            <div className="text-3xl mb-3 text-gray-600">&#x2B22;</div>
            <h3 className="text-sm font-medium text-gray-300 mb-2">No active sessions</h3>
            <p className="text-xs text-gray-500">
              Start a Claude Code session in this project, or run a simulation script to see the
              graph in action.
            </p>
          </div>
        </div>
      )}
      {!hasContentNodes && events.length > 0 && !showHookEvents && (
        <div className="absolute top-14 left-1/2 -translate-x-1/2 z-10 px-4 py-2 bg-amber-900/70 border border-amber-600/40 rounded-lg text-xs text-amber-200 backdrop-blur-sm text-center">
          Hook events are hidden — press{' '}
          <kbd className="px-1.5 py-0.5 bg-amber-800/60 rounded text-amber-100 font-mono mx-0.5">
            H
          </kbd>{' '}
          to show them
        </div>
      )}
      <ReactFlow
        nodes={nodes}
        edges={styledEdges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodeClick={onNodeClick}
        onNodeDoubleClick={onNodeDoubleClick}
        onPaneClick={onPaneClick}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        defaultEdgeOptions={{ zIndex: 0 }}
        nodesDraggable={false}
        edgesFocusable={false}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        minZoom={0.1}
        maxZoom={2}
        proOptions={{ hideAttribution: true }}
        className="bg-transparent"
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#1e293b" />
        <MiniMap
          position="bottom-right"
          pannable
          zoomable
          style={{ background: '#0d1117', border: '1px solid #1e293b' }}
          maskColor="rgba(13, 17, 23, 0.7)"
          maskStrokeColor="rgba(96, 165, 250, 0.5)"
          maskStrokeWidth={2}
          nodeColor={(node) => {
            switch (node.type) {
              case 'session':
                return '#3b82f6';
              case 'userPrompt':
                return '#f59e0b';
              case 'agent':
                return '#22c55e';
              case 'toolCall':
                return '#a855f7';
              case 'toolGroup':
                return '#a855f7';
              default:
                return '#6b7280';
            }
          }}
        />
        <Controls
          position="bottom-left"
          style={{ background: '#161b22', border: '1px solid #30363d', borderRadius: '8px' }}
        />
      </ReactFlow>
      <EdgeCostLegend />
      <NudgeBadge />
      <NotificationPulse /> {/* [notifications] */}
    </>
  );
}

export function AgentGraph() {
  return (
    <ReactFlowProvider>
      <AgentGraphInner />
    </ReactFlowProvider>
  );
}

export default AgentGraph;
