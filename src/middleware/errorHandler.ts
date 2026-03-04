import type { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { AppError } from '../types/index.js';
import type { ErrorResponse } from '../types/index.js';

export function errorHandler(err: Error, _req: Request, res: Response, _next: NextFunction): void {
  let response: ErrorResponse;

  if (err instanceof AppError) {
    response = {
      type: 'ErrorResponse',
      error: {
        id: err.id,
        status: err.status,
        message: err.message,
      },
    };
  } else if (err instanceof ZodError) {
    const message = err.errors.map((e) => e.message).join(', ');
    response = {
      type: 'ErrorResponse',
      error: {
        id: 'VALIDATION_ERROR',
        status: 422,
        message,
      },
    };
  } else {
    response = {
      type: 'ErrorResponse',
      error: {
        id: 'INTERNAL_ERROR',
        status: 500,
        message: 'An unexpected error occurred',
      },
    };
  }

  res.status(response.error.status).json(response);
}
