import { useCallback, useEffect, useMemo, useRef } from 'react';
import {
  ReactFlow,
  MiniMap,
  Controls,
  Background,
  BackgroundVariant,
  useReactFlow,
  ReactFlowProvider,
  type Node,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useAgentStore } from '../../store/agentStore';
import { useAutoLayout } from '../../hooks/useAutoLayout';
import { nodeTypes, edgeTypes } from './nodeTypes';
import type {
  AgentNodeData,
  SessionData,
  ToolCallSummary,
  UserPromptData,
} from '../../types/agent';
import { apiUrl } from '../../utils/api';

// ── Search helpers ───────────────────────────────────────────

function nodeMatchesSearch(node: Node, query: string): boolean {
  if (node.id === '__spawn__') return false;
  const d = node.data as Record<string, unknown>;

  switch (node.type) {
    case 'session': {
      const s = d.session as SessionData;
      return [s.sessionId, s.model, s.cwd].some((v) =>
        v?.toLowerCase().includes(query),
      );
    }
    case 'userPrompt': {
      const p = d.prompt as UserPromptData;
      return p.text.toLowerCase().includes(query);
    }
    case 'agent': {
      const a = d.agent as AgentNodeData;
      return [a.agentType, a.agentId].some((v) =>
        v?.toLowerCase().includes(query),
      );
    }
    case 'toolCall': {
      const t = d.toolCall as ToolCallSummary;
      return [t.toolName, t.inputPreview].some((v) =>
        v?.toLowerCase().includes(query),
      );
    }
    default:
      return false;
  }
}

/** Build a child→parent map from edges */
function buildParentMap(edges: { source: string; target: string }[]): Map<string, string> {
  const parentOf = new Map<string, string>();
  for (const edge of edges) {
    parentOf.set(edge.target, edge.source);
  }
  return parentOf;
}

/** Collect a node's ancestors by walking up the parent map */
function collectAncestors(id: string, parentOf: Map<string, string>, into: Set<string>): void {
  let current = id;
  while (parentOf.has(current)) {
    current = parentOf.get(current)!;
    into.add(current);
  }
}

// ── Search box overlay ───────────────────────────────────────

function GraphSearchBox({ matchCount }: { matchCount: number | null }) {
  const graphSearchQuery = useAgentStore((s) => s.graphSearchQuery);
  const setGraphSearchQuery = useAgentStore((s) => s.setGraphSearchQuery);
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="absolute top-3 left-3 z-10 flex items-center gap-2">
      <div className="relative">
        <input
          ref={inputRef}
          id="graph-search-input"
          value={graphSearchQuery}
          onChange={(e) => setGraphSearchQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setGraphSearchQuery('');
              inputRef.current?.blur();
            }
          }}
          placeholder="Search nodes... (/)"
          className="w-56 px-3 py-1.5 bg-gray-900/90 border border-gray-700 rounded-lg text-xs text-gray-200 placeholder-gray-500 backdrop-blur-sm focus:outline-none focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/25"
        />
        {graphSearchQuery && (
          <button
            onClick={() => {
              setGraphSearchQuery('');
              inputRef.current?.focus();
            }}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300 text-xs"
          >
            ✕
          </button>
        )}
      </div>
      {matchCount !== null && (
        <span className="text-[10px] text-gray-500 tabular-nums">
          {matchCount} match{matchCount !== 1 ? 'es' : ''}
        </span>
      )}
    </div>
  );
}

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

  const { visibleNodes, visibleEdges, searchMatchCount } = useMemo(() => {
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
    if (!showAllTools) {
      for (const [toolId, parentId] of toolParent) {
        if (structuralToolIds.has(toolId)) continue;
        if (parentId === expandedParentId) continue;
        hiddenIds.add(toolId);
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
    };
  }, [rawNodes, rawEdges, expandedParentId, graphSearchQuery, autoClosePrompts, showAllTools, selectedNodeId, collapsedNodes]);

  const layoutNodes = useAutoLayout(visibleNodes, visibleEdges, layoutMode);

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
    let result = visibleEdges;
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
  }, [visibleEdges, layoutMode, mergedHighlightIds, edgeCostMap]);

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
      const nodeX = (layoutNode as any).positionAbsolute?.x ?? layoutNode.position.x;
      const nodeY = (layoutNode as any).positionAbsolute?.y ?? layoutNode.position.y;

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
  const visibleNodesRef = useRef(visibleNodes);
  const visibleEdgesRef = useRef(visibleEdges);
  visibleNodesRef.current = visibleNodes;
  visibleEdgesRef.current = visibleEdges;

  useEffect(() => {
    const handleArrowNav = (e: KeyboardEvent) => {
      if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) return;

      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      const currentId = useAgentStore.getState().selectedNodeId;
      if (!currentId || currentId === '__spawn__') return;

      e.preventDefault();

      const vNodes = visibleNodesRef.current;
      const vEdges = visibleEdgesRef.current;

      // Build parent/children maps
      const parentOf = new Map<string, string>();
      const childrenOf = new Map<string, string[]>();
      for (const edge of vEdges) {
        parentOf.set(edge.target, edge.source);
        const kids = childrenOf.get(edge.source) ?? [];
        kids.push(edge.target);
        childrenOf.set(edge.source, kids);
      }

      const currentNode = vNodes.find((n) => n.id === currentId);
      if (!currentNode) return;
      const currentType = currentNode.type;

      let targetId: string | null = null;

      if (e.key === 'ArrowLeft') {
        // Go to parent node
        targetId = parentOf.get(currentId) ?? null;
      } else if (e.key === 'ArrowRight') {
        // Go to first child node
        const kids = childrenOf.get(currentId) ?? [];
        targetId = kids[0] ?? null;
      } else {
        // ArrowUp / ArrowDown — navigate siblings of same type
        const parentId = parentOf.get(currentId);
        const sameTypeSiblings = parentId
          ? (childrenOf.get(parentId) ?? []).filter((id) => {
              const n = vNodes.find((nd) => nd.id === id);
              return n?.type === currentType;
            })
          : vNodes
              .filter((n) => n.type === currentType && !parentOf.has(n.id) && n.id !== '__spawn__')
              .map((n) => n.id);

        const idx = sameTypeSiblings.indexOf(currentId);
        if (idx < 0 || sameTypeSiblings.length <= 1) return;

        if (e.key === 'ArrowUp') {
          targetId = sameTypeSiblings[idx > 0 ? idx - 1 : sameTypeSiblings.length - 1];
        } else {
          targetId = sameTypeSiblings[idx < sameTypeSiblings.length - 1 ? idx + 1 : 0];
        }
      }

      if (targetId && targetId !== currentId) {
        selectNode(targetId, 'graph');
        setTimeout(() => {
          fitView({ nodes: [{ id: targetId! }], duration: 200, padding: 0.8 });
        }, 50);
      }
    };

    window.addEventListener('keydown', handleArrowNav);
    return () => window.removeEventListener('keydown', handleArrowNav);
  }, [selectNode, fitView]);

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
          style={{ background: '#0d1117', border: '1px solid #1e293b' }}
          maskColor="rgba(13, 17, 23, 0.7)"
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
