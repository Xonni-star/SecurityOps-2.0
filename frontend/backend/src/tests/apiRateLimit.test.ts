import express from 'express';
import request from 'supertest';
import { createApiRateLimiter } from '../middleware/apiRateLimit';
import { configureTrustedProxies } from '../middleware/trustedProxies';

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

  test('uses forwarded client IPs only when the immediate proxy is trusted', async () => {
    const app = express();
    configureTrustedProxies(app, 'loopback');
    app.use(createApiRateLimiter(1, false));
    app.get('/resource', (_req, res) => res.json({ success: true }));

    const firstClient = await request(app).get('/resource').set('X-Forwarded-For', '198.51.100.10');
    const secondClient = await request(app).get('/resource').set('X-Forwarded-For', '198.51.100.11');
    const firstClientAgain = await request(app).get('/resource').set('X-Forwarded-For', '198.51.100.10');

    expect(firstClient.status).toBe(200);
    expect(secondClient.status).toBe(200);
    expect(firstClientAgain.status).toBe(429);
  });

  test('ignores client-supplied forwarded IPs when no proxy is trusted', async () => {
    const app = express();
    configureTrustedProxies(app, '');
    app.use(createApiRateLimiter(1, false));
    app.get('/resource', (_req, res) => res.json({ success: true }));

    const first = await request(app).get('/resource').set('X-Forwarded-For', '198.51.100.10');
    const spoofed = await request(app).get('/resource').set('X-Forwarded-For', '198.51.100.11');

    expect(first.status).toBe(200);
    expect(spoofed.status).toBe(429);
  });
});
