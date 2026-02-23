# Guided Tour & Demo Mode — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a fully self-contained guided tour system that walks new users through every feature of Synapse, with an auto-play demo phase that populates the graph + a manual spotlight walkthrough — removable by deleting one directory and two comment-tagged lines.

**Architecture:** A `features/tour/` module (mirroring the `features/notifications/` pattern) with its own Zustand store, a CSS-based spotlight overlay (no library — `box-shadow: 0 0 0 9999px` technique), and an embedded event replayer that feeds simulated events directly into `agentStore.addEvent()`. The tour reads store state via `useAgentStore.subscribe()` but never modifies core store shape.

**Tech Stack:** React 19, Zustand 5, Tailwind CSS 4, vanilla DOM positioning (no Driver.js — our prototype proved the spotlight+card pattern is simple enough to own). Zero new dependencies.

---

## Architecture Overview

### Isolation Strategy

Every touchpoint in core code is tagged `// [tour]` for grep-ability. Total core file modifications: **3 lines across 2 files**.

```
Core files touched:
  App.tsx        +1 line: import + initTour()        // [tour]
  i18n/en.ts     +1 block: tour.* string keys        // [tour]

Everything else lives in:
  apps/dashboard/src/features/tour/
  ├── index.ts               ← public API: initTour(), useTourStore, TourOverlay
  ├── constants.ts            ← TOUR_ENABLED flag, step definitions, localStorage keys
  ├── tourStore.ts            ← Zustand store: step state, phase, tour progress
  ├── steps/                  ← Step definition arrays by chapter
  │   ├── autoPlaySteps.ts    ← Phase 0: event sequence + narration callouts
  │   ├── graphSteps.ts       ← Chapter 1: graph nodes/edges
  │   ├── lensSteps.ts        ← Chapter 2: lens panel tabs
  │   ├── panelSteps.ts       ← Chapter 3: detail panels
  │   ├── headerSteps.ts      ← Chapter 4: header controls
  │   ├── settingsSteps.ts    ← Chapter 5: settings & tools
  │   ├── analyticsSteps.ts   ← Chapter 6: analytics (optional)
  │   └── pixelSteps.ts       ← Chapter 7: pixel mode (optional)
  ├── demoEvents.ts           ← Embedded event payloads (from simulate_all_nodes)
  ├── TourOverlay.tsx          ← Spotlight dimmer + floating card + progress
  ├── TourLauncher.tsx         ← "Start Tour" button + first-run detection
  └── __tests__/
      ├── tourStore.test.ts
      └── TourOverlay.test.ts
```

### How Removal Works

```bash
# Remove the feature entirely:
rm -rf apps/dashboard/src/features/tour/

# Then grep for the 2 remaining lines:
grep -rn "// \[tour\]" apps/dashboard/src/
# → App.tsx:XX    — delete import + initTour() line
# → i18n/en.ts:XX — delete tour.* key block
```

Zero runtime impact on Synapse when removed. No store shape changes, no new props on existing components, no new CSS classes in shared stylesheets.

### Spotlight Technique

Instead of pulling in Driver.js (~5KB), we use the battle-tested `box-shadow` curtain:

```css
.tour-spotlight {
  position: fixed;
  z-index: 9998;
  border-radius: 12px;
  box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.75);
  border: 2px solid rgba(139, 92, 246, 0.5);
  transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
  pointer-events: none;
}
```

This works perfectly on dark backgrounds (unlike `mix-blend-mode: hard-light`) and requires zero canvas or SVG rendering.

### Auto-Play Phase

Phase 0 doesn't use the server. Instead, `demoEvents.ts` contains the same 31 event payloads from `simulate_all_nodes.ts` as a static array. The tour replayer calls `useAgentStore.getState().addEvent(event)` directly — the graph animates in exactly as if live events were arriving, but with narration callouts appearing at each milestone.

---

## Task Breakdown

### Task 1: Tour Store & Constants

**Files:**

- Create: `apps/dashboard/src/features/tour/constants.ts`
- Create: `apps/dashboard/src/features/tour/tourStore.ts`
- Test: `apps/dashboard/src/features/tour/__tests__/tourStore.test.ts`

**Step 1: Write the tour store test**

```ts
// __tests__/tourStore.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { useTourStore } from '../tourStore';

describe('tourStore', () => {
  beforeEach(() => {
    useTourStore.setState(useTourStore.getInitialState());
    localStorage.clear();
  });

  it('starts inactive', () => {
    expect(useTourStore.getState().active).toBe(false);
    expect(useTourStore.getState().phase).toBe('idle');
  });

  it('startTour transitions to autoPlay phase', () => {
    useTourStore.getState().startTour();
    expect(useTourStore.getState().active).toBe(true);
    expect(useTourStore.getState().phase).toBe('autoPlay');
    expect(useTourStore.getState().chapterIndex).toBe(0);
    expect(useTourStore.getState().stepIndex).toBe(0);
  });

  it('nextStep advances within a chapter', () => {
    useTourStore.getState().startTour();
    useTourStore.getState().transitionToManual(); // skip auto-play
    useTourStore.getState().nextStep();
    expect(useTourStore.getState().stepIndex).toBe(1);
  });

  it('prevStep does not go below 0', () => {
    useTourStore.getState().startTour();
    useTourStore.getState().transitionToManual();
    useTourStore.getState().prevStep();
    expect(useTourStore.getState().stepIndex).toBe(0);
  });

  it('endTour resets state and marks completed in localStorage', () => {
    useTourStore.getState().startTour();
    useTourStore.getState().endTour();
    expect(useTourStore.getState().active).toBe(false);
    expect(useTourStore.getState().phase).toBe('idle');
    expect(localStorage.getItem('synapse-tour-completed')).toBe('1');
  });

  it('nextStep advances to next chapter when at end of current', () => {
    useTourStore.getState().startTour();
    useTourStore.getState().transitionToManual();
    const chapterLen = useTourStore.getState().currentChapterLength();
    for (let i = 0; i < chapterLen; i++) {
      useTourStore.getState().nextStep();
    }
    expect(useTourStore.getState().chapterIndex).toBe(1);
    expect(useTourStore.getState().stepIndex).toBe(0);
  });

  it('hasCompleted reads localStorage', () => {
    expect(useTourStore.getState().hasCompleted()).toBe(false);
    localStorage.setItem('synapse-tour-completed', '1');
    expect(useTourStore.getState().hasCompleted()).toBe(true);
  });
});
```

