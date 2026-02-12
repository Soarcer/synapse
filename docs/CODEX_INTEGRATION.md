# Codex CLI Integration — Technical Reference

## Overview

OpenAI Codex CLI has NO advanced hook system (PRs were rejected). Integration relies on:
1. **File watching** — primary. Monitor `~/.codex/sessions/` JSONL files.
2. **Notify hook** — limited. Only fires on `agent-turn-complete`.
3. **`codex exec --json`** — alternative for spawned sessions (not user-interactive ones).

## Integration Strategy

```
Primary:   File watcher on ~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl
Secondary: Notify hook for agent-turn-complete events
```

## Session File Structure

### Location

```
~/.codex/sessions/
├── 2026/
│   ├── 02/
│   │   ├── 10/
│   │   │   ├── rollout-a1b2c3d4-e5f6-7890-abcd-ef1234567890.jsonl
│   │   │   └── rollout-f9e8d7c6-b5a4-3210-fedc-ba0987654321.jsonl
│   │   └── 09/
│   │       └── ...
│   └── 01/
│       └── ...
```

### JSONL Line Schemas

Each line is an independent JSON object. Multiple schema variants exist:

#### Event Message Wrapper

```json
{"type": "event_msg", "payload": {"type": "user_message", "message": "Fix the login bug", "images": []}}
{"type": "event_msg", "payload": {"type": "token_count", "input_tokens": 24763, "cached_input_tokens": 24448, "output_tokens": 122}}
{"type": "event_msg", "payload": {"type": "turn_context", "model": "gpt-4o", "approval_policy": "never"}}
```

#### Direct Role Messages

```json
{"type": "message", "role": "user", "content": "Fix the login bug"}
{"type": "message", "role": "assistant", "content": [{"type": "text", "text": "I'll look at..."}, {"type": "tool_use", "id": "tu_123", "name": "shell", "input": {"command": "cat src/auth.ts"}}]}
{"type": "message", "role": "tool", "tool_use_id": "tu_123", "content": "export function login..."}
```

#### State Records

```json
{"record_type": "state", "data": {"session_id": "...", "model": "gpt-4o", "cwd": "/project"}}
```

## Event Mapping

| Codex Event | AgentEvent Type | Detection |
|---|---|---|
| `event_msg` → `user_message` | `user_prompt` | `payload.type === 'user_message'` |
| `event_msg` → `token_count` | `result` | `payload.type === 'token_count'` |
| `event_msg` → `turn_context` | `session_start` | `payload.type === 'turn_context'` (first occurrence) |
| `message` → `role: user` | `user_prompt` | Direct role message |
| `message` → `role: assistant` (text) | `text_delta` | Assistant text block |
| `message` → `role: assistant` (tool_use) | `tool_start` | Tool use content block |
| `message` → `role: tool` | `tool_end` | Tool result message |
| `record_type: state` | `session_start` | Session metadata |
| Notify: `agent-turn-complete` | `result` | From notify hook |

## Critical: Cumulative Token Counts

**Codex reports CUMULATIVE token counts, not per-turn deltas.**

```json
// Turn 1
{"type": "event_msg", "payload": {"type": "token_count", "input_tokens": 1000, "output_tokens": 50}}
// Turn 2
{"type": "event_msg", "payload": {"type": "token_count", "input_tokens": 2500, "output_tokens": 120}}
```

The normalizer MUST track previous counts and compute deltas:

```typescript
class TokenTracker {
  private lastCounts = new Map<string, { input: number; output: number }>();

  computeDelta(sessionId: string, cumulative: { input: number; output: number }): { input: number; output: number } {
    const prev = this.lastCounts.get(sessionId) ?? { input: 0, output: 0 };
    const delta = {
      input: Math.max(0, cumulative.input - prev.input),
      output: Math.max(0, cumulative.output - prev.output),
    };
    this.lastCounts.set(sessionId, cumulative);
    return delta;
  }
}
```

## Notify Hook Configuration

### config.toml

```toml
# In ~/.codex/config.toml
notify = ["node", "C:/path/to/packages/adapter-codex/hooks/send_event.cjs"]
```

### Notify Payload (CLI argument, NOT stdin)

The JSON is passed as the last CLI argument:

