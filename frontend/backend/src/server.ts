import { app } from './app';
import { env } from './config/env';
import { verifyAppDatabaseRole } from './config/database';
import { startAlarmEscalationWorker, stopAlarmEscalationWorker } from './services/alarmEscalationWorker';

async function bootstrap() {
  try {
    // 3. Vor dem Start des HTTP-Servers die Datenbankrolle zwingend verifizieren:
    // Der Anwendungsbenutzer DARF KEIN Superuser und KEIN BYPASSRLS sein!
    await verifyAppDatabaseRole();

    const server = app.listen(env.PORT, () => {
      console.log(`[SECURITYOPS 2.0 BACKEND] Gestartet auf Port ${env.PORT} (${env.NODE_ENV}).`);
      console.log(`[CORS WHITELIST] Erlaubte Origins: ${env.ALLOWED_CORS_ORIGINS.join(', ')}`);
      console.log(`[API V1 HEALTH] http://localhost:${env.PORT}/api/v1/health`);
    });
    startAlarmEscalationWorker();
    const shutdown = () => {
      stopAlarmEscalationWorker();
      server.close(() => process.exit(0));
    };
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
  } catch {
    console.error('[FATAL SERVER START ERROR] Startup aborted; exception details were suppressed.');
    process.exit(1);
  }
}

bootstrap();
