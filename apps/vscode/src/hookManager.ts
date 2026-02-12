import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

const SYNC_EVENTS = [
  'SessionStart', 'UserPromptSubmit',
  'SubagentStart', 'SubagentStop',
  'Stop', 'SessionEnd',
];

const ASYNC_EVENTS = [
  'PreToolUse', 'PostToolUse', 'PostToolUseFailure',
  'PermissionRequest', 'Notification', 'PreCompact',
];

export class HookManager {
  private resourcesPath: string;

  constructor(resourcesPath: string) {
    this.resourcesPath = resourcesPath;
  }

  /** Returns true if the workspace needs Synapse hooks configured. */
  needsConfiguration(): boolean {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) return false;

    const settingsFile = path.join(workspaceFolder.uri.fsPath, '.claude', 'settings.local.json');
    if (!fs.existsSync(settingsFile)) return true;

    try {
      const content = fs.readFileSync(settingsFile, 'utf-8');
      // Check if our hook script is already referenced
      return !content.includes('send_event.cjs');
    } catch {
      return true;
    }
  }

  async configureHooks(): Promise<void> {
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

    const hookCmd = `node "${hookScript.replace(/\\/g, '/')}"`;
    const claudeDir = path.join(target, '.claude');
    const settingsFile = path.join(claudeDir, 'settings.local.json');

    // Build hooks
    const hooks: Record<string, unknown[]> = {};
    for (const event of SYNC_EVENTS) {
      hooks[event] = [{ hooks: [{ type: 'command', command: hookCmd }] }];
    }
    for (const event of ASYNC_EVENTS) {
      hooks[event] = [{ hooks: [{ type: 'command', command: hookCmd, async: true }] }];
    }

    // Read existing or create new
    let settings: Record<string, unknown> = {};
    if (fs.existsSync(settingsFile)) {
      try {
        settings = JSON.parse(fs.readFileSync(settingsFile, 'utf-8'));
      } catch { /* start fresh */ }
    }

    settings.hooks = { ...((settings.hooks as Record<string, unknown>) || {}), ...hooks };

    fs.mkdirSync(claudeDir, { recursive: true });
    fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2));

    vscode.window.showInformationMessage(`Synapse hooks configured in ${settingsFile}`);
  }

  async removeHooks(silent = false): Promise<void> {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      if (!silent) vscode.window.showErrorMessage('No workspace folder open');
      return;
    }

    const settingsFile = path.join(workspaceFolder.uri.fsPath, '.claude', 'settings.local.json');

    if (fs.existsSync(settingsFile)) {
      try { fs.unlinkSync(settingsFile); } catch { /* ignore on shutdown */ }
      if (!silent) vscode.window.showInformationMessage('Synapse hooks removed');
    } else {
      if (!silent) vscode.window.showInformationMessage('No .claude/settings.local.json found');
    }
  }
}
