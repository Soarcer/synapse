// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bernhard

import { Tooltip } from '../ui/Tooltip';

export function EdgeCostLegend() {
  return (
    <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-10 flex items-center gap-3 px-3 py-1.5 bg-gray-900/90 border border-gray-700/60 rounded-lg backdrop-blur-sm text-[10px] text-gray-400 edge-cost-badge">
      <span className="text-gray-500">Edge cost:</span>
      <div className="flex items-center gap-1.5">
        <Tooltip content="Minimal token transfer between agents">
          <span style={{ color: 'hsl(220, 70%, 50%)' }}>low</span>
        </Tooltip>
        <div
          className="w-16 h-1.5 rounded-full"
          style={{
            background:
              'linear-gradient(to right, hsl(220, 70%, 50%), hsl(110, 70%, 50%), hsl(40, 70%, 50%), hsl(0, 70%, 50%))',
          }}
        />
        <Tooltip content="Large token transfer between agents">
          <span style={{ color: 'hsl(0, 70%, 50%)' }}>high</span>
        </Tooltip>
      </div>
      <span className="text-gray-600">|</span>
      <div className="flex items-center gap-1">
        <div className="w-4 h-px" style={{ background: 'hsl(220, 70%, 50%)' }} />
        <span>thin</span>
        <span className="text-gray-600 mx-0.5">{'\u2192'}</span>
        <div className="w-4 h-[3px]" style={{ background: 'hsl(0, 70%, 50%)' }} />
        <span>thick</span>
      </div>
    </div>
  );
}
