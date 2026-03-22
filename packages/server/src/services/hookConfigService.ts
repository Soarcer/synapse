// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bernhard

import fs from 'fs';
import path from 'path';
import os from 'os';
import { HOOK_PORT } from '@synapse-ai/core/config';

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
 * Write hook configuration to a project's settings.local.json.
 * - observation: true → add send_event.cjs for all events
 * - remoteApproval: true → add HTTP hook to PermissionRequest
 * Preserves non-Synapse entries and non-send_event.cjs Synapse hooks.
 */
export function writeHookConfig(
  cwd: string,
  opts: { observation: boolean; remoteApproval: boolean },
): void {
  const filePath = settingsFilePath(cwd);

  // Disabling both — cleanup path
  if (!opts.observation && !opts.remoteApproval) {
    if (!fs.existsSync(filePath)) return; // ENOENT is fine

    let settings: Record<string, unknown>;
    try {
      settings = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    } catch {
      return;
    }

    // Remove all Synapse hook events
    const hooks = (settings.hooks ?? {}) as Record<string, unknown>;
    for (const event of ALL_EVENTS) {
      delete hooks[event];
    }
    if (Object.keys(hooks).length === 0) delete settings.hooks;

    // Clean up file if empty
    if (Object.keys(settings).length === 0) {
      try {
        fs.unlinkSync(filePath);
      } catch {
        /* ok */
      }
    } else {
      fs.writeFileSync(filePath, JSON.stringify(settings, null, 2));
    }
    return;
  }

  // Enabling — need the hook script
  if (opts.observation && !hookScriptPath) {
    throw new Error('Hook script path not configured — call configure() first');
  }
  if (opts.observation && hookScriptPath && !fs.existsSync(hookScriptPath)) {
    throw new Error(`Hook script not found: ${hookScriptPath}`);
  }

  const hookCmd = hookScriptPath ? `node "${hookScriptPath.replace(/\\/g, '/')}"` : '';

  // Read existing settings
  let settings: Record<string, unknown> = {};
  if (fs.existsSync(filePath)) {
    try {
      settings = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    } catch {
      /* start fresh */
    }
  }

  const existingHooks = (settings.hooks ?? {}) as Record<string, unknown[]>;

  if (opts.observation) {
    // Build hook entries for each event
    for (const event of ALL_EVENTS) {
      // Collect non-send_event.cjs entries to preserve (e.g., send_response.cjs)
      const existing = Array.isArray(existingHooks[event]) ? existingHooks[event] : [];
      const preserved: Array<Record<string, unknown>> = [];

      for (const matcher of existing) {
        const m = matcher as Record<string, unknown>;
        if (Array.isArray(m.hooks)) {
          for (const h of m.hooks as Array<Record<string, unknown>>) {
            const cmd = typeof h.command === 'string' ? h.command : '';
            const isObservation = cmd.includes('send_event.cjs');
            const isHttpPermission =
              h.type === 'http' &&
              typeof h.url === 'string' &&
              (h.url as string).includes('/api/hooks/permission');
            if (!isObservation && !isHttpPermission) {
              preserved.push(h);
            }
          }
        }
      }

      const inner: Array<Record<string, unknown>> = [
        { type: 'command', command: hookCmd, async: true },
        ...preserved,
      ];

      // Add HTTP hook for PermissionRequest if remote approval enabled
      if (event === 'PermissionRequest' && opts.remoteApproval) {
        inner.push({
          type: 'http',
          url: `http://localhost:${HOOK_PORT}/api/hooks/permission`,
          timeout: 1800,
        });
      }

      existingHooks[event] = [{ hooks: inner }];
    }
  } else {
    // observation: false — remove all Synapse events
    for (const event of ALL_EVENTS) {
      delete existingHooks[event];
    }
  }

  if (Object.keys(existingHooks).length === 0) {
    delete settings.hooks;
  } else {
    settings.hooks = existingHooks;
  }

  fs.writeFileSync(filePath, JSON.stringify(settings, null, 2));
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
