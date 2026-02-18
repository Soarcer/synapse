import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as http from 'http';
import { ServerManager } from './serverManager';
import { SynapsePanel } from './webviewPanel';
import { HookManager } from './hookManager';
import { SynapseTreeProvider } from './treeView';
import { ExtensionWsClient } from './wsClient';
import { SynapseSidebarProvider } from './sidebarProvider';
import { SettingsPanel } from './settingsPanel';
import { normalizeCwd } from '@synapse-ai/core';

let serverManager: ServerManager | undefined;
let hookManager: HookManager | undefined;
let statusBarItem: vscode.StatusBarItem;
let wsClient: ExtensionWsClient | undefined;
let treeProvider: SynapseTreeProvider | undefined;
let graphPanel: SynapsePanel | undefined;
let sidebarProvider: SynapseSidebarProvider;
let settingsPanel: SettingsPanel | undefined;
let workspaceCwd: string | undefined;

export async function activate(context: vscode.ExtensionContext) {
  const outputChannel = vscode.window.createOutputChannel('Synapse');
  const resourcesPath = path.join(context.extensionPath, 'resources');
  workspaceCwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

  serverManager = new ServerManager(resourcesPath, outputChannel);
  hookManager = new HookManager(resourcesPath);

  // ── TreeView ───────────────────────────────────────────────────
  treeProvider = new SynapseTreeProvider();
  const treeView = vscode.window.createTreeView('synapseExplorer', {
    treeDataProvider: treeProvider,
    showCollapseAll: true,
  });
  context.subscriptions.push(treeView);
  context.subscriptions.push(treeProvider);

  // ── Sidebar WebView ────────────────────────────────────────────
  sidebarProvider = new SynapseSidebarProvider(serverManager.port, workspaceCwd);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(SynapseSidebarProvider.viewType, sidebarProvider),
  );

  // Cross-panel sync: sidebar selection → graph panel
  sidebarProvider.onSelectionChanged((nodeId) => {
    graphPanel?.postSelectNode(nodeId);
  });

  // Re-hydrate iframes when they signal readiness (they may load after WS connects)
  sidebarProvider.onIframeReady(() => {
    if (serverManager?.port) debouncedHydrateIframes(serverManager.port);
  });

  // ── Status bar ─────────────────────────────────────────────────
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusBarItem.command = 'synapse.openDashboard';
  updateStatusBar(false);
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);

  // ── Server events ──────────────────────────────────────────────
  serverManager.onStarted(() => {
    const port = serverManager!.port;
    vscode.commands.executeCommand('setContext', 'synapse.serverRunning', true);
    updateStatusBar(true);
    sidebarProvider.updatePort(port);
    connectWsClient(context, port);

    // Configure hooks with the actual port (may differ from default if port was busy)
    if (hookManager!.needsConfiguration(port)) {
      outputChannel.appendLine(`Configuring hooks for port ${port}...`);
      hookManager!.configureHooks(port);
    }

    vscode.commands.executeCommand('synapse.openDashboard');
  });

  serverManager.onStopped(() => {
    vscode.commands.executeCommand('setContext', 'synapse.serverRunning', false);
    updateStatusBar(false);
    treeProvider?.clear();
    wsClient?.dispose();
    wsClient = undefined;
  });

  serverManager.onError((msg) => {
    vscode.window.showErrorMessage(`Synapse error: ${msg}`);
  });

  // ── Commands ───────────────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand('synapse.openDashboard', async () => {
      const port = serverManager?.port ?? 4000;
      // Check if server is reachable (covers both extension-managed and externally started servers)
      const reachable = await checkServerHealth(port);
      if (!reachable) {
        vscode.window
          .showWarningMessage('Synapse server is not running.', 'Start Server')
          .then((choice) => {
            if (choice === 'Start Server') {
              vscode.commands.executeCommand('synapse.startServer');
            }
          });
        return;
      }

      // Read layout setting: "split" → graph-only in editor, "single" → full dashboard
      const layout = vscode.workspace.getConfiguration('synapse').get<string>('layout', 'split');
      const viewParam = layout === 'split' ? 'graph' : '';
      graphPanel = SynapsePanel.create(context.extensionUri, port, viewParam, workspaceCwd);

      // Cross-panel sync: graph panel selection → sidebar
      graphPanel.onSelectionChanged((nodeId) => {
        sidebarProvider.postMessage({ type: 'selectNode', nodeId });
      });

      // Re-hydrate graph panel when its iframe is ready
      graphPanel.onIframeReady(() => {
        if (serverManager?.port) debouncedHydrateIframes(serverManager.port);
      });
    }),

    vscode.commands.registerCommand('synapse.startServer', async () => {
      const serverEntry = path.join(resourcesPath, 'synapse-server', 'server.mjs');
      if (!fs.existsSync(serverEntry)) {
        vscode.window.showErrorMessage(
          'Synapse server bundle not found. The extension may not be properly packaged. ' +
          `Expected: ${serverEntry}`,
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
      hookManager!.configureHooks(serverManager!.port);
    }),

    vscode.commands.registerCommand('synapse.removeHooks', () => {
      hookManager!.removeHooks();
    }),

    vscode.commands.registerCommand('synapse.switchLens', async () => {
      const lenses = ['Graph', 'Timeline', 'List', 'Tools', 'Agents'];
      const picked = await vscode.window.showQuickPick(lenses, {
        placeHolder: 'Select a lens view',
      });
      if (picked) {
        sidebarProvider.postMessage({ type: 'switchLens', lens: picked.toLowerCase() });
      }
    }),

    vscode.commands.registerCommand('synapse.reconnect', async () => {
      if (!serverManager?.isRunning) {
        vscode.window.showWarningMessage('Synapse server is not running.');
        return;
      }
      wsClient?.dispose();
      wsClient = undefined;
      connectWsClient(context, serverManager.port);
      vscode.window.showInformationMessage('Reconnecting to Synapse server...');
    }),

    vscode.commands.registerCommand('synapse.openSettings', () => {
      settingsPanel = SettingsPanel.create(
        context.extensionUri,
        serverManager!,
        hookManager!,
      );
    }),

    vscode.commands.registerCommand('synapse.sendToClaudeTerminal', (text: string) => {
      if (!text || typeof text !== 'string') {
        vscode.window.showWarningMessage('No text provided to send to Claude terminal.');
        return;
      }

      const claudeTerminal = findClaudeTerminal();
      if (!claudeTerminal) {
        // Fallback: copy to clipboard and inform user
        vscode.env.clipboard.writeText(text);
        vscode.window.showInformationMessage(
          'No Claude Code terminal found. The prompt has been copied to your clipboard.',
        );
        return;
      }

      claudeTerminal.show();
      // sendText with false = types text WITHOUT pressing Enter, so user can review
      claudeTerminal.sendText(text, false);
      vscode.window.showInformationMessage('Prompt sent to Claude terminal. Press Enter to submit.');
    }),
  );

  context.subscriptions.push(outputChannel);
  context.subscriptions.push({
    dispose: () => {
      wsClient?.dispose();
      settingsPanel?.dispose();
      serverManager?.dispose();
    },
  });

  // Auto-start server (hooks are configured in the onStarted callback once port is known)
  // Fire-and-forget to avoid blocking extension activation
  const autoStart = vscode.workspace.getConfiguration('synapse').get('autoStart', true);
  if (autoStart) {
    outputChannel.appendLine('Auto-starting Synapse server...');
    serverManager.start().catch((err) => {
      outputChannel.appendLine(`Server start error: ${err instanceof Error ? err.message : String(err)}`);
    });
  } else {
    // Check if an external server is already running and auto-open
    const port = serverManager.port;
    const reachable = await checkServerHealth(port);
    if (reachable) {
      vscode.commands.executeCommand('setContext', 'synapse.serverRunning', true);
      updateStatusBar(true);
      connectWsClient(context, port);
      vscode.commands.executeCommand('synapse.openDashboard');
    }
  }
}

