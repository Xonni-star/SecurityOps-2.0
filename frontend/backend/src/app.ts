import express from 'express';
import crypto from 'crypto';
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
import * as employeeController from './controllers/employeeController';
import * as documentController from './controllers/documentController';
import * as sopController from './controllers/sopController';
import * as handoverController from './controllers/handoverController';
import * as alarmWorkflowController from './controllers/alarmWorkflowController';
import * as patrolController from './controllers/patrolController';

export const app = express();

app.use(helmet());

app.use((req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const cookies = Object.fromEntries((req.headers.cookie || '').split(';').map(v => v.trim().split('=', 2)).filter(v => v.length === 2));
  const origin = req.get('origin');
  if (req.path === '/api/v1/auth/login') {
    if (!origin || !env.ALLOWED_CORS_ORIGINS.includes(origin)) { res.status(403).json({ success: false, message: 'Origin nicht zugelassen.' }); return; }
    return next();
  }
  // Unauthenticated requests proceed to auth middleware (401); browser sessions
  // must pass Origin and CSRF validation before reaching any mutation handler.
  if (!cookies.secops_session) return next();
  if (!origin || !env.ALLOWED_CORS_ORIGINS.includes(origin)) { res.status(403).json({ success: false, message: 'Origin nicht zugelassen.' }); return; }
  const cookieToken = cookies.secops_csrf; const headerToken = req.get('x-csrf-token');
  if (!cookieToken || !headerToken || cookieToken.length !== headerToken.length || !crypto.timingSafeEqual(Buffer.from(cookieToken), Buffer.from(headerToken))) { res.status(403).json({ success: false, message: 'CSRF-Prüfung fehlgeschlagen.' }); return; }
  next();
});

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
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-CSRF-Token', 'X-File-Name']
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
  } catch {
    // Health endpoints are public; never expose driver or connection details.
    console.error('[HEALTH CHECK] Database readiness query failed');
    res.status(500).json({ status: 'DOWN', database: 'Disconnected', timestamp: new Date().toISOString() });
  }
});

// Authentifizierungsrouten
app.post('/api/v1/auth/login', authController.login);
app.post('/api/v1/auth/logout', authenticateJwt, authController.logout);
app.get('/api/v1/auth/me', authenticateJwt, authController.getMe);

// Fachrouten (Alle mit RLS und granularer Berechtigungsprüfung geschützt)
app.get('/api/v1/customers', authenticateJwt, requirePermission('customers:read'), clientController.listClients);
app.post('/api/v1/customers', authenticateJwt, requirePermission('customers:create'), clientController.createClient);
app.patch('/api/v1/customers/:id', authenticateJwt, requirePermission('customers:update'), clientController.updateClient);
app.post('/api/v1/customers/:id/archive', authenticateJwt, requirePermission('customers:archive'), clientController.archiveClient);
app.post('/api/v1/customers/sync', authenticateJwt, clientController.syncClientMutations);

app.get('/api/v1/sites', authenticateJwt, requirePermission('sites:read'), resourceController.listSites);
app.post('/api/v1/sites', authenticateJwt, requirePermission('sites:create'), resourceController.createSite);
app.patch('/api/v1/sites/:id', authenticateJwt, requirePermission('sites:update'), resourceController.updateSite);
app.post('/api/v1/sites/:id/archive', authenticateJwt, requirePermission('sites:archive'), resourceController.archiveSite);
app.post('/api/v1/sites/:id/restore', authenticateJwt, requirePermission('sites:restore'), resourceController.restoreSite);
app.post('/api/v1/sites/sync', authenticateJwt, resourceController.syncSiteMutations);

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

