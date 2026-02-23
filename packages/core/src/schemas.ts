// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Synapse Contributors

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

/** Validates incoming hook events (POST /api/events). */
export const AgentEventSchema = z
  .object({
    hook_event_name: z.string().optional(),
    session_id: z.string().optional(),
    agent_id: z.string().optional(),
    agent_type: z.string().optional(),
    tool_name: z.string().optional(),
    tool_use_id: z.string().optional(),
    tool_input: z.record(z.string(), z.unknown()).optional(),
    tool_response: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

/** Validates POST /api/agents/spawn. */
export const SpawnAgentRequestSchema = z.object({
  prompt: z.string().min(1).max(100_000),
  model: z.enum(['opus', 'sonnet', 'haiku']).optional(),
  tools: z.array(z.string()).max(50).optional(),
  permissionMode: z.enum(['acceptEdits', 'bypassPermissions', 'default']).optional(),
  systemPrompt: z.string().max(100_000).optional(),
  mcpServers: z
    .record(
      z.string(),
      z.object({
        command: z.string(),
        args: z.array(z.string()),
        env: z.record(z.string(), z.string()).optional(),
      }),
    )
    .optional(),
  cwd: z
    .string()
    .max(500)
    .refine((s) => !s.includes('..'), 'Path traversal not allowed')
    .refine((s) => !/^[a-zA-Z]:/.test(s) && !s.startsWith('/'), 'Absolute paths not allowed')
    .optional(),
  sessionId: z.string().optional(),
});

/** Validates POST /api/agents/:id/message. */
export const SendMessageSchema = z.object({
  message: z.string().min(1),
});

/** Validates GET /api/events query parameters. */
export const EventQuerySchema = z.object({
  sessionId: z.string().optional(),
  agentId: z.string().optional(),
  type: z.string().optional(),
  cwd: z.string().max(500).optional(),
  from: z.coerce.number().int().min(0).optional(),
  to: z.coerce.number().int().min(0).optional(),
  limit: z.coerce.number().int().min(1).max(2000).optional(),
  offset: z.coerce.number().int().min(0).max(100_000).optional(),
});

/** Validates POST /api/snapshot/import. */
export const SnapshotImportSchema = z.object({
  version: z.literal(1),
  exportedAt: z.string(),
  projectDir: z.string(),
  sessions: z.array(
    z.object({
      sessionId: z.string(),
      events: z.array(z.unknown()),
      transcript: z.unknown().nullable(),
    }),
  ),
});

/** Validates coaching single-session queries (GET /api/analytics/coaching/report-card). */
export const CoachingQuerySchema = z.object({
  sessionId: z.string().min(1),
});

/** Validates coaching multi-session queries (GET /api/analytics/coaching/report-card/multi). */
export const CoachingMultiQuerySchema = z.object({
  sessionIds: z.string().min(1),
});

/** Validates POST /api/analytics/coaching/playbooks. */
export const PlaybookCreateSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000),
  category: z.enum(['feature', 'bugfix', 'refactor', 'test', 'review', 'debug', 'custom']),
  sourceSessionId: z.string().optional(),
  tags: z.array(z.string().max(50)).max(20).optional(),
});

/** Validates POST /api/analytics/coaching/nudges/dismiss. */
export const NudgeDismissSchema = z.object({
  nudgeId: z.string().min(1),
  sessionId: z.string().min(1),
});

/** Validates GET /api/analytics/* query parameters. */
export const AnalyticsQuerySchema = z.object({
  from: z.coerce.number().int().min(0).optional(),
  to: z.coerce.number().int().min(0).optional(),
  cwd: z.string().max(500).optional(),
  granularity: z.enum(['hour', 'day', 'week']).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
  offset: z.coerce.number().int().min(0).max(100_000).optional(),
  sessionId: z.string().optional(),
  model: z.string().optional(),
  vendor: z.string().optional(),
});

/** Validates POST /api/analytics/prices body. */
export const PriceCreateSchema = z.object({
  model: z.string().min(1),
  vendor: z.string().min(1),
  effectiveFrom: z.number().int().min(0),
  inputPer1M: z.number().min(0),
  cachedInputPer1M: z.number().min(0),
  outputPer1M: z.number().min(0),
});
