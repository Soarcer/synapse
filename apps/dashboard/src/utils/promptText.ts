// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bernhard

/** Strip Claude Code system tags to extract the actual user message */
export function extractUserMessage(raw: string): string {
  // Remove <tag>...</tag> blocks (ide_opened_file, ide_selection, system-reminder, etc.)
  const stripped = raw.replace(/<[a-z_-]+>[\s\S]*?<\/[a-z_-]+>/gi, '').trim();
  return stripped || raw.trim();
}
