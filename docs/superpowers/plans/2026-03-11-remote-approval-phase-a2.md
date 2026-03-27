# Remote Approval — Phase A2 Frontend Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the frontend for remote permission approval — Zustand store, approval cards with countdown timers, Hook Controls settings tab, QR code panel, and PWA manifest — so that a user can approve/deny Claude's permission requests from any browser on the local network.

**Architecture:** A new `permissionStore` (Zustand) receives `pendingPermission` and `permissionResolved` WebSocket messages via the existing `wsClient.setOnEvent()` callback chain. `PermissionApprovalCard` components render in a floating panel with countdown timers and expand-on-demand input details. A Hook Controls settings tab shows hook server status, setup instructions, and a QR code for mobile access. A `GET /api/network/local-url` backend endpoint provides LAN IP detection. A `manifest.json` enables PWA "Add to Home Screen" on iOS.

**Tech Stack:** React 19, Zustand 5, Tailwind CSS 4, Vite 6, qrcode (npm), vitest + jsdom

**Spec:** [2026-03-11-remote-approval-and-prompt-interceptor-design.md](../specs/2026-03-11-remote-approval-and-prompt-interceptor-design.md)

**Phase A1 plan (backend, already implemented):** [2026-03-11-remote-approval-phase-a1.md](2026-03-11-remote-approval-phase-a1.md)

<!-- revised: plan review 2026-03-11 — P0+P1 findings incorporated, P2 deferred to bottom -->

---

## File Structure

### New files

| File                                                                                  | Responsibility                                                                                     |
| ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `apps/dashboard/src/store/permissionStore.ts`                                         | Zustand store: `pending[]`, `resolved[]`, `approve(id)`, `deny(id)`, hydration, WS message handler |
| `apps/dashboard/src/store/__tests__/permissionStore.test.ts`                          | Unit tests for permissionStore                                                                     |
| `apps/dashboard/src/components/permissions/PermissionApprovalCard.tsx`                | Single approval card: tool name, truncated input, expand, countdown, approve/deny buttons          |
| `apps/dashboard/src/components/permissions/PermissionPanel.tsx`                       | Floating panel that stacks multiple PermissionApprovalCards                                        |
| `apps/dashboard/src/components/permissions/__tests__/PermissionApprovalCard.test.tsx` | Component tests for approval card                                                                  |
| `apps/dashboard/src/components/permissions/__tests__/PermissionPanel.test.tsx`        | Component tests for permission panel                                                               |
| `apps/dashboard/src/components/settings/HookControlsTab.tsx`                          | Settings tab: hook server status, setup instructions, config snippet, QR code                      |
| `apps/dashboard/src/components/settings/__tests__/HookControlsTab.test.tsx`           | Component tests for Hook Controls tab                                                              |
| `apps/dashboard/src/components/settings/QRCodePanel.tsx`                              | QR code display with live URL, refresh button, amber warning                                       |
| `apps/dashboard/src/components/settings/__tests__/QRCodePanel.test.tsx`               | Component tests for QR code panel                                                                  |
| `packages/server/src/routes/network.ts`                                               | `GET /api/network/local-url` — LAN IP heuristic endpoint                                           |
| `packages/server/src/__tests__/networkRoutes.test.ts`                                 | Tests for network endpoint                                                                         |
| `apps/dashboard/public/manifest.json`                                                 | PWA manifest for "Add to Home Screen"                                                              |

### Modified files

| File                                              | Change                                                                         |
| ------------------------------------------------- | ------------------------------------------------------------------------------ |
| `apps/dashboard/src/store/agentStore.ts`          | Wire `pendingPermission` + `permissionResolved` WS messages to permissionStore |
| `apps/dashboard/src/App.tsx`                      | Render `PermissionPanel` floating overlay                                      |
| `apps/dashboard/src/components/layout/Header.tsx` | Add Hook Controls button/trigger                                               |
| `apps/dashboard/index.html`                       | Link `manifest.json` in `<head>`                                               |
| `packages/server/src/index.ts`                    | Mount network router                                                           |

---

## Chunk 1: Permission Store + WS Wiring

### Task 1: Create permissionStore (Zustand)

**Files:**

- Create: `apps/dashboard/src/store/permissionStore.ts`
- Create: `apps/dashboard/src/store/__tests__/permissionStore.test.ts`

**Context:** This is a NEW separate Zustand store (not part of agentStore). It manages pending permission requests and their resolution. It follows the exact same patterns as `apps/dashboard/src/features/notifications/notificationStore.ts` and `apps/dashboard/src/store/agentStore.ts`.

**Key types from `@synapse-ai/core` (already exist from Phase A1):**

- `WsServerMessage` includes `{ type: 'pendingPermission'; data: { id, tool_name, tool_input_preview, createdAt, expiresAt } }`
- `WsServerMessage` includes `{ type: 'permissionResolved'; data: { id, behavior: 'allow' | 'deny' } }`

**Backend endpoints (already exist from Phase A1):**

- `GET /api/permissions/pending` → returns `PendingSummary[]` (array of `{ id, tool_name, tool_input_preview, createdAt, expiresAt }`)
- `GET /api/permissions/:id` → returns full detail `{ id, event, createdAt, expiresAt }`
- `PUT /api/permissions/:id/decision` → body `{ behavior: 'allow' | 'deny' }` → returns `{ ok, latencyMs }` or 404

- [ ] **Step 1: Write the failing test**

Create `apps/dashboard/src/store/__tests__/permissionStore.test.ts`:

```typescript
// @vitest-environment jsdom

// Mock api utility before imports
vi.mock('../../utils/api', () => ({
  apiUrl: (path: string) => path,
}));

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Import store after mocks
import { usePermissionStore, type PendingSummary } from '../permissionStore';

// ── Helper: reset store before each test ────────────────────
function resetStore() {
  usePermissionStore.setState({
    pending: [],
    resolved: [],
  });
}

function makePending(overrides: Partial<PendingSummary> = {}): PendingSummary {
  return {
    id: overrides.id ?? 'perm-1',
    tool_name: overrides.tool_name ?? 'Bash',
    tool_input_preview: overrides.tool_input_preview ?? 'rm -rf build/',
    createdAt: overrides.createdAt ?? Date.now(),
    expiresAt: overrides.expiresAt ?? Date.now() + 1_800_000,
  };
}

describe('permissionStore', () => {
  beforeEach(() => resetStore());

  it('starts with empty pending and resolved arrays', () => {
    const { pending, resolved } = usePermissionStore.getState();
    expect(pending).toEqual([]);
    expect(resolved).toEqual([]);
  });

  it('addPending adds a permission to pending list', () => {
    const p = makePending({ id: 'perm-1' });
    usePermissionStore.getState().addPending(p);
    expect(usePermissionStore.getState().pending).toHaveLength(1);
    expect(usePermissionStore.getState().pending[0].id).toBe('perm-1');
  });

  it('addPending deduplicates by id', () => {
    const p = makePending({ id: 'perm-1' });
    usePermissionStore.getState().addPending(p);
    usePermissionStore.getState().addPending(p);
    expect(usePermissionStore.getState().pending).toHaveLength(1);
  });

  it('resolvePending moves permission from pending to resolved', () => {
    const p = makePending({ id: 'perm-2' });
    usePermissionStore.getState().addPending(p);
    usePermissionStore.getState().resolvePending('perm-2', 'allow');

    expect(usePermissionStore.getState().pending).toHaveLength(0);
    expect(usePermissionStore.getState().resolved).toHaveLength(1);
    expect(usePermissionStore.getState().resolved[0]).toMatchObject({
      id: 'perm-2',
      behavior: 'allow',
    });
  });

  it('resolvePending is a no-op for unknown id', () => {
    usePermissionStore.getState().resolvePending('nonexistent', 'deny');
    expect(usePermissionStore.getState().pending).toHaveLength(0);
    expect(usePermissionStore.getState().resolved).toHaveLength(0);
  });

  it('approve calls PUT and resolves on success', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ ok: true, latencyMs: 120 }),
    });

    const p = makePending({ id: 'perm-3' });
    usePermissionStore.getState().addPending(p);
    await usePermissionStore.getState().approve('perm-3');

    expect(global.fetch).toHaveBeenCalledWith(
      '/api/permissions/perm-3/decision',
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({ behavior: 'allow' }),
      }),
    );
  });

  it('deny calls PUT with deny behavior', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ ok: true, latencyMs: 50 }),
    });

    const p = makePending({ id: 'perm-4' });
    usePermissionStore.getState().addPending(p);
    await usePermissionStore.getState().deny('perm-4');

    expect(global.fetch).toHaveBeenCalledWith(
      '/api/permissions/perm-4/decision',
      expect.objectContaining({
        body: JSON.stringify({ behavior: 'deny' }),
      }),
    );
  });

  it('approve silently dismisses on 404 (already resolved)', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: () => Promise.resolve({ error: 'already resolved' }),
    });

    const p = makePending({ id: 'perm-5' });
    usePermissionStore.getState().addPending(p);
    await usePermissionStore.getState().approve('perm-5');

    // Should remove from pending (silent dismiss)
    expect(usePermissionStore.getState().pending).toHaveLength(0);
  });

  // <!-- revised: P1 — hydrate now merges instead of replacing -->
  it('hydrate merges server data with existing pending (no duplicates)', () => {
    const existing = makePending({ id: 'local-1' });
    usePermissionStore.getState().addPending(existing);

    const serverData = [
      makePending({ id: 'local-1' }), // duplicate — should be skipped
      makePending({ id: 'server-1' }),
      makePending({ id: 'server-2' }),
    ];
    usePermissionStore.getState().hydrate(serverData);

    expect(usePermissionStore.getState().pending).toHaveLength(3);
    expect(usePermissionStore.getState().pending.map((p) => p.id)).toEqual([
      'local-1',
      'server-1',
      'server-2',
    ]);
  });

  it('hydrate skips items already in resolved list', () => {
    const p = makePending({ id: 'resolved-1' });
    usePermissionStore.getState().addPending(p);
    usePermissionStore.getState().resolvePending('resolved-1', 'allow');

    usePermissionStore.getState().hydrate([makePending({ id: 'resolved-1' })]);
    expect(usePermissionStore.getState().pending).toHaveLength(0);
  });

  it('caps resolved list at 50 entries', () => {
    const items = Array.from({ length: 55 }, (_, i) => makePending({ id: `perm-${i}` }));
    for (const item of items) {
      usePermissionStore.getState().addPending(item);
    }
    for (const item of items) {
      usePermissionStore.getState().resolvePending(item.id, 'allow');
    }
    expect(usePermissionStore.getState().resolved.length).toBeLessThanOrEqual(50);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/dashboard && npx vitest run src/store/__tests__/permissionStore.test.ts`