export async function deactivate() {
  wsClient?.dispose();
  if (serverManager?.isRunning) {
    serverManager.stop();
    // Wait up to 5s for graceful shutdown
    await Promise.race([
      serverManager.waitForExit(),
      new Promise((r) => setTimeout(r, 5000)),
    ]);
  }
  serverManager?.dispose();
  // Don't remove hooks on deactivate — they survive VS Code restarts.
  // Hooks are only removed via the explicit synapse.removeHooks command.
}

function connectWsClient(context: vscode.ExtensionContext, port: number): void {
  wsClient = new ExtensionWsClient(port);

  wsClient.onEvent((event) => {
    treeProvider?.handleEvent(event);
    updateStatusBarMetrics();
    // Relay event to both iframes
    const msg = { type: 'synapseEvent', data: event };
    sidebarProvider.postMessage(msg);
    graphPanel?.postMessage(msg);
  });

  wsClient.onConnected(() => {
    updateStatusBarMetrics();
    debouncedHydrateIframes(port);
  });

  wsClient.onTerminalSend((text) => {
    vscode.commands.executeCommand('synapse.sendToClaudeTerminal', text);
  });

  context.subscriptions.push(wsClient);
  wsClient.connect();
}

let hydrateTimer: ReturnType<typeof setTimeout> | undefined;
function debouncedHydrateIframes(port: number): void {
  if (hydrateTimer) clearTimeout(hydrateTimer);
  hydrateTimer = setTimeout(() => { fetchAndHydrateIframes(port); }, 2000);
}

