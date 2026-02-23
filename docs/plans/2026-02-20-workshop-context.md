# Workshop Context Panel Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a collapsible context panel to the Prompt Workshop that auto-links sessions and accepts manual notes, so the AI coach evaluates prompts with full conversation awareness instead of in isolation.

**Architecture:** The Workshop already sends requests to `/api/analytics/ai-analyze-prompt`, which already accepts a `conversationContext` field — the backend is ready. This is mostly a frontend wiring job: pass session data into the Workshop, add a context panel UI with session picker + notes textarea, build `conversationContext` from the selected session's turns, persist settings in localStorage, update the system prompt to always assume project-aware context, and add a per-session turn fetch to avoid the global 50-turn limit.

**Tech Stack:** React 19, Tailwind CSS 4, localStorage for persistence, existing `MockSession`/`MockTurn` types from `mockData.ts`

**Review findings addressed:**

- useCallback deps: use `workshopCtx.notes` not the full object (avoids handler recreation on every keystroke)
- JSX placement: context panel goes **inside** the textarea card, before its closing `</div>` (line 349)
- maxTokens: bump from 768 → 1024 to accommodate the always-on `projectAwareBlock`
- Notes sanitization: strip newlines before injecting into AI prompt
- Per-session turn fetch: when a session is explicitly selected, fetch its turns directly (not from the capped global 50)
- Notes textarea: add `max-h-32` to prevent infinite resize
- Test gaps: add tests for empty prompts, short prompts, and single-turn sessions
- Conversational mode window mismatch: aligned count check and word-length check to same window in all 3 locations (PromptAnalyzer, nudgeEngine, Workshop)

---

## Task 1: Pass session data into PromptWorkshop

The Workshop currently receives only `analysisMode` and `modelId`. It needs access to sessions and turns to build conversation context.

**Files:**

- Modify: `apps/dashboard/src/components/analytics/workshop/PromptWorkshop.tsx:92-95`
- Modify: `apps/dashboard/src/components/analytics/AnalyticsPage.tsx:216`

**Step 1: Extend PromptWorkshopProps**

In `PromptWorkshop.tsx`, add sessions and turns to the props interface (line 92):

```typescript
interface PromptWorkshopProps {
  analysisMode: AnalysisMode;
  modelId?: string;
  sessions: MockSession[];
  turns: MockTurn[];
}
```

Add the imports at the top of the file:

```typescript
import type { MockSession, MockTurn } from '../mockData';
```

Update the destructured props at line 97:

```typescript
export function PromptWorkshop({ analysisMode, modelId, sessions, turns }: PromptWorkshopProps) {
```

**Step 2: Pass data from parent**

In `AnalyticsPage.tsx` line 216, pass sessions and turns:

```typescript
{activeTab === 'workshop' && (
  <PromptWorkshop
    analysisMode={analysisMode}
    modelId={selectedModel}
    sessions={mockData.sessions}
    turns={mockData.turns}
  />
)}
```

**Step 3: Verify**

Run: `cd apps/dashboard && npx tsc --noEmit`
Expected: No type errors.

**Step 4: Commit**

```bash
git add apps/dashboard/src/components/analytics/workshop/PromptWorkshop.tsx apps/dashboard/src/components/analytics/AnalyticsPage.tsx
git commit -m "feat(workshop): pass sessions and turns data into PromptWorkshop"
```

---

## Task 2: Add context state and localStorage persistence

Add state for the context panel: selected session ID, additional notes, and panel open/closed. Persist all three in localStorage so settings survive page reloads.

**Files:**

- Modify: `apps/dashboard/src/components/analytics/workshop/PromptWorkshop.tsx`

**Step 1: Add localStorage key and load/save helpers**

After the existing `WORKSHOP_HISTORY_KEY` constant (line 25), add:

```typescript
const WORKSHOP_CONTEXT_KEY = 'synapse-workshop-context';

interface WorkshopContext {
  sessionId: string | null; // null = auto (most recent), '' = none
  notes: string;
  panelOpen: boolean;
}

const DEFAULT_CONTEXT: WorkshopContext = {
  sessionId: null,
  notes: '',
  panelOpen: false,
};

function loadContext(): WorkshopContext {
  try {
    const raw = localStorage.getItem(WORKSHOP_CONTEXT_KEY);
    return raw ? { ...DEFAULT_CONTEXT, ...JSON.parse(raw) } : DEFAULT_CONTEXT;
  } catch {
    return DEFAULT_CONTEXT;
  }
}

function saveContext(ctx: WorkshopContext): void {
  try {
    localStorage.setItem(WORKSHOP_CONTEXT_KEY, JSON.stringify(ctx));
  } catch {
    /* quota exceeded */
  }
}
```

**Step 2: Add state to the component**

After the existing state declarations (around line 106), add:

```typescript
const [workshopCtx, setWorkshopCtx] = useState<WorkshopContext>(loadContext);
```

