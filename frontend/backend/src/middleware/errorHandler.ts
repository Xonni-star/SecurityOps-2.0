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

  const reportedStatus = err?.statusCode ?? err?.status;
  const statusCode = Number.isInteger(reportedStatus) && reportedStatus >= 400 && reportedStatus <= 599
    ? reportedStatus
    : 500;

  // Keep diagnostics out of client responses and avoid logging exception text
  // or stacks, which can contain SQL, credentials, or personal data.
  console.error('[API ERROR]', {
    path: req.path,
    method: req.method,
    statusCode
  });

  res.status(statusCode).json({
    success: false,
    message: statusCode >= 500 ? 'Interner Serverfehler' : (err.message || 'Anfrage fehlgeschlagen')
  });
}
