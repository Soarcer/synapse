import * as vscode from 'vscode';
import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import { ServerManager } from './serverManager';
import { HookManager, SYNC_EVENTS, ASYNC_EVENTS } from './hookManager';

export class SettingsPanel {
  private static currentPanel: SettingsPanel | undefined;
  private readonly panel: vscode.WebviewPanel;
  private readonly serverManager: ServerManager;
  private readonly hookManager: HookManager;
  private disposables: vscode.Disposable[] = [];
  private healthPollTimer: ReturnType<typeof setInterval> | undefined;

  private constructor(
    panel: vscode.WebviewPanel,
    serverManager: ServerManager,
    hookManager: HookManager,
  ) {
    this.panel = panel;
    this.serverManager = serverManager;
    this.hookManager = hookManager;

    this.panel.webview.html = this.getHtml();

    this.panel.webview.onDidReceiveMessage(
      (msg) => this.handleMessage(msg),
      null,
      this.disposables,
    );

    this.panel.onDidChangeViewState(
      (e) => {
        if (e.webviewPanel.visible) {
          this.startHealthPoll();
        } else {
          this.stopHealthPoll();
        }
      },
      null,
      this.disposables,
    );

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);

    this.startHealthPoll();
  }

  static create(
    _extensionUri: vscode.Uri,
    serverManager: ServerManager,
    hookManager: HookManager,
  ): SettingsPanel {
    if (SettingsPanel.currentPanel) {
      SettingsPanel.currentPanel.panel.reveal(vscode.ViewColumn.One);
      return SettingsPanel.currentPanel;
    }

    const panel = vscode.window.createWebviewPanel(
      'synapseSettings',
      'Synapse Settings',
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
      },
    );

    SettingsPanel.currentPanel = new SettingsPanel(panel, serverManager, hookManager);
    return SettingsPanel.currentPanel;
  }

  dispose(): void {
    SettingsPanel.currentPanel = undefined;
    this.stopHealthPoll();
    this.panel.dispose();
    for (const d of this.disposables) d.dispose();
    this.disposables = [];
  }

  // ── Message Handler ──────────────────────────────────────────────

  private async handleMessage(msg: Record<string, unknown>): Promise<void> {
    switch (msg.type) {
      // Hook Management
      case 'getHookStatus': {
        const status = this.hookManager.getHookStatus(this.serverManager.port);
        this.panel.webview.postMessage({
          type: 'hookStatus',
          data: {
            ...status,
            allSyncEvents: SYNC_EVENTS,
            allAsyncEvents: ASYNC_EVENTS,
          },
        });
        break;
      }
      case 'configureHooks': {
        const events = msg.enabledEvents as string[] | undefined;
        await this.hookManager.configureHooks(this.serverManager.port, events);
        // Refresh status after configure
        const status = this.hookManager.getHookStatus(this.serverManager.port);
        this.panel.webview.postMessage({
          type: 'hookStatus',
          data: { ...status, allSyncEvents: SYNC_EVENTS, allAsyncEvents: ASYNC_EVENTS },
        });
        break;
      }
      case 'removeHooks': {
        await this.hookManager.removeHooks();
        const status = this.hookManager.getHookStatus(this.serverManager.port);
        this.panel.webview.postMessage({
          type: 'hookStatus',
          data: { ...status, allSyncEvents: SYNC_EVENTS, allAsyncEvents: ASYNC_EVENTS },
        });
        break;
      }
      case 'repairHooks': {
        await this.hookManager.configureHooks(this.serverManager.port);
        const status = this.hookManager.getHookStatus(this.serverManager.port);
        this.panel.webview.postMessage({
          type: 'hookStatus',
          data: { ...status, allSyncEvents: SYNC_EVENTS, allAsyncEvents: ASYNC_EVENTS },
        });
        this.panel.webview.postMessage({
          type: 'actionResult',
          action: 'repairHooks',
          success: true,
          message: 'Hooks repaired successfully',
        });
        break;
      }

      // Server Diagnostics
      case 'getServerHealth':
        await this.fetchHealthAndSend();
        break;
      case 'startServer':
        await this.serverManager.start();
        await this.fetchHealthAndSend();
        break;
      case 'stopServer':
        this.serverManager.stop();
        this.panel.webview.postMessage({
          type: 'serverHealth',
          data: null,
        });
        break;
      case 'restartServer':
        await this.serverManager.restart();
        await this.fetchHealthAndSend();
        break;

      // Display Preferences
      case 'getAllSettings': {
        const config = vscode.workspace.getConfiguration('synapse');
        const keys = [
          'port', 'autoStart', 'layout', 'animationSpeed', 'defaultLens',
          'nodeLabelDensity', 'edgeStyle', 'autoZoom', 'themeOverride', 'maxEvents',
        ];
        const data: Record<string, unknown> = {};
        for (const k of keys) data[k] = config.get(k);
        this.panel.webview.postMessage({ type: 'allSettings', data });
        break;
      }
      case 'setSetting': {
        const key = msg.key as string;
        const value = msg.value;
        await vscode.workspace.getConfiguration('synapse').update(key, value, vscode.ConfigurationTarget.Global);
        break;
      }

      // Data Management
      case 'clearAllEvents':
        await this.proxyDelete(`/api/events`);
        this.panel.webview.postMessage({
          type: 'actionResult', action: 'clearAllEvents', success: true, message: 'All events cleared',
        });
        break;
      case 'clearSession':
        await this.proxyDelete(`/api/events/session/${msg.sessionId}`);
        await this.fetchSessionsAndSend();
        break;
      case 'getSessions':
        await this.fetchSessionsAndSend();
        break;
      case 'exportData':
        await this.exportData();
        break;
    }
  }

  // ── Server API Proxies ───────────────────────────────────────────

  private async fetchHealthAndSend(): Promise<void> {
    if (!this.serverManager.isRunning) {
      this.panel.webview.postMessage({ type: 'serverHealth', data: null });
      return;
    }
    try {
      const body = await this.httpGet(`/api/health`);
      const health = JSON.parse(body);
      this.panel.webview.postMessage({
        type: 'serverHealth',
        data: {
          running: true,
          port: this.serverManager.port,
          uptime: this.serverManager.uptime,
          clients: health.clients ?? 0,
          agents: health.agents ?? 0,
          totalEvents: health.db?.totalEvents ?? 0,
          totalSessions: health.db?.totalSessions ?? 0,
          dbSizeBytes: health.db?.dbSizeBytes ?? 0,
        },
      });
    } catch {
      this.panel.webview.postMessage({ type: 'serverHealth', data: null });
    }
  }

  private async fetchSessionsAndSend(): Promise<void> {
    try {
      const body = await this.httpGet(`/api/events/sessions`);
      const sessions = JSON.parse(body);
      this.panel.webview.postMessage({ type: 'sessions', data: Array.isArray(sessions) ? sessions : [] });
    } catch {
      this.panel.webview.postMessage({ type: 'sessions', data: [] });
    }
  }

  private async exportData(): Promise<void> {
    try {
      const body = await this.httpGet(`/api/events?limit=2000`);
      const uri = await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.file('synapse-export.json'),
        filters: { 'JSON': ['json'] },
      });
      if (uri) {
        fs.writeFileSync(uri.fsPath, body, 'utf-8');
        this.panel.webview.postMessage({
          type: 'actionResult', action: 'exportData', success: true, message: `Exported to ${path.basename(uri.fsPath)}`,
        });
      }
    } catch (err) {
      this.panel.webview.postMessage({
        type: 'actionResult', action: 'exportData', success: false, message: String(err),
      });
    }
  }

  private httpGet(urlPath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const req = http.get(`http://localhost:${this.serverManager.port}${urlPath}`, (res) => {
        let data = '';
        res.on('data', (chunk: Buffer) => { data += chunk.toString(); });
        res.on('end', () => resolve(data));
      });
      req.on('error', reject);
      req.setTimeout(5000, () => { req.destroy(); reject(new Error('timeout')); });
    });
  }

  private proxyDelete(urlPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const req = http.request(
        `http://localhost:${this.serverManager.port}${urlPath}`,
        { method: 'DELETE' },
        (res) => {
          res.resume();
          res.on('end', () => resolve());
        },
      );
      req.on('error', reject);
      req.setTimeout(5000, () => { req.destroy(); reject(new Error('timeout')); });
      req.end();
    });
  }

  // ── Health Polling ───────────────────────────────────────────────

  private startHealthPoll(): void {
    this.stopHealthPoll();
    this.fetchHealthAndSend();
    this.healthPollTimer = setInterval(() => this.fetchHealthAndSend(), 5000);
  }

  private stopHealthPoll(): void {
    if (this.healthPollTimer) {
      clearInterval(this.healthPollTimer);
      this.healthPollTimer = undefined;
    }
  }

  // ── HTML Generation ──────────────────────────────────────────────

  private getHtml(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline';">
  <title>Synapse Settings</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
      padding: 0;
    }

    /* ── Tab Bar ── */
    .tab-bar {
      display: flex;
      border-bottom: 1px solid var(--vscode-panel-border);
      background: var(--vscode-sideBar-background, var(--vscode-editor-background));
      position: sticky;
      top: 0;
      z-index: 10;
    }
    .tab {
      padding: 10px 20px;
      cursor: pointer;
      border-bottom: 2px solid transparent;
      color: var(--vscode-descriptionForeground);
      font-size: 13px;
      font-weight: 500;
      transition: color 0.15s, border-color 0.15s;
    }
    .tab:hover { color: var(--vscode-foreground); }
    .tab.active {
      color: var(--vscode-foreground);
      border-bottom-color: var(--vscode-focusBorder);
    }

    /* ── Content ── */
    .tab-content { display: none; padding: 20px; max-width: 720px; }
    .tab-content.active { display: block; }

    /* ── Cards ── */
    .card {
      background: var(--vscode-sideBar-background, var(--vscode-editor-background));
      border: 1px solid var(--vscode-panel-border);
      border-radius: 6px;
      padding: 16px;
      margin-bottom: 16px;
    }
    .card h3 {
      font-size: 13px;
      font-weight: 600;
      margin-bottom: 12px;
      color: var(--vscode-foreground);
    }

    /* ── Status Badges ── */
    .status-row {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 12px;
    }
    .status-dot {
      width: 10px; height: 10px;
      border-radius: 50%;
      flex-shrink: 0;
    }
    .status-dot.green { background: #3fb950; }
    .status-dot.red { background: #f85149; }
    .status-dot.yellow { background: #d29922; }
    .status-label { font-size: 13px; }

    /* ── Metrics Grid ── */
    .metrics-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 12px;
    }
    .metric-card {
      background: var(--vscode-editor-background);
      border: 1px solid var(--vscode-panel-border);
      border-radius: 4px;
      padding: 12px;
      text-align: center;
    }
    .metric-value {
      font-size: 20px;
      font-weight: 700;
      color: var(--vscode-foreground);
    }
    .metric-label {
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
      margin-top: 4px;
    }

    /* ── Buttons ── */
    button {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border: none;
      padding: 6px 14px;
      border-radius: 4px;
      cursor: pointer;
      font-size: 12px;
      font-family: inherit;
    }
    button:hover { background: var(--vscode-button-hoverBackground); }
    button.secondary {
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
    }
    button.secondary:hover { background: var(--vscode-button-secondaryHoverBackground); }
    button.danger {
      background: var(--vscode-inputValidation-errorBackground, #5a1d1d);
      color: var(--vscode-errorForeground, #f85149);
    }
    button.danger:hover { opacity: 0.9; }
    .button-row { display: flex; gap: 8px; margin-top: 12px; flex-wrap: wrap; }

    /* ── Checkboxes ── */
    .checkbox-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 6px 16px;
    }
    .checkbox-item {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 12px;
    }
    .checkbox-item input { accent-color: var(--vscode-focusBorder); }
    .checkbox-section { margin-bottom: 12px; }
    .checkbox-section-label {
      font-size: 11px;
      font-weight: 600;
      color: var(--vscode-descriptionForeground);
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 8px;
    }

    /* ── Form Fields ── */
    .form-group { margin-bottom: 14px; }
    .form-group label {
      display: block;
      font-size: 12px;
      margin-bottom: 4px;
      color: var(--vscode-foreground);
    }
    .form-group .desc {
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
      margin-bottom: 6px;
    }
    select, input[type="number"] {
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border, var(--vscode-panel-border));
      padding: 5px 8px;
      border-radius: 4px;
      font-size: 13px;
      font-family: inherit;
      width: 200px;
    }
    select:focus, input[type="number"]:focus {
      outline: 1px solid var(--vscode-focusBorder);
    }

    /* ── Session Table ── */
    .session-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 12px;
    }
    .session-table th, .session-table td {
      padding: 8px 10px;
      text-align: left;
      border-bottom: 1px solid var(--vscode-panel-border);
    }
    .session-table th {
      font-weight: 600;
      color: var(--vscode-descriptionForeground);
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.3px;
    }
    .session-table td.mono {
      font-family: var(--vscode-editor-font-family);
      font-size: 11px;
    }
    .empty-state {
      text-align: center;
      padding: 24px;
      color: var(--vscode-descriptionForeground);
      font-style: italic;
    }

    /* ── Toast ── */
    .toast {
      position: fixed;
      bottom: 16px;
      right: 16px;
      background: var(--vscode-notifications-background, #1e1e1e);
      color: var(--vscode-notifications-foreground, #ccc);
      border: 1px solid var(--vscode-panel-border);
      border-radius: 6px;
      padding: 10px 16px;
      font-size: 12px;
      z-index: 100;
      opacity: 0;
      transition: opacity 0.2s;
      pointer-events: none;
    }
    .toast.visible { opacity: 1; }

    /* ── Confirm Dialog ── */
    .confirm-overlay {
      position: fixed; inset: 0;
      background: rgba(0,0,0,0.5);
      display: none; align-items: center; justify-content: center;
      z-index: 50;
    }
    .confirm-overlay.visible { display: flex; }
    .confirm-box {
      background: var(--vscode-editor-background);
      border: 1px solid var(--vscode-panel-border);
      border-radius: 8px;
      padding: 20px;
      min-width: 320px;
      max-width: 420px;
    }
    .confirm-box h4 { margin-bottom: 8px; font-size: 14px; }
    .confirm-box p { font-size: 12px; color: var(--vscode-descriptionForeground); margin-bottom: 16px; }
    .confirm-box .button-row { justify-content: flex-end; }
  </style>
</head>
<body>
  <div class="tab-bar">
    <div class="tab active" data-tab="hooks">Hooks</div>
    <div class="tab" data-tab="server">Server</div>
    <div class="tab" data-tab="display">Display</div>
    <div class="tab" data-tab="data">Data</div>
  </div>

  <!-- ════════════════════════════════════════════════════════════ -->
  <!-- TAB 1: HOOKS                                                -->
  <!-- ════════════════════════════════════════════════════════════ -->
  <div id="tab-hooks" class="tab-content active">
    <div class="card">
      <h3>Hook Status</h3>
      <div class="status-row">
        <div id="hook-dot" class="status-dot red"></div>
        <span id="hook-label" class="status-label">Checking...</span>
      </div>
      <div id="hook-port-info" style="font-size:12px;color:var(--vscode-descriptionForeground);margin-bottom:4px;"></div>
    </div>

    <div class="card">
      <h3>Event Types</h3>
      <div class="checkbox-section">
        <div class="checkbox-section-label">Sync Events</div>
        <div id="sync-events" class="checkbox-grid"></div>
      </div>
      <div class="checkbox-section">
        <div class="checkbox-section-label">Async Events</div>
        <div id="async-events" class="checkbox-grid"></div>
      </div>
      <div class="button-row">
        <button onclick="selectAllHooks(true)">Select All</button>
        <button class="secondary" onclick="selectAllHooks(false)">Deselect All</button>
      </div>
    </div>

    <div class="button-row">
      <button onclick="applyHooks()">Apply Changes</button>
      <button class="secondary" onclick="repairHooks()">Repair Hooks</button>
      <button class="danger" onclick="confirmAction('removeHooks', 'Remove All Hooks', 'This will remove all Synapse hooks from .claude/settings.local.json. Claude Code will stop sending events to Synapse.')">Remove All Hooks</button>
    </div>
  </div>

  <!-- ════════════════════════════════════════════════════════════ -->
  <!-- TAB 2: SERVER                                               -->
  <!-- ════════════════════════════════════════════════════════════ -->
  <div id="tab-server" class="tab-content">
    <div class="card">
      <h3>Server Status</h3>
      <div class="status-row">
        <div id="server-dot" class="status-dot red"></div>
        <span id="server-label" class="status-label">Checking...</span>
      </div>
      <div class="button-row" id="server-buttons">
        <button id="btn-start" onclick="send({type:'startServer'})">Start</button>
        <button id="btn-stop" class="secondary" onclick="send({type:'stopServer'})" style="display:none">Stop</button>
        <button id="btn-restart" class="secondary" onclick="send({type:'restartServer'})" style="display:none">Restart</button>
      </div>
    </div>

    <div class="card">
      <h3>Diagnostics</h3>
      <div class="metrics-grid">
        <div class="metric-card">
          <div class="metric-value" id="m-uptime">--</div>
          <div class="metric-label">Uptime</div>
        </div>
        <div class="metric-card">
          <div class="metric-value" id="m-events">--</div>
          <div class="metric-label">Events</div>
        </div>
        <div class="metric-card">
          <div class="metric-value" id="m-sessions">--</div>
          <div class="metric-label">Sessions</div>
        </div>
        <div class="metric-card">
          <div class="metric-value" id="m-clients">--</div>
          <div class="metric-label">WS Clients</div>
        </div>
        <div class="metric-card">
          <div class="metric-value" id="m-agents">--</div>
          <div class="metric-label">Active Agents</div>
        </div>
        <div class="metric-card">
          <div class="metric-value" id="m-dbsize">--</div>
          <div class="metric-label">DB Size</div>
        </div>
      </div>
      <div style="margin-top:10px;font-size:11px;color:var(--vscode-descriptionForeground);">
        Auto-refreshes every 5 seconds
      </div>
    </div>
  </div>

  <!-- ════════════════════════════════════════════════════════════ -->
  <!-- TAB 3: DISPLAY                                              -->
  <!-- ════════════════════════════════════════════════════════════ -->
  <div id="tab-display" class="tab-content">
    <div class="card">
      <h3>Graph Preferences</h3>
      <div class="form-group">
        <label for="s-animationSpeed">Animation Speed</label>
        <div class="desc">Speed of edge and node animations</div>
        <select id="s-animationSpeed" onchange="setSetting('animationSpeed',this.value)">
          <option value="off">Off</option>
          <option value="slow">Slow</option>
          <option value="normal">Normal</option>
          <option value="fast">Fast</option>
        </select>
      </div>
      <div class="form-group">
        <label for="s-edgeStyle">Edge Style</label>
        <div class="desc">Edge routing style in the graph</div>
        <select id="s-edgeStyle" onchange="setSetting('edgeStyle',this.value)">
          <option value="smoothstep">Smooth Step</option>
          <option value="bezier">Bezier</option>
          <option value="straight">Straight</option>
        </select>
      </div>
      <div class="form-group">
        <label for="s-nodeLabelDensity">Node Label Density</label>
        <div class="desc">Amount of detail shown on graph nodes</div>
        <select id="s-nodeLabelDensity" onchange="setSetting('nodeLabelDensity',this.value)">
          <option value="minimal">Minimal</option>
          <option value="normal">Normal</option>
          <option value="verbose">Verbose</option>
        </select>
      </div>
      <div class="form-group">
        <label for="s-autoZoom">Auto-Zoom</label>
        <div class="desc">Zoom behavior when new nodes appear</div>
        <select id="s-autoZoom" onchange="setSetting('autoZoom',this.value)">
          <option value="fit-all">Fit All</option>
          <option value="follow-latest">Follow Latest</option>
          <option value="manual">Manual</option>
        </select>
      </div>
    </div>

    <div class="card">
      <h3>Appearance</h3>
      <div class="form-group">
        <label for="s-defaultLens">Default Lens</label>
        <div class="desc">Lens view shown when opening the sidebar</div>
        <select id="s-defaultLens" onchange="setSetting('defaultLens',this.value)">
          <option value="tree">Tree</option>
          <option value="heat">Heatmap</option>
          <option value="tmap">Treemap</option>
          <option value="flow">Sankey</option>
          <option value="comp">Compaction</option>
          <option value="cost">Cost</option>
        </select>
      </div>
      <div class="form-group">
        <label for="s-themeOverride">Theme Override</label>
        <div class="desc">Dashboard theme (auto follows your VS Code theme)</div>
        <select id="s-themeOverride" onchange="setSetting('themeOverride',this.value)">
          <option value="auto">Auto</option>
          <option value="dark">Dark</option>
          <option value="light">Light</option>
        </select>
      </div>
      <div class="form-group">
        <label for="s-layout">Layout</label>
        <div class="desc">Dashboard arrangement in VS Code</div>
        <select id="s-layout" onchange="setSetting('layout',this.value)">
          <option value="split">Split (sidebar + editor)</option>
          <option value="single">Single panel</option>
        </select>
      </div>
    </div>

    <div class="button-row">
      <button class="secondary" onclick="resetDefaults()">Reset to Defaults</button>
    </div>
  </div>

  <!-- ════════════════════════════════════════════════════════════ -->
  <!-- TAB 4: DATA                                                 -->
  <!-- ════════════════════════════════════════════════════════════ -->
  <div id="tab-data" class="tab-content">
    <div class="card">
      <h3>Sessions</h3>
      <div id="session-list"></div>
      <div class="button-row">
        <button class="secondary" onclick="send({type:'getSessions'})">Refresh</button>
      </div>
    </div>

    <div class="card">
      <h3>Event Retention</h3>
      <div class="form-group">
        <label for="s-maxEvents">Maximum Events</label>
        <div class="desc">Limit stored events in the database (0 = unlimited)</div>
        <input type="number" id="s-maxEvents" min="0" step="100" value="0"
          onchange="setSetting('maxEvents',parseInt(this.value)||0)">
      </div>
    </div>

    <div class="card">
      <h3>Actions</h3>
      <div class="button-row">
        <button onclick="send({type:'exportData'})">Export Database</button>
        <button class="danger" onclick="confirmAction('clearAllEvents', 'Clear All Events', 'This will permanently delete all stored events from the database. This cannot be undone.')">Clear All Events</button>
      </div>
    </div>
  </div>

  <!-- ── Confirm Dialog ── -->
  <div id="confirm-overlay" class="confirm-overlay">
    <div class="confirm-box">
      <h4 id="confirm-title"></h4>
      <p id="confirm-message"></p>
      <div class="button-row">
        <button class="secondary" onclick="closeConfirm()">Cancel</button>
        <button class="danger" id="confirm-ok">Confirm</button>
      </div>
    </div>
  </div>

  <!-- ── Toast ── -->
  <div id="toast" class="toast"></div>

  <script>
    const vscodeApi = acquireVsCodeApi();
    let pendingConfirmAction = null;

    /* ── Tab switching ── */
    document.querySelectorAll('.tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
        tab.classList.add('active');
        document.getElementById('tab-' + tab.dataset.tab).classList.add('active');

        // Load data for the tab
        if (tab.dataset.tab === 'hooks') send({ type: 'getHookStatus' });
        if (tab.dataset.tab === 'server') send({ type: 'getServerHealth' });
        if (tab.dataset.tab === 'display') send({ type: 'getAllSettings' });
        if (tab.dataset.tab === 'data') send({ type: 'getSessions' });
      });
    });

    /* ── Messaging ── */
    function send(msg) { vscodeApi.postMessage(msg); }

    window.addEventListener('message', (event) => {
      const msg = event.data;
      if (!msg || typeof msg !== 'object') return;

      switch (msg.type) {
        case 'hookStatus': renderHookStatus(msg.data); break;
        case 'serverHealth': renderServerHealth(msg.data); break;
        case 'allSettings': renderSettings(msg.data); break;
        case 'sessions': renderSessions(msg.data); break;
        case 'actionResult': showToast(msg.success ? msg.message : 'Error: ' + msg.message); break;
      }
    });

    /* ── Hook rendering ── */
    function renderHookStatus(data) {
      const dot = document.getElementById('hook-dot');
      const label = document.getElementById('hook-label');
      const portInfo = document.getElementById('hook-port-info');

      if (data.configured) {
        if (data.portMatch) {
          dot.className = 'status-dot green';
          label.textContent = 'Configured (' + data.enabledEvents.length + ' events)';
        } else {
          dot.className = 'status-dot yellow';
          label.textContent = 'Port mismatch \u2014 hooks point to port ' + data.port;
        }
      } else {
        dot.className = 'status-dot red';
        label.textContent = 'Not configured';
      }
      portInfo.textContent = data.port ? 'Hook port: ' + data.port + ' | Server port: ' + (data.portMatch ? data.port : '?') : '';

      renderEventCheckboxes('sync-events', data.allSyncEvents || [], data.enabledEvents || []);
      renderEventCheckboxes('async-events', data.allAsyncEvents || [], data.enabledEvents || []);
    }

    function renderEventCheckboxes(containerId, allEvents, enabledEvents) {
      const container = document.getElementById(containerId);
      container.innerHTML = allEvents.map(e =>
        '<label class="checkbox-item">' +
        '<input type="checkbox" value="' + e + '"' + (enabledEvents.includes(e) ? ' checked' : '') + '> ' +
        e + '</label>'
      ).join('');
    }

    function selectAllHooks(checked) {
      document.querySelectorAll('#sync-events input, #async-events input').forEach(cb => {
        cb.checked = checked;
      });
    }

    function applyHooks() {
      const enabled = [];
      document.querySelectorAll('#sync-events input:checked, #async-events input:checked').forEach(cb => {
        enabled.push(cb.value);
      });
      send({ type: 'configureHooks', enabledEvents: enabled });
    }

    function repairHooks() { send({ type: 'repairHooks' }); }

    /* ── Server rendering ── */
    function renderServerHealth(data) {
      const dot = document.getElementById('server-dot');
      const label = document.getElementById('server-label');
      const btnStart = document.getElementById('btn-start');
      const btnStop = document.getElementById('btn-stop');
      const btnRestart = document.getElementById('btn-restart');

      if (data && data.running) {
        dot.className = 'status-dot green';
        label.textContent = 'Running on port ' + data.port;
        btnStart.style.display = 'none';
        btnStop.style.display = '';
        btnRestart.style.display = '';

        document.getElementById('m-uptime').textContent = formatUptime(data.uptime);
        document.getElementById('m-events').textContent = formatNumber(data.totalEvents);
        document.getElementById('m-sessions').textContent = formatNumber(data.totalSessions);
        document.getElementById('m-clients').textContent = String(data.clients);
        document.getElementById('m-agents').textContent = String(data.agents);
        document.getElementById('m-dbsize').textContent = formatBytes(data.dbSizeBytes);
      } else {
        dot.className = 'status-dot red';
        label.textContent = 'Stopped';
        btnStart.style.display = '';
        btnStop.style.display = 'none';
        btnRestart.style.display = 'none';

        ['m-uptime','m-events','m-sessions','m-clients','m-agents','m-dbsize'].forEach(id => {
          document.getElementById(id).textContent = '--';
        });
      }
    }

    /* ── Settings rendering ── */
    function renderSettings(data) {
      const fields = ['animationSpeed','defaultLens','nodeLabelDensity','edgeStyle','autoZoom','themeOverride','layout'];
      for (const key of fields) {
        const el = document.getElementById('s-' + key);
        if (el && data[key] !== undefined) el.value = data[key];
      }
      const maxEl = document.getElementById('s-maxEvents');
      if (maxEl && data.maxEvents !== undefined) maxEl.value = data.maxEvents;
    }

    function setSetting(key, value) { send({ type: 'setSetting', key: key, value: value }); }

    function resetDefaults() {
      const defaults = {
        animationSpeed: 'normal', defaultLens: 'tree', nodeLabelDensity: 'normal',
        edgeStyle: 'smoothstep', autoZoom: 'fit-all', themeOverride: 'auto', layout: 'split',
      };
      for (const [k, v] of Object.entries(defaults)) {
        setSetting(k, v);
        const el = document.getElementById('s-' + k);
        if (el) el.value = v;
      }
      showToast('Settings reset to defaults');
    }

    /* ── Session rendering ── */
    function renderSessions(data) {
      const container = document.getElementById('session-list');
      if (!data || data.length === 0) {
        container.innerHTML = '<div class="empty-state">No sessions recorded yet</div>';
        return;
      }
      const rows = data.map(s =>
        '<tr>' +
        '<td class="mono">' + s.session_id.slice(0, 12) + '\u2026</td>' +
        '<td>' + s.event_count + '</td>' +
        '<td>' + formatTime(s.first_event) + '</td>' +
        '<td>' + formatTime(s.last_event) + '</td>' +
        '<td><button class="danger" style="padding:3px 8px;font-size:11px;" ' +
        'onclick="confirmAction(\'clearSession:' + s.session_id + '\', \'Delete Session\', ' +
        '\'Delete all events for session ' + s.session_id.slice(0, 12) + '\u2026?\')">Delete</button></td>' +
        '</tr>'
      ).join('');
      container.innerHTML =
        '<table class="session-table"><thead><tr>' +
        '<th>Session</th><th>Events</th><th>First</th><th>Last</th><th></th>' +
        '</tr></thead><tbody>' + rows + '</tbody></table>';
    }

    /* ── Confirm dialog ── */
    function confirmAction(action, title, message) {
      pendingConfirmAction = action;
      document.getElementById('confirm-title').textContent = title;
      document.getElementById('confirm-message').textContent = message;
      document.getElementById('confirm-overlay').classList.add('visible');
    }

    function closeConfirm() {
      pendingConfirmAction = null;
      document.getElementById('confirm-overlay').classList.remove('visible');
    }

    document.getElementById('confirm-ok').addEventListener('click', () => {
      if (!pendingConfirmAction) return;
      if (pendingConfirmAction === 'removeHooks') {
        send({ type: 'removeHooks' });
      } else if (pendingConfirmAction === 'clearAllEvents') {
        send({ type: 'clearAllEvents' });
      } else if (pendingConfirmAction.startsWith('clearSession:')) {
        send({ type: 'clearSession', sessionId: pendingConfirmAction.split(':')[1] });
      }
      closeConfirm();
    });

    /* ── Toast ── */
    let toastTimer;
    function showToast(msg) {
      const el = document.getElementById('toast');
      el.textContent = msg;
      el.classList.add('visible');
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => el.classList.remove('visible'), 3000);
    }

    /* ── Formatters ── */
    function formatUptime(ms) {
      if (!ms || ms <= 0) return '--';
      const s = Math.floor(ms / 1000);
      const m = Math.floor(s / 60);
      const h = Math.floor(m / 60);
      if (h > 0) return h + 'h ' + (m % 60) + 'm';
      if (m > 0) return m + 'm ' + (s % 60) + 's';
      return s + 's';
    }

    function formatBytes(b) {
      if (!b || b <= 0) return '0 B';
      if (b < 1024) return b + ' B';
      if (b < 1024 * 1024) return (b / 1024).toFixed(1) + ' KB';
      return (b / (1024 * 1024)).toFixed(1) + ' MB';
    }

    function formatNumber(n) {
      if (n === undefined || n === null) return '--';
      if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
      return String(n);
    }

    function formatTime(ts) {
      if (!ts) return '--';
      const d = new Date(ts);
      const now = Date.now();
      const diff = now - ts;
      if (diff < 60000) return 'just now';
      if (diff < 3600000) return Math.floor(diff / 60000) + 'm ago';
      if (diff < 86400000) return Math.floor(diff / 3600000) + 'h ago';
      return d.toLocaleDateString();
    }

    /* ── Init: load Hooks tab data ── */
    send({ type: 'getHookStatus' });
    send({ type: 'getServerHealth' });
  </script>
</body>
</html>`;
  }
}
