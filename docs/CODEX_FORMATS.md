# OpenAI Codex CLI — File Formats & Extensibility Reference

**Last Updated:** 2026-02-10
**Purpose:** Technical reference for integrating Codex CLI session data into Synapse dashboard

---

## Table of Contents

1. [Overview](#overview)
2. [Session Files (rollout-*.jsonl)](#session-files-rollout-jsonl)
3. [History.jsonl Format](#historyjsonl-format)
4. [Notify Hook System](#notify-hook-system)
5. [Hooks System (Unmerged PRs)](#hooks-system-unmerged-prs)
6. [--json JSONL Stream](#json-jsonl-stream)
7. [MCP Wire Protocol](#mcp-wire-protocol)
8. [Config.toml Structure](#configtoml-structure)
9. [Schema Generation](#schema-generation)
10. [Implementation Notes](#implementation-notes)

---

## Overview

OpenAI's Codex CLI stores session data in JSONL (JSON Lines) format across multiple locations:

- **Session files**: `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl` — full conversation history per session
- **History file**: `~/.codex/history.jsonl` — consolidated session transcripts (optional)
- **Live stream**: `codex exec --json` — real-time JSONL event stream to stdout
- **MCP protocol**: `codex mcp-server` — bidirectional JSON-RPC over stdio

**Key Difference from Claude Code:**
- Codex uses `rollout-*.jsonl` files organized by date hierarchy
- Claude Code uses flat `~/.claudecode/sessions/*.jsonl` files
- Both use similar event-driven JSONL schemas but with different field names

---

## Session Files (rollout-*.jsonl)

### File Location

```
~/.codex/sessions/YYYY/MM/DD/rollout-<uuid>.jsonl
```

Example:
```
~/.codex/sessions/2026/02/10/rollout-0199a213-81c0-7800-8aa1-bbab2a035a53.jsonl
```

### File Structure

Each line is a separate JSON object representing a session event. The file contains:

1. **Metadata header** — session info (ID, timestamp, model provider)
2. **Event stream** — user turns, agent responses, tool calls, errors

### Event Types

Based on community parsing tools and documentation:

#### 1. State Records (Metadata)

```json
{
  "record_type": "state",
  "timestamp": "2026-02-10T14:23:45.123Z",
  "session_id": "0199a213-81c0-7800-8aa1-bbab2a035a53",
  "model": "gpt-4o",
  "cwd": "/Users/user/project"
}
```

#### 2. User Messages

```json
{
  "type": "event_msg",
  "payload": {
    "type": "user_message",
    "message": "Add a dark mode toggle to the settings page",
    "images": []
  }
}
```

**Alternative structure** (based on codex-history-list parser):

```json
{
  "type": "message",
  "role": "user",
  "content": [
    {
      "type": "input_text",
      "text": "Add a dark mode toggle"
    }
  ]
}
```

or simply:

```json
{
  "type": "message",
  "role": "user",
  "content": "Add a dark mode toggle"
}
```

#### 3. Assistant Messages

```json
{
  "type": "response_item",
  "payload": {
    "type": "message",
    "role": "assistant",
    "content": [
      {
        "type": "input_text",
        "text": "I'll add a dark mode toggle to your settings page..."
      }
    ]
  }
}
```

#### 4. Token Count Events

```json
{
  "type": "event_msg",
  "payload": {
    "type": "token_count",
    "input_tokens": 24763,
    "cached_input_tokens": 24448,
    "output_tokens": 122,
    "reasoning_tokens": 0,
    "total_tokens": 24885
  }
}
```

**Note:** Each token_count event reports **cumulative totals**. Subtract previous totals to get per-turn deltas.

#### 5. Turn Context

```json
{
  "type": "event_msg",
  "payload": {
    "type": "turn_context",
    "model": "gpt-4o",
    "approval_policy": "never",
    "sandbox_policy": {
      "mode": "danger-full-access"
    }
  }
}
```

**Usage Detection:** Check if `approval_policy == "never"` or `sandbox_policy.mode == "danger-full-access"` to detect "yolo mode".

#### 6. Environment Context (User Messages)

User messages may include environment context wrapped in XML-like tags:

```json
{
  "type": "message",
  "role": "user",
  "content": "<environment_context>\n<cwd>/Users/user/project</cwd>\n<shell>bash</shell>\n</environment_context>\n\nAdd dark mode toggle"
}
```

**Parsing:** Extract `<cwd>` from environment context to identify project directory.

### Resumption Behavior

When resuming a session with `codex --resume <session-id>`, Codex **appends new events to the existing rollout file** rather than creating a new session file.

---

## History.jsonl Format

### File Location

```
~/.codex/history.jsonl
```

### Purpose

Consolidated session transcripts for historical analysis. May be the same as session files or a separate aggregated view.

### Configuration

```toml
[history]
persistence = "save-all"  # or "none"
max_bytes = 5242880       # Optional: trim oldest entries when exceeded (5MB example)
```

**Size Management:** When `max_bytes` is exceeded, Codex drops oldest entries and compacts the file.

### Schema

Based on available documentation, history.jsonl uses the same event schema as session files. Each line represents an event from any session.

**Note:** The exact distinction between `history.jsonl` and `sessions/rollout-*.jsonl` is not well-documented. They may be redundant or serve different purposes (archival vs. active sessions).

---

## Notify Hook System

### Overview

Codex can invoke an external command when specific events occur (currently only `agent-turn-complete`).

### Configuration

```toml
# config.toml
notify = ["notify-send", "Codex"]
```

**Format:** Array of strings representing the command and its initial arguments.

### Invocation

Codex appends a JSON payload as the **final command-line argument** (NOT stdin):

```bash
notify-send Codex '{"type":"agent-turn-complete","turn-id":"12345",...}'
```

### JSON Payload Schema

**Current Implementation (as of 2026):**

```json
{
  "type": "agent-turn-complete",
  "thread-id": "session-uuid",
  "turn-id": "12345",
  "cwd": "/Users/user/project",
  "input-messages": [
    "Rename `foo` to `bar` and update the callsites."
  ],
  "last-assistant-message": "Rename complete and verified `cargo build` succeeds."
}
```

**Extended Fields (from Issue #4005, partially implemented):**

```json
{
  "type": "agent-turn-complete",
  "turn-id": "12345",
  "thread-id": "session-uuid",
  "cwd": "/Users/user/Developer/test",
  "approval_policy": "never",
  "network_access": "enabled",
  "sandbox_mode": "danger-full-access",
  "shell": "bash",
  "input-messages": ["Rename `foo` to `bar`"],
  "last-assistant-message": "Rename complete."
}
```

**Status:** Issue #4005 requested full environment context but was closed as "not planned". A collaborator noted that `cwd` support was added.

### Supported Events

Currently only:
- `agent-turn-complete`

Future events were requested but not implemented (approval prompts, file saves, etc.).

### Example Python Hook

```python
#!/usr/bin/env python3
import sys
import json

# Parse JSON from sys.argv[1] (not stdin!)
payload = json.loads(sys.argv[1])

print(f"Turn {payload['turn-id']} completed")
print(f"Working dir: {payload['cwd']}")
print(f"Result: {payload['last-assistant-message']}")
```

---

## Hooks System (Unmerged PRs)

### PR #2904 — User-Defined Event Hooks

**Status:** Closed (not merged) — October 30, 2025
**Reason:** OpenAI only accepting bug fixes, not new features

**Proposed Features:**
- Pre/post command execution hooks
- Session-level hooks
- Similar to Claude Code's hook system

**Limitations:**
- No blocking operations or flow control
- Hooks run asynchronously without feedback to agent
- Cannot halt or redirect agent behavior

**Community Feedback:** "Incomplete and inadequate" without blocking capability.

### PR #9796 — Comprehensive Hooks System

**Status:** Closed (not merged) — January 24, 2026
**Reason:** Not accepting feature contributions

**Proposed Features:**
- **Tool hooks** — before/after tool execution with input/output access
- **File hooks** — before/after file write operations
- **Event hooks** — prompt gating, stop hooks, compact mode, notifications
- Project-level configuration via `codex.json`
- Global hooks ordering for predictable execution
- Full test coverage

**Configuration Format (Proposed):**

```json
// .codex/codex.json (NOT config.toml)
{
  "hooks": {
    "tool": {
      "before": ["./scripts/before-tool.sh"],
      "after": ["./scripts/after-tool.sh"]
    },
    "file": {
      "before": ["./scripts/before-file.sh"],
      "after": ["./scripts/after-file.sh"]
    },
    "event": {
      "prompt": ["./scripts/prompt-gate.sh"],
      "stop": ["./scripts/on-stop.sh"]
    }
  }
}
```

**JSON Payload (Proposed):**

Hook scripts would receive JSON via **stdin** (unlike notify hooks which use argv).

**Status:** Both PRs were rejected. No official hooks system beyond `notify` exists as of 2026-02-10.

---

## --json JSONL Stream

### Usage

```bash
codex exec --json "Add dark mode toggle"
```

Streams JSONL events to **stdout** while progress goes to **stderr**.

### Top-Level Event Types

#### thread.started

```json
{
  "type": "thread.started",
  "thread_id": "0199a213-81c0-7800-8aa1-bbab2a035a53"
}
```

#### turn.started

```json
{
  "type": "turn.started"
}
```

#### turn.completed

```json
{
  "type": "turn.completed",
  "usage": {
    "input_tokens": 24763,
    "cached_input_tokens": 24448,
    "output_tokens": 122
  }
}
```

#### turn.failed

```json
{
  "type": "turn.failed",
  "error": {
    "message": "model response stream ended unexpectedly"
  }
}
```

#### error (stream-level)

```json
{
  "type": "error",
  "message": "stream error: broken pipe"
}
```

### Item Events

All item events include: `type` (item.started/updated/completed), `item.id`, `item.type`

#### agent_message

```json
{
  "type": "item.completed",
  "item": {
    "id": "item_3",
    "type": "agent_message",
    "text": "Done. I updated the docs and added examples."
  }
}
```

#### reasoning (if enabled)

```json
{
  "type": "item.completed",
  "item": {
    "id": "item_0",
    "type": "reasoning",
    "text": "**Scanning docs for exec JSON schema**"
  }
}
```

#### command_execution

**Started:**
```json
{
  "type": "item.started",
  "item": {
    "id": "item_1",
    "type": "command_execution",
    "command": "bash -lc ls",
    "aggregated_output": "",
    "exit_code": null,
    "status": "in_progress"
  }
}
```

**Completed (success):**
```json
{
  "type": "item.completed",
  "item": {
    "id": "item_1",
    "type": "command_execution",
    "command": "bash -lc ls",
    "aggregated_output": "docs\nsrc\n",
    "exit_code": 0,
    "status": "completed"
  }
}
```

#### file_change

```json
{
  "type": "item.completed",
  "item": {
    "id": "item_4",
    "type": "file_change",
    "changes": [
      {"path": "docs/exec-json-cheatsheet.md", "kind": "add"},
      {"path": "docs/exec.md", "kind": "update"}
    ],
    "status": "completed"
  }
}
```

#### mcp_tool_call

**Started:**
```json
{
  "type": "item.started",
  "item": {
    "id": "item_5",
    "type": "mcp_tool_call",
    "server": "docs",
    "tool": "search",
    "arguments": {"q": "exec --json"},
    "result": null,
    "error": null,
    "status": "in_progress"
  }
}
```

**Completed (success):**
```json
{
  "type": "item.completed",
  "item": {
    "id": "item_5",
    "type": "mcp_tool_call",
    "server": "docs",
    "tool": "search",
    "arguments": {"q": "exec --json"},
    "result": {
      "content": [
        {"type": "text", "text": "Found 3 matches."}
      ],
      "structured_content": {"matches": 3}
    },
    "error": null,
    "status": "completed"
  }
}
```

#### web_search

```json
{
  "type": "item.completed",
  "item": {
    "id": "item_7",
    "type": "web_search",
    "query": "codex exec --json schema"
  }
}
```

#### todo_list

```json
{
  "type": "item.started",
  "item": {
    "id": "item_8",
    "type": "todo_list",
    "items": [
      {"text": "Scan docs", "completed": false},
      {"text": "Write cheatsheet", "completed": false}
    ]
  }
}
```

#### error (item-level)

```json
{
  "type": "item.completed",
  "item": {
    "id": "item_9",
    "type": "error",
    "message": "command output truncated"
  }
}
```

### Complete Item Type List

- `agent_message`
- `reasoning`
- `command_execution`
- `file_change`
- `mcp_tool_call`
- `web_search`
- `todo_list`
- `error`

### MCP Content Block Types

When MCP tools return content, it uses these block types:

**Text:**
```json
{
  "type": "text",
  "text": "Search results...",
  "annotations": []  // optional
}
```

**Image:**
```json
{
  "type": "image",
  "data": "base64-encoded-data",
  "mimeType": "image/png",
  "annotations": []  // optional
}
```

**Audio:**
```json
{
  "type": "audio",
  "data": "base64-encoded-data",
  "mimeType": "audio/wav",
  "annotations": []  // optional
}
```

**Resource Link:**
```json
{
  "type": "resource",
  "name": "API Docs",
  "uri": "https://example.com/docs",
  "description": "API documentation",
  "mimeType": "text/html",
  "size": 12345,
  "title": "Optional Title"
}
```

**Embedded Resource:**
```json
{
  "type": "resource",
  "resource": {
    "type": "text",
    "text": "Embedded content..."
  },
  "annotations": []  // optional
}
```

---

## MCP Wire Protocol

### Overview

Codex can run as an MCP server that other agents can consume:

```bash
codex mcp-server
```

External MCP clients (Claude Desktop, Zed, custom apps) can invoke Codex as a tool over stdio JSON-RPC.

### Transport

**Protocol:** JSON-RPC 2.0 (with modifications)
**Transport:** stdio (newline-delimited JSON)
**Modification:** Omits `"jsonrpc":"2.0"` header from all messages

### Message Structure

**Request:**
```json
{
  "method": "operation-name",
  "params": {
    "arg1": "value1"
  },
  "id": 123
}
```

**Response (success):**
```json
{
  "id": 123,
  "result": {
    "status": "ok",
    "data": {}
  }
}
```

**Response (error):**
```json
{
  "id": 123,
  "error": {
    "code": -32600,
    "message": "Invalid request"
  }
}
```

**Notification (server → client):**
```json
{
  "method": "event-name",
  "params": {
    "event_data": {}
  }
}
```

**Note:** Notifications omit the `id` field.

### Primary Tools Exposed

When running as MCP server, Codex exposes:

1. **`codex`** — start new conversation
2. **`codex-reply`** — continue existing session

When a client invokes the `codex` tool:
- Codex spawns a session using `codex-core`
- Streams events back as notifications
- Returns final response when turn completes

### Initialization Pattern

1. Client sends `initialize` request
2. Server responds with capabilities
3. Client sends `initialized` notification
4. Operations can now execute

### MCP Server Configuration

Codex stores MCP server config in `config.toml`:

```toml
[mcp_servers.example]
command = "docs-server"
args = ["--port", "4000"]
startup_timeout_sec = 10.0
tool_timeout_sec = 60.0
```

**Scope:**
- Global: `~/.codex/config.toml`
- Project: `.codex/config.toml` (trusted projects only)

### Server Types

- **STDIO servers** — local process started by command
- **Streamable HTTP servers** — accessed at an address

---

## Config.toml Structure

### Notification Hooks

```toml
# External notifier (argv array)
notify = ["notify-send", "Codex"]
```

### History Management

```toml
[history]
persistence = "save-all"  # or "none"
max_bytes = 5242880       # Optional: trim oldest entries (bytes)
```

### Desktop Notifications (TUI)

```toml
[tui]
notifications = false  # boolean or filtered list
# Examples: false | ["agent-turn-complete", "approval-requested"]
notification_method = "auto"  # or "osc9" | "bel"
```

### Logging

```toml
log_dir = "/path/to/logs"  # defaults to $CODEX_HOME/log
```

**Log Files:**
- `codex-tui.log` — TUI debug logs
- Other runtime logs as needed

### OpenTelemetry

```toml
[otel]
log_user_prompt = false
environment = "dev"
exporter = "none"  # or "otlp-http" | "otlp-grpc"

[otel.trace_exporter]
# exporter = "otlp-http"
# endpoint = "https://otel-collector.example.com"
```

### MCP Servers

```toml
[mcp_servers.docs]
command = "docs-server"
args = ["--port", "4000"]
startup_timeout_sec = 10.0
tool_timeout_sec = 60.0
```

### Full Example

```toml
# ~/.codex/config.toml

# Notifications
notify = ["notify-send", "Codex"]

[history]
persistence = "save-all"
max_bytes = 5242880  # 5MB

[tui]
notifications = ["agent-turn-complete"]
notification_method = "auto"

[otel]
log_user_prompt = false
environment = "dev"
exporter = "none"

[mcp_servers.docs]
command = "docs-server"
args = []
startup_timeout_sec = 10.0
tool_timeout_sec = 60.0
```

---

## Schema Generation

### Commands

Generate schemas matching your exact Codex version:

```bash
# TypeScript schema
codex app-server generate-ts --out ./schemas

# JSON Schema bundle
codex app-server generate-json-schema --out ./schemas

# Include experimental APIs
codex app-server generate-json-schema --out ./schemas --experimental
```

**Output:** Version-specific schemas guaranteed to match your Codex installation.

**Use Case:** Generate client bindings for Go, Python, Swift, Kotlin, etc.

### Schema Location

The authoritative JSON Schema for `config.toml` lives at:

```
codex-rs/core/config.schema.json
```

(in the GitHub repo: `github.com/openai/codex`)

---

## Implementation Notes

### For Synapse Integration

#### 1. File Watcher

Watch `~/.codex/sessions/YYYY/MM/DD/` for new `rollout-*.jsonl` files.

**Strategy:**
- Use `chokidar` or Node.js `fs.watch` to monitor the sessions directory tree
- When a new file is created or modified, read new lines incrementally
- Parse each line as JSON and normalize to Synapse's `AgentEvent` schema

#### 2. Event Normalization

Map Codex event types to Synapse node types:

| Codex Event | Synapse Node Type |
|-------------|-------------------|
| `event_msg` with `type: "user_message"` | `message` (role: user) |
| `response_item` with `type: "message"` | `message` (role: assistant) |
| `event_msg` with `type: "token_count"` | Update session metadata |
| `item.completed` with `type: "command_execution"` | `tool` |
| `item.completed` with `type: "file_change"` | `tool` (file operation) |
| `item.completed` with `type: "web_search"` | `tool` (web search) |
| `item.completed` with `type: "mcp_tool_call"` | `tool` (MCP tool) |

#### 3. Session Detection

**Start Condition:**
- New `rollout-*.jsonl` file created
- Or `thread.started` event in `--json` stream

**End Condition:**
- `turn.completed` event
- Or no new events for N seconds (configurable timeout)

**Resumption:**
- Same `rollout-*.jsonl` file receives new appended events
- Track last read position per file to avoid re-processing

#### 4. Unique Challenges

**Cumulative Token Counts:**
- Codex reports cumulative totals, not per-turn deltas
- Must store previous token count and subtract to get delta

**Date Hierarchy:**
- Files organized by `YYYY/MM/DD/`
- Must scan multiple directories to find active sessions

**Environment Context:**
- `cwd` may be embedded in XML-like tags within user message content
- Extract with regex: `/<cwd>(.*?)<\/cwd>/`

**Yolo Mode Detection:**
- Check `turn_context` for `approval_policy == "never"` or `sandbox_policy.mode == "danger-full-access"`

#### 5. Alternative: --json Stream

Instead of watching files, spawn Codex with `--json` and consume stdout:

```typescript
import { spawn } from 'child_process';

const codex = spawn('codex', ['exec', '--json', userPrompt]);

codex.stdout.on('data', (chunk) => {
  const lines = chunk.toString().split('\n').filter(Boolean);
  lines.forEach(line => {
    const event = JSON.parse(line);
    normalizeAndBroadcast(event);
  });
});

codex.stderr.on('data', (chunk) => {
  // Progress messages, ignore or log
});
```

**Pros:** Real-time streaming, no file watching
**Cons:** Must manage Codex process lifecycle

#### 6. Notify Hook Integration

Set up a notify hook that POSTs to Synapse backend:

```bash
#!/bin/bash
# ~/.codex/hooks/notify-synapse.sh

curl -X POST http://localhost:4000/api/codex-events \
  -H "Content-Type: application/json" \
  -d "$1"  # $1 contains the JSON payload
```

**Config:**
```toml
notify = ["/home/user/.codex/hooks/notify-synapse.sh"]
```

**Backend Route:**
```typescript
app.post('/api/codex-events', (req, res) => {
  const payload = req.body;

  // Normalize to AgentEvent
  const event = normalizeCodexNotify(payload);

  // Broadcast via WebSocket
  broadcaster.broadcast(event);

  res.sendStatus(200);
});
```

**Pros:** Simple, no file watching, official integration point
**Cons:** Only fires on `agent-turn-complete`, not per-tool or per-message

#### 7. Recommended Approach

**Hybrid Strategy:**

1. **Use notify hook** for session start/end detection
2. **Watch session files** for detailed event stream
3. **Parse incrementally** to avoid re-reading entire files

**Flow:**

1. Notify hook fires → create session node
2. File watcher detects new lines in `rollout-*.jsonl`
3. Parse each line → normalize → broadcast
4. Track last read position per file
5. On session end (notify hook or timeout) → mark session complete

### Field Mapping Reference

**Codex → Synapse:**

```typescript
interface CodexEvent {
  type: 'event_msg' | 'response_item' | 'message';
  payload?: {
    type: 'user_message' | 'token_count' | 'turn_context';
    message?: string;
    content?: Array<{ type: string; text: string }> | string;
    role?: 'user' | 'assistant';
  };
  role?: 'user' | 'assistant';
  content?: Array<{ type: string; text: string }> | string;
}

function normalizeCodexEvent(event: CodexEvent): AgentEvent {
  // Synapse's AgentEvent schema from src/types/agent.ts

  if (event.type === 'event_msg' && event.payload?.type === 'user_message') {
    return {
      type: 'message',
      sessionId: extractSessionId(),
      data: {
        role: 'user',
        content: event.payload.message,
      },
      timestamp: Date.now(),
    };
  }

  if (event.type === 'response_item' && event.payload?.type === 'message') {
    const content = Array.isArray(event.payload.content)
      ? event.payload.content.map(c => c.text).join('')
      : event.payload.content;

    return {
      type: 'message',
      sessionId: extractSessionId(),
      data: {
        role: 'assistant',
        content,
      },
      timestamp: Date.now(),
    };
  }

  // Handle other event types...
}
```

### Testing Strategy

1. **Generate sample data:**
   ```bash
   codex exec --json "List files in current directory" > sample.jsonl
   ```

2. **Parse sample.jsonl** to validate normalization logic

3. **Monitor live session:**
   - Run Codex in one terminal
   - Tail `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl` in another
   - Verify events appear in real-time

4. **Test notify hook:**
   - Configure notify script
   - Run Codex task
   - Verify hook receives JSON payload with expected fields

---

## Sources

Research compiled from official documentation and community resources:

### Official Documentation
- [Command line options](https://developers.openai.com/codex/cli/reference/)
- [Configuration Reference](https://developers.openai.com/codex/config-reference/)
- [Advanced Configuration](https://developers.openai.com/codex/config-advanced/)
- [Sample Configuration](https://developers.openai.com/codex/config-sample/)
- [Non-interactive mode](https://developers.openai.com/codex/noninteractive/)
- [Codex App Server](https://developers.openai.com/codex/app-server/)
- [Model Context Protocol](https://developers.openai.com/codex/mcp)
- [GitHub: openai/codex](https://github.com/openai/codex)
- [config.md](https://github.com/openai/codex/blob/main/docs/config.md)

### GitHub Issues & PRs
- [PR #2904: User-defined event hooks](https://github.com/openai/codex/pull/2904)
- [PR #9796: Comprehensive hooks system](https://github.com/openai/codex/pull/9796)
- [Issue #2109: Event Hooks](https://github.com/openai/codex/issues/2109)
- [Issue #2288: CLI flag to save trajectory as JSON](https://github.com/openai/codex/issues/2288)
- [Issue #4005: JSON passed to notify should include cwd](https://github.com/openai/codex/issues/4005)
- [Issue #1673: JSON Schema for --json output](https://github.com/openai/codex/issues/1673)

### Community Resources
- [Codex exec --json cheatsheet (takopi.dev)](https://takopi.dev/reference/runners/codex/exec-json-cheatsheet/)
- [Codex CLI Overview (ccusage.com)](https://ccusage.com/guide/codex/)
- [TUI to index/search agent sessions (stanislas.blog)](https://stanislas.blog/2026/01/tui-index-search-coding-agent-sessions/)
- [codex-history-list (GitHub)](https://github.com/shinshin86/codex-history-list)

### Related Research
- [Model Context Protocol Documentation](https://modelcontextprotocol.info/docs/concepts/transports/)
- [Codex SDK (Elixir)](https://hexdocs.pm/codex_sdk/)

---

**End of Document**
