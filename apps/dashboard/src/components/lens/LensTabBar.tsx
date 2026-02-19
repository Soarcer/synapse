import { useLens } from './LensContext';
import { Tooltip } from '../ui/Tooltip';

import type { LensTab } from './LensContext';

const TABS: { key: LensTab; label: string; fullName: string; shortcut: string }[] = [
  { key: 'treemap', label: 'TMap', fullName: 'Cost and token area treemap', shortcut: '1' },
  { key: 'heatmap', label: 'Heat', fullName: 'Tool call frequency heatmap', shortcut: '2' },
  { key: 'compaction', label: 'Comp', fullName: 'Context compaction timeline', shortcut: '3' },
  { key: 'cost', label: 'Cost', fullName: 'Per-turn cost waterfall', shortcut: '4' },
  { key: 'sankey', label: 'Flow', fullName: 'Token flow Sankey diagram', shortcut: '5' },
  { key: 'tree', label: 'Tree', fullName: 'Hierarchical session tree', shortcut: '6' },
];

export function LensTabBar() {
  const { activeTab, onTabChange, statusCounts, onSpawnClick } = useLens();

  const total = statusCounts.running + statusCounts.success + statusCounts.error + statusCounts.stopped;

  return (
    <div className="flex-shrink-0">
      {/* Tab buttons + spawn */}
      <div className="flex flex-wrap items-center gap-1 px-2 py-1.5 border-b border-gray-800">
        {TABS.map((tab) => (
          <Tooltip key={tab.key} content={tab.fullName} shortcut={tab.shortcut}>
            <button
              onClick={() => onTabChange(tab.key)}
              className={`
                px-2 py-1 rounded text-[11px] font-medium transition-colors
                ${activeTab === tab.key
                  ? 'bg-gray-800 text-gray-100'
                  : 'text-gray-500 hover:text-gray-300 hover:bg-gray-800/50'}
              `}
            >
              {tab.label}
            </button>
          </Tooltip>
        ))}
        <Tooltip content="Spawn Agent" shortcut="N">
          <button
            onClick={onSpawnClick}
            className="px-2 py-1 bg-blue-600 hover:bg-blue-500 rounded text-[11px] text-white font-medium transition-colors ml-auto"
          >
            +
          </button>
        </Tooltip>
      </div>

      {/* Status strip */}
      {total > 0 && (
        <div className="flex h-0.5">
          {statusCounts.running > 0 && (
            <div
              className="bg-green-400"
              style={{ width: `${(statusCounts.running / total) * 100}%` }}
            />
          )}
          {statusCounts.success > 0 && (
            <div
              className="bg-gray-500"
              style={{ width: `${(statusCounts.success / total) * 100}%` }}
            />
          )}
          {statusCounts.error > 0 && (
            <div
              className="bg-red-400"
              style={{ width: `${(statusCounts.error / total) * 100}%` }}
            />
          )}
          {statusCounts.stopped > 0 && (
            <div
              className="bg-yellow-400"
              style={{ width: `${(statusCounts.stopped / total) * 100}%` }}
            />
          )}
        </div>
      )}
    </div>
  );
}
