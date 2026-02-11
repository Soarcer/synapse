import { useEffect, useLayoutEffect, useRef } from 'react';
import { useAgentStore } from '../store/agentStore';
import type { Node, Edge } from '@xyflow/react';

export function useGraphNavigation(
  visibleNodes: Node[],
  visibleEdges: Edge[],
  selectNode: (id: string | null, source?: 'graph' | 'lens') => void,
  fitView: (options?: { nodes?: { id: string }[]; padding?: number; duration?: number }) => void,
) {
  const visibleNodesRef = useRef(visibleNodes);
  const visibleEdgesRef = useRef(visibleEdges);
  useLayoutEffect(() => {
    visibleNodesRef.current = visibleNodes;
    visibleEdgesRef.current = visibleEdges;
  }, [visibleNodes, visibleEdges]);

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
}
