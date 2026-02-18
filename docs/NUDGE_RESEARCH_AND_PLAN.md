# Live Nudge System — Comprehensive Enhancement Plan

## Context

Synapse already has a working nudge foundation: 8 real-time detectors, 41 report card detectors, AI escalation for warnings, and WebSocket broadcast to the frontend. But the current system is limited in scope (only 8 live rules), uses a tiny 20-event buffer, has hardcoded thresholds, and cannot detect multi-event temporal patterns like "edit without read" sequences or "approach repetition after errors."

Deep research into Claude Code best practices, anti-patterns from Anthropic's docs, Stack Overflow studies, and industry analysis identified **50+ detectable bad patterns** across 9 categories. Research into rule engine architectures (ESLint's visitor pattern, CEP temporal operators, Meta's NudgeBot) shows exactly how to build a scalable, non-fatiguing nudge system.

**Goal**: Transform Synapse into a real-time coding coach that monitors user behavior, detects bad patterns, and fires actionable nudges — all locally, with near-zero latency, powered by a rule-based engine with optional AI escalation.

---

## Architecture Overview

```
┌───────────────────────────────────────────────────────────────────┐
│                        Event Ingest (existing)                     │
│  Hook event → normalize → persist → broadcast → nudge pipeline     │
└─────────────────────────────┬─────────────────────────────────────┘
                              │
                              ▼
┌───────────────────────────────────────────────────────────────────┐
│                     Session Accumulator (new)                      │
│  Incrementally maintained per-session counters, file sets,         │
│  tool sequences, timestamps — O(1) per event update               │
└─────────────────────────────┬─────────────────────────────────────┘
                              │
         ┌────────────────────┼────────────────────┐
         ▼                    ▼                    ▼
┌─────────────┐    ┌──────────────────┐    ┌──────────────┐
│ Count Window │    │  Time Window     │    │ Pattern FSMs │
│ (last N)     │    │  (last T mins)   │    │ (sequences)  │
└──────┬──────┘    └────────┬─────────┘    └──────┬───────┘
       │                    │                     │
       └────────────────────┼─────────────────────┘
                            ▼
┌───────────────────────────────────────────────────────────────────┐
│                    Rule Engine (enhanced)                          │
│  Visitor-pattern dispatch: only invoke rules subscribed to the     │
│  incoming event type. Each rule gets a RuleContext with read-only  │
│  access to windows, accumulators, and a report() method.          │
└─────────────────────────────┬─────────────────────────────────────┘
                              ▼
┌───────────────────────────────────────────────────────────────────┐
│                   Delivery Manager (new)                           │
│  - Per-rule cooldown with exponential backoff                      │
│  - Severity prioritization (only highest when multiple fire)       │
│  - Global rate limit (max N nudges per session)                    │
│  - User suppression (dismiss 3x → auto-suppress)                  │
│  - Session-phase awareness (don't fire "no plan" at session start) │
└─────────────────────────────┬─────────────────────────────────────┘
                              ▼
┌───────────────────────────────────────────────────────────────────┐
│         Existing: persist → broadcast → optional AI escalation     │
└───────────────────────────────────────────────────────────────────┘
```

---

## Phase 1: Session Accumulator & Dual Windows

**Why**: The current 20-event buffer is too small for most patterns and rebuilds nothing incrementally. We need O(1) per-event state updates.

### Files to modify
- `packages/server/src/services/nudgeEngine.ts` — Replace event buffer with SessionAccumulator

### New: SessionAccumulator (inline in nudgeEngine.ts or new file)

Incrementally maintained per-session state, updated on every event:

```typescript
interface SessionAccumulator {
  sessionId: string;
  startTime: number;
  lastEventTime: number;
  eventCount: number;

  // Tool tracking
  toolCounts: Map<string, number>;       // tool name → invocation count
  toolErrors: Map<string, number>;       // tool name → error count
  consecutiveBashFileOps: number;        // reset on non-bash-file-op
  consecutiveErrors: number;             // reset on success
  lastToolName: string | null;

  // File tracking
  filesRead: Set<string>;               // all files Read in session
  filesEdited: Set<string>;             // all files Edited
  readBeforeEdit: Set<string>;          // Edit where Read preceded it
  editWithoutRead: Set<string>;         // Edit with no prior Read
  fileReadCounts: Map<string, number>;  // per-file Read count

  // Prompt tracking
  promptCount: number;
  promptTimestamps: number[];           // for rapid-prompt detection
  lastPromptTime: number;
  totalPromptTokens: number;

  // Token/cost tracking
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCostUsd: number;

  // Agent tracking
  subagentCount: number;
  activeSubagents: Set<string>;

  // Planning signals
  usedPlanMode: boolean;
  usedTodoWrite: boolean;
  usedSubagents: boolean;
  distinctFilesModified: number;

  // Verification signals
  testRunCount: number;
  editsSinceLastTest: number;
  lastTestTime: number;

  // Git signals
  commitCount: number;
  editsSinceLastCommit: number;
  usedGitAddAll: boolean;
  usedForceOps: boolean;

  // Compaction
  compactionCount: number;

  // Permission mode
  permissionMode: string | null;
}
```

