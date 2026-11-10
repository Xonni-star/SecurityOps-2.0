import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
  PORT: z.string().default('8000').transform((val) => parseInt(val, 10)),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().default('postgresql://secops_admin:SecOpsVault2025Secure@localhost:5432/securityops_v2'),
  JWT_SECRET: z.string().min(32).default('SEC-OPS-2025-ENTERPRISE-ARGON2-SUPER-SECURE-KEY-VAULT-32CHARS'),
  JWT_EXPIRES_IN: z.string().default('8h'),
  CORS_ORIGIN: z.string().default('*'),
  RATE_LIMIT_MAX: z.string().default('120').transform((val) => parseInt(val, 10))
});

export const env = envSchema.parse(process.env);
