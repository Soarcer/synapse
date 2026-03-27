# VS Code Agent-Scoped Hooks — Research Document

**Date:** 2026-03-13
**Status:** Research
**Feature:** Agent-scoped hooks (Preview)
**Setting:** `chat.useCustomAgentHooks`
**Source:** [VS Code Agent Hooks Documentation](https://code.visualstudio.com/docs/copilot/customization/hooks)

---

## Overview

VS Code 1.100+ introduces **agent-scoped hooks** — shell commands defined directly in `.agent.md` YAML frontmatter that fire only when that specific custom agent is active (user-selected or invoked via `runSubagent`). This extends the existing workspace/user hook system with per-agent isolation.

Previously, hooks could only be defined at workspace level (`.github/hooks/*.json`, `.claude/settings.json`) or user level (`~/.claude/settings.json`), meaning they fired for every agent interaction. Agent-scoped hooks add a targeted layer that stacks on top of workspace/user hooks.

---

## Hook File Locations (Search Order)

| Scope              | Location                                               | When it fires                      |
| ------------------ | ------------------------------------------------------ | ---------------------------------- |
| User               | `~/.claude/settings.json`                              | Any agent, any workspace           |
| Workspace (Claude) | `.claude/settings.json`, `.claude/settings.local.json` | Any agent in this workspace        |
| Workspace          | `.github/hooks/*.json`                                 | Any agent in this workspace        |
| **Agent-scoped**   | `hooks:` in `.agent.md` frontmatter                    | **Only when this agent is active** |

Agent-scoped hooks run **in addition to** workspace/user hooks — they stack, not replace.

Custom hook file locations can be controlled via:

```json
"chat.hookFilesLocations": {
  ".github/hooks": true,
  ".claude/settings.json": false,
  "~/my-hooks/security.json": true
}
```

---

## Agent-Scoped Hook Format

### `.agent.md` Frontmatter Example

```yaml
---
name: 'Strict Formatter'
description: 'Agent that auto-formats code after every edit'
hooks:
  PostToolUse:
    - type: command
      command: './scripts/format-changed-files.sh'
      windows: "powershell -File scripts\\format-changed-files.ps1"
      timeout: 30
  SessionStart:
    - type: command
      command: './scripts/inject-context.sh'
      env:
        PROJECT_NAME: 'my-app'
---
You are a code editing agent. After making changes, files are automatically formatted.
```

### Hook Command Properties

| Property  | Type   | Description                                  |
| --------- | ------ | -------------------------------------------- |
| `type`    | string | Must be `"command"`                          |
| `command` | string | Default command (cross-platform fallback)    |
| `windows` | string | Windows-specific override                    |
| `linux`   | string | Linux-specific override                      |
| `osx`     | string | macOS-specific override                      |
| `cwd`     | string | Working directory (relative to repo root)    |
| `env`     | object | Additional environment variables (key-value) |
| `timeout` | number | Seconds before timeout (default: 30)         |

> **Note:** OS-specific commands are selected based on the **extension host** platform. In remote development scenarios (SSH, Containers, WSL), this might differ from the local OS.

---

## The 8 Lifecycle Events

### Common Input (stdin, all events)

```json
{
  "timestamp": "2026-02-09T10:30:00.000Z",
  "cwd": "/path/to/workspace",
  "sessionId": "session-identifier",
  "hookEventName": "PreToolUse",
  "transcript_path": "/path/to/transcript.json"
}
```

### Common Output (stdout, all events)

```json
{
  "continue": true,
  "stopReason": "string",
  "systemMessage": "string"
}
```

| Field           | Type    | Description                                                |
| --------------- | ------- | ---------------------------------------------------------- |
| `continue`      | boolean | `false` stops entire session (default: `true`)             |
| `stopReason`    | string  | Shown to user when `continue` is `false`                   |
| `systemMessage` | string  | Warning displayed in chat UI regardless of other decisions |

### Exit Code Behavior

| Exit Code | Behavior                                                |
| --------- | ------------------------------------------------------- |
| `0`       | Success — parse stdout as JSON                          |
| `2`       | Blocking error — stop processing, stderr shown to model |
| Other     | Non-blocking warning — shown to user, continue          |

---

### 1. `SessionStart`

**Fires:** When new agent session begins.

**Extra input:**

```json
{ "source": "new" }
```

**Extra output:**

```json
{
  "hookSpecificOutput": {
    "hookEventName": "SessionStart",
    "additionalContext": "Project: my-app v2.1.0 | Branch: main | Node: v20.11.0"
  }
}
```

`additionalContext` is injected into the agent's conversation as model context.

---

### 2. `UserPromptSubmit`

**Fires:** When user submits a prompt.

**Extra input:**

```json
{ "prompt": "user's submitted text" }
```

**Extra output:** Common format only.

---

### 3. `PreToolUse` (the power hook)

**Fires:** Before agent invokes any tool.

**Extra input:**

```json
{
  "tool_name": "editFiles",
  "tool_input": { "files": ["src/main.ts"] },
  "tool_use_id": "tool-123"
}
```

**Extra output:**

```json
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "allow|deny|ask",
    "permissionDecisionReason": "Destructive command blocked by security policy",
    "updatedInput": { "files": ["src/safe.ts"] },
    "additionalContext": "User has read-only access to production files"
  }
}
```

| Field                      | Values                       | Description                                                                 |
| -------------------------- | ---------------------------- | --------------------------------------------------------------------------- |
| `permissionDecision`       | `"allow"`, `"deny"`, `"ask"` | Controls tool approval                                                      |
| `permissionDecisionReason` | string                       | Reason shown to user                                                        |
| `updatedInput`             | object                       | Modified tool input — must match tool's expected schema or silently ignored |
| `additionalContext`        | string                       | Extra context for the model                                                 |

**Permission decision priority** (most restrictive wins when multiple hooks run):

1. `deny` — blocks tool execution
2. `ask` — requires user confirmation
3. `allow` — auto-approves

---

### 4. `PostToolUse`

**Fires:** After tool completes successfully.

**Extra input:**

```json
{
  "tool_name": "editFiles",
  "tool_input": { "files": ["src/main.ts"] },
  "tool_use_id": "tool-123",
  "tool_response": "File edited successfully"
}
```

**Extra output:**

```json
{
  "decision": "block",
  "reason": "Post-processing validation failed",
  "hookSpecificOutput": {
    "hookEventName": "PostToolUse",
    "additionalContext": "The edited file has lint errors that need to be fixed"
  }
}
```

`decision: "block"` prevents further processing of this tool result without stopping the entire session. The reason is shown to the model as context.

---

### 5. `PreCompact`

**Fires:** Before conversation context is compacted (auto-triggered when conversation is too long).

**Extra input:**

```json
{ "trigger": "auto" }
```

**Extra output:** Common format only.

---

### 6. `SubagentStart`

**Fires:** When a subagent is spawned.

**Extra input:**

```json
{
  "agent_id": "subagent-456",
  "agent_type": "Plan"
}
```

**Extra output:**

```json
{
  "hookSpecificOutput": {
    "hookEventName": "SubagentStart",
    "additionalContext": "This subagent should follow the project coding guidelines"
  }
}
```

---

### 7. `SubagentStop`

**Fires:** When a subagent completes.

**Extra input:**

```json
{
  "agent_id": "subagent-456",
  "agent_type": "Plan",
  "stop_hook_active": false
}
```

**Extra output:**

```json
{
  "decision": "block",
  "reason": "Verify subagent results before completing"
}
```

`decision: "block"` prevents the subagent from stopping (forces it to continue). **Must check `stop_hook_active`** to prevent infinite loops.

---

### 8. `Stop`

**Fires:** When agent session ends.

**Extra input:**

```json
{ "stop_hook_active": false }
```

**Extra output:**

```json
{
  "hookSpecificOutput": {
    "hookEventName": "Stop",
    "decision": "block",
    "reason": "Run the test suite before finishing"
  }
}
```

> **Important:** When scoped to a custom agent, `Stop` also acts as `SubagentStop`. Blocking consumes premium requests. Always check `stop_hook_active` to avoid infinite loops.

---

## Control Mechanism Priority

When a hook returns multiple control signals, the most restrictive wins:

```
continue: false  >  permissionDecision: deny  >  decision: block  >  ask  >  allow
(kill session)      (block one tool call)        (block one result)
```

---

## Claude Code vs VS Code Hook Differences

| Aspect                    | Claude Code                 | VS Code                                                       |
| ------------------------- | --------------------------- | ------------------------------------------------------------- |
| Tool input property names | `snake_case` (`file_path`)  | `camelCase` (`filePath`)                                      |
| Tool names                | `Write`, `Edit`, `Bash`     | `create_file`, `replace_string_in_file`, `runTerminalCommand` |
| Matchers                  | Respected (`"Edit\|Write"`) | **Parsed but ignored** — hooks run for all tools              |
| Event name casing         | `PascalCase`                | `PascalCase` (Copilot CLI `camelCase` auto-converted)         |

This means a hook script that works in Claude Code may need adjustments for VS Code (different tool names and property casing).

---

## Safety Considerations

- If the agent can edit hook scripts, it can modify and execute its own code. Recommend disabling `chat.tools.edits.autoApprove` for hook script files.
- Hook scripts execute with the same permissions as VS Code.
- Review all hook scripts before enabling, especially from untrusted sources.
- Never hardcode secrets in hook scripts — use environment variables or secure credential storage.
- Validate and sanitize all input in hook scripts to prevent injection attacks.

---

## Diagnostics & Troubleshooting

- **View loaded hooks:** VS Code Output panel → look for "Load Hooks" log entries.
- **View hook execution:** Output panel → select "GitHub Copilot Chat Hooks" channel.
- **Common issues:**
  - Hook not executing → verify file is in `.github/hooks/` with `.json` extension, `type` is `"command"`
  - Permission denied → `chmod +x script.sh`
  - Timeout → increase `timeout` value (default: 30s)
  - JSON parse errors → ensure hook outputs valid JSON to stdout

---

## Relevance to Synapse

### What Synapse Does Today

Synapse uses workspace-level Claude Code hooks (`.claude/settings.json`) to observe all Claude Code sessions:

- `hooks/send_event.cjs` fires on every lifecycle event
- Events POST to `localhost:27246/api/events`
- Dashboard visualizes sessions, tools, agents in real-time

### Opportunities with Agent-Scoped Hooks

#### 1. Self-Registering Agent Files

Ship `.agent.md` files that carry their own Synapse telemetry. Users drop an agent file into any project — it automatically phones home to Synapse. No workspace hook setup needed.

```yaml
---
name: 'Synapse-Monitored Coder'
hooks:
  SessionStart:
    - type: command
      command: 'node ./hooks/synapse-register.cjs'
  PreToolUse:
    - type: command
      command: 'node ./hooks/synapse-pre-tool.cjs'
  PostToolUse:
    - type: command
      command: 'node ./hooks/synapse-post-tool.cjs'
  Stop:
    - type: command
      command: 'node ./hooks/synapse-session-end.cjs'
---
```

#### 2. Active Policy Enforcement via `PreToolUse`

Transform Synapse from passive observer to active control plane:

- Hook calls `POST /api/policy-check` with tool name and input
- Synapse evaluates per-agent rules defined in the dashboard
- Returns `allow`/`deny`/`ask` with `permissionDecisionReason`
- Dashboard shows real-time policy decisions

#### 3. Context Injection via `SessionStart.additionalContext`

Hook queries Synapse for project health context:

- Recent errors, active sessions, cost budgets
- Injected as model context at session start
- Agent "knows" about the project state before the user says anything

#### 4. Tool Input Rewriting via `updatedInput`

Agent-specific tool argument transforms:

- A "Safe Deploy" agent that adds `--dry-run` to terminal commands
- A "Read-Only Reviewer" agent that blocks write operations
- A "Cost-Aware" agent that limits model selection or token counts

#### 5. Completion Enforcement via `Stop` Hook

Agent-scoped `Stop` hook calls Synapse to verify:

- All required tests passed
- Cost budget not exceeded
- Required review steps completed
- If criteria unmet, blocks session end with reason

#### 6. Transcript Analysis via `transcript_path`

Every hook receives `transcript_path` — path to full conversation JSON:

- Synapse could ingest full transcripts for deeper analysis
- Pattern detection, coaching, anomaly detection across sessions
- Much richer than individual event-level data

#### 7. Subagent Monitoring

`SubagentStart` and `SubagentStop` hooks enable:

- Real-time subagent tree visualization (already in Synapse's graph)
- Context injection into subagents via `additionalContext`
- Blocking subagents that exceed cost/time budgets

### Key Architectural Consideration

Agent-scoped hooks stack with workspace hooks. If Synapse already has workspace-level hooks for telemetry, agent-scoped hooks should avoid duplicating those events. Use agent-scoped hooks for **agent-specific behavior** (policy, context injection, input rewriting) and keep workspace hooks for **universal telemetry**.

---

## References

- [VS Code Agent Hooks Documentation](https://code.visualstudio.com/docs/copilot/customization/hooks)
- [VS Code Custom Agents](https://code.visualstudio.com/docs/copilot/customization/custom-agents)
- [VS Code Subagents](https://code.visualstudio.com/docs/copilot/agents/subagents)
- [GitHub vscode-docs source (hooks.md)](https://github.com/microsoft/vscode-docs/blob/main/docs/copilot/customization/hooks.md)