**Update logic**: A single `updateAccumulator(acc, event)` function with a switch on `event.type` that updates the relevant counters in O(1).

### Dual Windows

Keep both window types, let rules choose:

- **Count window** (existing buffer, expanded to 50 events): For consecutive-event patterns
- **Time window** (5-minute sliding): For frequency-based patterns. Lazy eviction — remove expired events on read.

---

## Phase 2: Rule Engine Refactor — Visitor Pattern

**Why**: Currently all 8 detectors are checked on every event. The visitor pattern (inspired by ESLint) only invokes rules that care about the incoming event type, making it O(relevant rules) not O(all rules).

### Files to modify
- `packages/server/src/services/nudgeEngine.ts` — Refactor core engine
- `packages/server/src/services/rules/` — New directory for individual rule modules

### NudgeRule Interface

```typescript
interface NudgeRuleMeta {
  id: string;                          // e.g., "toolCraft.bash-file-ops"
  name: string;                        // "Bash for File Operations"
  description: string;                 // User-facing explanation
  dimension: CoachingDimension;        // Links to report card dimension
  defaultSeverity: 'info' | 'suggestion' | 'warning';
  defaultCooldownMs: number;
  category: RuleCategory;              // 'tool-usage' | 'workflow' | 'git' | 'security' | 'efficiency' | 'planning' | 'verification'
  tags: string[];                      // For filtering/grouping
}

interface NudgeRule {
  meta: NudgeRuleMeta;

  // Visitor pattern: returns map of event types this rule cares about
  subscribes(): AgentEventType[];

  // Called only when a subscribed event arrives
  evaluate(ctx: RuleContext): NudgeCandidate | null;
}
```

### RuleContext (read-only API for rules)

```typescript
interface RuleContext {
  event: AgentEvent;                              // The triggering event
  accumulator: Readonly<SessionAccumulator>;       // Session state
  countWindow: ReadonlyArray<AgentEvent>;          // Last N events
  timeWindow: ReadonlyArray<AgentEvent>;           // Last T minutes
  getPatternState(key: string): unknown;           // FSM state for multi-event patterns
  setPatternState(key: string, value: unknown): void;
}
```

### Engine Dispatch

```typescript
class NudgeEngine {
  private rules: NudgeRule[] = [];
  private ruleIndex: Map<AgentEventType, NudgeRule[]> = new Map();  // visitor index

  register(rule: NudgeRule): void {
    this.rules.push(rule);
    for (const type of rule.subscribes()) {
      const list = this.ruleIndex.get(type) ?? [];
      list.push(rule);
      this.ruleIndex.set(type, list);
    }
  }

  processEvent(event: AgentEvent, broadcaster: Broadcaster): void {
    // 1. Update accumulator
    // 2. Update windows
    // 3. Get rules for this event type (O(1) lookup)
    // 4. For each: check cooldown → check user suppression → evaluate → report
    // 5. Pass candidates to DeliveryManager
  }
}
```

---

## Phase 3: Comprehensive Rule Catalog (30 Rules)

**Why**: 8 rules is barely scratching the surface. Research identified 50+ detectable patterns. We'll implement the 30 highest-value rules across 7 categories.

### Category 1: Tool Usage (7 rules)

