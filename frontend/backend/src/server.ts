import { app } from './app';
import { env } from './config/env';

app.listen(env.PORT, () => {
  console.log(`[SECURITYOPS 2.0 BACKEND] Läuft auf Port ${env.PORT} im ${env.NODE_ENV}-Modus.`);
  console.log(`[API V1] Bereit unter http://localhost:${env.PORT}/api/v1/health`);
});
