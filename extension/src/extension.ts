import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { ServerManager } from './serverManager';
import { SynapsePanel } from './webviewPanel';
import { HookManager } from './hookManager';

let serverManager: ServerManager | undefined;
let statusBarItem: vscode.StatusBarItem;

export async function activate(context: vscode.ExtensionContext) {
  const outputChannel = vscode.window.createOutputChannel('Synapse');
  const resourcesPath = path.join(context.extensionPath, 'resources');

  serverManager = new ServerManager(resourcesPath, outputChannel);
  const hookManager = new HookManager(resourcesPath);

  // Status bar
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusBarItem.command = 'synapse.openDashboard';
  updateStatusBar(false);
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);

  // Server events
  serverManager.onStarted(() => {
    updateStatusBar(true);
    vscode.window.showInformationMessage(
      `Synapse running on port ${serverManager!.port}`,
      'Open Dashboard'
    ).then(choice => {
      if (choice === 'Open Dashboard') {
        vscode.commands.executeCommand('synapse.openDashboard');
      }
    });
  });

  serverManager.onStopped(() => {
    updateStatusBar(false);
  });

  serverManager.onError((msg) => {
    vscode.window.showErrorMessage(`Synapse error: ${msg}`);
  });

  // Commands
  context.subscriptions.push(
    vscode.commands.registerCommand('synapse.openDashboard', () => {
      if (!serverManager?.isRunning) {
        vscode.window.showWarningMessage(
          'Synapse server is not running.',
          'Start Server'
        ).then(choice => {
          if (choice === 'Start Server') {
            vscode.commands.executeCommand('synapse.startServer');
          }
        });
        return;
      }
      SynapsePanel.create(context.extensionUri, serverManager.port);
    }),

    vscode.commands.registerCommand('synapse.startServer', async () => {
      // Check that resources are bundled
      const serverDir = path.join(resourcesPath, 'synapse-server');
      if (!fs.existsSync(serverDir)) {
        vscode.window.showErrorMessage(
          'Synapse server resources not found. The extension may not be properly packaged.'
        );
        return;
      }
      await serverManager!.start();
    }),

    vscode.commands.registerCommand('synapse.stopServer', () => {
      serverManager!.stop();
      vscode.window.showInformationMessage('Synapse server stopped');
    }),

    vscode.commands.registerCommand('synapse.configureHooks', () => {
      hookManager.configureHooks();
    }),

    vscode.commands.registerCommand('synapse.removeHooks', () => {
      hookManager.removeHooks();
    })
  );

  context.subscriptions.push(outputChannel);
  context.subscriptions.push({ dispose: () => serverManager?.dispose() });

  // Auto-start if configured and workspace has Claude hooks
  const autoStart = vscode.workspace.getConfiguration('synapse').get('autoStart', true);
  if (autoStart && hasClaude()) {
    outputChannel.appendLine('Claude hooks detected — auto-starting Synapse server...');
    await serverManager.start();
  }
}

export function deactivate() {
  serverManager?.dispose();
}

function updateStatusBar(running: boolean) {
  if (running) {
    statusBarItem.text = '$(pulse) Synapse';
    statusBarItem.tooltip = `Synapse running on port ${serverManager?.port}. Click to open dashboard.`;
    statusBarItem.backgroundColor = undefined;
  } else {
    statusBarItem.text = '$(circle-slash) Synapse';
    statusBarItem.tooltip = 'Synapse stopped. Click to open dashboard.';
    statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
  }
}

function hasClaude(): boolean {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) return false;
  const claudeDir = path.join(workspaceFolder.uri.fsPath, '.claude');
  return (
    fs.existsSync(path.join(claudeDir, 'settings.json')) ||
    fs.existsSync(path.join(claudeDir, 'settings.local.json'))
  );
}
