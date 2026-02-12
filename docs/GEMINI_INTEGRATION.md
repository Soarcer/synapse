# Gemini CLI Integration — Technical Reference

## Overview

Gemini CLI has a hook system nearly identical to Claude Code's. Six event types, JSON on stdin, command hooks configured in settings.json. This is the highest-feasibility integration.

## Hook Event Mapping

| Gemini Event | AgentEvent Type | Notes |
|---|---|---|
| `SessionStart` | `session_start` | Source field: `startup`, `resume`, or `clear` |
| `SessionEnd` | `session_end` | Reason field: `exit`, `clear`, `logout`, `other` |
| `BeforeModel` | `user_prompt` | Contains full LLM request with model name and messages |
| `BeforeToolSelection` | `notification` | Informational — which tools are available |
| `BeforeTool` | `tool_start` | Exact same pattern as Claude's PreToolUse |
| `AfterTool` | `tool_end` | Contains tool_response with llmContent and error |

## Stdin JSON Schemas

### All Events (Common Fields)

```json
{
  "session_id": "string",
  "transcript_path": "string",
  "cwd": "string",
  "hook_event_name": "string",
  "timestamp": "ISO-8601 string"
}
```

### SessionStart

```json
{
  "session_id": "abc123",
  "transcript_path": "/home/user/.gemini/tmp/abc/chats/session.jsonl",
  "cwd": "/home/user/project",
  "hook_event_name": "SessionStart",
  "timestamp": "2026-02-10T14:30:00Z",
  "source": "startup"
}
```

### SessionEnd

```json
{
  "session_id": "abc123",
  "transcript_path": "/home/user/.gemini/tmp/abc/chats/session.jsonl",
  "cwd": "/home/user/project",
  "hook_event_name": "SessionEnd",
  "timestamp": "2026-02-10T15:00:00Z",
  "reason": "exit"
}
```

### BeforeModel

```json
{
  "session_id": "abc123",
  "transcript_path": "...",
  "cwd": "...",
  "hook_event_name": "BeforeModel",
  "timestamp": "...",
  "llm_request": {
    "model": "gemini-2.5-pro",
    "messages": [
      { "role": "user", "content": "Fix the login bug" },
      { "role": "model", "content": "I'll look at the auth module..." }
    ],
    "config": { "temperature": 0.7 },
    "toolConfig": {
      "mode": "AUTO",
      "allowedFunctionNames": ["read_file", "write_file", "run_shell_command"]
    }
  }
}
```

### BeforeTool

```json
{
  "session_id": "abc123",
  "transcript_path": "...",
  "cwd": "...",
  "hook_event_name": "BeforeTool",
  "timestamp": "...",
  "tool_name": "read_file",
  "tool_input": {
    "file_path": "/home/user/project/src/auth.ts"
  }
}
```

### AfterTool

```json
{
  "session_id": "abc123",
  "transcript_path": "...",
  "cwd": "...",
  "hook_event_name": "AfterTool",
  "timestamp": "...",
  "tool_name": "read_file",
  "tool_input": {
    "file_path": "/home/user/project/src/auth.ts"
  },
  "tool_response": {
    "llmContent": "export function login(user: string, pass: string) { ... }",
    "returnDisplay": "Read 42 lines from auth.ts",
    "error": null
  }
}
```

## Environment Variables Available to Hooks

| Variable | Description |
|----------|-------------|
| `GEMINI_PROJECT_DIR` | Absolute path to project root |
| `GEMINI_SESSION_ID` | Unique session ID |
| `GEMINI_CWD` | Current working directory |

## Hook Configuration (.gemini/settings.json)

```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "command",
            "name": "synapse-monitor",
            "command": "node /path/to/packages/adapter-gemini/hooks/send_event.cjs",
            "timeout": 3000
          }
        ]
      }
    ],
    "SessionEnd": [
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "command",
            "name": "synapse-monitor",
            "command": "node /path/to/packages/adapter-gemini/hooks/send_event.cjs",
            "timeout": 3000
          }
        ]
      }
    ],
    "BeforeModel": [
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "command",
            "name": "synapse-monitor",
            "command": "node /path/to/packages/adapter-gemini/hooks/send_event.cjs",
            "timeout": 3000
          }
        ]
      }
    ],
    "BeforeTool": [
      {
        "matcher": ".*",
        "hooks": [
          {
            "type": "command",
            "name": "synapse-monitor",
            "command": "node /path/to/packages/adapter-gemini/hooks/send_event.cjs",
            "timeout": 3000
          }
        ]
      }
    ],
    "AfterTool": [
      {
        "matcher": ".*",
        "hooks": [
          {
            "type": "command",
            "name": "synapse-monitor",
            "command": "node /path/to/packages/adapter-gemini/hooks/send_event.cjs",
            "timeout": 3000
          }
        ]
      }
    ]
  }
}
```