**Step 2: Run test — confirm it fails**

Run: `pnpm vitest run apps/dashboard/src/features/tour/__tests__/tourStore.test.ts`
Expected: FAIL — module not found

**Step 3: Write constants.ts**

```ts
// constants.ts
export const TOUR_ENABLED = true;
export const LS_KEY_COMPLETED = 'synapse-tour-completed';
export const LS_KEY_PROGRESS = 'synapse-tour-progress';

export type TourPhase = 'idle' | 'autoPlay' | 'manual' | 'finished';

export interface TourStep {
  /** CSS selector or element ID to spotlight (without #) */
  target: string;
  /** i18n key for step title */
  titleKey: string;
  /** i18n key for step body */
  bodyKey: string;
  /** Preferred tooltip placement relative to target */
  placement: 'top' | 'right' | 'bottom' | 'left';
  /** Optional: action to perform when this step activates (e.g., switch lens tab) */
  onEnter?: () => void;
  /** Optional: wait for this condition before allowing Next (returns unsub) */
  waitFor?: () => (() => void) | undefined;
}

export interface TourChapter {
  id: string;
  titleKey: string;
  steps: TourStep[];
}

/** Chapter IDs for optional continuation prompt */
export const OPTIONAL_CHAPTERS = ['analytics', 'pixel'];
```

**Step 4: Write tourStore.ts**

```ts
// tourStore.ts
import { create } from 'zustand';
import { LS_KEY_COMPLETED, type TourPhase } from './constants';
import { ALL_CHAPTERS } from './steps'; // will be created in Task 3

interface TourState {
  active: boolean;
  phase: TourPhase;
  chapterIndex: number;
  stepIndex: number;
  /** Index into auto-play event sequence */
  autoPlayIndex: number;

  startTour: () => void;
  endTour: () => void;
  transitionToManual: () => void;
  nextStep: () => void;
  prevStep: () => void;
  goToChapter: (chapterIndex: number) => void;
  advanceAutoPlay: () => void;
  currentChapterLength: () => number;
  totalSteps: () => number;
  globalStepIndex: () => number;
  hasCompleted: () => boolean;
}

export const useTourStore = create<TourState>()((set, get) => ({
  active: false,
  phase: 'idle' as TourPhase,
  chapterIndex: 0,
  stepIndex: 0,
  autoPlayIndex: 0,

  startTour: () =>
    set({ active: true, phase: 'autoPlay', chapterIndex: 0, stepIndex: 0, autoPlayIndex: 0 }),

  endTour: () => {
    localStorage.setItem(LS_KEY_COMPLETED, '1');
    set({ active: false, phase: 'idle', chapterIndex: 0, stepIndex: 0, autoPlayIndex: 0 });
  },

  transitionToManual: () => set({ phase: 'manual', chapterIndex: 0, stepIndex: 0 }),

  nextStep: () => {
    const { chapterIndex, stepIndex } = get();
    const chapterLen = get().currentChapterLength();
    if (stepIndex < chapterLen - 1) {
      set({ stepIndex: stepIndex + 1 });
    } else if (chapterIndex < ALL_CHAPTERS.length - 1) {
      set({ chapterIndex: chapterIndex + 1, stepIndex: 0 });
    } else {
      get().endTour();
    }
  },

  prevStep: () => {
    const { chapterIndex, stepIndex } = get();
    if (stepIndex > 0) {
      set({ stepIndex: stepIndex - 1 });
    } else if (chapterIndex > 0) {
      const prevLen = ALL_CHAPTERS[chapterIndex - 1].steps.length;
      set({ chapterIndex: chapterIndex - 1, stepIndex: prevLen - 1 });
    }
  },

  goToChapter: (idx: number) => set({ chapterIndex: idx, stepIndex: 0 }),

  advanceAutoPlay: () => set((s) => ({ autoPlayIndex: s.autoPlayIndex + 1 })),

  currentChapterLength: () => ALL_CHAPTERS[get().chapterIndex]?.steps.length ?? 0,

  totalSteps: () => ALL_CHAPTERS.reduce((sum, ch) => sum + ch.steps.length, 0),

  globalStepIndex: () => {
    const { chapterIndex, stepIndex } = get();
    let total = 0;
    for (let i = 0; i < chapterIndex; i++) total += ALL_CHAPTERS[i].steps.length;
    return total + stepIndex;
  },

  hasCompleted: () => localStorage.getItem(LS_KEY_COMPLETED) === '1',
}));
```

**Step 5: Run test — confirm it passes**

