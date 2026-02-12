import { useCallback, useEffect, useMemo, useRef } from 'react';
import {
  ReactFlow,
  MiniMap,
  Controls,
  Background,
  BackgroundVariant,
  useReactFlow,
  ReactFlowProvider,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useAgentStore } from '../../store/agentStore';
import { useAutoLayout } from '../../hooks/useAutoLayout';
import { useGraphNavigation } from '../../hooks/useGraphNavigation';
import { nodeTypes, edgeTypes } from './nodeTypes';
import { GraphSearchBox } from './GraphSearchBox';
import { EdgeCostLegend } from './EdgeCostLegend';
import { registerToastNavigator, unregisterToastNavigator } from '../Toast';
import { nodeMatchesSearch, buildParentMap, collectAncestors } from '../../utils/graphSearch';
import type { AgentNodeData } from '@synapse-ai/core';
import { apiUrl } from '../../utils/api';

// ── Main graph component ─────────────────────────────────────

function AgentGraphInner() {
  const rawNodes = useAgentStore((s) => s.nodes);
  const rawEdges = useAgentStore((s) => s.edges);
  const selectNode = useAgentStore((s) => s.selectNode);
  const layoutMode = useAgentStore((s) => s.layoutMode);
  const selectedNodeId = useAgentStore((s) => s.selectedNodeId);
  const selectSource = useAgentStore((s) => s.selectSource);
  const graphSearchQuery = useAgentStore((s) => s.graphSearchQuery);
  const autoClosePrompts = useAgentStore((s) => s.autoClosePrompts);
  const showAllTools = useAgentStore((s) => s.showAllTools);
  const collapsedNodes = useAgentStore((s) => s.collapsedNodes);
  const lockViewport = useAgentStore((s) => s.lockViewport);
  const { fitView, getViewport, setViewport } = useReactFlow();
  const prevNodeCountRef = useRef(rawNodes.length);
  const prevExpandedRef = useRef<string | null>(null);

  // Register toast click→node navigator so toasts can zoom to nodes
  useEffect(() => {
    registerToastNavigator((nodeId: string) => {
      useAgentStore.getState().selectNode(nodeId, 'lens');
      setTimeout(() => fitView({ nodes: [{ id: nodeId }], duration: 300, padding: 1 }), 50);
    });
    return unregisterToastNavigator;
  }, [fitView]);

  // ── Tool collapse: hide leaf tools, keep structural tools (Task→child agent) ──

  const expandedParentId = useMemo(() => {
    if (!selectedNodeId) return null;
    if (selectedNodeId.startsWith('agent-') || selectedNodeId.startsWith('prompt-')) {
      return selectedNodeId;
    }
    if (selectedNodeId.startsWith('tool-')) {
      for (const edge of rawEdges) {
        if (edge.target === selectedNodeId) return edge.source;
      }
    }
    return null;
  }, [selectedNodeId, rawEdges]);

  // ── Visibility filtering: search mode OR tool-collapse mode ──

  const { visibleNodes, visibleEdges, searchMatchCount, stackedEdgeTargets } = useMemo(() => {
    const query = graphSearchQuery.toLowerCase().trim();

    if (query) {
      // Search mode: show matching nodes + their ancestors
      const matchIds = new Set<string>();
      for (const node of rawNodes) {
        if (nodeMatchesSearch(node, query)) matchIds.add(node.id);
      }

      const parentOf = buildParentMap(rawEdges);
      const keepIds = new Set<string>(matchIds);
      for (const id of matchIds) {
        collectAncestors(id, parentOf, keepIds);
      }
      keepIds.add('__spawn__');

      return {
        visibleNodes: rawNodes.filter((n) => keepIds.has(n.id)),
        visibleEdges: rawEdges.filter((e) => keepIds.has(e.source) && keepIds.has(e.target)),
        searchMatchCount: matchIds.size,
        stackedEdgeTargets: new Set<string>(),
      };
    }

    // Normal mode: tool collapse + optional auto-close prompts
    const structuralToolIds = new Set<string>();
    for (const edge of rawEdges) {
      if (edge.source.startsWith('tool-') && edge.target.startsWith('agent-')) {
        structuralToolIds.add(edge.source);
      }
    }

    const toolParent = new Map<string, string>();
    for (const edge of rawEdges) {
      if (edge.target.startsWith('tool-')) {
        toolParent.set(edge.target, edge.source);
      }
    }

    const hiddenIds = new Set<string>();
    const MAX_STACKED_PREVIEW = 5;
    const leafToolsByParent = new Map<string, string[]>();

    if (!showAllTools) {
      // Group leaf tools by their parent
      for (const [toolId, parentId] of toolParent) {
        if (structuralToolIds.has(toolId)) continue;
        const list = leafToolsByParent.get(parentId) ?? [];
        list.push(toolId);
        leafToolsByParent.set(parentId, list);
      }

      for (const [parentId, tools] of leafToolsByParent) {
        if (parentId === expandedParentId) continue; // expanded → show all
        // Stacked preview: show first N, hide rest
        for (let i = MAX_STACKED_PREVIEW; i < tools.length; i++) {
          hiddenIds.add(tools[i]);
        }
      }
    }

    // Edges to hide for stacked tools (keep only edge to first tool in stack)
    const stackedEdgeTargets = new Set<string>();
    if (!showAllTools) {
      for (const [parentId, tools] of leafToolsByParent) {
        if (parentId === expandedParentId) continue;
        for (let i = 1; i < Math.min(tools.length, MAX_STACKED_PREVIEW); i++) {
          stackedEdgeTargets.add(tools[i]);
        }
      }
    }

    // Auto-close: hide descendants of all prompts except the expanded one
    if (autoClosePrompts) {
      const parentOf = buildParentMap(rawEdges);

      // Find which prompt is expanded — walk up from selected node
      let expandedPrompt: string | null = null;
      if (selectedNodeId) {
        let walk: string | undefined = selectedNodeId;
        while (walk) {
          if (walk.startsWith('prompt-')) { expandedPrompt = walk; break; }
          walk = parentOf.get(walk);
        }
      }

      // Fallback: expand the last prompt node (most recent)
      if (!expandedPrompt) {
        const promptNodes = rawNodes.filter((n) => n.type === 'userPrompt');
        if (promptNodes.length > 0) {
          expandedPrompt = promptNodes[promptNodes.length - 1].id;
        }
      }

      // Hide agents/tools whose prompt ancestor isn't the expanded prompt
      for (const node of rawNodes) {
        if (node.type === 'session' || node.type === 'userPrompt' || node.id === '__spawn__') continue;
        if (hiddenIds.has(node.id)) continue;

        let promptAncestor: string | null = null;
        let walk: string | undefined = node.id;
        while (walk) {
          if (walk.startsWith('prompt-')) { promptAncestor = walk; break; }
          walk = parentOf.get(walk);
        }

        if (promptAncestor && promptAncestor !== expandedPrompt) {
          hiddenIds.add(node.id);
        }
      }
    }

    // Manual collapse: BFS-hide all descendants of collapsed nodes
    if (collapsedNodes.size > 0) {
      const allChildrenOf = new Map<string, string[]>();
      for (const edge of rawEdges) {
        if (hiddenIds.has(edge.target)) continue;
        const kids = allChildrenOf.get(edge.source) ?? [];
        kids.push(edge.target);
        allChildrenOf.set(edge.source, kids);
      }
      for (const cid of collapsedNodes) {
        const queue = [...(allChildrenOf.get(cid) ?? [])];
        while (queue.length > 0) {
          const id = queue.shift()!;
          if (hiddenIds.has(id)) continue;
          hiddenIds.add(id);
          for (const child of allChildrenOf.get(id) ?? []) queue.push(child);
        }
      }
    }

    return {
      visibleNodes: rawNodes.filter((n) => !hiddenIds.has(n.id)),
      visibleEdges: rawEdges.filter(
        (e) => !hiddenIds.has(e.source) && !hiddenIds.has(e.target),
      ),
      searchMatchCount: null as number | null,
      stackedEdgeTargets,
    };
  }, [rawNodes, rawEdges, expandedParentId, graphSearchQuery, autoClosePrompts, showAllTools, selectedNodeId, collapsedNodes]);

  const layoutNodes = useAutoLayout(visibleNodes, visibleEdges, layoutMode, expandedParentId);

  // Compute highlighted node IDs: selected + direct children + all ancestors up the hierarchy
  const connectedIds = useMemo(() => {
    if (!selectedNodeId) return null;
    const ids = new Set<string>([selectedNodeId]);

    const parentOf = buildParentMap(visibleEdges);

    // Add direct children
    for (const edge of visibleEdges) {
      if (edge.source === selectedNodeId) ids.add(edge.target);
    }

    // Walk up ancestors
    collectAncestors(selectedNodeId, parentOf, ids);

    return ids;
  }, [selectedNodeId, visibleEdges]);

  // Merge connectedIds (from single selection) with multiHighlightIds (from heatmap etc.)
  const multiHighlightIds = useAgentStore((s) => s.multiHighlightIds);
  const mergedHighlightIds = useMemo(() => {
    if (!connectedIds && !multiHighlightIds) return null;
    const merged = new Set<string>();
    if (connectedIds) for (const id of connectedIds) merged.add(id);
    if (multiHighlightIds) for (const id of multiHighlightIds) merged.add(id);
    return merged;
  }, [connectedIds, multiHighlightIds]);

  // Sync highlighted IDs to store so node components can access them
  const setHighlightedNodeIds = useAgentStore((s) => s.setHighlightedNodeIds);
  useEffect(() => {
    setHighlightedNodeIds(mergedHighlightIds);
  }, [mergedHighlightIds, setHighlightedNodeIds]);

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

  // In list mode, use smoothstep edges; dim non-connected edges when selected; apply cost gradient
  const styledEdges = useMemo(() => {
    // Hide edges to non-first stacked tool nodes (keep them in visibleEdges for layout)
    let result = stackedEdgeTargets.size > 0
      ? visibleEdges.filter((e) => !stackedEdgeTargets.has(e.target))
      : visibleEdges;
    if (layoutMode === 'list') {
      result = result.map((e) => ({
        ...e,
        type: 'smoothstep' as const,
        pathOptions: { borderRadius: 8 },
      }));
    }
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
  }, [visibleEdges, layoutMode, mergedHighlightIds, edgeCostMap, stackedEdgeTargets]);

  // Fit view when new nodes are added (unless viewport is locked)
  useEffect(() => {
    if (rawNodes.length > prevNodeCountRef.current && !lockViewport) {
      setTimeout(() => fitView({ padding: 0.2, duration: 300 }), 100);
    }
    prevNodeCountRef.current = rawNodes.length;
  }, [rawNodes.length, fitView, lockViewport]);

  // Center on node when selected from lens panel
  useEffect(() => {
    if (selectSource === 'lens' && selectedNodeId) {
      const targetNode = visibleNodes.find((n) => n.id === selectedNodeId);
      if (targetNode) {
        setTimeout(
          () => fitView({ nodes: [{ id: selectedNodeId }], duration: 300, padding: 1 }),
          50,
        );
      }
      useAgentStore.setState({ selectSource: null });
    }
  }, [selectSource, selectedNodeId, visibleNodes, fitView]);

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
      const nodeX = (layoutNode as unknown as { positionAbsolute?: { x: number } }).positionAbsolute?.x ?? layoutNode.position.x;
      const nodeY = (layoutNode as unknown as { positionAbsolute?: { y: number } }).positionAbsolute?.y ?? layoutNode.position.y;

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
        const childIds = visibleEdges
          .filter((e) => e.source === node.id)
          .map((e) => e.target);

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
      if (expansionHappened && expandedParentId) {
        // Frame parent + its newly expanded tool children
        const nodeIds = [expandedParentId];
        for (const edge of visibleEdges) {
          if (edge.source === expandedParentId && edge.target.startsWith('tool-')) {
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
          setViewport(
            { x: vp.x - shift, y: vp.y, zoom: vp.zoom },
            { duration: 300 },
          );
        }
      }
    }, 200);

    return () => clearTimeout(timer);
  }, [selectedNodeId, selectSource, expandedParentId, visibleEdges, layoutNodes, fitView, getViewport, setViewport]);

  // ── Arrow-key graph navigation ──────────────────────────────
  useGraphNavigation(visibleNodes, visibleEdges, selectNode, fitView);

  const onPaneClick = useCallback(() => {
    selectNode(null);
  }, [selectNode]);

  const showHookEvents = useAgentStore((s) => s.showHookEvents);
  const events = useAgentStore((s) => s.events);
  const isLoading = useAgentStore((s) => s.isLoading);
  const loadError = useAgentStore((s) => s.loadError);

  const onNodesChange = useCallback(() => {}, []);
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
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
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
              onClick={() => {
                useAgentStore.getState().setLoadError(null);
                useAgentStore.getState().setLoading(true);
                fetch(apiUrl('/api/events?limit=2000'))
                  .then((r) => r.json())
                  .then((events) => {
                    useAgentStore.getState().loadEvents(events);
                    useAgentStore.getState().setLoading(false);
                  })
                  .catch((err) => {
                    useAgentStore.getState().setLoadError(err.message);
                    useAgentStore.getState().setLoading(false);
                  });
              }}
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
              Start a Claude Code session in this project, or run a simulation script to see the graph in action.
            </p>
          </div>
        </div>
      )}
      {!hasContentNodes && events.length > 0 && !showHookEvents && (
        <div className="absolute top-14 left-1/2 -translate-x-1/2 z-10 px-4 py-2 bg-amber-900/70 border border-amber-600/40 rounded-lg text-xs text-amber-200 backdrop-blur-sm text-center">
          Hook events are hidden — press <kbd className="px-1.5 py-0.5 bg-amber-800/60 rounded text-amber-100 font-mono mx-0.5">H</kbd> to show them
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