And add a persistence effect after the existing history effect (line 109):

```typescript
useEffect(() => {
  saveContext(workshopCtx);
}, [workshopCtx]);
```

**Step 3: Add derived values for the resolved session**

After the new state, add a `useMemo` that resolves "auto" to the most recent session:

```typescript
const resolvedSession = useMemo(() => {
  if (workshopCtx.sessionId === '') return null; // explicitly "none"
  if (workshopCtx.sessionId === null) {
    // Auto: pick most recent session
    return sessions.length > 0 ? sessions.reduce((a, b) => (a.endTime > b.endTime ? a : b)) : null;
  }
  return sessions.find((s) => s.id === workshopCtx.sessionId) ?? null;
}, [workshopCtx.sessionId, sessions]);

const sessionTurns = useMemo(() => {
  if (!resolvedSession) return [];
  // Prefer session-specific turns if fetched, otherwise fall back to global turns
  const source = sessionSpecificTurns.length > 0 ? sessionSpecificTurns : turns;
  return source
    .filter((t) => t.sessionId === resolvedSession.id)
    .sort((a, b) => a.turnIndex - b.turnIndex);
}, [resolvedSession, turns, sessionSpecificTurns]);
```

**Step 4: Add per-session turn fetch for explicitly selected sessions**

The global `turns` prop is capped at 50 rows across all sessions. When a user explicitly selects a session, fetch that session's complete turns so the context is accurate:

```typescript
const [sessionSpecificTurns, setSessionSpecificTurns] = useState<MockTurn[]>([]);

useEffect(() => {
  // Only fetch for explicitly selected sessions (not auto, not none)
  if (!workshopCtx.sessionId || workshopCtx.sessionId === '') {
    setSessionSpecificTurns([]);
    return;
  }
  fetch(`/api/analytics/turns?sessionId=${encodeURIComponent(workshopCtx.sessionId)}&limit=200`)
    .then((r) => r.json())
    .then((data) => {
      const raw = data.data ?? data;
      if (Array.isArray(raw)) {
        setSessionSpecificTurns(
          raw.map((t: Record<string, unknown>) => ({
            sessionId: (t.sessionId as string) || '',
            turnIndex: t.turnIndex as number,
            timestamp: t.timestamp as number,
            promptText: (t.promptText as string) || '',
            inputTokens: t.inputTokens as number,
            outputTokens: t.outputTokens as number,
            cacheReadTokens: (t.cacheReadTokens as number) || 0,
            cacheCreationTokens: (t.cacheCreationTokens as number) || 0,
            thinkingTokens: (t.thinkingTokens as number) || 0,
            toolCount: (t.toolCount as number) || 0,
            toolNames: (t.toolNames as string[]) || [],
            latencyMs: (t.latencyMs as number) || 0,
            costUsd: (t.costUsd as number) || 0,
            model: (t.model as string) || 'claude-sonnet-4-5',
            compactionBefore: (t.compactionBefore as boolean) || false,
          })),
        );
      }
    })
    .catch(() => setSessionSpecificTurns([]));
}, [workshopCtx.sessionId]);
```

Note: place the `sessionSpecificTurns` state declaration near the other state, and place the `useEffect` after the other effects. The `sessionTurns` useMemo (Step 3) already references `sessionSpecificTurns`.

**Step 5: Verify**

Run: `cd apps/dashboard && npx tsc --noEmit`
Expected: No type errors.

**Step 6: Commit**

```bash
git add apps/dashboard/src/components/analytics/workshop/PromptWorkshop.tsx
git commit -m "feat(workshop): add context state with localStorage persistence and per-session fetch"
```

---

## Task 3: Build conversationContext from session turns

Extract the context-building logic from PromptAnalyzer into a shared helper, then use it in both PromptAnalyzer and PromptWorkshop.

**Files:**

- Modify: `apps/dashboard/src/components/analytics/workshop/PromptWorkshop.tsx`

**Step 1: Add a `buildConversationContext` helper inside the component**

After the `sessionTurns` memo, add a function that builds the context payload matching the backend's expected shape. For Workshop mode, we use the _last_ turn as the "current" turn position (user is drafting the _next_ prompt in the session):

```typescript
const conversationContext = useMemo(() => {
  if (sessionTurns.length === 0) return undefined;

  const lastTurn = sessionTurns[sessionTurns.length - 1];
  const priorTurns = sessionTurns.slice(-3); // last 3 turns as context

  // Detect conversational mode: 2+ of the last 3 turns within 2min AND all short
  const twoMinMs = 2 * 60 * 1000;
  const recentPrior = priorTurns.filter((t) => lastTurn.timestamp - t.timestamp < twoMinMs);
  const isConversationalMode =
    recentPrior.length >= 2 &&
    recentPrior.every((t) => t.promptText.split(/\s+/).filter(Boolean).length < 15);

  // Session goal: first sentence / first 100 chars of first prompt
  const firstTurn = sessionTurns[0];
  const goalText = firstTurn.promptText;
  const end = goalText.search(/[.!?]/);
  const sessionGoal = end > 0 && end < 100 ? goalText.slice(0, end + 1) : goalText.slice(0, 100);

  return {
    recentPrompts: priorTurns.map((t) => t.promptText.slice(0, 500)),
    sessionGoal,
    turnNumber: sessionTurns.length + 1, // next turn
    isConversationalMode,
  };
}, [sessionTurns]);
```