Run: `pnpm vitest run apps/dashboard/src/features/tour/__tests__/tourStore.test.ts`
Expected: PASS (all 7 tests)

**Step 6: Commit**

```bash
git add apps/dashboard/src/features/tour/constants.ts apps/dashboard/src/features/tour/tourStore.ts apps/dashboard/src/features/tour/__tests__/tourStore.test.ts
git commit -m "feat(tour): add tour store and constants"
```

---

### Task 2: Demo Event Payloads

**Files:**

- Create: `apps/dashboard/src/features/tour/demoEvents.ts`

**Step 1: Write demoEvents.ts**

Port the 31 event payloads from `scripts/simulate_all_nodes.ts` into a static array. Each entry includes the payload, a delay (ms), and a narration callout key for the auto-play phase.

```ts
// demoEvents.ts
// Static event sequence for auto-play demo — ported from scripts/simulate_all_nodes.ts
// Uses fixed IDs (not timestamp-based) so the tour is deterministic.

export interface DemoEvent {
  payload: Record<string, unknown>;
  delayMs: number;
  /** i18n key for narration callout shown during auto-play (null = silent) */
  narrationKey: string | null;
}

const SESSION_ID = 'tour-demo-session';
const EXPLORE_AGENT = 'tour-agent-explore';
const PLAN_AGENT = 'tour-agent-plan';
const TASK_AGENT = 'tour-agent-task';
const CWD = '/workspace/my-project';

export const DEMO_EVENTS: DemoEvent[] = [
  // Phase 1 — Session start
  {
    delayMs: 0,
    narrationKey: 'tour.auto.sessionStart',
    payload: {
      hook_event_name: 'SessionStart',
      session_id: SESSION_ID,
      cwd: CWD,
      permission_mode: 'default',
      source: 'startup',
      model: 'claude-opus-4-6',
      git_branch: 'feat/health-check',
      transcript_path: `~/.claude/projects/sim/${SESSION_ID}.jsonl`,
    },
  },
  // Phase 2 — Prompt 1
  {
    delayMs: 800,
    narrationKey: 'tour.auto.prompt1',
    payload: {
      hook_event_name: 'UserPromptSubmit',
      session_id: SESSION_ID,
      cwd: CWD,
      permission_mode: 'default',
      prompt: 'Add a health check endpoint to the server',
    },
  },
  // ... (all 31 events follow this pattern — full payloads copied from simulate_all_nodes.ts)
  // The implementation will include every event with appropriate delayMs and narrationKeys.
  // Events without narration (like intermediate Pre/PostToolUse pairs) use narrationKey: null.
];
```

The actual file will contain all 31 events. I'm abbreviating here — the implementation will copy every payload verbatim from the simulation script, with delays tuned for the tour pace (~600-1000ms between narrated beats, ~200ms between silent intermediate events).

**Step 2: Commit**

```bash
git add apps/dashboard/src/features/tour/demoEvents.ts
git commit -m "feat(tour): add static demo event payloads"
```

---

### Task 3: Step Definitions (All 7 Chapters)

**Files:**

- Create: `apps/dashboard/src/features/tour/steps/index.ts`
- Create: `apps/dashboard/src/features/tour/steps/graphSteps.ts`
- Create: `apps/dashboard/src/features/tour/steps/lensSteps.ts`
- Create: `apps/dashboard/src/features/tour/steps/panelSteps.ts`
- Create: `apps/dashboard/src/features/tour/steps/headerSteps.ts`
- Create: `apps/dashboard/src/features/tour/steps/settingsSteps.ts`
- Create: `apps/dashboard/src/features/tour/steps/analyticsSteps.ts`
- Create: `apps/dashboard/src/features/tour/steps/pixelSteps.ts`

**Step 1: Write step definitions**

Each file exports a `TourChapter`. Example for `graphSteps.ts`:

```ts
// steps/graphSteps.ts
import type { TourChapter } from '../constants';

export const graphChapter: TourChapter = {
  id: 'graph',
  titleKey: 'tour.chapter.graph',
  steps: [
    {
      target: '[data-nodeid^="session-"]', // CSS selector for first session node
      titleKey: 'tour.graph.session.title',
      bodyKey: 'tour.graph.session.body',
      placement: 'right',
    },
    {
      target: '[data-nodeid^="prompt-"]',
      titleKey: 'tour.graph.prompt.title',
      bodyKey: 'tour.graph.prompt.body',
      placement: 'right',
    },
    {
      target: '[data-nodeid^="agent-"]',
      titleKey: 'tour.graph.agent.title',
      bodyKey: 'tour.graph.agent.body',
      placement: 'left',
    },
    {
      target: '[data-nodeid^="toolgroup-"]',
      titleKey: 'tour.graph.toolGroupCollapsed.title',
      bodyKey: 'tour.graph.toolGroupCollapsed.body',
      placement: 'right',
    },
    {
      target: '[data-nodeid^="toolgroup-"]',
      titleKey: 'tour.graph.toolGroupExpanded.title',
      bodyKey: 'tour.graph.toolGroupExpanded.body',
      placement: 'right',
      onEnter: () => {
        // Toggle showAllTools ON so user sees the expanded pill grid
        const { useAgentStore } = require('../../../store/agentStore');
        useAgentStore.getState().setShowAllTools(true);
      },
    },
    // ... remaining steps per the beat list
  ],
};
```

`index.ts` aggregates all chapters:

```ts
// steps/index.ts
import { graphChapter } from './graphSteps';
import { lensChapter } from './lensSteps';
import { panelChapter } from './panelSteps';
import { headerChapter } from './headerSteps';
import { settingsChapter } from './settingsSteps';
import { analyticsChapter } from './analyticsSteps';
import { pixelChapter } from './pixelSteps';
import type { TourChapter } from '../constants';

export const ALL_CHAPTERS: TourChapter[] = [
  graphChapter,
  lensChapter,
  panelChapter,
  headerChapter,
  settingsChapter,
  analyticsChapter,
  pixelChapter,
];
```

Each step file follows the same structure. Steps use CSS selectors to find their targets — React Flow nodes expose `data-nodeid` attributes, and all our custom UI elements have unique IDs or class names already.

**Step 2: Run store tests again (they depend on ALL_CHAPTERS)**

Run: `pnpm vitest run apps/dashboard/src/features/tour/__tests__/tourStore.test.ts`
Expected: PASS

**Step 3: Commit**

```bash
git add apps/dashboard/src/features/tour/steps/
git commit -m "feat(tour): add step definitions for all 7 chapters"
```

---

### Task 4: i18n Strings

**Files:**

- Modify: `apps/dashboard/src/i18n/en.ts` (add `tour.*` keys)

**Step 1: Add tour strings to en.ts**

Add a clearly delimited block at the end of the file:

```ts
// ── Tour strings ── [tour]
'tour.launcher.title': 'Take a Tour',
'tour.launcher.body': 'See how Synapse monitors your Claude agents in real-time',
'tour.launcher.start': 'Start Tour',
'tour.launcher.dismiss': 'Maybe later',
'tour.skip': 'Skip tour',
'tour.next': 'Next',
'tour.prev': 'Back',
'tour.finish': 'Finish',
'tour.chapter.graph': 'The Graph',
'tour.chapter.lens': 'Lens Panel',
'tour.chapter.panels': 'Detail Panels',
'tour.chapter.header': 'Header Controls',
'tour.chapter.settings': 'Settings & Tools',
'tour.chapter.analytics': 'Analytics',
'tour.chapter.pixel': 'Pixel Mode',

// Auto-play narrations
'tour.auto.sessionStart': 'A Claude Code session just started — every session gets its own root node.',
'tour.auto.prompt1': 'You typed a prompt — it becomes a node connected to the session.',
'tour.auto.tools1': 'The agent reads, edits, and runs bash — tool calls appear as grouped pills.',
'tour.auto.explore': 'Claude spawned an Explore subagent — a new purple node with its own tools.',
'tour.auto.prompt2': 'Another prompt, another branch. The graph grows as the conversation continues.',
'tour.auto.error': 'A tool failed — the red status dot tells you instantly.',
'tour.auto.taskChild': 'The Task tool spawned a child agent — notice the purple edge with a token cost badge.',
'tour.auto.compaction': 'Context was compacted — the scissors icon marks where Claude trimmed its memory.',
'tour.auto.complete': 'That\'s a complete session. Ready to explore?',

// Chapter 1: Graph
'tour.graph.session.title': 'Session Node',
'tour.graph.session.body': 'The root of every session. Shows the session ID, git branch, cost estimate, a token sparkline, and agent/tool counts.',
'tour.graph.prompt.title': 'User Prompt',
'tour.graph.prompt.body': 'Each prompt you type becomes a node. It shows the text preview, token stats, and a compaction indicator if context was trimmed.',
'tour.graph.agent.title': 'Agent Node',
'tour.graph.agent.body': 'Subagents like Explore and Plan appear as purple nodes. They show status, streaming text, token counts, and a progress bar while running.',
'tour.graph.toolGroupCollapsed.title': 'Tool Group (Collapsed)',
'tour.graph.toolGroupCollapsed.body': 'Leaf tools are grouped into a compact chip showing count, total duration, and status dots.',
'tour.graph.toolGroupExpanded.title': 'Tool Group (Expanded)',
'tour.graph.toolGroupExpanded.body': 'Press F to expand — each tool becomes a clickable pill with name, duration, and status. Three view modes: Pill Grid, Timeline, Heatmap.',
'tour.graph.structuralTool.title': 'Structural Tool',
'tour.graph.structuralTool.body': 'Tools that spawn child agents (like Task) stay as individual nodes with their own connection handle.',
'tour.graph.edges.title': 'Edges',
'tour.graph.edges.body': 'Gray dashed = data flow. Purple solid = task → child agent. Blue animated = currently active.',
'tour.graph.costBadge.title': 'Cost Badge',
'tour.graph.costBadge.body': 'Purple pill on task edges showing the token transfer between parent and child agent.',
'tour.graph.collapse.title': 'Collapse Handle',
'tour.graph.collapse.body': 'Click the amber dot to collapse or expand a node\'s children. The badge shows how many nodes are hidden.',
'tour.graph.spawn.title': 'Spawn Agent',
'tour.graph.spawn.body': 'Click this or press N to spawn a new agent via the Agent SDK. Choose model, tools, and permissions.',

// Chapter 2: Lens (abbreviated — full set in implementation)
'tour.lens.overview.title': 'Lens Panel',
'tour.lens.overview.body': 'Seven analysis tabs on the left. Press 1–7 to switch. Drag the edge to resize.',
// ... all lens step strings

// Chapter 3–7 follow the same pattern
// Full strings for all 52 manual steps will be included in implementation
```

**Step 2: Commit**

```bash
git add apps/dashboard/src/i18n/en.ts
git commit -m "feat(tour): add i18n strings for all tour steps"
```

---

### Task 5: TourOverlay Component

