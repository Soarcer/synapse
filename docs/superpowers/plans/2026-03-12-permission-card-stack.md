# Permission Card Stack Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the plain vertical permission card list with an iOS-style notification stack using framer-motion — swipe-to-dismiss, depth-layered cards, close X on every card, scrollable content, full-screen modal for long content, bottom-center positioning.

**Architecture:** Three new components (`PermissionStack`, `PermissionCard`, `PermissionModal`) replace the existing `PermissionPanel` + `PermissionApprovalCard`. The store gains `dismissedIds` (sessionStorage-persisted) and an `exiting` array for AnimatePresence exit timing. framer-motion provides drag gestures and spring animations.

**Tech Stack:** React 19, framer-motion 12, Zustand 5, Tailwind CSS 4

**Spec:** `docs/superpowers/specs/2026-03-12-permission-card-stack-design.md`

---

## File Structure

### New files

| File                                                                           | Responsibility                                                                                                                                                                                                           |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `apps/dashboard/src/components/permissions/PermissionCard.tsx`                 | Single card: close X, countdown, drag-to-dismiss, scrollable content, modal trigger. Contains `ExpiredCard`, `AskUserQuestionCard`, `GenericPermissionCard` sub-components (moved from old `PermissionApprovalCard.tsx`) |
| `apps/dashboard/src/components/permissions/PermissionModal.tsx`                | Full-screen overlay modal for expanded card content. Backdrop blur, focus trap, Escape close                                                                                                                             |
| `apps/dashboard/src/components/permissions/PermissionStack.tsx`                | Stack container: depth layering (scale/opacity/translateY), AnimatePresence, clear-all button, "+N more" badge, positioning                                                                                              |
| `apps/dashboard/src/components/permissions/__tests__/PermissionStack.test.tsx` | Tests for the new stack component                                                                                                                                                                                        |

### Modified files

| File                                                        | Change                                                                                   |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `apps/dashboard/src/store/permissionStore.ts`               | Add `dismissedIds`, `exiting`, `dismiss()`, `removeExited()`, sessionStorage persistence |
| `apps/dashboard/src/App.tsx:14,420`                         | Swap `PermissionPanel` → `PermissionStack`                                               |
| `apps/dashboard/src/components/mobile/MobileView.tsx:11,35` | Swap `PermissionPanel` → `PermissionStack`                                               |

### Deleted files

| File                                                                           | Reason                                 |
| ------------------------------------------------------------------------------ | -------------------------------------- |
| `apps/dashboard/src/components/permissions/PermissionPanel.tsx`                | Replaced by `PermissionStack.tsx`      |
| `apps/dashboard/src/components/permissions/PermissionApprovalCard.tsx`         | Replaced by `PermissionCard.tsx`       |
| `apps/dashboard/src/components/permissions/__tests__/PermissionPanel.test.tsx` | Replaced by `PermissionStack.test.tsx` |

---

## Chunk 1: Store + Dependency

### Task 1: Install framer-motion

**Files:**

- Modify: `apps/dashboard/package.json`

- [ ] **Step 1: Install framer-motion**

```bash
cd apps/dashboard && pnpm add framer-motion@^12
```

- [ ] **Step 2: Verify install**

```bash
cd apps/dashboard && pnpm ls framer-motion
```

Expected: `framer-motion 12.x.x`

- [ ] **Step 3: Commit**

```bash
git add apps/dashboard/package.json pnpm-lock.yaml
git commit -m "feat(dashboard): add framer-motion dependency for permission card stack"
```

---

### Task 2: Add dismissedIds and exiting to permissionStore

**Files:**

- Modify: `apps/dashboard/src/store/permissionStore.ts`

- [ ] **Step 1: Write failing tests for new store behavior**

Create file `apps/dashboard/src/store/__tests__/permissionStore.dismiss.test.ts`:

```ts
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { usePermissionStore } from '../permissionStore';

function resetStore() {
  usePermissionStore.setState({
    pending: [],
    resolved: [],
    exiting: [],
    errorIds: new Set(),
    dismissedIds: new Set(),
  });
  sessionStorage.clear();
}

function makePending(id: string) {
  return {
    id,
    tool_name: 'Bash',
    tool_input_preview: 'echo hello',
    createdAt: Date.now(),
    expiresAt: Date.now() + 1_800_000,
  };
}

describe('permissionStore dismiss', () => {
  beforeEach(() => resetStore());

  it('dismiss() removes from pending and adds to dismissedIds', () => {
    const store = usePermissionStore.getState();
    store.addPending(makePending('p-1'));
    store.dismiss('p-1');
    const state = usePermissionStore.getState();
    expect(state.pending).toHaveLength(0);
    expect(state.dismissedIds.has('p-1')).toBe(true);
  });

  it('dismiss() persists to sessionStorage', () => {
    const store = usePermissionStore.getState();
    store.addPending(makePending('p-1'));
    store.dismiss('p-1');
    const stored = sessionStorage.getItem('synapse-dismissed-permissions');
    expect(stored).toBeTruthy();
    expect(JSON.parse(stored!)).toContain('p-1');
  });

  it('hydrate() filters out dismissedIds', () => {
    usePermissionStore.setState({ dismissedIds: new Set(['p-2']) });
    usePermissionStore.getState().hydrate([makePending('p-1'), makePending('p-2')]);
    const state = usePermissionStore.getState();
    expect(state.pending).toHaveLength(1);
    expect(state.pending[0].id).toBe('p-1');
  });

  it('resolvePending() moves item to exiting array', () => {
    const store = usePermissionStore.getState();
    store.addPending(makePending('p-1'));
    store.resolvePending('p-1', 'allow');
    const state = usePermissionStore.getState();
    expect(state.pending).toHaveLength(0);
    expect(state.exiting).toHaveLength(1);
    expect(state.exiting[0].id).toBe('p-1');
  });

  it('removeExited() cleans up exiting array', () => {
    const store = usePermissionStore.getState();
    store.addPending(makePending('p-1'));
    store.resolvePending('p-1', 'allow');
    store.removeExited('p-1');
    const state = usePermissionStore.getState();
    expect(state.exiting).toHaveLength(0);
  });

  it('permissionResolved WS cleans up dismissedIds', () => {
    usePermissionStore.setState({ dismissedIds: new Set(['p-1']) });
    // Simulate WS message handler calling resolvePending
    // The cleanup happens on resolvePending — dismissedIds should remove p-1
    usePermissionStore.getState().resolvePending('p-1', 'allow');
    const state = usePermissionStore.getState();
    expect(state.dismissedIds.has('p-1')).toBe(false);
  });

  it('clearAllDismissed() dismisses all pending', () => {
    const store = usePermissionStore.getState();
    store.addPending(makePending('p-1'));
    store.addPending(makePending('p-2'));
    store.clearAllDismissed();
    const state = usePermissionStore.getState();
    expect(state.pending).toHaveLength(0);
    expect(state.dismissedIds.size).toBe(2);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd apps/dashboard && pnpm vitest run src/store/__tests__/permissionStore.dismiss.test.ts
```

Expected: FAIL — `dismiss`, `exiting`, `removeExited`, `clearAllDismissed` don't exist yet.

- [ ] **Step 3: Implement store changes**

Modify `apps/dashboard/src/store/permissionStore.ts`:

**Add to imports area:**

```ts
// Module-level empty arrays to avoid Zustand re-render loops
const EMPTY_PENDING: PendingSummary[] = [];
const EMPTY_RESOLVED: ResolvedPermission[] = [];
const EMPTY_EXITING: ResolvedPermission[] = [];

const MAX_RESOLVED = 50;
const DISMISSED_STORAGE_KEY = 'synapse-dismissed-permissions';

// ── SessionStorage helpers ────────────────────────────────
function loadDismissedIds(): Set<string> {
  try {
    const raw = sessionStorage.getItem(DISMISSED_STORAGE_KEY);
    if (!raw) return new Set();
    return new Set(JSON.parse(raw) as string[]);
  } catch {
    return new Set();
  }
}

function saveDismissedIds(ids: Set<string>): void {
  try {
    sessionStorage.setItem(DISMISSED_STORAGE_KEY, JSON.stringify([...ids]));
  } catch {
    // sessionStorage full or unavailable — non-fatal
  }
}
```

**Update the store interface to:**

```ts
interface PermissionStore {
  pending: PendingSummary[];
  resolved: ResolvedPermission[];
  exiting: ResolvedPermission[];
  errorIds: Set<string>;
  dismissedIds: Set<string>;

  addPending: (item: PendingSummary) => void;
  resolvePending: (id: string, behavior: 'allow' | 'deny') => void;
  removeExited: (id: string) => void;
  dismiss: (id: string) => void;
  clearAllDismissed: () => void;
  hydrate: (items: PendingSummary[]) => void;
  approve: (id: string, answers?: Record<string, string>) => Promise<void>;
  deny: (id: string) => Promise<void>;
  clearError: (id: string) => void;
}
```

**Update the store implementation:**

Initial state adds:

```ts
exiting: EMPTY_EXITING,
dismissedIds: loadDismissedIds(),
```

Replace `resolvePending` with:

```ts
resolvePending: (id, behavior) => {
  set((s) => {
    const idx = s.pending.findIndex((p) => p.id === id);
    // Also clean up dismissedIds when a permission resolves server-side
    const newDismissed = new Set(s.dismissedIds);
    newDismissed.delete(id);
    if (newDismissed.size !== s.dismissedIds.size) saveDismissedIds(newDismissed);

    if (idx === -1) return { dismissedIds: newDismissed };

    const item = s.pending[idx];
    const pending = s.pending.filter((p) => p.id !== id);
    const exitingItem: ResolvedPermission = { ...item, behavior, resolvedAt: Date.now() };
    const resolved = [exitingItem, ...s.resolved].slice(0, MAX_RESOLVED);
    return {
      pending,
      resolved,
      exiting: [...s.exiting, exitingItem],
      dismissedIds: newDismissed,
    };
  });
},
```

Add new actions:

```ts
removeExited: (id) => {
  set((s) => ({
    exiting: s.exiting.filter((e) => e.id !== id),
  }));
},

dismiss: (id) => {
  set((s) => {
    const newDismissed = new Set(s.dismissedIds);
    newDismissed.add(id);
    saveDismissedIds(newDismissed);
    return {
      pending: s.pending.filter((p) => p.id !== id),
      dismissedIds: newDismissed,
    };
  });
},

clearAllDismissed: () => {
  set((s) => {
    const newDismissed = new Set(s.dismissedIds);
    for (const p of s.pending) newDismissed.add(p.id);
    saveDismissedIds(newDismissed);
    return { pending: [], dismissedIds: newDismissed };
  });
},
```