async function fetchAndHydrateIframes(port: number): Promise<void> {
  try {
    const cwdParam = workspaceCwd ? `&cwd=${encodeURIComponent(normalizeCwd(workspaceCwd))}` : '';
    const body = await new Promise<string>((resolve, reject) => {
      const req = http.get(`http://localhost:${port}/api/events?limit=2000${cwdParam}`, (res) => {
        let data = '';
        res.on('data', (chunk: Buffer) => { data += chunk.toString(); });
        res.on('end', () => resolve(data));
      });
      req.on('error', reject);
      req.setTimeout(5000, () => { req.destroy(); reject(new Error('timeout')); });
    });
    const parsed = JSON.parse(body);
    const events = Array.isArray(parsed) ? parsed : parsed?.events;
    if (Array.isArray(events)) {
      const msg = { type: 'hydrateEvents', events };
      sidebarProvider.postMessage(msg);
      graphPanel?.postMessage(msg);
    }
  } catch {
    // Server not ready yet; iframes will show loading state
  }
}

function updateStatusBar(running: boolean) {
  if (running) {
    updateStatusBarMetrics();
    statusBarItem.tooltip = `Synapse running on port ${serverManager?.port}. Click to open dashboard.`;
    statusBarItem.backgroundColor = undefined;
  } else {
    statusBarItem.text = '$(circle-slash) Synapse';
    statusBarItem.tooltip = 'Synapse stopped. Click to open dashboard.';
    statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
  }
}

function updateStatusBarMetrics() {
  if (!treeProvider) {
    statusBarItem.text = '$(pulse) Synapse';
    return;
  }
  const { agentCount, toolCallCount } = treeProvider.getMetrics();
  if (agentCount === 0) {
    statusBarItem.text = '$(pulse) Synapse';
  } else {
    statusBarItem.text = `$(pulse) ${agentCount} agent${agentCount !== 1 ? 's' : ''} | ${toolCallCount} tools`;
  }
}

function findClaudeTerminal(): vscode.Terminal | undefined {
  // Look for terminal named "Claude" (set by Claude Code VS Code extension)
  for (const terminal of vscode.window.terminals) {
    const name = terminal.name.toLowerCase();
    if (name.includes('claude')) return terminal;
  }
  return undefined;
}

function checkServerHealth(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(`http://localhost:${port}/api/health`, (res) => {
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(2000, () => {
      req.destroy();
      resolve(false);
    });
  });
}
