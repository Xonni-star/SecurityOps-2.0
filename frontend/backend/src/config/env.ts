import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
  PORT: z.string().default('8000').transform((val) => parseInt(val, 10)),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().min(10, 'DATABASE_URL muss angegeben sein.'),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET muss aus Sicherheitsgründen mindestens 32 Zeichen lang sein.'),
  JWT_EXPIRES_IN: z.string().default('8h'),
  CORS_ORIGIN: z.string().default('*'),
  RATE_LIMIT_MAX: z.string().default('120').transform((val) => parseInt(val, 10))
});

const parsedEnv = envSchema.safeParse(process.env);

if (!parsedEnv.success) {
  console.error('[FATAL CONFIG ERROR] Ungültige oder fehlende Umgebungsvariablen:');
  parsedEnv.error.issues.forEach((issue) => {
    console.error(` - ${issue.path.join('.')}: ${issue.message}`);
  });
  // Im Produktivbetrieb sofort abbrechen
  if (process.env.NODE_ENV === 'production') {
    process.exit(1);
  }
}

// Sichere Fallback-Werte ausschließlich für die lokale Test- und Entwicklungsumgebung
export const env = parsedEnv.success
  ? parsedEnv.data
  : {
      PORT: parseInt(process.env.PORT || '8000', 10),
      NODE_ENV: (process.env.NODE_ENV as 'development' | 'test' | 'production') || 'development',
      DATABASE_URL:
        process.env.DATABASE_URL ||
        'postgresql://secops_admin:SecOpsVault2025Secure@localhost:5432/securityops_v2',
      JWT_SECRET:
        process.env.JWT_SECRET || 'SEC-OPS-2025-ENTERPRISE-ARGON2-SUPER-SECURE-KEY-VAULT-32CHARS',
      JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '8h',
      CORS_ORIGIN: process.env.CORS_ORIGIN || '*',
      RATE_LIMIT_MAX: parseInt(process.env.RATE_LIMIT_MAX || '120', 10)
    };
