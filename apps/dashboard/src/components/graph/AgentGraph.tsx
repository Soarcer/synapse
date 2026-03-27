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
import { Features } from '@synapse-ai/core';
import { usePromptTurns, PromptTurnsContext } from '../../hooks/usePromptTurns';
import { selectSessions } from '../../store/agentStore';

// ── MiniMap ───────────────────────────────────────────────────
const MINIMAP_THRESHOLD = 300;

// Module-level callback — uses no closure state, avoids re-creation on render
function miniMapNodeColor(node: { type?: string }): string {
  switch (node.type) {
    case 'session':
      return '#3b82f6';
    case 'userPrompt':
      return '#f59e0b';
    case 'agent':
      return '#22c55e';
    case 'toolCall':
    case 'toolGroup':
      return '#a855f7';
    default:
      return '#6b7280';
  }
}

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
  const pendingFitView = useAgentStore((s) => s.pendingFitView);
  const sessions = useAgentStore(selectSessions);
  const { fitView, getViewport, setViewport, getNodes } = useReactFlow();

  // Prompt-turn groups from transcripts (shared via context to all prompt nodes)
  const sessionIds = useMemo(() => [...sessions.keys()], [sessions]);
  const promptTurnGroups = usePromptTurns(sessionIds);
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

  // Shared cancellation — prevents competing fitView calls from racing.
  // Any new scheduleFitView call cancels any pending one, ensuring only the
  // latest fitView executes.
  const pendingFitRef = useRef<{ raf1: number; raf2?: number } | null>(null);
  const cancelPendingFit = useCallback(() => {
    if (pendingFitRef.current) {
      cancelAnimationFrame(pendingFitRef.current.raf1);
      if (pendingFitRef.current.raf2 != null) cancelAnimationFrame(pendingFitRef.current.raf2);
      pendingFitRef.current = null;
    }
  }, []);
  const scheduleFitView = useCallback(
    (opts: Parameters<typeof fitView>[0]) => {
      cancelPendingFit();
      const pending: { raf1: number; raf2?: number } = { raf1: 0 };
      pending.raf1 = requestAnimationFrame(() => {
        pending.raf2 = requestAnimationFrame(() => {
          pendingFitRef.current = null;
          fitView(opts);
        });
      });
      pendingFitRef.current = pending;
    },
    [fitView, cancelPendingFit],
  );

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

    // Add direct children — skip chained prompt→prompt edges
    for (const edge of visibleEdges) {
      if (edge.source === selectedNodeId) {
        if (edge.target.startsWith('prompt-')) continue; // don't highlight next prompt in chain
        ids.add(edge.target);
      }
    }

    // For individual tool pills, also add the toolGroup
    if (selectedNodeId.startsWith('tool-')) {
      for (const edge of rawEdges) {
        if (edge.target === selectedNodeId) {
          ids.add(`toolgroup-${edge.source}`);
          ids.add(edge.source);
          break;
        }
      }
    }

    // Walk up ancestors — but only for non-prompt nodes.
    // Prompts highlight only themselves + direct children (agents/toolgroups).
    // Agents/tools walk up to their parent prompt only, then stop.
    if (!selectedNodeId.startsWith('prompt-')) {
      let current = selectedNodeId;
      while (parentOf.has(current)) {
        current = parentOf.get(current)!;
        ids.add(current);
        if (current.startsWith('prompt-')) break; // stop at parent prompt
      }
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

  // Single-pass edge styling: smoothstep type + cost gradient + highlight opacity
  const styledEdges = useMemo(() => {
    const hasHighlight = mergedHighlightIds && mergedHighlightIds.size > 0;
    return visibleEdges.map((edge) => {
      const style: Record<string, unknown> = { ...edge.style };

      // Cost gradient (only when no highlight active)
      if (!hasHighlight && edgeCostMap) {
        const cum = edgeCostMap.cumTokens.get(edge.target) ?? 0;
        const ratio = cum / edgeCostMap.maxCum;
        const hue = Math.round(220 - ratio * 220);
        style.stroke = `hsl(${hue}, 70%, 50%)`;
        style.strokeWidth = 1 + ratio * 2;
        style.transition = 'stroke 0.3s ease, stroke-width 0.3s ease';
      }

      // Highlight opacity
      if (hasHighlight) {
        const connected =
          mergedHighlightIds.has(edge.source) && mergedHighlightIds.has(edge.target);
        style.opacity = connected ? 1 : 0.1;
        style.transition = 'opacity 0.2s ease';
      }

      return {
        ...edge,
        type: 'smoothstep' as const,
        pathOptions: { borderRadius: 12 },
        style,
      };
    });
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
  // Uses local prevCount + prevIds to detect new nodes (can't rely on prev state
  // because event handlers mutate the nodes array in place).
  useEffect(() => {
    let prevCount = useAgentStore.getState().nodes.length;
    let prevIds = new Set(useAgentStore.getState().nodes.map((n) => n.id));
    let activePoll: ReturnType<typeof setInterval> | null = null;

    const unsub = useAgentStore.subscribe((state) => {
      const currentCount = state.nodes.length;
      if (currentCount <= prevCount) {
        // Always track the count — if nodes were cleared, prevCount must follow
        prevCount = currentCount;
        prevIds = new Set(state.nodes.map((n) => n.id));
        return;
      }
      if (state.lockViewport || state.selectedNodeId) {
        prevCount = currentCount;
        prevIds = new Set(state.nodes.map((n) => n.id));
        return;
      }

      const newNodes = state.nodes.filter((n) => !prevIds.has(n.id));
      prevCount = currentCount;
      prevIds = new Set(state.nodes.map((n) => n.id));

      const target = newNodes[newNodes.length - 1];
      if (!target) return;

      // Resolve to visible ID (tool → toolgroup)
      let targetId = target.id;
      if (target.id.startsWith('tool-')) {
        for (const edge of state.edges) {
          if (edge.target === target.id) {
            targetId = `toolgroup-${edge.source}`;
            break;
          }
        }
      }

      // Cancel any previous poll — only track the latest node
      if (activePoll) clearInterval(activePoll);

      // Poll until node exists in React Flow, then zoom via setViewport
      let attempts = 0;
      activePoll = setInterval(() => {
        attempts++;
        const rfNodes = getNodesRef.current();
        const node = rfNodes.find((n) => n.id === targetId);
        if (node || attempts > 20) {
          clearInterval(activePoll!);
          activePoll = null;
          if (node) {
            const w = node.measured?.width ?? node.width ?? 200;
            const h = node.measured?.height ?? node.height ?? 100;
            const cx = node.position.x + w / 2;
            const cy = node.position.y + h / 2;
            const container = document.querySelector('.react-flow') as HTMLElement | null;
            const cw = container?.clientWidth ?? 800;
            const ch = container?.clientHeight ?? 600;
            const zoom = Math.min(cw / (w + 200), ch / (h + 200), 1.5);
            setViewportRef.current(
              { x: cw / 2 - cx * zoom, y: ch / 2 - cy * zoom, zoom },
              { duration: 300 },
            );
          }
        }
      }, 50);
    });
    return () => {
      unsub();
      if (activePoll) clearInterval(activePoll);
    };
  }, []);

  // Fit-to-view after time range change so the user doesn't see empty canvas
  useEffect(() => {
    if (!pendingFitView) return;
    useAgentStore.setState({ pendingFitView: false });
    if (visibleNodes.length > 0) {
      scheduleFitView({ padding: 0.2, duration: 300 });
    }
  }, [pendingFitView, visibleNodes, scheduleFitView]);

  // One-time fitView after initial measurement pass — snaps layout into correct positions
  const initialMeasureDoneRef = useRef(false);
  useEffect(() => {
    if (initialMeasureDoneRef.current) return;
    const hasMeasured = layoutNodes.some((n) => n.measured?.width);
    if (hasMeasured && layoutNodes.length > 1) {
      initialMeasureDoneRef.current = true;
      scheduleFitView({ padding: 0.2, duration: 300 });
    }
  }, [layoutNodes, scheduleFitView]);

  // Re-fit view when tool view mode changes (density shifts can lose the graph).
  // If a node is selected, zoom to it; otherwise fit the whole graph.
  const toolGroupMode = useAgentStore((s) => s.toolGroupMode);
  const showAllTools = useAgentStore((s) => s.showAllTools);
  const prevToolGroupModeRef = useRef(toolGroupMode);
  const prevShowAllToolsRef = useRef(showAllTools);
  useEffect(() => {
    if (
      toolGroupMode === prevToolGroupModeRef.current &&
      showAllTools === prevShowAllToolsRef.current
    )
      return;
    prevToolGroupModeRef.current = toolGroupMode;
    prevShowAllToolsRef.current = showAllTools;
    if (selectedNodeId) {
      const visibleId = resolveVisibleId(selectedNodeId);
      if (visibleId) {
        scheduleFitView({ nodes: [{ id: visibleId }], duration: 300, padding: 0.8 });
        return;
      }
    }
    scheduleFitView({ padding: 0.2, duration: 300 });
  }, [toolGroupMode, showAllTools, selectedNodeId, resolveVisibleId, scheduleFitView]);

  // Center on node when selected from lens panel.
  // Zoom to node when pendingZoomNodeId is set (from lens panel click).
  // Zoom to node from lens panel (treemap/sankey click).
  // Uses store subscription (outside React render cycle) + setViewport (direct coordinates).
  const getNodesRef = useRef(getNodes);
  const rawEdgesRef = useRef(rawEdges);
  const setViewportRef = useRef(setViewport);
  getNodesRef.current = getNodes;
  rawEdgesRef.current = rawEdges;
  setViewportRef.current = setViewport;

  useEffect(() => {
    const unsub = useAgentStore.subscribe((state, prev) => {
      const nodeId = state.pendingZoomNodeId;
      if (!nodeId || nodeId === prev.pendingZoomNodeId) return;
      useAgentStore.setState({ pendingZoomNodeId: null });

      // Resolve target ID (direct or tool→toolgroup fallback)
      let targetId = nodeId;
      if (nodeId.startsWith('tool-')) {
        for (const edge of rawEdgesRef.current) {
          if (edge.target === nodeId) {
            targetId = `toolgroup-${edge.source}`;
            break;
          }
        }
      }

      // Poll until the node exists in React Flow, then zoom via setViewport.
      // No suppression of other effects — setViewport is the final word.
      let attempts = 0;
      const poll = setInterval(() => {
        attempts++;
        const rfNodes = getNodesRef.current();
        const node = rfNodes.find((n) => n.id === targetId);

        if (node || attempts > 20) {
          clearInterval(poll);
          if (node) {
            const w = node.measured?.width ?? node.width ?? 200;
            const h = node.measured?.height ?? node.height ?? 100;
            const cx = node.position.x + w / 2;
            const cy = node.position.y + h / 2;

            const container = document.querySelector('.react-flow') as HTMLElement | null;
            const cw = container?.clientWidth ?? 800;
            const ch = container?.clientHeight ?? 600;
            const zoom = Math.min(cw / (w + 200), ch / (h + 200), 1.5);

            setViewportRef.current(
              { x: cw / 2 - cx * zoom, y: ch / 2 - cy * zoom, zoom },
              { duration: 400 },
            );
          }
        }
      }, 50);
    });
    return unsub;
  }, []);

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
        // Frame parent + its toolGroup child (or structural tool children).
        // Skip for response expansion — keep viewport stable when toggling responses.
        const hasResponseChildren = visibleEdges.some(
          (e) => e.source === expandedParentId && e.target.startsWith('response-'),
        );
        if (!hasResponseChildren) {
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
        }
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
  const hasEvents = useAgentStore((s) => s.events.length > 0);
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
    <PromptTurnsContext.Provider value={promptTurnGroups}>
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
        {!hasContentNodes && !isLoading && !loadError && !hasEvents && (
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
        {!hasContentNodes && hasEvents && !showHookEvents && (
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
          fitView={!selectedNodeId}
          fitViewOptions={{ padding: 0.2 }}
          minZoom={0.1}
          maxZoom={2}
          proOptions={{ hideAttribution: true }}
          className="bg-transparent"
        >
          <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#1e293b" />
          {rawNodes.length <= MINIMAP_THRESHOLD && (
            <MiniMap
              position="bottom-right"
              pannable
              zoomable
              style={{ background: '#0d1117', border: '1px solid #1e293b' }}
              maskColor="rgba(13, 17, 23, 0.7)"
              maskStrokeColor="rgba(96, 165, 250, 0.5)"
              maskStrokeWidth={2}
              nodeColor={miniMapNodeColor}
            />
          )}
          <Controls
            position="bottom-left"
            style={{ background: '#161b22', border: '1px solid #30363d', borderRadius: '8px' }}
          />
        </ReactFlow>
        <EdgeCostLegend />
        {Features.coaching && <NudgeBadge />}
        <NotificationPulse /> {/* [notifications] */}
      </>
    </PromptTurnsContext.Provider>
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
