// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bernhard

import type { WsServerMessage, WsClientMessage } from '@synapse-ai/core';

// ── Event batching ──────────────────────────────────────────
// Batches rapid WS messages into a single callback per microtask.
// Only 'event' type messages are batched; all other types (permissions,
// agent_text, connected, stale, coaching_nudge) bypass for low latency.

export function createEventBatcher(
  onBatch: (events: WsServerMessage[]) => void,
  onImmediate?: (event: WsServerMessage) => void,
) {
  let queue: WsServerMessage[] = [];
  let scheduled = false;

  function flush() {
    const batch = queue;
    queue = [];
    scheduled = false;
    if (batch.length > 0) onBatch(batch);
  }

  function batchEvent(msg: WsServerMessage) {
    // Only 'event' type messages are batched — everything else fires immediately
    if (msg.type !== 'event') {
      onImmediate?.(msg);
      return;
    }
    queue.push(msg);
    if (!scheduled) {
      scheduled = true;
      queueMicrotask(flush);
    }
  }

  return { batchEvent, flush };
}

type ConnectionStatus = 'connected' | 'disconnected' | 'reconnecting' | 'failed';
type EventCallback = (msg: WsServerMessage) => void;
type BatchEventCallback = (msgs: WsServerMessage[]) => void;
type StatusCallback = (status: ConnectionStatus) => void;
type ReconnectCallback = () => void;

class WSClient {
  private ws: WebSocket | null = null;
  private url: string;
  private reconnectDelay = 1000;
  private maxReconnectDelay = 15000;
  private maxRetries = Infinity;
  private reconnectCount = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private onEvent: EventCallback | null = null;
  private onBatchEvent: BatchEventCallback | null = null;
  private onStatusChange: StatusCallback | null = null;
  private onReconnect: ReconnectCallback | null = null;
  private batcher: ReturnType<typeof createEventBatcher> | null = null;
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
    this.rebuildBatcher();
  }

  setOnBatchEvent(cb: BatchEventCallback) {
    this.onBatchEvent = cb;
    this.rebuildBatcher();
  }

  private rebuildBatcher() {
    if (this.onBatchEvent) {
      this.batcher = createEventBatcher(
        (batch) => this.onBatchEvent?.(batch),
        (msg) => this.onEvent?.(msg),
      );
    } else {
      this.batcher = null;
    }
  }

  setOnStatusChange(cb: StatusCallback) {
    this.onStatusChange = cb;
  }

  setOnReconnect(cb: ReconnectCallback) {
    this.onReconnect = cb;
  }

  connect() {
    if (this.ws?.readyState === WebSocket.OPEN) return;
    // If CONNECTING, let it finish — but if failed/disconnected, proceed
    if (this.ws?.readyState === WebSocket.CONNECTING) return;

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
          if (msg.type === 'event')
            console.log('[ws] event:', msg.data?.type, msg.data?.sessionId?.slice(0, 8));
          if (this.batcher) {
            this.batcher.batchEvent(msg);
          } else {
            this.onEvent?.(msg);
          }
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

// WS URL: always use window.location.host (goes through Vite proxy in dev,
// hits real origin in production). Never hardcode the backend port here.
const wsUrl = `ws${window.location.protocol === 'https:' ? 's' : ''}://${window.location.host}/ws`;

export const wsClient = new WSClient(wsUrl);
