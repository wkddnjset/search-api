import type { Request, Response, NextFunction } from 'express';
import { config } from '../config.js';
import { AppError } from '../types/index.js';

export function authMiddleware(req: Request, _res: Response, next: NextFunction): void {
  const token = req.headers['x-subscription-token'] as string | undefined;

  if (!token || !config.apiKeys.includes(token)) {
    next(new AppError('UNAUTHORIZED', 401, 'Invalid or missing API key'));
    return;
  }

  next();
}
