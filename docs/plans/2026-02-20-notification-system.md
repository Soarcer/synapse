# Notification System Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Surface Claude Code notification hooks (permission_prompt, elicitation_dialog, context warnings) across four integration points: Graph Zoom+Pulse, Lens Notification Cards, Context Snapshot Cards, and VS Code Pit Board — with user-configurable settings to enable/disable each.

**Architecture:** All notification code lives in an isolated feature module (`features/notifications/`) with its own Zustand store that subscribes to the main agentStore — **zero modifications to agentStore**. The main app has minimal, clearly-marked touchpoints (1-2 lines each, tagged `// [notifications]`) that are trivial to find and remove. To disable: set `NOTIFICATIONS_ENABLED = false` in the feature index. To delete: remove the feature directory + grep for `// [notifications]`.

**Tech Stack:** React 19, Zustand 5, @xyflow/react v12 (fitView API), Tailwind CSS 4, VS Code Extension API (vscode.window), ws WebSocket

---

## Isolation Architecture

### Feature directory

```
apps/dashboard/src/features/notifications/
├── index.ts                  — feature flag + re-exports
├── notificationStore.ts      — separate Zustand store (subscribes to agentStore)
├── constants.ts              — type configs, labels, MAX values
├── NotificationPulse.tsx     — graph overlay (top of graph)
├── NotificationTray.tsx      — context snapshot cards (bottom of graph)
├── AlertsView.tsx            — lens tab content
├── NotificationSettings.tsx  — settings section (injected into ViewSettingsDropdown)
└── __tests__/
    ├── notificationStore.test.ts
    ├── NotificationPulse.test.tsx
    ├── NotificationTray.test.tsx
    └── AlertsView.test.tsx

apps/vscode/src/
├── notificationHandler.ts    — isolated VS Code notification logic
```

### Touchpoints in existing code (each tagged `// [notifications]`)

| File                       | Lines added | What                                          |
| -------------------------- | ----------- | --------------------------------------------- |
| `LensContext.tsx:9`        | 1           | Add `\| 'alerts'` to LensTab union            |
| `LensTabBar.tsx`           | 1           | Add tab to TABS array                         |
| `LensPanel.tsx`            | 2           | Import + render `<AlertsView />`              |
| `AgentGraph.tsx`           | 2           | Import + render `<NotificationPulse />`       |
| `GraphLayout.tsx`          | 2           | Import + render `<NotificationTray />`        |
| `ViewSettingsDropdown.tsx` | 2           | Import + render `<NotificationSettings />`    |
| `App.tsx`                  | 3           | Import init, call init, `7`/`A` key shortcuts |
| `extension.ts`             | 2           | Import + init notification handler            |

**Zero changes to:** agentStore.ts, eventHandlers.ts, wsClient.ts, treeView.ts, i18n/en.ts

### Disable/delete story

**Disable (1 line):** Set `NOTIFICATIONS_ENABLED = false` in `features/notifications/index.ts`. All exports become no-ops/nulls, all components render nothing.

**Delete (2 steps):**

1. `rm -rf apps/dashboard/src/features/notifications/`
2. `grep -rn "// \[notifications\]" apps/` — remove those lines (+ their import above)
3. `rm apps/vscode/src/notificationHandler.ts` — remove import+init in extension.ts

---

## Task 1: Feature Module Skeleton + Notification Store

Create the isolated store that subscribes to agentStore events — zero modifications to agentStore.

**Files:**

- Create: `apps/dashboard/src/features/notifications/index.ts`
- Create: `apps/dashboard/src/features/notifications/constants.ts`
- Create: `apps/dashboard/src/features/notifications/notificationStore.ts`
- Test: `apps/dashboard/src/features/notifications/__tests__/notificationStore.test.ts`

### Step 1: Write the failing test

Create `apps/dashboard/src/features/notifications/__tests__/notificationStore.test.ts`:

```typescript
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../../store/wsClient', () => ({
  wsClient: {
    setOnEvent: vi.fn(),
    setOnStatusChange: vi.fn(),
    connect: vi.fn(),
    disconnect: vi.fn(),
  },
}));

import { useNotificationStore } from '../notificationStore';
import { useAgentStore } from '../../../store/agentStore';
import type { AgentEvent } from '@synapse-ai/core';

function makeNotification(overrides: Partial<AgentEvent> = {}): AgentEvent {
  return {
    id: `notif-${Math.random().toString(36).slice(2)}`,
    type: 'notification',
    sessionId: 'session-1',
    timestamp: Date.now(),
    eventSource: 'hook',
    vendor: 'anthropic',
    text: 'Claude needs your permission',
    notificationType: 'permission_prompt',
    ...overrides,
  } as AgentEvent;
}

function resetStores() {
  useNotificationStore.setState({
    notifications: [],
    enabled: true,
    showToasts: true,
    showPulse: true,
  });
}

describe('Notification Store', () => {
  beforeEach(resetStores);

  it('adds a notification', () => {
    useNotificationStore.getState().addNotification(makeNotification());
    expect(useNotificationStore.getState().notifications).toHaveLength(1);
  });

  it('limits notifications to MAX_NOTIFICATIONS', () => {
    for (let i = 0; i < 60; i++) {
      useNotificationStore
        .getState()
        .addNotification(makeNotification({ id: `n-${i}`, timestamp: Date.now() + i }));
    }
    expect(useNotificationStore.getState().notifications).toHaveLength(50);
  });

  it('newest notification is first', () => {
    useNotificationStore.getState().addNotification(makeNotification({ id: 'old', timestamp: 1 }));
    useNotificationStore.getState().addNotification(makeNotification({ id: 'new', timestamp: 2 }));
    expect(useNotificationStore.getState().notifications[0].id).toBe('new');
  });

  it('dismisses a notification by id', () => {
    const notif = makeNotification();
    useNotificationStore.getState().addNotification(notif);
    useNotificationStore.getState().dismiss(notif.id);
    expect(useNotificationStore.getState().notifications).toHaveLength(0);
  });

  it('clears all notifications', () => {
    useNotificationStore.getState().addNotification(makeNotification());
    useNotificationStore.getState().addNotification(makeNotification());
    useNotificationStore.getState().clearAll();
    expect(useNotificationStore.getState().notifications).toHaveLength(0);
  });

  it('skips duplicates', () => {
    const notif = makeNotification({ id: 'same' });
    useNotificationStore.getState().addNotification(notif);
    useNotificationStore.getState().addNotification(notif);
    expect(useNotificationStore.getState().notifications).toHaveLength(1);
  });

  it('does not add when enabled is false', () => {
    useNotificationStore.setState({ enabled: false });
    useNotificationStore.getState().addNotification(makeNotification());
    expect(useNotificationStore.getState().notifications).toHaveLength(0);
  });
});
```

