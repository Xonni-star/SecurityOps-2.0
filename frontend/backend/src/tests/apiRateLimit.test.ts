import express from 'express';
import request from 'supertest';
import { createApiRateLimiter } from '../middleware/apiRateLimit';

describe('API rate limiting', () => {
  test('returns a retryable 429 after the configured per-IP request budget', async () => {
    const app = express();
    app.use(createApiRateLimiter(1, false));
    app.get('/resource', (_req, res) => res.json({ success: true }));

    const first = await request(app).get('/resource');
    const limited = await request(app).get('/resource');

    expect(first.status).toBe(200);
    expect(limited.status).toBe(429);
    expect(limited.body).toMatchObject({ success: false, code: 'RATE_LIMIT_EXCEEDED' });
    expect(limited.headers['retry-after']).toBeDefined();
  });
});
