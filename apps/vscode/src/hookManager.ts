// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bernhard

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

/**
 * All Synapse hook events. Every hook uses async: true because they are
 * fire-and-forget telemetry — blocking Claude Code on an HTTP POST to the
 * Synapse server causes session hangs when the server is slow or unreachable.
 */
export const HOOK_EVENTS = [
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

/** @deprecated Use HOOK_EVENTS — all hooks are now async. Kept for back-compat. */
export const SYNC_EVENTS = HOOK_EVENTS.slice(0, 6);
/** @deprecated Use HOOK_EVENTS — all hooks are now async. Kept for back-compat. */
export const ASYNC_EVENTS = HOOK_EVENTS.slice(6);

export class HookManager {
  private resourcesPath: string;

  constructor(resourcesPath: string) {
    this.resourcesPath = resourcesPath;
  }

  /** Returns true if the workspace needs Synapse hooks configured (script path changed or missing). */
  needsConfiguration(port: number): boolean {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) return false;

    const claudeDir = path.join(workspaceFolder.uri.fsPath, '.claude');

    // Scrub any Synapse hooks from the GLOBAL ~/.claude/ — they should never exist there.
    // Global hooks affect every Claude Code session and cause hangs when the server is down.
    this.scrubGlobalHooks();

    // Sanitize any blocking hooks before checking — prevents session hangs
    this.sanitizeBlockingHooks(claudeDir);

    // Check repo-level settings.json first — if it already has hooks, skip injection
    const repoSettingsFile = path.join(claudeDir, 'settings.json');
    if (this.fileHasSynapseHooks(repoSettingsFile)) return false;

    // Then check settings.local.json
    const settingsFile = path.join(claudeDir, 'settings.local.json');
    if (!fs.existsSync(settingsFile)) return true;

    try {
      const content = fs.readFileSync(settingsFile, 'utf-8');
      if (!content.includes('send_event.cjs')) return true;
      // Check if hook script path matches current extension (catches stale old-version paths)
      const expectedScript = path
        .join(this.resourcesPath, 'synapse-server', 'hooks', 'send_event.cjs')
        .replace(/\\/g, '/');
      if (!content.includes(expectedScript)) return true;
      // Check if port matches (SYNAPSE_PORT=<port> baked into command)
      if (!content.includes(`SYNAPSE_PORT=${port}`)) return true;
      return false;
    } catch {
      return true;
    }
  }

  /** Check if a settings file already contains send_event.cjs hooks. */
  private fileHasSynapseHooks(filePath: string): boolean {
    if (!fs.existsSync(filePath)) return false;
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      return content.includes('send_event.cjs');
    } catch {
      return false;
    }
  }

  /**
   * Scan both settings.json and settings.local.json for Synapse hooks that
   * could block Claude Code sessions (synchronous HTTP hooks, or command hooks
   * missing async: true). Removes the dangerous hook entries in-place.
   *
   * This prevents the scenario where a stale synchronous PermissionRequest
   * hook (type: "http", timeout: 1800) hangs the session for up to 30 minutes
   * when the hook server is unreachable.
   */
  private sanitizeBlockingHooks(claudeDir: string): void {
    for (const fileName of ['settings.json', 'settings.local.json']) {
      const filePath = path.join(claudeDir, fileName);
      if (!fs.existsSync(filePath)) continue;

      try {
        const settings = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        const hooks = settings.hooks as Record<string, unknown[]> | undefined;
        if (!hooks) continue;

        let modified = false;

        for (const eventName of HOOK_EVENTS) {
          const eventHooks = hooks[eventName];
          if (!Array.isArray(eventHooks)) continue;

          for (const hookGroup of eventHooks) {
            const group = hookGroup as Record<string, unknown>;
            const innerHooks = group.hooks as Array<Record<string, unknown>> | undefined;
            if (!Array.isArray(innerHooks)) continue;

            // Filter out blocking hooks: HTTP hooks or command hooks without async: true
            const safe = innerHooks.filter((h) => {
              // HTTP hooks are always synchronous/blocking — remove them
              if (h.type === 'http') return false;
              // Command hooks without async: true block the session
              if (h.type === 'command' && h.async !== true) return false;
              return true;
            });

            if (safe.length !== innerHooks.length) {
              group.hooks = safe;
              modified = true;
            }
          }
        }

        if (modified) {
          fs.writeFileSync(filePath, JSON.stringify(settings, null, 2));
          vscode.window.showWarningMessage(
            `Synapse: removed blocking hooks from .claude/${fileName} to prevent session hangs`,
          );
        }
      } catch {
        // Can't parse — leave it alone
      }
    }
  }

  /**
   * Remove any Synapse hooks from the global ~/.claude/settings.local.json.
   * Hooks must NEVER be global — they affect every Claude Code session on the
   * machine and cause hangs when the Synapse server isn't running.
   */
  private scrubGlobalHooks(): void {
    const globalSettings = path.join(os.homedir(), '.claude', 'settings.local.json');
    if (!fs.existsSync(globalSettings)) return;

    try {
      const settings = JSON.parse(fs.readFileSync(globalSettings, 'utf-8'));
      const hooks = settings.hooks as Record<string, unknown> | undefined;
      if (!hooks) return;

      let modified = false;
      for (const eventName of HOOK_EVENTS) {
        const eventHooks = hooks[eventName];
        if (!Array.isArray(eventHooks)) continue;

        // Check if any hook references a Synapse script
        const json = JSON.stringify(eventHooks);
        if (json.includes('send_event.cjs') || json.includes('synapse')) {
          delete hooks[eventName];
          modified = true;
        }
      }

      if (modified) {
        if (Object.keys(hooks).length === 0) delete settings.hooks;
        if (Object.keys(settings).length === 0) {
          fs.writeFileSync(globalSettings, '{}');
        } else {
          fs.writeFileSync(globalSettings, JSON.stringify(settings, null, 2));
        }
        vscode.window.showWarningMessage(
          'Synapse: removed global hooks from ~/.claude/settings.local.json — hooks must be project-scoped',
        );
      }
    } catch {
      // Can't parse — leave it alone
    }
  }

  getHookStatus(port: number): {
    configured: boolean;
    port: number | null;
    portMatch: boolean;
    enabledEvents: string[];
  } {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder)
      return { configured: false, port: null, portMatch: false, enabledEvents: [] };

    const settingsFile = path.join(workspaceFolder.uri.fsPath, '.claude', 'settings.local.json');
    if (!fs.existsSync(settingsFile))
      return { configured: false, port: null, portMatch: false, enabledEvents: [] };

    try {
      const content = JSON.parse(fs.readFileSync(settingsFile, 'utf-8'));
      const hooks = content.hooks as Record<string, unknown> | undefined;
      if (!hooks) return { configured: false, port: null, portMatch: false, enabledEvents: [] };

      const allEvents = [...SYNC_EVENTS, ...ASYNC_EVENTS];
      const enabledEvents: string[] = [];
      // Port is now statically known — hook scripts read SYNAPSE_PORT env var (default 27246).
      // No need for port detection from command args or port files.
      const detectedPort = port; // Assume match — port is configured via config.ts

      for (const eventName of allEvents) {
        const eventHooks = hooks[eventName];
        if (Array.isArray(eventHooks) && eventHooks.length > 0) {
          const hookEntry = eventHooks[0] as Record<string, unknown> | undefined;
          const innerHooks = hookEntry?.hooks as Array<Record<string, unknown>> | undefined;
          const cmd = innerHooks?.[0]?.command as string | undefined;
          if (cmd && cmd.includes('send_event.cjs')) {
            enabledEvents.push(eventName);
          }
        }
      }

      return {
        configured: enabledEvents.length > 0,
        port: detectedPort,
        portMatch: detectedPort === port,
        enabledEvents,
      };
    } catch {
      return { configured: false, port: null, portMatch: false, enabledEvents: [] };
    }
  }

  async configureHooks(port: number, enabledEvents?: string[]): Promise<void> {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      vscode.window.showErrorMessage('No workspace folder open');
      return;
    }

    const target = workspaceFolder.uri.fsPath;
    const hookScript = path.join(this.resourcesPath, 'synapse-server', 'hooks', 'send_event.cjs');

    if (!fs.existsSync(hookScript)) {
      vscode.window.showErrorMessage(`Hook script not found: ${hookScript}`);
      return;
    }

    // Bake the port into the command so changing port auto-triggers reconfiguration.
    // Use cross-platform syntax: SET for Windows cmd, inline env var for POSIX shells.
    const normalizedScript = hookScript.replace(/\\/g, '/');
    const hookCmd =
      process.platform === 'win32'
        ? `SET "SYNAPSE_PORT=${port}" && node "${normalizedScript}"`
        : `SYNAPSE_PORT=${port} node "${normalizedScript}"`;
    const claudeDir = path.join(target, '.claude');
    const settingsFile = path.join(claudeDir, 'settings.local.json');

    const syncToEnable = enabledEvents
      ? SYNC_EVENTS.filter((e) => enabledEvents.includes(e))
      : SYNC_EVENTS;
    const asyncToEnable = enabledEvents
      ? ASYNC_EVENTS.filter((e) => enabledEvents.includes(e))
      : ASYNC_EVENTS;

    // Build hooks — all async to avoid blocking Claude Code sessions
    const hooks: Record<string, unknown[]> = {};
    for (const event of [...syncToEnable, ...asyncToEnable]) {
      hooks[event] = [{ hooks: [{ type: 'command', command: hookCmd, async: true }] }];
    }

    // Read existing or create new
    let settings: Record<string, unknown> = {};
    if (fs.existsSync(settingsFile)) {
      try {
        settings = JSON.parse(fs.readFileSync(settingsFile, 'utf-8'));
      } catch {
        /* start fresh */
      }
    }

    // Remove all existing Synapse hook events, then add enabled ones
    const existingHooks = (settings.hooks as Record<string, unknown>) || {};
    for (const event of [...SYNC_EVENTS, ...ASYNC_EVENTS]) {
      delete existingHooks[event];
    }
    settings.hooks = { ...existingHooks, ...hooks };

    fs.mkdirSync(claudeDir, { recursive: true });
    fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2));

    vscode.window.showInformationMessage(`Synapse hooks configured (port ${port})`);
  }

  async removeHooks(silent = false): Promise<void> {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      if (!silent) vscode.window.showErrorMessage('No workspace folder open');
      return;
    }

    const settingsFile = path.join(workspaceFolder.uri.fsPath, '.claude', 'settings.local.json');

    if (!fs.existsSync(settingsFile)) {
      if (!silent) vscode.window.showInformationMessage('No .claude/settings.local.json found');
      return;
    }

    try {
      const settings = JSON.parse(fs.readFileSync(settingsFile, 'utf-8'));
      if (settings.hooks) {
        // Only remove Synapse hook keys, preserve other settings
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
      if (!silent) vscode.window.showInformationMessage('Synapse hooks removed');
    } catch {
      // If we can't parse, leave the file alone
      if (!silent) vscode.window.showWarningMessage('Could not parse settings.local.json');
    }
  }
}