### Step 2: Run test to verify it fails

Run: `cd apps/dashboard && npx vitest run src/features/notifications/__tests__/notificationStore.test.ts`
Expected: FAIL — module not found

### Step 3: Create constants.ts

Create `apps/dashboard/src/features/notifications/constants.ts`:

```typescript
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Synapse Contributors

export const MAX_NOTIFICATIONS = 50;

export const NOTIFICATION_TYPES: Record<
  string,
  { label: string; color: string; dot: string; border: string; bg: string }
> = {
  permission_prompt: {
    label: 'Permission',
    color: 'text-red-400',
    dot: 'bg-red-400',
    border: 'border-red-700/40',
    bg: 'bg-red-950/80',
  },
  elicitation_dialog: {
    label: 'Question',
    color: 'text-amber-400',
    dot: 'bg-amber-400',
    border: 'border-amber-700/40',
    bg: 'bg-amber-950/80',
  },
  warning: {
    label: 'Warning',
    color: 'text-amber-400',
    dot: 'bg-amber-400',
    border: 'border-amber-700/40',
    bg: 'bg-amber-950/80',
  },
};

export const FALLBACK_TYPE = {
  label: 'Alert',
  color: 'text-gray-400',
  dot: 'bg-gray-400',
  border: 'border-gray-700/40',
  bg: 'bg-gray-900/80',
};

const SETTINGS_KEY = 'synapse-notification-settings';

export interface NotificationSettings {
  enabled: boolean;
  showToasts: boolean;
  showPulse: boolean;
}

export const DEFAULT_SETTINGS: NotificationSettings = {
  enabled: true,
  showToasts: true,
  showPulse: true,
};

export function loadSettings(): NotificationSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    return raw ? { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } : DEFAULT_SETTINGS;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(partial: Partial<NotificationSettings>): void {
  try {
    const current = loadSettings();
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...current, ...partial }));
  } catch {
    /* quota exceeded */
  }
}

export function sessionLabel(sessionId: string, sessions: Map<string, { cwd?: string }>): string {
  const session = sessions.get(sessionId);
  if (session?.cwd) {
    const parts = session.cwd.replace(/\\/g, '/').split('/');
    return parts[parts.length - 1] || sessionId.slice(0, 8);
  }
  return sessionId.slice(0, 8);
}

export function formatElapsed(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.floor(m / 60)}h ago`;
}

