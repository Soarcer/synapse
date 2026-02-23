// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Synapse Contributors

/** Strip Claude Code system tags to extract the actual user message */
export function extractUserMessage(raw: string): string {
  // Remove <tag>...</tag> blocks (ide_opened_file, ide_selection, system-reminder, etc.)
  const stripped = raw.replace(/<[a-z_-]+>[\s\S]*?<\/[a-z_-]+>/gi, '').trim();
  return stripped || raw.trim();
}