app.get('/api/v1/employees', authenticateJwt, requirePermission('employees:read'), employeeController.listEmployees);
app.post('/api/v1/employees', authenticateJwt, requirePermission('employees:create'), employeeController.createEmployee);
app.patch('/api/v1/employees/:id', authenticateJwt, requirePermission('employees:update'), employeeController.updateEmployee);
app.patch('/api/v1/employees/:id/account', authenticateJwt, requirePermission('employees:account:link'), employeeController.linkEmployeeAccount);
app.post('/api/v1/employees/:id/archive', authenticateJwt, requirePermission('employees:archive'), employeeController.archiveEmployee);
app.post('/api/v1/employees/:id/restore', authenticateJwt, requirePermission('employees:restore'), employeeController.restoreEmployee);
app.post('/api/v1/employees/:id/qualifications', authenticateJwt, requirePermission('qualifications:manage'), employeeController.createQualification);
app.patch('/api/v1/employees/:id/qualifications/:qualificationId', authenticateJwt, requirePermission('qualifications:manage'), employeeController.updateQualification);
app.post('/api/v1/employees/:id/absences', authenticateJwt, requirePermission('employees:absence:manage'), employeeController.createAbsence);
app.post('/api/v1/employees/:id/absences/:absenceId/review', authenticateJwt, requirePermission('employees:absence:approve'), employeeController.reviewAbsence);
app.post('/api/v1/employees/sync', authenticateJwt, employeeController.syncEmployeeMutations);

// DMS metadata and file operations are always tenant-scoped and permission-gated.
app.get('/api/v1/documents', authenticateJwt, requirePermission('documents:read'), documentController.listDocuments);
app.post('/api/v1/documents', authenticateJwt, requirePermission('documents:create'),
  express.raw({ type: 'application/octet-stream', limit: documentController.documentUploadBodyParserLimit() }),
  documentController.uploadDocument);
app.get('/api/v1/documents/categories', authenticateJwt, requirePermission('documents:read'), documentController.listDocumentCategories);
app.post('/api/v1/documents/categories', authenticateJwt, requirePermission('documents:manage'), documentController.createDocumentCategory);
app.patch('/api/v1/documents/categories/:id', authenticateJwt, requirePermission('documents:manage'), documentController.updateDocumentCategory);
app.get('/api/v1/documents/folders', authenticateJwt, requirePermission('documents:read'), documentController.listDocumentFolders);
app.post('/api/v1/documents/folders', authenticateJwt, requirePermission('documents:create'), documentController.createDocumentFolder);
app.patch('/api/v1/documents/folders/:id', authenticateJwt, requirePermission('documents:update'), documentController.updateDocumentFolder);
app.post('/api/v1/documents/folders/:id/archive', authenticateJwt, requirePermission('documents:archive'), documentController.archiveDocumentFolder);
app.get('/api/v1/documents/tags', authenticateJwt, requirePermission('documents:read'), documentController.listDocumentTags);
app.get('/api/v1/documents/:id', authenticateJwt, requirePermission('documents:read'), documentController.getDocument);
app.get('/api/v1/documents/:id/versions', authenticateJwt, requirePermission('documents:read'), documentController.listDocumentVersions);
app.post('/api/v1/documents/:id/versions', authenticateJwt, requirePermission('documents:update'),
  express.raw({ type: 'application/octet-stream', limit: documentController.documentUploadBodyParserLimit() }),
  documentController.createDocumentVersion);
app.post('/api/v1/documents/:id/versions/:version/restore', authenticateJwt, requirePermission('documents:update'), documentController.restoreDocumentVersion);
app.get('/api/v1/documents/:id/download', authenticateJwt, requirePermission('documents:download'), documentController.downloadDocument);
app.patch('/api/v1/documents/:id/relationship', authenticateJwt, requirePermission('documents:update'), documentController.updateDocumentRelationship);
app.post('/api/v1/documents/:id/move', authenticateJwt, requirePermission('documents:update'), documentController.moveDocument);
app.get('/api/v1/documents/:id/audit', authenticateJwt, requirePermission('documents:read'), documentController.listDocumentAudit);
app.patch('/api/v1/documents/:id', authenticateJwt, requirePermission('documents:update'), documentController.updateDocument);
app.post('/api/v1/documents/:id/archive', authenticateJwt, requirePermission('documents:archive'), documentController.archiveDocument);
app.post('/api/v1/documents/:id/restore', authenticateJwt, requirePermission('documents:restore'), documentController.restoreDocument);