export function formatWait(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

export function targetNodeId(event: { agentId?: string; sessionId: string }): string {
  return event.agentId ? `agent-${event.agentId}` : `session-${event.sessionId}`;
}
```

### Step 4: Create notificationStore.ts

Create `apps/dashboard/src/features/notifications/notificationStore.ts`:

```typescript
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Synapse Contributors

import { create } from 'zustand';
import type { AgentEvent } from '@synapse-ai/core';
import { MAX_NOTIFICATIONS, loadSettings, saveSettings } from './constants';

interface NotificationState {
  notifications: AgentEvent[];
  enabled: boolean;
  showToasts: boolean;
  showPulse: boolean;

  addNotification: (event: AgentEvent) => void;
  dismiss: (id: string) => void;
  clearAll: () => void;
  setEnabled: (v: boolean) => void;
  setShowToasts: (v: boolean) => void;
  setShowPulse: (v: boolean) => void;
}

const saved = loadSettings();

export const useNotificationStore = create<NotificationState>((set, get) => ({
  notifications: [],
  enabled: saved.enabled,
  showToasts: saved.showToasts,
  showPulse: saved.showPulse,

  addNotification: (event) => {
    if (!get().enabled) return;
    set((s) => {
      if (s.notifications.some((n) => n.id === event.id)) return s; // dedup
      return { notifications: [event, ...s.notifications].slice(0, MAX_NOTIFICATIONS) };
    });
  },

  dismiss: (id) =>
    set((s) => ({
      notifications: s.notifications.filter((n) => n.id !== id),
    })),

  clearAll: () => set({ notifications: [] }),

  setEnabled: (enabled) => {
    saveSettings({ enabled });
    set({ enabled });
  },
  setShowToasts: (showToasts) => {
    saveSettings({ showToasts });
    set({ showToasts });
  },
  setShowPulse: (showPulse) => {
    saveSettings({ showPulse });
    set({ showPulse });
  },
}));
```

### Step 5: Create index.ts with feature flag and agentStore subscription

Create `apps/dashboard/src/features/notifications/index.ts`:

```typescript
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Synapse Contributors
//
// Feature flag — set to false to disable all notification features.
// All exports become no-ops so existing touchpoints in the app
// silently do nothing without errors.

export const NOTIFICATIONS_ENABLED = true;

export { useNotificationStore } from './notificationStore';
export {
  NOTIFICATION_TYPES,
  FALLBACK_TYPE,
  sessionLabel,
  formatElapsed,
  formatWait,
  targetNodeId,
} from './constants';

// Re-export components (lazy consumers check NOTIFICATIONS_ENABLED)
export { NotificationPulse } from './NotificationPulse';
export { NotificationTray } from './NotificationTray';
export { AlertsView } from './AlertsView';
export { NotificationSettings } from './NotificationSettings';

import { useAgentStore } from '../../store/agentStore';
import { useNotificationStore } from './notificationStore';
import { toast } from '../../components/Toast';
import { targetNodeId } from './constants';

let initialized = false;

/**
 * Initialize the notification system — subscribes to agentStore for
 * notification events. Call once at app startup. No-op if disabled or
 * already initialized.
 */
export function initNotifications(): void {
  if (!NOTIFICATIONS_ENABLED || initialized) return;
  initialized = true;

  // Watch agentStore.events for new notification-type events
  let prevEventCount = 0;
  let seenIds = new Set<string>();

  useAgentStore.subscribe((state) => {
    if (state.events.length === prevEventCount) return;
    prevEventCount = state.events.length;

    // Check newest events (stored newest-first) for notifications
    for (const event of state.events) {
      if (seenIds.has(event.id)) break; // already processed everything after this
      if (event.type === 'notification') {
        useNotificationStore.getState().addNotification(event);

        // Fire toast if enabled
        if (useNotificationStore.getState().showToasts) {
          const typeLabel =
            event.notificationType === 'permission_prompt'
              ? 'Permission needed'
              : event.notificationType === 'elicitation_dialog'
                ? 'Question for you'
                : 'Notification';
          const preview = (event.text ?? '').slice(0, 80);
          toast(`${typeLabel}: ${preview}`, 'warning', targetNodeId(event));
        }
      }
      seenIds.add(event.id);
    }

    // Prevent unbounded growth of seenIds
    if (seenIds.size > 2000) {
      const keepIds = new Set(state.events.map((e) => e.id));
      seenIds = keepIds;
    }
  });
}
```

### Step 6: Run test to verify it passes

Run: `cd apps/dashboard && npx vitest run src/features/notifications/__tests__/notificationStore.test.ts`
Expected: PASS (7 tests)

### Step 7: Commit

```bash
git add apps/dashboard/src/features/notifications/index.ts apps/dashboard/src/features/notifications/constants.ts apps/dashboard/src/features/notifications/notificationStore.ts apps/dashboard/src/features/notifications/__tests__/notificationStore.test.ts
git commit -m "feat(notifications): isolated notification store with feature flag"
```

---

## Task 2: NotificationPulse Component

Graph overlay that shows when a notification arrives — pulsing dot + message banner at the top of the graph.

**Files:**

- Create: `apps/dashboard/src/features/notifications/NotificationPulse.tsx`
- Test: `apps/dashboard/src/features/notifications/__tests__/NotificationPulse.test.tsx`
- Modify: `apps/dashboard/src/components/graph/AgentGraph.tsx` (2 lines)

### Step 1: Write the failing test

Create `apps/dashboard/src/features/notifications/__tests__/NotificationPulse.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { NotificationPulse } from '../NotificationPulse';

describe('NotificationPulse', () => {
  it('renders nothing when notification is null', () => {
    const { container } = render(<NotificationPulse />);
    expect(container.innerHTML).toBe('');
  });

  it('renders pulse overlay with message when notification exists', () => {
    // Seed the notification store
    const { useNotificationStore } = await import('../notificationStore');
    useNotificationStore.setState({
      notifications: [
        {
          id: 'n1',
          type: 'notification',
          sessionId: 's1',
          timestamp: Date.now(),
          text: 'Claude needs permission for git push',
          notificationType: 'permission_prompt',
        },
      ],
      showPulse: true,
    });

    render(<NotificationPulse />);
    expect(screen.getByText(/permission/i)).toBeTruthy();
    expect(screen.getByText(/git push/i)).toBeTruthy();
  });

  it('renders nothing when showPulse is false', () => {
    const { useNotificationStore } = await import('../notificationStore');
    useNotificationStore.setState({
      notifications: [
        {
          id: 'n1',
          type: 'notification',
          sessionId: 's1',
          timestamp: Date.now(),
          text: 'test',
          notificationType: 'permission_prompt',
        },
      ],
      showPulse: false,
    });

    const { container } = render(<NotificationPulse />);
    expect(container.innerHTML).toBe('');
  });
});
```

### Step 2: Run test to verify it fails

Run: `cd apps/dashboard && npx vitest run src/features/notifications/__tests__/NotificationPulse.test.tsx`
Expected: FAIL — module not found

### Step 3: Create NotificationPulse component

Create `apps/dashboard/src/features/notifications/NotificationPulse.tsx`:

```tsx
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Synapse Contributors

import { useEffect, useRef } from 'react';
import { useNotificationStore } from './notificationStore';
import { useAgentStore } from '../../store/agentStore';
import { NOTIFICATION_TYPES, FALLBACK_TYPE, NOTIFICATIONS_ENABLED } from './index';

export function NotificationPulse() {
  if (!NOTIFICATIONS_ENABLED) return null;

  const notifications = useNotificationStore((s) => s.notifications);
  const showPulse = useNotificationStore((s) => s.showPulse);
  const dismiss = useNotificationStore((s) => s.dismiss);
  const latest = showPulse ? (notifications[0] ?? null) : null;

  // Auto-zoom to the notification's agent/session node
  const prevIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!latest || latest.id === prevIdRef.current) return;
    prevIdRef.current = latest.id;
    const targetId = latest.agentId ? `agent-${latest.agentId}` : `session-${latest.sessionId}`;
    useAgentStore.getState().selectNode(targetId, 'lens');
  }, [latest]);

  if (!latest) return null;

  const config = NOTIFICATION_TYPES[latest.notificationType ?? ''] ?? FALLBACK_TYPE;
  const isRed = latest.notificationType === 'permission_prompt';

  return (
    <div className="absolute top-4 left-1/2 -translate-x-1/2 z-20 animate-[notifSlideDown_0.3s_ease-out]">
      <style>{`@keyframes notifSlideDown {
        from { opacity: 0; transform: translateX(-50%) translateY(-12px); }
        to { opacity: 1; transform: translateX(-50%) translateY(0); }
      }`}</style>
      <div
        className={`
        flex items-center gap-3 px-4 py-2.5 rounded-lg border backdrop-blur-sm shadow-lg
        ${
          isRed
            ? 'bg-red-950/90 border-red-700/50 text-red-200'
            : 'bg-amber-950/90 border-amber-700/50 text-amber-200'
        }
      `}
      >
        <span
          className={`w-2.5 h-2.5 rounded-full flex-shrink-0 animate-pulse ${config.dot}
          ${isRed ? 'shadow-[0_0_8px_rgba(248,113,113,0.6)]' : 'shadow-[0_0_8px_rgba(251,191,36,0.6)]'}
        `}
        />
        <div className="flex-1 min-w-0">
          <div className="text-[10px] font-semibold uppercase tracking-wider opacity-70">
            {config.label}
          </div>
          <div className="text-xs font-medium truncate max-w-[300px]">
            {latest.text ?? 'No details'}
          </div>
        </div>
        <button
          onClick={() => dismiss(latest.id)}
          className={`ml-2 px-2 py-1 rounded text-[10px] font-medium transition-colors ${
            isRed ? 'hover:bg-red-800/50 text-red-400' : 'hover:bg-amber-800/50 text-amber-400'
          }`}
          aria-label="Dismiss notification"
        >
          &times;
        </button>
      </div>
    </div>
  );
}
```

### Step 4: Wire into AgentGraph (2 lines)

In `apps/dashboard/src/components/graph/AgentGraph.tsx`:

**a) Add import near top:**

```typescript
import { NotificationPulse } from '../../features/notifications'; // [notifications]
```

**b) Add render inside the graph container, as last child of the `<div className="flex-1 relative">` wrapper (just before the closing tag). Find the appropriate location in the JSX return:**

```tsx
            <NotificationPulse /> {/* [notifications] */}
