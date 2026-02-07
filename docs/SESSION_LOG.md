# Session Log

## Session: Node Labels, Token Rollup, Task-Agent Linking, Cascade Deletion

### Features Implemented

#### 1. Node Labels
All graph node types now display a clear label prefix (Session, Agent, Prompt, Tool) for immediate visual identification.

**Files modified:**
- `src/components/graph/nodes/ToolCallNode.tsx` — added "Tool" label

SessionNode, AgentNode, and UserPromptNode already had labels from prior work.

#### 2. Event Source Tagging & Hook Toggle
Events are tagged with their origin (`'hook'` or `'sdk'`) at creation time. A header toggle (keyboard shortcut **H**) hides/shows hook-generated nodes. When toggled, all events are replayed from the server to rebuild the graph.

**Files modified:**
- `src/types/agent.ts` — added `eventSource?: 'hook' | 'sdk'` to `AgentEvent`
- `server/services/eventStore.ts` — `HOOK_EVENT_NAMES` set, tag `eventSource: 'hook'` in `normalizeHookPayload()`, infer from `hook_event_name` column in `rowToAgentEvent()`
- `server/services/agentManager.ts` — tag `eventSource: 'sdk'` in `persistAndBroadcast()`
- `src/store/agentStore.ts` — `showHookEvents` state, early-return in `addEvent`, `setShowHookEvents` with server replay
- `src/components/layout/Header.tsx` — hook toggle button
- `src/App.tsx` — **H** keyboard shortcut

#### 3. Task Tool to Agent Linking
When a Task tool completes, its response JSON contains the spawned agent's `agentId`. The store re-points the agent's incoming edge from the prompt node to the Task tool node, creating proper hierarchy: **Prompt -> Task tool -> Agent**.

Token usage is extracted from the Task response's `usage` field (input_tokens + cache_read + cache_creation, output_tokens) and applied to the child agent, since SubagentStop hooks carry no token information.

**Files modified:**
- `src/store/agentStore.ts` — Task tool_end handler parses `toolResponse.agentId`, re-points edges, extracts tokens
- `src/components/graph/nodes/ToolCallNode.tsx` — added source handle for child agent edges

#### 4. Continuous Token Aggregation
All node types display aggregated input/output tokens using `formatTokens()`:

- **SessionNode**: sum of all agents in the session
- **UserPromptNode**: temporal grouping of agents between this prompt and the next
- **AgentNode**: self + all child agents' tokens
- **Detail panel**: full breakdowns with input/output/total at each level

Fallback to transcript data when agent-based tokens are zero.

**Files modified:**
- `src/components/graph/nodes/SessionNode.tsx`
- `src/components/graph/nodes/AgentNode.tsx`
- `src/components/graph/nodes/UserPromptNode.tsx`
- `src/components/panels/AgentDetailPanel.tsx`

#### 5. Cascade Node Deletion
Generic `removeNode(nodeId)` traverses the edge tree via BFS to collect all descendant nodes, then cleans up sessions, agents, toolCalls, prompts maps, filters nodes/edges/events, and handles backend deletion. Remove buttons added to all detail panel views.

**Files modified:**
- `src/store/agentStore.ts` — `removeNode` with BFS cascade, `removeSession` delegated
- `src/components/panels/AgentDetailPanel.tsx` — remove buttons for all node types

### Technical Discoveries

- **Task tool response format**: `{ agentId, totalTokens, usage: { input_tokens, cache_read_input_tokens, cache_creation_input_tokens, output_tokens }, totalDurationMs, totalToolUseCount }`
- **SubagentStop hooks have NO token info** — Task tool response is the only source
- **Claude Code hooks limitation**: PreToolUse/PostToolUse do NOT include `agent_id` (GitHub issues #14859, #16126)
- **Temporal heuristic** for tool-to-agent mapping: `activeAgents` per session, most recent active sub-agent gets non-Task tools