| Rule ID | Name | Trigger Events | Detection Logic | Severity |
|---------|------|----------------|-----------------|----------|
| `tool.bash-file-ops` | Bash for File Operations | `tool_start` | Bash command contains `cat`, `grep`, `find`, `sed`, `echo >`, `head`, `tail` | suggestion |
| `tool.bash-streak` | Consecutive Bash File Ops | `tool_end` | 3+ consecutive bash file ops (from accumulator) | suggestion |
| `tool.no-parallelization` | Sequential Independent Calls | `tool_end` | 3+ sequential single-tool turns where tools access independent files | info |
| `tool.excessive-bash-output` | Large Bash Output | `tool_end` | Bash tool response >5000 chars (wastes context) | info |
| `tool.edit-without-read` | Edit Without Read | `tool_start` | Edit tool on file not in `filesRead` set | warning |
| `tool.file-reread` | Excessive File Re-Reading | `tool_end` | Same file read 3+ times in session | suggestion |
| `tool.write-over-edit` | Write When Edit Would Work | `tool_start` | Write to file that exists and was already Read | suggestion |

### Category 2: Planning & Prompts (5 rules)

| Rule ID | Name | Trigger Events | Detection Logic | Severity |
|---------|------|----------------|-----------------|----------|
| `plan.no-plan-mode` | Complex Task Without Planning | `tool_start` | 5+ distinct files modified AND `usedPlanMode === false` | suggestion |
| `plan.no-todo-tracking` | No Task Tracking | `tool_end` | 10+ tool calls AND `usedTodoWrite === false` | info |
| `plan.vague-prompt` | Vague Prompt | `user_prompt` | Prompt < 30 tokens for task that generates >500 output tokens | suggestion |
| `plan.rapid-prompts` | Rapid-Fire Prompts | `user_prompt` | 3+ prompts within 2 minutes | info |
| `plan.kitchen-sink` | Mixed Concerns in Session | `user_prompt` | Detect topic shift: different file clusters modified after a prompt vs before | info |

### Category 3: Verification (5 rules)

| Rule ID | Name | Trigger Events | Detection Logic | Severity |
|---------|------|----------------|-----------------|----------|
| `verify.no-tests-after-edits` | No Tests After Edits | `tool_end` | 5+ edits without any test/build Bash command | warning |
| `verify.error-spiral` | Error Spiral | `tool_error` | 3+ consecutive tool errors | warning |
| `verify.same-error-retry` | Retrying Same Approach | `tool_error` | Same tool+file error repeated without different approach | warning |
| `verify.test-deletion` | Test Deletion | `tool_end` | Edit/Write to test file with fewer lines (detected via tool_input) | warning |
| `verify.no-review-before-commit` | Commit Without Review | `tool_end` | git commit with no preceding `git diff` or subagent review | suggestion |

### Category 4: Git & Workflow (5 rules)

| Rule ID | Name | Trigger Events | Detection Logic | Severity |
|---------|------|----------------|-----------------|----------|
| `git.force-push` | Force Push | `tool_start` | Bash contains `push --force` or `push -f` | warning |
| `git.no-commits` | Long Session Without Commits | `tool_end` | 20+ edits AND 0 commits | suggestion |
| `git.add-all` | Indiscriminate Staging | `tool_start` | Bash contains `git add -A` or `git add .` | suggestion |
| `git.main-branch-direct` | Direct Commit to Main | `tool_end` | Git commit while on main/master branch | warning |
| `git.large-commit` | Oversized Commit | `tool_end` | Commit touching >10 files across >3 directories | info |

### Category 5: Security (3 rules)

| Rule ID | Name | Trigger Events | Detection Logic | Severity |
|---------|------|----------------|-----------------|----------|
| `security.hardcoded-secret` | Hardcoded Secret | `tool_end` | Write/Edit content matches `API_KEY=`, `SECRET=`, `PASSWORD=`, `Bearer ` patterns | warning |
| `security.env-in-commit` | Env File in Commit | `tool_start` | `git add` includes `.env`, `.pem`, `.key`, `credentials` | warning |
| `security.process-kill-all` | Blanket Process Kill | `tool_start` | Bash contains `taskkill` with `//IM` (kills all processes of type) | warning |

### Category 6: Context & Cost Efficiency (3 rules)

| Rule ID | Name | Trigger Events | Detection Logic | Severity |
|---------|------|----------------|-----------------|----------|
| `efficiency.long-session` | Overlong Session | `tool_end`, `user_prompt` | Session >60 min without `/clear` or commits | info |
| `efficiency.no-subagents` | No Subagent Delegation | `tool_end` | 30+ Read/Grep calls AND 0 Task invocations | suggestion |
| `efficiency.cost-spike` | Cost Spike | `tool_end` | Current turn cost >3x session average cost per turn | info |

### Category 7: Agent Orchestration (2 rules)

