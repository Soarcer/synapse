# Synapse Research — Claude 4.6, Hooks, Agent SDK, Observability

## Claude Opus 4.6 (Released Feb 5, 2026)

### Key Features
- **Agent Teams (TeammateTool)**: Teams of agents that collaborate in parallel
  - Team lead coordinates, teammates work in independent context windows
  - Shared task lists, peer-to-peer messaging
  - Enable via: `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`
  - Operations: `spawnTeam`, `discoverTeams`, `write` (DM), `broadcast`, `approvePlan`, `requestShutdown`
  - State directory: `~/.claude/teams/{team-name}/config.json`, `messages/`, `tasks/`
  - Env vars: `CLAUDE_CODE_TEAM_NAME`, `CLAUDE_CODE_AGENT_ID`, `CLAUDE_CODE_AGENT_TYPE`
- **1M token context window** (1,500 pages, 30,000 lines of code, 1hr video)
- **65.4% on Terminal-Bench 2.0** (highest ever recorded)
- **Pricing**: $5/$25 per million input/output tokens (unchanged)

### Sources
- https://techcrunch.com/2026/02/05/anthropic-releases-opus-4-6-with-new-agent-teams/
- https://venturebeat.com/technology/anthropics-claude-opus-4-6-brings-1m-token-context-and-agent-teams-to-take
- https://paddo.dev/blog/claude-code-hidden-swarm/

---

## Claude Code Hooks System

### Overview
Hooks are user-defined shell commands, LLM prompts, or agent scripts that execute at specific lifecycle points. They receive JSON on stdin and can return JSON decisions on stdout.

### All Hook Events

| Event | When | Can Block? | Matcher Field |
|-------|------|-----------|---------------|
| `SessionStart` | Session begins/resumes | No | source: startup, resume, clear, compact |
| `UserPromptSubmit` | User submits prompt | Yes | (no matcher) |
| `PreToolUse` | Before tool executes | Yes (allow/deny/ask) | tool name |
| `PermissionRequest` | Permission dialog shown | Yes | tool name |
| `PostToolUse` | After tool succeeds | No (feedback only) | tool name |
| `PostToolUseFailure` | After tool fails | No | tool name |
| `Notification` | Claude sends notification | No | notification type |
| `SubagentStart` | Subagent spawned | No (context injection) | agent type |
| `SubagentStop` | Subagent finishes | Yes | agent type |
| `Stop` | Claude finishes responding | Yes | (no matcher) |
| `PreCompact` | Before context compaction | No | trigger: manual, auto |
| `SessionEnd` | Session terminates | No | reason |

### Common Input Fields (all events)
```json
{
  "session_id": "abc123",
  "transcript_path": "/path/to/transcript.jsonl",
  "cwd": "/working/directory",
  "permission_mode": "default",
  "hook_event_name": "PreToolUse"
}
```

### SubagentStart Input
```json
{
  "session_id": "abc123",
  "hook_event_name": "SubagentStart",
  "agent_id": "agent-abc123",
  "agent_type": "Explore"
}
```

### SubagentStop Input
```json
{
  "session_id": "abc123",
  "hook_event_name": "SubagentStop",
  "agent_id": "def456",
  "agent_type": "Explore",
  "agent_transcript_path": "~/.claude/projects/.../subagents/agent-def456.jsonl",
  "stop_hook_active": false
}
```

### PreToolUse Input
```json
{
  "hook_event_name": "PreToolUse",
  "tool_name": "Bash",
  "tool_input": { "command": "npm test" },
  "tool_use_id": "toolu_01ABC123..."
}
```

### PostToolUse Input
```json
{
  "hook_event_name": "PostToolUse",
  "tool_name": "Write",
  "tool_input": { "file_path": "/path/to/file.txt", "content": "..." },
  "tool_response": { "filePath": "/path/to/file.txt", "success": true },
  "tool_use_id": "toolu_01ABC123..."
}
```

### Task Tool Input (triggers SubagentStart)
```json
{
  "tool_name": "Task",
  "tool_input": {
    "prompt": "Find all API endpoints",
    "description": "Find API endpoints",
    "subagent_type": "Explore",
    "model": "sonnet"
  }
}
```

### Hook Configuration Location
- `~/.claude/settings.json` — all projects
- `.claude/settings.json` — single project (committable)
- `.claude/settings.local.json` — single project (gitignored)

### MCP Tool Matching
MCP tools appear as `mcp__<server>__<tool>` in hook events. Match with regex: `mcp__memory__.*`

### Hook Types
1. **Command** (`type: "command"`): shell script, reads stdin JSON, returns JSON on stdout
2. **Prompt** (`type: "prompt"`): single-turn LLM evaluation, returns `{ ok, reason }`
3. **Agent** (`type: "agent"`): multi-turn subagent with tool access, returns `{ ok, reason }`

### Async Hooks
Set `"async": true` to run hooks in background without blocking. Output delivered on next conversation turn.

### Source
- https://code.claude.com/docs/en/hooks

---

## Claude Agent SDK

### Overview
Build AI agents with Claude Code as a library. Same tools, agent loop, and context management as Claude Code, programmable in Python and TypeScript.

### Installation
```bash
npm install @anthropic-ai/claude-agent-sdk
```

