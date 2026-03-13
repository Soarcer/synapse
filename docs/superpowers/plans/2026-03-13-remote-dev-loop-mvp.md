# Remote Dev Loop MVP — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable users to send instructions to Claude from their phone via a chat UI, using the existing AskUserQuestion + deny+message relay.

**Architecture:** A `/remote-dev` skill puts Claude into an AskUserQuestion loop. The dashboard routes remote-dev questions to a dedicated Zustand store (`remoteDevStore`) instead of the permission stack. A new "Dev" tab on mobile renders a chat UI. No server changes needed.

**Tech Stack:** React 19, Zustand 5, Vitest, Tailwind CSS 4, TypeScript

**Spec:** `docs/superpowers/specs/2026-03-13-remote-dev-loop-mvp-design.md`

---

## File Structure

| File                                                                    | Action | Responsibility                                                           |
| ----------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------ |
| `.claude/commands/remote-dev.md`                                        | Create | Skill: AskUserQuestion loop with single-call pattern                     |
| `apps/dashboard/src/store/remoteDevStore.ts`                            | Create | State: chat messages, pending question, status transitions, answer relay |
| `apps/dashboard/src/store/__tests__/remoteDevStore.test.ts`             | Create | Unit tests for store                                                     |
| `apps/dashboard/src/components/mobile/RemoteDevChat.tsx`                | Create | UI: chat messages, quick actions, text input                             |
| `apps/dashboard/src/components/mobile/__tests__/RemoteDevChat.test.tsx` | Create | Component render tests                                                   |
| `apps/dashboard/src/components/mobile/MobileTabBar.tsx`                 | Modify | Add "Dev" tab + waiting badge                                            |
| `apps/dashboard/src/components/mobile/MobileView.tsx`                   | Modify | Render RemoteDevChat, auto-switch on waiting                             |
| `apps/dashboard/src/store/permissionStore.ts`                           | Modify | Add `isRemoteDev()` helper, filter hydration                             |
| `apps/dashboard/src/store/agentStore.ts`                                | Modify | Route remote-dev WS messages before toast/permission                     |

---

## Task 0: Prerequisite Verification (BLOCKING)

Before writing any code, verify the three unknowns from the spec. This is a manual step — start the Synapse server, run a Claude Code session, and inspect payloads.

- [ ] **Step 1: Verify `metadata` passthrough**

In a Claude Code session, call AskUserQuestion with a `metadata` field. Check the hook server logs or the WS `pendingPermission` message to see if `metadata` appears in `tool_input_raw`.

If yes → use `metadata.source === 'remote-dev'` as primary detection.
If no → use `header === 'Remote'` as primary detection. Update `isRemoteDev()` in Task 3 accordingly.

- [ ] **Step 2: Verify `tool_input_raw` structure**

Inspect the `tool_input_raw` shape for an AskUserQuestion payload. Document:

- Field name for question text (likely `question` or `tool_input.question`)
- Field name for options array (likely `options` with `{ label, description }` objects)
- Whether `header` is a top-level field or nested

Cross-reference with the existing AskUserQuestion rendering in `PermissionCard.tsx` — it already parses this shape.

Update `extractQuestionText()`, `extractOptions()`, and `isRemoteDev()` in Tasks 1 and 3 to match the verified shape.

- [ ] **Step 3: Verify answer key format**

Call AskUserQuestion with options + "Other" free-text. Pick Other, type something. Inspect the answer key format in the deny+message relay.

Document the exact key used. Update `sendAnswer()` in Task 1 to use the verified key.

**Note:** The spec's file table says WS routing is in `App.tsx` — this is incorrect. The actual `wsClient.setOnEvent` handler lives in `apps/dashboard/src/store/agentStore.ts` (~line 934). The plan targets the correct file.

---

## Chunk 1: remoteDevStore (state + logic)

### Task 1: Create `remoteDevStore` with `receiveQuestion`

**Files:**

- Create: `apps/dashboard/src/store/remoteDevStore.ts`
- Create: `apps/dashboard/src/store/__tests__/remoteDevStore.test.ts`

- [ ] **Step 1: Write failing tests for `receiveQuestion`**

Create `apps/dashboard/src/store/__tests__/remoteDevStore.test.ts`:

