// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Synapse Contributors

import { z } from 'zod';
import type { Request, Response, NextFunction } from 'express';

/** Flatten Zod errors into user-friendly field messages without exposing schema internals. */
function flattenErrors(error: z.ZodError): string[] {
  return error.issues.map((issue) => {
    const path = issue.path.length > 0 ? `${issue.path.join('.')}: ` : '';
    return `${path}${issue.message}`;
  });
}

/** Returns Express middleware that validates `req.body` against the schema. */
export function validateBody(schema: z.ZodSchema) {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      res.status(400).json({
        error: 'Validation failed',
        details: flattenErrors(result.error),
      });
      return;
    }
    req.body = result.data;
    next();
  };
}

/** Returns Express middleware that validates `req.query` against the schema. */
export function validateQuery(schema: z.ZodSchema) {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.query);
    if (!result.success) {
      res.status(400).json({
        error: 'Invalid query parameters',
        details: flattenErrors(result.error),
      });
      return;
    }
    next();
  };
}