### Core API — `query()` Function
```typescript
import { query } from "@anthropic-ai/claude-agent-sdk";

for await (const message of query({
  prompt: "Find and fix the bug in auth.py",
  options: {
    allowedTools: ["Read", "Edit", "Bash"],
    permissionMode: "acceptEdits"
  }
})) {
  // Process streaming messages
}
```

### Message Types (Streaming)

With `includePartialMessages: true`:

| Message Type | Description |
|-------------|-------------|
| `SystemMessage` | Session initialization (contains `session_id` in `init` subtype) |
| `AssistantMessage` | Complete response with content blocks (text, tool_use, tool_result) |
| `StreamEvent` / `SDKPartialAssistantMessage` | Raw API streaming events |
| `ResultMessage` | Final result with cost/usage info |
| `CompactBoundaryMessage` | Context compaction occurred |

### StreamEvent Structure
```typescript
type SDKPartialAssistantMessage = {
  type: 'stream_event';
  event: RawMessageStreamEvent; // From Anthropic SDK
  parent_tool_use_id: string | null; // Tracks which subagent
  uuid: string;
  session_id: string;
}
```

### Raw Streaming Event Types
| Event Type | Description |
|-----------|-------------|
| `message_start` | Start of a new message |
| `content_block_start` | New content block (text or tool_use) |
| `content_block_delta` | Incremental update (text_delta or input_json_delta) |
| `content_block_stop` | End of content block |
| `message_delta` | Message-level updates (stop reason, usage) |
| `message_stop` | End of the message |

### Message Flow
```
StreamEvent (message_start)
StreamEvent (content_block_start) - text block
StreamEvent (content_block_delta) - text chunks...
StreamEvent (content_block_stop)
StreamEvent (content_block_start) - tool_use block
StreamEvent (content_block_delta) - tool input chunks...
StreamEvent (content_block_stop)
StreamEvent (message_delta)
StreamEvent (message_stop)
AssistantMessage - complete message
... tool executes ...
ResultMessage - final result
```

### Subagents
```typescript
const options = {
  allowedTools: ["Read", "Glob", "Grep", "Task"],
  agents: {
    "code-reviewer": {
      description: "Expert code reviewer",
      prompt: "Analyze code quality and suggest improvements.",
      tools: ["Read", "Glob", "Grep"]
    }
  }
};
```

Subagent messages include `parent_tool_use_id` to track which messages belong to which subagent.

### SDK Hooks (Programmatic)
```typescript
const options = {
  permissionMode: "acceptEdits",
  hooks: {
    PostToolUse: [{
      matcher: "Edit|Write",
      hooks: [async (input) => {
        // Custom callback
        return {};
      }]
    }]
  }
};
```

### Sessions (Resume/Fork)
```typescript
// Capture session_id from first query
let sessionId;
for await (const msg of query({ prompt: "Read auth module" })) {
  if (msg.type === "system" && msg.subtype === "init") {
    sessionId = msg.session_id;
  }
}
// Resume with context
for await (const msg of query({
  prompt: "Now find all callers",
  options: { resume: sessionId }
})) { ... }
```

### Permission Modes
| Mode | Behavior |
|------|----------|
| `acceptEdits` | Auto-approve file edits, ask for others |
| `bypassPermissions` | No prompts at all |
| `default` | Requires `canUseTool` callback |

### Sources
- https://platform.claude.com/docs/en/agent-sdk/overview
- https://platform.claude.com/docs/en/agent-sdk/streaming-output
- https://platform.claude.com/docs/en/agent-sdk/quickstart

---

## Reference Projects

### disler/claude-code-hooks-multi-agent-observability
- **Architecture**: Claude Agents → Hook Scripts → HTTP POST → Bun Server → SQLite → WebSocket → Vue Client
- **8 hook events captured**: PreToolUse, PostToolUse, UserPromptSubmit, Notification, Stop, SubagentStop, PreCompact, SessionStart/End
- **Stack**: Bun + TypeScript server, Vue 3 + Tailwind client, SQLite WAL mode
- **Server endpoints**: POST /events, GET /events/recent, GET /events/filter-options, WS /stream
- **Features**: Multi-session tracking with unique colors, live pulse chart, event filtering, chat transcript viewer
- https://github.com/disler/claude-code-hooks-multi-agent-observability

### claude_telemetry (OpenTelemetry)
- Drop-in `claudia` command replacing `claude`
- Logs tool calls, token usage, costs, execution traces
- Exports to Logfire, Sentry, Honeycomb, or Datadog
- https://github.com/TechNickAI/claude_telemetry

### claude-flow (Multi-Agent Orchestration)
- Agent orchestration platform with MCP protocol
- Distributed swarm intelligence, RAG integration
- https://github.com/ruvnet/claude-flow

---

## Node-Based UI Libraries

### @xyflow/react (React Flow v12) — CHOSEN
- MIT licensed, React components as nodes
- Built-in: zoom, pan, minimap, controls, background, selection
- Only re-renders changed nodes (performant)
- Dagre/ELK integration for auto-layout
- https://reactflow.dev / https://xyflow.com

### Alternatives Considered
- **Flume** (https://flume.dev): Simpler, 60fps+, but less flexible
- **React Digraph** (Uber): Low-level, good for custom rendering
- **Canvas-based** (like Geometries VFXNodeEditor): Maximum control, more work
