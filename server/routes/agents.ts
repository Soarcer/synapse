import { Router, type Request, type Response } from 'express';
import type { AgentManager } from '../services/agentManager.js';
import type { Broadcaster } from '../services/broadcaster.js';
import type { SpawnAgentRequest } from '../../src/types/agent.js';

export function createAgentsRouter(
  agentManager: AgentManager,
  broadcaster: Broadcaster,
): Router {
  const router = Router();

  // GET /api/agents — list active agents
  router.get('/', (_req: Request, res: Response) => {
    const agents = agentManager.getAll();
    res.json(agents);
  });

  // POST /api/agents/spawn — spawn new agent
  router.post('/spawn', async (req: Request, res: Response) => {
    try {
      const request = req.body as SpawnAgentRequest;

      // Input validation
      if (!request.prompt || typeof request.prompt !== 'string') {
        res.status(400).json({ error: 'prompt is required and must be a string' });
        return;
      }
      if (request.prompt.length > 100_000) {
        res.status(400).json({ error: 'prompt exceeds 100k character limit' });
        return;
      }
      if (request.model != null && typeof request.model !== 'string') {
        res.status(400).json({ error: 'model must be a string' });
        return;
      }
      if (request.tools != null && (!Array.isArray(request.tools) || request.tools.length > 50)) {
        res.status(400).json({ error: 'tools must be an array with at most 50 items' });
        return;
      }
      if (request.cwd != null) {
        if (typeof request.cwd !== 'string' || request.cwd.includes('..')) {
          res.status(400).json({ error: 'cwd must be an absolute path without ".." traversal' });
          return;
        }
      }

      const agentId = await agentManager.spawn(request, broadcaster);
      console.log(`[Agents] Spawned agent ${agentId}`);
      res.status(201).json({ ok: true, agentId });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      if (message === 'Max concurrent agents reached') {
        res.status(429).json({ error: message });
      } else {
        console.error('[Agents] Spawn error:', err);
        res.status(500).json({ error: message });
      }
    }
  });

  // POST /api/agents/:id/message — send message to running agent
  router.post('/:id/message', async (req: Request, res: Response) => {
    try {
      const id = req.params.id as string;
      const { message } = req.body;
      if (!message) {
        res.status(400).json({ error: 'message is required' });
        return;
      }

      const ok = await agentManager.sendMessage(id, message, broadcaster);
      if (!ok) {
        res.status(404).json({ error: 'Agent not found or not resumable' });
        return;
      }
      res.json({ ok: true });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      console.error('[Agents] Error sending message:', err);
      res.status(500).json({ error: message });
    }
  });

  // DELETE /api/agents/:id — stop agent
  router.delete('/:id', (req: Request, res: Response) => {
    const id = req.params.id as string;
    const stopped = agentManager.stop(id);
    if (!stopped) {
      res.status(404).json({ error: 'Agent not found' });
      return;
    }
    console.log(`[Agents] Stopped agent ${id}`);
    res.json({ ok: true });
  });

  return router;
}