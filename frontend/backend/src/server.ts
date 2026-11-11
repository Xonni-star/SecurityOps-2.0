import { app } from './app';
import { env } from './config/env';
import { verifyAppDatabaseRole } from './config/database';

async function startServer() {
  try {
    console.log('[SECURITYOPS 2.0] Überprüfe Datenbank-Berechtigungen...');
    const { currentUser, isLeastPrivilege } = await verifyAppDatabaseRole();
    console.log(`[DATABASE ROLE] Verbunden als '${currentUser}' (Least-Privilege: ${isLeastPrivilege})`);

    app.listen(env.PORT, () => {
      console.log(`[SECURITYOPS 2.0 BACKEND] Läuft auf Port ${env.PORT} im ${env.NODE_ENV}-Modus.`);
      console.log(`[CORS ALLOWED] Autorisierte Origins: ${env.CORS_ALLOWED_ORIGINS.join(', ')}`);
      console.log(`[API V1] Bereit unter http://localhost:${env.PORT}/api/v1/health`);
    });
  } catch (err: any) {
    console.error('[STARTUP FAILED]', err.message);
    process.exit(1);
  }
}

startServer();
