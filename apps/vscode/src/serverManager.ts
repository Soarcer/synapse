// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bernhard

import * as vscode from 'vscode';
import { ChildProcess, spawn, execSync } from 'child_process';
import * as path from 'path';
import * as http from 'http';
import * as fs from 'fs';
import * as os from 'os';

// ── Global Synapse daemon paths (~/.synapse/) ─────────────────
const SYNAPSE_HOME = path.join(os.homedir(), '.synapse');
const GLOBAL_PORT_FILE = path.join(SYNAPSE_HOME, 'port');

function readPortFile(): number | null {
  try {
    const p = parseInt(fs.readFileSync(GLOBAL_PORT_FILE, 'utf-8').trim(), 10);
    return p > 0 && p < 65536 ? p : null;
  } catch {
    return null;
  }
}

function writePortFile(port: number): void {
  fs.mkdirSync(SYNAPSE_HOME, { recursive: true });
  fs.writeFileSync(GLOBAL_PORT_FILE, String(port));
}

function deletePortFile(): void {
  try {
    fs.unlinkSync(GLOBAL_PORT_FILE);
  } catch {
    /* ok — file may not exist */
  }
}

export class ServerManager {
  private process: ChildProcess | null = null;
  private _host: string;
  private _port: number;
  private resourcesPath: string;
  private storagePath: string | undefined;
  private outputChannel: vscode.OutputChannel;
  private killTimer: ReturnType<typeof setTimeout> | null = null;

  /** How VS Code is currently connected to the server. */
  private _mode: 'owned' | 'attached' | null = null;

  private _startTime: number | null = null;

  private _onStarted = new vscode.EventEmitter<void>();
  private _onStopped = new vscode.EventEmitter<void>();
  private _onError = new vscode.EventEmitter<string>();

  readonly onStarted = this._onStarted.event;
  readonly onStopped = this._onStopped.event;
  readonly onError = this._onError.event;

  constructor(resourcesPath: string, outputChannel: vscode.OutputChannel, storagePath?: string) {
    this.resourcesPath = resourcesPath;
    this.storagePath = storagePath;
    this.outputChannel = outputChannel;
    const cfg = vscode.workspace.getConfiguration('synapse');
    this._host = cfg.get('host', 'localhost');
    this._port = cfg.get('port', 4000);
  }

  get host(): string {
    return this._host;
  }

  get port(): number {
    return this._port;
  }

  get mode(): 'owned' | 'attached' | null {
    return this._mode;
  }

  get isRunning(): boolean {
    return this._mode === 'attached' || (this.process !== null && !this.process.killed);
  }

  /** @deprecated Use `mode === 'attached'` instead. Kept for extension.ts compatibility. */
  get isExternalServer(): boolean {
    return this._mode === 'attached';
  }

  get uptime(): number {
    if (!this._startTime || !this.isRunning) return 0;
    return Date.now() - this._startTime;
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      vscode.window.showInformationMessage(`Synapse is already running on port ${this._port}`);
      return;
    }

    // ── Step 1: Try to attach to an existing CLI daemon ──────────
    const existingPort = readPortFile();
    if (existingPort !== null) {
      const healthy = await this.checkHealth(existingPort);
      if (healthy) {
        this._port = existingPort;
        this._mode = 'attached';
        this._startTime = Date.now();
        this.outputChannel.appendLine(
          `Attaching to existing Synapse daemon on port ${existingPort}`,
        );
        this._onStarted.fire();
        return;
      } else {
        this.outputChannel.appendLine(
          `Port file found (port ${existingPort}) but server is not healthy — starting own server.`,
        );
      }
    }

    // ── Step 2: No existing server — start our own ────────────────

    // Check for Node.js before attempting to start
    if (!this.hasNode()) {
      const msg =
        'Node.js is not installed or not on your PATH. Synapse requires Node.js 20+ to run.';
      this.outputChannel.appendLine(`ERROR: ${msg}`);
      const action = await vscode.window.showErrorMessage(msg, 'Download Node.js', 'Dismiss');
      if (action === 'Download Node.js') {
        vscode.env.openExternal(vscode.Uri.parse('https://nodejs.org/'));
      }
      this._onError.fire(msg);
      return;
    }

    // Always spawn our own server — each VS Code instance needs isolation.
    // The server auto-increments the port if the preferred one is busy.
    const cfg = vscode.workspace.getConfiguration('synapse');
    this._host = cfg.get('host', 'localhost');
    this._port = cfg.get('port', 4000);

    const serverDir = path.join(this.resourcesPath, 'synapse-server');
    const serverEntry = path.join(serverDir, 'server.mjs');
    const dashboardDir = path.join(serverDir, 'dashboard');

    // Use workspace-specific storage for the DB so multiple instances don't collide.
    // Falls back to server directory if no storage path is available.
    const dbPath = this.storagePath
      ? path.join(this.storagePath, 'synapse.db')
      : path.join(serverDir, 'synapse.db');

    this.outputChannel.appendLine(`Starting Synapse on port ${this._port}...`);
    this.outputChannel.appendLine(`Server entry: ${serverEntry}`);
    this.outputChannel.appendLine(`Database: ${dbPath}`);

