import { useState, useMemo } from 'react';
import { useAnalyticsData, type AnalyticsFilters } from './useAnalyticsData';
import type { MockData } from './mockData';
import { ExecutiveOverview } from './executive/ExecutiveOverview';
import { DeepDiveExplorer } from './explorer/DeepDiveExplorer';
import { SessionReplay } from './replay/SessionReplay';
import { ComparisonLab } from './comparison/ComparisonLab';
import { WhatIfCalculator } from './whatif/WhatIfCalculator';
import { TokenVelocityView } from './velocity/TokenVelocityView';
import { PromptAnalyzer } from './prompts/PromptAnalyzer';
import { ToolChainView } from './tools/ToolChainView';
import { InsightsView } from './insights/InsightsView';
import { ExportDialog } from './export/ExportDialog';
import { TimeRangeSelector } from './shared/TimeRangeSelector';

type AnalyticsTab = 'executive' | 'explorer' | 'replay' | 'comparison' | 'whatif' | 'velocity' | 'prompts' | 'tools' | 'insights';

const TABS: { id: AnalyticsTab; label: string; description: string }[] = [
  { id: 'executive', label: 'Executive', description: 'KPI overview with sparklines' },
  { id: 'explorer', label: 'Deep Dive', description: 'Dense data explorer with filters' },
  { id: 'replay', label: 'Session Replay', description: 'Per-session timeline narrative' },
  { id: 'comparison', label: 'Compare', description: 'Side-by-side session analysis' },
  { id: 'whatif', label: 'What-If', description: 'Model cost comparison calculator' },
  { id: 'velocity', label: 'Velocity', description: 'Token throughput & efficiency' },
  { id: 'prompts', label: 'Prompts', description: 'Prompt complexity analysis' },
  { id: 'tools', label: 'Tool Chains', description: 'Tool co-occurrence & sequences' },
  { id: 'insights', label: 'Insights', description: 'AI coach, badges & budget' },
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
        {activeTab === 'explorer' && <DeepDiveExplorer data={mockData} />}
        {activeTab === 'replay' && <SessionReplay data={mockData} />}
        {activeTab === 'comparison' && <ComparisonLab data={mockData} />}
        {activeTab === 'whatif' && <WhatIfCalculator sessions={mockData.sessions} />}
        {activeTab === 'velocity' && <TokenVelocityView data={mockData} />}
        {activeTab === 'prompts' && <PromptAnalyzer data={mockData} />}
        {activeTab === 'tools' && <ToolChainView data={mockData} />}
        {activeTab === 'insights' && <InsightsView data={mockData} />}
      </div>

      {/* Export Dialog */}
      {showExport && <ExportDialog data={mockData} onClose={() => setShowExport(false)} />}
    </div>
  );
}