**Files:**

- Create: `apps/dashboard/src/features/tour/TourOverlay.tsx`
- Test: `apps/dashboard/src/features/tour/__tests__/TourOverlay.test.ts`

**Step 1: Write the TourOverlay test**

```ts
// __tests__/TourOverlay.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TourOverlay } from '../TourOverlay';
import { useTourStore } from '../tourStore';

// Mock getBoundingClientRect for target elements
function mockTarget(id: string, rect: Partial<DOMRect>) {
  const el = document.createElement('div');
  el.setAttribute('data-tourid', id);
  el.getBoundingClientRect = () => ({
    x: 0, y: 0, width: 200, height: 50, top: 100, right: 300, bottom: 150, left: 100,
    toJSON: () => ({}),
    ...rect,
  });
  document.body.appendChild(el);
  return el;
}

describe('TourOverlay', () => {
  beforeEach(() => {
    useTourStore.setState(useTourStore.getInitialState());
    document.body.innerHTML = '';
  });

  it('renders nothing when tour is inactive', () => {
    const { container } = render(<TourOverlay />);
    expect(container.firstChild).toBeNull();
  });

  it('renders spotlight and card when tour is active in manual phase', () => {
    useTourStore.getState().startTour();
    useTourStore.getState().transitionToManual();
    mockTarget('[data-nodeid^="session-"]', { top: 100, left: 100, width: 200, height: 50 });

    render(<TourOverlay />);
    expect(screen.getByText('Next')).toBeTruthy();
    expect(screen.getByText('Skip tour')).toBeTruthy();
  });

  it('advances step on Next click', () => {
    useTourStore.getState().startTour();
    useTourStore.getState().transitionToManual();
    mockTarget('[data-nodeid^="session-"]', { top: 100, left: 100, width: 200, height: 50 });

    render(<TourOverlay />);
    fireEvent.click(screen.getByText('Next'));
    expect(useTourStore.getState().stepIndex).toBe(1);
  });

  it('ends tour on Skip click', () => {
    useTourStore.getState().startTour();
    useTourStore.getState().transitionToManual();
    render(<TourOverlay />);
    fireEvent.click(screen.getByText('Skip tour'));
    expect(useTourStore.getState().active).toBe(false);
  });

  it('supports keyboard navigation (ArrowRight = next, Escape = end)', () => {
    useTourStore.getState().startTour();
    useTourStore.getState().transitionToManual();
    render(<TourOverlay />);

    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(useTourStore.getState().stepIndex).toBe(1);

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(useTourStore.getState().active).toBe(false);
  });
});
```

**Step 2: Run test — confirm fails**

Run: `pnpm vitest run apps/dashboard/src/features/tour/__tests__/TourOverlay.test.ts`
Expected: FAIL — module not found

**Step 3: Implement TourOverlay.tsx**

