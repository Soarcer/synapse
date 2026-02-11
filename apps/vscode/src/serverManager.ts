import * as vscode from 'vscode';
import { ChildProcess, spawn } from 'child_process';
import * as path from 'path';
import * as http from 'http';

export class ServerManager {
  private process: ChildProcess | null = null;
  private _port: number;
  private resourcesPath: string;
  private outputChannel: vscode.OutputChannel;

  private _onStarted = new vscode.EventEmitter<void>();
  private _onStopped = new vscode.EventEmitter<void>();
  private _onError = new vscode.EventEmitter<string>();

  readonly onStarted = this._onStarted.event;
  readonly onStopped = this._onStopped.event;
  readonly onError = this._onError.event;

  constructor(resourcesPath: string, outputChannel: vscode.OutputChannel) {
    this.resourcesPath = resourcesPath;
    this.outputChannel = outputChannel;
    this._port = vscode.workspace.getConfiguration('synapse').get('port', 4000);
  }

  get port(): number {
    return this._port;
  }

  get isRunning(): boolean {
    return this.process !== null && !this.process.killed;
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      vscode.window.showInformationMessage(`Synapse is already running on port ${this._port}`);
      return;
    }

    this._port = vscode.workspace.getConfiguration('synapse').get('port', 4000);
    const serverDir = path.join(this.resourcesPath, 'synapse-server');
    const serverEntry = path.join(serverDir, 'server', 'index.ts');

    this.outputChannel.appendLine(`Starting Synapse on port ${this._port}...`);
    this.outputChannel.appendLine(`Server dir: ${serverDir}`);

    const env = {
      ...process.env,
      PORT: String(this._port),
      CLIENT_ORIGIN: '*',
    };

    this.process = spawn('npx', ['tsx', serverEntry], {
      cwd: serverDir,
      env,
      shell: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    this.process.stdout?.on('data', (data: Buffer) => {
      this.outputChannel.append(data.toString());
    });

    this.process.stderr?.on('data', (data: Buffer) => {
      this.outputChannel.append(data.toString());
    });

    this.process.on('error', (err) => {
      this.outputChannel.appendLine(`Server error: ${err.message}`);
      this._onError.fire(err.message);
    });

    this.process.on('exit', (code) => {
      this.outputChannel.appendLine(`Server exited with code ${code}`);
      this.process = null;
      this._onStopped.fire();
    });

    // Wait for server to be ready
    await this.waitForReady(10000);
    this._onStarted.fire();
  }

  stop(): void {
    if (this.process && !this.process.killed) {
      this.outputChannel.appendLine('Stopping Synapse...');
      this.process.kill('SIGTERM');
      // Force kill after 3 seconds
      setTimeout(() => {
        if (this.process && !this.process.killed) {
          this.process.kill('SIGKILL');
        }
      }, 3000);
    }
    this.process = null;
    this._onStopped.fire();
  }

  private waitForReady(timeoutMs: number): Promise<void> {
    return new Promise((resolve) => {
      const start = Date.now();
      const check = () => {
        if (Date.now() - start > timeoutMs) {
          this.outputChannel.appendLine('Server startup timeout — may still be starting.');
          resolve();
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
      setTimeout(check, 1000); // Initial delay to let the process start
    });
  }

  dispose(): void {
    this.stop();
    this._onStarted.dispose();
    this._onStopped.dispose();
    this._onError.dispose();
  }
}