```typescript
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bernhard

// @vitest-environment jsdom

vi.mock('../../utils/api', () => ({
  apiUrl: (path: string) => path,
}));

import { useRemoteDevStore } from '../remoteDevStore';

const initialState = useRemoteDevStore.getState();

function resetStore() {
  useRemoteDevStore.setState({
    ...initialState,
    messages: [],
    pendingQuestion: null,
    quickActions: [],
    status: 'idle',
  });
}

beforeEach(() => resetStore());

describe('receiveQuestion', () => {
  const makeQuestion = (questionText: string, options: string[] = []) => ({
    id: 'perm-1',
    tool_name: 'AskUserQuestion',
    tool_input_preview: questionText.slice(0, 200),
    tool_input_raw: {
      question: questionText,
      options: options.map((label) => ({ label, description: '' })),
      metadata: { source: 'remote-dev' },
    },
    createdAt: 1000,
    expiresAt: 1000 + 30 * 60_000,
  });

  it('parses question with separator into claude message + waiting state', () => {
    const store = useRemoteDevStore.getState();
    store.receiveQuestion(makeQuestion("Added sticky header. Tests pass.\n---\nWhat's next?"));

    const s = useRemoteDevStore.getState();
    expect(s.status).toBe('waiting');
    expect(s.pendingQuestion?.id).toBe('perm-1');
    expect(s.messages).toHaveLength(1);
    expect(s.messages[0].role).toBe('claude');
    expect(s.messages[0].text).toBe('Added sticky header. Tests pass.');
  });

  it('handles question without separator (first iteration)', () => {
    const store = useRemoteDevStore.getState();
    store.receiveQuestion(makeQuestion("What's next?"));

    const s = useRemoteDevStore.getState();
    expect(s.status).toBe('waiting');
    expect(s.messages).toHaveLength(0); // No status text = no claude message
  });

  it('extracts quick actions from options', () => {
    const store = useRemoteDevStore.getState();
    store.receiveQuestion(
      makeQuestion("Done.\n---\nWhat's next?", ['Run tests', 'Build', 'Commit']),
    );

    expect(useRemoteDevStore.getState().quickActions).toEqual(['Run tests', 'Build', 'Commit']);
  });

  it('detects error in status text', () => {
    const store = useRemoteDevStore.getState();
    store.receiveQuestion(makeQuestion("Build failed with 3 errors.\n---\nWhat's next?"));

    const msg = useRemoteDevStore.getState().messages[0];
    expect(msg.isError).toBe(true);
  });

  it('replaces previous pending question (race guard)', () => {
    const store = useRemoteDevStore.getState();
    store.receiveQuestion(makeQuestion("First.\n---\nWhat's next?"));
    store.receiveQuestion({
      ...makeQuestion("Second.\n---\nWhat's next?"),
      id: 'perm-2',
    });

    const s = useRemoteDevStore.getState();
    expect(s.pendingQuestion?.id).toBe('perm-2');
    expect(s.messages).toHaveLength(2); // Both claude messages kept in history
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/dashboard && npx vitest run src/store/__tests__/remoteDevStore.test.ts`
Expected: FAIL — module `../remoteDevStore` not found

- [ ] **Step 3: Write minimal `remoteDevStore.ts`**

Create `apps/dashboard/src/store/remoteDevStore.ts`:

```typescript
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bernhard

import { create } from 'zustand';
import type { PendingSummary } from './permissionStore';
import { apiUrl } from '../utils/api';

// ── Types ─────────────────────────────────────────────────────

export interface ChatMessage {
  id: string;
  role: 'user' | 'claude';
  text: string;
  timestamp: number;
  isError?: boolean;
}

export type RemoteDevStatus = 'idle' | 'waiting' | 'working';

interface RemoteDevState {
  messages: ChatMessage[];
  pendingQuestion: PendingSummary | null;
  quickActions: string[];
  status: RemoteDevStatus;

  receiveQuestion: (data: PendingSummary) => void;
  sendAnswer: (text: string) => Promise<void>;
  resolveQuestion: () => void;
  clear: () => void;
}

// ── Helpers ───────────────────────────────────────────────────

let msgCounter = 0;
function nextMsgId(): string {
  return `rdm-${++msgCounter}`;
}

/**
 * Extract the question text from tool_input_raw.
 * AskUserQuestion tool_input has a `question` string field.
 */
function extractQuestionText(raw: unknown): string {
  if (raw && typeof raw === 'object' && 'question' in raw) {
    return String((raw as Record<string, unknown>).question);
  }
  return '';
}

/**
 * Extract option labels from tool_input_raw.options array.
 * Each option has a `label` field.
 */
function extractOptions(raw: unknown): string[] {
  if (raw && typeof raw === 'object' && 'options' in raw) {
    const opts = (raw as Record<string, unknown>).options;
    if (Array.isArray(opts)) {
      return opts
        .filter((o) => o && typeof o === 'object' && 'label' in o)
        .map((o) => String((o as Record<string, unknown>).label));
    }
  }
  return [];
}

// ── Store ─────────────────────────────────────────────────────

export const useRemoteDevStore = create<RemoteDevState>((set, get) => ({
  messages: [],
  pendingQuestion: null,
  quickActions: [],
  status: 'idle' as RemoteDevStatus,

  receiveQuestion: (data) => {
    const questionText = extractQuestionText(data.tool_input_raw);
    const sepIdx = questionText.indexOf('\n---\n');

    const statusText = sepIdx >= 0 ? questionText.slice(0, sepIdx).trim() : '';
    const quickActions = extractOptions(data.tool_input_raw);

    set((s) => {
      const newMessages = [...s.messages];
      if (statusText) {
        newMessages.push({
          id: nextMsgId(),
          role: 'claude',
          text: statusText,
          timestamp: Date.now(),
          isError: /error|failed/i.test(statusText),
        });
      }
      return {
        messages: newMessages,
        pendingQuestion: data,
        quickActions,
        status: 'waiting' as RemoteDevStatus,
      };
    });
  },

  sendAnswer: async (text) => {
    const pq = get().pendingQuestion;
    if (!pq) return;

    const msgId = nextMsgId();
    set((s) => ({
      messages: [...s.messages, { id: msgId, role: 'user' as const, text, timestamp: Date.now() }],
      status: 'working' as RemoteDevStatus,
    }));

    try {
      // Answer key format: use question text as key (same as permissionStore.approve)
      const questionText = extractQuestionText(pq.tool_input_raw);
      const res = await fetch(apiUrl(`/api/permissions/${pq.id}/decision`), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ behavior: 'allow', answers: { [questionText]: text } }),
      });
      if (!res.ok && res.status !== 404) {
        throw new Error(`HTTP ${res.status}`);
      }
    } catch {
      // Error recovery: revert to waiting, mark message as failed
      set((s) => ({
        status: 'waiting' as RemoteDevStatus,
        messages: s.messages.map((m) =>
          m.id === msgId ? { ...m, isError: true, text: `${m.text} (failed to send)` } : m,
        ),
      }));
    }
  },

  resolveQuestion: () => {
    set({ pendingQuestion: null });
  },

  clear: () => {
    set({
      messages: [],
      pendingQuestion: null,
      quickActions: [],
      status: 'idle' as RemoteDevStatus,
    });
  },
}));
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/dashboard && npx vitest run src/store/__tests__/remoteDevStore.test.ts`
Expected: All 5 tests PASS

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/store/remoteDevStore.ts apps/dashboard/src/store/__tests__/remoteDevStore.test.ts
git commit -m "feat(dashboard): add remoteDevStore with receiveQuestion parsing"
```

---

### Task 2: Add `sendAnswer` tests + error recovery

**Files:**

- Modify: `apps/dashboard/src/store/__tests__/remoteDevStore.test.ts`

- [ ] **Step 1: Write failing tests for `sendAnswer`**

Add to `remoteDevStore.test.ts`:

```typescript
describe('sendAnswer', () => {
  const makeQuestion = (questionText: string) => ({
    id: 'perm-1',
    tool_name: 'AskUserQuestion',
    tool_input_preview: questionText.slice(0, 200),
    tool_input_raw: {
      question: questionText,
      options: [],
      metadata: { source: 'remote-dev' },
    },
    createdAt: 1000,
    expiresAt: 1000 + 30 * 60_000,
  });

  it('sends answer and transitions to working', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });

    const store = useRemoteDevStore.getState();
    store.receiveQuestion(makeQuestion("What's next?"));
    await store.sendAnswer('make it blue');

    const s = useRemoteDevStore.getState();
    expect(s.status).toBe('working');
    expect(s.messages.at(-1)?.role).toBe('user');
    expect(s.messages.at(-1)?.text).toBe('make it blue');
    expect(globalThis.fetch).toHaveBeenCalledWith(
      '/api/permissions/perm-1/decision',
      expect.objectContaining({ method: 'PUT' }),
    );
  });

  it('reverts to waiting on network error', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

    const store = useRemoteDevStore.getState();
    store.receiveQuestion(makeQuestion("What's next?"));
    await store.sendAnswer('make it blue');

    const s = useRemoteDevStore.getState();
    expect(s.status).toBe('waiting');
    expect(s.messages.at(-1)?.isError).toBe(true);
    expect(s.messages.at(-1)?.text).toContain('failed to send');
  });

  it('does nothing if no pending question', async () => {
    globalThis.fetch = vi.fn();
    await useRemoteDevStore.getState().sendAnswer('hello');
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});

