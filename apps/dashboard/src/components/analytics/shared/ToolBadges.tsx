// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bernhard

import { TOOL_COLORS } from './constants';

interface ToolBadgesProps {
  toolNames: string[];
  /** Optional per-tool counts keyed by tool name */
  toolCounts?: Record<string, number>;
  label?: string;
}

export function ToolBadges({ toolNames, toolCounts, label }: ToolBadgesProps) {
  if (toolNames.length === 0) return null;

  return (
    <div>
      {label && <div className="text-[10px] text-gray-500 mb-1">{label}</div>}
      <div className="flex flex-wrap gap-1">
        {toolNames.map((name, i) => {
          const count = toolCounts?.[name];
          return (
            <span
              key={i}
              className="px-1.5 py-0.5 rounded text-[10px] font-medium"
              style={{
                backgroundColor: `${TOOL_COLORS[name] ?? '#6b7280'}20`,
                color: TOOL_COLORS[name] ?? '#6b7280',
              }}
            >
              {name}
              {count != null && count > 1 ? ` \u00d7${count}` : ''}
            </span>
          );
        })}
      </div>
    </div>
  );
}
