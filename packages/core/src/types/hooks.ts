// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bernhard

/**
 * Shape of the JSON body Claude Code sends to HTTP hooks.
 * Known fields are typed explicitly; the index signature
 * allows future/unknown fields to pass through.
 */
export interface ClaudeHookEvent {
  session_id: string;
  tool_name?: string;
  tool_input?: unknown;
  hook_event_name: string;
  [key: string]: unknown;
}
