// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bernhard

// Configure Claude Code hooks for the current project directory
// to route events to the Synapse daemon.

import fs from 'fs';
import path from 'path';
import os from 'os';
import { projectClaudeDir, projectSettingsFile, HOOKS_DIR } from './paths.js';

/**
 * Safety guard: refuse to write hooks to the global ~/.claude/ directory.
 * Hooks must always be project-scoped. Global hooks affect every Claude Code
 * session on the machine and cause hangs when the Synapse server isn't running.
 */
function assertNotGlobal(cwd: string): void {
  const home = os.homedir();
  const resolved = path.resolve(cwd);
  // Block writing to home dir or ~/.claude itself
  if (resolved === home || resolved === path.join(home, '.claude')) {
    console.error(
      `ERROR: Refusing to write hooks to ${resolved}\n` +
        'Synapse hooks must be project-scoped, not global.\n' +
        'Run "synapse hook" from inside a project directory instead.',
    );
    process.exit(1);
  }
}

/** All hook events — every command hook uses async: true to avoid blocking Claude. */
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

export function configureHooks(
  cwd: string,
  port: number,
  options?: { observeOnly?: boolean },
): void {
  assertNotGlobal(cwd);
  const claudeDir = projectClaudeDir(cwd);
  const settingsFile = projectSettingsFile(cwd);

  // Find the hook script — prefer the one bundled with the CLI package
  const hookScript = path.join(HOOKS_DIR, 'send_event.cjs');
  if (!fs.existsSync(hookScript)) {
    console.error(`Hook script not found: ${hookScript}`);
    process.exit(1);
  }

  // Hook command — no --port; the script reads .synapse-port at runtime
  const hookCmd = `node "${hookScript.replace(/\\/g, '/')}"`;

  fs.mkdirSync(claudeDir, { recursive: true });

  // Build hooks config — all async to never block Claude sessions
  const hookPort = port + 1; // Hook server runs on SYNAPSE_PORT + 1 (e.g. 27247)
  const hooks: Record<string, unknown[]> = {};
  for (const event of ALL_EVENTS) {
    const inner: Array<Record<string, unknown>> = [
      { type: 'command', command: hookCmd, async: true },
    ];
    // PermissionRequest gets an additional sync HTTP hook for remote approval
    if (event === 'PermissionRequest' && !options?.observeOnly) {
      inner.push({
        type: 'http',
        url: `http://localhost:${hookPort}/api/hooks/permission`,
        timeout: 1800,
      });
    }
    hooks[event] = [{ hooks: inner }];
  }

  // Merge with existing settings (preserve non-Synapse entries)
  let settings: Record<string, unknown> = {};
  if (fs.existsSync(settingsFile)) {
    try {
      settings = JSON.parse(fs.readFileSync(settingsFile, 'utf-8'));
    } catch {
      /* start fresh */
    }
  }

  // Remove old Synapse hooks, add new ones
  const existingHooks = (settings.hooks as Record<string, unknown>) || {};
  for (const event of ALL_EVENTS) {
    delete existingHooks[event];
  }
  settings.hooks = { ...existingHooks, ...hooks };

  fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2));
  console.log(`Hooks configured in ${settingsFile}`);
}

export function removeHooks(cwd: string): void {
  const settingsFile = projectSettingsFile(cwd);
  if (!fs.existsSync(settingsFile)) {
    console.log('No .claude/settings.local.json found');
    return;
  }

  try {
    const settings = JSON.parse(fs.readFileSync(settingsFile, 'utf-8'));
    if (settings.hooks) {
      for (const event of ALL_EVENTS) {
        delete settings.hooks[event];
      }
      if (Object.keys(settings.hooks).length === 0) delete settings.hooks;
    }
    if (Object.keys(settings).length === 0) {
      fs.unlinkSync(settingsFile);
    } else {
      fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2));
    }
    console.log('Hooks removed');
  } catch {
    console.error('Could not parse settings.local.json');
  }
}

export function isHooked(cwd: string): boolean {
  const settingsFile = projectSettingsFile(cwd);
  if (!fs.existsSync(settingsFile)) return false;
  try {
    const content = fs.readFileSync(settingsFile, 'utf-8');
    return content.includes('send_event.cjs');
  } catch {
    return false;
  }
}
