import { WebSocket } from 'ws';
import type { AgentEvent, WsServerMessage, ActiveAgentInfo } from '../../src/types/agent.js';

export class Broadcaster {
  private clients = new Set<WebSocket>();

  addClient(ws: WebSocket, activeAgents: ActiveAgentInfo[]): void {
    this.clients.add(ws);

    // Send initial state to new client
    const msg: WsServerMessage = {
      type: 'connected',
      data: { activeAgents },
    };
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }

  removeClient(ws: WebSocket): void {
    this.clients.delete(ws);
  }

  broadcast(event: AgentEvent): void {
    const msg: WsServerMessage = { type: 'event', data: event };
    const payload = JSON.stringify(msg);

    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload);
      }
    }
  }

  broadcastText(agentId: string, text: string, isPartial: boolean): void {
    const msg: WsServerMessage = {
      type: 'agent_text',
      data: { agentId, text, isPartial },
    };
    const payload = JSON.stringify(msg);

    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload);
      }
    }
  }

  get clientCount(): number {
    return this.clients.size;
  }
}