```tsx
// TourOverlay.tsx
import { useEffect, useState, useCallback, useRef } from 'react';
import { useTourStore } from './tourStore';
import { ALL_CHAPTERS, OPTIONAL_CHAPTERS } from './steps';
import { t } from '../../i18n';

interface Rect { top: number; left: number; width: number; height: number; }

const PAD = 10;

function getTargetRect(selector: string): Rect | null {
  const el = document.querySelector(selector);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { top: r.top, left: r.left, width: r.width, height: r.height };
}

function useTargetRect(selector: string): Rect | null {
  const [rect, setRect] = useState<Rect | null>(null);
  useEffect(() => {
    const update = () => setRect(getTargetRect(selector));
    update();
    // Poll briefly in case the element is still rendering
    const interval = setInterval(update, 200);
    const timeout = setTimeout(() => clearInterval(interval), 3000);
    window.addEventListener('resize', update);
    return () => {
      clearInterval(interval);
      clearTimeout(timeout);
      window.removeEventListener('resize', update);
    };
  }, [selector]);
  return rect;
}

export function TourOverlay() {
  const { active, phase, chapterIndex, stepIndex, nextStep, prevStep, endTour, globalStepIndex, totalSteps } = useTourStore();

  // Auto-play phase: render narration callout only
  if (active && phase === 'autoPlay') {
    return <AutoPlayOverlay />;
  }

  // Manual phase: spotlight + card
  if (!active || phase !== 'manual') return null;

  const chapter = ALL_CHAPTERS[chapterIndex];
  if (!chapter) return null;
  const step = chapter.steps[stepIndex];
  if (!step) return null;

  return (
    <ManualOverlay
      step={step}
      chapterTitle={t(chapter.titleKey)}
      stepTitle={t(step.titleKey)}
      stepBody={t(step.bodyKey)}
      globalIndex={globalStepIndex()}
      totalSteps={totalSteps()}
      onNext={nextStep}
      onPrev={prevStep}
      onSkip={endTour}
      isFirst={chapterIndex === 0 && stepIndex === 0}
      isLast={chapterIndex === ALL_CHAPTERS.length - 1 && stepIndex === chapter.steps.length - 1}
    />
  );
}

function ManualOverlay({ step, chapterTitle, stepTitle, stepBody, globalIndex, totalSteps, onNext, onPrev, onSkip, isFirst, isLast }) {
  const rect = useTargetRect(step.target);

  // Keyboard navigation
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === ' ') { e.preventDefault(); onNext(); }
      if (e.key === 'ArrowLeft') { e.preventDefault(); onPrev(); }
      if (e.key === 'Escape') { onSkip(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onNext, onPrev, onSkip]);

  // Fire onEnter when step changes
  const onEnterRef = useRef(step.onEnter);
  onEnterRef.current = step.onEnter;
  useEffect(() => { onEnterRef.current?.(); }, [globalIndex]);

  // Spotlight position
  const sx = rect ? rect.left - PAD : -9999;
  const sy = rect ? rect.top - PAD : -9999;
  const sw = rect ? rect.width + PAD * 2 : 0;
  const sh = rect ? rect.height + PAD * 2 : 0;

  // Card position
  const cardStyle = computeCardPosition(rect, step.placement);

  return (
    <div className="fixed inset-0 z-[9998]" aria-modal="true" role="dialog">
      {/* Dimmer with clip-path cutout */}
      <div
        className="absolute inset-0 bg-black/75 transition-[clip-path] duration-400"
        style={{
          clipPath: rect
            ? `polygon(0% 0%, 100% 0%, 100% 100%, 0% 100%, 0% 0%, ${sx}px ${sy}px, ${sx}px ${sy + sh}px, ${sx + sw}px ${sy + sh}px, ${sx + sw}px ${sy}px, ${sx}px ${sy}px)`
            : undefined,
        }}
      />

      {/* Spotlight ring */}
      {rect && (
        <div
          className="absolute border-2 border-violet-500/50 rounded-xl pointer-events-none transition-all duration-400"
          style={{ top: sy, left: sx, width: sw, height: sh, boxShadow: '0 0 20px rgba(139,92,246,0.3)' }}
        />
      )}

      {/* Floating card */}
      <div
        className="absolute w-80 bg-gradient-to-br from-[#1a1a2e] to-[#16162a] border border-violet-500/30 rounded-xl p-5 shadow-2xl transition-all duration-400"
        style={cardStyle}
      >
        <div className="text-[10px] font-semibold text-violet-400 uppercase tracking-wider mb-1">
          {chapterTitle}
        </div>
        <div className="text-[15px] font-semibold text-gray-100 mb-2">{stepTitle}</div>
        <div className="text-[13px] text-gray-400 leading-relaxed mb-4" dangerouslySetInnerHTML={{ __html: stepBody }} />

        <div className="flex items-center justify-between">
          {/* Progress dots */}
          <div className="flex gap-1">
            {Array.from({ length: totalSteps }, (_, i) => (
              <span
                key={i}
                className={`w-1.5 h-1.5 rounded-full ${i === globalIndex ? 'bg-violet-500' : i < globalIndex ? 'bg-violet-500/50' : 'bg-violet-500/15'}`}
              />
            ))}
          </div>
          {/* Step counter text */}
          <span className="text-[11px] text-gray-500">{globalIndex + 1} / {totalSteps}</span>
        </div>

        <div className="flex items-center justify-between mt-3">
          <div className="flex gap-2">
            {!isFirst && (
              <button onClick={onPrev} className="px-3 py-1.5 rounded-md border border-gray-700 text-gray-400 text-xs hover:border-gray-500 hover:text-gray-200 transition-colors">
                {t('tour.prev')}
              </button>
            )}
            <button onClick={onSkip} className="px-3 py-1.5 text-gray-600 text-xs hover:text-gray-400 transition-colors">
              {t('tour.skip')}
            </button>
          </div>
          <button onClick={onNext} className="px-4 py-1.5 rounded-md bg-violet-600 text-white text-xs font-semibold hover:bg-violet-500 transition-colors">
            {isLast ? t('tour.finish') : t('tour.next')}
          </button>
        </div>
      </div>
    </div>
  );
}

function AutoPlayOverlay() {
  // Renders a floating narration card (no spotlight) during auto-play.
  // Positioned bottom-center, slides up on each narration change.
  const { autoPlayIndex, endTour, transitionToManual } = useTourStore();
  // ... narration rendering + "Skip" / "Start exploring" buttons
  return (/* narration card JSX */);
}

function computeCardPosition(rect: Rect | null, placement: string): React.CSSProperties {
  if (!rect) return { top: '50%', left: '50%', transform: 'translate(-50%, -50%)' };
  switch (placement) {
    case 'right': return { top: rect.top, left: rect.left + rect.width + 24 };
    case 'left':  return { top: rect.top, left: rect.left - 344 };
    case 'bottom': return { top: rect.top + rect.height + 16, left: rect.left + rect.width / 2 - 160 };
    case 'top': return { top: rect.top - 200, left: rect.left + rect.width / 2 - 160 };
    default: return { top: rect.top, left: rect.left + rect.width + 24 };
  }
}
```

**Step 4: Run tests — confirm passes**

Run: `pnpm vitest run apps/dashboard/src/features/tour/__tests__/TourOverlay.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/dashboard/src/features/tour/TourOverlay.tsx apps/dashboard/src/features/tour/__tests__/TourOverlay.test.ts
git commit -m "feat(tour): add TourOverlay spotlight + floating card component"
```

---

### Task 6: Auto-Play Replayer

**Files:**

- Create: `apps/dashboard/src/features/tour/useAutoPlay.ts`

**Step 1: Write the auto-play hook**

