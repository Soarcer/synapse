import type { MockTurn } from '../mockData';

interface MiniTimelineProps {
  turns: MockTurn[];
  onClickTurn: (turnIndex: number) => void;
  selectedTurn: number | null;
}

const BAR_COUNT = 30;

export function MiniTimeline({ turns, onClickTurn, selectedTurn }: MiniTimelineProps) {
  if (turns.length === 0) return null;

  const minTs = turns[0].timestamp;
  const maxTs = turns[turns.length - 1].timestamp;
  const range = Math.max(maxTs - minTs, 1);

  // Bucket turns into BAR_COUNT time slots
  const buckets: { tools: number; errors: number; compactions: number; turnIndices: number[] }[] =
    Array.from({ length: BAR_COUNT }, () => ({ tools: 0, errors: 0, compactions: 0, turnIndices: [] }));

  for (const t of turns) {
    const idx = Math.min(Math.floor(((t.timestamp - minTs) / range) * BAR_COUNT), BAR_COUNT - 1);
    buckets[idx].tools += t.toolCount;
    if (t.compactionBefore) buckets[idx].compactions++;
    buckets[idx].turnIndices.push(t.turnIndex);
  }

  const maxHeight = Math.max(1, ...buckets.map((b) => b.tools + b.compactions));
  const barWidth = 100 / BAR_COUNT;

  return (
    <div className="px-3 py-2 border-b border-gray-800 bg-[#0d1117]">
      <div className="text-[10px] text-gray-600 mb-1">Activity Timeline</div>
      <svg viewBox="0 0 100 20" className="w-full h-5" preserveAspectRatio="none">
        {buckets.map((b, i) => {
          const height = Math.max(0.5, (b.tools / maxHeight) * 18);
          const isSelected = b.turnIndices.some((idx) => idx === selectedTurn);
          const hasCompaction = b.compactions > 0;

          return (
            <g key={i}>
              <rect
                x={i * barWidth + barWidth * 0.1}
                y={20 - height}
                width={barWidth * 0.8}
                height={height}
                rx={0.3}
                fill={hasCompaction ? '#f59e0b' : '#3b82f6'}
                opacity={isSelected ? 1 : 0.6}
                className="cursor-pointer hover:opacity-100 transition-opacity"
                onClick={() => {
                  if (b.turnIndices.length > 0) onClickTurn(b.turnIndices[0]);
                }}
              />
              {isSelected && (
                <rect
                  x={i * barWidth}
                  y={0}
                  width={barWidth}
                  height={20}
                  fill="#3b82f6"
                  opacity={0.1}
                />
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
