// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Synapse Contributors

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
        this.setStatus('connected');

        // Only reload events on REconnect (App.tsx handles the initial fetch)
        if (this.wasConnected) {
          this.onReconnect?.();
        }
        this.wasConnected = true;
      };

      this.ws.onmessage = (event) => {
        try {
          const msg: WsServerMessage = JSON.parse(event.data);
          this.onEvent?.(msg);
        } catch {
          console.warn('[wsClient] Malformed message:', String(event.data).slice(0, 80));
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
    this.wasConnected = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      // Clear handlers BEFORE close to prevent stale onclose from triggering reconnect
      // (important for React StrictMode mount→unmount→remount cycle)
      this.ws.onopen = null;
      this.ws.onmessage = null;
      this.ws.onclose = null;
      this.ws.onerror = null;
      this.ws.close();
      this.ws = null;
    }
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
    if (status === this._status) return;
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
