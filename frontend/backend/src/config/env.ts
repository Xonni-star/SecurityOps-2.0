import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
  PORT: z.string().default('8000').transform((val) => parseInt(val, 10)),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().min(10, 'DATABASE_URL muss zwingend konfiguriert sein (secops_app_user).'),
  DATABASE_MIGRATION_URL: z.string().min(10).optional(),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET muss mindestens 32 Zeichen lang sein.'),
  JWT_EXPIRES_IN: z.string().default('8h'),
  CORS_ORIGIN: z.string().min(1, 'CORS_ORIGIN muss explizit konfiguriert werden.'),
  RATE_LIMIT_MAX: z.string().default('120').transform((val) => parseInt(val, 10))
});

const parsedEnv = envSchema.safeParse(process.env);

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

// Aufgabe 4: CORS Origins strikt parsen, trimmen, Duplikate entfernen und URL-Validierung erzwingen
const rawCors = parsedEnv.data.CORS_ORIGIN;
const rawOriginsList = rawCors
  .split(',')
  .map((origin) => origin.trim())
  .filter((origin) => origin.length > 0);

// Duplikate über Set eliminieren
const uniqueOrigins = Array.from(new Set(rawOriginsList));

// Wildcard '*' grundsätzlich verweigern
if (uniqueOrigins.includes('*')) {
  console.error('[SICHERHEITSABBRUCH] CORS_ORIGIN darf kein Wildcard "*" enthalten. Explizite Origins erforderlich.');
  process.exit(1);
}

// Validierung jedes Ursprungs als valide HTTP/HTTPS URL
export const parsedCorsOrigins: string[] = [];
for (const origin of uniqueOrigins) {
  try {
    const url = new URL(origin);
    if (!['http:', 'https:'].includes(url.protocol)) {
      throw new Error(`Ungültiges Protokoll '${url.protocol}'`);
    }
    // Herkunft ohne trailing slash normalisieren
    parsedCorsOrigins.push(url.origin);
  } catch (err: any) {
    console.error(`[CORS CONFIG ERROR] Ungültige Origin-URL '${origin}': ${err.message}`);
    process.exit(1);
  }
}

if (parsedCorsOrigins.length === 0) {
  console.error('[PRODUKTIONSABBRUCH] Keine gültigen CORS-Origins konfiguriert.');
  process.exit(1);
}

export const env = {
  ...parsedEnv.data,
  DATABASE_MIGRATION_URL: parsedEnv.data.DATABASE_MIGRATION_URL || parsedEnv.data.DATABASE_URL,
  CORS_ALLOWED_ORIGINS: parsedCorsOrigins
};