```

### Step 5: Run test to verify passes

Run: `cd apps/dashboard && npx vitest run src/features/notifications/__tests__/NotificationPulse.test.tsx`
Expected: PASS

### Step 6: Commit

```bash
git add apps/dashboard/src/features/notifications/NotificationPulse.tsx apps/dashboard/src/features/notifications/__tests__/NotificationPulse.test.tsx apps/dashboard/src/components/graph/AgentGraph.tsx
git commit -m "feat(notifications): graph zoom + pulse overlay component"
```

---

## Task 3: NotificationTray — Context Snapshot Cards

Floating enriched cards at the bottom of the graph area.

**Files:**

- Create: `apps/dashboard/src/features/notifications/NotificationTray.tsx`
- Test: `apps/dashboard/src/features/notifications/__tests__/NotificationTray.test.tsx`
- Modify: `apps/dashboard/src/components/layout/GraphLayout.tsx` (2 lines)

### Step 1: Write the failing test

Create `apps/dashboard/src/features/notifications/__tests__/NotificationTray.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { NotificationTray } from '../NotificationTray';

vi.mock('../../../store/agentStore', () => ({
  useAgentStore: (sel: (s: Record<string, unknown>) => unknown) =>
    sel({
      sessions: new Map([['s1', { sessionId: 's1', cwd: '/projects/feat-auth' }]]),
      selectNode: vi.fn(),
    }),
}));

vi.mock('../notificationStore', () => ({
  useNotificationStore: (sel: (s: Record<string, unknown>) => unknown) =>
    sel({
      notifications: [
        {
          id: 'n1',
          type: 'notification',
          sessionId: 's1',
          timestamp: Date.now() - 30000,
          text: 'Permission to run git push',
          notificationType: 'permission_prompt',
        },
      ],
      showToasts: true,
      dismiss: vi.fn(),
    }),
}));

describe('NotificationTray', () => {
  it('renders context snapshot cards', () => {
    render(<NotificationTray />);
    expect(screen.getByText(/git push/i)).toBeTruthy();
    expect(screen.getByText(/feat-auth/i)).toBeTruthy();
  });
});
```

### Step 2: Run test — expect FAIL

### Step 3: Create NotificationTray component

Create `apps/dashboard/src/features/notifications/NotificationTray.tsx`:

```tsx
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Synapse Contributors

import { useNotificationStore } from './notificationStore';
import { useAgentStore } from '../../store/agentStore';
import {
  NOTIFICATION_TYPES,
  FALLBACK_TYPE,
  sessionLabel,
  formatWait,
  targetNodeId,
  NOTIFICATIONS_ENABLED,
} from './index';

const MAX_VISIBLE = 4;

