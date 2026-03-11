// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bernhard

import { useLens } from './LensContext';
import { LensTabBar } from './LensTabBar';
import { LensBreadcrumb } from './LensBreadcrumb';
import { LensResizeHandle } from './LensResizeHandle';
import { TreeView } from './tree/TreeView';
import { HeatmapView } from './heatmap/HeatmapView';
import { TreemapView } from './treemap/TreemapView';
import { SankeyView } from './sankey/SankeyView';
import { CompactionView } from './compaction/CompactionView';
import { CostWaterfallView } from './cost/CostWaterfallView';
import { AlertsView } from '../../features/notifications/AlertsView'; // [notifications]

interface LensPanelProps {
  width?: number;
  onWidthChange?: (w: number) => void;
  fillWidth?: boolean;
}

export function LensPanel({ width, onWidthChange, fillWidth }: LensPanelProps) {
  const { activeTab, searchQuery, onSearchChange } = useLens();

  return (
    <aside
      className={`bg-[#161b22] border-r border-gray-800 h-full flex flex-col relative overflow-hidden ${fillWidth ? 'flex-1' : 'flex-shrink-0'}`}
      style={fillWidth ? undefined : { width }}
    >
      {!fillWidth && onWidthChange && (
        <LensResizeHandle width={width ?? 320} onWidthChange={onWidthChange} />
      )}
      <LensTabBar />

      {/* Search input (Tree tab only) */}
      {activeTab === 'tree' && (
        <div className="px-2 py-1.5 border-b border-gray-800 flex-shrink-0">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Filter..."
            className="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1 text-xs text-gray-200 placeholder-gray-600 focus:outline-none focus:border-blue-500"
          />
        </div>
      )}

      {/* Active view */}
      <div className="flex-1 overflow-hidden">
        {activeTab === 'tree' && <TreeView />}
        {activeTab === 'heatmap' && <HeatmapView />}
        {activeTab === 'treemap' && <TreemapView />}
        {activeTab === 'sankey' && <SankeyView />}
        {activeTab === 'compaction' && <CompactionView />}
        {activeTab === 'cost' && <CostWaterfallView />}
        {activeTab === 'alerts' && <AlertsView />} {/* [notifications] */}
      </div>

      <LensBreadcrumb />
    </aside>
  );
}
