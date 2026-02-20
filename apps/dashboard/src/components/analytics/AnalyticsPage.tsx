// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Synapse Contributors

import { useState, useMemo, useCallback } from 'react';
import { useAnalyticsData, type AnalyticsFilters } from './useAnalyticsData';
import type { MockData } from './mockData';
import { ExecutiveOverview } from './executive/ExecutiveOverview';
import { PromptAnalyzer, type AnalysisMode, loadAnalysisMode } from './prompts/PromptAnalyzer';
import { InsightsView } from './insights/InsightsView';
import { LiveNudgesView } from './nudges/LiveNudgesView';
import { PromptWorkshop } from './workshop/PromptWorkshop';
import { ExportDialog } from './export/ExportDialog';
import { TimeRangeSelector } from './shared/TimeRangeSelector';
import { ProjectFilter } from './shared/ProjectFilter';
import { SessionFilter } from './shared/SessionFilter';
import { SettingsPanel } from './shared/SettingsPanel';
import { Tooltip } from '../ui/Tooltip';

type AnalyticsTab = 'executive' | 'prompts' | 'workshop' | 'insights' | 'nudges';

const TABS: { id: AnalyticsTab; label: string; description: string }[] = [
  { id: 'executive', label: 'Executive', description: 'KPI overview with sparklines' },
  { id: 'prompts', label: 'Prompts', description: 'Prompt analysis with session replay' },
  { id: 'workshop', label: 'Workshop', description: 'Draft and improve prompts before sending' },
  { id: 'insights', label: 'Insights', description: 'AI coach, badges & budget' },
  { id: 'nudges', label: 'Live Nudges', description: 'Real-time coaching & nudge config' },
];

