import { useState, useMemo, useCallback } from 'react';
import { useLens, type ProfileBlock } from '../LensContext';
import { formatTokens, formatDuration, formatCount, KIND_ICONS, PALETTES } from '../../../utils/format';
import { useAgentStore } from '../../../store/agentStore';

export function ProfileView() {
  const { profileRoots, profileMetric, onProfileMetricChange, selectedId, onSelect, hasTokenData } = useLens();
  const paletteIndex = useAgentStore((s) => s.paletteIndex);
  const cyclePalette = useAgentStore((s) => s.cyclePalette);
  const [zoomRootId, setZoomRootId] = useState<string | null>(null);
  const [zoomScale, setZoomScale] = useState(1);

  // Find the zoomed-in root (or use all roots)
  const displayRoots = useMemo(() => {
    if (!zoomRootId) return profileRoots;
    function find(blocks: ProfileBlock[]): ProfileBlock | null {
      for (const b of blocks) {
        if (b.id === zoomRootId) return b;
        const found = find(b.children);
        if (found) return found;
      }
      return null;
    }
    const found = find(profileRoots);
    return found ? [{ ...found, proportion: 1 }] : profileRoots;
  }, [profileRoots, zoomRootId]);

  // Total value for display
  const totalValue = useMemo(
    () => profileRoots.reduce((sum, r) => sum + r.value, 0),
    [profileRoots],
  );

  // Ranked list: flatten and sort by value
  const ranked = useMemo(() => {
    const items: { id: string; label: string; kind: string; value: number; color: string }[] = [];
    function collect(blocks: ProfileBlock[]) {
      for (const b of blocks) {
        if (b.kind === 'agent' || b.kind === 'tool') {
          items.push({ id: b.id, label: b.label, kind: b.kind, value: b.value, color: b.color });
        }
        collect(b.children);
      }
    }
    collect(displayRoots);
    items.sort((a, b) => b.value - a.value);
    return items.slice(0, 10);
  }, [displayRoots]);

  const maxRankedValue = ranked.length > 0 ? ranked[0].value : 1;

  const formatValue = useCallback(
    (v: number) => profileMetric === 'tokens' ? formatTokens(v) : profileMetric === 'duration' ? formatDuration(v) : formatCount(v),
    [profileMetric],
  );

  if (profileRoots.length === 0) {
    return (
      <div className="p-4 text-center text-gray-600 text-xs">
        No data yet.
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header: metric toggle + total */}
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
        <div className="flex items-center gap-2">
          <button
            onClick={cyclePalette}
            className="px-1.5 py-0.5 rounded text-[9px] text-gray-500 hover:text-gray-200 hover:bg-gray-700 transition-colors"
            title={`Palette: ${PALETTES[paletteIndex].name} — click to cycle`}
          >
            {PALETTES[paletteIndex].name}
          </button>
          <span className="text-[10px] text-gray-500 font-mono">
            {profileMetric === 'tokens' && !hasTokenData
              ? <span className="text-yellow-600" title="Hook sessions don't provide token data">no data</span>
              : <>Total: {formatValue(totalValue)}</>}
          </span>
        </div>
      </div>

      {/* Zoom breadcrumb */}
      {zoomRootId && (
        <div className="flex items-center gap-1 px-3 py-1 border-b border-gray-800 flex-shrink-0">
          <button
            onClick={() => setZoomRootId(null)}
            className="text-[10px] text-blue-400 hover:text-blue-300 transition-colors"
          >
            &larr; Zoom out
          </button>
        </div>
      )}

      {/* Icicle chart */}
      <div
        className="flex-1 overflow-auto px-1 py-1"
        onWheel={(e) => {
          if (!e.shiftKey) return;
          e.preventDefault();
          e.stopPropagation();
          const factor = e.deltaY > 0 ? 0.9 : 1.1;
          setZoomScale((z) => Math.min(2, Math.max(0.6, z * factor)));
        }}
      >
        <IcicleLevels
          blocks={displayRoots}
          selectedId={selectedId}
          onSelect={onSelect}
          onZoom={setZoomRootId}
          rowHeight={Math.round(28 * zoomScale)}
          fontSize={Math.max(8, Math.round(9 * zoomScale))}
        />
      </div>

      {/* Ranked list */}
      {ranked.length > 0 && (
        <div className="flex-shrink-0 border-t border-gray-800 max-h-[40%] overflow-auto">
          <div className="px-3 py-1.5 text-[10px] text-gray-500 font-medium">
            Top consumers
          </div>
          {ranked.map((item, i) => (
            <button
              key={item.id}
              className={`
                w-full flex items-center gap-2 px-3 py-1 text-left text-[10px] transition-colors
                ${selectedId === item.id ? 'bg-blue-900/30 text-blue-200' : 'hover:bg-gray-800/50 text-gray-400'}
              `}
              onClick={() => onSelect(item.id)}
            >
              <span className="text-gray-600 w-3 text-right flex-shrink-0">{i + 1}</span>
              <span
                className="flex-shrink-0 text-[9px]"
                style={{ color: item.color }}
              >
                {KIND_ICONS[item.kind] ?? '\u2022'}
              </span>
              <span className="truncate flex-1 min-w-0">{item.label}</span>
              <div className="flex items-center gap-1.5 flex-shrink-0 ml-auto">
                <div className="w-12 h-1.5 bg-gray-800 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${(item.value / maxRankedValue) * 100}%`,
                      backgroundColor: item.color,
                      opacity: 0.7,
                    }}
                  />
                </div>
                <span className="font-mono text-gray-500 w-10 text-right">{formatValue(item.value)}</span>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Icicle chart renderer ───────────────────────────────────

function IcicleLevels({
  blocks,
  selectedId,
  onSelect,
  onZoom,
  rowHeight,
  fontSize,
}: {
  blocks: ProfileBlock[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onZoom: (id: string) => void;
  rowHeight: number;
  fontSize: number;
}) {
  if (blocks.length === 0) return null;

  const levelTotal = blocks.reduce((sum, b) => sum + b.value, 0);
  if (levelTotal === 0) return null;

  // Collect all children for the next level
  const nextLevel: ProfileBlock[] = [];
  for (const block of blocks) {
    nextLevel.push(...block.children);
  }

  return (
    <div className="space-y-px">
      {/* Current level */}
      <div className="flex gap-px" style={{ height: rowHeight }}>
        {blocks.map((block) => {
          const pct = (block.value / levelTotal) * 100;
          if (pct < 0.5) return null;
          const isSelected = selectedId === block.id;

          return (
            <button
              key={block.id}
              className={`
                icicle-block relative flex items-center px-1 overflow-hidden text-[9px] text-white/80 font-medium transition-all cursor-pointer rounded-sm
                ${isSelected ? 'selected' : ''}
              `}
              style={{
                width: `${pct}%`,
                minWidth: 2,
                backgroundColor: block.color,
                opacity: 0.85,
                fontSize,
              }}
              onClick={() => onSelect(block.id)}
              onDoubleClick={() => onZoom(block.id)}
              title={`${block.label} (${pct.toFixed(1)}%) — double-click to zoom`}
            >
              <span className="truncate">{pct > 8 ? block.label : ''}</span>
            </button>
          );
        })}
      </div>

      {/* Next level (recursive) */}
      {nextLevel.length > 0 && (
        <IcicleLevels
          blocks={nextLevel}
          selectedId={selectedId}
          onSelect={onSelect}
          onZoom={onZoom}
          rowHeight={rowHeight}
          fontSize={fontSize}
        />
      )}
    </div>
  );
}
