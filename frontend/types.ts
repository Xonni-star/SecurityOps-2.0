export enum UserRole {
  ADMIN = 'Systemadministrator',
  GF = 'Geschäftsführung',
  EINSATZLEITUNG = 'Einsatzleitung',
  OBJEKTLEITUNG = 'Objektleitung',
  HR = 'Personalverwaltung',
  QM = 'Qualitätsmanagement',
  GUARD = 'Wachdienstmitarbeiter',
  AUDITOR = 'Lesender Zugriff / Auditor'
}

export enum QualificationType {
  GEWO_34A_UNTERRICHTUNG = 'Unterrichtung § 34a GewO',
  GEWO_34A_SACHKUNDE = 'Sachkundeprüfung § 34a GewO',
  FIRST_AID = 'Betrieblicher Ersthelfer (DGUV)',
  FIRE_SAFETY = 'Brandschutz- & Evakuierungshelfer',
  WEAPON_PERMIT = 'Waffensachkunde (§ 7 WaffG)',
  DOG_HANDLER = 'Diensthundeführer (DGUV V23)',
  DEESCALATION = 'Deeskalationstraining'
}

export interface Tenant {
  id: string;
  name: string;
  subdomain: string;
  taxNumber: string;
  licenseTier: 'Enterprise (Unbegrenzt)' | 'Professional (Bis 50 MA)' | 'Standard (Bis 15 MA)';
  din77200Certified: boolean;
  bwrRegisterId: string;
  active: boolean;
  contactEmail: string;
}

export interface Qualification {
  id: string;
  type: QualificationType;
  issueDate: string;
  expiryDate: string;
  certificateNumber: string;
  verified: boolean;
}

export interface AbsenceRecord {
  id: string;
  type: 'Urlaub' | 'Krankheit' | 'Fortbildung' | 'Sonderurlaub';
  startDate: string;
  endDate: string;
  approved: boolean;
  replacementEmployeeId?: string;
}

export interface Employee {
  id: string;
  tenantId: string;
  personnelNumber: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  role: UserRole;
  status: 'Aktiv' | 'Urlaub' | 'Krank' | 'Freigestellt';
  weeklyHours: number;
  qualifications: Qualification[];
  absences?: AbsenceRecord[];
  assignedSiteIds: string[];
  hourlyRate: number;
  dateOfJoining: string;
  notes?: string;
  synced?: boolean;
}

export interface ClientAddress {
  id: string;
  type: 'Hauptsitz' | 'Rechnungsadresse' | 'Zweigstelle';
  street: string;
  city: string;
  postalCode: string;
  country: string;
}

export interface Client {
  id: string;
  tenantId: string;
  clientNumber: string;
  companyName: string;
  contactPerson: string;
  email: string;
  phone: string;
  address: string;
  addresses?: ClientAddress[];
  contractStart: string;
  contractEnd: string;
  contractAutoRenew: boolean;
  noticePeriodMonths: number;
  slaLevel: 'Gold (24/7 Vor-Ort)' | 'Silber (Revierdienst)' | 'Bronze (Alarmverfolgung)';
  billingStatus: 'Regulär' | 'In Zahlungsverzug' | 'Neu';
  assignedSiteCount: number;
  revisionVersion?: number;
}

export interface Checkpoint {
  id: string;
  code: string;
  name: string;
  locationDetails: string;
  rfidTag: string;
  requiredIntervalMinutes: number;
}

export interface SiteAssessment {
  id: string;
  date: string;
  auditorName: string;
  score: number;
  notes: string;
  deficiencies: string[];
}

export interface Site {
  id: string;
  tenantId: string;
  clientId: string;
  clientName: string;
  siteCode: string;
  name: string;
  address: string;
  securityLevel: 'Niedrig' | 'Mittel' | 'Hoch (KRITIS / BSI)' | 'Höchste Sicherheitsstufe';
  siteManagerId: string;
  siteManagerName: string;
  requiredGuardsDay: number;
  requiredGuardsNight: number;
  checkpoints: Checkpoint[];
  assessments?: SiteAssessment[];
  alarmSystem: string;
  instructionsCount: number;
  accessRules: string;
  activeAlarms: number;
  revisionVersion?: number;
  archivedAt?: string | null;
}

