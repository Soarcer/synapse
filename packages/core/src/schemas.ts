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
  permissionMode: z
    .enum(['acceptEdits', 'bypassPermissions', 'default'])
    .optional(),
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
    .refine((s) => !s.includes('..'), 'Path traversal not allowed')
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
  cwd: z.string().optional(),
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
