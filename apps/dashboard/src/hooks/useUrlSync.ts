// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Synapse Contributors

import { useEffect, useRef } from 'react';
import { useAgentStore } from '../store/agentStore';

// ── URL param names ──────────────────────────────────────────
const PARAM_SESSION = 'session';
const PARAM_NODE = 'node';
const PARAM_TAB = 'tab';
const PARAM_QUERY = 'q';

// Params we manage — don't touch others (view, cwd)
const MANAGED_PARAMS = [PARAM_SESSION, PARAM_NODE, PARAM_TAB, PARAM_QUERY];

// ── Pure functions (exported for testing) ────────────────────

export interface UrlState {
  sessionId?: string;
  nodeId?: string | null;
  tab?: string;
  query?: string;
}

export function parseUrlState(params: URLSearchParams): UrlState {
  return {
    sessionId: params.get(PARAM_SESSION) ?? undefined,
    nodeId: params.get(PARAM_NODE) ?? undefined,
    tab: params.get(PARAM_TAB) ?? undefined,
    query: params.get(PARAM_QUERY) ?? undefined,
  };
}

export function buildUrlParams(state: UrlState, existing?: URLSearchParams): URLSearchParams {
  const params = new URLSearchParams();

  // Preserve non-managed params (view, cwd, etc.)
  if (existing) {
    existing.forEach((value, key) => {
      if (!MANAGED_PARAMS.includes(key)) {
        params.set(key, value);
      }
    });
  }

  // Set managed params (only if non-empty)
  if (state.sessionId) params.set(PARAM_SESSION, state.sessionId);
  if (state.nodeId) params.set(PARAM_NODE, state.nodeId);
  if (state.tab) params.set(PARAM_TAB, state.tab);
  if (state.query) params.set(PARAM_QUERY, state.query);

  return params;
}

// ── React hook ───────────────────────────────────────────────

export function useUrlSync(): void {
  const isInitialized = useRef(false);

  // Read URL → store on mount
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const state = parseUrlState(params);
    const store = useAgentStore.getState();

    if (state.sessionId) store.setFilter({ sessionId: state.sessionId });
    if (state.nodeId) store.selectNode(state.nodeId);
    if (state.tab) store.setActiveLensTab(state.tab);
    if (state.query) store.setGraphSearchQuery(state.query);

    isInitialized.current = true;
  }, []);

  // Store → URL on change (debounced replaceState)
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;

    const unsub = useAgentStore.subscribe((curr, prev) => {
      if (!isInitialized.current) return;

      const changed =
        curr.filter?.sessionId !== prev.filter?.sessionId ||
        curr.selectedNodeId !== prev.selectedNodeId ||
        curr.activeLensTab !== prev.activeLensTab ||
        curr.graphSearchQuery !== prev.graphSearchQuery;

      if (!changed) return;

      clearTimeout(timer);
      timer = setTimeout(() => {
        const existing = new URLSearchParams(window.location.search);
        const urlParams = buildUrlParams(
          {
            sessionId: curr.filter?.sessionId,
            nodeId: curr.selectedNodeId,
            tab: curr.activeLensTab,
            query: curr.graphSearchQuery,
          },
          existing,
        );
        const newUrl = urlParams.toString()
          ? `${window.location.pathname}?${urlParams.toString()}`
          : window.location.pathname;
        history.replaceState(null, '', newUrl);
      }, 300);
    });

    return () => {
      unsub();
      clearTimeout(timer);
    };
  }, []);

  // Handle back/forward navigation
  useEffect(() => {
    const onPopState = () => {
      const params = new URLSearchParams(window.location.search);
      const state = parseUrlState(params);
      const store = useAgentStore.getState();

      store.setFilter({ sessionId: state.sessionId });
      if (state.nodeId) store.selectNode(state.nodeId);
      else store.selectNode(null);
      if (state.tab) store.setActiveLensTab(state.tab);
      store.setGraphSearchQuery(state.query ?? '');
    };

    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);
}
