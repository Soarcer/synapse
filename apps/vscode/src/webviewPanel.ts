import * as vscode from 'vscode';
import { executeForwardedKeybinding } from './keybindings';

type SelectionHandler = (nodeId: string | null) => void;
type VoidHandler = () => void;

export class SynapsePanel {
  private static currentPanel: SynapsePanel | undefined;
  private readonly panel: vscode.WebviewPanel;
  private readonly port: number;
  private readonly viewParam: string;
  private readonly cwd: string | undefined;
  private disposables: vscode.Disposable[] = [];
  private _onSelectionChanged: SelectionHandler | undefined;
  private _onIframeReady: VoidHandler | undefined;

  private constructor(panel: vscode.WebviewPanel, port: number, viewParam: string, cwd?: string) {
    this.panel = panel;
    this.port = port;
    this.viewParam = viewParam;
    this.cwd = cwd;

    this.panel.webview.html = this.getHtml();

    // Listen for messages from the iframe
    this.panel.webview.onDidReceiveMessage(
      (message) => {
        if (message.type === 'selectionChanged' && this._onSelectionChanged) {
          this._onSelectionChanged(message.nodeId ?? null);
        }
        if (message.type === 'iframeReady' && this._onIframeReady) {
          this._onIframeReady();
        }
        if (message.type === 'forwardKeydown') {
          executeForwardedKeybinding(message);
        }
        if (message.type === 'clipboardWrite' && typeof message.text === 'string') {
          vscode.env.clipboard.writeText(message.text);
        }
      },
      null,
      this.disposables,
    );

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
  }

  static create(extensionUri: vscode.Uri, port: number, viewParam = '', cwd?: string): SynapsePanel {
    if (SynapsePanel.currentPanel) {
      SynapsePanel.currentPanel.panel.reveal(vscode.ViewColumn.One);
      return SynapsePanel.currentPanel;
    }

    const panel = vscode.window.createWebviewPanel(
      'synapseDashboard',
      'Synapse Dashboard',
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
      },
    );

    SynapsePanel.currentPanel = new SynapsePanel(panel, port, viewParam, cwd);
    return SynapsePanel.currentPanel;
  }

  /** Register a callback for when the user selects a node in the graph */
  onSelectionChanged(handler: SelectionHandler): void {
    this._onSelectionChanged = handler;
  }

  /** Forward a selectNode message into the iframe */
  postSelectNode(nodeId: string | null): void {
    this.panel.webview.postMessage({ type: 'selectNode', nodeId });
  }

  /** Forward any message to the iframe */
  postMessage(message: unknown): void {
    this.panel.webview.postMessage(message);
  }

  /** Register a callback for when the iframe signals readiness */
  onIframeReady(handler: VoidHandler): void {
    this._onIframeReady = handler;
  }

  private getHtml(): string {
    const params = new URLSearchParams();
    if (this.viewParam) params.set('view', this.viewParam);
    if (this.cwd) params.set('cwd', this.cwd.replace(/\\/g, '/').replace(/\/$/, '').toLowerCase());
    const query = params.toString() ? `?${params.toString()}` : '';
    const url = `http://localhost:${this.port}${query}`;
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
  <title>Synapse Dashboard</title>
  <style>
    html, body {
      margin: 0;
      padding: 0;
      width: 100%;
      height: 100%;
      overflow: hidden;
      background: #0d1117;
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
      color: #8b949e;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
      font-size: 14px;
    }
    .loading.hidden { display: none; }
    iframe.hidden { display: none; }
  </style>
</head>
<body>
  <div id="loading" class="loading">Starting Synapse dashboard...</div>
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

    let retries = 0;
    iframe.onerror = () => {
      if (retries++ < 10) {
        setTimeout(() => { iframe.src = '${url}'; }, 1000);
      } else {
        loading.textContent = 'Failed to connect to Synapse server on port ${this.port}';
      }
    };

    setTimeout(() => {
      if (loading.classList.contains('hidden')) return;
      iframe.src = '${url}';
    }, 3000);

    // Bidirectional message relay: extension ↔ iframe
    window.addEventListener('message', (event) => {
      const msg = event.data;
      if (!msg || typeof msg !== 'object') return;
      // Extension → iframe
      if ((msg.type === 'selectNode' || msg.type === 'synapseEvent' || msg.type === 'hydrateEvents') && iframe.contentWindow) {
        iframe.contentWindow.postMessage(msg, '*');
      }
      // iframe → extension
      if (msg.type === 'selectionChanged' || msg.type === 'clipboardWrite') {
        vscodeApi.postMessage(msg);
      }
      // Forward keyboard shortcuts from iframe to extension host → VS Code commands
      if (msg.type === 'forwardKeydown') {
        vscodeApi.postMessage(msg);
      }
    });
  </script>
</body>
</html>`;
  }

  dispose(): void {
    SynapsePanel.currentPanel = undefined;
    this.panel.dispose();
    for (const d of this.disposables) {
      d.dispose();
    }
  }
}
