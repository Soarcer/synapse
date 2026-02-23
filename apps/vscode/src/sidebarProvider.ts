// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Synapse Contributors

import * as vscode from 'vscode';
import { executeForwardedKeybinding } from './keybindings';

type SelectionHandler = (nodeId: string | null, source?: string | null) => void;
type VoidHandler = () => void;

export class SynapseSidebarProvider implements vscode.WebviewViewProvider {
  static readonly viewType = 'synapseSidebarView';
  private _view?: vscode.WebviewView;
  private _port: number;
  private _cwd: string | undefined;
  private _onSelectionChanged: SelectionHandler | undefined;
  private _onIframeReady: VoidHandler | undefined;

  constructor(port: number, cwd?: string) {
    this._port = port;
    this._cwd = cwd;
  }

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ): void {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
    };

    webviewView.webview.html = this.getHtml();

    // Listen for messages from the webview (iframe → extension)
    webviewView.webview.onDidReceiveMessage((message) => {
      if (message.type === 'selectionChanged' && this._onSelectionChanged) {
        this._onSelectionChanged(message.nodeId ?? null, message.source ?? null);
      }
      if (message.type === 'iframeReady' && this._onIframeReady) {
        this._onIframeReady();
      }
      if (message.type === 'openGraphPanel') {
        vscode.commands.executeCommand('synapse.openDashboard');
      }
      if (message.type === 'openGraphInBrowser') {
        vscode.commands.executeCommand('synapse.openInBrowser');
      }
      if (message.type === 'forwardKeydown') {
        executeForwardedKeybinding(message);
      }
      if (message.type === 'clipboardWrite' && typeof message.text === 'string') {
        vscode.env.clipboard.writeText(message.text);
      }
    });

    webviewView.onDidDispose(() => {
      this._view = undefined;
    });
  }

  updatePort(port: number): void {
    this._port = port;
    if (this._view) {
      this._view.webview.html = this.getHtml();
    }
  }

  postMessage(message: unknown): void {
    this._view?.webview.postMessage(message);
  }

  /** Register a callback for when the user selects a node in the sidebar */
  onSelectionChanged(handler: SelectionHandler): void {
    this._onSelectionChanged = handler;
  }

  /** Register a callback for when the iframe signals readiness */
  onIframeReady(handler: VoidHandler): void {
    this._onIframeReady = handler;
  }

  private getHtml(): string {
    const params = new URLSearchParams({ view: 'lens' });
    if (this._cwd)
      params.set('cwd', this._cwd.replace(/\\/g, '/').replace(/\/$/, '').toLowerCase());
    const url = `http://localhost:${this._port}?${params.toString()}`;
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none';
             frame-src http://localhost:*;
             script-src 'unsafe-inline';
             style-src 'unsafe-inline';">
  <title>Synapse Sidebar</title>
  <style>
    html, body {
      margin: 0;
      padding: 0;
      width: 100%;
      height: 100%;
      overflow: hidden;
      background: var(--vscode-sideBar-background, #0d1117);
    }
    iframe {
      width: 100%;
      height: 100%;
      border: none;
    }
    .loading {
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100%;
      color: var(--vscode-descriptionForeground, #8b949e);
      font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif);
      font-size: 12px;
      text-align: center;
      padding: 16px;
    }
    .loading.hidden { display: none; }
    iframe.hidden { display: none; }
  </style>
</head>
<body>
  <div id="loading" class="loading">Connecting to Synapse...</div>
  <iframe id="dashboard" class="hidden" src="${url}" allow="clipboard-write"></iframe>
  <script>
    const iframe = document.getElementById('dashboard');
    const loading = document.getElementById('loading');
    const vscodeApi = acquireVsCodeApi();

    iframe.onload = () => {
      iframe.classList.remove('hidden');
      loading.classList.add('hidden');
      vscodeApi.postMessage({ type: 'iframeReady' });
    };

    // Retry on load failure
    let retries = 0;
    iframe.onerror = () => {
      if (retries++ < 10) {
        setTimeout(() => { iframe.src = '${url}'; }, 1000);
      } else {
        loading.textContent = 'Failed to connect to Synapse on port ${this._port}';
      }
    };

    // Also retry if iframe stays blank after initial delay
    setTimeout(() => {
      if (loading.classList.contains('hidden')) return;
      iframe.src = '${url}';
    }, 3000);

    // Bidirectional message relay: extension ↔ iframe
    window.addEventListener('message', (event) => {
      const message = event.data;
      if (!message || typeof message !== 'object') return;
      // Forward extension → iframe
      if ((['switchLens', 'selectNode', 'synapseEvent', 'hydrateEvents'].includes(message.type)) && iframe.contentWindow) {
        iframe.contentWindow.postMessage(message, '*');
      }
      // Forward iframe → extension (selection changes, commands, clipboard)
      if (message.type === 'selectionChanged' || message.type === 'openGraphPanel' || message.type === 'openGraphInBrowser' || message.type === 'clipboardWrite') {
        vscodeApi.postMessage(message);
      }
      // Forward keyboard shortcuts from iframe to extension host → VS Code commands
      if (message.type === 'forwardKeydown') {
        vscodeApi.postMessage(message);
      }
    });
  </script>
</body>
</html>`;
  }
}