**Step 2: Wire conversationContext and notes into the fetch calls**

In both `handleImprove` (line 120) and `handleRegen` (line 170), replace the hardcoded `sessionContext` block and add the new fields. The body should become:

```typescript
body: JSON.stringify({
  promptText: promptText.trim(),
  mode: analysisMode,
  skipCache: false, // or true for handleRegen
  ...(modelId && { model: modelId }),
  sessionContext: {
    model: resolvedSession?.model ?? 'unknown',
    toolCount: 0,
    category: 'general',
    cost: 0,
  },
  conversationContext: conversationContext
    ? {
        ...conversationContext,
        // Append notes to sessionGoal if present (strip newlines to prevent prompt injection)
        sessionGoal: workshopCtx.notes
          ? `${conversationContext.sessionGoal} | User notes: ${workshopCtx.notes.replace(/[\r\n]/g, ' ').slice(0, 300)}`
          : conversationContext.sessionGoal,
      }
    : workshopCtx.notes
      ? {
          recentPrompts: [],
          sessionGoal: workshopCtx.notes.replace(/[\r\n]/g, ' ').slice(0, 500),
          turnNumber: 1,
          isConversationalMode: false,
        }
      : undefined,
}),
```

Add `resolvedSession`, `conversationContext`, and `workshopCtx.notes` to both useCallback dependency arrays.
**Important:** Use `workshopCtx.notes` (not the full `workshopCtx` object) to avoid recreating the callbacks on every keystroke. The session-related data is already tracked via `conversationContext` → `sessionTurns` → `resolvedSession` → `workshopCtx.sessionId`.

**Step 3: Verify**

Run: `cd apps/dashboard && npx tsc --noEmit`
Expected: No type errors.

**Step 4: Commit**

```bash
git add apps/dashboard/src/components/analytics/workshop/PromptWorkshop.tsx
git commit -m "feat(workshop): build conversationContext from linked session turns"
```

---

## Task 3.5: Fix conversational mode detection window alignment (all 3 locations)

The conversational mode detection has an inconsistency: it uses one window for the "2+ recent" count check and a different window for the "all short words" check. This can produce false positives when early turns are long but recent turns are short. Fix all three locations to use the same window for both checks.

**Files:**

- Modify: `apps/dashboard/src/components/analytics/prompts/PromptAnalyzer.tsx:99-110`
- Modify: `packages/server/src/services/nudgeEngine.ts:162-172`
- Modify: `packages/server/src/__tests__/nudgeEngine.test.ts` (add mixed long-then-short test)

**Step 1: Fix PromptAnalyzer.tsx**

At lines 99-110, replace:

```typescript
const priorTurns = sessionTurns.filter((t) => t.turnIndex < turnIndex).slice(-3);

// Detect conversational mode: 2+ turns within 2min AND avg words < 15
const twoMinMs = 2 * 60 * 1000;
const recentInWindow = sessionTurns.filter(
  (t) => t.turnIndex <= turnIndex && timestamp - t.timestamp < twoMinMs,
);
const isConversationalMode =
  recentInWindow.length >= 2 &&
  priorTurns.length > 0 &&
  priorTurns.every((t) => t.promptText.split(/\s+/).filter(Boolean).length < 15);
```

With:

```typescript
const priorTurns = sessionTurns.filter((t) => t.turnIndex < turnIndex).slice(-3);

// Detect conversational mode: 2+ of the last 3 turns within 2min AND all short
const twoMinMs = 2 * 60 * 1000;
const recentPrior = priorTurns.filter((t) => timestamp - t.timestamp < twoMinMs);
const isConversationalMode =
  recentPrior.length >= 2 &&
  recentPrior.every((t) => t.promptText.split(/\s+/).filter(Boolean).length < 15);
```

**Step 2: Fix nudgeEngine.ts**

At lines 162-172, replace:

```typescript
// Conversation mode: 2+ prompts in last 2min AND avg word count of recent prompts < 15
const twoMinAgo = event.timestamp - 120_000;
const recentCount = acc.promptTimestamps.filter((t) => t >= twoMinAgo).length;
if (recentCount >= 2) {
  const avgWords =
    acc.recentPromptTexts
      .map((p) => p.split(/\s+/).filter(Boolean).length)
      .reduce((a, b) => a + b, 0) / acc.recentPromptTexts.length;
  acc.conversationMode = avgWords < 15;
} else {
  acc.conversationMode = false;
}
```