| Rule ID | Name | Trigger Events | Detection Logic | Severity |
|---------|------|----------------|-----------------|----------|
| `agent.vague-delegation` | Vague Subagent Instructions | `agent_start` | Task tool prompt <100 tokens | suggestion |
| `agent.redundant-reads` | Redundant Subagent Work | `tool_end` | Multiple subagents reading same file within session | info |

### Implementation approach
- Each rule is a separate file in `packages/server/src/services/rules/`
- A `ruleRegistry.ts` file imports and registers all rules
- Rules are grouped by category for the UI

---

## Phase 4: Delivery Manager

**Why**: Over-nudging is worse than under-nudging (Meta NudgeBot research). We need sophisticated delivery logic.

### Files to modify
- `packages/server/src/services/nudgeEngine.ts` — Add DeliveryManager class

### DeliveryManager responsibilities

1. **Per-rule cooldown with backoff**: If a rule fires and user doesn't change behavior, next cooldown is 2x. After 3 consecutive fires, auto-suppress for the session.

2. **Global rate limit**: Max 10 nudges per session. After that, only `warning` severity can fire.

3. **Severity prioritization**: When multiple nudges fire on the same event, deliver only the highest severity. Queue the rest for later.

4. **User suppression**: Track dismissals in DB. If a rule is dismissed 3+ times across sessions, auto-suppress it until user re-enables.

