// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Synapse Contributors

// ─── Core Event Types ───────────────────────────────────────────────

export type AgentEventType =
  | 'session_start'
  | 'session_end'
  | 'user_prompt'
  | 'agent_start'
  | 'agent_stop'
  | 'tool_start'
  | 'tool_end'
  | 'tool_error'
  | 'permission_request'
  | 'notification'
  | 'compact'
  | 'stop'
  | 'text_delta'
  | 'result';

export interface AgentEvent {
  id: string; // nanoid
  type: AgentEventType;
  sessionId: string;
  agentId?: string;
  agentType?: string; // "Explore", "Plan", "Bash", custom names
  parentAgentId?: string; // For subagent → parent tracking
  toolName?: string;
  toolInput?: Record<string, unknown>;
  toolResponse?: Record<string, unknown>;
  toolUseId?: string;
  text?: string; // Streaming text content or user prompt
  status?: 'running' | 'success' | 'error' | 'stopped';
  error?: string;
  tokenUsage?: { input: number; output: number };
  duration?: number; // milliseconds
  timestamp: number; // Unix ms

  // Rich metadata from hooks
  model?: string; // e.g. "claude-opus-4-6"
  source?: string; // SessionStart: startup/resume/clear/compact
  reason?: string; // SessionEnd reason, notification type
  cwd?: string; // Working directory
  permissionMode?: string; // default/plan/acceptEdits/bypassPermissions
  transcriptPath?: string; // Path to conversation JSON
  agentTranscriptPath?: string; // Subagent transcript path
  notificationType?: string; // permission_prompt/idle_prompt/auth_success
  compactTrigger?: string; // manual/auto
  gitBranch?: string; // Git branch from session metadata
  eventSource?: 'hook' | 'sdk' | 'openclaw'; // Where the event originated

  // Multi-vendor support (OpenClaw integration)
  vendor?: string; // 'anthropic' | 'openai' | 'google' | 'groq' | 'openrouter' | 'custom'
  costUsd?: number; // Computed cost for this event
}

// ─── Session Data ──────────────────────────────────────────────────

export interface SessionData {
  sessionId: string;
  startTime: number;
  endTime?: number;
  agentCount: number;
  status: 'running' | 'ended';
  model?: string;
  source?: string; // startup/resume
  cwd?: string;
  placeholder?: boolean; // true if session was auto-created (missed SessionStart)
  vendor?: string; // Primary vendor for this session
  title?: string; // Human-readable name from first prompt or slug
  gitBranch?: string; // Git branch from session_start metadata
  topTools?: string[]; // Top 3 most-used tool names
}

// ─── React Flow Node Data ───────────────────────────────────────────

export interface AgentNodeData {
  agentId: string;
  agentType: string;
  sessionId: string;
  parentAgentId?: string;
  status: 'running' | 'success' | 'error' | 'stopped';
  prompt?: string;
  toolCalls: ToolCallSummary[];
  tokenUsage: {
    input: number;
    output: number;
    cacheRead?: number;
    cacheCreation?: number;
    thinking?: number;
  };
  startTime: number;
  endTime?: number;
  streamingText?: string; // Live text being generated
  vendor?: string; // Inferred vendor (anthropic, openai, etc.)
  model?: string; // e.g. "claude-opus-4-6"
  compactionCount?: number; // Number of times context was compacted
}

export interface ToolCallSummary {
  toolUseId: string;
  toolName: string;
  status: 'running' | 'success' | 'error';
  startTime: number;
  endTime?: number;
  duration?: number;
  inputPreview?: string; // First 100 chars of input
  toolInput?: Record<string, unknown>;
  toolResponse?: Record<string, unknown>;
}

// ─── User Prompt Data ───────────────────────────────────────────────

export interface UserPromptData {
  id: string;
  sessionId: string;
  text: string;
  timestamp: number;
  compactedAfter?: boolean; // True if a compaction event follows this prompt
}

// ─── API Request/Response Types ─────────────────────────────────────

export interface SpawnAgentRequest {
  prompt: string;
  model?: 'opus' | 'sonnet' | 'haiku';
  tools?: string[]; // ["Read", "Edit", "Bash", ...]
  permissionMode?: 'acceptEdits' | 'bypassPermissions' | 'default';
  systemPrompt?: string;
  mcpServers?: Record<string, McpServerConfig>;
  cwd?: string; // Working directory for the agent
  sessionId?: string; // Join an existing session instead of creating new
}

export interface McpServerConfig {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

// ─── WebSocket Message Types ────────────────────────────────────────

export type WsServerMessage =
  | { type: 'event'; data: AgentEvent }
  | { type: 'connected'; data: { activeAgents: ActiveAgentInfo[] } }
  | { type: 'agent_text'; data: { agentId: string; text: string; isPartial: boolean } }
  | { type: 'stale'; data: Record<string, never> }
  | { type: 'coaching_nudge'; data: import('./coaching.js').CoachingNudge }
  | { type: 'terminal_send'; data: { text: string } };

export type WsClientMessage =
  | { type: 'subscribe'; sessionId: string }
  | { type: 'unsubscribe'; sessionId: string };

export interface ActiveAgentInfo {
  agentId: string;
  agentType: string;
  sessionId: string;
  status: 'running' | 'success' | 'error' | 'stopped';
  startTime: number;
}