```json
{
  "type": "agent-turn-complete",
  "thread-id": "rollout-uuid",
  "turn-id": "12345",
  "cwd": "/Users/user/project",
  "input-messages": ["Fix the login bug"],
  "last-assistant-message": "I've fixed the login function..."
}
```

### Hook Script (different from Claude/Gemini — reads argv, not stdin)

```javascript
#!/usr/bin/env node
// Codex CLI passes JSON as CLI argument, not stdin
const SERVER_URL = process.env.SYNAPSE_URL || 'http://localhost:4000/api/events';

async function main() {
  // Codex passes the notification JSON as the last argument
  const jsonArg = process.argv[process.argv.length - 1];
  if (!jsonArg) return;

  try {
    const payload = JSON.parse(jsonArg);
    // Normalize to Synapse format
    const event = {
      eventSource: 'codex',
      vendor: 'openai',
      type: 'result',
      sessionId: `codex-${payload['thread-id']}`,
      text: payload['last-assistant-message'],
      timestamp: Date.now(),
    };

    const controller = new AbortController();
    setTimeout(() => controller.abort(), 3000);
    await fetch(SERVER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(event),
      signal: controller.signal,
    });
  } catch { /* fire and forget */ }
}

main().then(() => process.exit(0));
```

## File Watcher Design

### Directory Discovery

Unlike Claude/Gemini (flat session directories), Codex uses date hierarchy:

```typescript
class CodexFileWatcher extends FileWatcherBase {
  private readonly sessionsRoot: string;  // ~/.codex/sessions/

  discoverFiles(): string[] {
    // Walk YYYY/MM/DD/ directories
    const files: string[] = [];
    const years = readdirSync(this.sessionsRoot).filter(isDir);
    for (const year of years) {
      const months = readdirSync(join(this.sessionsRoot, year)).filter(isDir);
      for (const month of months) {
        const days = readdirSync(join(this.sessionsRoot, year, month)).filter(isDir);
        for (const day of days) {
          const dayDir = join(this.sessionsRoot, year, month, day);
          const jsonlFiles = readdirSync(dayDir).filter(f => f.endsWith('.jsonl'));
          files.push(...jsonlFiles.map(f => join(dayDir, f)));
        }
      }
    }
    return files;
  }

  // Watch today's directory for new files
  watchActiveDay(): void {
    const today = new Date();
    const todayDir = join(
      this.sessionsRoot,
      String(today.getFullYear()),
      String(today.getMonth() + 1).padStart(2, '0'),
      String(today.getDate()).padStart(2, '0'),
    );
    this.watchDirectory(todayDir);
  }
}
```

### Session ID Extraction

```typescript
function sessionIdFromFilename(filepath: string): string {
  // rollout-a1b2c3d4-e5f6-7890-abcd-ef1234567890.jsonl → codex-a1b2c3d4-e5f6
  const basename = path.basename(filepath, '.jsonl');
  const uuid = basename.replace('rollout-', '');
  return `codex-${uuid.slice(0, 13)}`;  // Shortened UUID prefix for readability
}
```

## Normalizer

