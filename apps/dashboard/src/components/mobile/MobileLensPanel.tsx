// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bernhard

import { useLens } from '../lens/LensContext';
import type { LensTab } from '../lens/LensContext';
import { TreeView } from '../lens/tree/TreeView';
import { HeatmapView } from '../lens/heatmap/HeatmapView';
import { TreemapView } from '../lens/treemap/TreemapView';
import { SankeyView } from '../lens/sankey/SankeyView';
import { CompactionView } from '../lens/compaction/CompactionView';
import { CostWaterfallView } from '../lens/cost/CostWaterfallView';
import { PinchZoomWrapper } from './PinchZoomWrapper';

const LENS_OPTIONS: Array<{ value: LensTab; label: string }> = [
  { value: 'treemap', label: 'Treemap' },
  { value: 'heatmap', label: 'Heatmap' },
  { value: 'compaction', label: 'Compaction' },
  { value: 'cost', label: 'Cost Waterfall' },
  { value: 'sankey', label: 'Sankey' },
  { value: 'tree', label: 'Tree' },
];

export function MobileLensPanel() {
  const { activeTab, onTabChange, searchQuery, onSearchChange } = useLens();

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-[#161b22]">
      {/* Dropdown selector + optional search */}
      <div className="px-3 py-2 border-b border-gray-800 flex-shrink-0 flex gap-2">
        <select
          value={activeTab}
          onChange={(e) => onTabChange(e.target.value as LensTab)}
          className="flex-1 bg-gray-900 border border-gray-700 rounded-lg px-2 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-blue-500 appearance-none"
        >
          {LENS_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        {activeTab === 'tree' && (
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Filter..."
            className="flex-1 bg-gray-900 border border-gray-700 rounded-lg px-2 py-1.5 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-blue-500"
          />
        )}
      </div>

      {/* Active lens view — full width, pinch-to-zoom on mobile */}
      <PinchZoomWrapper className="flex-1">
        {activeTab === 'tree' && <TreeView />}
        {activeTab === 'heatmap' && <HeatmapView />}
        {activeTab === 'treemap' && <TreemapView />}
        {activeTab === 'sankey' && <SankeyView />}
        {activeTab === 'compaction' && <CompactionView />}
        {activeTab === 'cost' && <CostWaterfallView />}
      </PinchZoomWrapper>
    </div>
  );
}
