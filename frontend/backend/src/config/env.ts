import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
  PORT: z.string().default('8000').transform((val) => parseInt(val, 10)),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().min(10, 'DATABASE_URL muss zwingend konfiguriert sein (für secops_app_user).'),
  // Nur der Migrationsrunner benötigt die administrative Verbindung.
  // Der normale API-Server läuft ausschließlich mit secops_app_user.
  DATABASE_MIGRATION_URL: z.string().min(10, 'DATABASE_MIGRATION_URL muss für Migrationen konfiguriert sein.').optional(),
  DMS_S3_ENDPOINT: z.string().url().default('http://127.0.0.1:9000'),
  DMS_S3_REGION: z.string().min(1).default('us-east-1'),
  DMS_S3_BUCKET: z.string().min(3).max(63).default('securityops-documents'),
  DMS_S3_ACCESS_KEY: z.string().min(1).default('local-dev-access-key'),
  DMS_S3_SECRET_KEY: z.string().min(1).default('local-dev-secret-key'),
  DMS_S3_FORCE_PATH_STYLE: z.enum(['true', 'false']).default('true').transform((value) => value === 'true'),
  DMS_SCAN_REQUIRED: z.enum(['true', 'false']).default('true').transform((value) => value === 'true'),
  DMS_SCANNER_PROVIDER: z.enum(['none', 'clamav']).default('none'),
  DMS_CLAMAV_HOST: z.string().min(1).default('127.0.0.1'),
  DMS_CLAMAV_PORT: z.coerce.number().int().min(1).max(65535).default(3310),
  DMS_CLAMAV_TIMEOUT_MS: z.coerce.number().int().positive().max(120000).default(30000),
  DMS_MAX_FILE_SIZE_BYTES: z.coerce.number().int().positive().max(100 * 1024 * 1024).default(10 * 1024 * 1024),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET muss mindestens 32 Zeichen lang sein.'),
  // Nur Einheiten, die auch parseDurationToMs() versteht (siehe authController.ts),
  // damit JWT-Ablauf und Sitzungs-Ablaufzeit garantiert identisch sind.
  JWT_EXPIRES_IN: z.string().regex(/^\d+[smhd]$/, 'JWT_EXPIRES_IN muss dem Format <Zahl><s|m|h|d> entsprechen (z. B. 8h).').default('8h'),
  CORS_ORIGIN: z.string().min(1, 'CORS_ORIGIN muss konfiguriert sein.'),
  TRUST_PROXY: z.string().default(''),
  RATE_LIMIT_MAX: z.string().default('120').transform((val) => parseInt(val, 10)).pipe(z.number().int().positive()),
  RATE_LIMIT_REDIS_URL: z.string().url()
    .refine((value) => /^rediss?:\/\//i.test(value), 'RATE_LIMIT_REDIS_URL muss eine Redis-URL sein.')
    .optional()
}).superRefine((config, context) => {
  if (config.NODE_ENV === 'production' && !config.RATE_LIMIT_REDIS_URL) {
    context.addIssue({
      code: 'custom',
      path: ['RATE_LIMIT_REDIS_URL'],
      message: 'RATE_LIMIT_REDIS_URL ist im Produktivmodus erforderlich.'
    });
  }
});

const parsedEnv = envSchema.superRefine((config, context) => {
  if (config.NODE_ENV !== 'production') return;
  if ([config.DMS_S3_ACCESS_KEY, config.DMS_S3_SECRET_KEY].some((value) =>
    value.startsWith('local-dev-') || value.startsWith('CHANGEME'))) {
    context.addIssue({ code: 'custom', path: ['DMS_S3_ACCESS_KEY'], message: 'Produktionszugangsdaten für S3 müssen gesetzt werden.' });
  }
  if (new URL(config.DMS_S3_ENDPOINT).protocol !== 'https:') {
    context.addIssue({ code: 'custom', path: ['DMS_S3_ENDPOINT'], message: 'Der S3-Endpunkt muss in Produktion HTTPS verwenden.' });
  }
  if (config.DMS_SCAN_REQUIRED && config.DMS_SCANNER_PROVIDER === 'none') {
    context.addIssue({ code: 'custom', path: ['DMS_SCANNER_PROVIDER'], message: 'Bei verpflichtender Prüfung muss ein Scanner konfiguriert sein.' });
  }
}).safeParse(process.env);

if (!parsedEnv.success) {
  console.error('[FATAL CONFIG ERROR] Ungültige oder fehlende Umgebungsvariablen:');
  parsedEnv.error.issues.forEach((issue) => {
    console.error(` - ${issue.path.join('.')}: ${issue.message}`);
  });
  console.error('[SICHERHEITSABBRUCH] Backend kann ohne gültige Umgebungsvariablen nicht gestartet werden.');
  process.exit(1);
}

// Prüfung auf unsichere Default- oder Beispielwerte
const knownInsecureSecrets = [
  'SEC-OPS-2025-ENTERPRISE-ARGON2-SUPER-SECURE-KEY-VAULT-32CHARS',
  'HIER_MINDESTENS_32_ZEICHEN_LANGES_KRYPTOGRAFISCHES_GEHEIMNIS_EINTRAGEN',
  'CHANGEME_HEX64_SECRET_KEY_FOR_JWT_AUTHENTICATION',
  'test_secret_key_hex_64_characters_minimum_security_length_token_vault'
];

if (knownInsecureSecrets.includes(parsedEnv.data.JWT_SECRET)) {
  console.error('[SICHERHEITSWARNUNG] JWT_SECRET verwendet ein bekanntes Test-/Beispielgeheimnis!');
  if (parsedEnv.data.NODE_ENV === 'production') {
    console.error('[PRODUKTIONSABBRUCH] Start im Produktivmodus mit unsicherem JWT_SECRET verweigert.');
    process.exit(1);
  }
}

// 4. CORS Whitelist Parsing & Validierung:
// Kommagetrennte Origins parsen, Leerzeichen entfernen und doppelte Einträge bereinigen.
const rawOrigins = parsedEnv.data.CORS_ORIGIN.split(',')
  .map((o) => o.trim())
  .filter((o) => o.length > 0);

const uniqueOrigins = Array.from(new Set(rawOrigins));

// Wildcard '*' grundsätzlich verbieten
if (uniqueOrigins.includes('*')) {
  console.error('[SICHERHEITSABBRUCH] CORS_ORIGIN darf niemals das ungesicherte Wildcard "*" enthalten.');
  process.exit(1);
}

// Ausschließlich gültige HTTP-/HTTPS-Origins akzeptieren
const originRegex = /^https?:\/\/[a-zA-Z0-9\.\-:]+$/;
for (const origin of uniqueOrigins) {
  if (!originRegex.test(origin)) {
    console.error('[SICHERHEITSABBRUCH] CORS_ORIGIN enthält einen ungültigen Origin; nur HTTP-/HTTPS-Origin-Formate sind zulässig.');
    process.exit(1);
  }
}

export const env = {
  ...parsedEnv.data,
  ALLOWED_CORS_ORIGINS: uniqueOrigins
};