```typescript
const CODEX_PRICING: Record<string, { input: number; output: number }> = {
  'gpt-4o':         { input: 2.5, output: 10 },
  'gpt-4o-mini':    { input: 0.15, output: 0.60 },
  'gpt-4-turbo':    { input: 10, output: 30 },
  'o3':             { input: 2, output: 8 },
  'o3-mini':        { input: 1.10, output: 4.40 },
  'o4-mini':        { input: 1.10, output: 4.40 },
  'codex-mini':     { input: 1.50, output: 6.00 },
};

export function normalizeCodexLine(
  line: Record<string, unknown>,
  context: { sessionId: string; model?: string },
  tokenTracker: TokenTracker,
): AgentEvent[] {
  const events: AgentEvent[] = [];
  const ts = Date.now();

  // ── Variant 1: event_msg wrapper ──
  if (line.type === 'event_msg' && typeof line.payload === 'object') {
    const payload = line.payload as Record<string, unknown>;

    switch (payload.type) {
      case 'user_message':
        events.push({
          id: nanoid(),
          type: 'user_prompt',
          sessionId: context.sessionId,
          text: String(payload.message ?? '').slice(0, 2000),
          timestamp: ts,
          eventSource: 'codex' as any,
          vendor: 'openai',
        });
        break;

      case 'token_count': {
        const cumulative = {
          input: (payload.input_tokens as number) + (payload.cached_input_tokens as number ?? 0),
          output: payload.output_tokens as number,
        };
        const delta = tokenTracker.computeDelta(context.sessionId, cumulative);
        if (delta.input > 0 || delta.output > 0) {
          events.push({
            id: nanoid(),
            type: 'result',
            sessionId: context.sessionId,
            tokenUsage: delta,
            model: context.model,
            vendor: 'openai',
            eventSource: 'codex' as any,
            timestamp: ts,
          });
        }
        break;
      }

      case 'turn_context':
        context.model = payload.model as string;
        events.push({
          id: nanoid(),
          type: 'session_start',
          sessionId: context.sessionId,
          model: payload.model as string,
          vendor: 'openai',
          eventSource: 'codex' as any,
          timestamp: ts,
          permissionMode: payload.approval_policy as string,
        });
        break;
    }
  }

  // ── Variant 2: Direct role messages ──
  if (line.type === 'message' || line.role) {
    const role = (line.role ?? (line as any).type) as string;

    if (role === 'user') {
      events.push({
        id: nanoid(),
        type: 'user_prompt',
        sessionId: context.sessionId,
        text: String(line.content ?? '').slice(0, 2000),
        timestamp: ts,
        eventSource: 'codex' as any,
        vendor: 'openai',
      });
    }

    if (role === 'assistant' && Array.isArray(line.content)) {
      for (const block of line.content as Array<Record<string, unknown>>) {
        if (block.type === 'text') {
          events.push({
            id: nanoid(),
            type: 'text_delta',
            sessionId: context.sessionId,
            text: String(block.text ?? '').slice(0, 500),
            model: context.model,
            vendor: 'openai',
            eventSource: 'codex' as any,
            timestamp: ts,
          });
        }
        if (block.type === 'tool_use') {
          events.push({
            id: nanoid(),
            type: 'tool_start',
            sessionId: context.sessionId,
            toolName: block.name as string,
            toolUseId: block.id as string,
            toolInput: (block.input ?? {}) as Record<string, unknown>,
            status: 'running',
            model: context.model,
            vendor: 'openai',
            eventSource: 'codex' as any,
            timestamp: ts,
          });
        }
      }
    }

    if (role === 'tool' && line.tool_use_id) {
      events.push({
        id: nanoid(),
        type: 'tool_end',
        sessionId: context.sessionId,
        toolUseId: line.tool_use_id as string,
        toolResponse: { output: String(line.content ?? '').slice(0, 5000) },
        status: 'success',
        vendor: 'openai',
        eventSource: 'codex' as any,
        timestamp: ts,
      });
    }
  }

  return events;
}
```

## Platform-Specific Paths

| Platform | Sessions Directory |
|----------|-------------------|
| Windows | `%USERPROFILE%\.codex\sessions\` |
| macOS | `~/.codex/sessions/` |
| Linux | `~/.codex/sessions/` |

Can also be overridden with `CODEX_HOME` environment variable: `$CODEX_HOME/sessions/`

## Codex Tool Names

- `shell` — Execute shell command
- `read_file` — Read file contents
- `write_file` — Write/create file
- `apply_diff` — Apply a diff to a file
- `create_directory` — Create a directory
- `list_directory` — List directory contents
- MCP tools follow the same `mcp__server__tool` pattern

## --json Stream Format (Alternative for Spawned Sessions)

If Synapse spawns Codex via `codex exec --json`, the stdout produces:

```jsonl
{"type": "thread.started", "thread_id": "abc"}
{"type": "turn.started", "turn_id": "1"}
{"type": "item.started", "item": {"id": "item_1", "type": "command_execution", "command": "ls"}}
{"type": "item.completed", "item": {"id": "item_1", "type": "command_execution", "command": "ls", "exit_code": 0, "aggregated_output": "docs\n"}}
{"type": "turn.completed", "turn_id": "1"}
```

Item types: `agent_message`, `reasoning`, `command_execution`, `file_change`, `mcp_tool_call`, `web_search`, `error`

This could be used for the AgentManager spawn flow (like Claude Agent SDK integration), but is out of scope for the file-watching integration.