export function NotificationTray() {
  if (!NOTIFICATIONS_ENABLED) return null;

  const notifications = useNotificationStore((s) => s.notifications);
  const showToasts = useNotificationStore((s) => s.showToasts);
  const dismiss = useNotificationStore((s) => s.dismiss);
  const sessions = useAgentStore((s) => s.sessions);
  const selectNode = useAgentStore((s) => s.selectNode);

  if (!showToasts || notifications.length === 0) return null;

  const visible = notifications.slice(0, MAX_VISIBLE);
  const overflow = notifications.length - MAX_VISIBLE;

  return (
    <div className="absolute bottom-3 left-3 right-3 z-10 flex gap-2 items-end pointer-events-none">
      <style>{`@keyframes notifSlideUp {
        from { opacity: 0; transform: translateY(16px); }
        to { opacity: 1; transform: translateY(0); }
      }`}</style>
      {visible.map((notif, i) => {
        const style = NOTIFICATION_TYPES[notif.notificationType ?? ''] ?? FALLBACK_TYPE;
        return (
          <div
            key={notif.id}
            data-testid="notification-card"
            className={`
              pointer-events-auto flex-1 max-w-[280px] min-w-[200px]
              ${style.bg} border ${style.border} backdrop-blur-sm
              rounded-lg p-3 shadow-lg
              animate-[notifSlideUp_0.4s_ease-out_both]
            `}
            style={{ animationDelay: `${i * 80}ms` }}
          >
            <div className="flex items-center gap-2 mb-1.5">
              <span className={`w-2 h-2 rounded-full flex-shrink-0 animate-pulse ${style.dot}`} />
              <span className="text-[9px] font-bold uppercase tracking-wider text-gray-400">
                {style.label}
              </span>
              <span className="text-[9px] text-gray-600 font-mono ml-auto">
                {formatWait(Date.now() - notif.timestamp)}
              </span>
            </div>
            <div className="text-[11px] text-gray-200 mb-1 leading-snug line-clamp-2 font-medium">
              {notif.text ?? 'No details'}
            </div>
            <div className="text-[10px] text-gray-500 font-mono mb-2 truncate">
              {sessionLabel(notif.sessionId, sessions)}
            </div>
            <div className="flex gap-1.5">
              <button
                onClick={() => selectNode(targetNodeId(notif), 'lens')}
                className="text-[10px] font-medium text-blue-400 hover:text-blue-300 bg-blue-950/50 hover:bg-blue-900/50 border border-blue-800/30 px-2.5 py-1 rounded transition-colors"
              >
                Go to Node
              </button>
              <button
                onClick={() => dismiss(notif.id)}
                className="text-[10px] text-gray-500 hover:text-gray-300 px-1.5 py-1 rounded hover:bg-gray-700/50 transition-colors"
              >
                &times;
              </button>
            </div>
          </div>
        );
      })}
      {overflow > 0 && (
        <div className="pointer-events-auto text-[10px] text-gray-500 bg-gray-900/80 border border-gray-700/40 backdrop-blur-sm rounded-lg px-3 py-2 self-end">
          +{overflow} more
        </div>
      )}
    </div>
  );
}
```

### Step 4: Wire into GraphLayout (2 lines)

In `apps/dashboard/src/components/layout/GraphLayout.tsx`:

**a) Add import:**

```typescript
import { NotificationTray } from '../../features/notifications'; // [notifications]
```

**b) Inside the `<div className="flex-1 relative">` wrapper (after the Tool Log button), add:**

```tsx
            <NotificationTray /> {/* [notifications] */}
```

### Step 5: Run test, commit

```bash
git add apps/dashboard/src/features/notifications/NotificationTray.tsx apps/dashboard/src/features/notifications/__tests__/NotificationTray.test.tsx apps/dashboard/src/components/layout/GraphLayout.tsx
git commit -m "feat(notifications): context snapshot cards overlay at bottom of graph"
```

---

## Task 4: AlertsView — Lens Notification Tab

New "Alerts" lens tab (key `7`) with scrollable notification cards.

**Files:**

- Create: `apps/dashboard/src/features/notifications/AlertsView.tsx`
- Test: `apps/dashboard/src/features/notifications/__tests__/AlertsView.test.tsx`
- Modify: `apps/dashboard/src/components/lens/LensContext.tsx` (1 line)
- Modify: `apps/dashboard/src/components/lens/LensTabBar.tsx` (1 line + badge)
- Modify: `apps/dashboard/src/components/lens/LensPanel.tsx` (2 lines)
- Modify: `apps/dashboard/src/App.tsx` (1 line: add `'alerts'` to tabKeys array)

### Step 1: Write the failing test

Create `apps/dashboard/src/features/notifications/__tests__/AlertsView.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AlertsView } from '../AlertsView';

vi.mock('../../../store/agentStore', () => ({
  useAgentStore: (sel: (s: Record<string, unknown>) => unknown) =>
    sel({
      sessions: new Map([['s1', { sessionId: 's1', cwd: '/projects/feat-auth' }]]),
      selectNode: vi.fn(),
    }),
}));

vi.mock('../notificationStore', () => ({
  useNotificationStore: (sel: (s: Record<string, unknown>) => unknown) =>
    sel({
      notifications: [
        {
          id: 'n1',
          type: 'notification',
          sessionId: 's1',
          text: 'Permission needed',
          notificationType: 'permission_prompt',
          timestamp: Date.now() - 60000,
        },
        {
          id: 'n2',
          type: 'notification',
          sessionId: 's1',
          text: 'Redis or in-memory?',
          notificationType: 'elicitation_dialog',
          timestamp: Date.now(),
        },
      ],
      dismiss: vi.fn(),
      clearAll: vi.fn(),
    }),
}));

describe('AlertsView', () => {
  it('renders notification cards', () => {
    render(<AlertsView />);
    expect(screen.getByText(/Permission needed/)).toBeTruthy();
    expect(screen.getByText(/Redis/)).toBeTruthy();
  });

  it('shows clear all button', () => {
    render(<AlertsView />);
    expect(screen.getByText('Clear all')).toBeTruthy();
  });
});
```

### Step 2: Run test — expect FAIL

### Step 3: Create AlertsView component

Create `apps/dashboard/src/features/notifications/AlertsView.tsx`:

```tsx
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Synapse Contributors

import { useNotificationStore } from './notificationStore';
import { useAgentStore } from '../../store/agentStore';
import {
  NOTIFICATION_TYPES,
  FALLBACK_TYPE,
  sessionLabel,
  formatElapsed,
  targetNodeId,
} from './constants';

