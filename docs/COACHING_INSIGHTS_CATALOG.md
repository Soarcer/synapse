# Synapse Coach — Insight Catalog

## 8 Coaching Dimensions, ~60 Insights

Each insight follows a **3-tier progressive disclosure** pattern:
1. **Headline** — one-line takeaway shown as a card title
2. **Explanation** — why this matters, with before/after examples
3. **Action** — copy-pasteable template, one-click action, or habit to adopt

Detection signals describe what Synapse detects in the event stream to trigger the insight.

---

## Dimension 1: Planning & Preparation

*"Measure twice, cut once."*

Measures whether the developer sets up context before diving into implementation.

### 1.1 — Use Plan Mode for Multi-File Changes

**Headline**: You jumped straight into edits across 4 files without a plan.

**Why it matters**: Plan Mode lets Claude explore the codebase and propose an approach before making changes. Sessions that start in Plan Mode have fewer retry loops and lower rework cost. The plan also becomes a checklist you can verify against.

**Before** (costly):
```
You: "Refactor the auth middleware to use JWT"
→ Claude edits 6 files, misses the existing token helper,
  creates redundant code, 3 correction prompts follow
→ Cost: $14.20, 47 minutes
```

**After** (efficient):
```
You: [Plan Mode] "Refactor the auth middleware to use JWT.
     Analyze the existing auth flow first."
→ Claude reads 4 files, proposes a plan referencing existing helpers
→ You approve, Claude executes in 2 prompts
→ Cost: $4.80, 18 minutes
```

**How to do this**: Press `Shift+Tab` twice to enter Plan Mode before any task that touches 3+ files. Review the plan, press `Ctrl+G` to edit it in your editor, then switch to Normal Mode for implementation.

**Detection**: Session has Edit/Write calls to 3+ distinct files without a prior `plan` event or Explore subagent.

---

### 1.2 — Read Before You Edit

**Headline**: You edited `auth.ts` without reading it first.

**Why it matters**: Claude's Edit tool requires an exact `old_string` match. If Claude guesses the current file content, the edit fails and burns tokens on retries. Reading the file first costs ~500 tokens but prevents 5-10K tokens in failed edits.

**Before**:
```
You: "Change the rate limit from 100 to 200 in server/middleware/rateLimit.ts"
→ Claude attempts Edit with guessed old_string → fails
→ Claude reads file → retries Edit → succeeds
→ 3 tool calls, 2 wasted
```

**After**:
```
You: "Read server/middleware/rateLimit.ts, then change the rate limit from 100 to 200"
→ Claude reads → edits with exact match → succeeds
→ 2 tool calls, 0 wasted
```

**How to do this**: Mention the file with `@` or explicitly ask Claude to read it first. For complex edits, include "read the file first" in your prompt.

**Detection**: Edit tool call fails with "old_string not found" followed by a Read of the same file.

---

### 1.3 — Front-Load Context in Your First Prompt

**Headline**: Your first prompt was 12 words with no file references or constraints.

**Why it matters**: Vague first prompts trigger expensive exploration. Claude reads 10-20 files trying to understand what you want. Specific first prompts (with file paths, constraints, and verification criteria) reduce exploration by 60-80%.

**Before** (vague):
```
"fix the login bug"
→ Claude greps entire codebase for "login", reads 12 files,
  guesses wrong issue, attempts fix, you correct twice
→ Cost: $8.40
```

**After** (specific):
```
"Users report login fails after session timeout. Check the token
refresh logic in src/auth/refresh.ts. Write a failing test that
reproduces the timeout scenario, then fix it."
→ Claude reads 2 files, writes test, fixes issue
→ Cost: $2.10
```

**Template**:
```
[What's wrong / what you want]: [specific description]
[Where to look]: [file paths or directories]
[How to verify]: [test command, expected output, or screenshot]
[Constraints]: [patterns to follow, things to avoid]
```

**Detection**: First prompt in session has < 20 words AND no file path references AND subsequent session has > 5 Read/Grep calls.

---

### 1.4 — Use the Interview Technique for Complex Features

**Headline**: This feature took 11 prompts with 4 corrections. Consider the interview technique.

**Why it matters**: For complex features, having Claude interview you about requirements before coding produces 85% fewer security vulnerabilities and 300% better maintainability (spec-driven development research).

**Template**:
```
I want to build [brief description]. Interview me in detail using
the AskUserQuestion tool. Ask about technical implementation, UI/UX,
edge cases, concerns, and tradeoffs. Don't ask obvious questions —
dig into the hard parts I might not have considered. Keep interviewing
until we've covered everything, then write a complete spec to SPEC.md.
```

