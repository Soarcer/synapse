// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Synapse Contributors

// Configure Claude Code hooks for the current project directory
// to route events to the Synapse daemon.

import fs from 'fs';
import path from 'path';
import { projectClaudeDir, projectPortFile, projectSettingsFile, HOOKS_DIR } from './paths.js';

const SYNC_EVENTS = [
  'SessionStart',
  'UserPromptSubmit',
  'SubagentStart',
  'SubagentStop',
  'Stop',
  'SessionEnd',
];

const ASYNC_EVENTS = [
  'PreToolUse',
  'PostToolUse',
  'PostToolUseFailure',
  'PermissionRequest',
  'Notification',
  'PreCompact',
];

export function configureHooks(cwd: string, port: number): void {
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

  // Write port file so hook scripts find the daemon
  fs.mkdirSync(claudeDir, { recursive: true });
  fs.writeFileSync(projectPortFile(cwd), String(port));

  // Build hooks config
  const hooks: Record<string, unknown[]> = {};
  for (const event of SYNC_EVENTS) {
    hooks[event] = [{ hooks: [{ type: 'command', command: hookCmd }] }];
  }
  for (const event of ASYNC_EVENTS) {
    hooks[event] = [{ hooks: [{ type: 'command', command: hookCmd, async: true }] }];
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
  for (const event of [...SYNC_EVENTS, ...ASYNC_EVENTS]) {
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
      for (const event of [...SYNC_EVENTS, ...ASYNC_EVENTS]) {
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