describe('resolveQuestion', () => {
  it('clears pending but keeps working status', () => {
    const store = useRemoteDevStore.getState();
    store.receiveQuestion({
      id: 'perm-1',
      tool_name: 'AskUserQuestion',
      tool_input_preview: '',
      tool_input_raw: { question: "What's next?", options: [], metadata: { source: 'remote-dev' } },
      createdAt: 1000,
      expiresAt: 1000 + 30 * 60_000,
    });
    // Simulate sendAnswer setting status to working
    useRemoteDevStore.setState({ status: 'working' });
    store.resolveQuestion();

    const s = useRemoteDevStore.getState();
    expect(s.pendingQuestion).toBeNull();
    expect(s.status).toBe('working'); // Stays working until next receiveQuestion
  });
});

describe('clear', () => {
  it('resets all state to idle', () => {
    const store = useRemoteDevStore.getState();
    store.receiveQuestion({
      id: 'perm-1',
      tool_name: 'AskUserQuestion',
      tool_input_preview: '',
      tool_input_raw: {
        question: "Done.\n---\nWhat's next?",
        options: [],
        metadata: { source: 'remote-dev' },
      },
      createdAt: 1000,
      expiresAt: 1000 + 30 * 60_000,
    });
    store.clear();

    const s = useRemoteDevStore.getState();
    expect(s.messages).toHaveLength(0);
    expect(s.pendingQuestion).toBeNull();
    expect(s.status).toBe('idle');
  });
});
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `cd apps/dashboard && npx vitest run src/store/__tests__/remoteDevStore.test.ts`
Expected: All tests PASS (implementation already handles these cases)

- [ ] **Step 3: Commit**

```bash
git add apps/dashboard/src/store/__tests__/remoteDevStore.test.ts
git commit -m "test(dashboard): add sendAnswer, resolveQuestion, and clear tests for remoteDevStore"
```

---

### Task 3: Add `isRemoteDev` helper + WS routing

**Files:**

- Modify: `apps/dashboard/src/store/permissionStore.ts`
- Modify: `apps/dashboard/src/store/agentStore.ts`

- [ ] **Step 1: Add `isRemoteDev` to `permissionStore.ts`**

Add after the `hydratePermissions` function at the bottom of `apps/dashboard/src/store/permissionStore.ts`:

```typescript
// ── Remote Dev detection helper ──────────────────────────────

/**
 * Check if a pending permission is a remote-dev AskUserQuestion.
 * Field names below must match the verified tool_input_raw shape from Task 0.
 * Update after prerequisite verification if needed.
 */
export function isRemoteDev(data: { tool_name?: string; tool_input_raw?: unknown }): boolean {
  if (data.tool_name !== 'AskUserQuestion') return false;
  const raw = data.tool_input_raw as Record<string, unknown> | undefined;
  if (!raw) return false;
  // Primary: metadata.source (if Claude Code passes it through)
  if (raw.metadata && (raw.metadata as Record<string, unknown>)?.source === 'remote-dev')
    return true;
  // Fallback: header field (set by skill as backup)
  if (raw.header === 'Remote') return true;
  return false;
}
```

- [ ] **Step 2: Update WS handler in `agentStore.ts`**

In `apps/dashboard/src/store/agentStore.ts`, find the `wsClient.setOnEvent` immediate handler (~line 934). Replace the `pendingPermission` block and add `permissionResolved` routing:

Before (existing code):

```typescript
wsClient.setOnEvent((msg) => {
  // Route permission messages to dedicated store; fire toast on new request
  if (msg.type === 'pendingPermission') {
    const data = msg.data as { tool_name?: string };
    toast(`Permission requested: ${data.tool_name ?? 'Tool'} needs approval`, 'info');
  }
  if (handlePermissionWsMessage(msg)) return;
```

