import rateLimit from 'express-rate-limit';
import type { Request, Response } from 'express';
import { config } from '../config.js';

export const rateLimitMiddleware = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.max,
  keyGenerator: (req: Request) => (req.headers['x-subscription-token'] as string) || req.ip || 'unknown',
  handler: (_req: Request, res: Response) => {
    res.status(429).json({
      type: 'ErrorResponse',
      error: {
        id: 'RATE_LIMITED',
        status: 429,
        message: 'Too many requests. Please try again later.',
      },
    });
  },
  standardHeaders: true,
  legacyHeaders: false,
});