const MODEL_OPTIONS: { id: string; label: string }[] = [
  { id: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5' },
  { id: 'claude-sonnet-4-5-20250929', label: 'Sonnet 4.5' },
  { id: 'claude-opus-4-6', label: 'Opus 4.6' },
];

const MODEL_STORAGE_KEY = 'synapse-workshop-model';

function loadSelectedModel(): string | undefined {
  try { return localStorage.getItem(MODEL_STORAGE_KEY) ?? undefined; } catch { return undefined; }
}

export function AnalyticsPage() {
  const [activeTab, setActiveTab] = useState<AnalyticsTab>('executive');
  const [timeRange, setTimeRange] = useState('7d');
  const [selectedCwd, setSelectedCwd] = useState<string | undefined>();
  const [selectedSessionIds, setSelectedSessionIds] = useState<string[]>([]);
  const [showExport, setShowExport] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [analysisMode, setAnalysisMode] = useState<AnalysisMode>(loadAnalysisMode);
  const [selectedModel, setSelectedModel] = useState<string | undefined>(loadSelectedModel);

  const handleModeChange = useCallback((mode: AnalysisMode) => {
    setAnalysisMode(mode);
    try { localStorage.setItem('synapse-ai-analysis-mode', mode); } catch { /* quota */ }
  }, []);

  const handleModelChange = useCallback((modelId: string | undefined) => {
    setSelectedModel(modelId);
    try {
      if (modelId) localStorage.setItem(MODEL_STORAGE_KEY, modelId);
      else localStorage.removeItem(MODEL_STORAGE_KEY);
    } catch { /* quota */ }
  }, []);

  const filters: AnalyticsFilters = useMemo(() => ({
    timeRange,
    cwd: selectedCwd,
    sessionIds: selectedSessionIds.length > 0 ? selectedSessionIds : undefined,
  }), [timeRange, selectedCwd, selectedSessionIds]);
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
            <div className="flex items-center gap-3">
              <Tooltip content="Back to Dashboard">
                <a
                  href="?"
                  className="p-1.5 -ml-1.5 rounded-md text-gray-400 hover:text-gray-100 hover:bg-gray-800 transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path d="M15 19l-7-7 7-7" />
                  </svg>
                </a>
              </Tooltip>
              <div>
                <h1 className="text-lg font-semibold text-gray-100 tracking-tight">Analytics</h1>
                <p className="text-xs text-gray-500 mt-0.5">AI coding assistant usage reporting</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <TimeRangeSelector value={timeRange} onChange={setTimeRange} />
              <ProjectFilter value={selectedCwd} onChange={setSelectedCwd} />
              <SessionFilter sessions={analytics.sessions} value={selectedSessionIds} onChange={setSelectedSessionIds} />
              <Tooltip content="AI Coach Settings">
                <button
                  onClick={() => setShowSettings(true)}
                  className="px-3 py-1.5 bg-[#161b22] border border-gray-700 rounded-lg text-xs text-gray-300 hover:text-gray-100 hover:border-gray-600 transition-colors"
                >
                  &#x2699;
                </button>
              </Tooltip>
              <Tooltip content="Export analytics data">
                <button
                  onClick={() => setShowExport(true)}
                  className="px-3 py-1.5 bg-[#161b22] border border-gray-700 rounded-lg text-xs text-gray-300 hover:text-gray-100 hover:border-gray-600 transition-colors"
                >
                  Export
                </button>
              </Tooltip>
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
          <div className="flex items-center gap-1 overflow-x-auto overflow-y-hidden scrollbar-none">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                title={tab.description}
                className={`
                  px-3 py-2 text-xs font-medium rounded-t-lg transition-all whitespace-nowrap flex-shrink-0
                  ${activeTab === tab.id
                    ? 'bg-[#161b22] text-gray-100 border-t border-x border-gray-800'
                    : 'text-gray-500 hover:text-gray-300 hover:bg-gray-800/30'}
                `}
              >
                {tab.label}
              </button>
            ))}

            {/* Analysis mode toggle — after tabs, on Prompts and Workshop tabs */}
            {(activeTab === 'prompts' || activeTab === 'workshop') && (
              <div className="ml-auto flex items-center gap-1 bg-[#161b22] border border-gray-700 rounded-lg p-0.5 flex-shrink-0">
                <button
                  onClick={() => handleModeChange('developer')}
                  className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
                    analysisMode === 'developer'
                      ? 'bg-blue-500/20 text-blue-400'
                      : 'text-gray-500 hover:text-gray-300'
                  }`}
                >
                  Developer
                </button>
                <button
                  onClick={() => handleModeChange('vibe')}
                  className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
                    analysisMode === 'vibe'
                      ? 'bg-purple-500/20 text-purple-400'
                      : 'text-gray-500 hover:text-gray-300'
                  }`}
                >
                  Vibe
                </button>
              </div>
            )}

            {/* Model selection — right-aligned, Workshop tab only */}
            {activeTab === 'workshop' && (
              <div className="ml-auto flex items-center gap-1 bg-[#161b22] border border-gray-700 rounded-lg p-0.5 flex-shrink-0">
                {MODEL_OPTIONS.map((m) => (
                  <button
                    key={m.id}
                    onClick={() => handleModelChange(selectedModel === m.id ? undefined : m.id)}
                    className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
                      selectedModel === m.id
                        ? 'bg-teal-500/20 text-teal-400'
                        : 'text-gray-500 hover:text-gray-300'
                    }`}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-auto">
        {activeTab === 'executive' && <ExecutiveOverview data={mockData} />}
        {activeTab === 'prompts' && <PromptAnalyzer data={mockData} analysisMode={analysisMode} />}
        {activeTab === 'workshop' && (
          <PromptWorkshop
            analysisMode={analysisMode}
            modelId={selectedModel}
            sessions={mockData.sessions}
            turns={mockData.turns}
          />
        )}
        {activeTab === 'insights' && <InsightsView data={mockData} sessions={analytics.sessions} />}
        {activeTab === 'nudges' && <LiveNudgesView />}
      </div>

      {/* Export Dialog */}
      {showExport && <ExportDialog data={mockData} onClose={() => setShowExport(false)} />}

      {/* Settings Panel */}
      {showSettings && <SettingsPanel onClose={() => setShowSettings(false)} />}
    </div>
  );
}
