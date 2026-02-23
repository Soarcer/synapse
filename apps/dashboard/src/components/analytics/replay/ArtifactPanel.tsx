// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Synapse Contributors

import { useMemo, useState } from 'react';
import type { MockTurn } from '../mockData';

interface ArtifactPanelProps {
  turns: MockTurn[];
}

export function ArtifactPanel({ turns }: ArtifactPanelProps) {
  const [collapsed, setCollapsed] = useState(true);

  const artifacts = useMemo(() => {
    const files = new Set<string>();
    const toolMap = new Map<string, number>();
    const errors = 0;
    let compactions = 0;
    let totalThinking = 0;

    for (const t of turns) {
      if (t.compactionBefore) compactions++;
      totalThinking += t.thinkingTokens;

      for (const name of t.toolNames) {
        toolMap.set(name, (toolMap.get(name) ?? 0) + 1);

        // Extract file paths from common tool patterns
        if (['Read', 'Write', 'Edit', 'Glob'].includes(name) && t.promptText) {
          const pathMatches = t.promptText.match(/[\w/\\.-]+\.\w{1,6}/g);
          if (pathMatches) pathMatches.forEach((p) => files.add(p));
        }
      }
    }

    const topTools = [...toolMap.entries()].sort(([, a], [, b]) => b - a).slice(0, 8);

    return { files: [...files], topTools, errors, compactions, totalThinking };
  }, [turns]);

  if (turns.length === 0) return null;

  return (
    <div className="bg-[#161b22] border border-gray-800 rounded-xl overflow-hidden">
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="w-full px-4 py-2.5 flex items-center justify-between text-xs font-medium text-gray-400 hover:text-gray-300 transition-colors"
      >
        <span>Session Artifacts</span>
        <span className="text-[10px]">{collapsed ? '\u25BC' : '\u25B2'}</span>
      </button>

      {!collapsed && (
        <div className="px-4 pb-3 space-y-3">
          {/* Tool breakdown */}
          <div>
            <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-1.5">
              Tool Usage
            </div>
            <div className="flex flex-wrap gap-1.5">
              {artifacts.topTools.map(([name, count]) => (
                <span
                  key={name}
                  className="px-2 py-0.5 bg-[#0d1117] border border-gray-800 rounded text-[10px] text-gray-400"
                >
                  {name} <span className="text-gray-600">{count}x</span>
                </span>
              ))}
            </div>
          </div>

          {/* Files touched */}
          {artifacts.files.length > 0 && (
            <div>
              <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-1.5">
                Files Referenced ({artifacts.files.length})
              </div>
              <div className="max-h-24 overflow-y-auto space-y-0.5">
                {artifacts.files.slice(0, 15).map((f) => (
                  <div key={f} className="text-[10px] text-gray-400 font-mono truncate">
                    {f}
                  </div>
                ))}
                {artifacts.files.length > 15 && (
                  <div className="text-[10px] text-gray-600">
                    +{artifacts.files.length - 15} more
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Session metrics */}
          <div className="grid grid-cols-3 gap-2 pt-2 border-t border-gray-800">
            <div className="text-center">
              <div className="text-[10px] text-gray-600">Compactions</div>
              <div
                className={`text-xs font-medium ${artifacts.compactions > 0 ? 'text-yellow-400' : 'text-gray-400'}`}
              >
                {artifacts.compactions}
              </div>
            </div>
            <div className="text-center">
              <div className="text-[10px] text-gray-600">Thinking</div>
              <div className="text-xs font-medium text-purple-400">
                {artifacts.totalThinking > 0
                  ? `${(artifacts.totalThinking / 1000).toFixed(1)}k`
                  : '0'}
              </div>
            </div>
            <div className="text-center">
              <div className="text-[10px] text-gray-600">Unique Tools</div>
              <div className="text-xs font-medium text-blue-400">{artifacts.topTools.length}</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