With:

```typescript
// Conversation mode: 2+ of the last 3 prompts within 2min AND all short (<15 words)
const twoMinAgo = event.timestamp - 120_000;
const last3Timestamps = acc.promptTimestamps.slice(-3);
const recentOfLast3 = last3Timestamps.filter((t) => t >= twoMinAgo).length;
if (recentOfLast3 >= 2) {
  acc.conversationMode = acc.recentPromptTexts.every(
    (p) => p.split(/\s+/).filter(Boolean).length < 15,
  );
} else {
  acc.conversationMode = false;
}
```

This aligns both checks to the same window (last 3 prompts). The `recentPromptTexts` is already a sliding window of the last 3 — now the timestamp check also uses only the last 3 timestamps instead of the full 20.

**Step 3: Add mixed long-then-short test to nudgeEngine.test.ts**

After the existing `'conversationMode activates with rapid short prompts'` test, add:

```typescript
it('conversationMode stays false when early prompts are long despite recent short ones', () => {
  const sessionId = 'conv-mixed-' + Date.now();
  const now = Date.now();

  // 1 long prompt, then 2 short ones — the long one is within the last 3
  updateEventBuffer(
    makeEvent({
      sessionId,
      type: 'user_prompt',
      toolName: undefined,
      text: 'Refactor the entire authentication system with JWT tokens refresh flow middleware guards and update the database schema migrations',
      timestamp: now,
    }),
  );
  updateEventBuffer(
    makeEvent({
      sessionId,
      type: 'user_prompt',
      toolName: undefined,
      text: 'Make it blue',
      timestamp: now + 30_000,
    }),
  );
  updateEventBuffer(
    makeEvent({
      sessionId,
      type: 'user_prompt',
      toolName: undefined,
      text: 'Add padding',
      timestamp: now + 60_000,
    }),
  );

  const acc = getSessionAccumulator(sessionId);
  // Long prompt in the last-3 window means NOT conversational
  expect(acc!.conversationMode).toBe(false);
});
```

**Step 4: Run tests**

Run: `pnpm test`
Expected: All existing conversation mode tests still pass (they use uniformly short or long prompts). The new mixed test passes. Workshop context tests from Task 6 use the aligned logic.

**Step 5: Commit**

```bash
git add apps/dashboard/src/components/analytics/prompts/PromptAnalyzer.tsx packages/server/src/services/nudgeEngine.ts packages/server/src/__tests__/nudgeEngine.test.ts
git commit -m "fix(coaching): align conversational mode detection windows across all 3 locations"
```

---

## Task 4: Add the context panel UI

Add the collapsible context panel between the textarea and the Improve button. When collapsed, it shows a one-line status summary. When expanded, it shows the session picker dropdown, prior turn preview, and notes textarea.

**Files:**

- Modify: `apps/dashboard/src/components/analytics/workshop/PromptWorkshop.tsx`

**Step 1: Add a ChevronIcon helper**

Near the existing SVG icon functions (around line 88), add:

```typescript
function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      className={`w-3 h-3 transition-transform ${open ? 'rotate-90' : ''}`}
      fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
    >
      <path d="M9 5l7 7-7 7" />
    </svg>
  );
}
```

**Step 2: Add the context panel JSX**

Insert **inside** the textarea card (`<div className="bg-[#161b22] border border-gray-800 rounded-xl p-4">` at line 306), right before its closing `</div>` at line 349. This places the context panel below the Improve button row but still within the card's border. Do NOT place it outside the card (between lines 349 and 352).