export interface Shift {
  id: string;
  tenantId: string;
  siteId: string;
  siteName: string;
  employeeId?: string;
  employeeName?: string;
  date: string;
  startTime: string;
  endTime: string;
  type: 'Tagdienst' | 'Nachtdienst' | 'Revierdienst' | 'Sonderposten';
  status: 'Besetzt' | 'Offen' | 'Konflikt' | 'Abgeschlossen';
  requiredQualification: QualificationType;
  actualStart?: string;
  actualEnd?: string;
  conflictReason?: string;
  revisionVersion?: number;
}

export type IncidentWorkflowStage =
  | 'Erfasst'
  | 'In Bewertung'
  | 'Zugewiesen'
  | 'Maßnahme läuft'
  | 'Eskaliert'
  | 'Abgeschlossen'
  | 'Archiviert';

export interface GuardBookRevision {
  id: string;
  timestamp: string;
  authorName: string;
  note: string;
}

export interface GuardBookEntry {
  id: string;
  tenantId: string;
  timestamp: string;
  siteId: string;
  siteName: string;
  guardId: string;
  guardName: string;
  category: 'Routinemeldung' | 'Vorkommnis' | 'Polizeieinsatz' | 'Fehlalarm' | 'Schichtübergabe' | 'Kontrollgang';
  priority: 'Niedrig' | 'Normal' | 'Dringend' | 'Kritisch';
  stage: IncidentWorkflowStage;
  title: string;
  description: string;
  witnesses?: string;
  damageValue?: number;
  checkpointScanned?: string;
  policeInvolved: boolean;
  assignedManagerId?: string;
  assignedManagerName?: string;
  createdTaskId?: string;
  resolved: boolean;
  resolutionNote?: string;
  revisions?: GuardBookRevision[];
  offlineCreated?: boolean;
}

export interface SOPDocument {
  id: string;
  tenantId: string;
  sopNumber: string;
  title: string;
  category: 'Objektbezogen' | 'Allgemeine Dienstanweisung' | 'Notfall-SOP' | 'Arbeitssicherheit';
  siteId?: string;
  version: string;
  effectiveDate: string;
  author: string;
  signedCount: number;
  totalRequired: number;
  content: string;
  mandatoryAcknowledgment: boolean;
  unacknowledgedEmployeeNames?: string[];
}

export interface EmergencyPlan {
  id: string;
  tenantId: string;
  siteId: string;
  siteName: string;
  scenario: 'BMA - Brandmeldeanlage' | 'EMA - Einbruchsalarm' | 'Bombendrohung' | 'Medizinischer Notfall' | 'Hausfriedensbruch / Aggression';
  chainOfAction: string[];
  contacts: { role: string; name: string; phone: string }[];
  lastDrillDate: string;
}

export interface KeyItem {
  id: string;
  tenantId: string;
  keyNumber: string;
  label: string;
  siteId: string;
  siteName: string;
  type: 'Master-Schlüssel' | 'Transponder' | 'Buntbart' | 'Schrankenschlüssel';
  status: 'Im Tresor' | 'Ausgegeben' | 'Verlustmeldung';
  currentHolderName?: string;
  currentHolderId?: string;
  issuedAt?: string;
  expectedReturn?: string;
  isOverdue?: boolean;
  revisionVersion?: number;
}

export interface TaskItem {
  id: string;
  tenantId: string;
  title: string;
  assignedToName: string;
  siteName?: string;
  sourceModule?: 'Wachbuch' | 'Schlüssel' | 'Vertrag' | 'Qualifikation' | 'QM Audit' | 'Manuell';
  sourceEntityId?: string;
  dueDate: string;
  priority: 'Niedrig' | 'Mittel' | 'Hoch';
  status: 'Offen' | 'In Bearbeitung' | 'Erledigt';
  category: 'Audit' | 'Wartung' | 'Nachschulung' | 'Kundenanforderung' | 'Vorfallsbearbeitung';
  offlineCreated?: boolean;
  revisionVersion?: number;
}

