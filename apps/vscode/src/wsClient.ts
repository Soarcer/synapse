// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bernhard

import * as vscode from 'vscode';
import WebSocket from 'ws';

export class ExtensionWsClient implements vscode.Disposable {
  private ws: WebSocket | null = null;
  private retries = 0;
  private maxRetries = 5;
  private disposed = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setTimeout> | null = null;

  // Server sends pings every 30s; if we hear nothing for 45s the connection is stalled.
  private static readonly HEARTBEAT_TIMEOUT_MS = 45_000;

  private _onEvent = new vscode.EventEmitter<Record<string, unknown>>();
  readonly onEvent = this._onEvent.event;

  private _onConnected = new vscode.EventEmitter<void>();
  readonly onConnected = this._onConnected.event;

  private _onDisconnected = new vscode.EventEmitter<void>();
  readonly onDisconnected = this._onDisconnected.event;

  private _onTerminalSend = new vscode.EventEmitter<string>();
  readonly onTerminalSend = this._onTerminalSend.event;

  constructor(private port: number) {}

  connect(): void {
    if (this.disposed) return;
    this.cleanup();

    const url = `ws://localhost:${this.port}/ws`;
    this.ws = new WebSocket(url);

    this.ws.on('open', () => {
      this.retries = 0;
      this.resetHeartbeat();
      this._onConnected.fire();
    });

    this.ws.on('ping', () => {
      // Server heartbeat ping received — reset watchdog
      this.resetHeartbeat();
    });

    this.ws.on('message', (data: WebSocket.Data) => {
      // Any message counts as proof the connection is alive
      this.resetHeartbeat();
      try {
        const message = JSON.parse(data.toString());
        // The server sends { type: 'event', data: AgentEvent }
        // and { type: 'connected', data: { activeAgents: [...] } }
        if (message.type === 'event' && message.data) {
          this._onEvent.fire(message.data as Record<string, unknown>);
        } else if (message.type === 'terminal_send' && typeof message.data?.text === 'string') {
          this._onTerminalSend.fire(message.data.text);
        } else if (message.type === 'connected' && message.data?.activeAgents) {
          // Emit each active agent as a synthetic event for tree population
          for (const agent of message.data.activeAgents) {
            this._onEvent.fire({
              type: 'agent_start',
              sessionId: agent.sessionId,
              agentId: agent.agentId,
              agentType: agent.agentType,
              status: agent.status,
              timestamp: agent.startTime,
            });
          }
          this._onConnected.fire();
        }
      } catch {
        // Ignore malformed messages
      }
    });

    this.ws.on('close', () => {
      this.clearHeartbeat();
      this._onDisconnected.fire();
      this.reconnect();
    });

    this.ws.on('error', () => {
      // Error will be followed by close event which triggers reconnect
    });
  }

  /** Reset the heartbeat watchdog timer. If no activity within timeout, force-close and reconnect. */
  private resetHeartbeat(): void {
    this.clearHeartbeat();
    this.heartbeatTimer = setTimeout(() => {
      // Connection stalled — no data or pings received
      if (this.ws && !this.disposed) {
        this.ws.terminate(); // triggers 'close' → reconnect
      }
    }, ExtensionWsClient.HEARTBEAT_TIMEOUT_MS);
  }

  private clearHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearTimeout(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private reconnect(): void {
    if (this.disposed || this.retries >= this.maxRetries) return;

    this.retries++;
    const delay = Math.min(1000 * Math.pow(2, this.retries - 1), 16_000);

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.disposed) {
        this.connect();
      }
    }, delay);
  }

  /** Reset retry counter and attempt fresh connection. */
  resetAndConnect(): void {
    this.retries = 0;
    this.connect();
  }

  private cleanup(): void {
    this.clearHeartbeat();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      // Remove all listeners before closing to avoid triggering reconnect
      this.ws.removeAllListeners();
      if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
        this.ws.close();
      }
      this.ws = null;
    }
  }

  dispose(): void {
    this.disposed = true;
    this.cleanup();
    this._onEvent.dispose();
    this._onConnected.dispose();
    this._onDisconnected.dispose();
    this._onTerminalSend.dispose();
  }
}