```tsx
{
  /* ─── Context panel ─── */
}
<div className="mt-3 border-t border-gray-800/50 pt-2">
  {/* Collapsed status line — always visible */}
  <button
    onClick={() => setWorkshopCtx((prev) => ({ ...prev, panelOpen: !prev.panelOpen }))}
    className="flex items-center gap-1.5 w-full text-left group"
  >
    <ChevronIcon open={workshopCtx.panelOpen} />
    <span className="text-xs text-gray-500 group-hover:text-gray-300 transition-colors">
      Context
    </span>
    <span className="text-xs text-gray-600 truncate">
      {resolvedSession ? (
        <>
          · {workshopCtx.sessionId === null ? 'auto' : 'linked'} · {resolvedSession.name} (
          {sessionTurns.length} turns)
        </>
      ) : workshopCtx.notes ? (
        '· custom notes'
      ) : (
        '· none'
      )}
    </span>
  </button>

  {/* Expanded panel */}
  {workshopCtx.panelOpen && (
    <div className="mt-2 space-y-3 bg-[#0d1117]/50 border border-gray-800/50 rounded-lg p-3">
      {/* Session picker */}
      <div>
        <label className="text-[11px] font-medium text-gray-500 uppercase tracking-wider mb-1 block">
          Session
        </label>
        <select
          value={workshopCtx.sessionId ?? 'auto'}
          onChange={(e) => {
            const val = e.target.value;
            setWorkshopCtx((prev) => ({
              ...prev,
              sessionId: val === 'auto' ? null : val === 'none' ? '' : val,
            }));
          }}
          className="w-full bg-[#161b22] border border-gray-700 rounded-md px-2.5 py-1.5 text-xs text-gray-300 focus:border-blue-500/50 focus:outline-none"
        >
          <option value="auto">Auto (most recent)</option>
          <option value="none">None</option>
          {sessions.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name} — {s.promptCount} prompts · ${s.totalCost.toFixed(2)}
            </option>
          ))}
        </select>
      </div>

      {/* Prior turns preview — only if session is linked */}
      {sessionTurns.length > 0 && (
        <div>
          <span className="text-[11px] font-medium text-gray-500 uppercase tracking-wider mb-1 block">
            Recent turns ({sessionTurns.length} total)
          </span>
          <div className="space-y-1 max-h-24 overflow-y-auto">
            {sessionTurns.slice(-3).map((t, i) => (
              <div key={i} className="flex items-start gap-2 text-[11px]">
                <span className="text-gray-600 flex-shrink-0 font-mono">{t.turnIndex + 1}.</span>
                <span className="text-gray-400 truncate">{t.promptText.slice(0, 120)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Additional notes */}
      <div>
        <label className="text-[11px] font-medium text-gray-500 uppercase tracking-wider mb-1 block">
          Additional context (optional)
        </label>
        <textarea
          value={workshopCtx.notes}
          onChange={(e) => setWorkshopCtx((prev) => ({ ...prev, notes: e.target.value }))}
          placeholder="e.g. Working on the dashboard header, fixing a CSS z-index issue..."
          className="w-full h-16 max-h-32 bg-[#161b22] border border-gray-700 rounded-md px-2.5 py-1.5 text-xs text-gray-300 placeholder-gray-600 resize-y focus:border-blue-500/50 focus:outline-none"
        />
      </div>
    </div>
  )}
</div>;
```

This JSX goes right before the closing `</div>` of the textarea card (line 349), keeping it visually contained within the card's rounded border.

**Step 3: Verify visually**

Run: `cd apps/dashboard && pnpm dev`
Expected: The Workshop tab shows the textarea, below the Improve button row there's a "▸ Context · auto · Session Name (N turns)" line. Clicking it expands to show session picker, turn preview, and notes textarea.

**Step 4: Commit**

```bash
git add apps/dashboard/src/components/analytics/workshop/PromptWorkshop.tsx
git commit -m "feat(workshop): add collapsible context panel with session picker and notes"
```

---

## Task 5: Update AI coach system prompt to assume project context

The AI coach should always know that the prompt is being sent to a coding AI with full project access, even without explicit conversationContext. This prevents false "too vague" scores for standalone project-aware prompts.

**Files:**

- Modify: `packages/server/src/services/aiCoachService.ts:273-298`

**Step 1: Add a project-aware preamble to the user message**

In `aiCoachService.ts`, the `contextBlock` (line 262) is already conditionally added. Add a new `projectAwareBlock` that is _always_ included, right after the `contextBlock` definition (line 271):

```typescript
const projectAwareBlock = `
NOTE: This prompt is being sent to a coding AI that has FULL access to the user's project — the entire codebase, configuration files, CLAUDE.md instructions, and file tree. The AI can read, search, and navigate the project freely. Therefore:
- Short, context-dependent prompts ("make it darker", "fix the header", "add a test for that") are entirely normal and valid.
- The user does NOT need to explain their project, specify languages, or provide file paths unless they want to direct attention to a specific location.
- Judge prompts on clarity of INTENT, not completeness of context.`;
```

Then insert `${projectAwareBlock}` into both the vibe user message (line 276-277) and the developer user message (line 293-298), after `${contextBlock}`:

For vibe (line 273-291), the user message template already has `${contextBlock}` on line 277. Change:

```
${contextBlock}
Context: This cost ...
```

to:

```
${contextBlock}${projectAwareBlock}
Context: This cost ...
```

For developer (line 292-298), same pattern — insert `${projectAwareBlock}` after `${contextBlock}`:

```
${contextBlock}${projectAwareBlock}
Context: Model=...
```

**Step 2: Bump maxTokens from 768 to 1024**

The `projectAwareBlock` adds ~70 input tokens. With vibe mode encouraging multi-item bulleted rewrites, the existing 768-token output cap risks truncated JSON. In `aiCoachService.ts` around line 307, change:

```typescript
maxTokens: 1024,
```

**Step 3: Verify**

Run: `cd packages/server && npx tsc --noEmit`
Expected: No type errors.

**Step 4: Commit**