Expected: FAIL — module `../permissionStore` not found

- [ ] **Step 3: Write minimal implementation**

Create `apps/dashboard/src/store/permissionStore.ts`:

```typescript
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bernhard

import { create } from 'zustand';
import type { WsServerMessage } from '@synapse-ai/core';
import { apiUrl } from '../utils/api';

// ── Types ─────────────────────────────────────────────────────

/** Summary shape returned by GET /api/permissions/pending and WS pendingPermission */
export interface PendingSummary {
  id: string;
  tool_name: string;
  tool_input_preview: string;
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

// <!-- revised: P1 — added errorIds set to track network errors instead of silently resolving -->
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

  // <!-- revised: P1 — merge instead of replace to avoid race with concurrent WS messages -->
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

  // <!-- revised: P1 — network errors set errorIds instead of silently resolving -->
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

// <!-- revised: P1 — use runtime validation instead of `as` casts per project convention (Zod at system boundaries) -->
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

// ── Hydration helper (call on WS connect/reconnect) ──────────

export async function hydratePermissions(): Promise<void> {
  try {
    const res = await fetch(apiUrl('/api/permissions/pending'));
    if (res.ok) {
      const items: PendingSummary[] = await res.json();
      usePermissionStore.getState().hydrate(items);
    }
  } catch {
    // Hydration failure is non-fatal — WS will deliver live updates
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/dashboard && npx vitest run src/store/__tests__/permissionStore.test.ts`
Expected: All 9 tests PASS

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/store/permissionStore.ts apps/dashboard/src/store/__tests__/permissionStore.test.ts
git commit -m "feat(dashboard): add permissionStore with pending/resolved state management"
```

---

### Task 2: Wire WS messages to permissionStore

**Files:**

- Modify: `apps/dashboard/src/store/agentStore.ts` (WS callback section, ~line 804)

**Context:** The `wsClient.setOnEvent()` callback at the bottom of `agentStore.ts` handles all incoming WS messages. The new `pendingPermission` and `permissionResolved` message types need to be routed to `permissionStore`. Also wire `hydratePermissions()` into the reconnect handler.

- [ ] **Step 1: Write the failing test**

Add to `apps/dashboard/src/store/__tests__/permissionStore.test.ts`:

```typescript
import { handlePermissionWsMessage } from '../permissionStore';