// SOP / Dienstanweisungen
app.get('/api/v1/sops', authenticateJwt, requirePermission('sop:read'), sopController.listSops);
app.post('/api/v1/sops', authenticateJwt, requirePermission('sop:create'), sopController.createSop);
app.get('/api/v1/sops/reports', authenticateJwt, requirePermission('sop:manage'), sopController.listSopReports);
app.get('/api/v1/sops/reminders', authenticateJwt, requirePermission('sop:read'), sopController.listSopReminders);
app.post('/api/v1/sops/assignments/:assignmentId/acknowledge', authenticateJwt, requirePermission('sop:acknowledge'), sopController.acknowledgeAssignment);
app.patch('/api/v1/sops/:id', authenticateJwt, requirePermission('sop:update'), sopController.updateSop);
app.get('/api/v1/sops/:id/versions', authenticateJwt, requirePermission('sop:read'), sopController.listVersions);
app.post('/api/v1/sops/:id/versions', authenticateJwt, requirePermission('sop:update'), sopController.createVersion);
app.post('/api/v1/sops/:id/submit', authenticateJwt, requirePermission('sop:submit'), sopController.submitSop);
app.post('/api/v1/sops/:id/review', authenticateJwt, requirePermission('sop:review'), sopController.reviewSop);
app.post('/api/v1/sops/:id/approve', authenticateJwt, requirePermission('sop:approve'), sopController.approveSop);
app.post('/api/v1/sops/:id/publish', authenticateJwt, requirePermission('sop:publish'), sopController.publishSop);
app.post('/api/v1/sops/:id/withdraw', authenticateJwt, requirePermission('sop:publish'), sopController.withdrawSop);
app.post('/api/v1/sops/:id/archive', authenticateJwt, requirePermission('sop:archive'), sopController.archiveSop);
app.get('/api/v1/sops/:id/assignments', authenticateJwt, requirePermission('sop:read'), sopController.listAssignments);
app.post('/api/v1/sops/:id/assignments', authenticateJwt, requirePermission('sop:assign'), sopController.assignSop);

// Handovers and carried-forward tasks
app.get('/api/v1/handovers/dashboard', authenticateJwt, requirePermission('handovers:read'), handoverController.getHandoverDashboard);
app.get('/api/v1/handovers', authenticateJwt, requirePermission('handovers:read'), handoverController.listHandovers);
app.post('/api/v1/handovers', authenticateJwt, requirePermission('handovers:create'), handoverController.createHandoverEndpoint);
app.post('/api/v1/handovers/sync', authenticateJwt, syncController.pushHandoverMutations);
app.get('/api/v1/handovers/:id', authenticateJwt, requirePermission('handovers:read'), handoverController.getHandover);
app.patch('/api/v1/handovers/:id', authenticateJwt, requirePermission('handovers:update'), handoverController.updateHandover);
app.post('/api/v1/handovers/:id/confirm', authenticateJwt, requirePermission('handovers:confirm'), handoverController.confirmHandover);
app.post('/api/v1/handovers/:id/acknowledge', authenticateJwt, requirePermission('handovers:confirm'), handoverController.acknowledgeHandover);
app.post('/api/v1/handovers/:id/questions', authenticateJwt, requirePermission('handovers:confirm'), handoverController.addHandoverQuestion);
app.post('/api/v1/handovers/:id/corrections', authenticateJwt, requirePermission('handovers:manage'), handoverController.addHandoverCorrection);
app.get('/api/v1/handovers/:id/events', authenticateJwt, requirePermission('handovers:read'), handoverController.listHandoverEvents);
app.get('/api/v1/handovers/:id/tasks', authenticateJwt, requirePermission('handovers:read'), handoverController.listHandoverTasks);
app.post('/api/v1/handovers/:id/tasks', authenticateJwt, requirePermission('handovers:tasks'), handoverController.createHandoverTaskEndpoint);
app.patch('/api/v1/handover-tasks/:id', authenticateJwt, requirePermission('handovers:tasks'), handoverController.updateHandoverTaskEndpoint);
app.get('/api/v1/handovers/:id/documents', authenticateJwt, requirePermission('handovers:read'), requirePermission('documents:read'), handoverController.listHandoverDocuments);
app.post('/api/v1/handovers/:id/documents', authenticateJwt, requirePermission('handovers:manage'), requirePermission('documents:read'), handoverController.linkHandoverDocument);