```bash
git add packages/server/src/services/aiCoachService.ts
git commit -m "feat(coach): always include project-aware preamble in AI prompt analysis"
```

---

## Task 6: Write tests

**Files:**

- Modify: `apps/dashboard/src/components/analytics/shared/__tests__/promptUtils.test.ts` (or create a new test file for Workshop context logic)

**Step 1: Write tests for the context-building logic**

Since the conversation context building is now inline in the component as a `useMemo`, test the core logic by extracting just the conversation detection logic into the test. The key behaviors to verify:

Create `apps/dashboard/src/components/analytics/workshop/__tests__/workshopContext.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';

// Mirror the conversational mode detection logic from PromptWorkshop (aligned windows)
function detectConversationalMode(
  turns: Array<{ timestamp: number; promptText: string }>,
): boolean {
  if (turns.length < 2) return false;
  const lastTurn = turns[turns.length - 1];
  const twoMinMs = 2 * 60 * 1000;
  const priorTurns = turns.slice(-3);
  const recentPrior = priorTurns.filter(
    (t) => lastTurn.timestamp - t.timestamp < twoMinMs,
  );
  return recentPrior.length >= 2 &&
    recentPrior.every((t) => t.promptText.split(/\s+/).filter(Boolean).length < 15);
}

function extractSessionGoal(firstPrompt: string): string {
  const end = firstPrompt.search(/[.!?]/);
  return end > 0 && end < 100 ? firstPrompt.slice(0, end + 1) : firstPrompt.slice(0, 100);
}

describe('Workshop context helpers', () => {
  describe('detectConversationalMode', () => {
    it('returns false for a single turn', () => {
      expect(detectConversationalMode([
        { timestamp: 1000, promptText: 'Add dark mode' },
      ])).toBe(false);
    });

    it('returns true for rapid short prompts within 2 minutes', () => {
      const now = Date.now();
      expect(detectConversationalMode([
        { timestamp: now - 60_000, promptText: 'Add dark mode' },
        { timestamp: now - 30_000, promptText: 'Make it darker' },
        { timestamp: now, promptText: 'Now the sidebar' },
      ])).toBe(true);
    });

    it('returns false when prompts are long', () => {
      const now = Date.now();
      const longPrompt = 'I need you to refactor the entire authentication system including the login flow the registration page and all middleware handlers';
      expect(detectConversationalMode([
        { timestamp: now - 60_000, promptText: longPrompt },
        { timestamp: now, promptText: longPrompt },
      ])).toBe(false);
    });

    it('returns false when prompts are far apart', () => {
      const now = Date.now();
      expect(detectConversationalMode([
        { timestamp: now - 300_000, promptText: 'Fix the header' },
        { timestamp: now, promptText: 'Now the footer' },
      ])).toBe(false);
    });
  });

    it('returns false for empty turns array', () => {
      expect(detectConversationalMode([])).toBe(false);
    });
  });

  describe('extractSessionGoal', () => {
    it('extracts first sentence when punctuated', () => {
      expect(extractSessionGoal('Add dark mode to the app. Then fix the sidebar.')).toBe('Add dark mode to the app.');
    });

    it('takes first 100 chars when no punctuation', () => {
      const long = 'a'.repeat(200);
      expect(extractSessionGoal(long)).toBe('a'.repeat(100));
    });

    it('handles short prompts without punctuation', () => {
      expect(extractSessionGoal('Fix it')).toBe('Fix it');
    });

    it('returns first 100 chars for empty prompt', () => {
      expect(extractSessionGoal('')).toBe('');
    });

    it('handles question mark as sentence end', () => {
      expect(extractSessionGoal('Why is the header broken? Fix it please.')).toBe('Why is the header broken?');
    });

    it('handles exclamation mark as sentence end', () => {
      expect(extractSessionGoal('Fix this now! The deploy is blocked.')).toBe('Fix this now!');
    });
  });

  describe('notes sanitization', () => {
    it('strips newlines from notes before injection', () => {
      const notes = 'line one\nline two\r\nline three';
      const sanitized = notes.replace(/[\r\n]/g, ' ');
      expect(sanitized).toBe('line one line two line three');
      expect(sanitized).not.toContain('\n');
      expect(sanitized).not.toContain('\r');
    });
  });
});
```

**Step 2: Run tests**

Run: `cd apps/dashboard && npx vitest run src/components/analytics/workshop/__tests__/workshopContext.test.ts`
Expected: All tests pass.

**Step 3: Commit**

```bash
git add apps/dashboard/src/components/analytics/workshop/__tests__/workshopContext.test.ts
git commit -m "test(workshop): add unit tests for context detection helpers"
```

---

## Task 6.5: Add favorite prompts to history

Allow users to star/favorite prompts in the history sidebar. Favorites are stored separately from the 20-item history (independent cap of 50), pinned to the top of the list, and preserve the full analysis result for instant recall.

**Files:**