export function AlertsView() {
  const notifications = useNotificationStore((s) => s.notifications);
  const dismiss = useNotificationStore((s) => s.dismiss);
  const clearAll = useNotificationStore((s) => s.clearAll);
  const sessions = useAgentStore((s) => s.sessions);
  const selectNode = useAgentStore((s) => s.selectNode);

  if (notifications.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-gray-600 text-xs gap-2 p-4">
        <svg
          className="w-8 h-8 opacity-30"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={1.5}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0"
          />
        </svg>
        No alerts
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-800 flex-shrink-0">
        <span className="text-[10px] text-gray-500 uppercase tracking-wider font-semibold">
          {notifications.length} alert{notifications.length !== 1 ? 's' : ''}
        </span>
        <button
          onClick={clearAll}
          className="text-[10px] text-gray-500 hover:text-gray-300 transition-colors"
        >
          Clear all
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
        {notifications.map((notif, i) => {
          const config = NOTIFICATION_TYPES[notif.notificationType ?? ''] ?? FALLBACK_TYPE;
          return (
            <div
              key={notif.id}
              className={`rounded-md border-l-[3px] ${config.border} ${config.bg} border border-gray-800 p-2.5 group transition-all duration-300 ease-out`}
            >
              <div className="flex items-center gap-2 mb-1">
                <span className={`text-[9px] font-bold uppercase tracking-wider ${config.color}`}>
                  {config.label}
                </span>
                <span className="text-[9px] text-gray-600 font-mono ml-auto">
                  {formatElapsed(Date.now() - notif.timestamp)}
                </span>
              </div>
              <div className="text-xs text-gray-300 mb-1.5 leading-snug line-clamp-2">
                {notif.text ?? 'No details'}
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-gray-600 font-mono truncate max-w-[120px]">
                  {sessionLabel(notif.sessionId, sessions)}
                </span>
                <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={() => selectNode(targetNodeId(notif), 'lens')}
                    className="text-[10px] text-blue-400 hover:text-blue-300 px-1.5 py-0.5 rounded hover:bg-blue-900/30 transition-colors"
                  >
                    Go to
                  </button>
                  <button
                    onClick={() => dismiss(notif.id)}
                    className="text-[10px] text-gray-500 hover:text-gray-300 px-1 py-0.5 rounded hover:bg-gray-700/50 transition-colors"
                  >
                    &times;
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

### Step 4: Add to LensContext type (1 line)

In `apps/dashboard/src/components/lens/LensContext.tsx` line 9:

```typescript
export type LensTab = 'tree' | 'heatmap' | 'treemap' | 'sankey' | 'compaction' | 'cost' | 'alerts'; // [notifications]
```

### Step 5: Add tab to LensTabBar (1 entry + badge)

In `apps/dashboard/src/components/lens/LensTabBar.tsx`:

**a) Add import:**

```typescript
import { useNotificationStore } from '../../features/notifications/notificationStore'; // [notifications]
```

**b) Add to TABS array after the `tree` entry (line 16):**

```typescript
  { key: 'alerts', label: 'Alerts', fullName: 'Notification alerts', shortcut: '7' }, // [notifications]
```

**c) Inside the `LensTabBar` function, add:**

```typescript
const notifCount = useNotificationStore((s) => s.notifications.length); // [notifications]
```

**d) In the tab button render (line ~86), wrap the existing `<button>` content — add a badge after `{tab.label}` inside the button, using `position: relative` on the button:**

```tsx
<button
  onClick={() => onTabChange(tab.key)}
  className={`relative px-2 py-1 rounded text-[11px] font-medium transition-colors ...`}
>
  {tab.label}
  {/* [notifications] */}
  {tab.key === 'alerts' && notifCount > 0 && (
    <span className="absolute -top-1.5 -right-1.5 w-3.5 h-3.5 rounded-full bg-red-500 text-white text-[8px] font-bold flex items-center justify-center shadow-[0_0_6px_rgba(239,68,68,0.5)]">
      {notifCount > 9 ? '9+' : notifCount}
    </span>
  )}
</button>
```

### Step 6: Add to LensPanel (2 lines)

In `apps/dashboard/src/components/lens/LensPanel.tsx`:

**a) Import:**

```typescript
import { AlertsView } from '../../features/notifications'; // [notifications]
```

**b) After the `cost` conditional (line ~54):**

```tsx
{
  activeTab === 'alerts' && <AlertsView />;
}
{
  /* [notifications] */
}
```

### Step 7: Add keyboard shortcut (1 line)

In `apps/dashboard/src/App.tsx` line 166, extend tabKeys:

```typescript
const tabKeys = ['treemap', 'heatmap', 'compaction', 'cost', 'sankey', 'tree', 'alerts']; // [notifications] added 'alerts'
```

### Step 8: Run tests, commit

```bash
git add apps/dashboard/src/features/notifications/AlertsView.tsx apps/dashboard/src/features/notifications/__tests__/AlertsView.test.tsx apps/dashboard/src/components/lens/LensContext.tsx apps/dashboard/src/components/lens/LensTabBar.tsx apps/dashboard/src/components/lens/LensPanel.tsx apps/dashboard/src/App.tsx
git commit -m "feat(notifications): lens Alerts tab with badge and sliding cards"
```

---

## Task 5: NotificationSettings — Settings Dropdown Section

Isolated settings component rendered inside ViewSettingsDropdown.

**Files:**

- Create: `apps/dashboard/src/features/notifications/NotificationSettings.tsx`
- Modify: `apps/dashboard/src/components/layout/ViewSettingsDropdown.tsx` (2 lines)
- Modify: `apps/dashboard/src/App.tsx` (3 lines: import init, call init, `A` shortcut)

### Step 1: Create NotificationSettings component

Create `apps/dashboard/src/features/notifications/NotificationSettings.tsx`:

