// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bernhard

import { create } from 'zustand';
import type { WsServerMessage } from '@synapse-ai/core';
import { apiUrl } from '../utils/api';
import { useRemoteDevStore } from './remoteDevStore';

// ── Types ─────────────────────────────────────────────────────

/** Summary shape returned by GET /api/permissions/pending and WS pendingPermission */
export interface PendingSummary {
  id: string;
  tool_name: string;
  tool_input_preview: string;
  tool_input_raw?: unknown;
  createdAt: number;
  expiresAt: number;
}

export interface ResolvedPermission extends PendingSummary {
  behavior: 'allow' | 'deny';
  resolvedAt: number;
}

// Module-level empty arrays to avoid Zustand re-render loops
const EMPTY_PENDING: PendingSummary[] = [];
const EMPTY_RESOLVED: ResolvedPermission[] = [];

const MAX_RESOLVED = 50;

// ── Store interface ───────────────────────────────────────────

// P1: added errorIds set to track network errors instead of silently resolving
interface PermissionStore {
  pending: PendingSummary[];
  resolved: ResolvedPermission[];
  errorIds: Set<string>;

  addPending: (item: PendingSummary) => void;
  resolvePending: (id: string, behavior: 'allow' | 'deny') => void;
  hydrate: (items: PendingSummary[]) => void;
  approve: (id: string) => Promise<void>;
  deny: (id: string) => Promise<void>;
  clearError: (id: string) => void;
}

// ── Store ─────────────────────────────────────────────────────

export const usePermissionStore = create<PermissionStore>((set, get) => ({
  pending: EMPTY_PENDING,
  resolved: EMPTY_RESOLVED,
  errorIds: new Set<string>(),

  addPending: (item) => {
    set((s) => {
      if (s.pending.some((p) => p.id === item.id)) return s;
      return { pending: [...s.pending, item] };
    });
  },

  resolvePending: (id, behavior) => {
    set((s) => {
      const idx = s.pending.findIndex((p) => p.id === id);
      if (idx === -1) return s;
      const item = s.pending[idx];
      const pending = s.pending.filter((p) => p.id !== id);
      const resolved = [{ ...item, behavior, resolvedAt: Date.now() }, ...s.resolved].slice(
        0,
        MAX_RESOLVED,
      );
      return { pending, resolved };
    });
  },

  // P1: merge instead of replace to avoid race with concurrent WS messages
  hydrate: (items) => {
    set((s) => {
      const existingIds = new Set(s.pending.map((p) => p.id));
      const resolvedIds = new Set(s.resolved.map((r) => r.id));
      const newItems = items.filter(
        (item) => !existingIds.has(item.id) && !resolvedIds.has(item.id),
      );
      return { pending: [...s.pending, ...newItems] };
    });
  },

  // P1: network errors set errorIds instead of silently resolving
  approve: async (id) => {
    try {
      set((s) => ({ errorIds: new Set([...s.errorIds].filter((e) => e !== id)) }));
      const res = await fetch(apiUrl(`/api/permissions/${id}/decision`), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ behavior: 'allow' }),
      });
      if (res.ok || res.status === 404) {
        // 404 = already resolved — silent dismiss
        get().resolvePending(id, 'allow');
      }
    } catch {
      // Network error — mark as error so card shows retry UI
      set((s) => ({ errorIds: new Set([...s.errorIds, id]) }));
    }
  },

  deny: async (id) => {
    try {
      set((s) => ({ errorIds: new Set([...s.errorIds].filter((e) => e !== id)) }));
      const res = await fetch(apiUrl(`/api/permissions/${id}/decision`), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ behavior: 'deny' }),
      });
      if (res.ok || res.status === 404) {
        get().resolvePending(id, 'deny');
      }
    } catch {
      set((s) => ({ errorIds: new Set([...s.errorIds, id]) }));
    }
  },

  clearError: (id) => {
    set((s) => ({ errorIds: new Set([...s.errorIds].filter((e) => e !== id)) }));
  },
}));

// ── WS message handler (called from agentStore.ts WS callback) ──

// P1: use runtime validation instead of `as` casts per project convention (Zod at system boundaries)
export function handlePermissionWsMessage(msg: WsServerMessage): boolean {
  if (msg.type === 'pendingPermission') {
    const data = msg.data as Record<string, unknown>;
    // Runtime shape check — WS is a system boundary
    if (
      typeof data.id === 'string' &&
      typeof data.tool_name === 'string' &&
      typeof data.tool_input_preview === 'string' &&
      typeof data.createdAt === 'number' &&
      typeof data.expiresAt === 'number'
    ) {
      usePermissionStore.getState().addPending(data as unknown as PendingSummary);
    }
    return true;
  }
  if (msg.type === 'permissionResolved') {
    const data = msg.data as Record<string, unknown>;
    if (typeof data.id === 'string' && (data.behavior === 'allow' || data.behavior === 'deny')) {
      usePermissionStore.getState().resolvePending(data.id, data.behavior);
    }
    return true;
  }
  return false;
}

// ── Remote Dev detection helper ──────────────────────────────

/**
 * Check if a pending permission is a remote-dev AskUserQuestion.
 * Primary: metadata.source === 'remote-dev' (if Claude Code passes it through)
 * Fallback: questions[0].header === 'Remote' (set by skill as backup)
 */
export function isRemoteDev(data: { tool_name?: string; tool_input_raw?: unknown }): boolean {
  if (data.tool_name !== 'AskUserQuestion') return false;
  const raw = data.tool_input_raw as Record<string, unknown> | undefined;
  if (!raw) return false;
  if (raw.metadata && (raw.metadata as Record<string, unknown>)?.source === 'remote-dev')
    return true;
  const questions = raw.questions as Array<{ header?: string }> | undefined;
  return questions?.[0]?.header === 'Remote';
}

// ── Hydration helper (call on WS connect/reconnect) ──────────

export async function hydratePermissions(): Promise<void> {
  try {
    const res = await fetch(apiUrl('/api/permissions/pending'));
    if (res.ok) {
      const items: PendingSummary[] = await res.json();
      // Route remote-dev items to remoteDevStore, rest to permissionStore
      const remoteItems = items.filter((item) => isRemoteDev(item));
      const permItems = items.filter((item) => !isRemoteDev(item));
      // Only hydrate the most recent remote-dev item — older ones are stale timeout re-asks
      if (remoteItems.length > 0) {
        const newest = remoteItems.reduce((a, b) => (a.createdAt > b.createdAt ? a : b));
        useRemoteDevStore.getState().receiveQuestion(newest);
      }
      usePermissionStore.getState().hydrate(permItems);
    }
  } catch {
    // Hydration failure is non-fatal — WS will deliver live updates
  }
}
