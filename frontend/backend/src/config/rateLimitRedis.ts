import { RedisStore } from 'rate-limit-redis';
import { createClient } from 'redis';
import { env } from './env';

export const rateLimitRedisClient = env.RATE_LIMIT_REDIS_URL
  ? createClient({
    url: env.RATE_LIMIT_REDIS_URL,
    disableOfflineQueue: true,
    socket: { connectTimeout: 5000 }
  })
  : undefined;

rateLimitRedisClient?.on('error', () => {
  console.error('[RATE LIMIT REDIS] Shared rate-limit store connection failed.');
});

export const rateLimitStore = rateLimitRedisClient
  ? new RedisStore({
    prefix: 'securityops:api-rate-limit:',
    sendCommand: (...args: string[]) => rateLimitRedisClient.sendCommand(args)
  })
  : undefined;

export async function connectRateLimitRedis(): Promise<void> {
  if (!rateLimitRedisClient) return;

  try {
    await rateLimitRedisClient.connect();
  } catch {
    console.error('[FATAL RATE LIMIT REDIS] Could not connect to the shared rate-limit store.');
    throw new Error('Shared rate-limit store connection failed.');
  }
}