```tsx
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Synapse Contributors

import { useNotificationStore } from './notificationStore';
import { NOTIFICATIONS_ENABLED } from './index';

interface Props {
  onClose: () => void;
}

export function NotificationSettings({ onClose }: Props) {
  if (!NOTIFICATIONS_ENABLED) return null;

  const enabled = useNotificationStore((s) => s.enabled);
  const setEnabled = useNotificationStore((s) => s.setEnabled);
  const showToasts = useNotificationStore((s) => s.showToasts);
  const setShowToasts = useNotificationStore((s) => s.setShowToasts);
  const showPulse = useNotificationStore((s) => s.showPulse);
  const setShowPulse = useNotificationStore((s) => s.setShowPulse);

  const toggles = [
    {
      label: 'Show Alerts',
      key: 'A',
      active: enabled,
      onToggle: () => {
        setEnabled(!enabled);
        onClose();
      },
    },
    {
      label: 'Toast Popups',
      key: '',
      active: showToasts,
      onToggle: () => {
        setShowToasts(!showToasts);
        onClose();
      },
    },
    {
      label: 'Graph Pulse',
      key: '',
      active: showPulse,
      onToggle: () => {
        setShowPulse(!showPulse);
        onClose();
      },
    },
  ];

  return (
    <div className="border-t border-gray-700/50 mt-1 pt-1">
      <div className="px-2 py-1 text-[10px] text-gray-500 uppercase tracking-wider">
        Notifications
      </div>
      {toggles.map(({ label, key, active, onToggle }) => (
        <button
          key={label}
          onClick={onToggle}
          className="w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-gray-800/80 transition-colors text-left text-gray-300"
          role="switch"
          aria-checked={active}
        >
          <span
            className={`w-2 h-2 rounded-full flex-shrink-0 ${active ? 'bg-green-400' : 'bg-gray-600'}`}
          />
          <span className="flex-1">{label}</span>
          {key && <kbd className="text-[10px] text-gray-600 bg-gray-800 px-1 rounded">{key}</kbd>}
        </button>
      ))}
    </div>
  );
}
```

### Step 2: Wire into ViewSettingsDropdown (2 lines)

In `apps/dashboard/src/components/layout/ViewSettingsDropdown.tsx`:

**a) Import:**

```typescript
import { NotificationSettings } from '../../features/notifications'; // [notifications]
```

**b) Inside the dropdown div, after the Tool View section closing `</div>` (line ~98):**

```tsx
          <NotificationSettings onClose={() => setOpen(false)} /> {/* [notifications] */}
```

### Step 3: Wire init + keyboard shortcut into App.tsx (3 lines)

In `apps/dashboard/src/App.tsx`:

**a) Import (near top):**

```typescript
import { initNotifications } from './features/notifications'; // [notifications]
```

**b) Call init at module level (after imports, before component):**

```typescript
initNotifications(); // [notifications]
```

**c) Add `A` keyboard shortcut (after the `c` key handler, line ~205):**

```typescript
if (e.key === 'a' && !e.ctrlKey && !e.metaKey) {
  // [notifications]
  const { useNotificationStore } = await import('./features/notifications');
  const s = useNotificationStore.getState();
  s.setEnabled(!s.enabled);
}
```

Actually, since `initNotifications` is already imported, we can import the store directly:

```typescript
import { initNotifications, useNotificationStore } from './features/notifications'; // [notifications]
```

And in the keyboard handler:

```typescript
if (e.key === 'a' && !e.ctrlKey && !e.metaKey) {
  // [notifications]
  const s = useNotificationStore.getState();
  s.setEnabled(!s.enabled);
}
```

### Step 4: Commit

```bash
git add apps/dashboard/src/features/notifications/NotificationSettings.tsx apps/dashboard/src/components/layout/ViewSettingsDropdown.tsx apps/dashboard/src/App.tsx
git commit -m "feat(notifications): settings toggles and keyboard shortcuts"
```

---

## Task 6: VS Code Pit Board — Isolated Handler

All VS Code notification logic in one file. Extension.ts gets 2 lines.

**Files:**

- Create: `apps/vscode/src/notificationHandler.ts`
- Modify: `apps/vscode/src/extension.ts` (2 lines: import + init call)
- Modify: `apps/vscode/package.json` (2 config entries)

### Step 1: Add notification settings to package.json

In `apps/vscode/package.json`, add to `configuration.properties`:

```json
        "synapse.notifications.enabled": {
          "type": "boolean",
          "default": true,
          "description": "Show VS Code notifications when Claude sessions need attention"
        },
        "synapse.notifications.sound": {
          "type": "boolean",
          "default": false,
          "description": "Play a sound when a notification arrives (uses VS Code warning notification)"
        }
```

### Step 2: Create notificationHandler.ts

Create `apps/vscode/src/notificationHandler.ts`:

