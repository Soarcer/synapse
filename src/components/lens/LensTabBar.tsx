import { useLens } from './LensContext';

import type { LensTab } from './LensContext';

const TABS: { key: LensTab; label: string }[] = [
  { key: 'tree', label: 'Tree' },
  { key: 'heatmap', label: 'Heat' },
  { key: 'treemap', label: 'TMap' },
  { key: 'sankey', label: 'Flow' },
  { key: 'compaction', label: 'Comp' },
  { key: 'cost', label: 'Cost' },
];

export function LensTabBar() {
  const { activeTab, onTabChange, statusCounts, onSpawnClick } = useLens();

  const total = statusCounts.running + statusCounts.success + statusCounts.error + statusCounts.stopped;

  return (
    <div className="flex-shrink-0">
      {/* Tab buttons + spawn */}
      <div className="flex flex-wrap items-center gap-1 px-2 py-1.5 border-b border-gray-800">
        {TABS.map((tab) => (
          <button
            key={tab.key}
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
        ))}
        <button
          onClick={onSpawnClick}
          className="px-2 py-1 bg-blue-600 hover:bg-blue-500 rounded text-[11px] text-white font-medium transition-colors ml-auto"
          title="Spawn Agent (N)"
        >
          +
        </button>
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