// Alarm- und Notfallmanagement
app.get('/api/v1/alarm-types', authenticateJwt, requirePermission('alarm:read'), alarmWorkflowController.listAlarmTypes);
app.get('/api/v1/alarm-sites', authenticateJwt, requirePermission('alarm:read'), alarmWorkflowController.listAlarmSites);
app.post('/api/v1/alarm-types', authenticateJwt, requirePermission('alarm:type:manage'), alarmWorkflowController.createAlarmType);
app.patch('/api/v1/alarm-types/:id', authenticateJwt, requirePermission('alarm:type:manage'), alarmWorkflowController.updateAlarmType);
app.get('/api/v1/emergency-contacts', authenticateJwt, requirePermission('emergency_contact:read'), alarmWorkflowController.listEmergencyContacts);
app.post('/api/v1/emergency-contacts', authenticateJwt, requirePermission('emergency_contact:manage'), alarmWorkflowController.createEmergencyContact);
app.patch('/api/v1/emergency-contacts/:id', authenticateJwt, requirePermission('emergency_contact:manage'), alarmWorkflowController.updateEmergencyContact);
app.post('/api/v1/emergency-contacts/:id/archive', authenticateJwt, requirePermission('emergency_contact:manage'), alarmWorkflowController.archiveEmergencyContact);
app.get('/api/v1/emergency-plans', authenticateJwt, requirePermission('alarm:read'), alarmWorkflowController.listEmergencyPlansV2);
app.post('/api/v1/emergency-plans', authenticateJwt, requirePermission('alarm:manage'), alarmWorkflowController.createEmergencyPlanV2);
app.patch('/api/v1/emergency-plans/:id', authenticateJwt, requirePermission('alarm:manage'), alarmWorkflowController.updateEmergencyPlanV2);
app.post('/api/v1/emergency-plans/:id/publish', authenticateJwt, requirePermission('emergency_plan:publish'), alarmWorkflowController.publishEmergencyPlan);
app.get('/api/v1/emergency-plans/:id/versions', authenticateJwt, requirePermission('alarm:read'), alarmWorkflowController.listEmergencyPlanVersions);
app.post('/api/v1/emergency-plans/:id/archive', authenticateJwt, requirePermission('alarm:manage'), alarmWorkflowController.archiveEmergencyPlanV2);
app.post('/api/v1/emergency-plans/:id/drills', authenticateJwt, requirePermission('alarm:manage'), alarmWorkflowController.recordEmergencyDrillV2);
app.get('/api/v1/emergency-plans/:id/events', authenticateJwt, requirePermission('alarm:read'), alarmWorkflowController.listEmergencyPlanEventsV2);
app.get('/api/v1/alarms', authenticateJwt, requirePermission('alarm:read'), alarmWorkflowController.listAlarmIncidentsV2);
app.post('/api/v1/alarms', authenticateJwt, requirePermission('alarm:report'), alarmWorkflowController.reportAlarmIncidentV2);
app.post('/api/v1/alarms/sync', authenticateJwt, alarmWorkflowController.syncAlarmMutations);

