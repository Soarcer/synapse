import { useMemo } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from 'recharts';
import type { MockData } from '../mockData';

interface ToolChainViewProps {
  data: MockData;
}

const TOOL_COLORS: Record<string, string> = {
  Read: '#3b82f6', Write: '#22c55e', Edit: '#a855f7', Bash: '#f97316',
  Grep: '#06b6d4', Glob: '#eab308', Task: '#ef4444', WebFetch: '#ec4899',
  WebSearch: '#8b5cf6', TodoWrite: '#14b8a6', NotebookEdit: '#f43f5e',
};

export function ToolChainView({ data }: ToolChainViewProps) {
  // Tool co-occurrence matrix
  const coOccurrence = useMemo(() => {
    const toolSet = new Set<string>();
    const pairCounts = new Map<string, number>();

    for (const turn of data.turns) {
      const tools = [...new Set(turn.toolNames)];
      for (const t of tools) toolSet.add(t);
      for (let i = 0; i < tools.length; i++) {
        for (let j = i + 1; j < tools.length; j++) {
          const key = [tools[i], tools[j]].sort().join('→');
          pairCounts.set(key, (pairCounts.get(key) || 0) + 1);
        }
      }
    }

    const allTools = [...toolSet].sort();
    const matrix: { tool1: string; tool2: string; count: number }[] = [];
    for (const [key, count] of pairCounts) {
      const [tool1, tool2] = key.split('→');
      matrix.push({ tool1, tool2, count });
    }
    matrix.sort((a, b) => b.count - a.count);

    return { allTools, matrix: matrix.slice(0, 20) };
  }, [data.turns]);

  // Common tool sequences (consecutive tools within turns)
  const sequences = useMemo(() => {
    const seqCounts = new Map<string, number>();
    for (const turn of data.turns) {
      if (turn.toolNames.length < 2) continue;
      for (let i = 0; i < turn.toolNames.length - 1; i++) {
        const seq = `${turn.toolNames[i]} → ${turn.toolNames[i + 1]}`;
        seqCounts.set(seq, (seqCounts.get(seq) || 0) + 1);
      }
    }
    return [...seqCounts.entries()]
      .map(([seq, count]) => ({ sequence: seq, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 15);
  }, [data.turns]);

  // Tool error hotspots
  const errorHotspots = useMemo(() => {
    const errorMap = new Map<string, { errors: number; total: number }>();
    for (const tc of data.toolCalls) {
      const entry = errorMap.get(tc.toolName) || { errors: 0, total: 0 };
      entry.total++;
      if (tc.status === 'error') entry.errors++;
      errorMap.set(tc.toolName, entry);
    }
    return [...errorMap.entries()]
      .map(([name, stats]) => ({
        name,
        errorRate: stats.total > 0 ? Math.round((stats.errors / stats.total) * 100) : 0,
        errors: stats.errors,
        total: stats.total,
      }))
      .filter((e) => e.errors > 0)
      .sort((a, b) => b.errorRate - a.errorRate);
  }, [data.toolCalls]);

  return (
    <div className="max-w-[1400px] mx-auto p-4 space-y-4">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Co-occurrence Matrix (visual) */}
        <div className="bg-[#161b22] border border-gray-800 rounded-xl p-4">
          <h4 className="text-xs font-medium text-gray-400 mb-3">Tool Co-occurrence (Top Pairs)</h4>
          <div className="space-y-1.5">
            {coOccurrence.matrix.slice(0, 12).map((pair, idx) => {
              const maxCount = coOccurrence.matrix[0]?.count || 1;
              const width = Math.max(10, (pair.count / maxCount) * 100);
              return (
                <div key={idx} className="flex items-center gap-2">
                  <div className="w-32 text-right text-[10px] text-gray-400 truncate">
                    <span style={{ color: TOOL_COLORS[pair.tool1] || '#8b949e' }}>{pair.tool1}</span>
                    <span className="text-gray-600 mx-1">+</span>
                    <span style={{ color: TOOL_COLORS[pair.tool2] || '#8b949e' }}>{pair.tool2}</span>
                  </div>
                  <div className="flex-1 h-4 bg-gray-800/50 rounded overflow-hidden">
                    <div
                      className="h-full rounded bg-gradient-to-r from-blue-500/60 to-purple-500/60"
                      style={{ width: `${width}%` }}
                    />
                  </div>
                  <span className="text-[10px] text-gray-500 w-6 text-right">{pair.count}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Common Tool Sequences */}
        <div className="bg-[#161b22] border border-gray-800 rounded-xl p-4">
          <h4 className="text-xs font-medium text-gray-400 mb-3">Common Tool Sequences</h4>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={sequences} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke="#21262d" />
              <XAxis type="number" tick={{ fill: '#8b949e', fontSize: 10 }} />
              <YAxis dataKey="sequence" type="category" width={120} tick={{ fill: '#8b949e', fontSize: 9 }} />
              <Tooltip
                contentStyle={{ backgroundColor: '#161b22', border: '1px solid #30363d', borderRadius: '8px', fontSize: '11px' }}
              />
              <Bar dataKey="count" fill="#6366f1" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Error Hotspots */}
      {errorHotspots.length > 0 && (
        <div className="bg-[#161b22] border border-gray-800 rounded-xl p-4">
          <h4 className="text-xs font-medium text-gray-400 mb-3">Tool Error Hotspots</h4>
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
            {errorHotspots.map((tool) => (
              <div key={tool.name} className="bg-[#0d1117] border border-gray-800 rounded-lg p-3">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-2 h-2 rounded-full" style={{ backgroundColor: TOOL_COLORS[tool.name] || '#6b7280' }} />
                  <span className="text-xs text-gray-300 font-medium">{tool.name}</span>
                </div>
                <div className="text-lg font-bold text-red-400">{tool.errorRate}%</div>
                <div className="text-[10px] text-gray-600">{tool.errors}/{tool.total} calls</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
