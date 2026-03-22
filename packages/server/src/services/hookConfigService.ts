// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bernhard

import fs from 'fs';
import path from 'path';
import os from 'os';

/** Resolved path to send_event.cjs — set via configure(). */
let hookScriptPath: string | null = null;

/** All hook events that get observation hooks. */
const ALL_EVENTS = [
  'SessionStart',
  'UserPromptSubmit',
  'SubagentStart',
  'SubagentStop',
  'Stop',
  'SessionEnd',
  'PreToolUse',
  'PostToolUse',
  'PostToolUseFailure',
  'PermissionRequest',
  'Notification',
  'PreCompact',
];

/**
 * Initialize the service with the resolved hook script path.
 * Called once from index.ts at startup.
 */
export function configure(scriptPath: string): void {
  hookScriptPath = scriptPath;
}

/** Return the configured hook script path (for testing). */
export function getHookScriptPath(): string | null {
  return hookScriptPath;
}

function settingsFilePath(cwd: string): string {
  return path.join(cwd, '.claude', 'settings.local.json');
}

/**
 * Validate cwd is safe to read/write hook config for.
 * Throws on invalid paths.
 */
export function validateCwd(cwd: string): void {
  // Must be absolute
  if (!path.isAbsolute(cwd)) {
    throw new Error(`Path must be absolute: ${cwd}`);
  }

  // Resolve and check for .. traversal
  const resolved = path.resolve(cwd);
  if (resolved !== path.normalize(cwd)) {
    throw new Error(`Path contains traversal segments: ${cwd}`);
  }

  // Must not be home dir or ~/.claude (global hooks break all sessions)
  const home = os.homedir();
  const resolvedNorm = resolved.replace(/\\/g, '/').toLowerCase();
  const homeNorm = home.replace(/\\/g, '/').toLowerCase();
  if (resolvedNorm === homeNorm || resolvedNorm === `${homeNorm}/.claude`) {
    throw new Error('Refusing to write global hooks — must be project-scoped');
  }

  // .claude/ directory must already exist
  const claudeDir = path.join(resolved, '.claude');
  if (!fs.existsSync(claudeDir) || !fs.statSync(claudeDir).isDirectory()) {
    throw new Error(`No .claude/ directory found in ${resolved}`);
  }
}
