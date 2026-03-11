// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bernhard

import { useState, useEffect, useCallback, useRef } from 'react';
import type { MockSession, MockTurn, MockToolCall, MockDailyRollup } from './mockData';
import { generateMockData } from './mockData';

// ─── Types ──────────────────────────────────────────────────────────

export interface AnalyticsFilters {
  timeRange: string; // '1h' | '6h' | '24h' | '7d' | '30d' | 'all'
  cwd?: string;
  model?: string;
  vendor?: string;
  sessionId?: string;
  sessionIds?: string[];
}

interface OverviewData {
  totalCost: number;
  totalTokens: { input: number; output: number; cacheRead: number };
  totalSessions: number;
  totalToolCalls: number;
  avgLatencyMs: number;
}

interface TimeseriesPoint {
  timestamp: number;
  cost: number;
  inputTokens: number;
  outputTokens: number;
  cacheRead: number;
  sessions: number;
  toolCalls: number;
  models: Record<string, { cost: number; tokens: number; calls: number }>;
}

interface ToolSummary {
  name: string;
  count: number;
  avgDuration: number;
  errorRate: number;
}

interface ModelSummary {
  model: string;
  sessions: number;
  cost: number;
  tokens: number;
}

export interface AnalyticsData {
  overview: OverviewData | null;
  timeseries: TimeseriesPoint[];
  sessions: MockSession[];
  turns: MockTurn[];
  toolCalls: MockToolCall[];
  dailyRollups: MockDailyRollup[];
  tools: ToolSummary[];
  models: ModelSummary[];
  isLoading: boolean;
  error: string | null;
  isUsingMockData: boolean;
  refetch: () => void;
}

// ─── Time Range → Epoch ─────────────────────────────────────────────

function getTimeRangeMs(range: string): { from: number; to: number } {
  const now = Date.now();
  const DAY = 86_400_000;
  switch (range) {
    case '1h':
      return { from: now - 3_600_000, to: now };
    case '6h':
      return { from: now - 6 * 3_600_000, to: now };
    case '24h':
      return { from: now - DAY, to: now };
    case '7d':
      return { from: now - 7 * DAY, to: now };
    case '30d':
      return { from: now - 30 * DAY, to: now };
    case 'all':
      return { from: 0, to: now };
    default:
      return { from: now - 7 * DAY, to: now };
  }
}

// ─── API Base URL ───────────────────────────────────────────────────

const API_BASE = '/api/analytics';

// ─── Helper: Fetch with envelope extraction ─────────────────────────

async function fetchApi<T>(url: string, signal: AbortSignal): Promise<T> {
  const res = await fetch(url, { signal });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`API error ${res.status}: ${body}`);
  }
  const json = await res.json();
  return json.data ?? json;
}

// ─── Convert API response to MockData-compatible shape ──────────────

function apiSessionsToMock(sessions: Array<Record<string, unknown>>): MockSession[] {
  return sessions.map((s) => ({
    id: s.id as string,
    name: (s.name as string) || `Session ${(s.id as string).slice(0, 8)}`,
    startTime: s.startTime as number,
    endTime: s.endTime as number,
    model: (s.model as string) || 'claude-sonnet-4-5',
    vendor: (s.vendor as string) || 'anthropic',
    totalInputTokens: s.totalInputTokens as number,
    totalOutputTokens: s.totalOutputTokens as number,
    totalCacheReadTokens: (s.totalCacheReadTokens as number) || 0,
    totalCost: s.totalCost as number,
    toolCalls: s.toolCalls as number,
    promptCount: (s.promptCount as number) || 0,
    compactions: (s.compactions as number) || 0,
    avgLatencyMs: (s.avgLatencyMs as number) || 0,
  }));
}

function apiTurnsToMock(turns: Array<Record<string, unknown>>): MockTurn[] {
  return turns.map((t) => ({
    sessionId: (t.sessionId as string) || '',
    turnIndex: t.turnIndex as number,
    timestamp: t.timestamp as number,
    promptText: (t.promptText as string) || '',
    inputTokens: t.inputTokens as number,
    outputTokens: t.outputTokens as number,
    cacheReadTokens: (t.cacheReadTokens as number) || 0,
    cacheCreationTokens: (t.cacheCreationTokens as number) || 0,
    thinkingTokens: (t.thinkingTokens as number) || 0,
    toolCount: (t.toolCount as number) || 0,
    toolNames: (t.toolNames as string[]) || [],
    latencyMs: (t.latencyMs as number) || 0,
    costUsd: (t.costUsd as number) || 0,
    model: (t.model as string) || 'claude-sonnet-4-5',
    compactionBefore: (t.compactionBefore as boolean) || false,
  }));
}

