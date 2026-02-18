# Conversation-Aware Coaching System

## Problem

The coaching system evaluated every prompt in isolation. A short conversational follow-up like "make it black" (turn 5 of an iterative UX session) got flagged as "vague" because the system didn't know it was a continuation where "it" had a clear referent from prior turns. This produced false-positive nudges and misleading AI analysis scores.

## Solution: Three Layers

### Layer 1 — SessionAccumulator Expansion (local, zero-cost)

**File**: `packages/server/src/services/nudgeEngine.ts`

Three new fields on `SessionAccumulator` (type in `packages/core/src/types/coaching.ts`):

- `recentPromptTexts: string[]` — sliding window of last 3 prompt texts (500 chars each)
- `sessionGoalSummary: string` — first sentence / first 100 chars of the session's first prompt (pure string manipulation, no AI)
- `conversationMode: boolean` — auto-detected: true when 2+ prompts in last 2 minutes AND avg word count of recent prompts < 15

Updated in `updateAccumulator()` on every `user_prompt` event. `sessionGoalSummary` only set once (first prompt).

### Layer 2 — Rule Engine Updates (local, zero-cost)

**File**: `packages/server/src/services/rules/planningRules.ts`

- **`plan.vague-prompt`**: Dynamic threshold — normally fires at <10 words, in conversation mode only fires at <3 words. "Make it black" (4 words) passes in conversation mode.
- **`plan.rapid-prompts`**: Fully suppressed when `conversationMode` is true. Rapid short prompts during iteration are expected behavior.

### Layer 3 — AI Coach Context (remote, ~200-500 extra tokens per call)

**File**: `packages/server/src/services/aiCoachService.ts`

`analyzePrompt()` accepts optional `conversationContext`:

```ts
conversationContext?: {
  recentPrompts: string[];       // last 3 prompts before current
  sessionGoal: string;           // from prompt 1
  turnNumber: number;            // 1-based
  isConversationalMode: boolean;
}
```

When present, a context block is prepended to the AI user message (both developer and vibe modes) with explicit instruction: "If conversational mode is active, do not penalize brevity when context makes intent clear."

Cache key includes `convHash` so the same prompt analyzed in different contexts gets different cached results.

---

## Data Flow

### Live Nudges (server-side, real-time)

```
hook event → updateEventBuffer() → updateAccumulator()
  → sets recentPromptTexts, sessionGoalSummary, conversationMode
  → checkNudges() → rules read acc.conversationMode
  → nudge includes triggerPrompt from acc.lastPromptText
  → broadcast via WS → LiveNudgesView shows trigger prompt
```

### Click-to-Analyze (frontend-initiated, on-demand)

```
PromptAnalyzer "Analyze with AI" button
  → extracts prior turns from data.turns (by sessionId + turnIndex)
  → computes isConversationalMode locally (2+ turns <2min, avg words <15)
  → extracts sessionGoal from first turn
  → POST /api/analytics/ai-analyze-prompt with conversationContext
  → route handler normalizes + threads to aiCoachService.analyzePrompt()
  → AI receives context block + prompt → context-aware scoring
```

---

## Files Modified (8 total)

| File | What Changed |
|------|-------------|
| `packages/core/src/types/coaching.ts` | +3 fields on SessionAccumulator, +triggerPrompt on CoachingNudge |
| `packages/server/src/services/nudgeEngine.ts` | createAccumulator init, updateAccumulator prompt logic, nudge construction |
| `packages/server/src/services/rules/planningRules.ts` | Dynamic threshold in vague-prompt, conversation-mode guard in rapid-prompts |
| `packages/server/src/services/aiCoachService.ts` | analyzePrompt() signature + cache key + AI prompt context block |
| `packages/server/src/routes/analytics.ts` | Route handler destructuring + defensive normalization |
| `apps/dashboard/src/components/analytics/prompts/PromptAnalyzer.tsx` | analyzeWithAi callback builds conversationContext from neighboring turns |
| `apps/dashboard/src/components/analytics/nudges/LiveNudgesView.tsx` | NudgeCard shows trigger prompt blockquote |
| `packages/server/src/__tests__/nudgeEngine.test.ts` | 7 new tests (sliding window, goal extraction, mode activation, rule suppression) |

---

## Key Design Decisions

- **Session goal is pure string manipulation, not AI** — avoids latency/cost on the highest-value first prompt
- **conversationMode recomputed on every user_prompt** — O(n) over max 20 timestamps + 3 strings, negligible
- **Frontend computes isConversationalMode locally** — data.turns is already in scope, no round-trip needed
- **triggerPrompt is optional on CoachingNudge** — backward compatible with existing nudges from DB
- **Cache key includes convHash** — prevents stale results when same prompt has different conversation context

---

## Conversation Mode Detection Algorithm

```ts
// On every user_prompt event:

// 1. Sliding window of last 3 prompts (capped at 500 chars each)
acc.recentPromptTexts.push(capped);
if (acc.recentPromptTexts.length > 3) acc.recentPromptTexts.shift();

// 2. Session goal from first prompt (first sentence or first 100 chars)
if (acc.promptCount === 1 && capped.length > 0) {
  const sentenceEnd = capped.search(/[.!?]/);
  acc.sessionGoalSummary = sentenceEnd > 0 && sentenceEnd < 100
    ? capped.slice(0, sentenceEnd + 1)
    : capped.slice(0, 100);
}

// 3. Conversation mode: 2+ prompts in last 2min AND avg word count < 15
const twoMinAgo = event.timestamp - 120_000;
const recentCount = acc.promptTimestamps.filter((t) => t >= twoMinAgo).length;
if (recentCount >= 2) {
  const avgWords = acc.recentPromptTexts
    .map((p) => p.split(/\s+/).filter(Boolean).length)
    .reduce((a, b) => a + b, 0) / acc.recentPromptTexts.length;
  acc.conversationMode = avgWords < 15;
} else {
  acc.conversationMode = false;
}
```

## AI Context Block Format

When `conversationContext` is present in an `analyzePrompt()` call, this block is prepended to the AI user message:

```
Conversation context:
- Turn number: 5 of the session
- Session goal: "Refactor the auth module."
- Conversational mode: yes (iterative feedback loop — rapid short prompts are expected)
- Recent prior prompts:
  [1] Build a settings page with dark mode toggle
  [2] Add an icon in the top right
  [3] Make it look more minimal

IMPORTANT: If conversational mode is active, short or referential prompts
("make it black", "yes do that", "now the header") are entirely appropriate.
Do not penalize brevity when the conversation context makes the intent clear.
```

## Test Coverage

7 test cases in `packages/server/src/__tests__/nudgeEngine.test.ts`:

1. `recentPromptTexts maintains a sliding window of last 3` — feeds 4 prompts, verifies array stays at 3
2. `sessionGoalSummary extracts first sentence from first prompt` — "Refactor the auth module. Make it cleaner." → "Refactor the auth module."
3. `conversationMode activates with rapid short prompts` — 3 prompts 30s apart, <15 words each → true
4. `conversationMode stays false for spaced-out prompts` — 3 prompts 5min apart → false
5. `vague-prompt suppressed in conversationMode` — 5-word prompt in conversation mode → no nudge
6. `rapid-prompts suppressed in conversationMode` — 3+ fast short prompts → no nudge
7. `rapid-prompts fires without conversationMode` — 3+ fast long prompts (20+ words) → nudge fires
