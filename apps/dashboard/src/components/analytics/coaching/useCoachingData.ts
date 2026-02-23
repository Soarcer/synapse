// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Synapse Contributors

import { useState, useEffect, useRef } from 'react';
import { apiUrl } from '../../../utils/api';
import type { ReportCard, CoachingNudge, Playbook } from '@synapse-ai/core';

export interface CoachingData {
  reportCard: ReportCard | null;
  nudges: CoachingNudge[];
  playbooks: Playbook[];
  isLoading: boolean;
  error: string | null;
  refetchPlaybooks: () => void;
}

const EMPTY_NUDGES: CoachingNudge[] = [];
const EMPTY_PLAYBOOKS: Playbook[] = [];

async function fetchJson<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) {
    const body = await r.text().catch(() => '');
    throw new Error(`API ${r.status}: ${body.slice(0, 200)}`);
  }
  const d = await r.json();
  return d.data as T;
}

export function useCoachingData(sessionIds: string[]): CoachingData {
  const [reportCard, setReportCard] = useState<ReportCard | null>(null);
  const [nudges, setNudges] = useState<CoachingNudge[]>(EMPTY_NUDGES);
  const [playbooks, setPlaybooks] = useState<Playbook[]>(EMPTY_PLAYBOOKS);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [playbookRefresh, setPlaybookRefresh] = useState(0);

  // Stable key — only re-fetch when the actual set of IDs changes
  const idsKey = sessionIds.slice().sort().join(',');

  // Track which idsKey the current in-flight request is for.
  // This avoids AbortController (which React StrictMode double-fire kills)
  // and instead uses a simple stale-check after the fetch resolves.
  const activeKeyRef = useRef('');

  // Fetch report card and nudges when idsKey changes
  useEffect(() => {
    const ids = idsKey ? idsKey.split(',') : [];
    if (ids.length === 0) {
      activeKeyRef.current = '';
      setReportCard(null);
      setNudges(EMPTY_NUDGES);
      setError(null);
      setIsLoading(false);
      return;
    }

    // Mark this as the active request
    activeKeyRef.current = idsKey;
    setIsLoading(true);
    setError(null);

    // Report card: single vs multi endpoint
    const reportCardUrl =
      ids.length === 1
        ? apiUrl(`/api/analytics/coaching/report-card?sessionId=${encodeURIComponent(ids[0])}`)
        : apiUrl(
            `/api/analytics/coaching/report-card/multi?sessionIds=${ids.map(encodeURIComponent).join(',')}`,
          );

    // Nudges: fetch for each session and merge
    const nudgePromises = ids.map((sid) =>
      fetchJson<CoachingNudge[]>(
        apiUrl(`/api/analytics/coaching/nudges?sessionId=${encodeURIComponent(sid)}`),
      ).catch(() => EMPTY_NUDGES),
    );

    const capturedKey = idsKey;

    Promise.all([
      fetchJson<ReportCard>(reportCardUrl).catch(() => null),
      Promise.all(nudgePromises),
    ])
      .then(([rc, nudgeArrays]) => {
        // Only apply if this is still the active request (guards against
        // React StrictMode double-fire and rapid idsKey changes)
        if (activeKeyRef.current !== capturedKey) return;

        setReportCard(rc ?? null);
        const merged = nudgeArrays.flat().sort((a, b) => b.firedAt - a.firedAt);
        setNudges(merged.length > 0 ? merged : EMPTY_NUDGES);
        setIsLoading(false);
        if (!rc) setError('Report card unavailable \u2014 check server logs');
      })
      .catch(() => {
        if (activeKeyRef.current !== capturedKey) return;
        setError('Failed to load coaching data');
        setIsLoading(false);
      });

    // No abort in cleanup — let the request finish, the stale-check
    // in .then() handles ignoring outdated responses.
  }, [idsKey]);

  // Fetch playbooks independently
  useEffect(() => {
    let cancelled = false;

    fetchJson<Playbook[]>(apiUrl('/api/analytics/coaching/playbooks'))
      .then((data) => {
        if (!cancelled) setPlaybooks(data ?? EMPTY_PLAYBOOKS);
      })
      .catch(() => {
        /* ignore */
      });

    return () => {
      cancelled = true;
    };
  }, [playbookRefresh]);

  const refetchPlaybooks = () => setPlaybookRefresh((n) => n + 1);

  return { reportCard, nudges, playbooks, isLoading, error, refetchPlaybooks };
}
