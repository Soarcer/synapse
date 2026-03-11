// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bernhard

import { useState, useMemo, useCallback, useRef, useEffect, useLayoutEffect } from 'react';
import { Virtuoso } from 'react-virtuoso';
import { useLens, type LensTreeNode } from '../LensContext';
import { TreeRow } from './TreeRow';
import { Tooltip } from '../../ui/Tooltip';

export function TreeView() {
  const { treeRoots, selectedId, onSelect, searchQuery } = useLens();
  const containerRef = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [focusIndex, setFocusIndex] = useState(-1);
  const [zoom, setZoom] = useState(1);
  const zoomRef = useRef(1);
  const pendingScrollRef = useRef<{ left: number; top: number } | null>(null);

  // Shift+scroll zoom centered on mouse position (native listener for passive:false)
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      if (!e.shiftKey) return;
      e.preventDefault();

      const rect = el.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      const oldZoom = zoomRef.current;
      const delta = e.deltaY > 0 ? -0.1 : 0.1;
      const newZoom = Math.max(0.5, Math.min(3, oldZoom + delta));
      if (newZoom === oldZoom) return;

      const newScrollLeft = ((el.scrollLeft + mouseX) * newZoom) / oldZoom - mouseX;
      const newScrollTop = ((el.scrollTop + mouseY) * newZoom) / oldZoom - mouseY;

      zoomRef.current = newZoom;
      pendingScrollRef.current = { left: newScrollLeft, top: newScrollTop };
      setZoom(newZoom);
    };
    el.addEventListener('wheel', handler, { passive: false });
    return () => el.removeEventListener('wheel', handler);
  }, []);

  // Apply scroll adjustment after DOM update to avoid flicker
  useLayoutEffect(() => {
    const el = containerRef.current;
    const pending = pendingScrollRef.current;
    if (!el || !pending) return;
    el.scrollLeft = pending.left;
    el.scrollTop = pending.top;
    pendingScrollRef.current = null;
  }, [zoom]);

  // Auto-expand sessions and prompts on first data
  useEffect(() => {
    const autoExpand = new Set<string>();
    for (const root of treeRoots) {
      autoExpand.add(root.id);
      for (const child of root.children) {
        if (child.kind === 'prompt' || child.kind === 'agent') {
          autoExpand.add(child.id);
        }
      }
    }
    setExpanded((prev) => {
      const next = new Set(prev);
      for (const id of autoExpand) next.add(id);
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: expand new roots only when count changes
  }, [treeRoots.length]);

  // Flatten visible tree into a list
  const flatList = useMemo(() => {
    const q = searchQuery?.toLowerCase() ?? '';

    function matchesSearch(node: LensTreeNode): boolean {
      if (!searchQuery) return true;
      if (node.label.toLowerCase().includes(q)) return true;
      return node.children.some((c) => matchesSearch(c));
    }

    const list: LensTreeNode[] = [];

    function walk(nodes: LensTreeNode[]) {
      for (const node of nodes) {
        if (searchQuery && !matchesSearch(node)) continue;
        list.push(node);
        if (expanded.has(node.id) || (searchQuery && matchesSearch(node))) {
          walk(node.children);
        }
      }
    }

    walk(treeRoots);
    return list;
  }, [treeRoots, expanded, searchQuery]);

  const toggleExpand = useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const expandAll = useCallback(() => {
    const all = new Set<string>();
    function walk(nodes: LensTreeNode[]) {
      for (const node of nodes) {
        if (node.children.length > 0) all.add(node.id);
        walk(node.children);
      }
    }
    walk(treeRoots);
    setExpanded(all);
  }, [treeRoots]);

  const collapseAll = useCallback(() => {
    setExpanded(new Set());
  }, []);

  // Auto-expand + scroll to selected node
  useEffect(() => {
    if (!selectedId) return;
    // Find the node in the flat list
    const idx = flatList.findIndex(
      (n) => n.id === selectedId || n.groupedIds?.includes(selectedId),
    );
    if (idx >= 0) {
      // Scroll into view
      const el = containerRef.current;
      if (el) {
        const row = el.querySelector(`[data-node-id="${selectedId}"]`);
        if (row) row.scrollIntoView({ block: 'nearest' });
      }
      setFocusIndex(idx);
      return;
    }

    // Node not visible — expand parents to reveal it
    function findPath(nodes: LensTreeNode[], target: string, path: string[]): string[] | null {
      for (const node of nodes) {
        if (node.id === target || node.groupedIds?.includes(target)) return [...path, node.id];
        const found = findPath(node.children, target, [...path, node.id]);
        if (found) return found;
      }
      return null;
    }

    const path = findPath(treeRoots, selectedId, []);
    if (path) {
      setExpanded((prev) => {
        const next = new Set(prev);
        for (const id of path) next.add(id);
        return next;
      });
    }
  }, [selectedId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keyboard navigation
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setFocusIndex((prev) => Math.min(flatList.length - 1, prev + 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setFocusIndex((prev) => Math.max(0, prev - 1));
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        const node = flatList[focusIndex];
        if (node && node.children.length > 0 && !expanded.has(node.id)) {
          toggleExpand(node.id);
        }
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        const node = flatList[focusIndex];
        if (node && expanded.has(node.id)) {
          toggleExpand(node.id);
        }
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const node = flatList[focusIndex];
        if (node) onSelect(node.id);
      }
    },
    [flatList, focusIndex, expanded, toggleExpand, onSelect],
  );

  if (treeRoots.length === 0) {
    return (
      <div className="p-4 text-center text-gray-600 text-xs">
        No sessions yet. Spawn an agent or wait for hook events.
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Expand/Collapse toolbar */}
      <div className="flex items-center gap-1 px-2 py-1 border-b border-gray-800 flex-shrink-0">
        <Tooltip content="Expand all tree nodes">
          <button
            onClick={expandAll}
            className="text-[10px] text-gray-500 hover:text-gray-300 transition-colors"
          >
            Expand all
          </button>
        </Tooltip>
        <span className="text-gray-700 text-[10px]">|</span>
        <Tooltip content="Collapse all tree nodes">
          <button
            onClick={collapseAll}
            className="text-[10px] text-gray-500 hover:text-gray-300 transition-colors"
          >
            Collapse all
          </button>
        </Tooltip>
        <span className="ml-auto text-[9px] text-gray-600 tabular-nums">
          {flatList.length} items
        </span>
      </div>

      {/* Tree list — virtualized */}
      <div
        ref={containerRef}
        className="flex-1 min-h-0 overflow-hidden focus:outline-none"
        onKeyDown={handleKeyDown}
        tabIndex={0}
      >
        <Virtuoso
          data={flatList}
          overscan={200}
          itemContent={(idx, node) => (
            <TreeRow
              key={node.id}
              node={node}
              zoom={zoom}
              isExpanded={expanded.has(node.id)}
              isSelected={
                selectedId === node.id || (node.groupedIds?.includes(selectedId ?? '') ?? false)
              }
              isFocused={idx === focusIndex}
              onToggle={() => toggleExpand(node.id)}
              onClick={() => onSelect(node.id)}
            />
          )}
        />
      </div>
    </div>
  );
}
