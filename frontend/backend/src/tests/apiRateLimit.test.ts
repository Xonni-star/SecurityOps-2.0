import express from 'express';
import request from 'supertest';
import { RedisStore, RedisReply } from 'rate-limit-redis';
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

  test('shares a Redis-backed request budget across independent limiter instances', async () => {
    const sharedCounters = new Map<string, { hits: number; expiresAt: number }>();
    const sendCommand = async (...args: string[]): Promise<RedisReply> => {
      if (args[0] === 'SCRIPT' && args[1] === 'LOAD') return 'test-script-sha';
      if (args[0] !== 'EVALSHA') throw new Error(`Unexpected Redis command: ${args[0]}`);

      const key = args[3];
      const windowMs = Number(args[4]);
      const now = Date.now();
      const current = sharedCounters.get(key);
      const counter = !current || current.expiresAt <= now
        ? { hits: 1, expiresAt: now + windowMs }
        : { ...current, hits: current.hits + 1 };
      sharedCounters.set(key, counter);
      return [counter.hits, counter.expiresAt - now];
    };
    const createStore = () => new RedisStore({
      prefix: 'test:',
      sendCommand
    });

    const firstApp = express();
    firstApp.use(createApiRateLimiter(1, false, createStore()));
    firstApp.get('/resource', (_req, res) => res.json({ success: true }));

    const secondApp = express();
    secondApp.use(createApiRateLimiter(1, false, createStore()));
    secondApp.get('/resource', (_req, res) => res.json({ success: true }));

    const first = await request(firstApp).get('/resource');
    const secondInstance = await request(secondApp).get('/resource');

    expect(first.status).toBe(200);
    expect(secondInstance.status).toBe(429);
  });

  test('does not bypass the rate limit when its shared store fails', async () => {
    const store = new RedisStore({
      sendCommand: async (...args: string[]): Promise<RedisReply> => {
        if (args[0] === 'SCRIPT' && args[1] === 'LOAD') return 'test-script-sha';
        throw new Error('Redis unavailable');
      }
    });
    const app = express();
    app.use(createApiRateLimiter(1, false, store));
    app.get('/resource', (_req, res) => res.json({ success: true }));

    const response = await request(app).get('/resource');

    expect(response.status).toBe(500);
  });
});
