import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';

export function errorHandler(err: any, req: Request, res: Response, next: NextFunction): void {
  if (err instanceof ZodError) {
    res.status(400).json({
      success: false,
      message: 'Validierungsfehler',
      errors: err.issues.map((issue) => `${issue.path.join('.') || 'body'}: ${issue.message}`)
    });
    return;
  }

  console.error('[API ERROR]', {
    path: req.path,
    method: req.method,
    error: err.message,
    stack: err.stack
  });

  const statusCode = err.statusCode || 500;
  res.status(statusCode).json({
    success: false,
    message: err.message || 'Interner Serverfehler',
    errors: err.errors || undefined
  });
}
