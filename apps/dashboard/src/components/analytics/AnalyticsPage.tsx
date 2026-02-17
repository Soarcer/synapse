import { useState, useMemo } from 'react';
import { useAnalyticsData, type AnalyticsFilters } from './useAnalyticsData';
import type { MockData } from './mockData';
import { ExecutiveOverview } from './executive/ExecutiveOverview';
import { SessionReplay } from './replay/SessionReplay';
import { PromptAnalyzer } from './prompts/PromptAnalyzer';
import { InsightsView } from './insights/InsightsView';
import { LiveNudgesView } from './nudges/LiveNudgesView';
import { ExportDialog } from './export/ExportDialog';
import { TimeRangeSelector } from './shared/TimeRangeSelector';

type AnalyticsTab = 'executive' | 'replay' | 'prompts' | 'insights' | 'nudges';

const TABS: { id: AnalyticsTab; label: string; description: string }[] = [
  { id: 'executive', label: 'Executive', description: 'KPI overview with sparklines' },
  { id: 'replay', label: 'Session Replay', description: 'Per-session timeline narrative' },
  { id: 'prompts', label: 'Prompts', description: 'Prompt complexity analysis' },
  { id: 'insights', label: 'Insights', description: 'AI coach, badges & budget' },
  { id: 'nudges', label: 'Live Nudges', description: 'Real-time coaching & nudge config' },
];

export function AnalyticsPage() {
  const [activeTab, setActiveTab] = useState<AnalyticsTab>('executive');
  const [timeRange, setTimeRange] = useState('7d');
  const [showExport, setShowExport] = useState(false);

  const filters: AnalyticsFilters = useMemo(() => ({ timeRange }), [timeRange]);
  const analytics = useAnalyticsData(filters);

  // Adapt analytics data to MockData shape for existing prototype components
  const mockData: MockData = useMemo(() => ({
    sessions: analytics.sessions,
    turns: analytics.turns,
    toolCalls: analytics.toolCalls,
    dailyRollups: analytics.dailyRollups,
    timeRange: {
      start: analytics.timeseries.length > 0 ? analytics.timeseries[0].timestamp : Date.now() - 7 * 86_400_000,
      end: analytics.timeseries.length > 0 ? analytics.timeseries[analytics.timeseries.length - 1].timestamp : Date.now(),
    },
  }), [analytics.sessions, analytics.turns, analytics.toolCalls, analytics.dailyRollups, analytics.timeseries]);

  return (
    <div className="h-full flex flex-col overflow-hidden bg-[#0d1117]">
      {/* Page header */}
      <div className="flex-shrink-0 border-b border-gray-800 bg-[#0d1117]/95 backdrop-blur-sm">
        <div className="max-w-[1400px] mx-auto px-4 py-3">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h1 className="text-lg font-semibold text-gray-100 tracking-tight">Analytics</h1>
              <p className="text-xs text-gray-500 mt-0.5">AI coding assistant usage reporting</p>
            </div>
            <div className="flex items-center gap-3">
              <TimeRangeSelector value={timeRange} onChange={setTimeRange} />
              <button
                onClick={() => setShowExport(true)}
                className="px-3 py-1.5 bg-[#161b22] border border-gray-700 rounded-lg text-xs text-gray-300 hover:text-gray-100 hover:border-gray-600 transition-colors"
              >
                Export
              </button>
              {analytics.isUsingMockData && (
                <div className="px-2 py-1 bg-amber-500/10 border border-amber-500/20 rounded-lg">
                  <span className="text-[10px] text-amber-400 font-medium">MOCK DATA</span>
                </div>
              )}
              {analytics.isLoading && (
                <div className="px-2 py-1 bg-blue-500/10 border border-blue-500/20 rounded-lg">
                  <span className="text-[10px] text-blue-400 font-medium">Loading...</span>
                </div>
              )}
              {analytics.error && (
                <button
                  onClick={analytics.refetch}
                  className="px-2 py-1 bg-red-500/10 border border-red-500/20 rounded-lg hover:bg-red-500/20 transition-colors"
                >
                  <span className="text-[10px] text-red-400 font-medium">Error — Retry</span>
                </button>
              )}
            </div>
          </div>

          {/* Tab bar */}
          <div className="flex items-center gap-1 overflow-x-auto scrollbar-none">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`
                  group relative px-3 py-2 text-xs font-medium rounded-t-lg transition-all whitespace-nowrap flex-shrink-0
                  ${activeTab === tab.id
                    ? 'bg-[#161b22] text-gray-100 border-t border-x border-gray-800'
                    : 'text-gray-500 hover:text-gray-300 hover:bg-gray-800/30'}
                `}
              >
                {tab.label}
                {/* Tooltip */}
                <span className="absolute -bottom-8 left-1/2 -translate-x-1/2 px-2 py-1 bg-gray-800 rounded text-[10px] text-gray-400 whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-20">
                  {tab.description}
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-auto">
        {activeTab === 'executive' && <ExecutiveOverview data={mockData} />}
        {activeTab === 'replay' && <SessionReplay data={mockData} />}
        {activeTab === 'prompts' && <PromptAnalyzer data={mockData} />}
        {activeTab === 'insights' && <InsightsView data={mockData} sessions={analytics.sessions} />}
        {activeTab === 'nudges' && <LiveNudgesView />}
      </div>

      {/* Export Dialog */}
      {showExport && <ExportDialog data={mockData} onClose={() => setShowExport(false)} />}
    </div>
  );
}
