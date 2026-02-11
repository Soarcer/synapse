import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { useLens, type SankeyNode, type SankeyLink } from '../LensContext';
import { formatTokens, formatDuration, formatCount } from '@synapse-ai/core';

const LAYER_LABELS = ['Sessions', 'Prompts', 'Agents', 'Tools'];
const NODE_WIDTH = 14;
const VERTICAL_GAP = 4;

interface LayoutNode extends SankeyNode {
  x: number;
  y: number;
  h: number;
}

interface LayoutLink extends SankeyLink {
  sx: number;
  sy: number;
  sh: number;
  tx: number;
  ty: number;
  th: number;
  color: string;
}

export function SankeyView() {
  const { sankeyData, profileMetric, onProfileMetricChange, selectedId, onSelect, hasTokenData } = useLens();
  const [tooltip, setTooltip] = useState<{ x: number; y: number; text: string[] } | null>(null);
  const [zoom, setZoom] = useState(1);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    if (!e.shiftKey) return; // Shift+scroll to zoom, normal scroll passes through
    e.preventDefault();
    setZoom((prev) => Math.max(0.5, Math.min(5, prev + (e.deltaY > 0 ? -0.1 : 0.1))));
  }, []);

  // Mousedown pan
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    let dragging = false;
    let startX = 0;
    let startY = 0;
    let scrollX = 0;
    let scrollY = 0;

    const onDown = (e: MouseEvent) => {
      // Only pan on middle-click or left-click on empty area (not on nodes/links)
      if (e.button !== 0 && e.button !== 1) return;
      dragging = true;
      startX = e.clientX;
      startY = e.clientY;
      scrollX = el.scrollLeft;
      scrollY = el.scrollTop;
      el.style.cursor = 'grabbing';
      e.preventDefault();
    };
    const onMove = (e: MouseEvent) => {
      if (!dragging) return;
      el.scrollLeft = scrollX - (e.clientX - startX);
      el.scrollTop = scrollY - (e.clientY - startY);
    };
    const onUp = () => {
      dragging = false;
      el.style.cursor = '';
    };

    el.addEventListener('mousedown', onDown);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      el.removeEventListener('mousedown', onDown);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, []);

  const formatValue = useCallback(
    (v: number) => profileMetric === 'tokens' ? formatTokens(v) : profileMetric === 'duration' ? formatDuration(v) : formatCount(v),
    [profileMetric],
  );

  // Layout computation
  const { layoutNodes, layoutLinks, viewW, viewH } = useMemo(() => {
    const { nodes, links } = sankeyData;
    if (nodes.length === 0) return { layoutNodes: [], layoutLinks: [], viewW: 300, viewH: 200 };

    const W = 280;
    const layerCount = Math.max(...nodes.map((n) => n.layer)) + 1;
    const layerGap = layerCount > 1 ? (W - NODE_WIDTH) / (layerCount - 1) : 0;

    // Group nodes by layer
    const layers: SankeyNode[][] = Array.from({ length: layerCount }, () => []);
    for (const node of nodes) {
      layers[node.layer].push(node);
    }

    // Sort each layer by value desc
    for (const layer of layers) {
      layer.sort((a, b) => b.value - a.value);
    }

    // Compute max total value per layer for scaling
    const layerTotals = layers.map((l) => l.reduce((s, n) => s + n.value, 0));
    const maxTotal = Math.max(...layerTotals, 1);

    // Scale factor: map maxTotal to available height
    const maxH = 350;
    const scale = maxH / maxTotal;

    // Position nodes
    const positioned = new Map<string, LayoutNode>();
    let globalMaxY = 0;

    for (let li = 0; li < layers.length; li++) {
      const x = li * layerGap;
      let y = 20; // top padding for layer label
      for (const node of layers[li]) {
        const h = Math.max(4, node.value * scale);
        positioned.set(node.id, { ...node, x, y, h });
        y += h + VERTICAL_GAP;
      }
      globalMaxY = Math.max(globalMaxY, y);
    }

    // Build layout links with stacked offsets
    const lLinks: LayoutLink[] = [];
    // Track how much vertical space has been used on source/target sides
    const srcOffset = new Map<string, number>();
    const tgtOffset = new Map<string, number>();

    for (const link of links) {
      const src = positioned.get(link.source);
      const tgt = positioned.get(link.target);
      if (!src || !tgt) continue;

      // Compute link heights proportional to the node
      const srcTotal = src.value > 0 ? src.value : links.filter((l) => l.source === src.id).length;
      const tgtTotal = tgt.value > 0 ? tgt.value : links.filter((l) => l.target === tgt.id).length;
      const sh = Math.max(2, (link.value / Math.max(srcTotal, 1)) * src.h);
      const th = Math.max(2, (link.value / Math.max(tgtTotal, 1)) * tgt.h);

      const sOff = srcOffset.get(src.id) ?? 0;
      const tOff = tgtOffset.get(tgt.id) ?? 0;

      lLinks.push({
        ...link,
        sx: src.x + NODE_WIDTH,
        sy: src.y + sOff,
        sh,
        tx: tgt.x,
        ty: tgt.y + tOff,
        th,
        color: src.color,
      });

      srcOffset.set(src.id, sOff + sh);
      tgtOffset.set(tgt.id, tOff + th);
    }

    return {
      layoutNodes: [...positioned.values()],
      layoutLinks: lLinks,
      viewW: W + 20,
      viewH: Math.max(globalMaxY + 20, 100),
    };
  }, [sankeyData]);

  if (sankeyData.nodes.length === 0) {
    return <div className="p-4 text-center text-gray-600 text-xs">No data yet.</div>;
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
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
        <span className="text-[10px] text-gray-500">
          {profileMetric === 'tokens' && !hasTokenData
            ? <span className="text-yellow-600" title="Hook sessions don't provide token data">no token data</span>
            : 'Shift+scroll zoom'}
        </span>
      </div>

      {/* Sankey diagram */}
      <div ref={containerRef} className="flex-1 overflow-auto p-1 cursor-grab" onWheel={handleWheel}>
        <svg
          viewBox={`0 0 ${viewW} ${viewH}`}
          className="w-full"
          style={{ minHeight: viewH * zoom, width: `${100 * zoom}%` }}
        >
          {/* Layer labels */}
          {LAYER_LABELS.map((label, i) => {
            const layerCount = Math.max(...sankeyData.nodes.map((n) => n.layer)) + 1;
            if (i >= layerCount) return null;
            const x = layerCount > 1 ? i * ((viewW - 20 - NODE_WIDTH) / (layerCount - 1)) + NODE_WIDTH / 2 : viewW / 2;
            return (
              <text
                key={label}
                x={x}
                y={12}
                textAnchor="middle"
                fill="#6b7280"
                fontSize={8}
                fontWeight={500}
              >
                {label}
              </text>
            );
          })}

          {/* Links */}
          {layoutLinks.map((link, i) => {
            const midX = (link.sx + link.tx) / 2;
            const d = `
              M ${link.sx} ${link.sy}
              C ${midX} ${link.sy}, ${midX} ${link.ty}, ${link.tx} ${link.ty}
              L ${link.tx} ${link.ty + link.th}
              C ${midX} ${link.ty + link.th}, ${midX} ${link.sy + link.sh}, ${link.sx} ${link.sy + link.sh}
              Z
            `;
            return (
              <path
                key={i}
                d={d}
                fill={link.color}
                opacity={0.25}
                className="sankey-link"
                onMouseEnter={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  const srcNode = layoutNodes.find((n) => n.id === link.source);
                  const tgtNode = layoutNodes.find((n) => n.id === link.target);
                  setTooltip({
                    x: rect.left + rect.width / 2,
                    y: rect.top,
                    text: [
                      `${srcNode?.label ?? '?'} → ${tgtNode?.label ?? '?'}`,
                      `${formatValue(link.value)}`,
                    ],
                  });
                }}
                onMouseLeave={() => setTooltip(null)}
              />
            );
          })}

          {/* Nodes */}
          {layoutNodes.map((node) => {
            const isSelected = selectedId === node.id;
            return (
              <g key={node.id}>
                <rect
                  x={node.x}
                  y={node.y}
                  width={NODE_WIDTH}
                  height={Math.max(node.h, 4)}
                  rx={2}
                  fill={node.color}
                  opacity={isSelected ? 1 : 0.8}
                  stroke="none"
                  className="cursor-pointer"
                  onClick={() => onSelect(node.id)}
                  onMouseEnter={(e) => {
                    const rect = e.currentTarget.getBoundingClientRect();
                    setTooltip({
                      x: rect.right + 4,
                      y: rect.top,
                      text: [node.label, `${formatValue(node.value)}`],
                    });
                  }}
                  onMouseLeave={() => setTooltip(null)}
                />
                {isSelected && (
                  <rect
                    x={node.x}
                    y={node.y}
                    width={NODE_WIDTH}
                    height={Math.max(node.h, 4)}
                    rx={2}
                    className="selected-outline"
                  />
                )}
                {/* Label to the right for layers 0-2, left for layer 3 */}
                {node.h >= 10 && (
                  <text
                    x={node.layer < 3 ? node.x + NODE_WIDTH + 3 : node.x - 3}
                    y={node.y + node.h / 2 + 3}
                    textAnchor={node.layer < 3 ? 'start' : 'end'}
                    fill="#9ca3af"
                    fontSize={8}
                    className="pointer-events-none"
                  >
                    {node.label.length > 12 ? node.label.slice(0, 12) + '..' : node.label}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </div>

      {/* Tooltip */}
      {tooltip && (
        <div
          className="fixed z-50 px-2 py-1.5 bg-gray-900 border border-gray-700 rounded text-[10px] text-gray-300 shadow-lg pointer-events-none space-y-0.5"
          style={{ left: tooltip.x, top: tooltip.y }}
        >
          {tooltip.text.map((line, i) => (
            <div key={i} className={i === 0 ? 'font-medium text-gray-100' : ''}>{line}</div>
          ))}
        </div>
      )}
    </div>
  );
}
