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
import * as resourceController from './controllers/resourceController';

export const app = express();

app.use(helmet());

// CORS Whitelist-Prüfung ohne Wildcard
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
  // Muss alle tatsächlich registrierten API-Methoden enthalten.
  // PUT wird nirgends verwendet und deshalb bewusst nicht freigegeben.
  methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
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

app.get('/api/v1/sites', authenticateJwt, requirePermission('sites:read'), resourceController.listSites);
app.post('/api/v1/sites', authenticateJwt, requirePermission('sites:create'), resourceController.createSite);
app.patch('/api/v1/sites/:id', authenticateJwt, requirePermission('sites:create'), resourceController.updateSite);

app.get('/api/v1/shifts', authenticateJwt, requirePermission('shifts:read'), resourceController.listShifts);
app.post('/api/v1/shifts', authenticateJwt, requirePermission('shifts:manage'), resourceController.createShift);
app.patch('/api/v1/shifts/:id', authenticateJwt, requirePermission('shifts:manage'), resourceController.updateShift);
app.delete('/api/v1/shifts/:id', authenticateJwt, requirePermission('shifts:manage'), resourceController.deleteShift);

app.get('/api/v1/keys', authenticateJwt, requirePermission('keys:read'), resourceController.listKeys);
app.post('/api/v1/keys', authenticateJwt, requirePermission('keys:manage'), resourceController.createKey);
app.patch('/api/v1/keys/:id', authenticateJwt, requirePermission('keys:manage'), resourceController.updateKey);
app.delete('/api/v1/keys/:id', authenticateJwt, requirePermission('keys:manage'), resourceController.deleteKey);

app.get('/api/v1/tasks', authenticateJwt, requirePermission('tasks:read'), resourceController.listTasks);
app.post('/api/v1/tasks', authenticateJwt, requirePermission('tasks:manage'), resourceController.createTask);
app.patch('/api/v1/tasks/:id', authenticateJwt, requirePermission('tasks:manage'), resourceController.updateTask);
app.delete('/api/v1/tasks/:id', authenticateJwt, requirePermission('tasks:manage'), resourceController.deleteTask);

app.get('/api/v1/employees', authenticateJwt, requirePermission('employees:read'), resourceController.listEmployees);
app.post('/api/v1/employees', authenticateJwt, requirePermission('employees:manage'), resourceController.createEmployee);
app.patch('/api/v1/employees/:id', authenticateJwt, requirePermission('employees:manage'), resourceController.updateEmployee);

app.get('/api/v1/logbook', authenticateJwt, requirePermission('logbook:read'), guardbookController.listGuardbook);
app.post('/api/v1/logbook', authenticateJwt, requirePermission('logbook:create'), guardbookController.createGuardbookEntry);
app.post('/api/v1/logbook/revisions', authenticateJwt, requirePermission('logbook:create'), guardbookController.addGuardbookRevision);

// Offline-Synchronisations-Endpunkte
app.post('/api/v1/sync/push', authenticateJwt, requirePermission('logbook:create'), syncController.pushSyncMutations);
app.post('/api/v1/sync/conflicts/resolve', authenticateJwt, requirePermission('logbook:create'), syncController.resolveSyncConflict);

app.use(errorHandler);
