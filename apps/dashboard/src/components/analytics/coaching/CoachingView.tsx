import { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { useCoachingData } from './useCoachingData';
import { ReportCardPanel } from './ReportCardPanel';
import { NudgePanel } from './NudgePanel';
import { PlaybookPanel } from './PlaybookPanel';
import {
  clusterSessions,
  groupClustersByDay,
  clusterLabel,
  sessionLabel,
  formatCost,
  formatTokens,
  formatDuration,
  type SessionCluster,
} from './sessionGrouping';
import type { MockSession } from '../mockData';

type CoachingSubTab = 'report-card' | 'playbooks' | 'nudges';

const SUB_TABS: { id: CoachingSubTab; label: string }[] = [
  { id: 'report-card', label: 'Report Card' },
  { id: 'playbooks', label: 'Playbooks' },
  { id: 'nudges', label: 'Live Nudges' },
];

const EMPTY_IDS: string[] = [];

interface CoachingViewProps {
  sessions: MockSession[];
}

// ─── Component ──────────────────────────────────────────────────────

export function CoachingView({ sessions }: CoachingViewProps) {
  const [activeSubTab, setActiveSubTab] = useState<CoachingSubTab>('report-card');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [pickerOpen, setPickerOpen] = useState(false);
  const [expandedClusters, setExpandedClusters] = useState<Set<string>>(new Set());
  const pickerRef = useRef<HTMLDivElement>(null);

  // Compute clusters and day groups
  const clusters = useMemo(() => clusterSessions(sessions), [sessions]);
  const dayGroups = useMemo(() => groupClustersByDay(clusters), [clusters]);

  // Stable array of selected IDs for hook
  const selectedSessionIds = useMemo(() => {
    const arr = [...selectedIds];
    return arr.length > 0 ? arr : EMPTY_IDS;
  }, [selectedIds]);

  // Selected sessions for summary bar
  const selectedSessions = useMemo(
    () => sessions.filter(s => selectedIds.has(s.id)),
    [sessions, selectedIds],
  );

  const { reportCard, nudges, playbooks, isLoading, error, refetchPlaybooks } = useCoachingData(selectedSessionIds);

  // Close picker on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setPickerOpen(false);
      }
    }
    if (pickerOpen) {
      document.addEventListener('mousedown', handleClick);
      return () => document.removeEventListener('mousedown', handleClick);
    }
  }, [pickerOpen]);

  // Toggle individual session
  const toggleSession = useCallback((id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // Toggle entire cluster
  const toggleCluster = useCallback((cluster: SessionCluster) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      const clusterIds = cluster.sessions.map(s => s.id);
      const allSelected = clusterIds.every(id => next.has(id));
      if (allSelected) {
        clusterIds.forEach(id => next.delete(id));
      } else {
        clusterIds.forEach(id => next.add(id));
      }
      return next;
    });
  }, []);

  // Toggle cluster expand/collapse
  const toggleExpand = useCallback((clusterId: string) => {
    setExpandedClusters(prev => {
      const next = new Set(prev);
      if (next.has(clusterId)) next.delete(clusterId);
      else next.add(clusterId);
      return next;
    });
  }, []);

  const clearSelection = useCallback(() => setSelectedIds(new Set()), []);

  // Picker display text
  const pickerText = useMemo(() => {
    const n = selectedIds.size;
    if (n === 0) return 'Select sessions...';
    if (n === 1) {
      const s = sessions.find(s => selectedIds.has(s.id));
      return s ? `Session ${s.id.slice(0, 8)}` : '1 session';
    }
    return `${n} sessions selected`;
  }, [selectedIds, sessions]);

  return (
    <div className="max-w-[1400px] mx-auto px-4 py-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-sm font-semibold text-gray-100">Session Coach</h2>
          <p className="text-xs text-gray-500 mt-0.5">Analyze sessions, get coaching insights, and build playbooks</p>
        </div>

        {/* Session picker */}
        <div className="flex items-center gap-3">
          <div ref={pickerRef} className="relative">
            <button
              onClick={() => setPickerOpen(!pickerOpen)}
              className="flex items-center gap-2 bg-[#161b22] border border-gray-700 rounded-lg px-3 py-1.5 text-xs text-gray-300 hover:border-gray-500 focus:border-blue-500 focus:outline-none min-w-[300px] text-left transition-colors"
            >
              <span className="flex-1 truncate">{pickerText}</span>
              {selectedIds.size > 0 && (
                <span
                  onClick={(e) => { e.stopPropagation(); clearSelection(); }}
                  className="text-gray-600 hover:text-gray-400 px-1"
                  title="Clear selection"
                >
                  &#x2715;
                </span>
              )}
              <span className={`text-gray-500 text-[10px] transition-transform ${pickerOpen ? 'rotate-180' : ''}`}>&#x25BC;</span>
            </button>

            {/* Dropdown panel */}
            {pickerOpen && (
              <div className="absolute right-0 top-full mt-1 w-[420px] max-h-[400px] overflow-y-auto bg-[#0d1117] border border-gray-700 rounded-lg shadow-xl z-50">
                {sessions.length === 0 ? (
                  <div className="px-4 py-6 text-center text-xs text-gray-500">
                    No sessions found in the selected time range
                  </div>
                ) : (
                  dayGroups.map((group) => (
                    <div key={group.label}>
                      {/* Day header */}
                      <div className="sticky top-0 px-3 py-1.5 bg-[#161b22] border-b border-gray-800 text-[10px] font-medium text-gray-500 uppercase tracking-wider">
                        {group.label}
                      </div>

                      {group.clusters.map((cluster) => {
                        const isMulti = cluster.sessions.length > 1;
                        const isExpanded = expandedClusters.has(cluster.id);
                        const clusterIds = cluster.sessions.map(s => s.id);
                        const allSelected = clusterIds.every(id => selectedIds.has(id));
                        const someSelected = !allSelected && clusterIds.some(id => selectedIds.has(id));

                        return (
                          <div key={cluster.id}>
                            {/* Cluster row */}
                            <div className="flex items-center gap-2 px-3 py-2 hover:bg-gray-800/40 transition-colors">
                              {/* Checkbox */}
                              <button
                                onClick={() => toggleCluster(cluster)}
                                className={`w-3.5 h-3.5 rounded border flex items-center justify-center flex-shrink-0 ${
                                  allSelected
                                    ? 'bg-blue-500 border-blue-500'
                                    : someSelected
                                      ? 'bg-blue-500/40 border-blue-500/60'
                                      : 'border-gray-600 hover:border-gray-400'
                                }`}
                              >
                                {(allSelected || someSelected) && (
                                  <span className="text-white text-[8px]">{allSelected ? '\u2713' : '\u2500'}</span>
                                )}
                              </button>

                              {/* Expand toggle for multi-session clusters */}
                              {isMulti && (
                                <button
                                  onClick={() => toggleExpand(cluster.id)}
                                  className="text-gray-500 hover:text-gray-300 text-[10px] w-3 flex-shrink-0"
                                >
                                  {isExpanded ? '\u25BC' : '\u25B6'}
                                </button>
                              )}

                              {/* Cluster label */}
                              <button
                                onClick={() => toggleCluster(cluster)}
                                className="flex-1 text-left text-xs text-gray-300 truncate"
                              >
                                {clusterLabel(cluster)}
                              </button>
                            </div>

                            {/* Expanded individual sessions */}
                            {isMulti && isExpanded && cluster.sessions.map(session => (
                              <div
                                key={session.id}
                                className="flex items-center gap-2 pl-10 pr-3 py-1.5 hover:bg-gray-800/30 transition-colors"
                              >
                                <button
                                  onClick={() => toggleSession(session.id)}
                                  className={`w-3 h-3 rounded border flex items-center justify-center flex-shrink-0 ${
                                    selectedIds.has(session.id)
                                      ? 'bg-blue-500 border-blue-500'
                                      : 'border-gray-600 hover:border-gray-400'
                                  }`}
                                >
                                  {selectedIds.has(session.id) && (
                                    <span className="text-white text-[7px]">{'\u2713'}</span>
                                  )}
                                </button>
                                <button
                                  onClick={() => toggleSession(session.id)}
                                  className="flex-1 text-left text-[11px] text-gray-400 truncate"
                                >
                                  {sessionLabel(session)}
                                </button>
                              </div>
                            ))}
                          </div>
                        );
                      })}
                    </div>
                  ))
                )}
              </div>
            )}
          </div>

          {isLoading && (
            <div className="px-2 py-1 bg-blue-500/10 border border-blue-500/20 rounded-lg">
              <span className="text-[10px] text-blue-400 font-medium">Loading...</span>
            </div>
          )}
        </div>
      </div>

      {/* Multi-session indicator */}
      {selectedSessions.length > 1 && (
        <div className="px-3 py-1.5 bg-blue-500/10 border border-blue-500/20 rounded-lg mb-4">
          <span className="text-xs text-blue-400">
            Merged report across {selectedSessions.length} sessions
          </span>
        </div>
      )}

      {/* Selected session summary bar */}
      {selectedSessions.length > 0 && (
        <div className="flex items-center gap-4 mb-4 px-3 py-2 bg-[#161b22] border border-gray-800 rounded-lg flex-wrap">
          {selectedSessions.length === 1 && (
            <span className="text-xs font-mono text-gray-400">{selectedSessions[0].id.slice(0, 12)}</span>
          )}
          <Stat
            label="Model"
            value={[...new Set(selectedSessions.map(s => shortModel(s.model)))].join(', ')}
          />
          <Stat
            label="Duration"
            value={formatDuration(
              Math.min(...selectedSessions.map(s => s.startTime)),
              Math.max(...selectedSessions.map(s => s.endTime)),
            )}
          />
          <Stat
            label="Cost"
            value={formatCost(selectedSessions.reduce((sum, s) => sum + s.totalCost, 0))}
          />
          <Stat
            label="Tokens"
            value={formatTokens(selectedSessions.reduce((sum, s) => sum + s.totalInputTokens + s.totalOutputTokens, 0))}
          />
          <Stat
            label="Tools"
            value={String(selectedSessions.reduce((sum, s) => sum + s.toolCalls, 0))}
          />
          <Stat
            label="Prompts"
            value={String(selectedSessions.reduce((sum, s) => sum + s.promptCount, 0))}
          />
          {selectedSessions.some(s => s.compactions > 0) && (
            <Stat
              label="Compactions"
              value={String(selectedSessions.reduce((sum, s) => sum + s.compactions, 0))}
              warn
            />
          )}
        </div>
      )}

      {/* Error banner */}
      {error && (
        <div className="mb-4 px-3 py-2 bg-red-500/10 border border-red-500/20 rounded-lg flex items-center justify-between">
          <span className="text-xs text-red-400">{error}</span>
          <span className="text-[10px] text-gray-600">Check browser console for details</span>
        </div>
      )}

      {/* Sub-tab navigation */}
      <div className="flex items-center gap-1 mb-4">
        {SUB_TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveSubTab(tab.id)}
            className={`px-4 py-1.5 text-xs font-medium rounded-full transition-all ${
              activeSubTab === tab.id
                ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
                : 'text-gray-500 hover:text-gray-300 border border-transparent hover:border-gray-700'
            }`}
          >
            {tab.label}
            {tab.id === 'nudges' && nudges.filter(n => !n.dismissed).length > 0 && (
              <span className="ml-1.5 px-1.5 py-0.5 bg-amber-500/20 text-amber-400 text-[10px] rounded-full">
                {nudges.filter(n => !n.dismissed).length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Content */}
      {selectedIds.size === 0 && activeSubTab !== 'playbooks' ? (
        <div className="flex items-center justify-center h-64">
          <div className="text-center">
            <div className="text-gray-600 text-3xl mb-3">&#x1f393;</div>
            <p className="text-sm text-gray-400">Select sessions to see coaching insights</p>
            <p className="text-xs text-gray-600 mt-1">
              {sessions.length > 0
                ? `${sessions.length} sessions available \u2014 related sessions are auto-grouped`
                : 'No sessions found in the selected time range'}
            </p>
          </div>
        </div>
      ) : (
        <>
          {activeSubTab === 'report-card' && (
            <ReportCardPanel reportCard={reportCard} isLoading={isLoading} />
          )}
          {activeSubTab === 'playbooks' && (
            <PlaybookPanel
              playbooks={playbooks}
              sessionId={selectedSessionIds.length > 0 ? selectedSessionIds[0] : null}
              onRefresh={refetchPlaybooks}
            />
          )}
          {activeSubTab === 'nudges' && (
            <NudgePanel
              nudges={nudges}
              sessionId={selectedSessionIds.length > 0 ? selectedSessionIds[0] : null}
            />
          )}
        </>
      )}
    </div>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────

function shortModel(model: string): string {
  return model.replace('claude-', '').replace(/-(\d+)-(\d+)/, '-$1.$2');
}

function Stat({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="flex items-center gap-1">
      <span className="text-[10px] text-gray-600">{label}</span>
      <span className={`text-xs font-mono ${warn ? 'text-amber-400' : 'text-gray-300'}`}>{value}</span>
    </div>
  );
}
