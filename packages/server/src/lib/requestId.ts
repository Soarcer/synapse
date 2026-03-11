// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bernhard

import { nanoid } from 'nanoid';
import type { Request, Response, NextFunction } from 'express';

export function requestIdMiddleware(req: Request, res: Response, next: NextFunction) {
  const id = (req.headers['x-request-id'] as string) ?? nanoid(12);
  (req as Request & { requestId: string }).requestId = id;
  res.setHeader('x-request-id', id);
  next();
}