```ts
// useAutoPlay.ts
import { useEffect, useRef } from 'react';
import { useTourStore } from './tourStore';
import { DEMO_EVENTS } from './demoEvents';
import { useAgentStore } from '../../store/agentStore';

/**
 * Drives the auto-play phase: feeds demo events into agentStore
 * on a timer, advancing the narration callout at milestone events.
 * Clears demo data from the store when the tour ends.
 */
export function useAutoPlay() {
  const phase = useTourStore((s) => s.phase);
  const advanceAutoPlay = useTourStore((s) => s.advanceAutoPlay);
  const autoPlayIndex = useTourStore((s) => s.autoPlayIndex);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const eventsInjected = useRef<string[]>([]);

  useEffect(() => {
    if (phase !== 'autoPlay') return;

    let cancelled = false;
    let idx = 0;

    async function playNext() {
      if (cancelled || idx >= DEMO_EVENTS.length) return;

      const event = DEMO_EVENTS[idx];
      // Wait the specified delay
      await new Promise((r) => {
        timerRef.current = setTimeout(r, event.delayMs);
      });
      if (cancelled) return;

      // Inject event into the real store
      useAgentStore.getState().addEvent(event.payload as any);
      eventsInjected.current.push(event.payload.session_id as string);

      // Advance narration if this event has one
      if (event.narrationKey) {
        advanceAutoPlay();
      }

      idx++;
      playNext();
    }

    playNext();

    return () => {
      cancelled = true;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [phase, advanceAutoPlay]);

  // Cleanup: remove demo session data when tour ends
  useEffect(() => {
    if (phase === 'idle' && eventsInjected.current.length > 0) {
      // The store's removeSession method cleans up all associated data
      useAgentStore.getState().removeSession?.('tour-demo-session');
      eventsInjected.current = [];
    }
  }, [phase]);
}
```

**Step 2: Commit**

```bash
git add apps/dashboard/src/features/tour/useAutoPlay.ts
git commit -m "feat(tour): add auto-play replayer hook"
```

---

### Task 7: TourLauncher Component

**Files:**

- Create: `apps/dashboard/src/features/tour/TourLauncher.tsx`

**Step 1: Write the launcher**

A small floating button + first-run detection card.

```tsx
// TourLauncher.tsx
import { useState, useEffect } from 'react';
import { useTourStore } from './tourStore';
import { TOUR_ENABLED } from './constants';
import { t } from '../../i18n';

/**
 * Renders:
 * 1. A first-run welcome card (if tour never completed)
 * 2. A persistent small "?" button to restart the tour anytime
 */
export function TourLauncher() {
  if (!TOUR_ENABLED) return null;

  const { active, hasCompleted, startTour } = useTourStore();
  const [showWelcome, setShowWelcome] = useState(false);

  // Show welcome card on first load if tour hasn't been completed
  useEffect(() => {
    if (!hasCompleted() && !active) {
      const timer = setTimeout(() => setShowWelcome(true), 2000); // delay so app loads first
      return () => clearTimeout(timer);
    }
  }, []);

  if (active) return null; // Tour is running, overlay handles everything

  return (
    <>
      {/* First-run welcome card */}
      {showWelcome && (
        <div className="fixed bottom-6 right-6 z-[9990] w-72 bg-gradient-to-br from-[#1a1a2e] to-[#16162a] border border-violet-500/30 rounded-xl p-5 shadow-2xl animate-[fadeIn_0.3s_ease]">
          <div className="text-sm font-semibold text-gray-100 mb-1">{t('tour.launcher.title')}</div>
          <div className="text-xs text-gray-400 mb-4">{t('tour.launcher.body')}</div>
          <div className="flex gap-2">
            <button
              onClick={() => {
                setShowWelcome(false);
                startTour();
              }}
              className="flex-1 px-3 py-1.5 rounded-md bg-violet-600 text-white text-xs font-semibold hover:bg-violet-500"
            >
              {t('tour.launcher.start')}
            </button>
            <button
              onClick={() => {
                setShowWelcome(false);
                localStorage.setItem('synapse-tour-completed', '1');
              }}
              className="px-3 py-1.5 rounded-md border border-gray-700 text-gray-400 text-xs hover:text-gray-200"
            >
              {t('tour.launcher.dismiss')}
            </button>
          </div>
        </div>
      )}

      {/* Persistent restart button (always visible in bottom-right) */}
      <button
        onClick={startTour}
        title="Start guided tour"
        className="fixed bottom-4 right-4 z-[9980] w-8 h-8 rounded-full bg-violet-600/20 border border-violet-500/30 text-violet-400 text-xs font-bold hover:bg-violet-600/40 transition-colors flex items-center justify-center"
      >
        ?
      </button>
    </>
  );
}
```

**Step 2: Commit**

```bash
git add apps/dashboard/src/features/tour/TourLauncher.tsx
git commit -m "feat(tour): add TourLauncher with first-run detection"
```

---

### Task 8: Feature Index & App Integration

**Files:**

- Create: `apps/dashboard/src/features/tour/index.ts`
- Modify: `apps/dashboard/src/App.tsx` (+2 lines)

**Step 1: Write index.ts (public API)**

```ts
// index.ts
export { useTourStore } from './tourStore';
export { TourOverlay } from './TourOverlay';
export { TourLauncher } from './TourLauncher';
export { useAutoPlay } from './useAutoPlay';
export { TOUR_ENABLED } from './constants';

let initialized = false;

/**
 * Initialize the tour system. Call once at module level in App.tsx.
 * Safe to call multiple times (guarded).
 */
export function initTour(): void {
  if (initialized) return;
  initialized = true;
  // Any one-time setup (e.g., checking first-run state) goes here.
  // Currently a no-op — the TourLauncher handles first-run detection via useEffect.
}
```

**Step 2: Add 2 lines to App.tsx**

At the top imports:

```ts
import { initTour } from './features/tour'; // [tour]
```

After `initNotifications()`:

```ts
initTour(); // [tour]
```