Update `hydrate` to filter dismissedIds:

```ts
hydrate: (items) => {
  set((s) => {
    const existingIds = new Set(s.pending.map((p) => p.id));
    const resolvedIds = new Set(s.resolved.map((r) => r.id));
    const newItems = items.filter(
      (item) =>
        !existingIds.has(item.id) &&
        !resolvedIds.has(item.id) &&
        !s.dismissedIds.has(item.id),
    );
    return { pending: [...s.pending, ...newItems] };
  });
},
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd apps/dashboard && pnpm vitest run src/store/__tests__/permissionStore.dismiss.test.ts
```

Expected: All 7 tests PASS.

- [ ] **Step 5: Run full test suite to check for regressions**

```bash
cd apps/dashboard && pnpm vitest run
```

Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
git add apps/dashboard/src/store/permissionStore.ts apps/dashboard/src/store/__tests__/permissionStore.dismiss.test.ts
git commit -m "feat(store): add dismissedIds, exiting array, and sessionStorage persistence to permissionStore"
```

---

## Chunk 2: PermissionCard + PermissionModal

### Task 3: Create PermissionCard.tsx

**Files:**

- Create: `apps/dashboard/src/components/permissions/PermissionCard.tsx`

This is a refactor of `PermissionApprovalCard.tsx` with these additions:

- Wrapped in `motion.div` with `drag="x"` for swipe-to-dismiss
- Close X button (top-right) on every card that calls `onDismiss`
- `stopPropagation` on pointer events to prevent React Flow conflicts
- Scrollable content area with `max-h-[50vh]`
- Expand icon when content overflows (triggers modal)

- [ ] **Step 1: Create PermissionCard.tsx**

```tsx
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bernhard

import { useState, useEffect, useCallback, useRef } from 'react';
import { motion, useMotionValue, useTransform } from 'framer-motion';
import type { PendingSummary } from '../../store/permissionStore';
import { apiUrl } from '../../utils/api';

// ── Props ─────────────────────────────────────────────────

interface Props {
  permission: PendingSummary;
  onApprove: (id: string, answers?: Record<string, string>) => void;
  onDeny: (id: string) => void;
  onDismiss: (id: string) => void;
  onExpandToModal: (permission: PendingSummary) => void;
}

// ── AskUserQuestion types ─────────────────────────────────

interface AskOption {
  label: string;
  description?: string;
}

interface AskQuestion {
  question: string;
  header?: string;
  options: AskOption[];
  multiSelect?: boolean;
}

// ── Helpers ───────────────────────────────────────────────

const TRUNCATE_LENGTH = 80;

