// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bernhard

import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { validateCwd, readHookStatus, writeHookConfig } from '../services/hookConfigService.js';

const HookConfigBody = z.object({
  cwd: z.string().min(1),
  observation: z.boolean(),
  remoteApproval: z.boolean(),
});

export function createHookConfigRouter(): Router {
  const router = Router();

  // GET /api/hook-config?cwd=<path>
  router.get('/', (req: Request, res: Response) => {
    const cwd = req.query.cwd as string;
    if (!cwd) {
      res.status(400).json({ error: 'cwd query parameter required' });
      return;
    }
    try {
      validateCwd(cwd);
      const status = readHookStatus(cwd);
      res.json({ ...status, cwd });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Invalid cwd';
      res.status(400).json({ error: message });
    }
  });

  // POST /api/hook-config
  router.post('/', (req: Request, res: Response) => {
    const parsed = HookConfigBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const { cwd, observation, remoteApproval } = parsed.data;
    try {
      validateCwd(cwd);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Invalid cwd';
      res.status(400).json({ ok: false, error: message });
      return;
    }
    try {
      writeHookConfig(cwd, { observation, remoteApproval });
      const updated = readHookStatus(cwd);
      res.json({ ok: true, ...updated });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to write hook config';
      res.status(500).json({ ok: false, error: message });
    }
  });

  return router;
}
