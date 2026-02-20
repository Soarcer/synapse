// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Synapse Contributors

import { useState, useMemo, useCallback, useRef, useEffect, useLayoutEffect } from 'react';
import { useLens, type LensTreeNode, type ProfileMetric } from '../LensContext';
import { formatTokens, formatDuration, formatCount, getKindColor } from '@synapse-ai/core';
import { useAgentStore } from '../../../store/agentStore';

interface Rect {
  id: string;
  label: string;
  kind: string;
  value: number;
  color: string;
  x: number;
  y: number;
  w: number;
  h: number;
  depth: number;
}

interface NestedRect extends Rect {
  children: NestedRect[];
}

// ── Squarified treemap layout ─────────────────────────────────

function squarify(
  items: { id: string; label: string; kind: string; value: number; color: string; depth: number }[],
  x: number,
  y: number,
  w: number,
  h: number,
): Rect[] {
  const total = items.reduce((sum, item) => sum + item.value, 0);
  if (total === 0 || items.length === 0 || w <= 0 || h <= 0) return [];

  const rects: Rect[] = [];
  let cx = x, cy = y, cw = w, ch = h;

  const sorted = [...items].sort((a, b) => b.value - a.value);

  let i = 0;
  while (i < sorted.length) {
    const remaining = sorted.slice(i).reduce((s, it) => s + it.value, 0);
    const isVertical = cw >= ch;
    const side = isVertical ? ch : cw;

    let row: typeof sorted = [];
    let rowSum = 0;
    let bestWorst = Infinity;

    for (let j = i; j < sorted.length; j++) {
      const candidate = [...row, sorted[j]];
      const candidateSum = rowSum + sorted[j].value;
      const rowLen = (candidateSum / remaining) * (isVertical ? cw : ch);

      let worst = 0;
      for (const item of candidate) {
        const itemLen = (item.value / candidateSum) * side;
        const ratio = rowLen > 0 && itemLen > 0
          ? Math.max(rowLen / itemLen, itemLen / rowLen)
          : Infinity;
        worst = Math.max(worst, ratio);
      }

      if (worst <= bestWorst) {
        bestWorst = worst;
        row = candidate;
        rowSum = candidateSum;
      } else {
        break;
      }
    }

    const rowLen = remaining > 0 ? (rowSum / remaining) * (isVertical ? cw : ch) : 0;
    let offset = 0;

    for (const item of row) {
      const frac = rowSum > 0 ? item.value / rowSum : 0;
      const itemLen = frac * side;

      if (isVertical) {
        rects.push({ ...item, x: cx, y: cy + offset, w: rowLen, h: itemLen });
      } else {
        rects.push({ ...item, x: cx + offset, y: cy, w: itemLen, h: rowLen });
      }
      offset += itemLen;
    }

    if (isVertical) { cx += rowLen; cw -= rowLen; }
    else { cy += rowLen; ch -= rowLen; }

    i += row.length;
  }

  return rects;
}

// ── Recursive nested layout ──────────────────────────────────

const LABEL_H = 14;
const NEST_PAD = 1.5;

/** Compute a node's effective value, falling back to duration when tokens=0
 *  to ensure the full hierarchy is always visible regardless of metric */
function effectiveValue(node: LensTreeNode, metric: ProfileMetric): number {
  if (metric === 'count') return node.count;
  const primary = Math.max(metric === 'tokens' ? node.tokens : node.duration, 0);
  if (primary > 0) return primary;
  // Fall back to duration so nodes without token data are still visible
  if (node.duration > 0) return node.duration;
  // Last resort: children count ensures non-empty parents are visible
  return node.children.length > 0 ? 1 : 0;
}

function layoutNested(
  treeNodes: LensTreeNode[],
  metric: ProfileMetric,
  x: number,
  y: number,
  w: number,
  h: number,
  depth: number,
  paletteIndex = 0,
): NestedRect[] {
  const items = treeNodes
    .map((node) => ({
      node,
      id: node.id,
      label: node.label,
      kind: node.kind,
      value: effectiveValue(node, metric),
      color: getKindColor(node.kind, node.label, paletteIndex),
      depth,
    }))
    .filter((item) => item.value > 0);

  if (items.length === 0) return [];

  const rects = squarify(items, x, y, w, h);

  const nodeMap = new Map(treeNodes.map((n) => [n.id, n]));

  return rects.map((rect) => {
    const node = nodeMap.get(rect.id);
    if (!node) return { ...rect, children: [] };

    const childrenWithValue = node.children.filter(
      (c) => effectiveValue(c, metric) > 0,
    );

    if (childrenWithValue.length > 0 && rect.w > 24 && rect.h > LABEL_H + 8) {
      const innerX = rect.x + NEST_PAD;
      const innerY = rect.y + LABEL_H;
      const innerW = Math.max(rect.w - NEST_PAD * 2, 0);
      const innerH = Math.max(rect.h - LABEL_H - NEST_PAD, 0);

      const children = layoutNested(childrenWithValue, metric, innerX, innerY, innerW, innerH, depth + 1, paletteIndex);
      return { ...rect, children };
    }

    return { ...rect, children: [] };
  });
}