**Important**: BeforeTool and AfterTool use regex matchers (`".*"` matches all tools). SessionStart/SessionEnd use `"*"` wildcard or specific source strings like `"startup"`.

## Session File Format

Location: `~/.gemini/tmp/<project_hash>/chats/*.jsonl`

Each line is one of:

```jsonl
{"type": "session_metadata", "sessionId": "abc", "projectHash": "xyz", "startTime": "..."}
{"type": "user", "id": "msg1", "content": [{"text": "Hello"}], "timestamp": "..."}
{"type": "model", "id": "msg2", "content": {"role": "model", "parts": ["I'll help..."]}, "timestamp": "..."}
{"type": "message_update", "id": "msg2", "tokens": {"input": 100, "output": 50}}
{"type": "tool_result", "tool_id": "abc", "status": "success", "output": "file contents..."}
```

## Normalizer Mapping

```typescript
export function normalizeGeminiHook(raw: Record<string, unknown>): AgentEvent {
  const hookName = raw.hook_event_name as string;
  const eventType = GEMINI_EVENT_MAP[hookName] || 'notification';
  const ts = raw.timestamp ? new Date(raw.timestamp as string).getTime() : Date.now();

  const event: AgentEvent = {
    id: nanoid(),
    type: eventType,
    sessionId: `gemini-${raw.session_id as string}`,  // Prefix to avoid collisions
    timestamp: ts,
    eventSource: 'hook',
    vendor: 'google',
  };

  // Common fields
  if (raw.cwd) event.cwd = raw.cwd as string;
  if (raw.transcript_path) event.transcriptPath = raw.transcript_path as string;

  // Tool fields (BeforeTool / AfterTool)
  if (raw.tool_name) event.toolName = raw.tool_name as string;
  if (raw.tool_input) event.toolInput = raw.tool_input as Record<string, unknown>;

  // AfterTool: extract response
  if (raw.tool_response && typeof raw.tool_response === 'object') {
    const resp = raw.tool_response as Record<string, unknown>;
    event.toolResponse = { output: resp.llmContent ?? resp.returnDisplay };
    if (resp.error) {
      event.error = String(resp.error);
      event.status = 'error';
      event.type = 'tool_error';
    } else {
      event.status = 'success';
    }
  }

  // BeforeModel: extract model and user prompt
  if (raw.llm_request && typeof raw.llm_request === 'object') {
    const req = raw.llm_request as Record<string, unknown>;
    if (req.model) event.model = req.model as string;
    if (Array.isArray(req.messages)) {
      const lastUserMsg = (req.messages as Array<Record<string, unknown>>)
        .filter(m => m.role === 'user')
        .pop();
      if (lastUserMsg?.content) event.text = String(lastUserMsg.content).slice(0, 2000);
    }
  }

  // Status for tool events
  if (hookName === 'BeforeTool') event.status = 'running';
  if (hookName === 'SessionStart') {
    event.source = raw.source as string;
  }
  if (hookName === 'SessionEnd') {
    event.reason = raw.reason as string;
  }

  return event;
}
```

## Disambiguation from Claude Events

Both Gemini and Claude use `SessionStart` and `SessionEnd` as event names. To disambiguate:

```typescript
// Claude-only events (Gemini never sends these)
const CLAUDE_ONLY_EVENTS = new Set([
  'SubagentStart', 'SubagentStop',
  'PreToolUse', 'PostToolUse', 'PostToolUseFailure',
  'PreCompact', 'UserPromptSubmit', 'PermissionRequest',
]);

// Gemini-only events (Claude never sends these)
const GEMINI_ONLY_EVENTS = new Set([
  'BeforeModel', 'BeforeTool', 'AfterTool', 'BeforeToolSelection',
]);

function detectGemini(raw: Record<string, unknown>): boolean {
  const hookName = raw.hook_event_name as string;
  if (!hookName) return false;

  // Definitive: Gemini-only event
  if (GEMINI_ONLY_EVENTS.has(hookName)) return true;

  // Shared event names (SessionStart, SessionEnd)
  // Gemini sends llm_request or transcript_path to ~/.gemini/
  if (hookName === 'SessionStart' || hookName === 'SessionEnd') {
    const tp = raw.transcript_path as string;
    if (tp && tp.includes('.gemini')) return true;
    // Claude sends agent_id, Gemini doesn't
    if (raw.agent_id) return false;  // Claude
    // Claude sends permission_mode, Gemini doesn't
    if (raw.permission_mode) return false;  // Claude
    return false;  // Ambiguous — default to Claude for backwards compat
  }

  return false;
}
```

## Gemini Tool Names (Common)

Gemini CLI uses these built-in tool names:

- `read_file` — Read a file
- `write_file` — Write/create a file
- `replace` — Replace text in a file
- `run_shell_command` — Execute a shell command
- `list_directory` — List directory contents
- `search_files` — Search file contents (grep-like)
- `mcp__<server>__<tool>` — MCP-connected tools