export interface ManagedDocument {
  id: string;
  tenantId: string;
  title: string;
  fileName: string;
  category: 'Vertrag' | 'Dienstanweisung' | 'Personalakte' | 'Vorfallsbericht' | 'Auditnachweis';
  sizeBytes: number;
  uploadedAt: string;
  version: string;
  linkedEntityType: 'customer' | 'site' | 'employee' | 'incident' | 'general';
  linkedEntityId?: string;
  linkedEntityName?: string;
  url?: string;
  sha256Hash?: string;
  scannedClean?: boolean;
}

export type SyncStatus = 'synced' | 'pending' | 'conflict' | 'failed';

export interface OfflineQueueItem {
  id: string;
  tenantId: string;
  entityType: 'guardbook' | 'shift' | 'task' | 'key' | 'employee' | 'document' | 'patrol' | 'handover' | 'site' | 'client';
  action: 'CREATE' | 'UPDATE' | 'DELETE' | 'RESTORE';
  payload: any;
  createdAt: string;
  retryCount: number;
  status: SyncStatus;
  errorMessage?: string;
  baseVersion?: number;
  conflictDetails?: {
    serverVersion: number;
    clientVersion: number;
    serverPayload?: any;
    clientPayload?: any;
  };
}

export interface SecurityModuleManifest {
  id: string;
  name: string;
  description: string;
  version: string;
  category: 'CORE' | 'OPERATIONS' | 'COMPLIANCE' | 'HARDWARE' | 'ADDON';
  enabled: boolean;
  requiredPermissions: UserRole[];
  dependencies: string[];
  isCore: boolean;
}

export interface GlobalSearchResult {
  id: string;
  title: string;
  subtitle: string;
  category: 'Kunde' | 'Objekt' | 'Mitarbeiter' | 'Wachbuch' | 'Schlüssel' | 'Aufgabe' | 'Dokument';
  targetTab: string;
}

export interface AutomationRule {
  id: string;
  tenantId?: string;
  name: string;
  description: string;
  trigger: string;
  conditions: any[];
  actions: any[];
  active: boolean;
  isTemplate?: boolean;
  category: 'Personal' | 'Verträge' | 'Wachbuch' | 'Schlüssel' | 'Dienstplan' | 'QM';
  lastRun?: string;
  lastRunStatus?: 'SUCCESS' | 'FAILED' | 'SKIPPED';
  actionsTriggeredCount: number;
}

export interface AutomationExecutionLog {
  id: string;
  tenantId: string;
  ruleId: string;
  ruleName: string;
  executedAt: string;
  triggerEvent: string;
  matchedEntityId?: string;
  matchedEntityDesc?: string;
  status: 'SUCCESS' | 'FAILED' | 'SKIPPED';
  actionsExecuted: string[];
  executionDurationMs: number;
  details?: string;
}

export interface NotificationDelivery {
  id: string;
  tenantId: string;
  userId?: string;
  recipientEmail?: string;
  title: string;
  message: string;
  channel: 'IN_APP' | 'EMAIL' | 'WEB_PUSH';
  severity: 'INFO' | 'WARNUNG' | 'ALARM' | 'KRITISCH';
  status: 'CREATED' | 'SENT' | 'DELIVERED' | 'FAILED';
  createdAt: string;
  deliveredAt?: string;
  read: boolean;
  sourceModule: string;
}

export interface NotificationPreference {
  userId: string;
  emailEnabled: boolean;
  inAppEnabled: boolean;
  pushEnabled: boolean;
  qualificationWarnings: boolean;
  contractDeadlines: boolean;
  criticalIncidents: boolean;
  keyReturns: boolean;
  rosterConflicts: boolean;
}

export interface SecurityAuditEntry {
  id: string;
  timestamp: string;
  actorEmail: string;
  actorRole: string;
  actionType: 'LOGIN' | 'FAILED_LOGIN' | 'LOGOUT' | 'ROLE_CHANGE' | 'DATA_EXPORT' | 'DEVICE_REVOKE' | 'IDOR_BLOCKED' | 'INCIDENT_MOD' | 'AUTOMATION_RUN' | 'RULE_MODIFIED';
  severity: 'INFO' | 'WARNUNG' | 'ALARM' | 'KRITISCH';
  targetEntity: string;
  details: string;
  ipAddress: string;
  tenantId: string;
}