// ── Component ─────────────────────────────────────────────────

export function TreemapView() {
  const { treeRoots, profileMetric, selectedId, onSelect, onProfileMetricChange, hasTokenData } = useLens();
  const paletteIndex = useAgentStore((s) => s.paletteIndex);
  const containerRef = useRef<HTMLDivElement>(null);
  const [tooltip, setTooltip] = useState<{ x: number; y: number; node: NestedRect } | null>(null);
  const [zoomNode, setZoomNode] = useState<LensTreeNode | null>(null);
  const [containerSize, setContainerSize] = useState({ w: 300, h: 400 });
  const [zoom, setZoom] = useState(1);
  const zoomRef = useRef(1);
  const pendingScrollRef = useRef<{ left: number; top: number } | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () => {
      const w = el.clientWidth - 8;
      const h = el.clientHeight - 8;
      if (w > 0 && h > 0) setContainerSize({ w, h });
    };
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    // Defer initial measurement so flex layout has settled
    const raf = requestAnimationFrame(measure);
    return () => { observer.disconnect(); cancelAnimationFrame(raf); };
  }, []);

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
      const newZoom = Math.max(0.5, Math.min(5, oldZoom + delta));
      if (newZoom === oldZoom) return;

      // Keep the content point under the mouse fixed
      const newScrollLeft = (el.scrollLeft + mouseX) * newZoom / oldZoom - mouseX;
      const newScrollTop = (el.scrollTop + mouseY) * newZoom / oldZoom - mouseY;

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

  const formatValue = useCallback(
    (v: number) => profileMetric === 'tokens' ? formatTokens(v) : profileMetric === 'duration' ? formatDuration(v) : formatCount(v),
    [profileMetric],
  );

  const source = useMemo(() => (zoomNode ? zoomNode.children : treeRoots), [zoomNode, treeRoots]);

  const viewW = containerSize.w;
  const viewH = containerSize.h;

  const nestedRects = useMemo(
    () => layoutNested(source, profileMetric, 0, 0, viewW, viewH, 0, paletteIndex),
    [source, profileMetric, viewW, viewH, paletteIndex],
  );

  const totalValue = useMemo(() => {
    const getValue = (n: LensTreeNode) => profileMetric === 'tokens' ? n.tokens : profileMetric === 'duration' ? n.duration : n.count;
    return source.reduce((s, n) => s + Math.max(getValue(n), 0), 0);
  }, [source, profileMetric]);

  // Find LensTreeNode by id for zoom
  const findTreeNode = useCallback(
    (id: string): LensTreeNode | null => {
      function find(nodes: LensTreeNode[]): LensTreeNode | null {
        for (const n of nodes) {
          if (n.id === id) return n;
          const found = find(n.children);
          if (found) return found;
        }
        return null;
      }
      return find(treeRoots);
    },
    [treeRoots],
  );

  // Recursive SVG renderer
  function renderRect(rect: NestedRect) {
    const isSelected = selectedId === rect.id;
    const isParent = rect.children.length > 0;
    const isLeafTool = !isParent && rect.kind === 'tool';
    const showLabel = rect.w > 20 && rect.h > 12;
    const showValue = !isLeafTool && !isParent && rect.w > 40 && rect.h > 24;
    // Leaf tools always show initial; non-tool leaves show full label
    const showInitial = isLeafTool && rect.w > 10 && rect.h > 10;
    const pct = totalValue > 0 ? ((rect.value / totalValue) * 100).toFixed(1) : '0';

    return (
      <g key={rect.id}>
        {/* Container / leaf rect */}
        <rect
          x={rect.x + 0.5}
          y={rect.y + 0.5}
          width={Math.max(0, rect.w - 1)}
          height={Math.max(0, rect.h - 1)}
          rx={2}
          fill={isParent ? `${rect.color}20` : rect.color}
          opacity={isSelected ? 1 : isParent ? 1 : 0.8}
          stroke={isParent ? rect.color : '#0d1117'}
          strokeWidth={isParent ? 0.8 : 0.5}
          strokeOpacity={isParent ? 0.4 : 1}
          className="cursor-pointer treemap-rect"
          onClick={(e) => { e.stopPropagation(); onSelect(rect.id); }}
          onDoubleClick={(e) => {
            e.stopPropagation();
            const node = findTreeNode(rect.id);
            if (node && node.children.length > 0) setZoomNode(node);
          }}
          onMouseEnter={(e) => {
            const svgRect = e.currentTarget.getBoundingClientRect();
            setTooltip({ x: svgRect.left + svgRect.width / 2, y: svgRect.top - 4, node: rect });
          }}
          onMouseLeave={() => setTooltip(null)}
        />

        {/* Animated marching-ants outline for selected */}
        {isSelected && (
          <rect
            x={rect.x + 0.5}
            y={rect.y + 0.5}
            width={Math.max(0, rect.w - 1)}
            height={Math.max(0, rect.h - 1)}
            rx={2}
            className="selected-outline"
          />
        )}

        {/* Label (skip for leaf tools — they use initial instead) */}
        {showLabel && !isLeafTool && (
          <text
            x={rect.x + 3}
            y={rect.y + (isParent ? 10 : 11)}
            className="pointer-events-none"
            fill={isParent ? rect.color : 'rgba(255,255,255,0.9)'}
            fillOpacity={isParent ? 0.8 : 1}
            fontSize={isParent ? 7.5 : 8}
            fontWeight={isParent ? 600 : 500}
          >
            {rect.label.length > rect.w / 5
              ? rect.label.slice(0, Math.floor(rect.w / 5)) + '..'
              : rect.label}
          </text>
        )}

        {/* Tool initial for small rects */}
        {showInitial && (
          <text
            x={rect.x + rect.w / 2}
            y={rect.y + rect.h / 2 + 3}
            textAnchor="middle"
            className="pointer-events-none"
            fill="rgba(255,255,255,0.7)"
            fontSize={Math.min(rect.w, rect.h) * 0.6}
            fontWeight={600}
          >
            {rect.label.charAt(0)}
          </text>
        )}

        {/* Value on leaf */}
        {showValue && (
          <text
            x={rect.x + 3}
            y={rect.y + 21}
            className="pointer-events-none"
            fill="rgba(255,255,255,0.6)"
            fontSize={7}
          >
            {formatValue(rect.value)} ({pct}%)
          </text>
        )}

        {/* Nested children */}
        {rect.children.map(renderRect)}
      </g>
    );
  }

  const hasData = treeRoots.length > 0;

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      {hasData && (
        <div className="flex items-center justify-between px-3 py-1.5 border-b border-gray-800 flex-shrink-0">
          <div className="flex items-center gap-1">
            <button
              onClick={() => onProfileMetricChange('tokens')}
              className={`px-2 py-0.5 rounded text-[10px] transition-colors ${
                profileMetric === 'tokens' ? 'bg-gray-700 text-gray-100' : 'text-gray-500 hover:text-gray-300'
              }`}
            >
              Tokens
            </button>
            <button
              onClick={() => onProfileMetricChange('duration')}
              className={`px-2 py-0.5 rounded text-[10px] transition-colors ${
                profileMetric === 'duration' ? 'bg-gray-700 text-gray-100' : 'text-gray-500 hover:text-gray-300'
              }`}
            >
              Duration
            </button>
            <button
              onClick={() => onProfileMetricChange('count')}
              className={`px-2 py-0.5 rounded text-[10px] transition-colors ${
                profileMetric === 'count' ? 'bg-gray-700 text-gray-100' : 'text-gray-500 hover:text-gray-300'
              }`}
            >
              Count
            </button>
          </div>
          <span className="text-[10px] text-gray-500 font-mono">
            {profileMetric === 'tokens' && !hasTokenData
              ? <span className="text-yellow-600" title="Hook sessions don't provide token data">no data</span>
              : <>{formatValue(totalValue)} <span className="text-gray-600">Shift+scroll zoom</span></>}
          </span>
        </div>
      )}

      {/* Zoom breadcrumb */}
      {zoomNode && (
        <div className="flex items-center gap-1 px-3 py-1 border-b border-gray-800 flex-shrink-0">
          <button
            onClick={() => setZoomNode(null)}
            className="text-[10px] text-blue-400 hover:text-blue-300 transition-colors"
          >
            &larr; Zoom out
          </button>
          <span className="text-[10px] text-gray-500">{zoomNode.label}</span>
        </div>
      )}

      {/* Treemap — container always rendered so ResizeObserver attaches on mount */}
      <div ref={containerRef} className="flex-1 min-h-0 overflow-auto p-1">
        {hasData ? (
          <svg
            viewBox={`0 0 ${viewW} ${viewH}`}
            width={viewW * zoom}
            height={viewH * zoom}
            className="block"
          >
            {nestedRects.map(renderRect)}
          </svg>
        ) : (
          <div className="h-full flex items-center justify-center text-gray-600 text-xs">No data yet.</div>
        )}
      </div>

      {/* Tooltip */}
      {tooltip && (
        <div
          className="fixed z-50 px-2 py-1.5 bg-gray-900 border border-gray-700 rounded text-[10px] text-gray-300 shadow-lg pointer-events-none space-y-0.5"
          style={{ left: tooltip.x, top: tooltip.y, transform: 'translate(-50%, -100%)' }}
        >
          <div className="font-medium text-gray-100">{tooltip.node.label}</div>
          <div>{profileMetric === 'tokens' ? 'Tokens' : profileMetric === 'duration' ? 'Duration' : 'Count'}: {formatValue(tooltip.node.value)}</div>
          <div>{totalValue > 0 ? ((tooltip.node.value / totalValue) * 100).toFixed(1) : 0}% of total</div>
          {tooltip.node.children.length > 0 && (
            <div className="text-gray-500">Double-click to zoom in</div>
          )}
        </div>
      )}
    </div>
  );
}
