// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Synapse Contributors

import { Router, type Request, type Response } from 'express';
import { logger } from '../lib/logger.js';
import type { AgentManager } from '../services/agentManager.js';
import type { Broadcaster } from '../services/broadcaster.js';
import type { SpawnAgentRequest } from '@synapse-ai/core';
import { SpawnAgentRequestSchema, SendMessageSchema } from '@synapse-ai/core';
import { validateBody } from '../lib/validate.js';

export function createAgentsRouter(agentManager: AgentManager, broadcaster: Broadcaster): Router {
  const router = Router();

  // GET /api/agents — list active agents
  router.get('/', (_req: Request, res: Response) => {
    const agents = agentManager.getAll();
    res.json(agents);
  });

  // POST /api/agents/spawn — spawn new agent
  router.post(
    '/spawn',
    validateBody(SpawnAgentRequestSchema),
    async (req: Request, res: Response) => {
      try {
        const request = req.body as SpawnAgentRequest;

        const agentId = await agentManager.spawn(request, broadcaster);
        logger.info({ agentId }, 'Spawned agent');
        res.status(201).json({ ok: true, agentId });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        if (message === 'Max concurrent agents reached') {
          res.status(429).json({ error: message });
        } else {
          logger.error({ err }, 'Spawn error');
          res.status(500).json({ error: 'Failed to spawn agent' });
        }
      }
    },
  );

  // POST /api/agents/:id/message — send message to running agent
  router.post(
    '/:id/message',
    validateBody(SendMessageSchema),
    async (req: Request, res: Response) => {
      try {
        const id = req.params.id as string;
        const { message } = req.body;

        const ok = await agentManager.sendMessage(id, message, broadcaster);
        if (!ok) {
          res.status(404).json({ error: 'Agent not found or not resumable' });
          return;
        }
        res.json({ ok: true });
      } catch (err: unknown) {
        logger.error({ err }, 'Error sending message');
        res.status(500).json({ error: 'Failed to send message' });
      }
    },
  );

  // DELETE /api/agents/:id — stop agent
  router.delete('/:id', (req: Request, res: Response) => {
    const id = req.params.id as string;
    const stopped = agentManager.stop(id);
    if (!stopped) {
      res.status(404).json({ error: 'Agent not found' });
      return;
    }
    logger.info({ agentId: id }, 'Stopped agent');
    res.json({ ok: true });
  });

  return router;
}