export interface UserSessionDevice {
  id: string;
  deviceName: string;
  browser: string;
  ipAddress: string;
  lastActivity: string;
  isCurrentSession: boolean;
  status: 'ACTIVE' | 'REVOKED';
  mfaVerified: boolean;
}

export interface GdprRetentionPolicy {
  id: string;
  category: string;
  statutoryBasis: string;
  retentionYears: number;
  autoPurgeEnabled: boolean;
  lastRun?: string;
}

export type ReportCategory =
  | 'GESCHAEFTSFUEHRUNG'
  | 'EINSATZLEITUNG'
  | 'OBJEKTLEITUNG'
  | 'PERSONAL'
  | 'WACHBUCH_EREIGNISSE'
  | 'QUALITAET_DIN77200'
  | 'ALARME'
  | 'AUFGABEN_AUTOMATION';

export interface ReportDefinition {
  id: string;
  tenantId: string;
  name: string;
  description: string;
  category: ReportCategory;
  requiredRole: UserRole[];
  dataSource: 'shifts' | 'guardbook' | 'employees' | 'clients' | 'sites' | 'tasks' | 'keys' | 'automations';
  selectedColumns: string[];
  filterConfig: Record<string, any>;
  groupBy?: string;
  scheduleInterval?: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'NONE';
  lastGeneratedAt?: string;
  createdAt: string;
}

export interface ControllingKPIs {
  activeClientsCount: number;
  activeSitesCount: number;
  activeEmployeesCount: number;
  totalPlannedHours: number;
  totalActualHours: number;
  planFulfillmentRate: number;
  openCriticalIncidentsCount: number;
  overdueTasksCount: number;
  expiringContractsCount: number;
  expiringQualificationsCount: number;
  activeAlarmsCount: number;
  overdueKeysCount: number;
  din77200ComplianceScore: number;
}

export interface ShiftSwapRequest {
  id: string;
  tenantId: string;
  shiftId: string;
  requestingEmployeeId: string;
  requestingEmployeeName: string;
  targetEmployeeId: string;
  targetEmployeeName: string;
  reason: string;
  status: 'ANGEFRAGT' | 'BESTAETIGT' | 'ABGELEHNT';
  requestedAt: string;
  decidedAt?: string;
  decidedByName?: string;
}

export interface PatrolScanEvent {
  id: string;
  tenantId: string;
  siteId: string;
  siteName: string;
  checkpointId: string;
  checkpointCode: string;
  checkpointName: string;
  guardId: string;
  guardName: string;
  scannedAt: string;
  method: 'QR_CODE' | 'NFC_TAG' | 'MANUELL';
  verifiedTag: string;
  photoUrl?: string;
  notes?: string;
  offlineCaptured: boolean;
}

export interface ShiftHandoverProtocol {
  id: string;
  tenantId: string;
  siteId: string;
  siteName: string;
  relievingGuardId: string;
  relievingGuardName: string;
  relievedGuardId: string;
  relievedGuardName: string;
  handoverTime: string;
  keyRegisterChecked: boolean;
  openIncidentsCount: number;
  remarks: string;
  acknowledgedByRelievingGuard: boolean;
  offlineCaptured: boolean;
}

export interface ResponseEnvelope<T = any> {
  success: boolean;
  message: string;
  data?: T;
  errors?: string[];
}

export interface ConflictResolutionPayload {
  clientUuid: string;
  entityType: 'task' | 'shift' | 'key' | 'guardbook';
  strategy: 'USE_LOCAL' | 'USE_SERVER';
  expectedVersion: number;
  localPayload?: Record<string, any>;
}

export interface ConflictResolutionResult {
  applied: boolean;
  clientUuid: string;
  entityType: string;
  strategy: 'USE_LOCAL' | 'USE_SERVER';
  serverState: any;
}