5. **Session-phase awareness**: Some rules have a `minEvents` threshold before they can fire (e.g., "no plan mode" shouldn't fire on event #2).

6. **Deduplication**: Same rule + same evidence (e.g., same file path) within cooldown = skip.

```typescript
interface DeliveryConfig {
  maxNudgesPerSession: number;          // default: 10
  cooldownBackoffMultiplier: number;    // default: 2.0
  maxConsecutiveFiresBeforeSuppress: number;  // default: 3
  dismissalsBeforeAutoSuppress: number; // default: 3
  warningBypassesRateLimit: boolean;    // default: true
}
```

---

## Phase 5: Rule Configuration API & Frontend

**Why**: Frontend rule toggles currently only affect localStorage. We need server-side configuration that actually controls which rules run.

### Files to modify
- `packages/server/src/routes/coaching.ts` — Add rule config endpoints
- `packages/server/src/services/nudgeEngine.ts` — Read config on rule evaluation
- `apps/dashboard/src/components/coaching/LiveNudgesView.tsx` — Enhanced config UI
- `packages/server/src/db.ts` — New `nudge_rule_config` table

### New DB table

```sql
CREATE TABLE nudge_rule_config (
  rule_id         TEXT PRIMARY KEY,
  enabled         INTEGER DEFAULT 1,
  severity        TEXT,                    -- override: null = use default
  cooldown_ms     INTEGER,                 -- override: null = use default
  options         TEXT,                    -- JSON: rule-specific params
  suppressed      INTEGER DEFAULT 0,       -- auto-suppressed from dismissals
  updated_at      INTEGER NOT NULL
);
```

### New API endpoints

| Method | Route | Purpose |
|--------|-------|---------|
| GET | `/api/analytics/coaching/rules` | List all rules with meta + config |
| PUT | `/api/analytics/coaching/rules/:id` | Update rule config (enable/disable, severity, cooldown) |
| POST | `/api/analytics/coaching/rules/reset` | Reset all rules to defaults |

### Frontend enhancements

- Replace hardcoded 8-rule toggle list with dynamic list from `/rules` API
- Group rules by category with collapsible sections
- Per-rule: toggle, severity selector, cooldown slider
- Show fire count + dismiss count per rule
- "Auto-suppressed" indicator for rules suppressed by repeated dismissal

---

## Phase 6: Cross-Session Pattern Analysis

**Why**: Some patterns only emerge over multiple sessions (declining report card scores, persistent bad habits, improvement trends).

### Files to modify
- `packages/server/src/services/nudgeEngine.ts` or new `crossSessionAnalyzer.ts`
- `packages/server/src/routes/coaching.ts` — New endpoints

### Cross-session detectors

| Detector | Logic | Output |
|----------|-------|--------|
| Habit persistence | Rule X fired in 3+ of last 5 sessions | "This is a recurring pattern. Consider adding a hook to enforce this automatically." |
| Improvement trend | Report card dimension score improved 10+ pts over last 5 sessions | "Your {dimension} skills are improving! Score went from {old} to {new}." |
| Regression alert | Dimension score dropped 15+ pts | "Your {dimension} score dropped. Review recent session for what changed." |
| Best session highlight | New personal best on any dimension | Celebrate with badge + encouragement |

### Storage
- Uses existing `coaching_report_cards` table for historical scores
- New `cross_session_insights` table or computed on-demand from report card history

---

## Phase 7: Enhanced Frontend — Nudge Timeline & Coaching Dashboard

**Why**: The current LiveNudgesView is basic. Users need a richer view to understand patterns and track improvement.

### Files to modify
- `apps/dashboard/src/components/coaching/LiveNudgesView.tsx` — Major enhancement

### New sections

1. **Nudge Timeline** — Visual timeline showing when nudges fired during a session, color-coded by severity, with event context
2. **Rule Heatmap** — Which rules fire most across sessions (grid: rules x sessions, color = fire count)
3. **Improvement Tracker** — Line chart of report card dimension scores over time
4. **Quick Wins** — Top 3 most impactful nudges (highest severity, most frequent) with specific action items
5. **Habit Streak** — "You've gone N sessions without {bad pattern}" gamification

---

## Implementation Sequence

| Phase | Scope | Effort | Dependencies |
|-------|-------|--------|--------------|
| **1** | SessionAccumulator + Dual Windows | Medium | None |
| **2** | Rule Engine Refactor (visitor pattern) | Medium | Phase 1 |
| **3** | 30 Rules (7 categories) | Large | Phase 2 |
| **4** | Delivery Manager | Medium | Phase 2 |
| **5** | Rule Configuration API + Frontend | Medium | Phase 3 |
| **6** | Cross-Session Analysis | Small | Phase 3 |
| **7** | Enhanced Frontend | Medium | Phase 5+6 |

Phases 1+2 are foundational. Phase 3 is the meat. Phases 4-7 add polish.
Phases 3+4 can be developed in parallel after 2 completes.
Phases 5+6+7 can be developed in parallel after 3 completes.

---

## Key Files Reference

| File | Role |
|------|------|
| `packages/server/src/services/nudgeEngine.ts` | Core engine (major rewrite in Phases 1-4) |
| `packages/server/src/services/rules/*.ts` | Individual rule modules (new, Phase 3) |
| `packages/server/src/services/rules/index.ts` | Rule registry (new, Phase 3) |
| `packages/server/src/services/reportCardEngine.ts` | Report card (read-only reference for detector alignment) |
| `packages/server/src/services/aiNudgeEscalator.ts` | AI escalation (minor updates in Phase 4) |
| `packages/server/src/services/costService.ts` | Cost data for cost-spike rules |
| `packages/server/src/routes/coaching.ts` | API endpoints (Phase 5) |
| `packages/server/src/db.ts` | Database schema (Phase 5) |
| `packages/core/src/types/coaching.ts` | Type definitions (Phases 1-2) |
| `apps/dashboard/src/components/coaching/LiveNudgesView.tsx` | Frontend (Phases 5+7) |

---

## Verification Plan

1. **Unit tests**: Each rule gets a test with mock events that trigger/don't trigger it
2. **Integration test**: Simulate a "bad session" (bash file ops, no tests, no plan mode) and verify correct nudges fire
3. **Simulation script**: Extend `scripts/simulate_all_nodes.ts` with a "bad habits" scenario that triggers multiple rules
4. **Manual test**: Run a real Claude Code session with intentional bad patterns, verify nudges appear in dashboard
5. **Fatigue test**: Simulate 100+ events rapidly, verify delivery manager caps nudge output at configured limit
6. **Cross-session test**: Generate 5 sessions with declining patterns, verify cross-session insights fire

---

## Research Sources That Informed This Plan

- Anthropic: Claude Code Best Practices (code.claude.com/docs/en/best-practices)
- Anthropic: Effective Context Engineering for AI Agents
- Anthropic: Effective Harnesses for Long-Running Agents
- Anthropic: 2026 Agentic Coding Trends Report
- Stack Overflow: AI coding bug frequency study (1.7x more bugs)
- Addy Osmani: The 80% Problem in Agentic Coding
- ESLint architecture: Visitor pattern, rule metadata, plugin system
- Meta NudgeBot: Evidence-based nudging at scale (6.8% review time decrease)
- Complex Event Processing: Temporal operators, window types, FSM patterns
- Key Promoter X: IDE nudge UX patterns
- OpenSSF: Security-focused AI code assistant guidelines
