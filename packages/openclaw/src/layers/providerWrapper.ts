// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bernhard

import { nanoid } from 'nanoid';
import { inferVendor, getPrice, computeCostUsd } from '@synapse-ai/core';
import type { PluginLogger } from '../types.js';

/**
 * Layer 3: Provider wrapper for deep per-call monitoring.
 *
 * This layer wraps configured AI providers to capture per-inference metrics
 * (timing, token usage, cost) and sends them to the Synapse server.
 *
 * Note: The actual wrapping mechanism depends on OpenClaw's provider plugin
 * interface, which may evolve. This implementation provides the monitoring
 * logic that can be integrated once the provider interface is confirmed.
 */
export class ProviderWrapper {
  private port: number;
  private wrappedProviders: Set<string>;
  private logger: PluginLogger;
  private stopped = false;

  constructor(port: number, providers: string[], logger: PluginLogger) {
    this.port = port;
    this.wrappedProviders = new Set(providers);
    this.logger = logger;
  }

  /**
   * Check if a provider should be wrapped.
   */
  shouldWrap(providerId: string): boolean {
    return this.wrappedProviders.has(providerId);
  }

  /**
   * Record the start of a model inference call.
   * Returns a context object to pass to recordEnd().
   */
  recordStart(model: string, providerId: string): InferenceContext {
    const vendor = inferVendor(model);
    const ctx: InferenceContext = {
      id: nanoid(),
      model,
      vendor,
      providerId,
      startTime: Date.now(),
    };

    // Send tool_start event
    this.sendEvent({
      id: ctx.id,
      type: 'tool_start',
      sessionId: `provider-${providerId}`,
      agentId: providerId,
      agentType: 'provider',
      toolName: `inference:${model}`,
      status: 'running',
      model,
      vendor,
      timestamp: ctx.startTime,
      eventSource: 'openclaw',
    });

    return ctx;
  }

  /**
   * Record the end of a model inference call.
   */
  recordEnd(
    ctx: InferenceContext,
    usage: { inputTokens: number; outputTokens: number },
    error?: string,
  ): void {
    const duration = Date.now() - ctx.startTime;
    const cost = this.estimateCost(ctx.model, usage.inputTokens, usage.outputTokens);

    this.sendEvent({
      id: nanoid(),
      type: error ? 'tool_error' : 'tool_end',
      sessionId: `provider-${ctx.providerId}`,
      agentId: ctx.providerId,
      agentType: 'provider',
      toolName: `inference:${ctx.model}`,
      toolUseId: ctx.id,
      status: error ? 'error' : 'success',
      error,
      tokenUsage: { input: usage.inputTokens, output: usage.outputTokens },
      costUsd: cost > 0 ? cost : undefined,
      duration,
      model: ctx.model,
      vendor: ctx.vendor,
      timestamp: Date.now(),
      eventSource: 'openclaw',
    });
  }

  /**
   * Estimate the cost of an inference call using core pricing.
   */
  estimateCost(model: string, inputTokens: number, outputTokens: number): number {
    const price = getPrice(model);
    const breakdown = computeCostUsd({
      inputTokens,
      outputTokens,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      thinkingTokens: 0,
      price,
    });
    return breakdown.total;
  }

  /**
   * Send an event to the Synapse server.
   */
  private async sendEvent(event: Record<string, unknown>): Promise<void> {
    if (this.stopped) return;
    try {
      await fetch(`http://localhost:${this.port}/api/events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(event),
      });
    } catch (err) {
      this.logger.warn(`[ProviderWrapper] Failed to send event: ${err}`);
    }
  }

  stop(): void {
    this.stopped = true;
  }
}

interface InferenceContext {
  id: string;
  model: string;
  vendor: string;
  providerId: string;
  startTime: number;
}
