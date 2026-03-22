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

export interface HookStatus {
  observation: boolean;
  remoteApproval: boolean;
}

/**
 * Read the current hook status from a project's settings.local.json.
 * Returns { observation, remoteApproval } booleans.
 */
export function readHookStatus(cwd: string): HookStatus {
  const filePath = settingsFilePath(cwd);
  if (!fs.existsSync(filePath)) {
    return { observation: false, remoteApproval: false };
  }

  try {
    const content = fs.readFileSync(filePath, 'utf-8');

    // Quick string check for observation (matches CLI's isHooked())
    const observation = content.includes('send_event.cjs');

    // Parse for structured remoteApproval check
    let remoteApproval = false;
    if (observation) {
      const settings = JSON.parse(content) as Record<string, unknown>;
      const hooks = settings?.hooks as Record<string, unknown> | undefined;
      const permHooks = hooks?.PermissionRequest;
      if (Array.isArray(permHooks)) {
        for (const matcher of permHooks as Array<Record<string, unknown>>) {
          const innerHooks = Array.isArray(matcher?.hooks)
            ? (matcher.hooks as Array<Record<string, unknown>>)
            : [];
          remoteApproval = innerHooks.some(
            (h: Record<string, unknown>) =>
              h.type === 'http' &&
              typeof h.url === 'string' &&
              (h.url as string).includes('/api/hooks/permission'),
          );
          if (remoteApproval) break;
        }
      }
    }

    return { observation, remoteApproval };
  } catch {
    return { observation: false, remoteApproval: false };
  }
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
