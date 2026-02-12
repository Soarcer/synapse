import { WebSocket } from 'ws';
import { logger } from '../lib/logger.js';
import type { AgentEvent, WsServerMessage, ActiveAgentInfo } from '@synapse-ai/core';

const MAX_BUFFERED_AMOUNT = 1_048_576; // 1MB backpressure threshold
const MAX_CLIENTS = parseInt(process.env.SYNAPSE_MAX_WS_CLIENTS || '50', 10);
const HEARTBEAT_INTERVAL_MS = 30_000;

export class Broadcaster {
  private clients = new Set<WebSocket>();
  private alive = new WeakMap<WebSocket, boolean>();
  private stale = new WeakSet<WebSocket>();
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.startHeartbeat();
  }

  addClient(ws: WebSocket, activeAgents: ActiveAgentInfo[]): boolean {
    if (this.clients.size >= MAX_CLIENTS) {
      ws.close(1013, 'Max clients reached');
      return false;
    }

    this.clients.add(ws);
    this.alive.set(ws, true);

    // Respond to pong
    ws.on('pong', () => {
      this.alive.set(ws, true);
    });

    // Send initial state to new client
    const msg: WsServerMessage = {
      type: 'connected',
      data: { activeAgents },
    };
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }

    return true;
  }

  removeClient(ws: WebSocket): void {
    this.clients.delete(ws);
  }

  broadcast(event: AgentEvent): void {
    const msg: WsServerMessage = { type: 'event', data: event };
    const payload = JSON.stringify(msg);

    for (const client of this.clients) {
      this.safeSend(client, payload);
    }
  }

  broadcastText(agentId: string, text: string, isPartial: boolean): void {
    const msg: WsServerMessage = {
      type: 'agent_text',
      data: { agentId, text, isPartial },
    };
    const payload = JSON.stringify(msg);

    for (const client of this.clients) {
      this.safeSend(client, payload);
    }
  }

  get clientCount(): number {
    return this.clients.size;
  }

  /** Stop heartbeat timer (for graceful shutdown) */
  destroy(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private safeSend(client: WebSocket, payload: string): void {
    if (client.readyState !== WebSocket.OPEN) return;
    if (client.bufferedAmount > MAX_BUFFERED_AMOUNT) {
      logger.warn({ bufferedAmount: client.bufferedAmount }, 'WS backpressure: skipping send');
      this.stale.add(client);
      return;
    }
    // If client was stale (missed events), send a stale signal so it reloads
    if (this.stale.has(client)) {
      this.stale.delete(client);
      const staleMsg: WsServerMessage = { type: 'stale' as WsServerMessage['type'], data: {} };
      client.send(JSON.stringify(staleMsg));
    }
    client.send(payload);
  }

  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      for (const client of this.clients) {
        if (!this.alive.get(client)) {
          client.terminate();
          this.clients.delete(client);
          continue;
        }
        this.alive.set(client, false);
        if (client.readyState === WebSocket.OPEN) {
          client.ping();
        }
      }
    }, HEARTBEAT_INTERVAL_MS);

    // Don't prevent Node.js from exiting
    if (this.heartbeatTimer.unref) {
      this.heartbeatTimer.unref();
    }
  }
}
