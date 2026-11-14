import { rateLimit, Store } from 'express-rate-limit';

export function createApiRateLimiter(limit: number, skipTests = true, store?: Store) {
  return rateLimit({
    windowMs: 60 * 1000,
    limit,
    store,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    skip: () => skipTests && process.env.NODE_ENV === 'test',
    handler: (_req, res) => res.status(429).json({
      success: false,
      code: 'RATE_LIMIT_EXCEEDED',
      message: 'Zu viele Anfragen. Bitte später erneut versuchen.'
    })
  });
}