- Modify: `apps/dashboard/src/components/analytics/workshop/PromptWorkshop.tsx`

**Step 1: Add favorites localStorage persistence**

After the existing `WORKSHOP_CONTEXT_KEY` block, add:

```typescript
const WORKSHOP_FAVORITES_KEY = 'synapse-workshop-favorites';
const MAX_FAVORITES = 50;

function loadFavorites(): WorkshopResult[] {
  try {
    const raw = localStorage.getItem(WORKSHOP_FAVORITES_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveFavorites(favorites: WorkshopResult[]): void {
  try {
    localStorage.setItem(WORKSHOP_FAVORITES_KEY, JSON.stringify(favorites));
  } catch {
    /* quota exceeded */
  }
}
```

**Step 2: Add favorites state to the component**

After the existing `workshopCtx` state, add:

```typescript
const [favorites, setFavorites] = useState<WorkshopResult[]>(loadFavorites);
```

And a persistence effect:

```typescript
useEffect(() => {
  saveFavorites(favorites);
}, [favorites]);
```

**Step 3: Add toggle handler**

After the existing `handleClearHistory` callback, add:

```typescript
const favoriteIds = useMemo(() => new Set(favorites.map((f) => f.id)), [favorites]);

const handleToggleFavorite = useCallback((item: WorkshopResult) => {
  setFavorites((prev) => {
    if (prev.some((f) => f.id === item.id)) {
      return prev.filter((f) => f.id !== item.id);
    }
    return [item, ...prev].slice(0, MAX_FAVORITES);
  });
}, []);
```

**Step 4: Add StarIcon SVG**

Near the other icon functions, add:

```typescript
function StarIcon({ filled }: { filled: boolean }) {
  return (
    <svg className="w-3 h-3" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
      fill={filled ? 'currentColor' : 'none'}
    >
      <path d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
    </svg>
  );
}
```

**Step 5: Update the history sidebar to show favorites pinned at top with star toggle**

Replace the history sidebar section (the `{showHistory && (` block). The key changes:

1. Show favorites first (pinned section), then history (excluding favorited items)
2. Each item gets a star icon on hover, always visible if favorited
3. Favorites section has its own "Favorites" header

In the existing history sidebar `{history.map((item) => (` block, replace the entire map with:

```tsx
{
  /* Favorites section */
}
{
  favorites.length > 0 && (
    <>
      <div className="text-[10px] font-medium text-amber-400/70 uppercase tracking-wider mb-1">
        Favorites ({favorites.length})
      </div>
      {favorites.map((item) => (
        <div key={`fav-${item.id}`} className="relative group">
          <button
            onClick={() => handleRestoreHistory(item)}
            className={`w-full text-left p-2 rounded-lg transition-colors ${
              currentResult?.id === item.id
                ? 'bg-blue-500/10 border border-blue-500/20'
                : 'hover:bg-[#0d1117]/50 border border-transparent'
            }`}
          >
            <div className="text-xs text-gray-300 truncate pr-5">{item.promptText}</div>
            <div className="flex items-center gap-2 mt-1">
              <span className={`text-[10px] font-medium ${scoreColor(item.score)}`}>
                {item.score}/10
              </span>
              <span className="text-[10px] text-gray-600">
                {item.mode === 'vibe' ? 'Vibe' : 'Dev'}
              </span>
              <span className="text-[10px] text-gray-600 ml-auto">
                {formatTimestamp(item.timestamp)}
              </span>
            </div>
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              handleToggleFavorite(item);
            }}
            className="absolute top-2 right-2 text-amber-400 hover:text-amber-300 transition-colors"
            title="Remove from favorites"
          >
            <StarIcon filled />
          </button>
        </div>
      ))}
      {history.filter((h) => !favoriteIds.has(h.id)).length > 0 && (
        <div className="border-t border-gray-800/50 my-2" />
      )}
    </>
  );
}

{
  /* Regular history (excluding favorites) */
}
{
  history
    .filter((h) => !favoriteIds.has(h.id))
    .map((item) => (
      <div key={item.id} className="relative group">
        <button
          onClick={() => handleRestoreHistory(item)}
          className={`w-full text-left p-2 rounded-lg transition-colors ${
            currentResult?.id === item.id
              ? 'bg-blue-500/10 border border-blue-500/20'
              : 'hover:bg-[#0d1117]/50 border border-transparent'
          }`}
        >
          <div className="text-xs text-gray-300 truncate pr-5">{item.promptText}</div>
          <div className="flex items-center gap-2 mt-1">
            <span className={`text-[10px] font-medium ${scoreColor(item.score)}`}>
              {item.score}/10
            </span>
            <span className="text-[10px] text-gray-600">
              {item.mode === 'vibe' ? 'Vibe' : 'Dev'}
            </span>
            <span className="text-[10px] text-gray-600 ml-auto">
              {formatTimestamp(item.timestamp)}
            </span>
          </div>
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            handleToggleFavorite(item);
          }}
          className="absolute top-2 right-2 text-gray-600 opacity-0 group-hover:opacity-100 hover:text-amber-400 transition-all"
          title="Add to favorites"
        >
          <StarIcon filled={false} />
        </button>
      </div>
    ));
}
```

