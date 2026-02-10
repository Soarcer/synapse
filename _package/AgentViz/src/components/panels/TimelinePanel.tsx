import { useMemo, useRef, useState, useCallback } from 'react';
import { useAgentStore } from '../../store/agentStore';
import { getTypeColor, formatDuration } from '../../utils/format';

export function TimelinePanel() {
  const agents = useAgentStore((s) => s.agents);
  const selectNode = useAgentStore((s) => s.selectNode);
  const paletteIndex = useAgentStore((s) => s.paletteIndex);
  const [collapsed, setCollapsed] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);

  const agentList = useMemo(() => [...agents.values()], [agents]);

  // Compute time bounds
  const { minTime, maxTime } = useMemo(() => {
    if (agentList.length === 0) return { minTime: Date.now(), maxTime: Date.now() + 1000 };
    const times = agentList.flatMap((a) => [a.startTime, a.endTime ?? Date.now()]);
    return {
      minTime: Math.min(...times),
      maxTime: Math.max(...times),
    };
  }, [agentList]);

  const totalDuration = Math.max(maxTime - minTime, 1000);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    setZoom((prev) => Math.max(0.5, Math.min(5, prev + (e.deltaY > 0 ? -0.1 : 0.1))));
  }, []);

  if (agentList.length === 0) return null;

  return (
    <div className="border-t border-gray-800 bg-[#161b22]">
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="w-full flex items-center gap-2 px-4 py-2 text-xs text-gray-400 hover:text-gray-200 transition-colors"
      >
        <span>{collapsed ? '▸' : '▾'}</span>
        <span>Timeline</span>
        <span className="text-gray-600">({agentList.length} agents)</span>
      </button>

      {!collapsed && (
        <div
          ref={containerRef}
          className="px-4 pb-3 overflow-auto max-h-36"
          onWheel={handleWheel}
        >
          {/* Time axis */}
          <div className="relative h-4 mb-1" style={{ width: `${100 * zoom}%`, minWidth: '100%' }}>
            {[0, 0.25, 0.5, 0.75, 1].map((frac) => (
              <span
                key={frac}
                className="absolute text-[10px] text-gray-600 font-mono"
                style={{ left: `${frac * 100}%`, transform: 'translateX(-50%)' }}
              >
                {formatDuration(frac * totalDuration)}
              </span>
            ))}
          </div>

          {/* Agent bars */}
          <div className="space-y-1" style={{ width: `${100 * zoom}%`, minWidth: '100%' }}>
            {agentList.map((agent) => {
              const startPct = ((agent.startTime - minTime) / totalDuration) * 100;
              const endTime = agent.endTime ?? Date.now();
              const widthPct = Math.max(((endTime - agent.startTime) / totalDuration) * 100, 0.5);

              return (
                <div key={agent.agentId} className="relative h-6">
                  <button
                    onClick={() => selectNode(`agent-${agent.agentId}`)}
                    className="absolute h-full rounded-sm flex items-center px-1.5 text-[10px] text-white/80 truncate hover:brightness-125 transition-all"
                    style={{
                      left: `${startPct}%`,
                      width: `${widthPct}%`,
                      minWidth: '40px',
                      backgroundColor: getTypeColor(agent.agentType, paletteIndex),
                      opacity: agent.status === 'running' ? 1 : 0.7,
                    }}
                    title={`${agent.agentType} (${agent.status})`}
                  >
                    {agent.agentType}
                    {/* Tool markers */}
                    {agent.toolCalls.map((tc) => {
                      const tcOffset =
                        ((tc.startTime - agent.startTime) / Math.max(endTime - agent.startTime, 1)) * 100;
                      return (
                        <span
                          key={tc.toolUseId}
                          className="absolute top-0 w-px h-full bg-white/30"
                          style={{ left: `${tcOffset}%` }}
                        />
                      );
                    })}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
