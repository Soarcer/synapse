// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bernhard

import type { OpenClawTool } from '../types.js';

/**
 * Layer 2: Agent tools registered with OpenClaw.
 * Agents can query monitoring data and access the dashboard.
 */
export function createAgentTools(port: number): OpenClawTool[] {
  const baseUrl = `http://localhost:${port}`;

  return [
    // ── synapse_query: Query monitoring events ──
    {
      name: 'synapse_query',
      description:
        'Query AI usage events from the Synapse monitoring dashboard. Returns recent events filtered by session, vendor, or event type.',
      parameters: {
        type: 'object',
        properties: {
          sessionId: {
            type: 'string',
            description: 'Filter by session ID',
          },
          vendor: {
            type: 'string',
            description: 'Filter by vendor (anthropic, openai, google, groq)',
          },
          eventType: {
            type: 'string',
            description:
              'Filter by event type (session_start, tool_start, tool_end, user_prompt, etc.)',
          },
          limit: {
            type: 'number',
            description: 'Maximum number of events to return (default: 20, max: 100)',
          },
        },
      },
      execute: async (params) => {
        const limit = Math.min(Number(params.limit) || 20, 100);
        const query = new URLSearchParams();
        if (params.sessionId) query.set('sessionId', String(params.sessionId));
        if (params.eventType) query.set('type', String(params.eventType));
        query.set('limit', String(limit));

        try {
          const res = await fetch(`${baseUrl}/api/events?${query}`);
          if (!res.ok) return { error: `Server returned ${res.status}` };
          let events = (await res.json()) as Array<Record<string, unknown>>;

          // Client-side vendor filter (server doesn't support vendor query yet)
          if (params.vendor) {
            events = events.filter((e) => e.vendor === params.vendor);
          }

          // Format for readable output
          return {
            count: events.length,
            events: events.slice(0, limit).map((e) => ({
              type: e.type,
              sessionId: (e.sessionId as string)?.slice(0, 12),
              vendor: e.vendor || 'unknown',
              model: e.model,
              toolName: e.toolName,
              status: e.status,
              tokens: e.tokenUsage,
              timestamp: e.timestamp ? new Date(e.timestamp as number).toISOString() : undefined,
            })),
          };
        } catch (err) {
          return { error: `Failed to query Synapse: ${err}` };
        }
      },
    },

    // ── synapse_metrics: Aggregate statistics ──
    {
      name: 'synapse_metrics',
      description:
        'Get aggregate AI usage metrics from Synapse: total tokens, estimated cost, and event counts grouped by vendor or model.',
      parameters: {
        type: 'object',
        properties: {
          groupBy: {
            type: 'string',
            description: 'Group results by: vendor, model, or session (default: vendor)',
          },
          timeRange: {
            type: 'string',
            description: 'Time range: 1h, 24h, 7d, or all (default: 24h)',
          },
        },
      },
      execute: async (params) => {
        const groupBy = String(params.groupBy || 'vendor');
        const timeRange = String(params.timeRange || '24h');

        // Calculate time cutoff
        const now = Date.now();
        const cutoffs: Record<string, number> = {
          '1h': now - 3600_000,
          '24h': now - 86400_000,
          '7d': now - 604800_000,
          all: 0,
        };
        const cutoff = cutoffs[timeRange] ?? cutoffs['24h'];

        try {
          const res = await fetch(`${baseUrl}/api/events?limit=2000`);
          if (!res.ok) return { error: `Server returned ${res.status}` };
          const events = (await res.json()) as Array<Record<string, unknown>>;

          // Filter by time range
          const filtered = events.filter((e) => (e.timestamp as number) >= cutoff);

          // Aggregate
          const groups = new Map<
            string,
            {
              totalInputTokens: number;
              totalOutputTokens: number;
              estimatedCostUsd: number;
              eventCount: number;
              toolCalls: number;
            }
          >();

          for (const e of filtered) {
            const key =
              groupBy === 'vendor'
                ? (e.vendor as string) || 'unknown'
                : groupBy === 'model'
                  ? (e.model as string) || 'unknown'
                  : ((e.sessionId as string) || 'unknown').slice(0, 12);

            let g = groups.get(key);
            if (!g) {
              g = {
                totalInputTokens: 0,
                totalOutputTokens: 0,
                estimatedCostUsd: 0,
                eventCount: 0,
                toolCalls: 0,
              };
              groups.set(key, g);
            }

            g.eventCount++;
            const usage = e.tokenUsage as { input?: number; output?: number } | undefined;
            if (usage) {
              g.totalInputTokens += usage.input ?? 0;
              g.totalOutputTokens += usage.output ?? 0;
            }
            if (typeof e.costUsd === 'number') {
              g.estimatedCostUsd += e.costUsd;
            }
            if (e.type === 'tool_start') {
              g.toolCalls++;
            }
          }

          // Format output
          const metrics: Record<string, unknown>[] = [];
          for (const [key, g] of groups) {
            metrics.push({
              [groupBy]: key,
              inputTokens: g.totalInputTokens,
              outputTokens: g.totalOutputTokens,
              totalTokens: g.totalInputTokens + g.totalOutputTokens,
              estimatedCostUsd: Math.round(g.estimatedCostUsd * 10000) / 10000,
              events: g.eventCount,
              toolCalls: g.toolCalls,
            });
          }

          return {
            timeRange,
            groupBy,
            totalEvents: filtered.length,
            metrics: metrics.sort((a, b) => (b.totalTokens as number) - (a.totalTokens as number)),
          };
        } catch (err) {
          return { error: `Failed to get metrics: ${err}` };
        }
      },
    },

    // ── synapse_dashboard: Get dashboard URL ──
    {
      name: 'synapse_dashboard',
      description:
        'Get the URL for the Synapse real-time monitoring dashboard. Open this URL in a browser to see live AI agent activity.',
      parameters: {
        type: 'object',
        properties: {},
      },
      execute: async () => {
        try {
          const res = await fetch(`${baseUrl}/api/health`);
          const health = (await res.json()) as Record<string, unknown>;
          return {
            url: baseUrl,
            status: health.ok ? 'running' : 'error',
            connectedClients: health.clients,
            mode: health.mode || 'openclaw',
          };
        } catch {
          return {
            url: baseUrl,
            status: 'unreachable',
            message: 'Synapse server may not be running',
          };
        }
      },
    },
  ];
}
