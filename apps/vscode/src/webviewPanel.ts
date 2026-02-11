import * as vscode from 'vscode';

export class SynapsePanel {
  private static currentPanel: SynapsePanel | undefined;
  private readonly panel: vscode.WebviewPanel;
  private readonly port: number;
  private disposables: vscode.Disposable[] = [];

  private constructor(panel: vscode.WebviewPanel, port: number) {
    this.panel = panel;
    this.port = port;

    this.panel.webview.html = this.getHtml();

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
  }

  static create(extensionUri: vscode.Uri, port: number): SynapsePanel {
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
      }
    );

    SynapsePanel.currentPanel = new SynapsePanel(panel, port);
    return SynapsePanel.currentPanel;
  }

  private getHtml(): string {
    const url = `http://localhost:${this.port}`;
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none';
             frame-src http://localhost:*;
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
  <iframe id="dashboard" class="hidden" src="${url}"></iframe>
  <script>
    const iframe = document.getElementById('dashboard');
    const loading = document.getElementById('loading');

    iframe.onload = () => {
      iframe.classList.remove('hidden');
      loading.classList.add('hidden');
    };

    // Retry on load failure
    let retries = 0;
    iframe.onerror = () => {
      if (retries++ < 10) {
        setTimeout(() => { iframe.src = '${url}'; }, 1000);
      } else {
        loading.textContent = 'Failed to connect to Synapse server on port ${this.port}';
      }
    };

    // Also retry if iframe stays blank
    setTimeout(() => {
      if (loading.classList.contains('hidden')) return;
      iframe.src = '${url}';
    }, 3000);
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