describe('handlePermissionWsMessage', () => {
  beforeEach(() => resetStore());

  it('handles pendingPermission message', () => {
    const handled = handlePermissionWsMessage({
      type: 'pendingPermission',
      data: makePending({ id: 'ws-1' }),
    });
    expect(handled).toBe(true);
    expect(usePermissionStore.getState().pending).toHaveLength(1);
    expect(usePermissionStore.getState().pending[0].id).toBe('ws-1');
  });

  it('handles permissionResolved message', () => {
    usePermissionStore.getState().addPending(makePending({ id: 'ws-2' }));
    const handled = handlePermissionWsMessage({
      type: 'permissionResolved',
      data: { id: 'ws-2', behavior: 'allow' },
    });
    expect(handled).toBe(true);
    expect(usePermissionStore.getState().pending).toHaveLength(0);
    expect(usePermissionStore.getState().resolved).toHaveLength(1);
  });

  it('returns false for unrelated message types', () => {
    const handled = handlePermissionWsMessage({
      type: 'event',
      data: {},
    });
    expect(handled).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it passes** (these tests should already pass since we implemented `handlePermissionWsMessage` in Task 1)

Run: `cd apps/dashboard && npx vitest run src/store/__tests__/permissionStore.test.ts`
Expected: All 12 tests PASS

- [ ] **Step 3: Wire into agentStore.ts WS callback**

In `apps/dashboard/src/store/agentStore.ts`, add the imports at the top (near other store imports):

<!-- revised: P1 — add toast notification when new permission arrives -->

```typescript
import { handlePermissionWsMessage, hydratePermissions } from './permissionStore';
import { useNotificationStore } from '../features/notifications/notificationStore';
```

In the `wsClient.setOnEvent()` callback (~line 804), add permission message handling at the top of the callback body, before the existing `if (msg.type === 'event')` block:

```typescript
wsClient.setOnEvent((msg) => {
  // Route permission messages to dedicated store
  // <!-- revised: P1 — fire toast on new permission arrival -->
  if (msg.type === 'pendingPermission') {
    const data = msg.data as { tool_name?: string };
    useNotificationStore.getState().addNotification({
      type: 'info',
      title: 'Permission requested',
      message: `${data.tool_name ?? 'Tool'} needs approval`,
    });
  }
  if (handlePermissionWsMessage(msg)) return;

  if (msg.type === 'event') {
    // ... existing event handling
```

In the `wsClient.setOnReconnect()` callback (~line 866), add hydration:

```typescript
wsClient.setOnReconnect(() => {
  reloadAllEvents();
  hydratePermissions();
});
```

Also add initial hydration in `wsClient.setOnEvent` when receiving `connected` message. Inside the existing `wsClient.setOnEvent()` callback, after the permission routing but before other handlers, add:

```typescript
// Hydrate permissions on initial connect
if (msg.type === 'connected') {
  hydratePermissions();
}
```

Note: The `connected` message is already a `WsServerMessage` variant. The existing code doesn't explicitly handle it (it falls through), so this is a new handler that doesn't conflict.

- [ ] **Step 4: Verify build compiles**

Run: `cd apps/dashboard && npx tsc --noEmit`
Expected: No type errors

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/store/agentStore.ts apps/dashboard/src/store/__tests__/permissionStore.test.ts
git commit -m "feat(dashboard): wire permission WS messages to permissionStore"
```

---

## Chunk 2: Permission Approval Card + Panel

### Task 3: Create PermissionApprovalCard component

**Files:**

- Create: `apps/dashboard/src/components/permissions/PermissionApprovalCard.tsx`
- Create: `apps/dashboard/src/components/permissions/__tests__/PermissionApprovalCard.test.tsx`

**Context:**

- Card displays: tool name, truncated input (80 chars + `[+]` expand via `GET /api/permissions/:id`), countdown timer, Approve/Deny buttons, disabled "Always allow (v2)" placeholder
- Timer counts down from `expiresAt` to 0. When it hits 0 → amber "Timed out" state with Dismiss button only
- 404 on decision → silent dismiss (handled by permissionStore.approve/deny)
- Tailwind CSS 4 — all styling via utility classes
- Refer to the spec wireframe in the design doc for layout

- [ ] **Step 1: Write the failing test**

Create `apps/dashboard/src/components/permissions/__tests__/PermissionApprovalCard.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

vi.mock('../../../utils/api', () => ({
  apiUrl: (path: string) => path,
}));

import { PermissionApprovalCard } from '../PermissionApprovalCard';
import type { PendingSummary } from '../../../store/permissionStore';

function makePending(overrides: Partial<PendingSummary> = {}): PendingSummary {
  return {
    id: 'perm-1',
    tool_name: 'Bash',
    tool_input_preview: 'rm -rf build/dist && npm run build',
    createdAt: Date.now(),
    expiresAt: Date.now() + 1_800_000, // 30 min
    ...overrides,
  };
}

describe('PermissionApprovalCard', () => {
  const mockApprove = vi.fn();
  const mockDeny = vi.fn();
  const mockDismiss = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders tool name and truncated input', () => {
    render(
      <PermissionApprovalCard
        permission={makePending()}
        onApprove={mockApprove}
        onDeny={mockDeny}
        onDismiss={mockDismiss}
      />,
    );
    expect(screen.getByText('Bash')).toBeTruthy();
    expect(screen.getByText(/rm -rf build/)).toBeTruthy();
  });

  it('shows Approve and Deny buttons', () => {
    render(
      <PermissionApprovalCard
        permission={makePending()}
        onApprove={mockApprove}
        onDeny={mockDeny}
        onDismiss={mockDismiss}
      />,
    );
    expect(screen.getByRole('button', { name: /approve/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /deny/i })).toBeTruthy();
  });

  it('calls onApprove when Approve is clicked', () => {
    render(
      <PermissionApprovalCard
        permission={makePending()}
        onApprove={mockApprove}
        onDeny={mockDeny}
        onDismiss={mockDismiss}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /approve/i }));
    expect(mockApprove).toHaveBeenCalledWith('perm-1');
  });

  it('calls onDeny when Deny is clicked', () => {
    render(
      <PermissionApprovalCard
        permission={makePending()}
        onApprove={mockApprove}
        onDeny={mockDeny}
        onDismiss={mockDismiss}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /deny/i }));
    expect(mockDeny).toHaveBeenCalledWith('perm-1');
  });

  it('shows disabled "Always allow" placeholder', () => {
    render(
      <PermissionApprovalCard
        permission={makePending()}
        onApprove={mockApprove}
        onDeny={mockDeny}
        onDismiss={mockDismiss}
      />,
    );
    const alwaysBtn = screen.getByRole('button', { name: /always allow/i });
    expect(alwaysBtn).toBeTruthy();
    expect(
      alwaysBtn.hasAttribute('disabled') || alwaysBtn.getAttribute('aria-disabled') === 'true',
    ).toBe(true);
  });

  it('shows countdown timer', () => {
    render(
      <PermissionApprovalCard
        permission={makePending({ expiresAt: Date.now() + 1_800_000 })}
        onApprove={mockApprove}
        onDeny={mockDeny}
        onDismiss={mockDismiss}
      />,
    );
    // Should show ~29:xx or 30:00
    expect(screen.getByText(/\d+:\d{2}/)).toBeTruthy();
  });

  it('shows timed-out state when expired', () => {
    render(
      <PermissionApprovalCard
        permission={makePending({ expiresAt: Date.now() - 60_000 })}
        onApprove={mockApprove}
        onDeny={mockDeny}
        onDismiss={mockDismiss}
      />,
    );
    expect(screen.getByText(/timed out/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /dismiss/i })).toBeTruthy();
    // Approve/Deny buttons should NOT be visible in expired state
    expect(screen.queryByRole('button', { name: /^approve$/i })).toBeNull();
  });

  it('truncates long input at 80 chars with expand button', () => {
    const longInput = 'x'.repeat(120);
    render(
      <PermissionApprovalCard
        permission={makePending({ tool_input_preview: longInput })}
        onApprove={mockApprove}
        onDeny={mockDeny}
        onDismiss={mockDismiss}
      />,
    );
    // Should show truncated text and expand button
    expect(screen.getByText('[+]')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/dashboard && npx vitest run src/components/permissions/__tests__/PermissionApprovalCard.test.tsx`
Expected: FAIL — module `../PermissionApprovalCard` not found

- [ ] **Step 3: Write minimal implementation**

Create `apps/dashboard/src/components/permissions/PermissionApprovalCard.tsx`:

```tsx
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bernhard

import { useState, useEffect, useCallback } from 'react';
import type { PendingSummary } from '../../store/permissionStore';
import { apiUrl } from '../../utils/api';

interface Props {
  permission: PendingSummary;
  onApprove: (id: string) => void;
  onDeny: (id: string) => void;
  onDismiss: (id: string) => void;
}

const TRUNCATE_LENGTH = 80;

function formatCountdown(ms: number): string {
  if (ms <= 0) return '0:00';
  const totalSec = Math.ceil(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}:${sec.toString().padStart(2, '0')}`;
}

export function PermissionApprovalCard({ permission, onApprove, onDeny, onDismiss }: Props) {
  const { id, tool_name, tool_input_preview, expiresAt } = permission;

  // ── Countdown timer ──
  const [remaining, setRemaining] = useState(() => Math.max(0, expiresAt - Date.now()));

  useEffect(() => {
    if (remaining <= 0) return;
    const interval = setInterval(() => {
      const ms = Math.max(0, expiresAt - Date.now());
      setRemaining(ms);
      if (ms <= 0) clearInterval(interval);
    }, 1000);
    return () => clearInterval(interval);
  }, [expiresAt]);

  const isExpired = remaining <= 0;

  // ── Expand input ──
  const [expanded, setExpanded] = useState(false);
  const [fullInput, setFullInput] = useState<string | null>(null);

  const needsTruncation = tool_input_preview.length > TRUNCATE_LENGTH;
  const displayInput =
    expanded && fullInput
      ? fullInput
      : needsTruncation
        ? tool_input_preview.slice(0, TRUNCATE_LENGTH)
        : tool_input_preview;

  const handleExpand = useCallback(async () => {
    if (expanded) {
      setExpanded(false);
      return;
    }
    // Fetch full detail from GET /api/permissions/:id
    try {
      const res = await fetch(apiUrl(`/api/permissions/${id}`));
      if (res.ok) {
        const data = await res.json();
        setFullInput(
          typeof data.event?.tool_input === 'string'
            ? data.event.tool_input
            : JSON.stringify(data.event?.tool_input, null, 2),
        );
      }
    } catch {
      // Expand with what we have
      setFullInput(tool_input_preview);
    }
    setExpanded(true);
  }, [expanded, id, tool_input_preview]);

  // ── Expired state ──
  if (isExpired) {
    return (
      <div className="bg-amber-950/40 border border-amber-700/40 rounded-lg p-4 shadow-lg">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium text-amber-300">Permission Request</span>
          <span className="text-xs text-amber-400 font-mono">0:00</span>
        </div>
        <p className="text-xs text-amber-300/80 mb-3">
          Timed out — Claude denied and fell back to terminal. You can retry the task.
        </p>
        <div className="flex justify-end">
          <button
            onClick={() => onDismiss(id)}
            className="px-3 py-1.5 text-xs rounded bg-amber-800/50 text-amber-200 hover:bg-amber-800/70 transition-colors"
            aria-label="Dismiss"
          >
            Dismiss
          </button>
        </div>
      </div>
    );
  }

  // ── Active state ──
  return (
    <div className="bg-gray-900/90 border border-gray-700/60 rounded-lg p-4 shadow-lg backdrop-blur-sm">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-medium text-gray-200">Permission Request</span>
        <span
          className={`text-xs font-mono ${remaining < 60_000 ? 'text-red-400' : 'text-gray-400'}`}
        >
          {formatCountdown(remaining)}
        </span>
      </div>

      {/* Tool info */}
      <div className="space-y-1.5 mb-3">
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-gray-500 uppercase w-10">Tool</span>
          <span className="text-xs text-gray-200 font-medium">{tool_name}</span>
        </div>
        <div className="flex items-start gap-2">
          <span className="text-[10px] text-gray-500 uppercase w-10 pt-0.5">Input</span>
          <div className="flex-1 min-w-0">
            <pre
              className={`text-xs text-gray-300 font-mono whitespace-pre-wrap break-all ${expanded ? 'max-h-40 overflow-auto bg-gray-950/50 rounded p-2' : ''}`}
            >
              {displayInput}
            </pre>
            {needsTruncation && (
              <button
                onClick={handleExpand}
                className="text-[10px] text-blue-400 hover:text-blue-300 mt-0.5"
              >
                {expanded ? '[-]' : '[+]'}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Action buttons */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => onDeny(id)}
          className="px-3 py-1.5 text-xs rounded bg-red-900/40 text-red-300 hover:bg-red-900/60 border border-red-800/40 transition-colors"
          aria-label="Deny"
        >
          Deny
        </button>
        <button
          disabled
          aria-disabled="true"
          className="px-3 py-1.5 text-xs rounded bg-gray-800/40 text-gray-600 border border-gray-700/30 cursor-not-allowed"
          aria-label="Always allow"
          title="Coming in v2"
        >
          Always allow
        </button>
        <button
          onClick={() => onApprove(id)}
          className="ml-auto px-4 py-1.5 text-xs rounded bg-green-900/40 text-green-300 hover:bg-green-900/60 border border-green-800/40 transition-colors font-medium"
          aria-label="Approve"
        >
          Approve
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/dashboard && npx vitest run src/components/permissions/__tests__/PermissionApprovalCard.test.tsx`
Expected: All 8 tests PASS

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/components/permissions/PermissionApprovalCard.tsx apps/dashboard/src/components/permissions/__tests__/PermissionApprovalCard.test.tsx
git commit -m "feat(dashboard): add PermissionApprovalCard with countdown timer and expand"
```

---

### Task 4: Create PermissionPanel (floating overlay)

**Files:**

- Create: `apps/dashboard/src/components/permissions/PermissionPanel.tsx`
- Create: `apps/dashboard/src/components/permissions/__tests__/PermissionPanel.test.tsx`

**Context:** Renders stacked `PermissionApprovalCard` components in a floating panel. Connected to `permissionStore`. Positioned bottom-right of the viewport (doesn't overlap with ToolLogPanel on the right).

- [ ] **Step 1: Write the failing test**

Create `apps/dashboard/src/components/permissions/__tests__/PermissionPanel.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('../../../utils/api', () => ({
  apiUrl: (path: string) => path,
}));

import { PermissionPanel } from '../PermissionPanel';
import { usePermissionStore, type PendingSummary } from '../../../store/permissionStore';

function resetStore() {
  usePermissionStore.setState({ pending: [], resolved: [] });
}

function makePending(overrides: Partial<PendingSummary> = {}): PendingSummary {
  return {
    id: overrides.id ?? 'perm-1',
    tool_name: overrides.tool_name ?? 'Bash',
    tool_input_preview: overrides.tool_input_preview ?? 'echo hello',
    createdAt: overrides.createdAt ?? Date.now(),
    expiresAt: overrides.expiresAt ?? Date.now() + 1_800_000,
  };
}

describe('PermissionPanel', () => {
  beforeEach(() => resetStore());

  it('renders nothing when no pending permissions', () => {
    const { container } = render(<PermissionPanel />);
    expect(container.children.length).toBe(0);
  });

  it('renders a card for each pending permission', () => {
    usePermissionStore.getState().addPending(makePending({ id: 'p-1', tool_name: 'Bash' }));
    usePermissionStore.getState().addPending(makePending({ id: 'p-2', tool_name: 'Write' }));

    render(<PermissionPanel />);
    expect(screen.getByText('Bash')).toBeTruthy();
    expect(screen.getByText('Write')).toBeTruthy();
  });

  it('shows pending count badge when multiple cards', () => {
    usePermissionStore.getState().addPending(makePending({ id: 'p-1' }));
    usePermissionStore.getState().addPending(makePending({ id: 'p-2' }));
    usePermissionStore.getState().addPending(makePending({ id: 'p-3' }));

    render(<PermissionPanel />);
    expect(screen.getByText('3 pending')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/dashboard && npx vitest run src/components/permissions/__tests__/PermissionPanel.test.tsx`
Expected: FAIL — module `../PermissionPanel` not found

- [ ] **Step 3: Write minimal implementation**

Create `apps/dashboard/src/components/permissions/PermissionPanel.tsx`:

```tsx
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bernhard

import { useCallback } from 'react';
import { usePermissionStore } from '../../store/permissionStore';
import { PermissionApprovalCard } from './PermissionApprovalCard';

export function PermissionPanel() {
  const pending = usePermissionStore((s) => s.pending);
  const approve = usePermissionStore((s) => s.approve);
  const deny = usePermissionStore((s) => s.deny);
  const resolvePending = usePermissionStore((s) => s.resolvePending);

  const handleDismiss = useCallback(
    (id: string) => resolvePending(id, 'deny'),
    [resolvePending],
  );

  if (pending.length === 0) return null;

  return (
    {/* <!-- revised: P1 — position left of ToolLogPanel (which is right-0 w-80) --> */}
    <div className="fixed bottom-4 right-[340px] z-50 flex flex-col gap-3 w-80 max-h-[80vh] overflow-y-auto">
      {/* Badge showing count */}
      {pending.length > 1 && (
        <div className="text-xs text-gray-400 text-center bg-gray-900/80 rounded-full px-3 py-1 self-center backdrop-blur-sm border border-gray-700/40">
          {pending.length} pending
        </div>
      )}
      {/* Stacked cards — oldest first */}
      {pending.map((p) => (
        <PermissionApprovalCard
          key={p.id}
          permission={p}
          onApprove={approve}
          onDeny={deny}
          onDismiss={handleDismiss}
        />
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/dashboard && npx vitest run src/components/permissions/__tests__/PermissionPanel.test.tsx`
Expected: All 3 tests PASS

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/components/permissions/PermissionPanel.tsx apps/dashboard/src/components/permissions/__tests__/PermissionPanel.test.tsx
git commit -m "feat(dashboard): add PermissionPanel floating overlay for stacked approval cards"
```

---

### Task 5: Wire PermissionPanel into App layout

**Files:**

- Modify: `apps/dashboard/src/App.tsx`

**Context:** The `PermissionPanel` needs to render as a floating overlay in the main app layout. It should be a sibling of the main content, positioned via `fixed` CSS (already in PermissionPanel). Find where the main content container is rendered in App.tsx and add `<PermissionPanel />` alongside it.

- [ ] **Step 1: Read App.tsx to find the right insertion point**

Read `apps/dashboard/src/App.tsx` and identify where floating overlays or panels are rendered.

- [ ] **Step 2: Add PermissionPanel to App.tsx**

Add import:

```typescript
import { PermissionPanel } from './components/permissions/PermissionPanel';
```

Add `<PermissionPanel />` as a sibling element inside the main layout container (near other floating elements like toasts or dialogs).

- [ ] **Step 3: Verify build compiles**

Run: `cd apps/dashboard && npx tsc --noEmit`
Expected: No type errors

- [ ] **Step 4: Commit**

```bash
git add apps/dashboard/src/App.tsx
git commit -m "feat(dashboard): render PermissionPanel floating overlay in app layout"
```

---

## Chunk 3: Hook Controls Settings Tab

### Task 6: Create HookControlsTab component

**Files:**

- Create: `apps/dashboard/src/components/settings/HookControlsTab.tsx`
- Create: `apps/dashboard/src/components/settings/__tests__/HookControlsTab.test.tsx`

**Context:**

- This is a new settings panel/dialog (NOT a section inside ViewSettingsDropdown — it's too large for that)
- Shows: hook server status indicator, setup instructions with JSON snippet, "Copy config snippet" button, permissions.allow bypass note
- Hook server status: polls `GET /api/hook-server/status` when opened → green/red badge
- Config snippet to copy:

```json
{
  "hooks": {
    "PermissionRequest": [
      {
        "type": "http",
        "url": "http://localhost:27247/api/hooks/permission"
      }
    ]
  }
}
```

- Info note: "Tools in your permissions.allow list bypass this routing — they run without a prompt."
- Refer to the "Hook Controls" wireframe in the design spec for full layout

- [ ] **Step 1: Write the failing test**

Create `apps/dashboard/src/components/settings/__tests__/HookControlsTab.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('../../../utils/api', () => ({
  apiUrl: (path: string) => path,
}));

import { HookControlsTab } from '../HookControlsTab';

describe('HookControlsTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders Hook Controls heading', () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ running: true, port: 27247, pending: 0 }),
    });

    render(<HookControlsTab open onClose={() => {}} />);
    expect(screen.getByText(/hook controls/i)).toBeTruthy();
  });

  it('shows green status when hook server is running', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ running: true, port: 27247, pending: 0 }),
    });

    render(<HookControlsTab open onClose={() => {}} />);
    await waitFor(() => {
      expect(screen.getByText(/running/i)).toBeTruthy();
    });
  });

  it('shows red status when hook server is unavailable', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ running: false, port: 27247 }),
    });

    render(<HookControlsTab open onClose={() => {}} />);
    await waitFor(() => {
      expect(screen.getByText(/unavailable/i)).toBeTruthy();
    });
  });

  it('shows config snippet', () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ running: true, port: 27247, pending: 0 }),
    });

    render(<HookControlsTab open onClose={() => {}} />);
    expect(screen.getByText(/PermissionRequest/)).toBeTruthy();
  });

  it('has a copy config button', () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ running: true, port: 27247, pending: 0 }),
    });

    render(<HookControlsTab open onClose={() => {}} />);
    expect(screen.getByRole('button', { name: /copy/i })).toBeTruthy();
  });

  it('shows permissions.allow bypass note', () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ running: true, port: 27247, pending: 0 }),
    });

    render(<HookControlsTab open onClose={() => {}} />);
    expect(screen.getByText(/permissions\.allow/)).toBeTruthy();
  });

  it('renders nothing when not open', () => {
    const { container } = render(<HookControlsTab open={false} onClose={() => {}} />);
    expect(container.children.length).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/dashboard && npx vitest run src/components/settings/__tests__/HookControlsTab.test.tsx`
Expected: FAIL — module `../HookControlsTab` not found

- [ ] **Step 3: Write minimal implementation**

Create `apps/dashboard/src/components/settings/HookControlsTab.tsx`:

```tsx
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bernhard

import { useState, useEffect, useCallback } from 'react';
import { apiUrl } from '../../utils/api';
import { QRCodePanel } from './QRCodePanel';
import { usePermissionStore } from '../../store/permissionStore'; // <!-- revised: P1 — for session stats -->

interface Props {
  open: boolean;
  onClose: () => void;
}

interface HookStatus {
  running: boolean;
  port: number;
  pending?: number;
}

const CONFIG_SNIPPET = JSON.stringify(
  {
    hooks: {
      PermissionRequest: [
        {
          type: 'http',
          url: 'http://localhost:27247/api/hooks/permission',
        },
      ],
    },
  },
  null,
  2,
);

export function HookControlsTab({ open, onClose }: Props) {
  const [status, setStatus] = useState<HookStatus | null>(null);
  const [copied, setCopied] = useState(false);

  // Poll hook server status when tab opens
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    fetch(apiUrl('/api/hook-server/status'))
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled) setStatus(data);
      })
      .catch(() => {
        if (!cancelled) setStatus({ running: false, port: 27247 });
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(CONFIG_SNIPPET);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback — select text in the pre block
    }
  }, []);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-[#1c2128] border border-gray-700 rounded-xl shadow-2xl w-full max-w-lg max-h-[85vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-700/50">
          <h2 className="text-sm font-semibold text-gray-200">Hook Controls</h2>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-300 transition-colors"
            aria-label="Close"
          >
            <svg
              className="w-4 h-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-5 space-y-6">
          {/* QR Code section */}
          <QRCodePanel />

          {/* Hook Server Status */}
          <section>
            <h3 className="text-xs text-gray-500 uppercase tracking-wider mb-2">
              Hook Server Status
            </h3>
            <div className="flex items-center gap-2">
              <span
                className={`w-2 h-2 rounded-full ${status?.running ? 'bg-green-400' : 'bg-red-400'}`}
              />
              <span className="text-xs text-gray-300">
                {status?.running
                  ? `Running on port ${status.port}`
                  : 'Unavailable — using terminal fallback'}
              </span>
              {status?.running && status.pending != null && status.pending > 0 && (
                <span className="text-[10px] text-amber-400 ml-auto">{status.pending} pending</span>
              )}
            </div>
          </section>

          {/* Permission Approval Setup */}
          <section>
            <h3 className="text-xs text-gray-500 uppercase tracking-wider mb-2">
              Permission Approval
            </h3>
            <p className="text-xs text-gray-400 mb-3">
              Route permission prompts to this dashboard. Add to{' '}
              <code className="text-gray-300 bg-gray-800 px-1 rounded">.claude/settings.json</code>:
            </p>
            <pre className="bg-gray-950/60 border border-gray-800 rounded-lg p-3 text-[11px] text-gray-300 font-mono overflow-x-auto">
              {CONFIG_SNIPPET}
            </pre>
            <button
              onClick={handleCopy}
              className="mt-2 flex items-center gap-1.5 px-3 py-1.5 text-xs rounded bg-gray-800 text-gray-300 hover:bg-gray-700 transition-colors border border-gray-700/50"
              aria-label={copied ? 'Copied' : 'Copy config snippet'}
            >
              {copied ? 'Copied!' : 'Copy config snippet'}
            </button>
          </section>

          {/* <!-- revised: P1 — simple permission stats from resolved array --> */}
          {(() => {
            // Pull stats from permissionStore resolved list
            // Import usePermissionStore at top of file
            const resolved = usePermissionStore((s) => s.resolved);
            const approved = resolved.filter((r) => r.behavior === 'allow').length;
            const denied = resolved.filter((r) => r.behavior === 'deny').length;
            if (resolved.length === 0) return null;
            return (
              <section>
                <h3 className="text-xs text-gray-500 uppercase tracking-wider mb-2">
                  Session Stats
                </h3>
                <div className="flex items-center gap-4 text-xs text-gray-400">
                  <span className="text-green-400">{approved} approved</span>
                  <span className="text-red-400">{denied} denied</span>
                </div>
              </section>
            );
          })()}

          {/* Bypass note */}
          <div className="bg-blue-950/20 border border-blue-800/30 rounded-lg p-3">
            <p className="text-[11px] text-blue-300/80 leading-relaxed">
              Tools in your{' '}
              <code className="text-blue-200 bg-blue-900/30 px-1 rounded">permissions.allow</code>{' '}
              list bypass this routing — they run without a prompt. Only tools not yet in your allow
              list will appear as permission cards.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
```

<!-- revised: P1 — promoted QRCodePanel stub from optional note to mandatory step -->

- [ ] **Step 3a: Create QRCodePanel stub (REQUIRED — HookControlsTab imports it)**

Create `apps/dashboard/src/components/settings/QRCodePanel.tsx` (stub — real implementation in Task 9):

```tsx
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bernhard
// Stub — real implementation in Task 8

export function QRCodePanel() {
  return (
    <section>
      <h3 className="text-xs text-gray-500 uppercase tracking-wider mb-2">Open on your phone</h3>
      <p className="text-xs text-gray-400">QR code loading...</p>
    </section>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/dashboard && npx vitest run src/components/settings/__tests__/HookControlsTab.test.tsx`
Expected: All 7 tests PASS

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/components/settings/HookControlsTab.tsx apps/dashboard/src/components/settings/QRCodePanel.tsx apps/dashboard/src/components/settings/__tests__/HookControlsTab.test.tsx
git commit -m "feat(dashboard): add HookControlsTab with server status, config snippet, and QR stub"
```

---

### Task 7: Wire HookControlsTab into Header

**Files:**

- Modify: `apps/dashboard/src/components/layout/Header.tsx`

**Context:** The HookControlsTab dialog needs a trigger button in the header. Look at how existing header buttons (settings gear, etc.) are implemented. Add a hook/shield icon button that opens the HookControlsTab dialog. The dialog is rendered as a modal overlay, so it can be toggled with `useState<boolean>` directly in the Header component.

- [ ] **Step 1: Read Header.tsx to understand the layout**

Read `apps/dashboard/src/components/layout/Header.tsx` and identify where toolbar buttons are rendered.

- [ ] **Step 2: Add HookControlsTab trigger button**

Add import:

```typescript
import { HookControlsTab } from '../settings/HookControlsTab';
```

Add state:

```typescript
const [hookControlsOpen, setHookControlsOpen] = useState(false);
```

Add button in the toolbar (near other settings buttons):

```tsx
<Tooltip content="Hook Controls">
  <button
    onClick={() => setHookControlsOpen(true)}
    className="flex items-center justify-center w-7 h-7 rounded text-gray-400 hover:text-gray-200 bg-gray-800 hover:bg-gray-700 transition-colors"
    aria-label="Hook Controls"
  >
    <svg
      className="w-3.5 h-3.5"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
      />
    </svg>
  </button>
</Tooltip>
```

Render the dialog (outside the toolbar, at the component root level):

```tsx
<HookControlsTab open={hookControlsOpen} onClose={() => setHookControlsOpen(false)} />
```

- [ ] **Step 3: Verify build compiles**

Run: `cd apps/dashboard && npx tsc --noEmit`
Expected: No type errors

- [ ] **Step 4: Commit**

```bash
git add apps/dashboard/src/components/layout/Header.tsx
git commit -m "feat(dashboard): add Hook Controls button in header toolbar"
```

---

## Chunk 4: Network Endpoint + QR Code Panel + Manifest

### Task 8: Create GET /api/network/local-url backend endpoint

**Files:**

- Create: `packages/server/src/routes/network.ts`
- Create: `packages/server/src/__tests__/networkRoutes.test.ts`
- Modify: `packages/server/src/index.ts` (mount router)

**Context:** This endpoint uses `os.networkInterfaces()` with the LAN IP selection heuristic from Decision 12:

1. Filter to IPv4 only
2. Exclude loopback (127.x.x.x)
3. Exclude Docker bridges (172.17-31.x.x)
4. Exclude Tailscale (100.x.x.x)
5. Exclude link-local (169.254.x.x)
6. Prefer 192.168.x.x or 10.x.x.x
7. First match wins
8. No match → `localhost` + `{ warning: 'No LAN interface detected' }`

Response shape: `{ ip: string, port: number, url: string, warning?: string }`

- [ ] **Step 1: Write the failing test**

Create `packages/server/src/__tests__/networkRoutes.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import os from 'os';
import { selectLanIp } from '../routes/network';

// Test the pure heuristic function, not the Express route
describe('selectLanIp', () => {
  it('selects 192.168.x.x address', () => {
    const interfaces: NodeJS.Dict<os.NetworkInterfaceInfo[]> = {
      lo: [
        {
          address: '127.0.0.1',
          family: 'IPv4',
          internal: true,
          netmask: '255.0.0.0',
          mac: '',
          cidr: '',
        },
      ],
      eth0: [
        {
          address: '192.168.1.100',
          family: 'IPv4',
          internal: false,
          netmask: '255.255.255.0',
          mac: '',
          cidr: '',
        },
      ],
    };
    expect(selectLanIp(interfaces)).toBe('192.168.1.100');
  });

  it('selects 10.x.x.x address', () => {
    const interfaces: NodeJS.Dict<os.NetworkInterfaceInfo[]> = {
      eth0: [
        {
          address: '10.0.0.42',
          family: 'IPv4',
          internal: false,
          netmask: '255.255.255.0',
          mac: '',
          cidr: '',
        },
      ],
    };
    expect(selectLanIp(interfaces)).toBe('10.0.0.42');
  });

  it('excludes Docker bridge (172.17.x.x)', () => {
    const interfaces: NodeJS.Dict<os.NetworkInterfaceInfo[]> = {
      docker0: [
        {
          address: '172.17.0.1',
          family: 'IPv4',
          internal: false,
          netmask: '255.255.0.0',
          mac: '',
          cidr: '',
        },
      ],
      eth0: [
        {
          address: '192.168.1.50',
          family: 'IPv4',
          internal: false,
          netmask: '255.255.255.0',
          mac: '',
          cidr: '',
        },
      ],
    };
    expect(selectLanIp(interfaces)).toBe('192.168.1.50');
  });

  it('excludes Tailscale (100.x.x.x)', () => {
    const interfaces: NodeJS.Dict<os.NetworkInterfaceInfo[]> = {
      tailscale0: [
        {
          address: '100.64.0.1',
          family: 'IPv4',
          internal: false,
          netmask: '255.255.255.0',
          mac: '',
          cidr: '',
        },
      ],
      eth0: [
        {
          address: '10.0.1.5',
          family: 'IPv4',
          internal: false,
          netmask: '255.255.255.0',
          mac: '',
          cidr: '',
        },
      ],
    };
    expect(selectLanIp(interfaces)).toBe('10.0.1.5');
  });

  it('excludes link-local (169.254.x.x)', () => {
    const interfaces: NodeJS.Dict<os.NetworkInterfaceInfo[]> = {
      wlan0: [
        {
          address: '169.254.1.1',
          family: 'IPv4',
          internal: false,
          netmask: '255.255.0.0',
          mac: '',
          cidr: '',
        },
      ],
    };
    expect(selectLanIp(interfaces)).toBeNull();
  });

  it('returns null when no suitable interface found', () => {
    const interfaces: NodeJS.Dict<os.NetworkInterfaceInfo[]> = {
      lo: [
        {
          address: '127.0.0.1',
          family: 'IPv4',
          internal: true,
          netmask: '255.0.0.0',
          mac: '',
          cidr: '',
        },
      ],
    };
    expect(selectLanIp(interfaces)).toBeNull();
  });

  it('excludes IPv6 addresses', () => {
    const interfaces: NodeJS.Dict<os.NetworkInterfaceInfo[]> = {
      eth0: [
        {
          address: 'fe80::1',
          family: 'IPv6',
          internal: false,
          netmask: 'ffff::',
          mac: '',
          cidr: '',
          scopeid: 0,
        },
      ],
    };
    expect(selectLanIp(interfaces)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/server && npx vitest run src/__tests__/networkRoutes.test.ts`
Expected: FAIL — module `../routes/network` not found

- [ ] **Step 3: Write minimal implementation**

Create `packages/server/src/routes/network.ts`:

```typescript
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bernhard

import { Router, type Request, type Response } from 'express';
import os from 'os';

/**
 * Select the best LAN IP from os.networkInterfaces().
 * Exported for unit testing without Express.
 */
export function selectLanIp(interfaces: NodeJS.Dict<os.NetworkInterfaceInfo[]>): string | null {
  const candidates: string[] = [];

  for (const ifaceList of Object.values(interfaces)) {
    if (!ifaceList) continue;
    for (const iface of ifaceList) {
      // IPv4 only
      if (iface.family !== 'IPv4' && (iface.family as unknown) !== 4) continue;
      // Exclude loopback
      if (iface.internal) continue;
      const addr = iface.address;
      // Exclude loopback range
      if (addr.startsWith('127.')) continue;
      // Exclude Docker bridges (172.17.0.0 – 172.31.255.255)
      if (addr.startsWith('172.')) {
        const second = parseInt(addr.split('.')[1], 10);
        if (second >= 17 && second <= 31) continue;
      }
      // Exclude Tailscale (100.x.x.x)
      if (addr.startsWith('100.')) continue;
      // Exclude link-local (169.254.x.x)
      if (addr.startsWith('169.254.')) continue;

      candidates.push(addr);
    }
  }

  // Prefer 192.168.x.x or 10.x.x.x (typical home/office LAN)
  const preferred = candidates.find((a) => a.startsWith('192.168.') || a.startsWith('10.'));
  return preferred ?? candidates[0] ?? null;
}

export function createNetworkRouter(serverPort: number): Router {
  const router = Router();

  // <!-- revised: P1 — accept ?dashboardPort query param for dev mode (Vite on 5173 vs server on 27246) -->
  // GET /api/network/local-url
  router.get('/local-url', (req: Request, res: Response) => {
    const interfaces = os.networkInterfaces();
    const ip = selectLanIp(interfaces);
    // In dev, the frontend passes its own port so the QR points to the dashboard, not the API
    const effectivePort = req.query.dashboardPort
      ? parseInt(req.query.dashboardPort as string, 10)
      : serverPort;

    if (ip) {
      res.json({
        ip,
        port: effectivePort,
        url: `http://${ip}:${effectivePort}`,
      });
    } else {
      res.json({
        ip: 'localhost',
        port: effectivePort,
        url: `http://localhost:${effectivePort}`,
        warning: 'No LAN interface detected',
      });
    }
  });

  return router;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/server && npx vitest run src/__tests__/networkRoutes.test.ts`
Expected: All 7 tests PASS

- [ ] **Step 5: Mount router in index.ts**

In `packages/server/src/index.ts`, add:

```typescript
import { createNetworkRouter } from './routes/network.js';
```

Mount (near other router registrations):

```typescript
app.use('/api/network', createNetworkRouter(port));
```

Where `port` is the main server port variable already in scope.

- [ ] **Step 6: Verify server builds**

Run: `cd packages/server && npx tsc --noEmit`
Expected: No type errors

- [ ] **Step 7: Commit**

```bash
git add packages/server/src/routes/network.ts packages/server/src/__tests__/networkRoutes.test.ts packages/server/src/index.ts
git commit -m "feat(server): add GET /api/network/local-url with LAN IP heuristic"
```

---

### Task 9: Install qrcode package and implement QRCodePanel

**Files:**

- Modify: `apps/dashboard/src/components/settings/QRCodePanel.tsx` (replace stub from Task 6)
- Create: `apps/dashboard/src/components/settings/__tests__/QRCodePanel.test.tsx`

**Context:**

- Uses `qrcode` npm package to generate QR code as data URL (canvas-based)
- Fetches `GET /api/network/local-url` on mount + on "Refresh QR" button click (spec says "every render" but `useEffect([fetchKey])` is the correct approach — literal "every render" would cause infinite loops)
- "Refresh QR" button re-fetches
- "Copy link" button copies the URL to clipboard
- Shows amber warning if `warning` field present in response
- Live-updating URL display below QR code
- **Package choice:** `qrcode` (not `qrcode.react`) — simpler, generates a data URL string, no React dependency conflict

- [ ] **Step 1: Install qrcode**

Run: `cd apps/dashboard && pnpm add qrcode && pnpm add -D @types/qrcode`

- [ ] **Step 2: Write the failing test**

Create `apps/dashboard/src/components/settings/__tests__/QRCodePanel.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

vi.mock('../../../utils/api', () => ({
  apiUrl: (path: string) => path,
}));

// Mock qrcode to avoid canvas dependency in jsdom
vi.mock('qrcode', () => ({
  default: { toDataURL: vi.fn().mockResolvedValue('data:image/png;base64,FAKE') },
}));

import { QRCodePanel } from '../QRCodePanel';

describe('QRCodePanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          ip: '192.168.1.100',
          port: 27246,
          url: 'http://192.168.1.100:27246',
        }),
    });
  });

  it('renders section heading', async () => {
    render(<QRCodePanel />);
    expect(screen.getByText(/open on your phone/i)).toBeTruthy();
  });

  it('fetches local URL on render', async () => {
    render(<QRCodePanel />);
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/network/local-url');
    });
  });

  it('displays the URL', async () => {
    render(<QRCodePanel />);
    await waitFor(() => {
      expect(screen.getByText('http://192.168.1.100:27246')).toBeTruthy();
    });
  });

  it('shows amber warning when present', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          ip: 'localhost',
          port: 27246,
          url: 'http://localhost:27246',
          warning: 'No LAN interface detected',
        }),
    });

    render(<QRCodePanel />);
    await waitFor(() => {
      expect(screen.getByText(/no lan interface/i)).toBeTruthy();
    });
  });

  it('has a Copy link button', async () => {
    render(<QRCodePanel />);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /copy link/i })).toBeTruthy();
    });
  });

  it('has a Refresh QR button', async () => {
    render(<QRCodePanel />);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /refresh/i })).toBeTruthy();
    });
  });

  it('re-fetches on Refresh QR click', async () => {
    render(<QRCodePanel />);
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });
    fireEvent.click(screen.getByRole('button', { name: /refresh/i }));
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd apps/dashboard && npx vitest run src/components/settings/__tests__/QRCodePanel.test.tsx`
Expected: FAIL — current stub doesn't have the expected behavior

- [ ] **Step 4: Replace stub with real implementation**

Replace `apps/dashboard/src/components/settings/QRCodePanel.tsx`:

```tsx
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bernhard

