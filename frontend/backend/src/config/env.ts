import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
  PORT: z.string().default('8000').transform((val) => parseInt(val, 10)),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().min(10, 'DATABASE_URL muss zwingend konfiguriert sein.'),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET muss mindestens 32 Zeichen lang sein.'),
  JWT_EXPIRES_IN: z.string().default('8h'),
  CORS_ORIGIN: z.string().min(1, 'CORS_ORIGIN muss explizit konfiguriert werden (kein ungesicherter Wildcard).'),
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

// Parsen der CORS-Origins: Bereinigung von Leerzeichen, Validierung und Wildcard-Prüfung
const rawCors = parsedEnv.data.CORS_ORIGIN;
export const parsedCorsOrigins: string[] = rawCors
  .split(',')
  .map((origin) => origin.trim())
  .filter((origin) => origin.length > 0);

if (parsedCorsOrigins.length === 0) {
  console.error('[PRODUKTIONSABBRUCH] CORS_ORIGIN enthält keine gültigen Ursprünge.');
  process.exit(1);
}

if (parsedEnv.data.NODE_ENV === 'production' && parsedCorsOrigins.includes('*')) {
  console.error('[PRODUKTIONSABBRUCH] CORS_ORIGIN darf in der Produktionsumgebung kein Wildcard "*" enthalten.');
  process.exit(1);
}

export const env = {
  ...parsedEnv.data,
  CORS_ALLOWED_ORIGINS: parsedCorsOrigins
};
