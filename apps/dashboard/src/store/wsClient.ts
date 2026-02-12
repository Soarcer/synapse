import type { WsServerMessage, WsClientMessage } from '@synapse-ai/core';

type ConnectionStatus = 'connected' | 'disconnected' | 'reconnecting' | 'failed';
type EventCallback = (msg: WsServerMessage) => void;
type StatusCallback = (status: ConnectionStatus) => void;
type ReconnectCallback = () => void;

class WSClient {
  private ws: WebSocket | null = null;
  private url: string;
  private reconnectDelay = 1000;
  private maxReconnectDelay = 30000;
  private maxRetries = 20;
  private reconnectCount = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private onEvent: EventCallback | null = null;
  private onStatusChange: StatusCallback | null = null;
  private onReconnect: ReconnectCallback | null = null;
  private _status: ConnectionStatus = 'disconnected';
  private shouldReconnect = true;
  private wasConnected = false;

  constructor(url: string) {
    this.url = url;
  }

  get status() {
    return this._status;
  }

  setOnEvent(cb: EventCallback) {
    this.onEvent = cb;
  }

  setOnStatusChange(cb: StatusCallback) {
    this.onStatusChange = cb;
  }

  setOnReconnect(cb: ReconnectCallback) {
    this.onReconnect = cb;
  }

  connect() {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) return;

    this.shouldReconnect = true;
    this.setStatus('reconnecting');

    try {
      this.ws = new WebSocket(this.url);

      this.ws.onopen = () => {
        this.reconnectDelay = 1000;
        this.reconnectCount = 0;
        this.wasConnected = true;
        this.setStatus('connected');

        // Fetch existing events on every connect (initial + reconnect)
        this.onReconnect?.();
      };

      this.ws.onmessage = (event) => {
        try {
          const msg: WsServerMessage = JSON.parse(event.data);
          this.onEvent?.(msg);
        } catch {
          // ignore malformed messages
        }
      };

      this.ws.onclose = () => {
        this.setStatus('disconnected');
        this.scheduleReconnect();
      };

      this.ws.onerror = () => {
        // onclose will fire after onerror
      };
    } catch {
      this.setStatus('disconnected');
      this.scheduleReconnect();
    }
  }

  disconnect() {
    this.shouldReconnect = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.ws?.close();
    this.ws = null;
    this.setStatus('disconnected');
  }

  send(msg: WsClientMessage) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  /** Reset retry counter and reconnect. Used by manual reconnect button. */
  resetAndReconnect() {
    this.reconnectCount = 0;
    this.reconnectDelay = 1000;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.ws?.close();
    this.ws = null;
    this.connect();
  }

  private setStatus(status: ConnectionStatus) {
    this._status = status;
    this.onStatusChange?.(status);
  }

  private scheduleReconnect() {
    if (!this.shouldReconnect) return;
    this.reconnectCount++;
    if (this.reconnectCount > this.maxRetries) {
      this.setStatus('failed');
      return;
    }
    this.setStatus('reconnecting');
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, this.reconnectDelay);
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxReconnectDelay);
  }
}

// Determine WS URL: allow override via VITE_WS_URL
const envWsUrl = import.meta.env.VITE_WS_URL as string | undefined;
const wsUrl =
  envWsUrl?.trim()
    ? envWsUrl
    : import.meta.env.DEV
        ? `ws://${window.location.hostname}:4000/ws`
        : `ws${window.location.protocol === 'https:' ? 's' : ''}://${window.location.host}/ws`;

export const wsClient = new WSClient(wsUrl);
