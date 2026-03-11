// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bernhard

import type { ReasoningData } from '@synapse-ai/core';

// VITE_API_ORIGIN is only needed when the dashboard is served from a different
// origin than the API (e.g. VS Code webview). When empty, relative paths work.
const apiOrigin = (import.meta.env.VITE_API_ORIGIN ?? '').replace(/\/$/, '');

export function apiUrl(path: string): string {
  if (path.startsWith('http://') || path.startsWith('https://')) return path;
  if (!apiOrigin) return path;
  return `${apiOrigin}${path.startsWith('/') ? path : `/${path}`}`;
}

// ─── Historical Transcript Import ─────────────────────────────────

export interface HistorySession {
  sessionId: string;
  projectHash: string;
  transcriptPath: string;
  startedAt: number | null;
  endedAt: number | null;
  model: string | null;
  permissionMode: string | null;
  gitBranch: string | null;
  slug: string | null;
  totalTurns: number;
  totalToolCalls: number;
  estimatedCostUsd: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  fileSizeBytes: number;
  scannedAt: number;
}

export interface ScanResult {
  scanned: number;
  indexed: number;
  skipped: number;
  errors: Array<{ sessionId: string; reason: string }>;
  truncated: boolean;
  durationMs: number;
}

export interface HistoryResponse {
  sessions: HistorySession[];
  total: number;
}

export async function scanTranscripts(signal?: AbortSignal): Promise<ScanResult> {
  const resp = await fetch(apiUrl('/api/transcript/scan'), {
    method: 'POST',
    signal,
  });
  if (resp.status === 409) throw new Error('Scan already in progress');
  if (!resp.ok) throw new Error(`Scan failed: ${resp.status}`);
  return resp.json();
}

export async function fetchTranscriptReasoning(
  sessionId: string,
  signal?: AbortSignal,
): Promise<ReasoningData | null> {
  const resp = await fetch(apiUrl(`/api/transcript/${sessionId}/reasoning`), { signal });
  if (!resp.ok) return null;
  const data = await resp.json();
  return data.found === false ? null : data;
}

export async function fetchHistory(
  limit = 100,
  offset = 0,
  signal?: AbortSignal,
): Promise<HistoryResponse> {
  const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  const resp = await fetch(apiUrl(`/api/transcript/history?${params}`), { signal });
  if (!resp.ok) throw new Error(`History fetch failed: ${resp.status}`);
  return resp.json();
}