Then start a fresh session: `"Implement the spec in SPEC.md"`

**Detection**: Session with > 8 user prompts and > 3 correction patterns (Edit → Error → Edit on same file).

---

### 1.5 — Reference Existing Patterns

**Headline**: Claude built this component from scratch. There's a similar component at `src/components/DataTable.tsx` it could have followed.

**Why it matters**: A 100-token grep that finds existing code saves 70K tokens of reimplementation. When you tell Claude to follow an existing pattern, it produces consistent code that matches your codebase conventions.

**Before**:
```
"Add a calendar widget to the dashboard"
→ Claude invents a new component style, different from existing widgets
→ You spend 3 prompts correcting style inconsistencies
```

**After**:
```
"Look at how existing widgets are implemented on the dashboard —
HotDogWidget.tsx is a good example. Follow the same pattern to
implement a new calendar widget."
→ Claude reads the example, matches the pattern exactly
```

**Detection**: Write tool creates a new file in a directory that already contains similar files, without prior Read of any sibling file.

---

## Dimension 2: Prompt Precision

*"Say what you mean. Mean what you say."*

Measures prompt clarity, specificity, and effectiveness.

### 2.1 — One Concern Per Prompt

**Headline**: Your prompt asked for 3 unrelated changes. Consider splitting them.

**Why it matters**: Multi-concern prompts reduce quality on each concern and make it harder to verify individual changes. If one change breaks, you can't easily undo just that part.

**Before**:
```
"Fix the login bug, add dark mode to settings, and update the README"
→ Claude attempts all three, login fix is wrong, dark mode is half-done
→ Undo everything, start over
```

**After**:
```
Prompt 1: "Fix the login bug in src/auth/login.ts — see failing test"
Prompt 2: "Add dark mode toggle to settings following src/theme/types.ts"
Prompt 3: "Update README with the new dark mode feature"
→ Each change is verifiable and independently revertible
```

**Detection**: Single user prompt contains 3+ action verbs (fix, add, update, change, refactor, remove, implement).

---

### 2.2 — Include Verification Criteria

**Headline**: This session had 0 verification steps after 6 edits.

**Why it matters**: Sessions with test/build verification after edits have a 73% lower rework rate. Boris Cherny's #1 insight: "Give Claude a way to verify its work — it will 2-3x the quality of the final result."

**Before**:
```
"Add pagination to the API endpoint"
→ Claude adds pagination, doesn't test it
→ You discover bugs next day
```

**After**:
```
"Add cursor-based pagination to GET /api/users. After implementing,
run `npm test` and also test with:
curl 'localhost:3000/api/users?limit=10&cursor=abc123'
Expected: 200 with next_cursor in response"
→ Claude implements AND verifies. Catches edge case during testing.
```

**Template**: Always end prompts with one of:
```
Then run `npm test` to verify.
Then build with `npm run build` to check for type errors.
Then show me a diff of all changes.
```

**Detection**: Session has 4+ Edit/Write calls with no subsequent Bash call containing test/build/lint/check keywords.

---

### 2.3 — Stop and Rewrite After Two Failed Corrections

**Headline**: You corrected Claude 4 times on the same file. After 2 failures, `/clear` and rewrite.

**Why it matters**: Each failed correction pollutes context with wrong approaches. By the 3rd correction, Claude is confused by conflicting instructions. A clean restart with a better prompt is almost always cheaper.

**Before**:
```
You: "fix the sort order" → wrong
You: "no, sort by date descending" → still wrong
You: "I mean the createdAt field, descending" → partially right
You: "close but the null values should go last" → finally correct
→ Cost: $6.80, 4 prompts wasted
```

**After**:
```
You: "fix the sort order" → wrong
You: "no, sort by date descending" → still wrong
You: /clear
You: "In src/api/users.ts, change the sort on line 47 to order by
     createdAt DESC NULLS LAST. The current sort is by name ASC."
→ Cost: $2.40, clean first-try success
```

**Detection**: 3+ user prompts referencing the same file/topic within a session, with Edit calls between them targeting the same file.

---

### 2.4 — Stop Overspecifying Implementation Steps

**Headline**: Your prompt had 12 numbered steps. Claude often performs better with goals, not scripts.

**Why it matters**: Overly prescriptive prompts constrain Claude's problem-solving. Claude may follow your steps literally even when a better approach exists. State the goal and constraints; let Claude find the path.

