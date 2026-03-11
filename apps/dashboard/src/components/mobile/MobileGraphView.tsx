// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bernhard

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ReactFlow, ReactFlowProvider, useReactFlow } from '@xyflow/react';
import type { NodeChange } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useAgentStore } from '../../store/agentStore';
import { useVisibleGraph } from '../../hooks/useVisibleGraph';
import { useAutoLayout } from '../../hooks/useAutoLayout';
import { nodeTypes, edgeTypes } from '../graph/nodeTypes';
import { MobileSearchButton } from './MobileSearchButton';

const EMPTY_SET: ReadonlySet<string> = new Set();

function MobileEmptyState() {
  const connectionStatus = useAgentStore((s) => s.connectionStatus);
  return (
    <div className="flex-1 flex flex-col items-center justify-center text-gray-500 text-sm gap-2 p-8 text-center">
      <div className="text-2xl mb-2">{'\u2B21'}</div>
      <div>Waiting for Claude Code activity...</div>
      <div className="text-xs text-gray-600">
        {connectionStatus === 'connected'
          ? 'Connected \u2014 nodes will appear when a session starts'
          : 'Not connected to server'}
      </div>
    </div>
  );
}

function MobileGraphInner() {
  const rawNodes = useAgentStore((s) => s.nodes);
  const rawEdges = useAgentStore((s) => s.edges);
  const selectNode = useAgentStore((s) => s.selectNode);
  const selectedNodeId = useAgentStore((s) => s.selectedNodeId);
  const lockViewport = useAgentStore((s) => s.lockViewport);
  const { fitView } = useReactFlow();

  // Own toolGroupDims state (same pattern as AgentGraph)
  const [toolGroupDims, setToolGroupDims] = useState<
    Map<string, { width: number; height: number }>
  >(() => new Map());

  // Own expandedParentId computation (same as AgentGraph lines 57-71)
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

  // Use shared visibility hook — read autoClosePrompts from store so the settings toggle works
  const autoClosePrompts = useAgentStore((s) => s.autoClosePrompts);
  const { visibleNodes, visibleEdges } = useVisibleGraph({
    autoClosePrompts,
    collapsedNodes: EMPTY_SET,
    toolGroupDims,
  });

  const layoutNodes = useAutoLayout(visibleNodes, visibleEdges, expandedParentId);

  // Filter out spawn node on mobile
  const mobileNodes = useMemo(() => layoutNodes.filter((n) => n.id !== '__spawn__'), [layoutNodes]);

  // Own onNodesChange callback (same pattern as AgentGraph lines 558-590)
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
          if (!changed) return prev;
          const next = new Map(prev);
          for (const { id, width, height } of tgUpdates) next.set(id, { width, height });
          return next;
        });
      }
    },
    [updateNodeDimensions],
  );

  const onNodeClick = useCallback(
    (_: React.MouseEvent, node: { id: string }) => {
      selectNode(node.id, 'graph');
    },
    [selectNode],
  );

  const onPaneClick = useCallback(() => {
    selectNode(null);
  }, [selectNode]);

  // Resolve a node ID to a visible ID — grouped tools map to their toolgroup
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

  // Fit view on first render with measured nodes
  const initialFitDone = useRef(false);
  useEffect(() => {
    if (!initialFitDone.current && mobileNodes.length > 0) {
      const hasMeasured = mobileNodes.some((n) => n.measured?.width);
      if (hasMeasured) {
        initialFitDone.current = true;
        setTimeout(() => fitView({ padding: 0.3, duration: 300 }), 50);
      }
    }
  }, [mobileNodes, fitView]);

  // Zoom to newest node when nodes are added (unless viewport is locked or a node is selected)
  const prevNodeCountRef = useRef(rawNodes.length);
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
      } else {
        setTimeout(() => fitView({ padding: 0.2, duration: 300 }), 100);
      }
    }
    prevNodeCountRef.current = rawNodes.length;
    prevNodeIdsRef.current = new Set(rawNodes.map((n) => n.id));
  }, [rawNodes, fitView, lockViewport, selectedNodeId, resolveVisibleId]);

  if (mobileNodes.length === 0) {
    return <MobileEmptyState />;
  }

  return (
    <div className="flex-1 relative" style={{ touchAction: 'none' }}>
      <ReactFlow
        nodes={mobileNodes}
        edges={visibleEdges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodeClick={onNodeClick}
        onPaneClick={onPaneClick}
        onNodesChange={onNodesChange}
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
