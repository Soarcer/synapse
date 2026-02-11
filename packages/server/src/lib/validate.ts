import { z } from 'zod';
import type { Request, Response, NextFunction } from 'express';

/** Returns Express middleware that validates `req.body` against the schema. */
export function validateBody(schema: z.ZodSchema) {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      res.status(400).json({
        error: 'Validation failed',
        details: result.error.format(),
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
        details: result.error.format(),
      });
      return;
    }
    next();
  };
}