**Before**:
```
"1. Open utils.ts 2. Find the formatDate function 3. Change the
format string from 'MM/DD' to 'DD/MM' 4. Save 5. Open tests
6. Update the test expectation 7. Run tests"
→ Claude follows robotically, misses that there's a DATE_FORMAT
  constant used elsewhere
```

**After**:
```
"Change the date format from US (MM/DD) to EU (DD/MM) across the
entire codebase. Check all date formatting, constants, and tests."
→ Claude finds the constant, updates it, fixes all 3 test files
```

**Detection**: User prompt contains 5+ numbered or bulleted steps AND the session uses fewer tool calls than the step count (Claude skipped steps).

---

### 2.5 — Use Esc Early, Not Late

**Headline**: Claude generated 800 tokens of code before you interrupted. Press Esc at the first sign of a wrong direction.

**Why it matters**: Every token Claude generates in the wrong direction adds to context and costs money. Pressing Esc immediately when you see Claude going off-track preserves context and saves tokens. The generated tokens are still in context even after Esc, but you prevent further waste.

**How to do this**:
- **Esc** once: Stop generation (context preserved, you can redirect)
- **Esc twice**: Open checkpoint/rewind menu (undo file changes)
- Watch Claude's first few lines of output — if the approach is wrong, stop immediately

**Detection**: User prompt immediately follows a long assistant response (>500 tokens) and contradicts or corrects the previous direction.

---

## Dimension 3: Tool Craft

*"Use the right tool for the job."*

Measures whether the developer (and Claude) use the most efficient tools for each task.

### 3.1 — Use Dedicated Tools, Not Bash Equivalents

**Headline**: This session used `Bash(cat file.ts)` 3 times. The Read tool is faster and free of permission prompts.

**Why it matters**: Claude Code's dedicated tools (Read, Grep, Glob, Edit) are optimized for permissions, pagination, and context efficiency. Bash equivalents trigger permission prompts, lack pagination, and dump raw output.

**Before**:
```
Bash: cat src/auth/login.ts          → permission prompt, full dump
Bash: grep -r "WebSocket" src/       → permission prompt, raw output
Bash: find . -name "*.test.ts"       → permission prompt, traverses node_modules
Bash: sed -i 's/old/new/' file.ts    → no checkpoint, not tracked by /rewind
```

**After**:
```
Read: src/auth/login.ts              → no prompt, paginated, line numbers
Grep: "WebSocket" path=src/          → no prompt, output modes, head_limit
Glob: **/*.test.ts                   → no prompt, sorted by modification time
Edit: file.ts old="old" new="new"    → tracked, checkpoint, rewindable
```

**Cost difference**: Dedicated tools save ~27% on tokens and eliminate permission friction entirely.

**Detection**: Bash tool calls with commands starting with `cat `, `grep `, `rg `, `find `, `ls `, `head `, `tail `, `sed `.

---

### 3.2 — Use Subagents for Exploration

**Headline**: You ran 8 sequential Read + Grep calls in the main context. An Explore subagent would keep your context clean.

**Why it matters**: Every file read in the main context stays there permanently (until compaction). An Explore subagent reads files in its own context and returns only a summary. For broad codebase searches, this saves 60-80% of context space.

**Before** (context pollution):
```
You: "How does the payment system work?"
→ Claude reads 12 files in main context (48K tokens consumed)
→ Your context is now 50% full with payment code you won't edit
→ Next task triggers compaction, losing context from earlier work
```

**After** (clean context):
```
You: "Use an Explore subagent to investigate how the payment system
     works, then summarize the architecture for me."
→ Subagent reads 12 files in its own context
→ Returns 500-token summary to main context
→ Your context remains clean for the actual work
```

**When to use subagents**:
- Investigating how a system works (5+ files to read)
- Running verbose test suites (output stays in subagent)
- Code review after implementation (fresh eyes)
- Any research that won't directly result in edits

**Detection**: 5+ sequential Read or Grep calls without an intervening Edit, and no Task (subagent) calls in the session.

---

### 3.3 — Use Edit for Surgical Changes, Not Write for Full Rewrites

**Headline**: You used Write to rewrite a 200-line file when only 3 lines changed.

**Why it matters**: The Write tool sends the entire file content as output tokens. For a 200-line file, that's ~2K output tokens ($0.15 at Opus rates) even for a 3-line change. Edit sends only the old and new strings (~100 tokens).

**Before**:
```
Write: src/config.ts (entire 200-line file with 3 lines different)
→ ~2,000 output tokens = ~$0.15
```