function timeseriesToDailyRollups(ts: TimeseriesPoint[]): MockDailyRollup[] {
  return ts.map((point) => ({
    date: new Date(point.timestamp).toISOString().split('T')[0],
    sessions: point.sessions,
    totalCost: point.cost,
    totalInputTokens: point.inputTokens,
    totalOutputTokens: point.outputTokens,
    totalCacheRead: point.cacheRead ?? 0,
    totalToolCalls: point.toolCalls,
    avgLatencyMs: 0,
    models: point.models ?? {},
  }));
}

// Module-level empty arrays to avoid re-render loops
const EMPTY_SESSIONS: MockSession[] = [];
const EMPTY_TURNS: MockTurn[] = [];
const EMPTY_TOOL_CALLS: MockToolCall[] = [];
const EMPTY_TIMESERIES: TimeseriesPoint[] = [];
const EMPTY_DAILY_ROLLUPS: MockDailyRollup[] = [];
const EMPTY_TOOLS: ToolSummary[] = [];
const EMPTY_MODELS: ModelSummary[] = [];

// ─── Hook ───────────────────────────────────────────────────────────

export function useAnalyticsData(filters: AnalyticsFilters): AnalyticsData {
  const [overview, setOverview] = useState<OverviewData | null>(null);
  const [timeseries, setTimeseries] = useState<TimeseriesPoint[]>(EMPTY_TIMESERIES);
  const [sessions, setSessions] = useState<MockSession[]>(EMPTY_SESSIONS);
  const [turns, setTurns] = useState<MockTurn[]>(EMPTY_TURNS);
  const [toolCalls, setToolCalls] = useState<MockToolCall[]>(EMPTY_TOOL_CALLS);
  const [dailyRollups, setDailyRollups] = useState<MockDailyRollup[]>(EMPTY_DAILY_ROLLUPS);
  const [tools, setTools] = useState<ToolSummary[]>(EMPTY_TOOLS);
  const [models, setModels] = useState<ModelSummary[]>(EMPTY_MODELS);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isUsingMockData, setIsUsingMockData] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const fetchIdRef = useRef(0);

  const fetchData = useCallback(async () => {
    // Cancel any in-flight request
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const fetchId = ++fetchIdRef.current;

    // Auto-abort after 30s to prevent hung requests
    const timeout = setTimeout(() => controller.abort(), 30_000);

    setIsLoading(true);
    setError(null);
    setIsUsingMockData(false);

    const { from, to } = getTimeRangeMs(filters.timeRange);
    const params = new URLSearchParams();
    params.set('from', String(from));
    params.set('to', String(to));
    if (filters.cwd) params.set('cwd', filters.cwd);
    if (filters.sessionIds && filters.sessionIds.length > 0) {
      params.set('sessionIds', filters.sessionIds.join(','));
    }

    try {
      // Parallel fetches for independent endpoints
      const turnsParam = filters.sessionId
        ? `sessionId=${encodeURIComponent(filters.sessionId)}`
        : `${params}&limit=50`;

      const [overviewRes, timeseriesRes, sessionsRes, toolsRes, modelsRes, turnsRes, toolCallsRes] =
        await Promise.all([
          fetchApi<OverviewData>(`${API_BASE}/overview?${params}`, controller.signal),
          fetchApi<TimeseriesPoint[]>(
            `${API_BASE}/timeseries?${params}&granularity=day`,
            controller.signal,
          ),
          fetchApi<Array<Record<string, unknown>>>(
            `${API_BASE}/sessions?${params}&limit=100`,
            controller.signal,
          ),
          fetchApi<ToolSummary[]>(`${API_BASE}/tools?${params}`, controller.signal),
          fetchApi<ModelSummary[]>(`${API_BASE}/models?${params}`, controller.signal),
          fetchApi<Array<Record<string, unknown>>>(
            `${API_BASE}/turns?${turnsParam}`,
            controller.signal,
          ),
          fetchApi<MockToolCall[]>(`${API_BASE}/tool-calls?${params}`, controller.signal),
        ]);

      // Stale check
      if (fetchId !== fetchIdRef.current) return;

      setOverview(overviewRes);
      setTimeseries(timeseriesRes.length > 0 ? timeseriesRes : EMPTY_TIMESERIES);

      // Filter out sessions with 0 tokens and 0 cost (no transcript data)
      const allSessions = apiSessionsToMock(sessionsRes);
      const liveSessions = allSessions.filter(
        (s) => s.totalInputTokens + s.totalOutputTokens > 0 || s.totalCost > 0,
      );
      setSessions(liveSessions.length > 0 ? liveSessions : EMPTY_SESSIONS);

      // Filter turns to only include sessions that passed the filter
      const liveSessionIds = new Set(liveSessions.map((s) => s.id));
      const allTurns = apiTurnsToMock(turnsRes);
      const liveTurns = allTurns.filter((t) => liveSessionIds.has(t.sessionId));

      setDailyRollups(timeseriesToDailyRollups(timeseriesRes));
      setTools(toolsRes.length > 0 ? toolsRes : EMPTY_TOOLS);
      setModels(modelsRes.length > 0 ? modelsRes : EMPTY_MODELS);
      setTurns(liveTurns.length > 0 ? liveTurns : EMPTY_TURNS);
      setToolCalls(toolCallsRes.length > 0 ? toolCallsRes : EMPTY_TOOL_CALLS);

      clearTimeout(timeout);
      setIsLoading(false);
    } catch (err: unknown) {
      clearTimeout(timeout);
      if (err instanceof DOMException && err.name === 'AbortError') return;
      if (fetchId !== fetchIdRef.current) return;

      // Fallback to mock data in development
      if (import.meta.env.DEV)
        console.warn('Analytics API unavailable, falling back to mock data:', err);
      const mock = generateMockData(42);
      setOverview({
        totalCost: mock.sessions.reduce((s, session) => s + session.totalCost, 0),
        totalTokens: {
          input: mock.sessions.reduce((s, session) => s + session.totalInputTokens, 0),
          output: mock.sessions.reduce((s, session) => s + session.totalOutputTokens, 0),
          cacheRead: mock.sessions.reduce((s, session) => s + session.totalCacheReadTokens, 0),
        },
        totalSessions: mock.sessions.length,
        totalToolCalls: mock.toolCalls.length,
        avgLatencyMs: Math.round(
          mock.sessions.reduce((s, session) => s + session.avgLatencyMs, 0) / mock.sessions.length,
        ),
      });
      setTimeseries(
        mock.dailyRollups.map((d) => ({
          timestamp: new Date(d.date).getTime(),
          cost: d.totalCost,
          inputTokens: d.totalInputTokens,
          outputTokens: d.totalOutputTokens,
          cacheRead: d.totalCacheRead,
          sessions: d.sessions,
          toolCalls: d.totalToolCalls,
          models: d.models,
        })),
      );
      setSessions(mock.sessions);
      setTurns(mock.turns);
      setToolCalls(mock.toolCalls);
      setDailyRollups(mock.dailyRollups);
      setTools(
        mock.toolCalls.reduce((acc, tc) => {
          const existing = acc.find((t) => t.name === tc.toolName);
          if (existing) {
            existing.count++;
            existing.avgDuration = Math.round(
              (existing.avgDuration * (existing.count - 1) + tc.durationMs) / existing.count,
            );
            if (tc.status === 'error')
              existing.errorRate = (existing.errorRate * (existing.count - 1) + 1) / existing.count;
          } else {
            acc.push({
              name: tc.toolName,
              count: 1,
              avgDuration: tc.durationMs,
              errorRate: tc.status === 'error' ? 1 : 0,
            });
          }
          return acc;
        }, [] as ToolSummary[]),
      );
      setModels(
        mock.sessions.reduce((acc, s) => {
          const existing = acc.find((m) => m.model === s.model);
          if (existing) {
            existing.sessions++;
            existing.cost += s.totalCost;
            existing.tokens += s.totalInputTokens + s.totalOutputTokens;
          } else {
            acc.push({
              model: s.model,
              sessions: 1,
              cost: s.totalCost,
              tokens: s.totalInputTokens + s.totalOutputTokens,
            });
          }
          return acc;
        }, [] as ModelSummary[]),
      );

      setIsUsingMockData(true);
      setError(null); // Don't show error when gracefully falling back
      setIsLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sessionIds is an array, serialized for stability
  }, [filters.timeRange, filters.cwd, filters.sessionId, filters.sessionIds?.join(',')]);

  useEffect(() => {
    fetchData();
    return () => {
      if (abortRef.current) abortRef.current.abort();
    };
  }, [fetchData]);

  return {
    overview,
    timeseries,
    sessions,
    turns,
    toolCalls,
    dailyRollups,
    tools,
    models,
    isLoading,
    error,
    isUsingMockData,
    refetch: fetchData,
  };
}