After (add remote-dev routing before toast):

```typescript
wsClient.setOnEvent((msg) => {
  // Route remote-dev questions to dedicated store (before toast + permission store)
  if (msg.type === 'pendingPermission') {
    const data = msg.data as PendingSummary;
    if (isRemoteDev(data)) {
      useRemoteDevStore.getState().receiveQuestion(data);
      return;
    }
    toast(`Permission requested: ${data.tool_name ?? 'Tool'} needs approval`, 'info');
  }
  if (msg.type === 'permissionResolved') {
    const data = msg.data as { id: string; behavior: 'allow' | 'deny' };
    const devStore = useRemoteDevStore.getState();
    if (devStore.pendingQuestion?.id === data.id) {
      devStore.resolveQuestion();
      return;
    }
  }
  if (handlePermissionWsMessage(msg)) return;
```

Add imports at the top of `agentStore.ts`:

```typescript
import { useRemoteDevStore } from './remoteDevStore';
import { isRemoteDev, type PendingSummary } from './permissionStore';
```

- [ ] **Step 3: Update `hydratePermissions` to filter remote-dev items**

In `apps/dashboard/src/store/permissionStore.ts`, modify `hydratePermissions()`.

First add a static import at the top of `permissionStore.ts`:

```typescript
import { useRemoteDevStore } from './remoteDevStore';
```

Note: `remoteDevStore` only imports a `type` from `permissionStore`, so this is NOT a runtime circular dependency. Static import is safe and simpler than dynamic import.

Then update the function:

```typescript
export async function hydratePermissions(): Promise<void> {
  try {
    const res = await fetch(apiUrl('/api/permissions/pending'));
    if (res.ok) {
      const items: PendingSummary[] = await res.json();
      // Route remote-dev items to remoteDevStore, rest to permissionStore
      const remoteItems = items.filter((item) => isRemoteDev(item));
      const permItems = items.filter((item) => !isRemoteDev(item));
      for (const item of remoteItems) {
        useRemoteDevStore.getState().receiveQuestion(item);
      }
      usePermissionStore.getState().hydrate(permItems);
    }
  } catch {
    // Hydration failure is non-fatal — WS will deliver live updates
  }
}
```

- [ ] **Step 4: Run all store tests**

Run: `cd apps/dashboard && npx vitest run src/store/__tests__/`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/store/permissionStore.ts apps/dashboard/src/store/agentStore.ts
git commit -m "feat(dashboard): route remote-dev WS messages to remoteDevStore"
```

---

## Chunk 2: UI Components

### Task 4: Create `RemoteDevChat.tsx`

**Files:**

- Create: `apps/dashboard/src/components/mobile/RemoteDevChat.tsx`
- Create: `apps/dashboard/src/components/mobile/__tests__/RemoteDevChat.test.tsx`

- [ ] **Step 1: Write failing component tests**

Create `apps/dashboard/src/components/mobile/__tests__/RemoteDevChat.test.tsx`:

```typescript
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bernhard

// @vitest-environment jsdom
import { render, screen, fireEvent } from '@testing-library/react';
import { useRemoteDevStore } from '../../../store/remoteDevStore';

vi.mock('../../../utils/api', () => ({
  apiUrl: (path: string) => path,
}));

// Must import after mocks
import { RemoteDevChat } from '../RemoteDevChat';

const initialState = useRemoteDevStore.getState();

function resetStore() {
  useRemoteDevStore.setState({ ...initialState, messages: [], pendingQuestion: null, quickActions: [], status: 'idle' });
}

beforeEach(() => resetStore());

