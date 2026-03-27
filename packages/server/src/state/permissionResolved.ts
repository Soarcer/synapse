// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bernhard

/**
 * Builds an enriched permissionResolved WS message payload.
 * Includes session_id, tool_use_id, and tool_name from the original
 * hook event so the dashboard can immediately finalize tool nodes.
 */
export function buildPermissionResolved(
  id: string,
  behavior: 'allow' | 'deny' | 'auto-dismissed',
  event: Record<string, unknown>,
): { type: 'permissionResolved'; data: Record<string, unknown> } {
  const data: Record<string, unknown> = { id, behavior };

  const sessionId = event.session_id as string | undefined;
  const toolUseId = event.tool_use_id as string | undefined;
  const toolName = event.tool_name as string | undefined;

  if (sessionId) data.session_id = sessionId;
  if (toolUseId) data.tool_use_id = toolUseId;
  if (toolName) data.tool_name = toolName;

  return { type: 'permissionResolved', data };
}
