import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

export const SYNC_EVENTS = [
  'SessionStart', 'UserPromptSubmit',
  'SubagentStart', 'SubagentStop',
  'Stop', 'SessionEnd',
];

export const ASYNC_EVENTS = [
  'PreToolUse', 'PostToolUse', 'PostToolUseFailure',
  'PermissionRequest', 'Notification', 'PreCompact',
];

export class HookManager {
  private resourcesPath: string;

  constructor(resourcesPath: string) {
    this.resourcesPath = resourcesPath;
  }

  /** Returns true if the workspace needs Synapse hooks configured (or port changed). */
  needsConfiguration(port: number): boolean {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) return false;

    const settingsFile = path.join(workspaceFolder.uri.fsPath, '.claude', 'settings.local.json');
    if (!fs.existsSync(settingsFile)) return true;

    try {
      const content = fs.readFileSync(settingsFile, 'utf-8');
      if (!content.includes('send_event.cjs')) return true;
      // Check if port matches
      if (!content.includes(`--port ${port}`)) return true;
      return false;
    } catch {
      return true;
    }
  }

  getHookStatus(port: number): {
    configured: boolean;
    port: number | null;
    portMatch: boolean;
    enabledEvents: string[];
  } {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) return { configured: false, port: null, portMatch: false, enabledEvents: [] };

    const settingsFile = path.join(workspaceFolder.uri.fsPath, '.claude', 'settings.local.json');
    if (!fs.existsSync(settingsFile)) return { configured: false, port: null, portMatch: false, enabledEvents: [] };

    try {
      const content = JSON.parse(fs.readFileSync(settingsFile, 'utf-8'));
      const hooks = content.hooks as Record<string, unknown> | undefined;
      if (!hooks) return { configured: false, port: null, portMatch: false, enabledEvents: [] };

      const allEvents = [...SYNC_EVENTS, ...ASYNC_EVENTS];
      const enabledEvents: string[] = [];
      let detectedPort: number | null = null;

      for (const eventName of allEvents) {
        const eventHooks = hooks[eventName];
        if (Array.isArray(eventHooks) && eventHooks.length > 0) {
          const hookEntry = eventHooks[0] as Record<string, unknown> | undefined;
          const innerHooks = hookEntry?.hooks as Array<Record<string, unknown>> | undefined;
          const cmd = innerHooks?.[0]?.command as string | undefined;
          if (cmd && cmd.includes('send_event.cjs')) {
            enabledEvents.push(eventName);
            if (detectedPort === null) {
              const match = cmd.match(/--port\s+(\d+)/);
              if (match) detectedPort = parseInt(match[1], 10);
            }
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

    const hookCmd = `node "${hookScript.replace(/\\/g, '/')}" --port ${port}`;
    const claudeDir = path.join(target, '.claude');
    const settingsFile = path.join(claudeDir, 'settings.local.json');

    const syncToEnable = enabledEvents
      ? SYNC_EVENTS.filter(e => enabledEvents.includes(e))
      : SYNC_EVENTS;
    const asyncToEnable = enabledEvents
      ? ASYNC_EVENTS.filter(e => enabledEvents.includes(e))
      : ASYNC_EVENTS;

    // Build hooks
    const hooks: Record<string, unknown[]> = {};
    for (const event of syncToEnable) {
      hooks[event] = [{ hooks: [{ type: 'command', command: hookCmd }] }];
    }
    for (const event of asyncToEnable) {
      hooks[event] = [{ hooks: [{ type: 'command', command: hookCmd, async: true }] }];
    }

    // Read existing or create new
    let settings: Record<string, unknown> = {};
    if (fs.existsSync(settingsFile)) {
      try {
        settings = JSON.parse(fs.readFileSync(settingsFile, 'utf-8'));
      } catch { /* start fresh */ }
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