describe('RemoteDevChat', () => {
  it('shows empty state when idle with no messages', () => {
    render(<RemoteDevChat />);
    expect(screen.getByText(/run.*\/remote-dev/i)).toBeInTheDocument();
  });

  it('renders claude messages', () => {
    useRemoteDevStore.setState({
      messages: [{ id: '1', role: 'claude', text: 'Added sticky header.', timestamp: 1000 }],
      status: 'waiting',
      pendingQuestion: { id: 'p1', tool_name: 'AskUserQuestion', tool_input_preview: '', createdAt: 1000, expiresAt: 2000 },
      quickActions: [],
    });
    render(<RemoteDevChat />);
    expect(screen.getByText('Added sticky header.')).toBeInTheDocument();
  });

  it('renders quick action buttons when waiting', () => {
    useRemoteDevStore.setState({
      messages: [],
      status: 'waiting',
      pendingQuestion: { id: 'p1', tool_name: 'AskUserQuestion', tool_input_preview: '', createdAt: 1000, expiresAt: 2000 },
      quickActions: ['Run tests', 'Build'],
    });
    render(<RemoteDevChat />);
    expect(screen.getByText('Run tests')).toBeInTheDocument();
    expect(screen.getByText('Build')).toBeInTheDocument();
  });

  it('disables input when not waiting', () => {
    useRemoteDevStore.setState({ status: 'working', messages: [], pendingQuestion: null, quickActions: [] });
    render(<RemoteDevChat />);
    const input = screen.getByPlaceholderText(/type instruction/i);
    expect(input).toBeDisabled();
  });

  it('shows working indicator when status is working', () => {
    useRemoteDevStore.setState({ status: 'working', messages: [], pendingQuestion: null, quickActions: [] });
    render(<RemoteDevChat />);
    expect(screen.getByText(/working/i)).toBeInTheDocument();
  });

  it('renders error messages with error styling', () => {
    useRemoteDevStore.setState({
      messages: [{ id: '1', role: 'claude', text: 'Build failed.', timestamp: 1000, isError: true }],
      status: 'waiting',
      pendingQuestion: { id: 'p1', tool_name: 'AskUserQuestion', tool_input_preview: '', createdAt: 1000, expiresAt: 2000 },
      quickActions: [],
    });
    render(<RemoteDevChat />);
    const msg = screen.getByText('Build failed.');
    expect(msg.closest('[data-error]')).toHaveAttribute('data-error', 'true');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/dashboard && npx vitest run src/components/mobile/__tests__/RemoteDevChat.test.tsx`
Expected: FAIL — module not found

- [ ] **Step 3: Write `RemoteDevChat.tsx`**

Create `apps/dashboard/src/components/mobile/RemoteDevChat.tsx`:

```tsx
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bernhard

import { useRef, useEffect, useState } from 'react';
import {
  useRemoteDevStore,
  type ChatMessage,
  type RemoteDevStatus,
} from '../../store/remoteDevStore';

// Module-level empty arrays to avoid Zustand re-render loops
const EMPTY_MESSAGES: ChatMessage[] = [];
const EMPTY_ACTIONS: string[] = [];

export function RemoteDevChat() {
  const messages = useRemoteDevStore((s) => (s.messages.length > 0 ? s.messages : EMPTY_MESSAGES));
  const status = useRemoteDevStore((s) => s.status);
  const quickActions = useRemoteDevStore((s) =>
    s.quickActions.length > 0 ? s.quickActions : EMPTY_ACTIONS,
  );
  const [inputText, setInputText] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll on new messages
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages.length, status]);

  const handleSend = (text: string) => {
    if (!text.trim() || status !== 'waiting') return;
    useRemoteDevStore.getState().sendAnswer(text.trim());
    setInputText('');
  };

  // Empty state
  if (status === 'idle' && messages.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center p-6 text-center">
        <div className="text-gray-500 text-sm max-w-xs">
          <div className="text-2xl mb-3">⌘</div>
          <p>
            Start a Claude Code session on your PC and run{' '}
            <code className="text-blue-400">/remote-dev</code> — then come back here.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex-shrink-0 px-3 py-2 border-b border-gray-800 flex items-center justify-between">
        <span className="text-sm font-medium text-gray-300">Remote Dev</span>
        <StatusBadge status={status} />
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-2 space-y-2">
        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
        ))}
        {status === 'working' && (
          <div className="flex items-center gap-2 text-gray-500 text-xs py-1">
            <span className="animate-pulse">⏳</span>
            <span>Working...</span>
          </div>
        )}
      </div>

      {/* Quick actions */}
      {quickActions.length > 0 && status === 'waiting' && (
        <div className="flex-shrink-0 px-3 py-1.5 border-t border-gray-800/50 flex gap-1.5 overflow-x-auto">
          {quickActions.map((label) => (
            <button
              key={label}
              onClick={() => handleSend(label)}
              className="px-2.5 py-1 text-xs rounded-full border border-gray-700 bg-gray-800/50 text-gray-400 hover:bg-gray-700/50 hover:text-gray-300 transition-colors whitespace-nowrap flex-shrink-0"
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {/* Input */}
      <div className="flex-shrink-0 px-3 py-2 border-t border-gray-800 flex gap-2">
        <input
          type="text"
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handleSend(inputText);
            }
          }}
          disabled={status !== 'waiting'}
          placeholder="Type instruction..."
          className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-blue-500 disabled:opacity-40"
        />
        <button
          onClick={() => handleSend(inputText)}
          disabled={status !== 'waiting' || !inputText.trim()}
          className="px-3 py-1.5 bg-blue-600 text-white text-sm rounded-lg disabled:opacity-40 hover:bg-blue-500 transition-colors"
        >
          →
        </button>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: RemoteDevStatus }) {
  if (status === 'idle') return <span className="text-[10px] text-gray-600">Idle</span>;
  if (status === 'waiting')
    return (
      <span className="text-[10px] text-amber-400 flex items-center gap-1">
        <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
        Waiting
      </span>
    );
  return (
    <span className="text-[10px] text-blue-400 flex items-center gap-1">
      <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
      Working
    </span>
  );
}

function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user';
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        data-error={message.isError ? 'true' : undefined}
        className={`max-w-[85%] px-3 py-1.5 rounded-lg text-sm ${
          isUser
            ? 'bg-blue-600/20 text-blue-200'
            : message.isError
              ? 'bg-red-900/30 border border-red-700/50 text-red-300'
              : 'bg-gray-800 text-gray-300'
        }`}
      >
        <p className="whitespace-pre-wrap break-words">{message.text}</p>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/dashboard && npx vitest run src/components/mobile/__tests__/RemoteDevChat.test.tsx`
Expected: All 6 tests PASS

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/components/mobile/RemoteDevChat.tsx apps/dashboard/src/components/mobile/__tests__/RemoteDevChat.test.tsx
git commit -m "feat(dashboard): add RemoteDevChat component with tests"
```

---

### Task 5: Add "Dev" tab to MobileTabBar + MobileView

**Files:**

- Modify: `apps/dashboard/src/components/mobile/MobileTabBar.tsx`
- Modify: `apps/dashboard/src/components/mobile/MobileView.tsx`

- [ ] **Step 1: Update MobileTabBar**

In `apps/dashboard/src/components/mobile/MobileTabBar.tsx`:

1. Import remoteDevStore:

```typescript
import { useRemoteDevStore } from '../../store/remoteDevStore';
```

2. Update the `MobileTab` type (line 6):

```typescript
export type MobileTab = 'graph' | 'lenses' | 'analytics' | 'dev';
```

3. Add the dev tab to TABS array (after analytics, line 16):

```typescript
{ id: 'dev', label: 'Dev', icon: '⌘' },
```

4. Add remoteDevStore subscription inside the component (after `runningCount`):

```typescript
const remoteDevStatus = useRemoteDevStore((s) => s.status);
```

5. Add badge rendering for the dev tab (after the lenses badge block, ~line 44):

```typescript
{tab.id === 'dev' && remoteDevStatus === 'waiting' && (
  <span className="absolute -top-0.5 -right-1.5 w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
)}
```

- [ ] **Step 2: Update MobileView**

In `apps/dashboard/src/components/mobile/MobileView.tsx`:

1. Import RemoteDevChat and remoteDevStore:

```typescript
import { RemoteDevChat } from './RemoteDevChat';
import { useRemoteDevStore } from '../../store/remoteDevStore';
```

2. Add auto-switch effect. Add the hook subscription and effect (after the WS reconnect effect, ~line 82):

```typescript
import { useRemoteDevStore } from '../../store/remoteDevStore';

// ... inside MobileView component:
const remoteDevStatus = useRemoteDevStore((s) => s.status);

// Auto-switch to Dev tab when a remote-dev question arrives
useEffect(() => {
  if (remoteDevStatus === 'waiting') setActiveTab('dev');
}, [remoteDevStatus]);
```

3. Add the Dev tab content (after analytics Suspense block, ~line 100):

```typescript
{activeTab === 'dev' && <RemoteDevChat />}
```

- [ ] **Step 3: Run the full test suite**

Run: `cd apps/dashboard && npx vitest run`
Expected: All tests PASS

- [ ] **Step 4: Commit**

```bash
git add apps/dashboard/src/components/mobile/MobileTabBar.tsx apps/dashboard/src/components/mobile/MobileView.tsx
git commit -m "feat(dashboard): add Dev tab to mobile with auto-switch and waiting badge"
```

---

## Chunk 3: Skill + Final Integration

### Task 6: Create `/remote-dev` skill

**Files:**

- Create: `.claude/commands/remote-dev.md`

- [ ] **Step 1: Write the skill file**

Create `.claude/commands/remote-dev.md`:

```markdown
# Remote Dev Loop

You are now in **remote dev mode**. The user is controlling you from their phone via the Synapse dashboard. They cannot see your terminal — they see a chat interface.

## How This Works

You will enter a loop where you:

1. Execute the user's instruction
2. Call AskUserQuestion to report what you did and ask for the next instruction
3. Repeat until the user says "exit", "stop", or "done"

## Rules

- **Status reports must be concise** — 2-3 sentences max. The user is on a small phone screen.
- **Do NOT use `---` (horizontal rule) in your status report** — it is reserved as the separator between your report and the prompt.
- **Always include what files you changed** in your status report.
- **If a task fails, say so clearly** — include the error message.
- **Keep working autonomously** — don't ask clarifying questions unless truly ambiguous. The user expects you to figure it out.

## Loop

On the first iteration, skip the status report and just ask what to do:

Call AskUserQuestion with:

- question: "Remote dev mode active. What would you like me to do?"
- metadata: { source: "remote-dev" }
- options: [{ label: "Run tests", description: "" }, { label: "Build", description: "" }, { label: "Commit", description: "" }, { label: "Git status", description: "" }]

On subsequent iterations, include your status report before the separator:

Call AskUserQuestion with:

- question: "{concise summary of what you did, files changed, outcome}\n---\nWhat's next?"
- metadata: { source: "remote-dev" }
- options: [{ label: "Run tests", description: "" }, { label: "Build", description: "" }, { label: "Commit", description: "" }, { label: "Git status", description: "" }]

## Handling Responses

- If the response message contains the user's instruction, execute it
- If the response indicates "exit", "stop", or "done" — end the loop and say goodbye
- If you receive a timeout/denial with no message — silently re-ask (the user may have stepped away)
- For quick actions like "Run tests", "Build", "Commit", "Git status" — execute the obvious action

## Context Management

- Claude Code auto-compacts when approaching context limits — no manual intervention needed
- Keep status reports concise to minimize context burn
- For long sessions (15+ prompts), summarize prior work instead of listing every change
```

- [ ] **Step 2: Commit**

```bash
git add .claude/commands/remote-dev.md
git commit -m "feat: add /remote-dev skill for remote dev loop"
```

---

### Task 7: Final integration test

- [ ] **Step 1: Run the full test suite**

Run: `cd apps/dashboard && npx vitest run`
Expected: All tests PASS (existing + new)

- [ ] **Step 2: Run the server build**

Run: `pnpm -r build`
Expected: No TypeScript errors

- [ ] **Step 3: Manual smoke test**

1. Start Synapse server: `.\start-server.ps1`
2. Start dashboard: `.\start-client.ps1`
3. Open `http://localhost:5173?view=mobile` on desktop to simulate mobile
4. Navigate to Dev tab — verify empty state shows
5. Verify the 4 tabs appear: Graph | Lenses | Stats | Dev

- [ ] **Step 4: Final commit (if any fixes needed)**

```bash
git add -u
git commit -m "fix(dashboard): address integration issues from smoke test"
```

---

## Summary

| Task | What                                 | Files      | Tests      |
| ---- | ------------------------------------ | ---------- | ---------- |
| 1    | remoteDevStore + receiveQuestion     | 2 new      | 5          |
| 2    | sendAnswer + error recovery tests    | 1 modified | 4          |
| 3    | isRemoteDev + WS routing + hydration | 2 modified | existing   |
| 4    | RemoteDevChat component              | 2 new      | 6          |
| 5    | MobileTabBar + MobileView (Dev tab)  | 2 modified | existing   |
| 6    | /remote-dev skill                    | 1 new      | manual     |
| 7    | Integration test                     | —          | full suite |

**Total: 7 new files, 4 modified files, ~15 unit tests, 7 commits**

**After this plan:** Run the E2E manual test from the spec (start `/remote-dev` on PC, send instructions from phone). The answer key format prerequisite must be verified during that test — if the key format differs from what's implemented in `sendAnswer`, update the `extractQuestionText` call accordingly.