import { useState, useEffect, useCallback } from 'react';
import QRCode from 'qrcode';
import { apiUrl } from '../../utils/api';

interface LocalUrlResponse {
  ip: string;
  port: number;
  url: string;
  warning?: string;
}

export function QRCodePanel() {
  const [data, setData] = useState<LocalUrlResponse | null>(null);
  const [qrSrc, setQrSrc] = useState<string | null>(null);
  const [fetchKey, setFetchKey] = useState(0);
  const [linkCopied, setLinkCopied] = useState(false);

  // Fetch local URL on every render trigger (mount + refresh clicks)
  useEffect(() => {
    let cancelled = false;
    // <!-- revised: P1 — pass dashboardPort so QR points to dashboard, not API server in dev -->
    const dashboardPort = window.location.port;
    const qs = dashboardPort ? `?dashboardPort=${dashboardPort}` : '';
    fetch(apiUrl(`/api/network/local-url${qs}`))
      .then((r) => r.json())
      .then(async (result: LocalUrlResponse) => {
        if (cancelled) return;
        setData(result);
        try {
          const src = await QRCode.toDataURL(result.url, {
            width: 160,
            margin: 2,
            color: { dark: '#e5e7eb', light: '#00000000' },
          });
          if (!cancelled) setQrSrc(src);
        } catch {
          // QR generation failed — show URL only
        }
      })
      .catch(() => {
        if (!cancelled) setData(null);
      });
    return () => {
      cancelled = true;
    };
  }, [fetchKey]);

  const handleRefresh = useCallback(() => {
    setFetchKey((k) => k + 1);
  }, []);

  const handleCopyLink = useCallback(async () => {
    if (!data) return;
    try {
      await navigator.clipboard.writeText(data.url);
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2000);
    } catch {
      /* clipboard API unavailable */
    }
  }, [data]);

  return (
    <section>
      <h3 className="text-xs text-gray-500 uppercase tracking-wider mb-2">Open on your phone</h3>
      <div className="flex items-start gap-4">
        {/* QR Code */}
        <div className="flex-shrink-0">
          {qrSrc ? (
            <img src={qrSrc} alt="QR code for local URL" className="w-24 h-24 rounded" />
          ) : (
            <div className="w-24 h-24 bg-gray-800 rounded flex items-center justify-center">
              <span className="text-[10px] text-gray-600">Loading...</span>
            </div>
          )}
        </div>
        {/* Info */}
        <div className="flex-1 min-w-0">
          <p className="text-xs text-gray-400 mb-1">
            Scan to open Synapse on any device on your network.
          </p>
          {data && (
            <code className="text-xs text-blue-300 bg-gray-900 px-2 py-1 rounded block truncate">
              {data.url}
            </code>
          )}
          {data?.warning && <p className="text-[10px] text-amber-400 mt-1">{data.warning}</p>}
          <div className="flex items-center gap-3 mt-2">
            <button
              onClick={handleCopyLink}
              className="text-[10px] text-blue-400 hover:text-blue-300 transition-colors"
              aria-label={linkCopied ? 'Copied' : 'Copy link'}
            >
              {linkCopied ? 'Copied!' : 'Copy link'}
            </button>
            <button
              onClick={handleRefresh}
              className="text-[10px] text-gray-500 hover:text-gray-300 transition-colors"
              aria-label="Refresh QR"
            >
              Refresh QR
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd apps/dashboard && npx vitest run src/components/settings/__tests__/QRCodePanel.test.tsx`
Expected: All 6 tests PASS

- [ ] **Step 6: Commit**

```bash
git add apps/dashboard/src/components/settings/QRCodePanel.tsx apps/dashboard/src/components/settings/__tests__/QRCodePanel.test.tsx apps/dashboard/package.json pnpm-lock.yaml
git commit -m "feat(dashboard): add QRCodePanel with LAN URL and qrcode generation"
```

---

### Task 10: Create manifest.json and link in index.html

**Files:**

- Create: `apps/dashboard/public/manifest.json`
- Modify: `apps/dashboard/index.html`

**Context:** A PWA manifest lets iOS "Add to Home Screen" show a proper app name and icon. Vite serves the `public/` directory as-is at the root URL. The manifest must include `display: "standalone"` for the PWA to open without browser chrome. Icons can use a simple SVG or placeholder for now.

- [ ] **Step 1: Create the public directory and manifest**

Run: `mkdir -p apps/dashboard/public` (if it doesn't exist)

Create `apps/dashboard/public/manifest.json`:

```json
{
  "name": "Synapse",
  "short_name": "Synapse",
  "description": "Interactive Agent Orchestration Dashboard",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#0d1117",
  "theme_color": "#0d1117",
  "icons": []
}
```

**Note on icons:** The `icons` array is empty for now — browsers fall back to a generic icon. When real icons are available (from `apps/vscode/` assets or a designer), add `{ src, sizes, type }` entries. This is a cosmetic follow-up, not a blocker for Phase A2.

- [ ] **Step 2: Link manifest in index.html**

In `apps/dashboard/index.html`, add inside `<head>`:

```html
<link rel="manifest" href="/manifest.json" />
<meta name="theme-color" content="#0d1117" />
<meta name="apple-mobile-web-app-capable" content="yes" />
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
```

The full `<head>` should look like:

```html
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
  <title>Synapse</title>
  <link rel="manifest" href="/manifest.json" />
  <meta name="theme-color" content="#0d1117" />
  <meta name="apple-mobile-web-app-capable" content="yes" />
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
</head>
```

- [ ] **Step 3: Verify Vite serves manifest**

Run: `cd apps/dashboard && npx vite build` (or `pnpm build`)
Expected: Build succeeds, `dist/manifest.json` present in output

- [ ] **Step 4: Commit**

```bash
git add apps/dashboard/public/manifest.json apps/dashboard/index.html
git commit -m "feat(dashboard): add PWA manifest for Add to Home Screen support"
```

---

## Chunk 5: Gate A2 Verification + Empirical Testing

### Task 11: Gate A2 — End-to-end verification

**Files:** None (manual testing)

**Context:** This is the acceptance gate for Phase A2. It requires:

1. The backend (Phase A1) running with hook server on port 27247
2. The frontend (Phase A2) running
3. A phone browser already open to the dashboard URL (QR code scan)

**Prerequisites:**

- Start server: `.\start-server.ps1`
- Start client: `.\start-client.ps1`
- Open dashboard in browser

- [ ] **Step 1: Simulate a pending permission**

Send a simulated hook request **in a separate terminal** (the request will block until resolved):

```bash
# Run in a SEPARATE terminal — this will hang until approved/denied/timed out
curl -X POST http://localhost:27247/api/hooks/permission \
  -H "Content-Type: application/json" \
  -d '{"session_id":"test-session","tool_name":"Bash","tool_input":"rm -rf build/","hook_event_name":"PermissionRequest"}'
```

**Windows note:** Use Git Bash or PowerShell. The request blocks until the permission is resolved, so you need a separate terminal to interact with the dashboard.

- [ ] **Step 2: Verify dashboard shows permission card**

Expected behavior:

- Dashboard shows a `PermissionApprovalCard` in the bottom-right corner
- Card shows tool name "Bash", truncated input "rm -rf build/"
- Countdown timer is running (starting from ~30:00)
- Approve and Deny buttons are visible
- "Always allow" button is disabled

**Diagnostic:** If the card does NOT appear, open browser DevTools → Network → WS tab. Check that a `pendingPermission` message was received on the WebSocket. If not, the WS broadcast may be failing — check server logs.

- [ ] **Step 3: Approve from dashboard**

Click "Approve" on the card.

Expected behavior:

- Card disappears (or shows green "Approved" briefly)
- The `curl` command in terminal completes with response:

  ```json
  {
    "hookSpecificOutput": {
      "hookEventName": "PermissionRequest",
      "decision": { "behavior": "allow" }
    }
  }
  ```

- [ ] **Step 4: Test deny flow**

Repeat Step 1, but click "Deny" instead.

Expected: curl returns `decision: { behavior: "deny" }`.

- [ ] **Step 5: Test mobile access via QR**

1. Open Hook Controls in header
2. Scan QR code with phone
3. Phone browser opens dashboard
4. Send another simulated permission (Step 1)
5. Verify card appears on phone
6. Approve from phone — verify curl completes

- [ ] **Step 6: Test timeout behavior**

Send a permission with a very short timeout (set `SYNAPSE_PERMISSION_TIMEOUT_MS=10000` env var, or use default and wait).

Expected: Card shows countdown → hits 0:00 → amber "Timed out" state → curl returns deny.

- [ ] **Step 7: Test hydration on page refresh**

1. Send a permission (don't resolve it)
2. Refresh the dashboard page
3. Card should reappear (hydrated from `GET /api/permissions/pending`)

- [ ] **Step 8: Document gate result**

Record pass/fail for each sub-step. If any fail, create a bug-fix task before proceeding.

---

### Task 12: Empirical testing — Open Questions (documentation only)

<!-- revised: P1 — scoped to documentation only; code changes from findings become Phase A2.1 -->

**Files:** None (manual testing + documentation)
**Scope:** This task produces documentation ONLY. Any code changes identified become Phase A2.1 tasks.

**Context:** Two open questions from the spec must be resolved empirically:

**Open Question 1: Timeout deny behavior**

> Does explicit `behavior: "deny"` on timeout cause Claude to log a visible error or interrupt the session? Is there a documented "fall through to terminal" signal?

**Open Question 2: Claude Code behavior on 429 from HTTP hook**

> Does it treat it as non-blocking (fall through to terminal) or a hard error?

- [ ] **Step 1: Test timeout deny with real Claude Code**

1. Configure `.claude/settings.json` with the HTTP hook pointing to port 27247
2. Start a Claude Code session
3. Trigger an action that requires permission (e.g., `Bash` tool)
4. Let the permission timeout (don't approve/deny)
5. Observe: Does Claude show an error? Does it fall back to terminal prompt? Does it continue?
6. Record exact behavior and any error messages.

- [ ] **Step 2: Test 429 behavior with real Claude Code**

1. Set `MAX_PENDING = 0` temporarily (or fill up 50 pending slots)
2. Trigger a permission request
3. Hook server returns 429
4. Observe: Does Claude fall through to terminal? Does it show an error?
5. Record exact behavior.

- [ ] **Step 3: Document findings**

Create or update a section in `docs/superpowers/specs/2026-03-11-remote-approval-and-prompt-interceptor-design.md` under "Open Questions" with the empirical results:

```markdown
### Open Question 1 — RESOLVED

[Describe findings: what Claude Code does on timeout deny]

### Open Question 2 — RESOLVED

[Describe findings: what Claude Code does on 429]
```

- [ ] **Step 4: Document recommended code changes (DO NOT implement yet)**

<!-- revised: P0 — scoped to documentation only; code changes are Phase A2.1 -->

Based on findings, document recommended changes in the spec under "Recommended Fixes". Do NOT implement code changes in this task — they become Phase A2.1 tasks with their own test coverage.

**Pre-defined fallback matrix** (apply the matching row based on empirical results):

| Finding                                         | Fallback                                                                                           |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Timeout deny causes Claude error/crash          | Change hook server timeout handler to return `{}` (empty object) instead of `{ behavior: "deny" }` |
| Timeout deny causes visible but non-fatal error | Acceptable — document the error message for users                                                  |
| Timeout deny works cleanly (falls to terminal)  | No change needed                                                                                   |
| 429 causes hard error in Claude                 | Change hook server to return `{ behavior: "deny" }` with 200 status instead of 429                 |
| 429 causes non-blocking fallthrough             | No change needed — 429 is correct behavior                                                         |

---

## Implementation Notes

### Zustand patterns (critical)

- **Module-level empty arrays:** `const EMPTY: T[] = []` — use these as initial values to avoid infinite re-renders in selectors. See `agentStore.ts:23` for example.
- **`getState()` for async actions:** Use `get()` inside store definition, `usePermissionStore.getState()` outside. See `agentStore.ts:156` for example.
- **Separate store:** `permissionStore` is a separate `create()` call, NOT merged into `agentStore`. It receives WS messages via the exported `handlePermissionWsMessage()` function called from `agentStore.ts`.

### WS message routing

- The `wsClient.setOnEvent()` callback in `agentStore.ts` is the single entry point for all WS messages. Route permission messages at the top before other handlers, using the `handlePermissionWsMessage()` function which returns `true` if it handled the message.

### Test patterns

- `// @vitest-environment jsdom` comment at top of file for browser tests
- `vi.mock()` BEFORE imports of modules that depend on mocked modules
- `resetStore()` helper in `beforeEach`
- `global.fetch = vi.fn()` for API mocking in jsdom
- Run tests: `cd apps/dashboard && npx vitest run <path>` or `cd packages/server && npx vitest run <path>`

### API call pattern

- Use `apiUrl()` from `apps/dashboard/src/utils/api.ts` to wrap all fetch URLs
- Simple `fetch()` — no axios. See `utils/api.ts` for existing patterns.

### Component test pattern

- `@testing-library/react` with `render`, `screen`, `fireEvent`, `waitFor`
- Already a devDependency in `apps/dashboard`

---

## Open Questions / Deferred (P2)

<!-- These findings were identified during plan review but are not blockers for Phase A2 -->

1. **`selectLanIp` excludes all 100.x.x.x, not just Tailscale's CGNAT range (100.64.0.0/10).**
   The range 100.0–63.x.x could be legitimate ISP addresses (rare). Narrow to 100.64.0.0/10 if a user reports it.

2. **QR code transparent background may be hard to scan in some conditions.**
   `light: '#00000000'` means no white background. Consider `light: '#1c2128'` (panel bg color) if scan reliability is reported as an issue.

3. **No keyboard shortcut for approve/deny.**
   Time-sensitive permissions would benefit from `Ctrl+Enter` to approve top card. Add in a follow-up.

4. **"Always allow" disabled button may confuse users.**
   Consider hiding entirely until v2 rather than showing a disabled button with a tooltip.

5. **VS Code extension rebuild needed after Phase A2.**
   The `.vsix` must be rebuilt and deployed to `\\192.168.1.214\Incoming` — this is a separate deployment step, not part of the plan.

6. **No WS reconnection handling for stale permission state.**
   If WS drops and reconnects, permissions resolved during the gap won't reflect until hydration completes. The 404 path handles the edge case gracefully (silent dismiss), so this is acceptable for MVP.
