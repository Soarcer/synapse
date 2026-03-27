// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bernhard

import { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import type { PromptTurnData, PromptTurnGroup } from '@synapse-ai/core';
import { apiUrl } from '../utils/api';

const POLL_INTERVAL = 15000; // 15 seconds — transcript updates are infrequent
const MAX_SESSIONS_TO_POLL = 3; // Only poll the most recent sessions to avoid flooding
const EMPTY_MAP = new Map<string, PromptTurnGroup[]>();

/** Map of sessionId → PromptTurnGroup[] shared across all prompt nodes */
export const PromptTurnsContext = createContext<Map<string, PromptTurnGroup[]>>(EMPTY_MAP);

export function usePromptTurnsContext(): Map<string, PromptTurnGroup[]> {
  return useContext(PromptTurnsContext);
}

/** Fetch prompt-turn groups for all given session IDs, polling every 8 seconds */
export function usePromptTurns(sessionIds: string[]): Map<string, PromptTurnGroup[]> {
  const [groupMap, setGroupMap] = useState<Map<string, PromptTurnGroup[]>>(EMPTY_MAP);
  const abortRef = useRef<AbortController | null>(null);
  // Stable key to avoid re-fetching when array identity changes but content doesn't
  const idsKey = sessionIds.sort().join(',');

  // Track sessions that returned 404 so we don't keep hammering them
  const noTranscriptRef = useRef(new Set<string>());

  const fetchAll = useCallback(() => {
    if (!sessionIds.length) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    // Only poll recent sessions, skip known 404s
    const toPoll = sessionIds
      .filter((sid) => !noTranscriptRef.current.has(sid))
      .slice(-MAX_SESSIONS_TO_POLL);

    if (toPoll.length === 0) return;

    Promise.all(
      toPoll.map((sid) =>
        fetch(apiUrl(`/api/transcript/${sid}/prompt-turns`), { signal: controller.signal })
          .then((r) => {
            if (r.status === 404) {
              noTranscriptRef.current.add(sid);
              return null;
            }
            return r.ok ? r.json() : null;
          })
          .then((d: PromptTurnData | null) => (d ? ([sid, d.groups] as const) : null))
          .catch(() => null),
      ),
    ).then((results) => {
      if (controller.signal.aborted) return;
      const next = new Map(groupMap);
      for (const r of results) {
        if (r) next.set(r[0], r[1]);
      }
      setGroupMap(next);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey]);

  useEffect(() => {
    if (!sessionIds.length) {
      setGroupMap(EMPTY_MAP);
      return;
    }

    fetchAll();
    const timer = setInterval(fetchAll, POLL_INTERVAL);
    return () => {
      clearInterval(timer);
      abortRef.current?.abort();
    };
  }, [fetchAll, sessionIds.length]);

  return groupMap;
}
