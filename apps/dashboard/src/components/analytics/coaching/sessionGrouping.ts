// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Synapse Contributors

import type { MockSession } from '../mockData';

// ─── Types ──────────────────────────────────────────────────────────

export interface SessionCluster {
  id: string; // deterministic key (sorted session IDs joined)
  sessions: MockSession[];
  timeSpan: { start: number; end: number };
  totalCost: number;
  totalTokens: number;
  models: string[]; // unique models used
}

export interface ClusterGroup {
  label: string; // "Today", "Yesterday", "Monday", "Feb 10"
  clusters: SessionCluster[];
}

// ─── Clustering ─────────────────────────────────────────────────────

/**
 * Groups sessions into clusters based on time proximity.
 * Sessions within `gapThresholdMs` of each other are clustered together.
 * Overlapping sessions always cluster together.
 */
export function clusterSessions(
  sessions: MockSession[],
  gapThresholdMs = 30 * 60_000,
): SessionCluster[] {
  if (sessions.length === 0) return [];

  const sorted = [...sessions].sort((a, b) => a.startTime - b.startTime);
  const clusters: SessionCluster[] = [];
  let current: MockSession[] = [sorted[0]];
  let clusterEnd = sorted[0].endTime;

  for (let i = 1; i < sorted.length; i++) {
    const s = sorted[i];
    // Cluster if this session starts before current cluster ends + gap threshold
    if (s.startTime - clusterEnd <= gapThresholdMs) {
      current.push(s);
      clusterEnd = Math.max(clusterEnd, s.endTime);
    } else {
      clusters.push(buildCluster(current));
      current = [s];
      clusterEnd = s.endTime;
    }
  }
  clusters.push(buildCluster(current));

  // Return newest first
  return clusters.sort((a, b) => b.timeSpan.start - a.timeSpan.start);
}

function buildCluster(sessions: MockSession[]): SessionCluster {
  const ids = sessions.map((s) => s.id).sort();
  const models = [...new Set(sessions.map((s) => shortModel(s.model)))];
  return {
    id: ids.join('+'),
    sessions,
    timeSpan: {
      start: Math.min(...sessions.map((s) => s.startTime)),
      end: Math.max(...sessions.map((s) => s.endTime)),
    },
    totalCost: sessions.reduce((sum, s) => sum + s.totalCost, 0),
    totalTokens: sessions.reduce((sum, s) => sum + s.totalInputTokens + s.totalOutputTokens, 0),
    models,
  };
}

// ─── Day Grouping ───────────────────────────────────────────────────

export function groupClustersByDay(clusters: SessionCluster[]): ClusterGroup[] {
  const groups: ClusterGroup[] = [];
  let currentLabel = '';

  for (const cluster of clusters) {
    const label = dayLabel(cluster.timeSpan.start);
    if (label !== currentLabel) {
      currentLabel = label;
      groups.push({ label, clusters: [] });
    }
    groups[groups.length - 1].clusters.push(cluster);
  }
  return groups;
}

function dayLabel(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const target = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diff = (today.getTime() - target.getTime()) / 86_400_000;

  if (diff < 1) return 'Today';
  if (diff < 2) return 'Yesterday';
  if (diff < 7) return d.toLocaleDateString('en-US', { weekday: 'long' });
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// ─── Formatting Helpers ─────────────────────────────────────────────

function shortModel(model: string): string {
  return model.replace('claude-', '').replace(/-(\d+)-(\d+)/, '-$1.$2');
}

export function formatCost(usd: number): string {
  if (usd < 0.01) return '<$0.01';
  return `$${usd.toFixed(2)}`;
}

export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

export function formatDuration(startMs: number, endMs: number): string {
  const mins = Math.round((endMs - startMs) / 60_000);
  if (mins < 1) return '<1m';
  if (mins >= 60) return `${Math.floor(mins / 60)}h ${mins % 60}m`;
  return `${mins}m`;
}

export function clusterLabel(cluster: SessionCluster): string {
  const time = new Date(cluster.timeSpan.start).toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
  });
  const dur = formatDuration(cluster.timeSpan.start, cluster.timeSpan.end);
  const cost = formatCost(cluster.totalCost);
  const models = cluster.models.join(', ');

  if (cluster.sessions.length === 1) {
    return `${time} \u00b7 ${models} \u00b7 ${dur} \u00b7 ${cost}`;
  }
  return `${time} cluster (${cluster.sessions.length}) \u00b7 ${dur} \u00b7 ${cost} \u00b7 ${models}`;
}

export function sessionLabel(session: MockSession): string {
  const time = new Date(session.startTime).toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
  });
  const model = shortModel(session.model);
  const dur = formatDuration(session.startTime, session.endTime);
  const cost = formatCost(session.totalCost);
  const tok = formatTokens(session.totalInputTokens + session.totalOutputTokens);
  return `${time} \u00b7 ${model} \u00b7 ${dur} \u00b7 ${cost} \u00b7 ${tok} tok`;
}
