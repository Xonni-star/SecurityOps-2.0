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
  status?: 'GÜLTIG' | 'ABGELAUFEN' | 'AUSSTEHEND';
  documentReference?: string;
  revisionVersion?: number;
}

export interface AbsenceRecord {
  id: string;
  type: 'Urlaub' | 'Krankheit' | 'Fortbildung' | 'Sonderurlaub';
  startDate: string;
  endDate: string;
  approved: boolean;
  replacementEmployeeId?: string;
  status?: 'PENDING' | 'APPROVED' | 'REJECTED';
  revisionVersion?: number;
  notes?: string;
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
  revisionVersion?: number;
  archivedAt?: string | null;
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
  customerId?: string;
  description?: string;
  effectiveFrom?: string;
  effectiveUntil?: string;
  dmsDocumentId?: string;
  assignmentId?: string;
  status?: 'draft' | 'in_review' | 'reviewed' | 'approved' | 'published' | 'withdrawn' | 'archived' | string;
  version: string;
  effectiveDate: string;
  author: string;
  dueAt?: string;
  signedCount?: number;
  totalRequired?: number;
  content: string;
  mandatoryAcknowledgment: boolean;
  unacknowledgedEmployeeNames?: string[];
  currentUserAcknowledgment?: 'confirmed' | 'pending' | 'stale' | 'unacknowledged';
  versionId?: string;
  acknowledgedAt?: string;
  assignments?: SOPAssignment[];
}

export interface SOPAssignment {
  id: string;
  type: 'employee' | 'site' | 'customer' | 'tenant';
  targetId?: string;
  targetName?: string;
  status?: string;
  dueAt?: string;
  acknowledgedAt?: string;
  employeeId?: string;
  employeeName?: string;
}

export interface SOPVersion {
  id: string;
  version: string | number;
  title?: string;
  content?: string;
  changeReason: string;
  createdAt: string;
  createdBy?: string;
}

export interface SOPPendingAcknowledgement {
  tenantId: string;
  userId: string;
  sopId: string;
  assignmentId: string;
  clientMutationId: string;
  capturedAt: string;
  versionId: string;
  version: string;
  status?: 'pending' | 'stale';
}

export interface EmergencyPlan {
  id: string;
  tenantId: string;
  customerId?: string;
  customerName?: string;
  siteId: string;
  siteName: string;
  alarmTypeId?: string;
  alarmTypeLabel?: string;
  scenario: string;
  ownerEmployeeId?: string | null;
  effectiveFrom?: string | null;
  effectiveUntil?: string | null;
  publicationStatus?: 'draft' | 'published' | 'archived';
  currentVersionId?: string | null;
  publishedVersionId?: string | null;
  versionNumber?: number;
  chainOfAction: string[];
  contacts: {
    id?: string;
    contactType?: string;
    role: string;
    name: string;
    phone: string;
    email?: string | null;
    notes?: string;
  }[];
  lastDrillDate: string | null;
  isActive: boolean;
  revisionVersion: number;
  archivedAt?: string | null;
  offlineCopy?: boolean;
}

export interface AlarmType {
  id: string;
  tenantId: string;
  code: string;
  label: string;
  isSystem: boolean;
  isActive: boolean;
}

export interface AlarmSite {
  id: string;
  customerId: string;
  name: string;
}

export type AlarmIncidentStatus =
  | 'neu'
  | 'bestätigt'
  | 'in_bearbeitung'
  | 'eskaliert'
  | 'einsatzkraefte_verstaendigt'
  | 'massnahmen_eingeleitet'
  | 'entwarnung'
  | 'abgeschlossen'
  | 'archiviert';

export interface AlarmIncident {
  id: string;
  tenantId: string;
  incidentNumber?: number;
  customerId?: string;
  customerName?: string;
  siteId: string;
  siteName: string;
  emergencyPlanId?: string | null;
  emergencyPlanVersionId?: string | null;
  alarmTypeId?: string;
  alarmTypeLabel?: string;
  scenario: string;
  severity: 'Niedrig' | 'Normal' | 'Dringend' | 'Kritisch';
  status: AlarmIncidentStatus;
  title: string;
  description: string;
  reportedAt: string;
  capturedAt?: string;
  serverReceivedAt?: string;
  acknowledgedAt?: string | null;
  escalatedAt?: string | null;
  resolvedAt?: string | null;
  reporterName?: string;
  assignedEmployeeId?: string | null;
  assignedEmployeeName?: string;
  isOverdue?: boolean;
  syncStatus?: 'pending' | 'confirmed' | 'conflict';
  clientMutationId?: string;
  resolutionNote?: string | null;
  revisionVersion: number;
}

export interface AlarmMutation {
  clientMutationId: string;
  tenantId: string;
  userId: string;
  type: 'incident_report' | 'action_create' | 'status_change';
  payload: Record<string, unknown>;
  capturedAt: string;
  status: 'pending' | 'confirmed' | 'conflict';
  serverId?: string;
  errorMessage?: string;
  updatedAt: string;
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
  categoryId: string;
  category: string;
  sizeBytes: number;
  uploadedAt: string;
  version: string;
  status: string;
  scanStatus: 'clean' | 'infected' | 'not_scanned';
  contentType: string;
  folderId?: string;
  folderName?: string;
  description: string;
  documentNumber?: string;
  validFrom?: string;
  validUntil?: string;
  tags: Array<{ id: string; name: string }>;
  linkedEntityType: 'customer' | 'site' | 'employee' | 'shift' | 'incident' | 'general';
  linkedEntityId?: string;
  linkedEntityName?: string;
  archivedAt?: string;
}

export type SyncStatus = 'synced' | 'pending' | 'conflict' | 'failed';

export interface OfflineQueueItem {
  id: string;
  tenantId: string;
  entityType: 'guardbook' | 'shift' | 'task' | 'key' | 'employee' | 'document' | 'patrol' | 'handover' | 'site' | 'client';
  action: 'CREATE' | 'UPDATE' | 'DELETE' | 'RESTORE' | 'QUALIFICATION_CREATE' | 'QUALIFICATION_UPDATE' | 'ABSENCE_CREATE' | 'ABSENCE_REVIEW';
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
  verifiedTag?: string;
  checkpointToken?: string;
  checkpointTokenVersion?: number;
  roundId?: string;
  latitude?: number | null;
  longitude?: number | null;
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
  entityType: 'task' | 'shift' | 'key' | 'guardbook' | 'patrol';
  strategy: 'USE_LOCAL' | 'USE_SERVER' | 'RECORD_AS_EXCEPTION';
  expectedVersion: number;
  localPayload?: Record<string, any>;
}

export interface ConflictResolutionResult {
  applied: boolean;
  clientUuid: string;
  entityType: string;
  strategy: 'USE_LOCAL' | 'USE_SERVER' | 'RECORD_AS_EXCEPTION';
  serverState: any;
}