**Step 6: Update the history header to show combined count**

Change the History button label from `History ({history.length})` to:

```tsx
History ({favorites.length + history.filter((h) => !favoriteIds.has(h.id)).length})
```

**Step 7: Verify**

Run: `cd apps/dashboard && npx tsc --noEmit`
Expected: No type errors.

**Step 8: Commit**

```bash
git add apps/dashboard/src/components/analytics/workshop/PromptWorkshop.tsx
git commit -m "feat(workshop): add favorite prompts with star toggle, pinned to top of history"
```

---

## Task 7: Visual verification and edge cases

**Step 1: Test with no sessions**

Start the dashboard with no session data (or clear events). The context line should show "▸ Context · none". The expanded panel should show "Auto (most recent)" selected but no turns preview.

**Step 2: Test with active sessions**

Run a simulation: `npx tsx scripts/simulate_session.ts`
Refresh the Workshop tab. The context line should show the session name and turn count. Expanding should show the session in the dropdown and the last 3 turns.

**Step 3: Test prompt analysis with context**

1. Link a session (auto or explicit)
2. Type a short prompt like "make it darker"
3. Click Improve
4. Verify the AI coach gives a reasonable score (7+) instead of penalizing for vagueness
5. Compare with the same prompt after selecting "None" for session — score should be lower or explanation should note the lack of context

**Step 4: Test notes-only mode**

1. Set session to "None"
2. Add notes: "Working on dashboard header component CSS"
3. Type "fix the z-index issue"
4. Click Improve
5. Verify the AI coach incorporates the notes into its analysis

**Step 5: Test persistence**

1. Set a session, add notes, close the panel
2. Navigate to another tab, come back to Workshop
3. Verify settings are preserved (session, notes, panel open/closed state)

**Step 6: Test favorites**

1. Analyze a few prompts to build up history
2. Open the History sidebar
3. Hover over a history item — star icon should appear
4. Click the star — item should move to the "Favorites" section at the top with a filled star
5. Click the filled star on a favorite — it should unfavorite and drop back to regular history
6. Close the sidebar, navigate away, come back — favorites should persist
7. Verify favorites don't count toward the 20-item history limit (add 20+ items, favorites stay)

**Step 7: Commit if any fixes were needed**

```bash
git add -u
git commit -m "fix(workshop): address edge cases in context panel"
```

---

## Task 8: Build and deploy VS Code extension

**Files:**

- Modify: `apps/vscode/resources/synapse-server/dashboard/` (rebuilt assets)

**Step 1: Build dashboard**

Run: `cd apps/dashboard && pnpm build`
Expected: Build succeeds with no errors.

**Step 2: Copy dashboard assets to VS Code extension**

The extension bundles the dashboard. Copy the built assets from `apps/dashboard/dist/` to `apps/vscode/resources/synapse-server/dashboard/`.

**Step 3: Build and package VS Code extension**

Run: `cd apps/vscode && pnpm run package`
Expected: `.vsix` file created.

**Step 4: Deploy**

Copy `.vsix` to `\\192.168.1.214\Incoming`.

**Step 5: Commit**

```bash
git add apps/vscode/resources/synapse-server/dashboard/
git commit -m "build: rebuild dashboard and VS Code extension with workshop context"
```

---

## Summary of changes

| File                      | Change                                                                                                                                                                                            |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PromptWorkshop.tsx`      | Add props for sessions/turns, context state + persistence, per-session turn fetch, context panel UI, wire `conversationContext` into fetch calls with sanitized notes, favorites with star toggle |
| `AnalyticsPage.tsx`       | Pass `mockData.sessions` and `mockData.turns` to PromptWorkshop                                                                                                                                   |
| `PromptAnalyzer.tsx`      | Fix conversational mode detection — align count and word-length to same window                                                                                                                    |
| `nudgeEngine.ts`          | Fix conversational mode detection — use last 3 timestamps instead of all 20                                                                                                                       |
| `nudgeEngine.test.ts`     | Add mixed long-then-short test case for conversational mode                                                                                                                                       |
| `aiCoachService.ts`       | Add project-aware preamble to AI system prompt (always included), bump `maxTokens` 768→1024                                                                                                       |
| `workshopContext.test.ts` | New test file for context detection helpers, session goal extraction, notes sanitization                                                                                                          |

**Backend changes:** 0 new routes, 0 schema changes. The existing `/api/analytics/turns?sessionId=X` endpoint is reused for per-session fetches. The `aiCoachService` gets a prompt tweak + token limit bump. The nudge engine gets a bugfix to conversational mode detection.
