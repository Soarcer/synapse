// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bernhard

import { useMemo } from 'react';
import { useLens, type LensTreeNode } from './LensContext';

export function LensBreadcrumb() {
  const { selectedId, treeRoots, onSelect } = useLens();

  const path = useMemo(() => {
    if (!selectedId) return [];
    const result: LensTreeNode[] = [];

    function find(nodes: LensTreeNode[], target: string): boolean {
      for (const node of nodes) {
        result.push(node);
        if (node.id === target) return true;
        if (node.groupedIds?.includes(target)) return true;
        if (find(node.children, target)) return true;
        result.pop();
      }
      return false;
    }

    find(treeRoots, selectedId);
    return result;
  }, [selectedId, treeRoots]);

  if (path.length === 0) return null;

  // If path is too long, collapse middle segments
  const maxSegments = 4;
  const display =
    path.length > maxSegments
      ? [...path.slice(0, 1), null, ...path.slice(-(maxSegments - 1))]
      : path;

  return (
    <div className="flex items-center gap-1 px-3 py-1.5 border-t border-gray-800 text-[10px] text-gray-500 flex-shrink-0 min-h-[28px] overflow-hidden">
      {display.map((node, i) => (
        <span key={node ? node.id : 'ellipsis'} className="flex items-center gap-1 min-w-0">
          {i > 0 && <span className="text-gray-700 flex-shrink-0">&gt;</span>}
          {node ? (
            <button
              onClick={() => onSelect(node.id)}
              className="truncate hover:text-gray-300 transition-colors max-w-[80px]"
              title={node.label}
            >
              {node.label}
            </button>
          ) : (
            <span className="text-gray-700">...</span>
          )}
        </span>
      ))}
    </div>
  );
}
