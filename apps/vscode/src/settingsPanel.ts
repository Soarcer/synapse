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

      // AI Features
      case 'getAiStatus':
        await this.fetchAiStatusAndSend();
        break;
      case 'setApiKey': {
        const apiKey = msg.value as string;
        await this.proxyPutJson(`/api/settings`, { anthropic_api_key: apiKey });
        await this.fetchAiStatusAndSend();
        this.panel.webview.postMessage({
          type: 'actionResult', action: 'setApiKey', success: true,
          message: apiKey ? 'API key saved' : 'API key removed',
        });
        break;
      }

      // Prompt Lab Settings
      case 'getPromptLabSettings': {
        const config = vscode.workspace.getConfiguration('synapse');
        this.panel.webview.postMessage({
          type: 'promptLabSettings',
          data: {
            model: config.get('promptLab.model', 'claude-sonnet-4-5-20250929'),
            showScore: config.get('promptLab.showScore', true),
            maxChars: config.get('promptLab.maxChars', 4000),
          },
        });
        break;
      }
      case 'setPromptLabSetting': {
        const config = vscode.workspace.getConfiguration('synapse');
        const key = msg.key as string;
        const value = msg.value;
        await config.update(`promptLab.${key}`, value, vscode.ConfigurationTarget.Global);
        this.panel.webview.postMessage({
          type: 'actionResult', action: 'setPromptLabSetting', success: true,
          message: `${key} updated`,
        });
        break;
      }
      case 'openKeybindings': {
        vscode.commands.executeCommand(
          'workbench.action.openGlobalKeybindings',
          'synapse.improveText',
        );
        break;
      }
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

  private async fetchAiStatusAndSend(): Promise<void> {
    if (!this.serverManager.isRunning) {
      this.panel.webview.postMessage({ type: 'aiStatus', data: null });
      return;
    }
    try {
      const statusBody = await this.httpGet(`/api/settings/ai-status`);
      const parsed = JSON.parse(statusBody);
      const status = parsed.data ?? parsed;

      const settingsBody = await this.httpGet(`/api/settings`);
      const settingsParsed = JSON.parse(settingsBody);
      const settings = settingsParsed.data ?? settingsParsed;

      this.panel.webview.postMessage({
        type: 'aiStatus',
        data: {
          available: status.available,
          source: status.source,
          model: status.model,
          maskedKey: status.maskedKey,
          keySource: settings._api_key_source ?? status.source,
        },
      });
    } catch {
      this.panel.webview.postMessage({ type: 'aiStatus', data: null });
    }
  }

  private proxyPutJson(urlPath: string, body: Record<string, string>): Promise<void> {
    return new Promise((resolve, reject) => {
      const data = JSON.stringify(body);
      const req = http.request(
        `http://localhost:${this.serverManager.port}${urlPath}`,
        {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(data),
          },
        },
        (res) => {
          res.resume();
          res.on('end', () => resolve());
        },
      );
      req.on('error', reject);
      req.setTimeout(5000, () => { req.destroy(); reject(new Error('timeout')); });
      req.write(data);
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
    input[type="text"], input[type="password"],
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
    input[type="text"]:focus, input[type="password"]:focus,
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

    /* ── Shortcut Rows ── */
    .shortcut-row {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 8px;
      font-size: 12px;
    }
    .shortcut-label {
      width: 120px;
      font-weight: 600;
      color: var(--vscode-foreground);
    }
    .shortcut-desc {
      color: var(--vscode-descriptionForeground);
    }
    kbd {
      background: var(--vscode-editor-background);
      border: 1px solid var(--vscode-panel-border);
      border-radius: 3px;
      padding: 2px 6px;
      font-family: var(--vscode-editor-font-family);
      font-size: 11px;
      min-width: 90px;
      text-align: center;
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
    <div class="tab" data-tab="data">Data</div>
    <div class="tab" data-tab="promptlab">Prompt Lab</div>
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

    <div class="card">
      <h3>AI Features</h3>
      <div class="status-row">
        <div id="ai-dot" class="status-dot red"></div>
        <span id="ai-label" class="status-label">Checking...</span>
      </div>
      <div id="ai-details" style="font-size:12px;color:var(--vscode-descriptionForeground);margin-bottom:12px;"></div>
      <div class="form-group">
        <label for="api-key-input">Anthropic API Key</label>
        <div class="desc">
          Required for AI-powered features (prompt scoring, coaching insights, Prompt Lab).
          Your Claude Code subscription does not include API access \u2014 you need a separate API key from
          <a href="#" onclick="return false;" style="color:var(--vscode-textLink-foreground);">console.anthropic.com</a>.
        </div>
        <div style="display:flex;gap:8px;align-items:center;">
          <input type="password" id="api-key-input" placeholder="sk-ant-..." style="width:320px;flex-shrink:0;">
          <button onclick="saveApiKey()">Save</button>
          <button class="secondary" onclick="toggleKeyVisibility();" title="Show/hide key" style="padding:6px 8px;">
            \ud83d\udc41
          </button>
        </div>
      </div>
      <div id="ai-key-info" style="font-size:11px;color:var(--vscode-descriptionForeground);margin-top:4px;"></div>
      <div class="button-row">
        <button class="danger" onclick="clearApiKey()" id="btn-clear-key" style="display:none;">Remove Key</button>
      </div>
    </div>
  </div>

  <!-- ════════════════════════════════════════════════════════════ -->
  <!-- TAB 3: DATA                                                 -->
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
      <h3>Actions</h3>
      <div class="button-row">
        <button onclick="send({type:'exportData'})">Export Database</button>
        <button class="danger" onclick="confirmAction('clearAllEvents', 'Clear All Events', 'This will permanently delete all stored events from the database. This cannot be undone.')">Clear All Events</button>
      </div>
    </div>
  </div>

  <!-- ════════════════════════════════════════════════════════════ -->
  <!-- TAB 4: PROMPT LAB                                          -->
  <!-- ════════════════════════════════════════════════════════════ -->
  <div id="tab-promptlab" class="tab-content">
    <div class="card">
      <h3>Keyboard Shortcuts</h3>
      <p style="font-size:12px;color:var(--vscode-descriptionForeground);margin-bottom:12px;">
        Select text in any editor and press the shortcut to improve it with Prompt Lab.
      </p>
      <div class="shortcut-row">
        <span class="shortcut-label">Developer mode</span>
        <kbd>Ctrl+Alt+D</kbd>
        <span class="shortcut-desc">Precise, technical rewrite</span>
      </div>
      <div class="shortcut-row">
        <span class="shortcut-label">Vibe mode</span>
        <kbd>Ctrl+Alt+V</kbd>
        <span class="shortcut-desc">Creative, conversational rewrite</span>
      </div>
      <div class="button-row">
        <button class="secondary" onclick="send({type:'openKeybindings'})">Customize Keybindings</button>
      </div>
    </div>

    <div class="card">
      <h3>Default Model</h3>
      <div class="form-group">
        <label for="pl-model">AI model for text improvements</label>
        <select id="pl-model" onchange="send({type:'setPromptLabSetting', key:'model', value:this.value})">
          <option value="claude-haiku-4-5-20251001">Haiku 4.5 \u2014 fast, cheap</option>
          <option value="claude-sonnet-4-5-20250929">Sonnet 4.5 \u2014 balanced</option>
          <option value="claude-opus-4-6">Opus 4.6 \u2014 highest quality</option>
        </select>
      </div>
    </div>

    <div class="card">
      <h3>Behavior</h3>
      <div class="form-group">
        <label class="checkbox-item">
          <input type="checkbox" id="pl-show-score"
            onchange="send({type:'setPromptLabSetting', key:'showScore', value:this.checked})">
          Show score in status bar after processing
        </label>
      </div>
      <div class="form-group">
        <label for="pl-max-chars">Maximum characters to send</label>
        <div class="desc">Selections longer than this are clipped before analysis.</div>
        <input type="number" id="pl-max-chars" min="100" max="10000" step="500" style="width:120px;"
          onchange="send({type:'setPromptLabSetting', key:'maxChars', value:parseInt(this.value,10)})">
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
        if (tab.dataset.tab === 'server') { send({ type: 'getServerHealth' }); send({ type: 'getAiStatus' }); }
        if (tab.dataset.tab === 'data') send({ type: 'getSessions' });
        if (tab.dataset.tab === 'promptlab') send({ type: 'getPromptLabSettings' });
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
        case 'sessions': renderSessions(msg.data); break;
        case 'aiStatus': renderAiStatus(msg.data); break;
        case 'promptLabSettings': renderPromptLabSettings(msg.data); break;
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

    /* ── AI status rendering ── */
    function renderAiStatus(data) {
      const dot = document.getElementById('ai-dot');
      const label = document.getElementById('ai-label');
      const details = document.getElementById('ai-details');
      const keyInfo = document.getElementById('ai-key-info');
      const clearBtn = document.getElementById('btn-clear-key');

      if (!data) {
        dot.className = 'status-dot red';
        label.textContent = 'Server not running';
        details.textContent = '';
        keyInfo.textContent = '';
        clearBtn.style.display = 'none';
        return;
      }

      if (data.available) {
        dot.className = 'status-dot green';
        label.textContent = 'Active \u2014 AI features enabled';
        details.textContent = 'Model: ' + data.model;
      } else {
        dot.className = 'status-dot red';
        label.textContent = 'No API key configured';
        details.textContent = 'AI-powered features (prompt scoring, coaching, Prompt Lab) require an API key.';
      }

      if (data.maskedKey) {
        const sourceLabel = data.keySource === 'env' ? 'environment variable' : 'saved in settings';
        keyInfo.textContent = 'Current key: ' + data.maskedKey + ' (from ' + sourceLabel + ')';
        clearBtn.style.display = data.keySource === 'settings' ? '' : 'none';
      } else {
        keyInfo.textContent = '';
        clearBtn.style.display = 'none';
      }
    }

    function saveApiKey() {
      const input = document.getElementById('api-key-input');
      const key = input.value.trim();
      if (!key) {
        showToast('Please enter an API key');
        return;
      }
      send({ type: 'setApiKey', value: key });
      input.value = '';
    }

    function deleteSession(sessionId) {
      confirmAction('clearSession:' + sessionId, 'Delete Session', 'Delete all events for session ' + sessionId.slice(0, 12) + '\u2026?');
    }

    function clearApiKey() {
      send({ type: 'setApiKey', value: '' });
    }

    function toggleKeyVisibility() {
      const input = document.getElementById('api-key-input');
      input.type = input.type === 'password' ? 'text' : 'password';
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
        'onclick="deleteSession(' + "'" + s.session_id + "'" + ')">Delete</button></td>' +
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

    /* ── Prompt Lab rendering ── */
    function renderPromptLabSettings(data) {
      if (!data) return;
      const modelSelect = document.getElementById('pl-model');
      if (modelSelect) modelSelect.value = data.model || 'claude-sonnet-4-5-20250929';
      const showScore = document.getElementById('pl-show-score');
      if (showScore) showScore.checked = data.showScore !== false;
      const maxChars = document.getElementById('pl-max-chars');
      if (maxChars) maxChars.value = data.maxChars || 4000;
    }

    /* ── Init: load Hooks tab data ── */
    send({ type: 'getHookStatus' });
    send({ type: 'getServerHealth' });
    send({ type: 'getAiStatus' });
    send({ type: 'getPromptLabSettings' });
  </script>
</body>
</html>`;
  }
}