// Patrol operations: tenant RLS is applied by each controller transaction.
app.get('/api/v1/patrol/dashboard', authenticateJwt, requirePermission('patrol:read'), patrolController.getDashboard);
app.get('/api/v1/patrol/checkpoints', authenticateJwt, requirePermission('patrol:read'), patrolController.listCheckpoints);
app.post('/api/v1/patrol/checkpoints', authenticateJwt, requirePermission('patrol:manage'), patrolController.createCheckpoint);
app.post('/api/v1/patrol/checkpoints/:id/rotate-token', authenticateJwt, requirePermission('patrol:manage'), patrolController.rotateCheckpointToken);
app.post('/api/v1/patrol/checkpoints/:id/archive', authenticateJwt, requirePermission('patrol:manage'), patrolController.archiveCheckpoint);
app.get('/api/v1/patrol/routes', authenticateJwt, requirePermission('patrol:read'), patrolController.listRoutes);
app.post('/api/v1/patrol/routes', authenticateJwt, requirePermission('patrol:manage'), patrolController.createRoute);
app.post('/api/v1/patrol/routes/:id/versions', authenticateJwt, requirePermission('patrol:manage'), patrolController.createRouteVersion);
app.get('/api/v1/patrol/rounds', authenticateJwt, requirePermission('patrol:read'), patrolController.listRounds);
app.get('/api/v1/patrol/scans', authenticateJwt, requirePermission('patrol:read'), patrolController.listScans);
app.get('/api/v1/patrol/exceptions', authenticateJwt, requirePermission('patrol:read'), patrolController.listExceptions);
app.post('/api/v1/patrol/exceptions', authenticateJwt, requirePermission('patrol:exception:create'), patrolController.createException);
app.post('/api/v1/patrol/rounds', authenticateJwt, requirePermission('patrol:create'), patrolController.startRound);
app.post('/api/v1/patrol/rounds/:id/complete', authenticateJwt, requirePermission('patrol:create'), patrolController.completeRound);
app.get('/api/v1/patrol/events', authenticateJwt, requirePermission('patrol:audit'), patrolController.listEvents);
app.post('/api/v1/patrol/sync', authenticateJwt, syncController.pushPatrolMutations);
app.get('/api/v1/alarms/recent-events', authenticateJwt, requirePermission('alarm:read'), alarmWorkflowController.listRecentAlarmEvents);
app.get('/api/v1/alarms/:id/events', authenticateJwt, requirePermission('alarm:read'), alarmWorkflowController.listAlarmEventsV2);
app.get('/api/v1/alarms/:id/actions', authenticateJwt, requirePermission('alarm:read'), alarmWorkflowController.listAlarmActions);
app.post('/api/v1/alarms/:id/actions', authenticateJwt, requirePermission('alarm:action:create'), alarmWorkflowController.createAlarmAction);
app.get('/api/v1/alarms/:id/status-history', authenticateJwt, requirePermission('alarm:read'), alarmWorkflowController.listAlarmStatusHistory);
app.get('/api/v1/alarms/:id/assignments', authenticateJwt, requirePermission('alarm:read'), alarmWorkflowController.listAlarmAssignments);
app.post('/api/v1/alarms/:id/assignments', authenticateJwt, requirePermission('alarm:assign'), alarmWorkflowController.assignAlarmResponder);
app.post('/api/v1/alarms/:id/transitions', authenticateJwt, requirePermission('alarm:respond'), alarmWorkflowController.transitionAlarmIncidentV2);
app.get('/api/v1/alarm-escalation-rules', authenticateJwt, requirePermission('alarm:escalation:manage'), alarmWorkflowController.listEscalationRules);
app.post('/api/v1/alarm-escalation-rules', authenticateJwt, requirePermission('alarm:escalation:manage'), alarmWorkflowController.createEscalationRule);
app.post('/api/v1/alarm-escalation-rules/:id/revisions', authenticateJwt, requirePermission('alarm:escalation:manage'), alarmWorkflowController.reviseEscalationRule);
app.get('/api/v1/alarm-notifications', authenticateJwt, requirePermission('alarm:notifications:read'), alarmWorkflowController.listAlarmNotifications);
app.get('/api/v1/alarm-escalation-status', authenticateJwt, requirePermission('alarm:notifications:read'), alarmWorkflowController.listAlarmEscalationStatus);
app.post('/api/v1/alarm-notifications/:id/retry', authenticateJwt, requirePermission('alarm:escalation:manage'), alarmWorkflowController.retryAlarmNotification);

app.get('/api/v1/logbook', authenticateJwt, requirePermission('logbook:read'), guardbookController.listGuardbook);
app.post('/api/v1/logbook', authenticateJwt, requirePermission('logbook:create'), guardbookController.createGuardbookEntry);
app.post('/api/v1/logbook/revisions', authenticateJwt, requirePermission('logbook:create'), guardbookController.addGuardbookRevision);

// Offline-Synchronisations-Endpunkte
app.post('/api/v1/sync/push', authenticateJwt, syncController.pushSyncMutations);
app.post('/api/v1/sync/conflicts/resolve', authenticateJwt, syncController.resolveSyncConflict);

app.use(errorHandler);