**After**:
```
Edit: src/config.ts
  old: "rateLimit: 100"
  new: "rateLimit: 200"
→ ~50 output tokens = ~$0.004
```

**Detection**: Write tool call on a file that was previously Read in the same session, where the file existed before (not a new file creation).

---

### 3.4 — Use Grep Before Building

**Headline**: Claude built a `formatCurrency()` function from scratch. There's one at `src/utils/format.ts:47`.

**Why it matters**: The single most expensive anti-pattern is building from scratch what already exists. A 100-token Grep call can save 70K tokens of reimplementation. Always search before creating.

**Before**:
```
You: "Add currency formatting to the invoice display"
→ Claude writes a new formatCurrency function (500 tokens)
→ Duplicate code, inconsistent formatting
```

**After**:
```
You: "Search for existing currency/money formatting utilities, then
     use them in the invoice display"
→ Claude finds formatCurrency in utils/format.ts
→ Imports and uses existing function (50 tokens)
```

**Detection**: Write tool creates a new function/file whose name or purpose closely matches an existing function elsewhere in the codebase (requires semantic matching or name similarity).

---

### 3.5 — Choose the Right Subagent Type

**Headline**: You used a general-purpose subagent for a read-only investigation. Explore is faster and cheaper.

**Why it matters**: Different subagent types have different tool access and token budgets. Using the right type prevents overhead.

| Task | Best Subagent | Why |
|------|---------------|-----|
| "How does X work?" | **Explore** | Read-only, lightweight, fast |
| "Create an implementation plan" | **Plan** | Research-focused, no edits |
| "Run tests and fix failures" | **Bash** | Shell execution focus |
| "Review this code for bugs" | **code-reviewer** | Specialized review prompts |
| "Refactor and simplify this file" | **code-simplifier** | Focused on clarity |
| "Implement feature X in isolation" | **general-purpose** | Full tool access |

**Detection**: Task tool call with `subagent_type` that doesn't match the task description (e.g., general-purpose for read-only investigation).

---

## Dimension 4: Context Management

*"Your context window is a workspace, not a warehouse."*

Measures how well the developer manages context window capacity and cleanliness.

### 4.1 — Use /clear Between Unrelated Tasks

**Headline**: This session handled 3 unrelated tasks without clearing context. Each task had diminished quality.

**Why it matters**: Context from Task A pollutes Task B. Claude references irrelevant code, makes false connections, and the growing context triggers compaction that loses important details. The `/clear` command costs 0 tokens and gives you a fresh start.

**Rule of thumb**: If the next task doesn't need information from the current task, `/clear`.

**Detection**: Session has 2+ user prompts with different categories (e.g., "bugfix" followed by "feature" followed by "docs") spanning > 50K total tokens.

---

### 4.2 — Watch Your Context Utilization

**Headline**: Your context hit 82% capacity before compaction kicked in.

**Why it matters**: When context approaches the limit, Claude auto-compacts, which:
- Summarizes the conversation (lossy compression)
- May lose user preferences and warnings
- May forget "never do X" instructions
- Costs ~10K tokens for the compaction itself

Staying below 70% capacity prevents surprise compactions and preserves full context fidelity.

**How to do this**:
- Use a custom status line: `/statusline` to add context % to your terminal prompt
- Use subagents for exploration (keeps main context lean)
- `/clear` between tasks
- `/compact Focus on [key aspect]` manually when you choose, not when forced

**Detection**: Session triggers auto-compaction (PreCompact event with `trigger: "auto"`).

---

### 4.3 — Add Custom Compaction Instructions

**Headline**: After compaction, Claude forgot your constraint about not using WebSocket.

**Why it matters**: Default compaction preserves code and architecture but drops user preferences, warnings, and "never do this" instructions. Custom compaction instructions tell Claude what to prioritize.

**Add to CLAUDE.md**:
```markdown
# Compaction instructions
When compacting, always preserve:
- The full list of modified files and their purposes
- All test commands and expected outputs
- User constraints (things NOT to do)
- Current implementation status and next steps
```

**Or run manually**: `/compact Preserve my constraint about avoiding WebSocket and the list of files we've modified`

**Detection**: Session has repeated work (same Edit targets) after a compaction event, suggesting lost context.

---

### 4.4 — Keep CLAUDE.md Under 500 Lines

**Headline**: Your CLAUDE.md is 847 lines. Claude is spending ~40K tokens loading it every session.