    const env = {
      ...process.env,
      HOST: this._host,
      PORT: String(this._port),
      CLIENT_ORIGIN: '*',
      NODE_ENV: 'production',
      SYNAPSE_DASHBOARD_DIR: dashboardDir,
      SYNAPSE_DB_PATH: dbPath,
    };

    // Use 'node' from PATH (required prerequisite — Claude Code already needs Node.js)
    const nodeCmd = process.platform === 'win32' ? 'node.exe' : 'node';

    this.process = spawn(nodeCmd, [serverEntry], {
      cwd: serverDir,
      env,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    this.process.stdout?.on('data', (data: Buffer) => {
      const text = data.toString();
      this.outputChannel.append(text);
      // Detect actual port from server (may differ from preferred if port was busy)
      const match = text.match(/SYNAPSE_PORT=(\d+)/);
      if (match) {
        this._port = parseInt(match[1], 10);
      }
    });

    this.process.stderr?.on('data', (data: Buffer) => {
      this.outputChannel.append(data.toString());
    });

    this.process.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'ENOENT') {
        const msg =
          'Node.js was not found. Please install Node.js 20+ and ensure it is on your PATH.';
        this.outputChannel.appendLine(`ERROR: ${msg}`);
        vscode.window.showErrorMessage(msg, 'Download Node.js').then((action) => {
          if (action === 'Download Node.js') {
            vscode.env.openExternal(vscode.Uri.parse('https://nodejs.org/'));
          }
        });
        this._onError.fire(msg);
      } else {
        this.outputChannel.appendLine(`Server error: ${err.message}`);
        this._onError.fire(err.message);
      }
    });

    this.process.on('exit', (code) => {
      this.outputChannel.appendLine(`Server exited with code ${code}`);
      this.process = null;
      this._mode = null;
      this._onStopped.fire();
    });

    // Wait for server to be ready — rejects on timeout
    try {
      await this.waitForReady(10000);
      this._startTime = Date.now();
      this._mode = 'owned';
      // Write port file so CLI can discover this VS Code–managed server
      writePortFile(this._port);
      this.outputChannel.appendLine(
        `Wrote port file ${GLOBAL_PORT_FILE} (port ${this._port}) for CLI discovery`,
      );
      this._onStarted.fire();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Server startup failed';
      this.outputChannel.appendLine(msg);
      this._onError.fire(msg);
    }
  }

  stop(): void {
    if (this._mode === 'attached') {
      // Don't stop the server — it belongs to the CLI daemon.
      // Just disconnect and clear our state.
      this.outputChannel.appendLine(
        'Detaching from Synapse daemon (server continues running as CLI daemon)',
      );
      this._mode = null;
      this._startTime = null;
      this._onStopped.fire();
      return;
    }

    // mode === 'owned' (or null): stop the server we started
    if (this.killTimer) {
      clearTimeout(this.killTimer);
      this.killTimer = null;
    }
    if (this.process && !this.process.killed) {
      this.outputChannel.appendLine('Stopping Synapse...');
      this.process.kill('SIGTERM');
      // Force kill after 10 seconds
      this.killTimer = setTimeout(() => {
        if (this.process && !this.process.killed) {
          this.process.kill('SIGKILL');
        }
        this.killTimer = null;
      }, 10_000);
      // Clean up port file since we owned it
      deletePortFile();
    } else {
      // No process running — fire stopped immediately
      this._mode = null;
      this._onStopped.fire();
    }
    // Note: _onStopped fires from the 'exit' handler when process is running,
    // and _mode is cleared there too.
    this._startTime = null;
  }

  /** Returns a promise that resolves when the server process exits (with 12s safety timeout). */
  waitForExit(): Promise<void> {
    if (!this.process || this.process.killed) return Promise.resolve();
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, 12_000);
      this.process?.on('exit', () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  async restart(): Promise<void> {
    this.stop();
    await new Promise((resolve) => setTimeout(resolve, 1000));
    await this.start();
  }

  private hasNode(): boolean {
    try {
      execSync('node --version', { stdio: 'ignore', timeout: 5000 });
      return true;
    } catch {
      return false;
    }
  }

  private checkHealth(port: number): Promise<boolean> {
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

  private waitForReady(timeoutMs: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const start = Date.now();
      const check = () => {
        if (Date.now() - start > timeoutMs) {
          reject(new Error(`Server failed to start within ${timeoutMs}ms`));
          return;
        }

        const req = http.get(`http://localhost:${this._port}/api/health`, (res) => {
          if (res.statusCode === 200) {
            this.outputChannel.appendLine(`Synapse ready on port ${this._port}`);
            resolve();
          } else {
            setTimeout(check, 500);
          }
        });
        req.on('error', () => setTimeout(check, 500));
        req.end();
      };
      setTimeout(check, 1000);
    });
  }

  dispose(): void {
    this.stop();
    this._onStarted.dispose();
    this._onStopped.dispose();
    this._onError.dispose();
  }
}