Inside `FullView` component, before the closing `</div>`:

```tsx
{/* [tour] */}
<TourOverlay />
<TourLauncher />
```

Wait — that's actually more like 4 lines. Let me be precise about the minimal integration. The `TourOverlay` and `TourLauncher` render from `initTour()` would require React components mounted somewhere. The cleanest approach:

**Revised approach**: `initTour()` stays as module-level init. Mount `TourOverlay` + `TourLauncher` inside `FullView` (the only view mode that has the full dashboard). That's 3 additions to `App.tsx`:

```diff
+ import { initTour, TourOverlay, TourLauncher } from './features/tour'; // [tour]

  initNotifications(); // [notifications]
+ initTour(); // [tour]

  // ... inside FullView's return, before closing </div>:
+     <TourOverlay /> {/* [tour] */}
+     <TourLauncher /> {/* [tour] */}
```

**Step 3: Run all tests**

Run: `pnpm vitest run`
Expected: All existing tests PASS + 10+ new tour tests PASS

**Step 4: Commit**

```bash
git add apps/dashboard/src/features/tour/index.ts apps/dashboard/src/App.tsx
git commit -m "feat(tour): wire tour into App with minimal integration"
```

---

### Task 9: Auto-Play Hook Integration

**Files:**

- Modify: `apps/dashboard/src/features/tour/TourOverlay.tsx` (add `useAutoPlay` call)

**Step 1: Call useAutoPlay inside TourOverlay**

At the top of the `TourOverlay` component:

```tsx
export function TourOverlay() {
  useAutoPlay(); // drives auto-play event injection

  const { active, phase, ... } = useTourStore();
  // ... rest unchanged
}
```

**Step 2: Manual smoke test**

1. Start server: `.\start-server.ps1`
2. Start frontend: `.\start-client.ps1`
3. Open http://localhost:5173
4. Welcome card should appear after 2s
5. Click "Start Tour" — graph should populate with demo events
6. After auto-play, manual spotlight tour should begin
7. Arrow keys / Next / Back / Skip all work
8. Press Escape to exit
9. Restart button (?) in bottom-right should work

**Step 3: Commit**

```bash
git add apps/dashboard/src/features/tour/TourOverlay.tsx
git commit -m "feat(tour): integrate auto-play replayer into overlay"
```

---

### Task 10: Chapter Continuation Prompt

**Files:**

- Modify: `apps/dashboard/src/features/tour/TourOverlay.tsx`

**Step 1: Add chapter transition card**

After Chapter 5 (Settings & Tools), before the optional chapters (Analytics, Pixel), show a card asking:

> "That covers the core dashboard! Want to continue to Analytics and Pixel Mode?"
> [Continue] [Finish Here]

This is a special step inserted between Chapter 5 and Chapter 6 that checks `OPTIONAL_CHAPTERS` and branches accordingly.

**Step 2: Commit**

```bash
git add apps/dashboard/src/features/tour/TourOverlay.tsx
git commit -m "feat(tour): add optional chapter continuation prompt"
```

---

### Task 11: Full Test Suite

**Files:**

- Expand: `apps/dashboard/src/features/tour/__tests__/tourStore.test.ts`
- Expand: `apps/dashboard/src/features/tour/__tests__/TourOverlay.test.ts`

**Step 1: Add edge-case tests**

- Tour restart after completion
- Chapter boundary transitions (last step of ch1 → first step of ch2)
- Auto-play cleanup (demo session removed from store on end)
- Keyboard navigation during auto-play (only Escape works)
- Resize repositions spotlight
- Missing target element (step target not in DOM — card centered fallback)
- `TOUR_ENABLED = false` renders nothing

**Step 2: Run full suite**

Run: `pnpm vitest run`
Expected: ALL tests pass

**Step 3: Commit**

```bash
git add apps/dashboard/src/features/tour/__tests__/
git commit -m "test(tour): comprehensive edge-case test coverage"
```

---

### Task 12: CSS Animations

**Files:**

- Modify: `apps/dashboard/src/index.css` (add tour-specific keyframes, tagged `[tour]`)

**Step 1: Add animations**

```css
/* ── Tour animations ── [tour] */
@keyframes tour-card-enter {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
@keyframes tour-spotlight-pulse {
  0%,
  100% {
    box-shadow: 0 0 12px rgba(139, 92, 246, 0.2);
  }
  50% {
    box-shadow: 0 0 24px rgba(139, 92, 246, 0.5);
  }
}
```

These are referenced via inline `animation` style or Tailwind arbitrary values in the TourOverlay.

**Step 2: Commit**

```bash
git add apps/dashboard/src/index.css
git commit -m "feat(tour): add spotlight animations"
```

---

## Summary of Core File Changes

| File         | Change                                          | Tag            |
| ------------ | ----------------------------------------------- | -------------- |
| `App.tsx`    | +1 import, +1 `initTour()`, +2 component mounts | `// [tour]`    |
| `i18n/en.ts` | +1 block of `tour.*` string keys                | `// [tour]`    |
| `index.css`  | +2 `@keyframes` rules                           | `/* [tour] */` |

**Total: 3 core files touched, ~6 lines added, all tagged `// [tour]`.**

Everything else lives in `apps/dashboard/src/features/tour/` (~12 files).

## Removal

```bash
rm -rf apps/dashboard/src/features/tour/
grep -rn "// \[tour\]" apps/dashboard/src/   # shows 3 files, ~6 lines to delete
# Delete those lines → Synapse is exactly as before
```
