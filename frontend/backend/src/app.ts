import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { env } from './config/env';
import { pool } from './config/database';
import { errorHandler } from './middleware/errorHandler';
import { authenticateJwt, requirePermission } from './middleware/auth';
import * as authController from './controllers/authController';
import * as clientController from './controllers/clientController';
import * as guardbookController from './controllers/guardbookController';

export const app = express();

app.use(helmet());
app.use(cors({ origin: env.CORS_ORIGIN }));
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
app.get('/api/v1/auth/me', authenticateJwt, authController.getMe);

// Fachrouten (Alle mit RLS und Authentifizierung geschützt)
app.get('/api/v1/customers', authenticateJwt, requirePermission('customers:read'), clientController.listClients);
app.post('/api/v1/customers', authenticateJwt, requirePermission('customers:create'), clientController.createClient);

app.get('/api/v1/logbook', authenticateJwt, requirePermission('logbook:read'), guardbookController.listGuardbook);
app.post('/api/v1/logbook', authenticateJwt, requirePermission('logbook:create'), guardbookController.createGuardbookEntry);

app.use(errorHandler);