function formatCountdown(ms: number): string {
  if (ms <= 0) return '0:00';
  const totalSec = Math.ceil(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}:${sec.toString().padStart(2, '0')}`;
}

function parseAskQuestions(raw: unknown): AskQuestion[] | null {
  let parsed = raw;
  if (typeof parsed === 'string') {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      return null;
    }
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const obj = parsed as Record<string, unknown>;
  const questions = obj.questions;
  if (!Array.isArray(questions) || questions.length === 0) return null;
  const first = questions[0];
  if (!first || typeof first !== 'object') return null;
  if (!('question' in first) || !('options' in first)) return null;
  return questions as AskQuestion[];
}

// ── Close X Button ────────────────────────────────────────

function CloseButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className="absolute top-2 right-2 z-10 w-6 h-6 flex items-center justify-center rounded-full bg-gray-800/80 hover:bg-gray-700 text-gray-400 hover:text-gray-200 transition-colors"
      aria-label="Dismiss"
      title="Hide — Claude waits until timeout"
    >
      <svg
        width="10"
        height="10"
        viewBox="0 0 10 10"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      >
        <line x1="1" y1="1" x2="9" y2="9" />
        <line x1="9" y1="1" x2="1" y2="9" />
      </svg>
    </button>
  );
}

// ── Expand Button ─────────────────────────────────────────

function ExpandButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className="absolute bottom-2 right-2 z-10 w-6 h-6 flex items-center justify-center rounded-full bg-gray-800/80 hover:bg-gray-700 text-gray-400 hover:text-gray-200 transition-colors"
      aria-label="Expand"
      title="View full content"
    >
      <svg
        width="10"
        height="10"
        viewBox="0 0 10 10"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      >
        <polyline points="1,4 1,1 4,1" />
        <polyline points="9,6 9,9 6,9" />
        <line x1="1" y1="1" x2="4" y2="4" />
        <line x1="9" y1="9" x2="6" y2="6" />
      </svg>
    </button>
  );
}

// ── Countdown Hook ────────────────────────────────────────

function useCountdown(expiresAt: number): number {
  const [remaining, setRemaining] = useState(() => Math.max(0, expiresAt - Date.now()));
  useEffect(() => {
    if (remaining <= 0) return;
    const interval = setInterval(() => {
      const ms = Math.max(0, expiresAt - Date.now());
      setRemaining(ms);
      if (ms <= 0) clearInterval(interval);
    }, 1000);
    return () => clearInterval(interval);
  }, [expiresAt]); // eslint-disable-line react-hooks/exhaustive-deps
  return remaining;
}

// ── Expired Card ──────────────────────────────────────────

function ExpiredCard({ id, onDismiss }: { id: string; onDismiss: (id: string) => void }) {
  return (
    <div className="relative bg-amber-950/40 border border-amber-700/40 rounded-lg p-4 shadow-lg">
      <CloseButton onClick={() => onDismiss(id)} />
      <div className="flex items-center justify-between mb-2 pr-8">
        <span className="text-sm font-medium text-amber-300">Permission Request</span>
        <span className="text-xs text-amber-400 font-mono">0:00</span>
      </div>
      <p className="text-xs text-amber-300/80">
        Timed out — Claude denied and fell back to terminal.
      </p>
    </div>
  );
}

// ── AskUserQuestion Card ──────────────────────────────────

function AskUserQuestionContent({
  permission,
  questions,
  remaining,
  onApprove,
  onDeny,
}: {
  permission: PendingSummary;
  questions: AskQuestion[];
  remaining: number;
  onApprove: (id: string, answers?: Record<string, string>) => void;
  onDeny: (id: string) => void;
}) {
  const { id } = permission;
  const [activeTab, setActiveTab] = useState(0);
  const activeQ = questions[activeTab];
  const [selections, setSelections] = useState<Record<number, Set<number>>>({});

  const toggleOption = (qIdx: number, optIdx: number, multiSelect: boolean) => {
    setSelections((prev) => {
      const current = prev[qIdx] ?? new Set<number>();
      const next = new Set(current);
      if (multiSelect) {
        if (next.has(optIdx)) next.delete(optIdx);
        else next.add(optIdx);
      } else {
        next.clear();
        next.add(optIdx);
      }
      return { ...prev, [qIdx]: next };
    });
  };

  const isSelected = (qIdx: number, optIdx: number) => selections[qIdx]?.has(optIdx) ?? false;

  const buildAnswers = (): Record<string, string> => {
    const answers: Record<string, string> = {};
    for (let qi = 0; qi < questions.length; qi++) {
      const q = questions[qi];
      const selected = selections[qi];
      if (selected && selected.size > 0) {
        const labels = [...selected].map((i) => q.options[i]?.label).filter(Boolean);
        answers[q.question] = labels.join(', ');
      }
    }
    return answers;
  };

  const allAnswered = questions.every((_, qi) => (selections[qi]?.size ?? 0) > 0);

  return (
    <>
      {/* Header */}
      <div className="flex items-center justify-between px-4 pt-3 pb-2 pr-10">
        <span className="text-sm font-medium text-blue-300">Claude is asking you</span>
        <span
          className={`text-xs font-mono ${remaining < 60_000 ? 'text-red-400' : 'text-gray-400'}`}
        >
          {formatCountdown(remaining)}
        </span>
      </div>

      {/* Tab bar */}
      {questions.length > 1 && (
        <div className="flex items-center gap-1 px-3 pb-1 border-b border-gray-800 overflow-x-auto">
          {questions.map((q, i) => {
            const answered = (selections[i]?.size ?? 0) > 0;
            return (
              <button
                key={i}
                onClick={() => setActiveTab(i)}
                className={`px-2.5 py-1 rounded-md text-[10px] font-semibold uppercase tracking-wider shrink-0 transition-colors ${
                  i === activeTab
                    ? 'bg-blue-600/30 text-blue-300 border border-blue-500/40'
                    : 'text-gray-500 hover:text-gray-300 hover:bg-gray-800 border border-transparent'
                }`}
              >
                {answered ? '\u2713 ' : ''}
                {q.header || `Q${i + 1}`}
              </button>
            );
          })}
        </div>
      )}

      {/* Scrollable options area */}
      <div className="px-4 py-3 overflow-y-auto max-h-[40vh]">
        <p className="text-xs text-gray-200 font-medium mb-3">{activeQ.question}</p>
        <div className="space-y-1.5">
          {activeQ.options.map((opt, i) => {
            const selected = isSelected(activeTab, i);
            return (
              <button
                key={i}
                type="button"
                onClick={() => toggleOption(activeTab, i, !!activeQ.multiSelect)}
                className={`w-full text-left flex items-start gap-2.5 rounded-lg px-3 py-2 border transition-colors ${
                  selected
                    ? 'bg-blue-950/60 border-blue-500/60'
                    : 'bg-gray-950/50 border-gray-800 hover:border-gray-600'
                }`}
              >
                <div className="mt-0.5 shrink-0">
                  {activeQ.multiSelect ? (
                    <div
                      className={`w-3.5 h-3.5 rounded-sm border-2 flex items-center justify-center ${
                        selected ? 'border-blue-400 bg-blue-500' : 'border-gray-600'
                      }`}
                    >
                      {selected && (
                        <span className="text-[8px] text-white font-bold">{'\u2713'}</span>
                      )}
                    </div>
                  ) : (
                    <div
                      className={`w-3.5 h-3.5 rounded-full border-2 flex items-center justify-center ${
                        selected ? 'border-blue-400' : 'border-gray-600'
                      }`}
                    >
                      {selected && <div className="w-1.5 h-1.5 rounded-full bg-blue-400" />}
                    </div>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p
                    className={`text-xs font-medium ${selected ? 'text-blue-200' : 'text-gray-200'}`}
                  >
                    {opt.label}
                  </p>
                  {opt.description && (
                    <p className="text-[10px] leading-relaxed mt-0.5 text-gray-500">
                      {opt.description}
                    </p>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Pinned action buttons */}
      <div className="flex items-center gap-2 px-4 pb-3 pt-2 border-t border-gray-800/50">
        <button
          onClick={() => onDeny(id)}
          className="px-3 py-1.5 text-xs rounded bg-red-900/40 text-red-300 hover:bg-red-900/60 border border-red-800/40 transition-colors"
        >
          Deny
        </button>
        <button
          onClick={() => onApprove(id, buildAnswers())}
          disabled={!allAnswered}
          className={`ml-auto px-4 py-1.5 text-xs rounded border transition-colors font-medium ${
            allAnswered
              ? 'bg-green-900/40 text-green-300 hover:bg-green-900/60 border-green-800/40'
              : 'bg-gray-800/40 text-gray-600 border-gray-700/30 cursor-not-allowed'
          }`}
        >
          Send Answer
        </button>
      </div>
    </>
  );
}

// ── Generic Permission Content ────────────────────────────

function GenericPermissionContent({
  permission,
  remaining,
  onApprove,
  onDeny,
}: {
  permission: PendingSummary;
  remaining: number;
  onApprove: (id: string) => void;
  onDeny: (id: string) => void;
}) {
  const { id, tool_name } = permission;
  const tool_input_preview =
    typeof permission.tool_input_preview === 'string'
      ? permission.tool_input_preview
      : JSON.stringify(permission.tool_input_preview, null, 2);

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
      setFullInput(tool_input_preview);
    }
    setExpanded(true);
  }, [expanded, id, tool_input_preview]);

  return (
    <>
      {/* Header */}
      <div className="flex items-center justify-between px-4 pt-3 pb-2 pr-10">
        <span className="text-sm font-medium text-gray-200">Permission Request</span>
        <span
          className={`text-xs font-mono ${remaining < 60_000 ? 'text-red-400' : 'text-gray-400'}`}
        >
          {formatCountdown(remaining)}
        </span>
      </div>

      {/* Tool info — scrollable */}
      <div className="px-4 pb-2 overflow-y-auto max-h-[40vh]">
        <div className="space-y-1.5">
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
      </div>

      {/* Pinned action buttons */}
      <div className="flex items-center gap-2 px-4 pb-3 pt-2 border-t border-gray-800/50">
        <button
          onClick={() => onDeny(id)}
          className="px-3 py-1.5 text-xs rounded bg-red-900/40 text-red-300 hover:bg-red-900/60 border border-red-800/40 transition-colors"
        >
          Deny
        </button>
        <button
          onClick={() => onApprove(id)}
          className="ml-auto px-4 py-1.5 text-xs rounded bg-green-900/40 text-green-300 hover:bg-green-900/60 border border-green-800/40 transition-colors font-medium"
        >
          Approve
        </button>
      </div>
    </>
  );
}

// ── Main PermissionCard (with motion drag) ────────────────

export function PermissionCard({
  permission,
  onApprove,
  onDeny,
  onDismiss,
  onExpandToModal,
}: Props) {
  const { expiresAt } = permission;
  const remaining = useCountdown(expiresAt);
  const cardRef = useRef<HTMLDivElement>(null);
  const x = useMotionValue(0);
  const opacity = useTransform(x, [-200, 0, 200], [0, 1, 0]);

  const handleDragEnd = (_: unknown, info: { offset: { x: number }; velocity: { x: number } }) => {
    const cardWidth = cardRef.current?.offsetWidth ?? 384;
    const threshold = cardWidth * 0.4;
    if (Math.abs(info.offset.x) > threshold || Math.abs(info.velocity.x) > 500) {
      onDismiss(permission.id);
    }
  };

  // Check if content should offer modal expansion
  const questions =
    permission.tool_name === 'AskUserQuestion'
      ? parseAskQuestions(permission.tool_input_raw)
      : null;
  const shouldShowExpand = questions
    ? questions.some((q) => q.options.length > 5)
    : permission.tool_input_preview.length > TRUNCATE_LENGTH * 2;

  if (remaining <= 0) {
    return (
      <motion.div
        layout
        exit={{ opacity: 0, scale: 0.8 }}
        transition={{ type: 'spring', stiffness: 300, damping: 30 }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <ExpiredCard id={permission.id} onDismiss={onDismiss} />
      </motion.div>
    );
  }

  return (
    <motion.div
      ref={cardRef}
      layout
      drag="x"
      dragConstraints={{ left: 0, right: 0 }}
      dragElastic={0.7}
      onDragEnd={handleDragEnd}
      style={{ x, opacity }}
      initial={{ y: 80, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ x: 200, opacity: 0 }}
      transition={{ type: 'spring', stiffness: 300, damping: 30 }}
      onPointerDown={(e) => e.stopPropagation()}
      className="relative bg-gray-900/90 border border-gray-700/60 rounded-lg shadow-lg backdrop-blur-sm overflow-hidden cursor-grab active:cursor-grabbing"
    >
      <CloseButton onClick={() => onDismiss(permission.id)} />
      {shouldShowExpand && <ExpandButton onClick={() => onExpandToModal(permission)} />}

      {questions ? (
        <AskUserQuestionContent
          permission={permission}
          questions={questions}
          remaining={remaining}
          onApprove={onApprove}
          onDeny={onDeny}
        />
      ) : (
        <GenericPermissionContent
          permission={permission}
          remaining={remaining}
          onApprove={onApprove}
          onDeny={onDeny}
        />
      )}
    </motion.div>
  );
}
```

- [ ] **Step 2: Verify file compiles**

```bash
cd apps/dashboard && npx tsc --noEmit --skipLibCheck 2>&1 | head -20
```

Expected: No errors in `PermissionCard.tsx`.

- [ ] **Step 3: Commit**

```bash
git add apps/dashboard/src/components/permissions/PermissionCard.tsx
git commit -m "feat(permissions): create PermissionCard with drag-to-dismiss and close X"
```

---

### Task 4: Create PermissionModal.tsx

**Files:**

- Create: `apps/dashboard/src/components/permissions/PermissionModal.tsx`

- [ ] **Step 1: Create PermissionModal.tsx**

```tsx
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bernhard

import { useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { PendingSummary } from '../../store/permissionStore';
import { PermissionCard } from './PermissionCard';

interface Props {
  permission: PendingSummary | null;
  onClose: () => void;
  onApprove: (id: string, answers?: Record<string, string>) => void;
  onDeny: (id: string) => void;
  onDismiss: (id: string) => void;
}

export function PermissionModal({ permission, onClose, onApprove, onDeny, onDismiss }: Props) {
  const modalRef = useRef<HTMLDivElement>(null);

  // Escape key closes modal
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    },
    [onClose],
  );

  useEffect(() => {
    if (!permission) return;
    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, [permission, handleKeyDown]);

  // Focus trap: cycle Tab within modal
  useEffect(() => {
    if (!permission || !modalRef.current) return;
    const modal = modalRef.current;
    const focusable = modal.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    if (focusable.length > 0) focusable[0].focus();

    const handleTab = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last?.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first?.focus();
      }
    };

    modal.addEventListener('keydown', handleTab);
    return () => modal.removeEventListener('keydown', handleTab);
  }, [permission]);

  return (
    <AnimatePresence>
      {permission && (
        <motion.div
          className="fixed inset-0 z-[60] flex items-center justify-center p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
        >
          {/* Backdrop */}
          <motion.div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

          {/* Modal content */}
          <motion.div
            ref={modalRef}
            className="relative z-10 w-full max-w-[480px] max-h-[80vh] overflow-y-auto"
            initial={{ scale: 0.9, y: 20 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.9, y: 20 }}
            transition={{ type: 'spring', stiffness: 300, damping: 30 }}
            role="dialog"
            aria-modal="true"
            aria-label="Permission details"
          >
            <PermissionCard
              permission={permission}
              onApprove={(...args) => {
                onApprove(...args);
                onClose();
              }}
              onDeny={(id) => {
                onDeny(id);
                onClose();
              }}
              onDismiss={(id) => {
                onDismiss(id);
                onClose();
              }}
              onExpandToModal={() => {}} // Already in modal
            />
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
```

- [ ] **Step 2: Verify file compiles**

```bash
cd apps/dashboard && npx tsc --noEmit --skipLibCheck 2>&1 | head -20
```

- [ ] **Step 3: Commit**

```bash
git add apps/dashboard/src/components/permissions/PermissionModal.tsx
git commit -m "feat(permissions): create PermissionModal for expanded card view"
```

---

## Chunk 3: PermissionStack + Integration

### Task 5: Create PermissionStack.tsx

**Files:**

- Create: `apps/dashboard/src/components/permissions/PermissionStack.tsx`

- [ ] **Step 1: Create PermissionStack.tsx**

```tsx
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bernhard

import { useState, useCallback } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { usePermissionStore, type PendingSummary } from '../../store/permissionStore';
import { PermissionCard } from './PermissionCard';
import { PermissionModal } from './PermissionModal';

const MAX_VISIBLE_BEHIND = 3;

// Depth styling for stacked cards behind the top card
const DEPTH_STYLES = [
  {}, // top card — no transform
  { scale: 0.96, y: 8, opacity: 0.85 },
  { scale: 0.92, y: 16, opacity: 0.7 },
  { scale: 0.88, y: 24, opacity: 0.55 },
];

export function PermissionStack() {
  const pending = usePermissionStore((s) => s.pending);
  const exiting = usePermissionStore((s) => s.exiting);
  const approve = usePermissionStore((s) => s.approve);
  const deny = usePermissionStore((s) => s.deny);
  const dismiss = usePermissionStore((s) => s.dismiss);
  const clearAllDismissed = usePermissionStore((s) => s.clearAllDismissed);
  const removeExited = usePermissionStore((s) => s.removeExited);

  const [modalPermission, setModalPermission] = useState<PendingSummary | null>(null);

  const handleDismiss = useCallback((id: string) => dismiss(id), [dismiss]);
  const handleExpandToModal = useCallback((p: PendingSummary) => setModalPermission(p), []);

  // Newest on top (reverse of store order which is oldest-first)
  const displayItems = [...pending].reverse();
  const visibleCount = Math.min(displayItems.length, MAX_VISIBLE_BEHIND + 1);
  const hiddenCount = Math.max(0, displayItems.length - visibleCount);

  if (displayItems.length === 0 && exiting.length === 0) return null;

  return (
    <>
      {/* Stack container — bottom-center, pointer-events-none wrapper */}
      <div
        className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 w-full max-w-96 px-4 sm:px-0 pointer-events-none"
        style={{ maxWidth: '384px' }}
      >
        {/* Clear-all button */}
        {pending.length > 2 && (
          <div className="flex justify-center mb-2 pointer-events-auto">
            <button
              onClick={clearAllDismissed}
              className="px-3 py-1 text-[10px] font-medium rounded-full bg-gray-800/80 text-gray-300 hover:bg-gray-700 hover:text-gray-100 border border-gray-700/50 backdrop-blur-sm transition-colors"
            >
              Clear all ({pending.length})
            </button>
          </div>
        )}

        {/* "+N more" badge */}
        {hiddenCount > 0 && (
          <div className="flex justify-center mb-1.5 pointer-events-none">
            <span className="text-[10px] text-gray-500 bg-gray-900/60 rounded-full px-2 py-0.5">
              +{hiddenCount} more
            </span>
          </div>
        )}

        {/* Card stack */}
        <div className="relative pointer-events-auto">
          <AnimatePresence
            mode="popLayout"
            onExitComplete={() => {
              // Clean up any finished exiting items
              for (const item of exiting) {
                removeExited(item.id);
              }
            }}
          >
            {displayItems.slice(0, visibleCount).map((p, index) => {
              const depth = DEPTH_STYLES[index] ?? DEPTH_STYLES[MAX_VISIBLE_BEHIND];
              const isTop = index === 0;
              return (
                <motion.div
                  key={p.id}
                  style={{
                    position: index === 0 ? 'relative' : 'absolute',
                    bottom: 0,
                    left: 0,
                    right: 0,
                    zIndex: visibleCount - index,
                    pointerEvents: isTop ? 'auto' : 'none',
                  }}
                  animate={{
                    scale: depth.scale ?? 1,
                    y: depth.y ?? 0,
                    opacity: depth.opacity ?? 1,
                  }}
                  transition={{ type: 'spring', stiffness: 300, damping: 30 }}
                >
                  <PermissionCard
                    permission={p}
                    onApprove={approve}
                    onDeny={deny}
                    onDismiss={handleDismiss}
                    onExpandToModal={handleExpandToModal}
                  />
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      </div>

      {/* Modal */}
      <PermissionModal
        permission={modalPermission}
        onClose={() => setModalPermission(null)}
        onApprove={approve}
        onDeny={deny}
        onDismiss={handleDismiss}
      />
    </>
  );
}
```

- [ ] **Step 2: Verify file compiles**

```bash
cd apps/dashboard && npx tsc --noEmit --skipLibCheck 2>&1 | head -20
```

- [ ] **Step 3: Commit**

```bash
git add apps/dashboard/src/components/permissions/PermissionStack.tsx
git commit -m "feat(permissions): create PermissionStack with depth layering and AnimatePresence"
```

---

### Task 6: Swap PermissionPanel for PermissionStack in App.tsx and MobileView.tsx

**Files:**

- Modify: `apps/dashboard/src/App.tsx:14,420`
- Modify: `apps/dashboard/src/components/mobile/MobileView.tsx:11,34-35`

- [ ] **Step 1: Update App.tsx**

Replace the import on line 14:

```
- import { PermissionPanel } from './components/permissions/PermissionPanel';
+ import { PermissionStack } from './components/permissions/PermissionStack';
```

Replace the usage on line 420:

```
- <PermissionPanel />
+ <PermissionStack />
```

- [ ] **Step 2: Update MobileView.tsx**

Replace import on line 11:

```
- import { PermissionPanel } from '../permissions/PermissionPanel';
+ import { PermissionStack } from '../permissions/PermissionStack';
```

Replace the portal content (line 35):

```
- return createPortal(<PermissionPanel mobile />, document.body);
+ return createPortal(<PermissionStack />, document.body);
```

Note: `PermissionStack` uses `fixed` positioning internally, so the `mobile` prop is no longer needed. The portal still handles the iOS Safari overflow clipping issue.

- [ ] **Step 3: Verify compilation**

```bash
cd apps/dashboard && npx tsc --noEmit --skipLibCheck 2>&1 | head -20
```

- [ ] **Step 4: Commit**

```bash
git add apps/dashboard/src/App.tsx apps/dashboard/src/components/mobile/MobileView.tsx
git commit -m "feat(permissions): swap PermissionPanel for PermissionStack in App and MobileView"
```

---

### Task 7: Delete old files

**Files:**

- Delete: `apps/dashboard/src/components/permissions/PermissionPanel.tsx`
- Delete: `apps/dashboard/src/components/permissions/PermissionApprovalCard.tsx`

- [ ] **Step 1: Verify no remaining imports of old files**

```bash
cd apps/dashboard && grep -r "PermissionPanel\|PermissionApprovalCard" src/ --include="*.ts" --include="*.tsx" | grep -v __tests__ | grep -v node_modules
```

Expected: No results (all imports already swapped).

- [ ] **Step 2: Delete old files**

```bash
rm apps/dashboard/src/components/permissions/PermissionPanel.tsx
rm apps/dashboard/src/components/permissions/PermissionApprovalCard.tsx
```

- [ ] **Step 3: Verify compilation still works**

```bash
cd apps/dashboard && npx tsc --noEmit --skipLibCheck 2>&1 | head -20
```

- [ ] **Step 4: Commit**

```bash
git add -u apps/dashboard/src/components/permissions/PermissionPanel.tsx apps/dashboard/src/components/permissions/PermissionApprovalCard.tsx
git commit -m "refactor(permissions): delete PermissionPanel and PermissionApprovalCard (replaced by stack)"
```

---

### Task 8: Update tests

**Files:**

- Create: `apps/dashboard/src/components/permissions/__tests__/PermissionStack.test.tsx`
- Delete: `apps/dashboard/src/components/permissions/__tests__/PermissionPanel.test.tsx`

- [ ] **Step 1: Create PermissionStack.test.tsx**

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

vi.mock('../../../utils/api', () => ({
  apiUrl: (path: string) => path,
}));

// Mock framer-motion to avoid animation complexity in tests
vi.mock('framer-motion', () => {
  const React = require('react');
  return {
    motion: {
      div: React.forwardRef((props: Record<string, unknown>, ref: React.Ref<HTMLDivElement>) => {
        const {
          children,
          initial,
          animate,
          exit,
          transition,
          drag,
          dragConstraints,
          dragElastic,
          onDragEnd,
          whileHover,
          whileTap,
          layout,
          ...rest
        } = props;
        return React.createElement('div', { ...rest, ref }, children);
      }),
    },
    AnimatePresence: ({ children }: { children: React.ReactNode }) => children,
    useMotionValue: () => ({ get: () => 0, set: () => {} }),
    useTransform: () => ({ get: () => 1 }),
  };
});

import { PermissionStack } from '../PermissionStack';
import { usePermissionStore, type PendingSummary } from '../../../store/permissionStore';

function resetStore() {
  usePermissionStore.setState({
    pending: [],
    resolved: [],
    exiting: [],
    errorIds: new Set(),
    dismissedIds: new Set(),
  });
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

describe('PermissionStack', () => {
  beforeEach(() => {
    resetStore();
    cleanup();
  });

  it('renders nothing when no pending permissions', () => {
    const { container } = render(<PermissionStack />);
    expect(container.children.length).toBe(0);
  });

  it('renders a card for each visible pending permission', () => {
    usePermissionStore.getState().addPending(makePending({ id: 'p-1', tool_name: 'Bash' }));
    usePermissionStore.getState().addPending(makePending({ id: 'p-2', tool_name: 'Write' }));
    render(<PermissionStack />);
    expect(screen.getByText('Bash')).toBeTruthy();
    expect(screen.getByText('Write')).toBeTruthy();
  });

  it('shows clear-all button when more than 2 pending', () => {
    usePermissionStore.getState().addPending(makePending({ id: 'p-1' }));
    usePermissionStore.getState().addPending(makePending({ id: 'p-2' }));
    usePermissionStore.getState().addPending(makePending({ id: 'p-3' }));
    render(<PermissionStack />);
    expect(screen.getByText('Clear all (3)')).toBeTruthy();
  });

  it('shows +N more badge when more than 4 items', () => {
    for (let i = 0; i < 6; i++) {
      usePermissionStore.getState().addPending(makePending({ id: `p-${i}` }));
    }
    render(<PermissionStack />);
    expect(screen.getByText('+2 more')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Delete old test file**

```bash
rm apps/dashboard/src/components/permissions/__tests__/PermissionPanel.test.tsx
```

- [ ] **Step 3: Run new tests**

```bash
cd apps/dashboard && pnpm vitest run src/components/permissions/__tests__/PermissionStack.test.tsx
```

Expected: All 4 tests PASS.

- [ ] **Step 4: Run full test suite**

```bash
cd apps/dashboard && pnpm vitest run
```

Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/components/permissions/__tests__/PermissionStack.test.tsx
git add -u apps/dashboard/src/components/permissions/__tests__/PermissionPanel.test.tsx
git commit -m "test(permissions): replace PermissionPanel tests with PermissionStack tests"
```

---

## Chunk 4: VS Code Extension Verification

### Task 9: Verify VS Code extension builds

**Files:** None modified — verification only.

- [ ] **Step 1: Build the dashboard**

```bash
cd apps/dashboard && pnpm build
```

Expected: Build succeeds, framer-motion bundled correctly.

- [ ] **Step 2: Build the VS Code extension**

```bash
cd apps/vscode && pnpm run package
```

Expected: `.vsix` file created, size < 1.5MB.

- [ ] **Step 3: Check .vsix size**

```bash
ls -la apps/vscode/*.vsix
```

Expected: Size < 1.5MB (current is ~1.18MB, framer-motion adds ~30KB gz).

- [ ] **Step 4: If build fails — investigate esbuild issues**

framer-motion is browser-safe ESM. If esbuild chokes, check `apps/vscode/esbuild.*.mjs` for any `external` entries that need updating.

---

## Summary

| Task      | Description                                    | Estimated steps |
| --------- | ---------------------------------------------- | --------------- |
| 1         | Install framer-motion                          | 3               |
| 2         | Store: dismissedIds + exiting + sessionStorage | 6               |
| 3         | Create PermissionCard.tsx                      | 3               |
| 4         | Create PermissionModal.tsx                     | 3               |
| 5         | Create PermissionStack.tsx                     | 3               |
| 6         | Swap imports in App.tsx + MobileView.tsx       | 4               |
| 7         | Delete old files                               | 4               |
| 8         | Update tests                                   | 5               |
| 9         | Verify VS Code extension builds                | 4               |
| **Total** |                                                | **35 steps**    |
