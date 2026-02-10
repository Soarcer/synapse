import { useState, useMemo, useRef, useEffect } from 'react';
import { useLens, type HeatmapCell } from '../LensContext';
import { useAgentStore } from '../../../store/agentStore';
import { formatTokens } from '../../../utils/format';

const CELL_SIZE = 18;
const LABEL_WIDTH = 80;
const AXIS_HEIGHT = 20;

/** Interpolate from dark gray to bright green based on 0-1 intensity */
function heatColor(intensity: number): string {
  if (intensity === 0) return '#1a1f2b';
  const r = Math.round(20 + intensity * 100);
  const g = Math.round(40 + intensity * 200);
  const b = Math.round(30 + intensity * 40);
  return `rgb(${r}, ${g}, ${b})`;
}

/** Interpolate from dark gray to bright cyan for token heatmap */
function tokenHeatColor(intensity: number): string {
  if (intensity === 0) return '#1a1f2b';
  const r = Math.round(15 + intensity * 40);
  const g = Math.round(30 + intensity * 160);
  const b = Math.round(60 + intensity * 195);
  return `rgb(${r}, ${g}, ${b})`;
}

export function HeatmapView() {
  const { heatmapData, selectedId, onSelect } = useLens();
  const setMultiHighlight = useAgentStore((s) => s.setMultiHighlight);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to the cell containing the selected node
  useEffect(() => {
    if (!selectedId || !scrollRef.current) return;
    const cell = scrollRef.current.querySelector(`[data-node-id="${selectedId}"]`);
    if (cell) cell.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [selectedId]);

  const [tooltip, setTooltip] = useState<{
    x: number;
    y: number;
    action: string;
    bucket: string;
    count: number;
    tokens?: number;
  } | null>(null);
  const [selectedCell, setSelectedCell] = useState<{ row: number; col: number } | null>(null);

  const { actions, bucketLabels, grid, maxCount, tokenGrid, maxTokens } = heatmapData;

  // Show every Nth tick label to avoid overlap
  const tickInterval = useMemo(() => {
    if (bucketLabels.length <= 10) return 1;
    if (bucketLabels.length <= 20) return 4;
    return 5;
  }, [bucketLabels.length]);

  if (actions.length === 0) {
    return (
      <div className="p-4 text-center text-gray-600 text-xs">
        No data yet.
      </div>
    );
  }

  const gridWidth = bucketLabels.length * CELL_SIZE;

  const timeAxis = (
    <div className="flex" style={{ height: AXIS_HEIGHT }}>
      <div className="flex-shrink-0" style={{ width: LABEL_WIDTH }} />
      <div className="relative" style={{ width: gridWidth }}>
        {bucketLabels.map((label, i) =>
          i % tickInterval === 0 ? (
            <span
              key={i}
              className="absolute text-[8px] text-gray-600 font-mono"
              style={{
                left: i * CELL_SIZE + CELL_SIZE / 2,
                transform: 'translateX(-50%)',
                top: 4,
              }}
            >
              {label}
            </span>
          ) : null,
        )}
      </div>
    </div>
  );

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header — frequency */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-gray-800 flex-shrink-0">
        <span className="text-[10px] text-gray-500 font-medium">Action frequency over time</span>
        <div className="flex items-center gap-1">
          <div className="w-8 h-2 rounded-sm" style={{ background: 'linear-gradient(to right, #1a1f2b, #14b87a)' }} />
          <span className="text-[9px] text-gray-600 font-mono">0-{maxCount}</span>
        </div>
      </div>

      {/* Scrollable content */}
      <div ref={scrollRef} className="flex-1 overflow-auto">
        <div style={{ minWidth: LABEL_WIDTH + gridWidth + 8 }}>
          {/* Time axis */}
          {timeAxis}

          {/* Frequency rows */}
          {actions.map((action, rowIdx) => (
            <div key={action} className="flex" style={{ height: CELL_SIZE }}>
              <div
                className="flex-shrink-0 flex items-center px-1 text-[9px] text-gray-400 truncate"
                style={{ width: LABEL_WIDTH }}
                title={action}
              >
                {action}
              </div>
              <div className="flex">
                {grid[rowIdx].map((cell, colIdx) => {
                  const intensity = maxCount > 0 ? cell.count / maxCount : 0;
                  const isCellSelected = selectedCell?.row === rowIdx && selectedCell?.col === colIdx;
                  const hasSelectedNode = cell.ids.some((id) => id === selectedId);
                  return (
                    <div
                      key={colIdx}
                      data-node-id={cell.ids[0] ?? undefined}
                      className={`heatmap-cell rounded-[2px] transition-colors flex items-center justify-center cursor-pointer ${
                        isCellSelected || hasSelectedNode ? 'heatmap-cell-selected' : ''
                      }`}
                      style={{
                        width: CELL_SIZE - 1,
                        height: CELL_SIZE - 1,
                        margin: '0 0.5px 0.5px 0',
                        backgroundColor: heatColor(intensity),
                      }}
                      onClick={() => {
                        if (cell.ids.length > 0) {
                          setSelectedCell({ row: rowIdx, col: colIdx });
                          setMultiHighlight(new Set(cell.ids));
                          onSelect(cell.ids[0]);
                        }
                      }}
                      onMouseEnter={(e) => {
                        const rect = e.currentTarget.getBoundingClientRect();
                        setTooltip({
                          x: rect.left + rect.width / 2,
                          y: rect.top - 4,
                          action,
                          bucket: bucketLabels[colIdx],
                          count: cell.count,
                        });
                      }}
                      onMouseLeave={() => setTooltip(null)}
                    >
                      {cell.count > 0 && (
                        <span
                          className="text-[7px] font-mono leading-none"
                          style={{ color: intensity > 0.5 ? 'rgba(0,0,0,0.5)' : 'rgba(255,255,255,0.4)' }}
                        >
                          {cell.count}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}

          {/* Token usage heatmap */}
          {maxTokens > 0 && (
            <>
              <div className="flex items-center justify-between px-3 py-1.5 mt-2 border-t border-b border-gray-800">
                <span className="text-[10px] text-gray-500 font-medium">Token usage over time</span>
                <div className="flex items-center gap-1">
                  <div className="w-8 h-2 rounded-sm" style={{ background: 'linear-gradient(to right, #1a1f2b, #28a0ff)' }} />
                  <span className="text-[9px] text-gray-600 font-mono">0-{formatTokens(maxTokens)}</span>
                </div>
              </div>

              {timeAxis}

              {actions.map((action, rowIdx) => (
                <div key={`tok-${action}`} className="flex" style={{ height: CELL_SIZE }}>
                  <div
                    className="flex-shrink-0 flex items-center px-1 text-[9px] text-gray-400 truncate"
                    style={{ width: LABEL_WIDTH }}
                    title={action}
                  >
                    {action}
                  </div>
                  <div className="flex">
                    {tokenGrid[rowIdx].map((tokens, colIdx) => {
                      const intensity = maxTokens > 0 ? tokens / maxTokens : 0;
                      return (
                        <div
                          key={colIdx}
                          className="rounded-[2px] transition-colors flex items-center justify-center cursor-pointer"
                          style={{
                            width: CELL_SIZE - 1,
                            height: CELL_SIZE - 1,
                            margin: '0 0.5px 0.5px 0',
                            backgroundColor: tokenHeatColor(intensity),
                          }}
                          onClick={() => {
                            const cell = grid[rowIdx][colIdx];
                            if (cell.ids.length > 0) {
                              setSelectedCell({ row: rowIdx, col: colIdx });
                              setMultiHighlight(new Set(cell.ids));
                              onSelect(cell.ids[0]);
                            }
                          }}
                          onMouseEnter={(e) => {
                            const rect = e.currentTarget.getBoundingClientRect();
                            setTooltip({
                              x: rect.left + rect.width / 2,
                              y: rect.top - 4,
                              action,
                              bucket: bucketLabels[colIdx],
                              count: grid[rowIdx][colIdx].count,
                              tokens,
                            });
                          }}
                          onMouseLeave={() => setTooltip(null)}
                        >
                          {tokens > 0 && (
                            <span
                              className="text-[7px] font-mono leading-none"
                              style={{ color: intensity > 0.5 ? 'rgba(0,0,0,0.5)' : 'rgba(255,255,255,0.4)' }}
                            >
                              {formatTokens(tokens)}
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </>
          )}
        </div>
      </div>

      {/* Tooltip */}
      {tooltip && (
        <div
          className="fixed z-50 px-2 py-1.5 bg-gray-900 border border-gray-700 rounded text-[10px] text-gray-300 shadow-lg pointer-events-none space-y-0.5"
          style={{ left: tooltip.x, top: tooltip.y, transform: 'translate(-50%, -100%)' }}
        >
          <div className="font-medium text-gray-100">{tooltip.action}</div>
          <div>Time: {tooltip.bucket}</div>
          <div>Count: {tooltip.count}</div>
          {tooltip.tokens != null && tooltip.tokens > 0 && (
            <div>Tokens: {formatTokens(tooltip.tokens)}</div>
          )}
        </div>
      )}
    </div>
  );
}