```typescript
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Synapse Contributors
//
// Isolated notification handler for VS Code extension.
// Manages: toast notifications, status bar warning, tree view badges.
// To remove: delete this file + remove import/init in extension.ts.

import * as vscode from 'vscode';
import type { SynapseTreeProvider } from './treeView';

interface BlockedSession {
  sessionId: string;
  message: string;
  notificationType: string;
  timestamp: number;
}

const blockedSessions = new Map<string, BlockedSession>();

let statusBarItem: vscode.StatusBarItem | undefined;
let treeProvider: SynapseTreeProvider | undefined;

export function initNotificationHandler(
  statusBar: vscode.StatusBarItem,
  tree: SynapseTreeProvider,
): void {
  statusBarItem = statusBar;
  treeProvider = tree;
}

/**
 * Process an incoming WS event for notification handling.
 * Call this from the wsClient.onEvent handler in extension.ts.
 */
export function handleNotificationEvent(event: Record<string, unknown>): void {
  const type = event.type as string;
  const sessionId = event.sessionId as string;
  if (!sessionId) return;

  // Notification event → show toast + track blocked session
  if (type === 'notification') {
    const config = vscode.workspace.getConfiguration('synapse');
    if (!config.get<boolean>('notifications.enabled', true)) return;

    const message = (event.text as string) ?? 'Claude needs your attention';
    const notifType = (event.notificationType as string) ?? 'info';

    // Track blocked session
    blockedSessions.set(sessionId, {
      sessionId,
      message,
      notificationType: notifType,
      timestamp: Date.now(),
    });
    updateStatusBar();

    // Show VS Code toast
    const useWarning = config.get<boolean>('notifications.sound', false);
    const showFn = useWarning
      ? vscode.window.showWarningMessage
      : vscode.window.showInformationMessage;

    showFn(`Synapse: ${message}`, 'View in Synapse', 'Dismiss').then((choice) => {
      if (choice === 'View in Synapse') {
        vscode.commands.executeCommand('synapse.openDashboard');
      }
    });
  }

  // Clear blocked state when session resumes activity
  if (type === 'tool_start' || type === 'user_prompt') {
    if (blockedSessions.has(sessionId)) {
      blockedSessions.delete(sessionId);
      updateStatusBar();
    }
  }

  // Clear on session end
  if (type === 'session_end') {
    if (blockedSessions.has(sessionId)) {
      blockedSessions.delete(sessionId);
      updateStatusBar();
    }
  }
}

function updateStatusBar(): void {
  if (!statusBarItem) return;
  const count = blockedSessions.size;
  if (count > 0) {
    const metrics = treeProvider?.getMetrics();
    const agentCount = metrics?.agentCount ?? 0;
    statusBarItem.text = `$(pulse) ${agentCount} agent${agentCount !== 1 ? 's' : ''} | $(warning) ${count} waiting`;
    statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
  } else {
    // Restore default — let the existing updateStatusBarMetrics handle it
    statusBarItem.backgroundColor = undefined;
  }
}

export function getBlockedCount(): number {
  return blockedSessions.size;
}

export function clearAllBlocked(): void {
  blockedSessions.clear();
  updateStatusBar();
}
```

### Step 3: Wire into extension.ts (2 lines)

In `apps/vscode/src/extension.ts`:

**a) Import:**

```typescript
import { initNotificationHandler, handleNotificationEvent } from './notificationHandler'; // [notifications]
```

**b) After the status bar and tree provider are created (~line 70), add init:**

```typescript
initNotificationHandler(statusBarItem, treeProvider!); // [notifications]
```

**c) In the `wsClient.onEvent` handler (~line 268), add one line before the existing `updateStatusBarMetrics()` call:**

```typescript
handleNotificationEvent(event); // [notifications]
```

### Step 4: Commit

```bash
git add apps/vscode/src/notificationHandler.ts apps/vscode/src/extension.ts apps/vscode/package.json
git commit -m "feat(notifications): VS Code toast, status bar, isolated notification handler"
```

---

## Task 7: Full Test Suite Verification

### Step 1: Run all tests

Run: `pnpm test`
Expected: All existing tests pass + new notification tests pass

### Step 2: Run simulation to verify end-to-end

```bash
npx tsx scripts/simulate_all_nodes.ts
```

Verify in browser at localhost:5173:

- [ ] Toast appears on notification event
- [ ] Graph zooms to relevant node with pulse banner
- [ ] Lens panel shows "Alerts" tab (key `7`) with badge count
- [ ] Context snapshot cards appear at bottom of graph
- [ ] Settings toggles work (`A` key, ViewSettingsDropdown)
- [ ] Disabling "Show Alerts" stops all notification UI

### Step 3: Commit

```bash
git add -A
git commit -m "test(notifications): verify full notification system end-to-end"
```

---

## Isolation Summary

### Files created (delete to remove feature)

| File                                                                 | Purpose                          |
| -------------------------------------------------------------------- | -------------------------------- |
| `apps/dashboard/src/features/notifications/index.ts`                 | Feature flag + init + re-exports |
| `apps/dashboard/src/features/notifications/constants.ts`             | Shared constants, types, helpers |
| `apps/dashboard/src/features/notifications/notificationStore.ts`     | Separate Zustand store           |
| `apps/dashboard/src/features/notifications/NotificationPulse.tsx`    | Graph pulse overlay              |
| `apps/dashboard/src/features/notifications/NotificationTray.tsx`     | Context snapshot cards           |
| `apps/dashboard/src/features/notifications/AlertsView.tsx`           | Lens tab content                 |
| `apps/dashboard/src/features/notifications/NotificationSettings.tsx` | Settings toggles                 |
| `apps/dashboard/src/features/notifications/__tests__/*.ts(x)`        | Tests (4 files)                  |
| `apps/vscode/src/notificationHandler.ts`                             | VS Code notification logic       |

### Lines added to existing files (grep `// [notifications]` to find)

| File                       | Lines | What                                                   |
| -------------------------- | ----- | ------------------------------------------------------ |
| `LensContext.tsx`          | 1     | `\| 'alerts'` in LensTab type                          |
| `LensTabBar.tsx`           | ~6    | Tab entry + badge + store import                       |
| `LensPanel.tsx`            | 2     | Import + render AlertsView                             |
| `AgentGraph.tsx`           | 2     | Import + render NotificationPulse                      |
| `GraphLayout.tsx`          | 2     | Import + render NotificationTray                       |
| `ViewSettingsDropdown.tsx` | 2     | Import + render NotificationSettings                   |
| `App.tsx`                  | ~4    | Import, init call, `A` shortcut, `'alerts'` in tabKeys |
| `extension.ts`             | 3     | Import, init call, handleEvent call                    |
| `package.json` (vscode)    | ~10   | 2 configuration entries                                |

**Total existing-file changes: ~32 lines across 9 files, all tagged `// [notifications]`**

**Zero changes to: agentStore.ts, eventHandlers.ts, wsClient.ts, treeView.ts, i18n/en.ts**
