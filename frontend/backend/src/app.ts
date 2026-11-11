import express from 'express';
import cors, { CorsOptions } from 'cors';
import helmet from 'helmet';
import { env } from './config/env';
import { pool } from './config/database';
import { errorHandler } from './middleware/errorHandler';
import { authenticateJwt, requirePermission } from './middleware/auth';
import * as authController from './controllers/authController';
import * as clientController from './controllers/clientController';
import * as guardbookController from './controllers/guardbookController';
import * as syncController from './controllers/syncController';

export const app = express();

app.use(helmet());

// 4. Sichere CORS-Konfiguration:
// Whitelist-basierte Ursprungsprüfung ohne Wildcards.
// Anfragen ohne Origin (z. B. Server-zu-Server oder Testumgebung) werden kontrolliert zugelassen.
const corsOptions: CorsOptions = {
  origin: (origin, callback) => {
    if (!origin) {
      return callback(null, true);
    }
    if (env.ALLOWED_CORS_ORIGINS.includes(origin)) {
      return callback(null, true);
    }
    callback(new Error(`CORS blockiert: Herkunft "${origin}" ist nicht in der Whitelist autorisiert.`));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
};

app.use(cors(corsOptions));
app.use(express.json({ limit: '15mb' }));

// Health- & Readiness-Endpunkt
app.get('/api/v1/health', async (req, res) => {
  try {
    const dbRes = await pool.query('SELECT 1 as healthy');
    res.json({
      status: 'OPERATIONAL',
      service: 'SecurityOps 2.0 Backend (Node.js/TypeScript)',
      version: '2.0.0',
      database: dbRes.rows[0].healthy ? 'PostgreSQL 16+ Connected (RLS Active)' : 'DB Unhealthy',
      timestamp: new Date().toISOString()
    });
  } catch (err: any) {
    res.status(500).json({ status: 'DOWN', database: 'Disconnected', error: err.message });
  }
});

// Authentifizierungsrouten
app.post('/api/v1/auth/login', authController.login);
app.post('/api/v1/auth/logout', authenticateJwt, authController.logout);
app.get('/api/v1/auth/me', authenticateJwt, authController.getMe);

// Fachrouten (Alle mit RLS und granularer Berechtigungsprüfung geschützt)
app.get('/api/v1/customers', authenticateJwt, requirePermission('customers:read'), clientController.listClients);
app.post('/api/v1/customers', authenticateJwt, requirePermission('customers:create'), clientController.createClient);

app.get('/api/v1/logbook', authenticateJwt, requirePermission('logbook:read'), guardbookController.listGuardbook);
app.post('/api/v1/logbook', authenticateJwt, requirePermission('logbook:create'), guardbookController.createGuardbookEntry);
app.post('/api/v1/logbook/revisions', authenticateJwt, requirePermission('logbook:create'), guardbookController.addGuardbookRevision);

// 1. Echter Backend-Endpunkt für Offline-Synchronisation (Phase 6 Wiederherstellung)
app.post('/api/v1/sync/push', authenticateJwt, requirePermission('logbook:create'), syncController.pushSyncMutations);

app.use(errorHandler);