**Why it matters**: CLAUDE.md loads into every session's context. At 847 lines, that's ~40K tokens — 20% of your context window consumed before you type anything. The test for every line: "Would removing this cause Claude to make a mistake?" If not, cut it.

**What to keep**: Build commands, code style deviations from defaults, project-specific gotchas, testing instructions
**What to cut**: Standard conventions Claude already knows, file-by-file descriptions, tutorials, API docs (link instead)
**What to move**: Specialized instructions → `.claude/commands/` (loaded on demand)

**Detection**: CLAUDE.md file size exceeds ~500 lines (via session_start event's cwd + file size check).

---

### 4.5 — Use /rewind Instead of Correction Chains

**Headline**: You corrected Claude 3 times. `/rewind` restores the checkpoint and lets you start the approach fresh.

**Why it matters**: Corrections add failed approaches to context, confusing future attempts. `/rewind` (Esc + Esc) restores file state to a checkpoint without polluting context. You can rewind code only, conversation only, or both.

**How to do this**:
- Press `Esc` once to stop generation
- Press `Esc` again to open the rewind menu
- Select a checkpoint to restore to
- Write a better prompt without the failed context

**Detection**: 3+ user prompts that reference the same file with correction language ("no", "that's wrong", "undo", "revert").

---

## Dimension 5: Cost Efficiency

*"Spend tokens where they matter."*

Measures whether tokens and dollars are spent on productive work vs. waste.

### 5.1 — Switch Models for Different Phases

**Headline**: You used Opus ($15/MTok) for 23 file reads. Haiku ($0.80/MTok) handles exploration just as well.

**Why it matters**: Model costs differ by 19x between Opus and Haiku. Most sessions have distinct phases: exploration (reading, searching), implementation (editing, writing), and verification (testing). Only implementation needs the most capable model.

**Strategy**:
```
Exploration: /model haiku     — reading files, searching code
Planning:    /model sonnet    — designing approach
Implementation: /model opus   — complex edits, architecture
Verification: /model sonnet   — running tests, reviewing
```

**Potential savings**: 60-87% cost reduction using model cascading.

**Detection**: Session uses a single model (Opus) throughout, with > 10 Read/Grep/Glob calls (exploration phase not optimized).

---

### 5.2 — Minimize MCP Tool Count

**Headline**: You have 14 MCP servers active, consuming 144K tokens of context (41% of your window).

**Why it matters**: Each MCP server's tool definitions load into context even when idle. One user reported 144K tokens from MCP tools alone. Claude Code enables Tool Search when tools exceed 10% of context, reducing this by ~47%, but the best fix is fewer MCPs.

**How to fix**:
- Prefer CLI tools over MCP servers: `gh` instead of GitHub MCP, `aws` instead of AWS MCP
- Disable unused MCP servers: `/mcp` to manage
- Run `/context` to audit what's consuming space
- Keep stateful MCPs (Playwright); migrate stateless ones to CLI

**The 10/80 Rule**: Keep under 10 MCPs and 80 total tools.

**Detection**: SessionStart event shows high base context utilization (>30%) before any user interaction.

---

### 5.3 — Test Incrementally, Not After Everything

**Headline**: You generated 12 files before running tests. Test after each file for 92% token savings.

**Why it matters**: The most expensive pattern: build N modules → test → failure → massive debug session. Testing after each change catches errors when context is fresh and fixes are cheap.

**Before**:
```
Build 12 modules → Run tests → 5 failures → 50K token debug session
Total: ~80K tokens
```

**After**:
```
Module 1 → Test → Pass
Module 2 → Test → Pass
Module 3 → Test → Fail → Fix (2K tokens) → Pass
...
Total: ~10K tokens (87% savings)
```

**Detection**: Session has 5+ consecutive Write/Edit calls without any Bash call containing test/build/check keywords.

---

### 5.4 — Avoid Editing Large Files

**Headline**: You edited a 2,100-line file. Files over 1,000 lines have a 20% success rate on first edit.

**Why it matters**: Large file edits are expensive because: (1) Claude must read the full file into context, (2) the `old_string` match is harder to get right, (3) retries multiply the cost. Files of 100-300 lines have 85% first-edit success.

**How to fix**: If you're repeatedly editing a large file, ask Claude to break it into smaller modules first. This is an investment that pays off quickly.

**Detection**: Edit tool call on a file where the prior Read returned > 1000 lines.

---

### 5.5 — Reduce Extended Thinking for Simple Tasks

**Headline**: Claude spent 24K thinking tokens ($0.60 at Opus) on a simple rename. Lower thinking budget for routine tasks.

**Why it matters**: Extended thinking (enabled by default at 31,999 tokens) is billed as output tokens. For complex reasoning it's invaluable, but for simple edits it's pure waste.

**How to adjust**:
- `/model` → adjust effort level
- Set `MAX_THINKING_TOKENS=8000` for routine sessions
- Disable thinking entirely in `/config` for batch-edit sessions

**Detection**: Session where thinking tokens > 50% of total output tokens AND task category is simple (rename, format, add comment).

---

## Dimension 6: Verification & Quality

*"Trust, but verify."*

Measures whether changes are validated before being considered done.

### 6.1 — Run Tests After Every Edit Batch

**Headline**: You made 6 edits without running tests. Sessions with verification have 73% lower rework.

**Why it matters**: Boris Cherny's single most important insight: "Give Claude a way to verify its work — it will 2-3x the quality." Verification isn't optional; it's the highest-leverage practice in AI-assisted coding.

**Template**: Always end implementation prompts with:
```
After making the changes, run `npm test` to verify nothing is broken.
If tests fail, fix them.
```

**Advanced — Hook-based auto-verification**:
```json
{
  "hooks": {
    "PostToolUse": [{
      "matcher": "Write|Edit",
      "hooks": [{
        "type": "command",
        "command": "npm run lint -- --fix || true"
      }]
    }]
  }
}
```

**Detection**: 4+ Edit/Write calls with no subsequent Bash call matching test/build/lint/check/verify patterns.

---

### 6.2 — Use a Separate Reviewer Subagent

**Headline**: Consider having a code-reviewer subagent check this implementation.

**Why it matters**: Asking Claude to review its own code is "marking its own homework." A fresh subagent with a clean context provides genuine review without the sunk-cost bias of the implementing agent.

**Template**:
```
Use a code-reviewer subagent to review the changes I just made.
Focus on: edge cases, error handling, security, and consistency
with existing patterns.
```

**Or create a custom agent** at `.claude/agents/reviewer.md`:
```markdown
---
name: security-reviewer
description: Reviews code for security vulnerabilities
tools: Read, Grep, Glob
model: opus
---
You are a senior security engineer. Review code for OWASP top 10,
injection flaws, auth bypass, and data exposure. Provide specific
line references and suggested fixes.
```

**Detection**: Session with 5+ Edit calls and no subsequent Task call with "review" in the description.

---

### 6.3 — Use the Writer/Reviewer Pattern for Critical Code

**Headline**: This is authentication code. Consider the Writer/Reviewer pattern for high-stakes changes.

**Why it matters**: For security-sensitive or business-critical code, use two separate Claude sessions: one to write, one to review. The reviewer has fresh context and no commitment to the implementation.

**Workflow**:
```
Session A: "Implement rate limiting for the login endpoint"
→ Claude implements

Session B: "Review the rate limiter at src/middleware/rateLimit.ts.
Look for: bypass vectors, race conditions, Redis failure modes,
and consistency with our existing middleware."
→ Claude reviews, finds edge case

Session A: "Here's the review feedback: [paste]. Address issues #1 and #3."
→ Claude fixes
```

**Detection**: Edit calls to files matching `auth*`, `login*`, `*password*`, `*token*`, `*secret*`, `*payment*`, `*billing*` without a subsequent review subagent.

---

### 6.4 — Set Up Hook-Based Quality Gates

**Headline**: Automate verification with hooks so quality checks happen on every edit, not just when you remember.

**Why it matters**: Hooks are deterministic — they run every time, unlike CLAUDE.md instructions which are advisory. A formatting hook ensures consistent code style. A pre-commit hook ensures tests pass before commit.

**Auto-format on every edit**:
```json
{
  "hooks": {
    "PostToolUse": [{
      "matcher": "Write|Edit",
      "hooks": [{
        "type": "command",
        "command": "npx prettier --write $CLAUDE_FILE_PATH || true"
      }]
    }]
  }
}
```

**Block commits without passing tests**:
```json
{
  "hooks": {
    "PreToolUse": [{
      "matcher": "Bash",
      "hooks": [{
        "type": "command",
        "command": "if echo $CLAUDE_TOOL_INPUT | grep -q 'git commit'; then npm test || exit 1; fi"
      }]
    }]
  }
}
```

**Detection**: No hook events in session AND session has commits.

---

## Dimension 7: Session Strategy

*"Work with the grain, not against it."*

Measures overall session structure, flow, and recovery patterns.

### 7.1 — One Task Per Session

**Headline**: This session handled 4 unrelated tasks. Consider one task per session for better results.

**Why it matters**: Multi-task sessions ("kitchen sink sessions") fill context with irrelevant information, trigger compaction, and reduce quality on each task. Think of sessions like git branches: one purpose, clean scope.

**Detection**: Session has 3+ user prompts with different auto-classified categories (e.g., feature → bugfix → docs → config).

---

### 7.2 — Use /continue and /resume for Multi-Day Work

**Headline**: You started a fresh session but this looks like yesterday's unfinished work.

**Why it matters**: Starting fresh means re-establishing all context. `claude --continue` resumes exactly where you left off. `claude --resume` lets you pick from recent sessions.

**How to do this**:
```bash
claude --continue          # Resume last session
claude --resume            # Pick from recent sessions
```

**Detection**: New SessionStart where the first user prompt references files/topics from a recent prior session (same cwd).

---

### 7.3 — Recognize and Break Frustration Loops

**Headline**: Slow down. You've sent 5 prompts in 3 minutes with increasing length — a common frustration pattern.

**Why it matters**: When things go wrong, developers tend to send rapid, increasingly detailed corrections. This fills context with failed approaches and conflicting instructions. The fix is always the same: stop, clear, rewrite.

**Signs of frustration** (detected from event stream):
- Time between prompts decreasing (< 30 seconds)
- Prompt length increasing across consecutive prompts
- Error rate spiking (3+ tool errors in 5 calls)
- Session exceeding personal average duration without commits
- Edit → Undo → Edit patterns

**How to recover**:
1. Press `Esc` to stop current generation
2. Take a breath (seriously — 30 seconds of thinking saves 30 minutes)
3. `/clear` to wipe the polluted context
4. Write one clean, specific prompt incorporating what you learned
5. If still stuck, write your understanding to a file and start a completely fresh session

**Detection**: 3+ user prompts within 120 seconds with average length increasing by > 50% between each.

---

### 7.4 — Write a HANDOFF.md for Complex Multi-Session Work

**Headline**: This task spans 3 sessions. Consider a handoff document for cross-session continuity.

**Why it matters**: Context doesn't survive between sessions (even with `--continue`, compaction may have occurred). For multi-session projects, a HANDOFF.md preserves intent, progress, and decisions.

**Template**:
```markdown
# HANDOFF.md — [Feature Name]

## Goal
[What we're building and why]

## Progress
- [x] Step 1: Set up database schema
- [x] Step 2: Implement API endpoints
- [ ] Step 3: Add frontend components
- [ ] Step 4: Write tests

## Key Decisions
- Using cursor-based pagination (not offset-based) — see RFC in docs/
- JWT stored in httpOnly cookies, not localStorage

## Files Modified
- src/db/schema.ts — new users table
- src/api/users.ts — CRUD endpoints

## What Didn't Work
- Tried using Redis for sessions but it added complexity without benefit
- The existing auth middleware doesn't support refresh tokens (need to extend)

## Next Session Should
- Start by reading this file and src/api/users.ts
- Implement the React components in src/components/users/
```

**Detection**: Session ends with unfinished todo items AND a new session starts in the same cwd within 24 hours.

---

### 7.5 — Use Git Worktrees for Parallel Work

**Headline**: You have 2 features in progress in the same checkout. Consider git worktrees for isolation.

**Why it matters**: Multiple Claude sessions editing the same files cause conflicts. Git worktrees give each session its own working directory while sharing git history.

**How to do this**:
```bash
git worktree add ../project-feature-a -b feature-a
cd ../project-feature-a
claude   # Isolated session for feature A
```

**When to use**: When you want to work on 2+ independent features simultaneously, or when you want to keep main clean while exploring.

**Detection**: Multiple concurrent sessions (same sessionId range/cwd) with overlapping Edit targets.

---

## Dimension 8: CLAUDE.md & Configuration

*"Invest in your setup. It pays dividends every session."*

Measures the quality of the developer's Claude Code configuration.

### 8.1 — Add a CLAUDE.md to Your Project

**Headline**: This project has no CLAUDE.md. Adding one reduces incorrect assumptions by ~60%.

**Why it matters**: Without a CLAUDE.md, Claude guesses at conventions, build commands, and test runners. With one, Claude follows your project's specific patterns from the first prompt.

**Starter template**:
```markdown
# Project: [Name]

## Build & Test
- Build: `pnpm build`
- Test: `pnpm test`
- Lint: `pnpm lint`

## Code Style
- [List deviations from standard that Claude gets wrong]
- Example: "Use ES modules, not CommonJS"

## Architecture
- [Key architectural decisions Claude needs to know]
- Example: "API routes in src/routes/, services in src/services/"

## Gotchas
- [Non-obvious behaviors that trip up Claude]
- Example: "The DB connection is async — always await initDb()"
```

**Detection**: SessionStart event in a cwd that has no CLAUDE.md file.

---

### 8.2 — Use Hooks for Deterministic Rules

**Headline**: Your CLAUDE.md says "always run prettier" but Claude skipped it twice. Use a hook instead.

**Why it matters**: CLAUDE.md instructions are advisory — Claude follows them most of the time but may skip them under pressure or after compaction. Hooks are deterministic — they execute every time, guaranteed.

**When to use CLAUDE.md**: Guidelines, preferences, conventions
**When to use hooks**: Rules that MUST happen (formatting, linting, test gates)

**Detection**: CLAUDE.md contains words like "always", "must", "never" for actions that could be automated with hooks, and the session shows violations.

---

### 8.3 — Create Custom Slash Commands for Repetitive Workflows

**Headline**: You've run the same 3-step workflow 4 times this week. Save it as a slash command.

**Why it matters**: Slash commands (stored in `.claude/commands/`) are loaded on demand and provide consistent, token-efficient execution of repetitive workflows.

**Example** — `.claude/commands/pr.md`:
```markdown
Review all changes, ensure tests pass, then create a PR:
1. Run `git diff main...HEAD` to see all changes
2. Run the full test suite
3. Create a PR with a clear title and description
4. Include a test plan in the PR body
```

**Usage**: Just type `/pr` in Claude Code.

**Detection**: Session has 3+ nearly identical prompt sequences across different sessions (same cwd).

---

### 8.4 — Configure Extended Thinking Appropriately

**Headline**: Your thinking budget is 31,999 tokens but average thinking usage is 4,200. Consider lowering it for routine work.

**Why it matters**: The thinking budget reserves context space even when not fully used. A 32K thinking budget in a 200K context means 16% is reserved for thinking. For routine editing sessions, 8K is usually sufficient.

**How to adjust**:
- `/model` → change effort level
- Set `MAX_THINKING_TOKENS=8000` in environment for routine sessions
- Keep high (32K) for complex architecture and debugging sessions

**Detection**: Average `thinkingLength` across session turns is < 25% of the configured thinking budget.

---

### 8.5 — Set Up a Status Line for Context Awareness

**Headline**: Add a status line to monitor context, cost, and model in real-time.

**Why it matters**: Most developers have no visibility into context utilization until compaction hits. A status line shows model, branch, token usage, and cost in your terminal prompt — like a car's fuel gauge.

**How to do this**:
```bash
claude /statusline   # Auto-generate a status line script
```

Or create a custom script showing: model name, git branch, context %, session cost.

**Detection**: Session triggers auto-compaction without prior manual compaction or /clear (suggests developer wasn't monitoring context).

---

## Detection Signal Summary

| Signal in Event Stream | Insight Triggered |
|---|---|
| Edit fails → Read same file → Edit succeeds | 1.2 Read Before Edit |
| First prompt < 20 words, then 5+ Read/Grep | 1.3 Front-Load Context |
| 3+ action verbs in single prompt | 2.1 One Concern Per Prompt |
| 4+ Edit with no test Bash | 2.2 Verification Criteria / 6.1 Test After Edits |
| 3+ corrections on same file | 2.3 Stop and Rewrite |
| Bash(cat/grep/find/sed) calls | 3.1 Dedicated Tools |
| 5+ Read/Grep without Edit | 3.2 Use Subagents |
| Write on previously-Read file | 3.3 Edit vs Write |
| New function matching existing name | 3.4 Grep Before Building |
| 3+ unrelated task categories | 4.1 /clear Between Tasks |
| Auto-compaction event | 4.2 Context Utilization |
| Same edits after compaction | 4.3 Custom Compaction |
| Single model for Read-heavy session | 5.1 Model Switching |
| 5+ consecutive Write without test | 5.3 Test Incrementally |
| Edit on 1000+ line file | 5.4 Large File Editing |
| No review subagent after 5+ edits | 6.2 Reviewer Subagent |
| Prompt frequency < 30s, length increasing | 7.3 Frustration Loop |
| No CLAUDE.md in cwd | 8.1 Add CLAUDE.md |
| CLAUDE.md > 500 lines | 4.4 Keep CLAUDE.md Lean |
