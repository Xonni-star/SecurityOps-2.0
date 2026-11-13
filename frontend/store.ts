import { create } from 'zustand';
import {
  Tenant,
  Client,
  Site,
  Employee,
  Shift,
  GuardBookEntry,
  SOPDocument,
  SOPPendingAcknowledgement,
  EmergencyPlan,
  AlarmSite,
  AlarmType,
  AlarmIncident,
  AlarmMutation,
  KeyItem,
  TaskItem,
  ManagedDocument,
  PatrolScanEvent,
  ShiftHandoverProtocol,
  AutomationRule,
  AutomationExecutionLog,
  NotificationDelivery,
  NotificationPreference,
  UserRole,
  OfflineQueueItem,
  SecurityModuleManifest,
  SyncStatus,
  GlobalSearchResult,
  SecurityAuditEntry,
  UserSessionDevice,
  GdprRetentionPolicy,
  ReportDefinition,
  ControllingKPIs,
  ShiftSwapRequest,
  ConflictResolutionResult
} from './types';
import {
  initialTenants,
  initialModules,
  initialClients,
  initialSites,
  initialEmployees,
  initialShifts,
  initialGuardBookEntries,
  initialEmergencyPlans,
  initialKeys,
  initialTasks,
  initialAutomations,
  initialAutomationTemplates,
  initialExecutionLogs,
  initialNotificationDeliveries,
  initialNotificationPreferences,
  initialAuditLogs,
  initialActiveSessions,
  initialGdprPolicies
} from './mockData';
import { apiClient, ApiError } from './services/apiClient';
import { offlineVault, OutboxMutation, StoredAlarmMutation } from './services/indexedDbService';

export type ThemeMode = 'dark' | 'light';

// Mutex zur Verhinderung paralleler Synchronisationsläufe
let isSyncRunningMutex = false;
let isSOPSyncRunning = false;
let isAlarmSyncRunning = false;
let lastSOPSyncFailureNoticeAt = 0;
const SOP_SYNC_FAILURE_NOTICE_COOLDOWN_MS = 30_000;

export interface AuthUser {
  id: string;
  email: string;
  fullName: string;
  role: string;
  tenantId: string;
  tenantName: string;
  permissions: string[];
}

function mapSOPRow(row: any, tenantId: string): SOPDocument {
  const rawStatus = asString(row.status, 'published').toLowerCase();
  const myAcknowledgment = row.current_user_acknowledgment ?? row.my_acknowledgment ??
    row.acknowledgment_status ?? row.assignment?.status;
  const ackStatus = typeof myAcknowledgment === 'string' ? myAcknowledgment.toLowerCase() : myAcknowledgment;
  return {
    id: asString(row.id),
    tenantId,
    sopNumber: asString(row.sop_number ?? row.sopNumber),
    title: asString(row.title),
    category: (row.category ?? 'Allgemeine Dienstanweisung') as SOPDocument['category'],
    siteId: row.site_id ?? row.siteId ?? undefined,
    customerId: row.customer_id ?? row.customerId ?? undefined,
    description: asString(row.description),
    effectiveFrom: asString(row.effectiveFrom ?? row.effective_from ?? row.effectiveDate ?? row.effective_date),
    effectiveUntil: asString(row.effectiveUntil ?? row.effective_until),
    dmsDocumentId: row.dmsDocumentId ?? row.dms_document_id ?? undefined,
    assignmentId: row.assignment_id ?? row.assignmentId ?? row.assignment?.id ?? undefined,
    versionId: row.version_id ?? row.versionId ?? row.current_version_id ?? undefined,
    status: rawStatus,
    version: String(row.version ?? row.version_number ?? '1'),
    effectiveDate: asString(row.effectiveFrom ?? row.effective_from ?? row.effective_date ?? row.effectiveDate),
    author: asString(row.author_name ?? row.author ?? row.created_by_name),
    dueAt: row.due_at ?? row.dueAt ?? row.assignment?.due_at ?? row.assignment?.dueAt ?? undefined,
    signedCount: asNumber(row.signed_count ?? row.signedCount, 0),
    totalRequired: asNumber(row.total_required ?? row.totalRequired, 0),
    content: asString(row.content),
    mandatoryAcknowledgment: row.mandatory_acknowledgment ?? row.mandatoryAcknowledgment ?? true,
    unacknowledgedEmployeeNames: row.unacknowledged_employee_names ?? row.unacknowledgedEmployeeNames ?? [],
    currentUserAcknowledgment: ackStatus === 'confirmed' || ackStatus === 'acknowledged' ||
      ackStatus === true || row.acknowledged === true || row.is_acknowledged === true
      ? 'confirmed'
      : 'unacknowledged',
    acknowledgedAt: row.acknowledged_at ?? row.acknowledgedAt ?? undefined
  };
}

function matchesPendingSOPRevision(sop: SOPDocument | undefined, acknowledgement: SOPPendingAcknowledgement): boolean {
  return Boolean(sop && sop.assignmentId === acknowledgement.assignmentId &&
    sop.versionId === acknowledgement.versionId && sop.version === acknowledgement.version);
}

function currentSOPIdentity(state: SecurityOpsStore): { tenantId: string; userId: string } {
  return {
    tenantId: state.currentTenantId || state.authUser?.tenantId || '',
    userId: state.authUser?.id || state.currentUserId
  };
}

function createAlarmMutationId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `alarm-${Date.now()}-${Math.random().toString(36).slice(2, 14)}`;
}

function mapLocalAlarmIncident(
  mutation: StoredAlarmMutation,
  plans: EmergencyPlan[],
  sites: AlarmSite[],
  types: AlarmType[]
): AlarmIncident | null {
  if (mutation.type !== 'incident_report') return null;
  const payload = mutation.payload;
  const siteId = String(payload.siteId ?? '');
  const type = types.find(item => item.id === payload.alarmTypeId);
  const plan = plans.find(item => item.id === payload.emergencyPlanId);
  return {
    id: `local:${mutation.clientMutationId}`,
    tenantId: mutation.tenantId,
    customerId: sites.find(item => item.id === siteId)?.customerId,
    siteId,
    siteName: sites.find(item => item.id === siteId)?.name ?? 'Objekt (offline erfasst)',
    emergencyPlanId: typeof payload.emergencyPlanId === 'string' ? payload.emergencyPlanId : null,
    emergencyPlanVersionId: plan?.publishedVersionId ?? null,
    alarmTypeId: typeof payload.alarmTypeId === 'string' ? payload.alarmTypeId : undefined,
    alarmTypeLabel: type?.label,
    scenario: type?.code ?? String(payload.scenario ?? ''),
    severity: String(payload.severity ?? 'Normal') as AlarmIncident['severity'],
    status: 'neu',
    title: String(payload.title ?? ''),
    description: String(payload.description ?? ''),
    reportedAt: mutation.capturedAt,
    capturedAt: mutation.capturedAt,
    revisionVersion: 1,
    clientMutationId: mutation.clientMutationId,
    syncStatus: mutation.status === 'conflict' ? 'conflict' : mutation.status === 'confirmed' ? 'confirmed' : 'pending'
  };
}

function isCurrentSOPIdentity(tenantId: string, userId: string): boolean {
  const identity = currentSOPIdentity(useSecurityStore.getState());
  return identity.tenantId === tenantId && identity.userId === userId;
}

function legacySOPQueueKey(tenantId: string, userId: string): string {
  return `sop-acknowledgements:${tenantId}:${userId}`;
}

async function migrateLegacySOPAcknowledgements(tenantId: string, userId: string): Promise<void> {
  let stored: string | null;
  try {
    if (typeof localStorage === 'undefined') return;
    stored = localStorage.getItem(legacySOPQueueKey(tenantId, userId));
  } catch {
    return;
  }
  if (!stored) return;
  let parsed: unknown;
  try {
    parsed = JSON.parse(stored);
  } catch {
    return;
  }
  if (!Array.isArray(parsed)) return;
  let allMigrated = true;
  for (const item of parsed) {
    if (!item || typeof item.sopId !== 'string' || typeof item.assignmentId !== 'string' ||
      typeof item.clientMutationId !== 'string' || typeof item.capturedAt !== 'string' ||
      typeof item.versionId !== 'string' || typeof item.version !== 'string' ||
      (item.status !== undefined && item.status !== 'pending' && item.status !== 'stale')) {
      allMigrated = false;
      continue;
    }
    await offlineVault.enqueueSOPAcknowledgement({
      tenantId,
      userId,
      sopId: item.sopId,
      assignmentId: item.assignmentId,
      clientMutationId: item.clientMutationId,
      capturedAt: item.capturedAt,
      versionId: item.versionId,
      version: item.version,
      status: item.status === 'stale' ? 'stale' : 'pending'
    });
  }
  if (allMigrated) {
    try { localStorage.removeItem(legacySOPQueueKey(tenantId, userId)); } catch { /* IndexedDB is the durable copy. */ }
  }
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function asNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function errorText(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

function offlineQueuePreviewPayload(entityType: OfflineQueueItem['entityType'], payload: any): any {
  if (entityType !== 'patrol' || typeof payload?.checkpointToken !== 'string') return payload;
  const { checkpointToken: _checkpointToken, ...safePayload } = payload;
  return { ...safePayload, tokenStoredLocally: true };
}

function offlineOutboxToQueueItem(item: OutboxMutation): OfflineQueueItem {
  const status: SyncStatus = item.status === 'CONFLICT' ? 'conflict'
    : item.status === 'FAILED' ? 'failed'
      : item.status === 'SYNCED' ? 'synced' : 'pending';
  return {
    id: item.id,
    tenantId: item.tenantId,
    entityType: item.entityType as OfflineQueueItem['entityType'],
    action: item.action,
    payload: offlineQueuePreviewPayload(item.entityType as OfflineQueueItem['entityType'], item.payload),
    createdAt: item.occurredAt,
    retryCount: item.retryCount,
    status,
    errorMessage: item.errorMessage,
    baseVersion: item.baseVersion,
    conflictDetails: item.conflictDetails
  };
}

// PostgreSQL ist die maßgebliche Datenquelle. Die Mapper übersetzen die
// snake_case-API-Antworten in die bestehenden Frontend-Typen.
function mapClientRow(row: any, tenantId: string): Client {
  return {
    id: asString(row.id),
    tenantId,
    clientNumber: asString(row.client_number ?? row.clientNumber),
    companyName: asString(row.company_name ?? row.companyName),
    contactPerson: asString(row.contact_person ?? row.contactPerson),
    email: asString(row.email),
    phone: asString(row.phone),
    address: asString(row.address),
    contractStart: asString(row.contract_start ?? row.contractStart),
    contractEnd: asString(row.contract_end ?? row.contractEnd),
    contractAutoRenew: true,
    noticePeriodMonths: 3,
    slaLevel: (row.sla_level ?? row.slaLevel ?? 'Gold (24/7 Vor-Ort)') as unknown as Client['slaLevel'],
    billingStatus: (row.billing_status ?? row.billingStatus ?? 'Regulär') as unknown as Client['billingStatus'],
    assignedSiteCount: asNumber(row.assigned_site_count, 0),
    revisionVersion: asNumber(row.revision_version, 1)
  };
}

function mapSiteRow(row: any, tenantId: string): Site {
  return {
    id: asString(row.id),
    tenantId,
    clientId: asString(row.client_id ?? row.clientId),
    clientName: asString(row.client_name ?? row.clientName),
    siteCode: asString(row.site_code ?? row.siteCode),
    name: asString(row.name),
    address: asString(row.address),
    securityLevel: (row.security_level ?? row.securityLevel ?? 'Hoch (KRITIS / BSI)') as unknown as Site['securityLevel'],
    siteManagerId: '',
    siteManagerName: asString(row.site_manager_name, 'Nicht zugewiesen'),
    requiredGuardsDay: asNumber(row.required_guards_day, 1),
    requiredGuardsNight: asNumber(row.required_guards_night, 1),
    checkpoints: [],
    assessments: [],
    alarmSystem: asString(row.alarm_system),
    instructionsCount: 0,
    accessRules: asString(row.access_rules),
    activeAlarms: 0,
    revisionVersion: asNumber(row.revision_version ?? row.revisionVersion, 1),
    archivedAt: row.archived_at ?? row.archivedAt ?? null
  };
}

function mapEmployeeRow(row: any, tenantId: string): Employee {
  return {
    id: asString(row.id),
    tenantId,
    personnelNumber: asString(row.personnel_number ?? row.personnelNumber),
    firstName: asString(row.first_name ?? row.firstName),
    lastName: asString(row.last_name ?? row.lastName),
    email: asString(row.email),
    phone: asString(row.phone),
    role: (row.role ?? 'Wachdienstmitarbeiter') as unknown as Employee['role'],
    status: (row.status ?? 'Aktiv') as unknown as Employee['status'],
    weeklyHours: asNumber(row.weekly_hours, 40),
    qualifications: (row.qualifications || []).map((q: any) => ({ id: asString(q.id), type: asString(q.qualification_type ?? q.type) as Qualification['type'], issueDate: asString(q.issue_date ?? q.issueDate), expiryDate: asString(q.expiry_date ?? q.expiryDate), certificateNumber: asString(q.certificate_number ?? q.certificateNumber), verified: Boolean(q.verified), status: qualificationStatus(q.status), documentReference: q.document_reference ?? q.documentReference ?? undefined, revisionVersion: asNumber(q.revision_version ?? q.revisionVersion, 1) })),
    absences: (row.absences || []).map((a: any) => ({ id: asString(a.id), type: a.absence_type === 'VACATION' ? 'Urlaub' : a.absence_type === 'SICKNESS' ? 'Krankheit' : asString(a.type, 'Sonstige') as any, startDate: asString(a.date_from ?? a.startDate), endDate: asString(a.date_to ?? a.endDate), approved: a.status === 'APPROVED' || Boolean(a.approved), status: a.status ?? (a.approved ? 'APPROVED' : 'PENDING'), revisionVersion: asNumber(a.revision_version ?? a.revisionVersion, 1), notes: a.notes ?? '' })),
    assignedSiteIds: (row.assigned_site_ids ?? row.assignedSiteIds ?? []).map((id: unknown) => asString(id)),
    hourlyRate: asNumber(row.hourly_rate, 0),
    dateOfJoining: asString(row.date_of_joining ?? row.dateOfJoining),
    notes: '',
    synced: true,
    revisionVersion: asNumber(row.revision_version ?? row.revisionVersion, 1),
    archivedAt: row.archived_at ?? row.archivedAt ?? null
  };
}

function qualificationStatus(status: any): Qualification['status'] {
  if (status === 'EXPIRED' || status === 'ABGELAUFEN') return 'ABGELAUFEN';
  if (status === 'PENDING' || status === 'AUSSTEHEND') return 'AUSSTEHEND';
  return 'GÜLTIG';
}

function newMutationEntityId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16); });
}

function mapGuardBookRow(row: any, tenantId: string): GuardBookEntry {
  return {
    id: asString(row.id),
    tenantId,
    timestamp: asString(row.entry_timestamp ?? row.timestamp),
    siteId: asString(row.site_id ?? row.siteId),
    siteName: asString(row.site_name ?? row.siteName),
    guardId: asString(row.guard_id ?? row.guardId),
    guardName: asString(row.guard_name ?? row.guardName),
    category: (row.category ?? 'Routinemeldung') as unknown as GuardBookEntry['category'],
    priority: (row.priority ?? 'Normal') as unknown as GuardBookEntry['priority'],
    stage: (row.stage ?? 'Erfasst') as unknown as GuardBookEntry['stage'],
    title: asString(row.title),
    description: asString(row.description),
    policeInvolved: Boolean(row.police_involved ?? row.policeInvolved),
    resolved: Boolean(row.resolved),
    revisions: [],
    offlineCreated: false
  };
}

function mapEmergencyPlanRow(row: any, tenantId: string): EmergencyPlan {
  const steps = row.chain_of_action ?? row.action_steps ?? [];
  return {
    id: asString(row.id),
    tenantId,
    customerId: row.customer_id ?? row.customerId ?? undefined,
    customerName: row.customer_name ?? row.customerName ?? undefined,
    siteId: asString(row.site_id ?? row.siteId),
    siteName: asString(row.site_name ?? row.siteName),
    alarmTypeId: row.alarm_type_id ?? row.alarmTypeId ?? undefined,
    alarmTypeLabel: row.alarm_type_label ?? row.alarmTypeLabel ?? undefined,
    scenario: asString(row.scenario),
    ownerEmployeeId: row.owner_employee_id ?? row.ownerEmployeeId ?? null,
    effectiveFrom: row.effective_from ?? row.effectiveFrom ?? null,
    effectiveUntil: row.effective_until ?? row.effectiveUntil ?? null,
    publicationStatus: row.publication_status ?? row.publicationStatus ?? (row.is_active ? 'published' : 'draft'),
    currentVersionId: row.current_version_id ?? row.currentVersionId ?? null,
    publishedVersionId: row.published_version_id ?? row.publishedVersionId ?? null,
    versionNumber: asNumber(row.version_number ?? row.versionNumber, 1),
    chainOfAction: Array.isArray(steps) ? steps.filter((step: unknown): step is string => typeof step === 'string') : [],
    contacts: Array.isArray(row.contacts) ? row.contacts.map((contact: any) => ({
      id: contact.id,
      contactType: contact.contact_type ?? contact.contactType,
      role: asString(contact.role),
      name: asString(contact.name),
      phone: asString(contact.phone),
      email: contact.email ?? null,
      notes: contact.notes ?? ''
    })) : [],
    lastDrillDate: row.last_drill_date ?? row.lastDrillDate ?? null,
    isActive: row.is_active ?? row.isActive ?? true,
    revisionVersion: asNumber(row.revision_version ?? row.revisionVersion, 1),
    archivedAt: row.archived_at ?? row.archivedAt ?? null,
    offlineCopy: row.offlineCopy ?? false
  };
}

function mapAlarmIncidentRow(row: any, tenantId: string): AlarmIncident {
  const rawStatus = asString(row.status, 'neu');
  return {
    id: asString(row.id),
    tenantId,
    incidentNumber: asNumber(row.incident_number ?? row.incidentNumber, 0) || undefined,
    customerId: row.customer_id ?? row.customerId ?? undefined,
    customerName: row.customer_name ?? row.customerName ?? undefined,
    siteId: asString(row.site_id ?? row.siteId),
    siteName: asString(row.site_name ?? row.siteName),
    emergencyPlanId: row.emergency_plan_id ?? row.emergencyPlanId ?? null,
    emergencyPlanVersionId: row.emergency_plan_version_id ?? row.emergencyPlanVersionId ?? null,
    alarmTypeId: row.alarm_type_id ?? row.alarmTypeId ?? undefined,
    alarmTypeLabel: row.alarm_type_label ?? row.alarmTypeLabel ?? undefined,
    scenario: asString(row.scenario),
    severity: asString(row.severity, 'Normal') as AlarmIncident['severity'],
    status: (rawStatus === 'gemeldet' ? 'neu' : rawStatus) as AlarmIncident['status'],
    title: asString(row.title),
    description: asString(row.description),
    reportedAt: asString(row.reported_at ?? row.reportedAt),
    capturedAt: row.captured_at ?? row.capturedAt ?? undefined,
    serverReceivedAt: row.server_received_at ?? row.serverReceivedAt ?? undefined,
    acknowledgedAt: row.acknowledged_at ?? row.acknowledgedAt ?? null,
    escalatedAt: row.escalated_at ?? row.escalatedAt ?? null,
    resolvedAt: row.resolved_at ?? row.resolvedAt ?? null,
    reporterName: asString(row.reporter_name ?? row.reporterName),
    assignedEmployeeId: row.assigned_employee_id ?? row.assignedEmployeeId ?? null,
    assignedEmployeeName: row.assigned_employee_name ?? row.assignedEmployeeName ?? undefined,
    isOverdue: Boolean(row.is_overdue ?? row.isOverdue),
    syncStatus: row.syncStatus,
    clientMutationId: row.client_mutation_id ?? row.clientMutationId ?? undefined,
    resolutionNote: row.resolution_note ?? row.resolutionNote ?? null,
    revisionVersion: asNumber(row.revision_version ?? row.revisionVersion, 1)
  };
}


function mapShiftRow(row: any, tenantId: string): Shift {
  return {
    id: asString(row.id),
    tenantId,
    siteId: asString(row.site_id ?? row.siteId),
    siteName: asString(row.site_name ?? row.siteName),
    employeeId: row.employee_id ?? row.employeeId ?? undefined,
    employeeName: row.employee_name ?? row.employeeName ?? undefined,
    date: asString(row.shift_date ?? row.date),
    startTime: asString(row.start_time ?? row.startTime),
    endTime: asString(row.end_time ?? row.endTime),
    type: (row.type ?? 'Tagdienst') as unknown as Shift['type'],
    status: (row.status ?? 'Offen') as unknown as Shift['status'],
    requiredQualification: (row.required_qualification ?? row.requiredQualification ?? 'Unterrichtung § 34a GewO') as unknown as Shift['requiredQualification'],
    conflictReason: row.conflict_reason ?? row.conflictReason ?? undefined,
    revisionVersion: asNumber(row.revision_version, 1)
  };
}

function mapKeyRow(row: any, tenantId: string): KeyItem {
  const expectedReturn = row.expected_return ?? row.expectedReturn ?? undefined;
  const status = row.status ?? 'Im Tresor';

  return {
    id: asString(row.id),
    tenantId,
    keyNumber: asString(row.key_number ?? row.keyNumber),
    label: asString(row.label),
    siteId: asString(row.site_id ?? row.siteId),
    siteName: asString(row.site_name ?? row.siteName),
    type: (row.type ?? 'Master-Schlüssel') as unknown as KeyItem['type'],
    status: status as unknown as KeyItem['status'],
    currentHolderName: row.current_holder_name ?? row.currentHolderName ?? undefined,
    currentHolderId: row.current_holder_id ?? row.currentHolderId ?? undefined,
    issuedAt: row.issued_at ?? row.issuedAt ?? undefined,
    expectedReturn,
    isOverdue:
      status === 'Ausgegeben' && expectedReturn
        ? new Date(expectedReturn).getTime() < Date.now()
        : false,
    revisionVersion: asNumber(row.revision_version, 1)
  };
}

function mapTaskRow(row: any, tenantId: string): TaskItem {
  return {
    id: asString(row.id),
    tenantId,
    title: asString(row.title),
    assignedToName: asString(row.assigned_to_name ?? row.assignedToName),
    siteName: row.site_name ?? row.siteName ?? undefined,
    dueDate: asString(row.due_date ?? row.dueDate),
    priority: (row.priority ?? 'Mittel') as unknown as TaskItem['priority'],
    status: (row.status ?? 'Offen') as unknown as TaskItem['status'],
    category: (row.category ?? 'Audit') as unknown as TaskItem['category'],
    revisionVersion: asNumber(row.revision_version, 1)
  };
}

export function mapDmsDocumentRow(row: any, tenantId: string): ManagedDocument {
  const linkedEntityType = asString(row.linked_entity_type, 'general');
  const scanStatus = row.scan_status === 'clean' || row.scan_status === 'infected' ? row.scan_status : 'not_scanned';
  return {
    id: asString(row.id),
    tenantId,
    title: asString(row.title),
    fileName: asString(row.original_filename),
    categoryId: asString(row.category_id),
    category: asString(row.category_name),
    sizeBytes: asNumber(row.size_bytes),
    uploadedAt: asString(row.version_created_at ?? row.created_at),
    version: String(asNumber(row.current_version, 1)),
    status: asString(row.status),
    scanStatus,
    contentType: asString(row.content_type),
    folderId: row.folder_id ?? undefined,
    folderName: row.folder_name ?? undefined,
    description: asString(row.description),
    documentNumber: row.document_number ?? undefined,
    validFrom: row.valid_from ?? undefined,
    validUntil: row.valid_until ?? undefined,
    tags: Array.isArray(row.tags) ? row.tags : [],
    linkedEntityType: ['customer', 'site', 'employee', 'shift', 'incident'].includes(linkedEntityType)
      ? linkedEntityType as ManagedDocument['linkedEntityType']
      : 'general',
    linkedEntityId: row.linked_entity_id ?? undefined,
    linkedEntityName: row.linked_entity_name ?? undefined,
    archivedAt: row.archived_at ?? undefined
  };
}

type AlarmIncidentQuery = {
  customerId?: string;
  siteId?: string;
  alarmTypeId?: string;
  status?: string;
  severity?: string;
  assignedEmployeeId?: string;
  dateFrom?: string;
  dateUntil?: string;
  overdue?: boolean;
};

function alarmIncidentQueryString(filters: AlarmIncidentQuery): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (typeof value === 'boolean' ? value : Boolean(value)) params.set(key, String(value));
  }
  return params.toString();
}

let alarmIncidentRequestId = 0;

interface SecurityOpsStore {
  // Theme
  theme: ThemeMode;
  toggleTheme: () => void;

  // Session & API hydration
  authUser: AuthUser | null;
  isAuthenticated: boolean;
  isAuthenticating: boolean;
  authError: string | null;
  isLoadingData: boolean;
  dataLoadError: string | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  restoreSession: () => Promise<void>;
  loadTenantData: () => Promise<void>;
  loadAlarmIncidents: (filters: AlarmIncidentQuery) => Promise<void>;
  loadMoreAlarmIncidents: () => Promise<void>;
  alarmIncidentFilterQuery: string;
  alarmIncidentNextCursor: string | null;
  hasMoreAlarmIncidents: boolean;
  isLoadingMoreAlarmIncidents: boolean;

  // Multi-Tenancy
  tenants: Tenant[];
  currentTenantId: string;
  setCurrentTenantId: (tenantId: string) => void;
  getCurrentTenant: () => Tenant;

  // Current User / RBAC
  currentUserRole: UserRole;
  currentUserName: string;
  currentUserId: string;
  setCurrentUserRole: (role: UserRole) => void;

  // Active View Tab
  activeTab: string;
  setActiveTab: (tab: string) => void;

  // Global Search
  globalSearch: string;
  setGlobalSearch: (q: string) => void;
  performGlobalSearch: (q: string) => GlobalSearchResult[];

  // Offline Engine & Sync Status
  isOnline: boolean;
  isSyncing: boolean;
  lastSyncTime: string | null;
  toggleNetworkSimulation: () => void;
  syncQueue: OfflineQueueItem[];
  enqueueOfflineAction: (item: Omit<OfflineQueueItem, 'id' | 'createdAt' | 'status' | 'retryCount'> & { id?: string }) => Promise<void>;
  triggerManualSync: () => Promise<{ success: number; failed: number; conflicts: number }>;
  resolveConflict: (queueId: string, resolution: 'USE_LOCAL' | 'USE_SERVER') => Promise<void>;
  clearCompletedSyncs: () => void;

  // Plugins
  modules: SecurityModuleManifest[];
  toggleModule: (moduleId: string) => void;
  isModuleActive: (moduleId: string) => boolean;

  // Security Audit & Sessions
  auditLogs: SecurityAuditEntry[];
  activeSessions: UserSessionDevice[];
  gdprPolicies: GdprRetentionPolicy[];
  revokeSession: (sessionId: string) => void;
  addAuditLog: (entry: Omit<SecurityAuditEntry, 'id' | 'timestamp' | 'tenantId'>) => void;

  // Notifications
  notifications: { id: string; title: string; message: string; type: 'info' | 'warning' | 'alert'; time: string }[];
  notificationDeliveries: NotificationDelivery[];
  notificationPreferences: NotificationPreference;
  dismissNotification: (id: string) => void;
  addNotification: (title: string, message: string, type: 'info' | 'warning' | 'alert') => void;
  markNotificationAsRead: (deliveryId: string) => void;
  updateNotificationPreferences: (prefs: Partial<NotificationPreference>) => void;

  // Automations
  automations: AutomationRule[];
  automationTemplates: AutomationRule[];
  executionLogs: AutomationExecutionLog[];
  addAutomationRule: (rule: Omit<AutomationRule, 'id' | 'actionsTriggeredCount'>) => void;
  updateAutomationRule: (id: string, updates: Partial<AutomationRule>) => void;
  deleteAutomationRule: (id: string) => void;
  duplicateAutomationRule: (id: string) => void;
  toggleAutomationRule: (id: string) => void;
  testRunRule: (id: string) => { matched: boolean; actions: string[]; durationMs: number };
  runAutomationsNow: () => number;

  // Datasets
  clients: Client[];
  sites: Site[];
  employees: Employee[];
  shifts: Shift[];
  guardBook: GuardBookEntry[];
  sops: SOPDocument[];
  alarmTypes: AlarmType[];
  alarmSites: AlarmSite[];
  emergencyPlans: EmergencyPlan[];
  alarmIncidents: AlarmIncident[];
  pendingAlarmMutations: AlarmMutation[];
  keys: KeyItem[];
  tasks: TaskItem[];
  documents: ManagedDocument[];
  setDocuments: (documents: ManagedDocument[]) => void;
  patrolScans: PatrolScanEvent[];
  shiftHandovers: ShiftHandoverProtocol[];

  // Tenant-Partitioned Selectors
  getTenantClients: () => Client[];
  getTenantSites: () => Site[];
  getTenantEmployees: () => Employee[];
  getTenantShifts: () => Shift[];
  getTenantGuardBook: () => GuardBookEntry[];
  getTenantSOPs: () => SOPDocument[];
  getTenantEmergencyPlans: () => EmergencyPlan[];
  getTenantAlarmIncidents: () => AlarmIncident[];
  getTenantKeys: () => KeyItem[];
  getTenantTasks: () => TaskItem[];
  getTenantDocuments: () => ManagedDocument[];
  getTenantPatrolScans: () => PatrolScanEvent[];
  getTenantShiftHandovers: () => ShiftHandoverProtocol[];
  getTenantAutomations: () => AutomationRule[];
  getTenantAuditLogs: () => SecurityAuditEntry[];
  getTenantExecutionLogs: () => AutomationExecutionLog[];
  getTenantNotificationDeliveries: () => NotificationDelivery[];

  // Actions
  addClient: (client: Omit<Client, 'id' | 'tenantId'>) => Promise<void>;
  updateClient: (id: string, updates: Partial<Client>) => Promise<void>;
  archiveClient: (id: string) => Promise<void>;
  addSite: (site: Omit<Site, 'id' | 'tenantId'>) => Promise<void>;
  updateSite: (id: string, updates: Partial<Site>) => Promise<void>;
  archiveSite: (id: string) => Promise<void>;
  restoreSite: (id: string) => Promise<void>;
  addEmployee: (emp: Omit<Employee, 'id' | 'tenantId'>) => Promise<void>;
  updateEmployee: (id: string, updates: Partial<Employee>) => Promise<void>;
  archiveEmployee: (id: string) => Promise<void>;
  restoreEmployee: (id: string) => Promise<void>;
  addQualification: (employeeId: string, qualification: Omit<Qualification, 'id'>) => Promise<void>;
  updateQualification: (employeeId: string, qualificationId: string, changes: Partial<Qualification>) => Promise<void>;
  addAbsence: (employeeId: string, absence: Omit<AbsenceRecord, 'id' | 'approved' | 'status' | 'revisionVersion'>) => Promise<void>;
  reviewAbsence: (employeeId: string, absenceId: string, decision: 'APPROVED' | 'REJECTED') => Promise<void>;
  addShift: (shift: Omit<Shift, 'id' | 'tenantId'>) => Promise<void>;
  assignShiftEmployee: (shiftId: string, employeeId: string, employeeName: string) => Promise<void>;
  addGuardBookEntry: (entry: Omit<GuardBookEntry, 'id' | 'timestamp' | 'tenantId'>) => Promise<void>;
  updateGuardBookStage: (id: string, stage: GuardBookEntry['stage'], note?: string) => void;
  resolveGuardBookEntry: (id: string, note: string) => void;
  pendingSOPAcknowledgements: SOPPendingAcknowledgement[];
  acknowledgeSOP: (sopId: string) => Promise<boolean>;
  syncPendingSOPAcknowledgements: () => Promise<void>;
  reportAlarmIncident: (payload: Record<string, unknown>) => Promise<{ state: 'confirmed' | 'pending'; data?: unknown }>;
  addAlarmAction: (incidentId: string, payload: Record<string, unknown>) => Promise<{ state: 'confirmed' | 'pending'; data?: unknown }>;
  changeAlarmStatus: (incidentId: string, payload: Record<string, unknown>) => Promise<{ state: 'confirmed' | 'pending'; data?: unknown }>;
  syncPendingAlarmMutations: () => Promise<void>;
  issueKey: (keyId: string, holderName: string, holderId: string, returnDate: string) => Promise<void>;
  returnKey: (keyId: string) => Promise<void>;
  addTask: (task: Omit<TaskItem, 'id' | 'tenantId'>) => Promise<void>;
  addPatrolScan: (scan: Omit<PatrolScanEvent, 'id' | 'tenantId' | 'scannedAt' | 'offlineCaptured'>) => Promise<void>;
  submitShiftHandover: (handover: Omit<ShiftHandoverProtocol, 'id' | 'tenantId' | 'handoverTime' | 'offlineCaptured'>) => Promise<void>;
  toggleTaskStatus: (taskId: string) => Promise<void>;
  addEmergencyPlan: (plan: Omit<EmergencyPlan, 'id' | 'tenantId'>) => void;
  resolveAlarm: (siteId: string) => void;
}

type StoreSetter = (partial: Partial<SecurityOpsStore> | ((state: SecurityOpsStore) => Partial<SecurityOpsStore>)) => void;
type StoreGetter = () => SecurityOpsStore;

function storedAlarmMutationToState(mutation: StoredAlarmMutation): AlarmMutation {
  return {
    clientMutationId: mutation.clientMutationId,
    tenantId: mutation.tenantId,
    userId: mutation.userId,
    type: mutation.type,
    payload: mutation.payload,
    capturedAt: mutation.capturedAt,
    status: mutation.status,
    serverId: mutation.serverId,
    errorMessage: mutation.errorMessage,
    updatedAt: mutation.updatedAt
  };
}

async function submitAlarmMutation(
  set: StoreSetter,
  get: StoreGetter,
  type: StoredAlarmMutation['type'],
  payload: Record<string, unknown>,
  endpoint: string
): Promise<{ state: 'confirmed' | 'pending'; data?: unknown }> {
  const identity = currentSOPIdentity(get());
  if (!identity.tenantId || !identity.userId) throw new Error('Für die Offline-Erfassung ist eine aktive Sitzung erforderlich.');
  const clientMutationId = createAlarmMutationId();
  const capturedAt = typeof payload.capturedAt === 'string' ? payload.capturedAt : new Date().toISOString();
  let effectivePayload = payload;
  let effectiveEndpoint = endpoint;
  let hasPendingIncidentDependency = false;
  if (type !== 'incident_report' && typeof payload.incidentId === 'string' && payload.incidentId.startsWith('local:')) {
    const dependencyId = payload.incidentId.slice('local:'.length);
    const mutations = await offlineVault.getAlarmMutations(identity.tenantId, identity.userId);
    const report = mutations.find(item => item.clientMutationId === dependencyId && item.type === 'incident_report');
    if (!report) throw new Error('Die lokale Alarmmeldung für diese Maßnahme wurde nicht gefunden.');
    if (report.status === 'conflict') throw new Error('Die lokale Alarmmeldung ist in Konflikt und muss zuerst geprüft werden.');
    if (report.status === 'confirmed' && report.serverId) {
      effectivePayload = { ...payload, incidentId: report.serverId };
      effectiveEndpoint = endpoint.replace(payload.incidentId, report.serverId);
    } else {
      hasPendingIncidentDependency = true;
    }
  }
  const queued = await offlineVault.enqueueAlarmMutation({
    clientMutationId,
    tenantId: identity.tenantId,
    userId: identity.userId,
    type,
    payload: { ...effectivePayload, ...(type === 'incident_report' ? { capturedAt } : {}) },
    capturedAt
  });
  if (!isCurrentSOPIdentity(identity.tenantId, identity.userId)) return { state: 'pending' };
  set(state => ({
    pendingAlarmMutations: [
      ...state.pendingAlarmMutations.filter(item => item.clientMutationId !== clientMutationId),
      storedAlarmMutationToState(queued)
    ],
    alarmIncidents: type === 'incident_report'
      ? [
          ...state.alarmIncidents.filter(item => item.clientMutationId !== clientMutationId),
          mapLocalAlarmIncident(queued, state.emergencyPlans, state.sites, state.alarmTypes)!
        ]
      : state.alarmIncidents
  }));
  if (!get().isOnline || (typeof navigator !== 'undefined' && navigator.onLine === false)) {
    return { state: 'pending' };
  }
  if (hasPendingIncidentDependency) {
    void get().syncPendingAlarmMutations();
    return { state: 'pending' };
  }
  try {
    const requestPayload = Object.fromEntries(
      Object.entries(queued.payload).filter(([key]) => key !== 'incidentId')
    );
    const response = await apiClient.post<any>(effectiveEndpoint, { ...requestPayload, clientMutationId });
    const responseData = response?.data ?? response;
    const incident = responseData?.incident;
    const action = responseData?.action;
    const serverId = incident?.id ?? action?.id;
    await offlineVault.updateAlarmMutation(clientMutationId, {
      status: 'confirmed',
      serverId,
      errorMessage: undefined
    });
    if (!isCurrentSOPIdentity(identity.tenantId, identity.userId)) return { state: 'confirmed', data: response };
    set(state => {
      const mutation = state.pendingAlarmMutations.find(item => item.clientMutationId === clientMutationId);
      const updatedIncidents = state.alarmIncidents.map(item => {
        if (type === 'incident_report' && item.clientMutationId === clientMutationId && incident) {
          return {
            ...item,
            ...mapAlarmIncidentRow(incident, identity.tenantId),
            siteName: item.siteName,
            syncStatus: 'confirmed' as const
          };
        }
        if (type === 'status_change' && item.id === String(payload.incidentId) && responseData?.incident) {
          return { ...item, ...responseData.incident, status: responseData.incident.status, syncStatus: item.syncStatus };
        }
        return item;
      });
      return {
        pendingAlarmMutations: mutation
          ? state.pendingAlarmMutations.map(item => item.clientMutationId === clientMutationId
              ? { ...item, status: 'confirmed' as const, serverId, errorMessage: undefined, updatedAt: new Date().toISOString() }
              : item)
          : state.pendingAlarmMutations,
        alarmIncidents: updatedIncidents
      };
    });
    return { state: 'confirmed', data: response };
  } catch (error) {
    if (error instanceof ApiError && error.isNetworkError) {
      return { state: 'pending' };
    }
    const message = error instanceof Error ? error.message : 'Alarmmutation konnte nicht bestätigt werden.';
    await offlineVault.updateAlarmMutation(clientMutationId, { status: 'conflict', errorMessage: message });
    if (isCurrentSOPIdentity(identity.tenantId, identity.userId)) {
      set(state => ({
        pendingAlarmMutations: state.pendingAlarmMutations.map(item => item.clientMutationId === clientMutationId
          ? { ...item, status: 'conflict', errorMessage: message, updatedAt: new Date().toISOString() }
          : item),
        alarmIncidents: type === 'incident_report'
          ? state.alarmIncidents.map(item => item.clientMutationId === clientMutationId
              ? { ...item, syncStatus: 'conflict' }
              : item)
          : state.alarmIncidents
      }));
    }
    throw error;
  }
}

export const useSecurityStore = create<SecurityOpsStore>((set, get) => ({
  theme: (() => {
    try {
      return (typeof localStorage !== 'undefined' ? localStorage.getItem('secops_theme') as ThemeMode : 'dark') || 'dark';
    } catch {
      return 'dark';
    }
  })(),
  toggleTheme: () => {
    const nextTheme = get().theme === 'dark' ? 'light' : 'dark';
    try {
      if (typeof localStorage !== 'undefined') localStorage.setItem('secops_theme', nextTheme);
    } catch {}
    if (typeof document !== 'undefined') {
      if (nextTheme === 'dark') document.documentElement.classList.add('dark');
      else document.documentElement.classList.remove('dark');
    }
    set({ theme: nextTheme });
  },

  authUser: null,
  isAuthenticated: false,
  isAuthenticating: false,
  authError: null,
  isLoadingData: false,
  dataLoadError: null,

  login: async (email, password) => {
    set({ isAuthenticating: true, authError: null });
    try {
      const data = await apiClient.post<any>(
        '/auth/login',
        { email, password },
        { skipAuth: true }
      );
      apiClient.setCsrfToken(data.csrfToken);
      const user = data.user as AuthUser;
      apiClient.setTenantId(user.tenantId);
      set({
        authUser: user,
        currentTenantId: user.tenantId,
        isAuthenticated: true,
        isAuthenticating: false,
        pendingSOPAcknowledgements: [],
        sops: [],
        alarmTypes: [],
        alarmSites: [],
        emergencyPlans: [],
        alarmIncidents: [],
        alarmIncidentFilterQuery: '',
        pendingAlarmMutations: []
      });
      await get().loadTenantData();
    } catch (error: any) {
      apiClient.setCsrfToken(null);
      set({
        authUser: null,
        isAuthenticated: false,
        isAuthenticating: false,
        authError: error?.message || 'Anmeldung fehlgeschlagen.'
      });
      throw error;
    }
  },

  logout: async () => {
    try {
      await apiClient.post('/auth/logout', {});
    } catch {
      // Die lokale Sitzung wird in jedem Fall beendet.
    }
    apiClient.setCsrfToken(null);
    set({
      authUser: null,
      isAuthenticated: false,
      authError: null,
      documents: [],
      pendingSOPAcknowledgements: [],
      sops: [],
      alarmTypes: [],
      alarmSites: [],
      emergencyPlans: [],
      alarmIncidents: [],
      alarmIncidentFilterQuery: '',
      pendingAlarmMutations: []
    });
  },

  restoreSession: async () => {
    try {
      const me = await apiClient.get<any>('/auth/me');
      set({
        authUser: {
          id: me.sub ?? me.id ?? '',
          email: me.email ?? '',
          fullName: me.email ?? '',
          role: me.role ?? '',
          tenantId: me.tenantId ?? '',
          tenantName: '',
          permissions: Array.isArray(me.permissions) ? me.permissions : []
        },
        isAuthenticated: true,
        currentTenantId: me.tenantId ?? me.tenant_id ?? '',
        pendingSOPAcknowledgements: [],
        sops: [],
        alarmTypes: [],
        alarmSites: [],
        emergencyPlans: [],
        alarmIncidents: [],
        alarmIncidentFilterQuery: '',
        pendingAlarmMutations: []
      });
      apiClient.setTenantId(me.tenantId ?? me.tenant_id ?? '');
      await get().loadTenantData();
    } catch {
      apiClient.setCsrfToken(null);
      set({
        authUser: null, isAuthenticated: false, documents: [], pendingSOPAcknowledgements: [], sops: [],
        alarmTypes: [], alarmSites: [], emergencyPlans: [], alarmIncidents: [], alarmIncidentFilterQuery: '',
        pendingAlarmMutations: []
      });
    }
  },

  loadTenantData: async () => {
    const requestIdentity = currentSOPIdentity(get());
    const alarmRequest = ++alarmIncidentRequestId;
    const alarmFilterQuery = get().alarmIncidentFilterQuery;
    set({
      isLoadingData: true,
      dataLoadError: null,
      // Keine Mock-/Bestandsdaten als scheinbare PostgreSQL-Daten anzeigen.
      clients: [],
      sites: [],
      employees: [],
      guardBook: [],
      shifts: [],
      keys: [],
      tasks: [],
      documents: [],
      sops: [],
      alarmTypes: [],
      alarmSites: [],
      emergencyPlans: [],
      alarmIncidents: [],
      alarmIncidentFilterQuery: alarmFilterQuery,
      alarmIncidentNextCursor: null,
      hasMoreAlarmIncidents: false,
      isLoadingMoreAlarmIncidents: false,
      pendingAlarmMutations: [],
      pendingSOPAcknowledgements: []
    });

    const permissions = get().authUser?.permissions || [];
    const canReadDocuments = permissions.includes('documents:read');
    const canReadSOPs = permissions.includes('sop:read') || permissions.includes('sop:manage');
    const canReadAlarms = permissions.includes('alarm:read');
    const [
      clientsResult,
      sitesResult,
      employeesResult,
      logbookResult,
      shiftsResult,
      keysResult,
      tasksResult,
      documentsResult,
      sopsResult,
      alarmTypesResult,
      alarmSitesResult,
      emergencyPlansResult,
      alarmIncidentsResult
    ] = await Promise.allSettled([
      apiClient.get<any[]>('/customers'),
      apiClient.get<any[]>('/sites'),
      apiClient.get<any[]>('/employees'),
      apiClient.get<any[]>('/logbook'),
      apiClient.get<any[]>('/shifts'),
      apiClient.get<any[]>('/keys'),
      apiClient.get<any[]>('/tasks'),
      canReadDocuments ? apiClient.get<any[]>('/documents') : Promise.resolve([]),
      canReadSOPs ? apiClient.get<any[]>('/sops') : Promise.resolve([]),
      canReadAlarms ? apiClient.get<any[]>('/alarm-types') : Promise.resolve([]),
      canReadAlarms ? apiClient.get<any[]>('/alarm-sites') : Promise.resolve([]),
      canReadAlarms ? apiClient.get<any[]>('/emergency-plans') : Promise.resolve([]),
      canReadAlarms
        ? apiClient.get<any>(`/alarms?limit=100${alarmFilterQuery ? `&${alarmFilterQuery}` : ''}`)
        : Promise.resolve({ items: [], page: {} })
    ]);

    if (!isCurrentSOPIdentity(requestIdentity.tenantId, requestIdentity.userId)) return;
    const tenantId = requestIdentity.tenantId;
    const errors: string[] = [];
    const nextState: Partial<SecurityOpsStore> = {};

    if (clientsResult.status === 'fulfilled') {
      nextState.clients = clientsResult.value.map((row) => mapClientRow(row, tenantId));
    } else {
      errors.push(`Kunden: ${errorText(clientsResult.reason)}`);
    }

    if (sitesResult.status === 'fulfilled') {
      nextState.sites = sitesResult.value.map((row) => mapSiteRow(row, tenantId));
    } else {
      errors.push(`Objekte: ${errorText(sitesResult.reason)}`);
    }

    if (employeesResult.status === 'fulfilled') {
      nextState.employees = employeesResult.value.map((row) => mapEmployeeRow(row, tenantId));
    } else {
      errors.push(`Mitarbeiter: ${errorText(employeesResult.reason)}`);
    }

    if (logbookResult.status === 'fulfilled') {
      nextState.guardBook = logbookResult.value.map((row) => mapGuardBookRow(row, tenantId));
    } else {
      errors.push(`Wachbuch: ${errorText(logbookResult.reason)}`);
    }

    if (shiftsResult.status === 'fulfilled') {
      nextState.shifts = shiftsResult.value.map((row) => mapShiftRow(row, tenantId));
    } else {
      errors.push(`Schichten: ${errorText(shiftsResult.reason)}`);
    }

    if (keysResult.status === 'fulfilled') {
      nextState.keys = keysResult.value.map((row) => mapKeyRow(row, tenantId));
    } else {
      errors.push(`Schlüssel: ${errorText(keysResult.reason)}`);
    }

    if (tasksResult.status === 'fulfilled') {
      nextState.tasks = tasksResult.value.map((row) => mapTaskRow(row, tenantId));
    } else {
      errors.push(`Aufgaben: ${errorText(tasksResult.reason)}`);
    }

    if (documentsResult.status === 'fulfilled') {
      nextState.documents = documentsResult.value.map((row) => mapDmsDocumentRow(row, tenantId));
    } else {
      errors.push(`Dokumente: ${errorText(documentsResult.reason)}`);
    }

    if (canReadSOPs && sopsResult.status === 'fulfilled') {
      const currentUserId = requestIdentity.userId;
      const loadedSOPs = sopsResult.value.map((row) => mapSOPRow(row, tenantId));
      try {
        await migrateLegacySOPAcknowledgements(tenantId, currentUserId);
        const persistedPending = await offlineVault.getSOPAcknowledgements(tenantId, currentUserId);
        if (!isCurrentSOPIdentity(tenantId, currentUserId)) return;
        const pending: SOPPendingAcknowledgement[] = [];
        for (const ack of persistedPending) {
          const currentAck: SOPPendingAcknowledgement = {
            ...ack,
            status: ack.status === 'stale' ||
              !matchesPendingSOPRevision(loadedSOPs.find((sop) => sop.id === ack.sopId), ack)
              ? 'stale'
              : 'pending'
          };
          if (currentAck.status === 'stale' && ack.status !== 'stale') {
            await offlineVault.updateSOPAcknowledgement(ack.clientMutationId, 'stale').catch(() => undefined);
          }
          pending.push(currentAck);
        }
        nextState.sops = loadedSOPs.map((sop) => {
          const ack = pending.find((item) => item.sopId === sop.id);
          if (!ack) return sop;
          return {
            ...sop,
            currentUserAcknowledgment: ack.status === 'pending' ? 'pending' : 'stale'
          };
        });
        nextState.pendingSOPAcknowledgements = pending;
      } catch (error) {
        errors.push(`Offline-Kenntnahmen: ${errorText(error)}`);
        nextState.sops = loadedSOPs;
      }
    } else if (canReadSOPs && sopsResult.status === 'rejected') {
      errors.push(`Dienstanweisungen: ${errorText(sopsResult.reason)}`);
    }

    if (canReadAlarms && alarmTypesResult.status === 'fulfilled') {
      nextState.alarmTypes = alarmTypesResult.value.map((row) => ({
        id: asString(row.id),
        tenantId,
        code: asString(row.code),
        label: asString(row.label),
        isSystem: Boolean(row.is_system ?? row.isSystem),
        isActive: row.is_active ?? row.isActive ?? true
      }));
    } else if (canReadAlarms && alarmTypesResult.status === 'rejected') {
      try {
        const cached = await offlineVault.getEmergencyPlanCache(tenantId, requestIdentity.userId);
        if (cached?.types.length) {
          nextState.alarmTypes = cached.types.map((row) => ({
            id: asString(row.id),
            tenantId,
            code: asString(row.code),
            label: asString(row.label),
            isSystem: Boolean(row.is_system ?? row.isSystem),
            isActive: row.is_active ?? row.isActive ?? true
          }));
        } else {
          errors.push(`Alarmarten: ${errorText(alarmTypesResult.reason)}`);
        }
      } catch (error) {
        errors.push(`Alarmarten: ${errorText(alarmTypesResult.reason)}; Offline-Cache: ${errorText(error)}`);
      }
    }

    if (canReadAlarms && alarmSitesResult.status === 'fulfilled') {
      nextState.alarmSites = alarmSitesResult.value.map((row) => ({
        id: asString(row.id),
        customerId: asString(row.customer_id ?? row.customerId),
        name: asString(row.name)
      }));
    } else if (canReadAlarms && alarmSitesResult.status === 'rejected') {
      try {
        const cached = await offlineVault.getEmergencyPlanCache(tenantId, requestIdentity.userId);
        if (cached?.sites.length) {
          nextState.alarmSites = cached.sites.map((row) => ({
            id: asString(row.id),
            customerId: asString(row.customer_id ?? row.customerId),
            name: asString(row.name)
          }));
        } else {
          errors.push(`Alarmobjekte: ${errorText(alarmSitesResult.reason)}`);
        }
      } catch (error) {
        errors.push(`Alarmobjekte: ${errorText(alarmSitesResult.reason)}; Offline-Cache: ${errorText(error)}`);
      }
    }

    let loadedPlans: EmergencyPlan[] = [];
    if (canReadAlarms && emergencyPlansResult.status === 'fulfilled') {
      loadedPlans = emergencyPlansResult.value.map((row) => mapEmergencyPlanRow(row, tenantId));
      nextState.emergencyPlans = loadedPlans;
      try {
        await offlineVault.saveEmergencyPlanCache(
          tenantId,
          requestIdentity.userId,
          emergencyPlansResult.value,
          (nextState.alarmTypes as AlarmType[] | undefined) ?? [],
          (nextState.alarmSites as AlarmSite[] | undefined) ?? []
        );
      } catch (error) {
        errors.push(`Offline-Notfallplancache: ${errorText(error)}`);
      }
    } else if (canReadAlarms && emergencyPlansResult.status === 'rejected') {
      try {
        const cached = await offlineVault.getEmergencyPlanCache(tenantId, requestIdentity.userId);
        if (cached) {
          loadedPlans = cached.plans.map((row) => ({ ...mapEmergencyPlanRow(row, tenantId), offlineCopy: true }));
          nextState.emergencyPlans = loadedPlans;
          errors.push('Notfallpläne stammen aus dem lokalen Offline-Cache; Kontaktinformationen werden nicht offline gespeichert.');
        } else {
          errors.push(`Notfallpläne: ${errorText(emergencyPlansResult.reason)}`);
        }
      } catch (cacheError) {
        errors.push(`Notfallpläne: ${errorText(emergencyPlansResult.reason)}; Offline-Cache: ${errorText(cacheError)}`);
      }
    }

    let loadedIncidents: AlarmIncident[] = [];
    if (canReadAlarms && alarmRequest === alarmIncidentRequestId && alarmIncidentsResult.status === 'fulfilled') {
      const incidentPage = Array.isArray(alarmIncidentsResult.value)
        ? { items: alarmIncidentsResult.value, page: { nextCursor: null, hasMore: false } }
        : alarmIncidentsResult.value;
      loadedIncidents = incidentPage.items.map((row: any) => mapAlarmIncidentRow(row, tenantId));
      nextState.alarmIncidentNextCursor = incidentPage.page?.nextCursor ?? null;
      nextState.hasMoreAlarmIncidents = Boolean(incidentPage.page?.hasMore);
    } else if (canReadAlarms && alarmRequest === alarmIncidentRequestId && alarmIncidentsResult.status === 'rejected') {
      errors.push(`Alarmvorfälle: ${errorText(alarmIncidentsResult.reason)}`);
    }

    if (canReadAlarms && alarmRequest === alarmIncidentRequestId) {
      try {
        const localMutations = await offlineVault.getAlarmMutations(tenantId, requestIdentity.userId);
        const mutationById = new Map(localMutations.map(item => [item.clientMutationId, item]));
        loadedIncidents = loadedIncidents.map(item => {
          const mutation = item.clientMutationId ? mutationById.get(item.clientMutationId) : undefined;
          return mutation
            ? { ...item, syncStatus: mutation.status, clientMutationId: mutation.clientMutationId }
            : item;
        });
        const loadedTypes = (nextState.alarmTypes as AlarmType[] | undefined) ?? [];
        const sitesForLocal = (nextState.alarmSites as AlarmSite[] | undefined) ?? [];
        const mutations: AlarmMutation[] = localMutations.map(item => ({
          clientMutationId: item.clientMutationId,
          tenantId: item.tenantId,
          userId: item.userId,
          type: item.type,
          payload: item.payload,
          capturedAt: item.capturedAt,
          status: item.status,
          serverId: item.serverId,
          errorMessage: item.errorMessage,
          updatedAt: item.updatedAt
        }));
        nextState.pendingAlarmMutations = mutations;
        const knownMutationIds = new Set(loadedIncidents.map(item => item.clientMutationId).filter(Boolean));
        const localIncidents = localMutations
          .filter(item => item.type === 'incident_report' && !knownMutationIds.has(item.clientMutationId))
          .map(item => mapLocalAlarmIncident(item, loadedPlans, sitesForLocal, loadedTypes))
          .filter((item): item is AlarmIncident => item !== null);
        loadedIncidents = [...localIncidents, ...loadedIncidents];
        nextState.alarmIncidents = loadedIncidents;
      } catch (error) {
        errors.push(`Offline-Alarmmutationen: ${errorText(error)}`);
        nextState.alarmIncidents = loadedIncidents;
      }
    }

    if (alarmRequest !== alarmIncidentRequestId) {
      delete nextState.alarmIncidents;
      delete nextState.alarmIncidentNextCursor;
      delete nextState.hasMoreAlarmIncidents;
      delete nextState.isLoadingMoreAlarmIncidents;
    }

    const dataLoadError = errors.length > 0 ? errors.join(' | ') : null;
    set({ ...nextState, isLoadingData: false, dataLoadError });
    if (canReadSOPs && sopsResult.status === 'fulfilled') void get().syncPendingSOPAcknowledgements();
    if (canReadAlarms && alarmTypesResult.status === 'fulfilled' && emergencyPlansResult.status === 'fulfilled') {
      void get().syncPendingAlarmMutations();
    }

    if (dataLoadError) {
      get().addNotification('Daten teilweise nicht geladen', dataLoadError, 'alert');
    }
  },

  loadAlarmIncidents: async (filters) => {
    const requestIdentity = currentSOPIdentity(get());
    const requestId = ++alarmIncidentRequestId;
    const filterQuery = alarmIncidentQueryString(filters);
    set({
      alarmIncidentFilterQuery: filterQuery,
      alarmIncidentNextCursor: null,
      hasMoreAlarmIncidents: false,
      isLoadingMoreAlarmIncidents: false
    });
    const query = filterQuery ? `&${filterQuery}` : '';
    const page = await apiClient.get<any>(`/alarms?limit=100${query}`);
    if (
      requestId !== alarmIncidentRequestId ||
      !isCurrentSOPIdentity(requestIdentity.tenantId, requestIdentity.userId)
    ) return;
    const fetched = (page.items as any[]).map(row => mapAlarmIncidentRow(row, requestIdentity.tenantId));
    const localPending = get().alarmIncidents.filter(incident =>
      incident.syncStatus === 'pending' || incident.syncStatus === 'conflict'
    );
    const knownIds = new Set(localPending.map(incident => incident.id));
    set({
      alarmIncidents: [...localPending, ...fetched.filter(incident => !knownIds.has(incident.id))],
      alarmIncidentNextCursor: page.page?.nextCursor ?? null,
      hasMoreAlarmIncidents: Boolean(page.page?.hasMore)
    });
  },

  loadMoreAlarmIncidents: async () => {
    const state = get();
    const cursor = state.alarmIncidentNextCursor;
    if (!cursor || !state.hasMoreAlarmIncidents || state.isLoadingMoreAlarmIncidents) return;
    const requestIdentity = currentSOPIdentity(state);
    const requestId = alarmIncidentRequestId;
    set({ isLoadingMoreAlarmIncidents: true });
    try {
      const page = await apiClient.get<any>(
        `/alarms?limit=100${state.alarmIncidentFilterQuery ? `&${state.alarmIncidentFilterQuery}` : ''}&cursor=${encodeURIComponent(cursor)}`
      );
      if (
        requestId !== alarmIncidentRequestId ||
        !isCurrentSOPIdentity(requestIdentity.tenantId, requestIdentity.userId)
      ) return;
      const nextIncidents = (page.items as any[]).map(row => mapAlarmIncidentRow(row, requestIdentity.tenantId));
      const current = get().alarmIncidents;
      const knownIds = new Set(current.map(incident => incident.id));
      set({
        alarmIncidents: [...current, ...nextIncidents.filter(incident => !knownIds.has(incident.id))],
        alarmIncidentNextCursor: page.page?.nextCursor ?? null,
        hasMoreAlarmIncidents: Boolean(page.page?.hasMore),
        isLoadingMoreAlarmIncidents: false
      });
    } catch (error) {
      set({ isLoadingMoreAlarmIncidents: false });
      throw error;
    }
  },

  tenants: initialTenants,
  currentTenantId: (() => {
    try {
      return (typeof localStorage !== 'undefined' ? localStorage.getItem('secops_tenant_id') : null) || 'tenant-frankfurt';
    } catch {
      return 'tenant-frankfurt';
    }
  })(),
  setCurrentTenantId: (tenantId) => {
    apiClient.setTenantId(tenantId);
    set({
      currentTenantId: tenantId, pendingSOPAcknowledgements: [], sops: [], alarmTypes: [],
      alarmSites: [],
      emergencyPlans: [], alarmIncidents: [], alarmIncidentFilterQuery: '',
      alarmIncidentNextCursor: null, hasMoreAlarmIncidents: false,
      isLoadingMoreAlarmIncidents: false, pendingAlarmMutations: []
    });
    void get().loadTenantData();
  },
  getCurrentTenant: () => {
    const { tenants, currentTenantId } = get();
    return tenants.find((t) => t.id === currentTenantId) || tenants[0];
  },

  currentUserRole: UserRole.EINSATZLEITUNG,
  currentUserName: 'Alexander Schmidt (Einsatzleiter)',
  currentUserId: 'e-1',
  setCurrentUserRole: (role) => {
    let name = 'Alexander Schmidt (Einsatzleiter)';
    let uId = 'e-1';
    if (role === UserRole.GUARD) {
      name = 'Sabine Becker (Wachdienstmitarbeiter)';
      uId = 'e-3';
    } else if (role === UserRole.OBJEKTLEITUNG) {
      name = 'Tarkan Kaya (Objektleiter)';
      uId = 'e-2';
    } else if (role === UserRole.ADMIN || role === UserRole.GF) {
      name = 'Dr. Michael von Berg (Geschäftsführung)';
      uId = 'admin-1';
    }
    set({ currentUserRole: role, currentUserName: name, currentUserId: uId });
  },

  activeTab: 'dashboard',
  setActiveTab: (tab) => set({ activeTab: tab }),

  globalSearch: '',
  setGlobalSearch: (q) => set({ globalSearch: q }),

  performGlobalSearch: (query) => {
    if (!query || query.trim().length < 2) return [];
    const q = query.toLowerCase().trim();
    const { getTenantClients, getTenantSites, getTenantEmployees, getTenantGuardBook, getTenantKeys, getTenantTasks, getTenantDocuments } = get();
    const results: GlobalSearchResult[] = [];

    getTenantClients().forEach((c) => {
      if (c.companyName.toLowerCase().includes(q) || c.clientNumber.toLowerCase().includes(q)) {
        results.push({ id: c.id, title: c.companyName, subtitle: `Kunde ${c.clientNumber} • ${c.contactPerson}`, category: 'Kunde', targetTab: 'clients' });
      }
    });

    getTenantSites().forEach((s) => {
      if (s.name.toLowerCase().includes(q) || s.siteCode.toLowerCase().includes(q) || s.address.toLowerCase().includes(q)) {
        results.push({ id: s.id, title: s.name, subtitle: `${s.siteCode} • ${s.securityLevel}`, category: 'Objekt', targetTab: 'sites' });
      }
    });

    getTenantEmployees().forEach((e) => {
      const name = `${e.firstName} ${e.lastName}`;
      if (name.toLowerCase().includes(q) || e.personnelNumber.toLowerCase().includes(q)) {
        results.push({ id: e.id, title: name, subtitle: `${e.personnelNumber} • ${e.role}`, category: 'Mitarbeiter', targetTab: 'employees' });
      }
    });

    getTenantGuardBook().forEach((g) => {
      if (g.title.toLowerCase().includes(q) || g.description.toLowerCase().includes(q) || g.siteName.toLowerCase().includes(q)) {
        results.push({ id: g.id, title: g.title, subtitle: `${g.siteName} • ${g.priority}`, category: 'Wachbuch', targetTab: 'guardbook' });
      }
    });

    getTenantKeys().forEach((k) => {
      if (k.label.toLowerCase().includes(q) || k.keyNumber.toLowerCase().includes(q)) {
        results.push({ id: k.id, title: `${k.label} (${k.keyNumber})`, subtitle: `Status: ${k.status} • ${k.siteName}`, category: 'Schlüssel', targetTab: 'keys' });
      }
    });

    getTenantTasks().forEach((t) => {
      if (t.title.toLowerCase().includes(q) || t.assignedToName.toLowerCase().includes(q)) {
        results.push({ id: t.id, title: t.title, subtitle: `Frist: ${t.dueDate} • ${t.assignedToName}`, category: 'Aufgabe', targetTab: 'tasks' });
      }
    });

    getTenantDocuments().forEach((d) => {
      if (d.title.toLowerCase().includes(q) || d.fileName.toLowerCase().includes(q)) {
        results.push({ id: d.id, title: d.title, subtitle: `${d.category} • v${d.version}`, category: 'Dokument', targetTab: 'documents' });
      }
    });

    return results;
  },

  isOnline: typeof navigator === 'undefined' || navigator.onLine,
  isSyncing: false,
  lastSyncTime: null,
  toggleNetworkSimulation: () => {
    const nextState = !get().isOnline;
    set({ isOnline: nextState });

    if (nextState) {
      void get().syncPendingSOPAcknowledgements();
      void get().syncPendingAlarmMutations();
      get().triggerManualSync();
      get().addNotification(
        'Verbindung wiederhergestellt',
        'Das System synchronisiert jetzt ausstehende Offline-Ereignisse mit der PostgreSQL-Datenbank.',
        'info'
      );
    } else {
      get().addNotification(
        'Offline-Modus aktiv',
        'Netzwerk unterbrochen. Wachbuch, Kontrollgänge und Aufgaben werden lokal in der IndexedDB Outbox gesichert.',
        'warning'
      );
    }
  },

  syncQueue: [],

  enqueueOfflineAction: async (item) => {
    const queueEntry: OfflineQueueItem = {
      ...item,
      id: item.id ?? `queue-${crypto.randomUUID()}`,
      createdAt: new Date().toLocaleTimeString(),
      retryCount: 0,
      status: 'pending'
    };

    try {
      await offlineVault.enqueueMutation({
        id: queueEntry.id,
        tenantId: queueEntry.tenantId,
        userId: get().currentUserId,
        entityType: queueEntry.entityType as any,
        action: queueEntry.action,
        payload: queueEntry.payload,
        occurredAt: new Date().toISOString(),
        baseVersion: queueEntry.baseVersion ?? 1
      });

      set((state) => ({
        syncQueue: [{
          ...queueEntry,
          payload: offlineQueuePreviewPayload(queueEntry.entityType, queueEntry.payload)
        }, ...state.syncQueue]
      }));
    } catch (err: any) {
      console.error('[OUTBOX WRITE FAILED]', err);
      get().addNotification(
        'Lokaler Speicherfehler',
        `Konnte Eintrag nicht lokal sichern: ${err?.message || 'Unbekannter IndexedDB Fehler'}`,
        'alert'
      );
      throw err;
    }
  },

  triggerManualSync: async () => {
    const { isOnline, currentTenantId, syncQueue } = get();

    if (!isOnline) {
      return { success: 0, failed: syncQueue.filter((q) => q.status === 'pending').length, conflicts: 0 };
    }

    if (isSyncRunningMutex) {
      console.warn('[SYNC MUTEX] Synchronisation läuft bereits. Paralleler Aufruf abgewiesen.');
      return { success: 0, failed: 0, conflicts: 0 };
    }

    isSyncRunningMutex = true;
    set({ isSyncing: true });

    let successCount = 0;
    let failedCount = 0;
    let conflictCount = 0;

    try {
      const pendingItems = await offlineVault.getPendingOutbox(currentTenantId);

      if (pendingItems.length === 0) {
        const allItems = await offlineVault.getOutbox(currentTenantId);
        set({
          syncQueue: allItems.map(offlineOutboxToQueueItem),
          isSyncing: false,
          lastSyncTime: new Date().toLocaleTimeString()
        });
        isSyncRunningMutex = false;
        return { success: 0, failed: 0, conflicts: 0 };
      }

      const makeSyncPayload = (items: typeof pendingItems) => ({
        deviceId: offlineVault.getDeviceId(),
        mutations: items.map((p) => ({
          clientUuid: p.id,
          entityType: p.entityType,
          action: p.action,
          clientTimestamp: p.occurredAt,
          baseVersion: p.baseVersion,
          payload: p.payload
        }))
      });

      try {
        for (const items of [
          pendingItems.filter((p) => !['client', 'site', 'employee', 'handover', 'patrol'].includes(p.entityType)),
          pendingItems.filter((p) => p.entityType === 'patrol'),
          pendingItems.filter((p) => p.entityType === 'handover'),
          pendingItems.filter((p) => p.entityType === 'client'),
          pendingItems.filter((p) => p.entityType === 'site'),
          pendingItems.filter((p) => p.entityType === 'employee')
        ]) {
          if (!items.length) continue;
          const path = items[0].entityType === 'patrol' ? '/patrol/sync'
            : items[0].entityType === 'handover' ? '/handovers/sync'
            : items[0].entityType === 'client' ? '/customers/sync'
              : items[0].entityType === 'site' ? '/sites/sync'
                : items[0].entityType === 'employee' ? '/employees/sync'
                  : '/sync/push';
          const orderedItems = ['site', 'employee'].includes(items[0].entityType) ? [...items].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt)) : items;
          const serverResponse: any = await apiClient.post(path, makeSyncPayload(orderedItems));
          const receipts = Array.isArray(serverResponse) ? serverResponse : serverResponse?.data;
          if (!Array.isArray(receipts)) continue;
          for (const receipt of receipts) {
            if (receipt.status === 'SYNCED') {
              const mutation = orderedItems.find(item => item.id === receipt.clientUuid);
              if (mutation?.entityType === 'patrol') {
                if (mutation.payload?.recordType === 'round_start' && mutation.payload.roundId) {
                  await offlineVault.markPatrolRoundSynced(currentTenantId, mutation.userId, mutation.payload.roundId);
                } else if (mutation.payload?.recordType === 'round_complete' && mutation.payload.roundId) {
                  await offlineVault.deletePatrolRound(currentTenantId, mutation.userId, mutation.payload.roundId);
                }
              }
              successCount++;
              await offlineVault.markSynced(receipt.clientUuid);
            }
            else if (receipt.status === 'CONFLICT') { conflictCount++; await offlineVault.updateMutationStatus(receipt.clientUuid, 'CONFLICT', { conflictDetails: receipt.conflictData }); }
            else { failedCount++; await offlineVault.updateMutationStatus(receipt.clientUuid, 'FAILED', { errorMessage: receipt.message || 'Server hat Mutation abgewiesen' }); }
          }
        }
      } catch (networkErr) {
        console.warn('[SYNC PUSH NETWORK FAILED] Outbox bleibt unversehrt:', networkErr);
        for (const item of pendingItems) {
          await offlineVault.updateMutationStatus(item.id, 'FAILED', {
            errorMessage: 'Netzwerkfehler während Übertragung'
          });
        }
        set({ isSyncing: false });
        isSyncRunningMutex = false;
        return { success: 0, failed: pendingItems.length, conflicts: 0 };
      }

      const remainingOutbox = await offlineVault.getOutbox(currentTenantId);
      set({
        syncQueue: remainingOutbox.map(offlineOutboxToQueueItem),
        isSyncing: false,
        lastSyncTime: new Date().toLocaleTimeString()
      });

      if (successCount > 0) {
        get().addNotification(
          'Synchronisation erfolgreich',
          `${successCount} Einträge erfolgreich mit PostgreSQL synchronisiert.`,
          'info'
        );
      }

      if (conflictCount > 0) {
        get().addNotification(
          'Synchronisationskonflikt erkannt',
          `${conflictCount} Eintrag/Einträge erfordern manuelle Überprüfung im Sync-Manager.`,
          'warning'
        );
      }
    } catch (err: any) {
      console.error('[CRITICAL SYNC ERROR]', err);
    } finally {
      isSyncRunningMutex = false;
      set({ isSyncing: false });
    }

    return { success: successCount, failed: failedCount, conflicts: conflictCount };
  },

  /**
   * Vollständige Konfliktauflösung im Frontend (Schritt 5R.2.3):
   * - Sendet echten API-Aufruf an POST /api/v1/sync/conflicts/resolve.
   * - Validiert apiClient Rückgabe: data.applied === true und data.serverState müssen vorliegen.
   * - Aktualisiert den vollständigen Datensatz (task, shift, key, guardbook) im Zustand-Store.
   * - Entfernt die Mutation erst nach bestätigtem Serverabschluss aus der lokalen Outbox.
   * - Bei Fehlern bleibt der Konflikt in der Outbox erhalten und wirft sauber einen Fehler.
   */
  resolveConflict: async (queueId: string, resolution: 'USE_LOCAL' | 'USE_SERVER'): Promise<void> => {
    const { syncQueue } = get();
    const item = syncQueue.find((q) => q.id === queueId);
    if (!item) {
      throw new Error(`Konflikt mit ID ${queueId} nicht in der lokalen Warteschlange gefunden.`);
    }

    try {
      const response = await apiClient.post<ConflictResolutionResult>('/sync/conflicts/resolve', {
        clientUuid: item.id,
        entityType: item.entityType,
        strategy: resolution,
        expectedVersion: item.conflictDetails?.serverVersion || 1,
        localPayload: item.payload
      });

      if (!response || response.applied !== true || !response.serverState) {
        throw new Error('Ungültige Serverantwort: Konflikt konnte serverseitig nicht bestätigt werden.');
      }

      const serverState = response.serverState;

      // Vollständige Übernahme aller Datenfelder in den lokalen Store
      if (item.entityType === 'task') {
        set((state) => ({
          tasks: state.tasks.map((t) =>
            t.id === serverState.id
              ? {
                  ...t,
                  title: serverState.title ?? t.title,
                  assignedToName: serverState.assigned_to_name ?? t.assignedToName,
                  siteName: serverState.site_name ?? t.siteName,
                  dueDate: serverState.due_date ? String(serverState.due_date).slice(0, 10) : t.dueDate,
                  priority: serverState.priority ?? t.priority,
                  status: serverState.status ?? t.status,
                  category: serverState.category ?? t.category,
                  revisionVersion: serverState.revision_version ?? t.revisionVersion
                }
              : t
          )
        }));
      } else if (item.entityType === 'shift') {
        set((state) => ({
          shifts: state.shifts.map((s) =>
            s.id === serverState.id
              ? {
                  ...s,
                  siteId: serverState.site_id ?? s.siteId,
                  employeeId: serverState.employee_id ?? s.employeeId,
                  date: serverState.shift_date ? String(serverState.shift_date).slice(0, 10) : s.date,
                  startTime: serverState.start_time ?? s.startTime,
                  endTime: serverState.end_time ?? s.endTime,
                  type: serverState.type ?? s.type,
                  status: serverState.status ?? s.status,
                  requiredQualification: serverState.required_qualification ?? s.requiredQualification,
                  conflictReason: serverState.conflict_reason ?? s.conflictReason,
                  revisionVersion: serverState.revision_version ?? s.revisionVersion
                }
              : s
          )
        }));
      } else if (item.entityType === 'key') {
        set((state) => ({
          keys: state.keys.map((k) =>
            k.id === serverState.id
              ? {
                  ...k,
                  keyNumber: serverState.key_number ?? k.keyNumber,
                  label: serverState.label ?? k.label,
                  status: serverState.status ?? k.status,
                  currentHolderId: serverState.current_holder_id ?? k.currentHolderId,
                  issuedAt: serverState.issued_at ?? k.issuedAt,
                  expectedReturn: serverState.expected_return ?? k.expectedReturn,
                  revisionVersion: serverState.revision_version ?? k.revisionVersion
                }
              : k
          )
        }));
      } else if (item.entityType === 'guardbook') {
        set((state) => ({
          guardBook: state.guardBook.map((gb) =>
            gb.id === serverState.id
              ? {
                  ...gb,
                  stage: serverState.stage ?? gb.stage,
                  resolved: serverState.resolved ?? gb.resolved,
                  resolutionNote: serverState.resolution_note ?? gb.resolutionNote,
                  revisions: serverState.revisions ?? gb.revisions
                }
              : gb
          )
        }));
      }

      // Erst nach erfolgreicher Validierung und State-Aktualisierung aus der lokalen Outbox löschen!
      await offlineVault.markSynced(queueId);

      set((state) => ({
        syncQueue: state.syncQueue.filter((q) => q.id !== queueId)
      }));

      get().addNotification(
        'Konflikt aufgelöst',
        `Konflikt ${queueId} (${item.entityType}) wurde erfolgreich via ${resolution} aufgelöst und synchronisiert.`,
        'info'
      );
    } catch (err: any) {
      console.error('[CONFLICT RESOLUTION FAILED]', err);
      get().addNotification(
        'Fehler bei Konfliktauflösung',
        `Server konnte Konflikt nicht auflösen: ${err?.message || 'Netzwerkfehler'}. Eintrag bleibt in Outbox erhalten.`,
        'alert'
      );
      throw err;
    }
  },

  clearCompletedSyncs: () => {
    set((state) => ({
      syncQueue: state.syncQueue.filter((q) => q.status !== 'synced')
    }));
  },

  modules: initialModules,
  toggleModule: (moduleId) => {
    set((state) => ({
      modules: state.modules.map((m) =>
        m.id === moduleId && !m.isCore ? { ...m, enabled: !m.enabled } : m
      )
    }));
  },
  isModuleActive: (moduleId) => {
    const mod = get().modules.find((m) => m.id === moduleId);
    return mod ? mod.enabled : true;
  },

  auditLogs: initialAuditLogs,
  activeSessions: initialActiveSessions,
  gdprPolicies: initialGdprPolicies,

  revokeSession: (sessionId: string) => {
    set((state) => ({
      activeSessions: state.activeSessions.map((s) =>
        s.id === sessionId ? { ...s, status: 'REVOKED' } : s
      )
    }));
  },

  addAuditLog: (entry) => {
    const newAudit: SecurityAuditEntry = {
      ...entry,
      id: `audit-${Date.now()}`,
      timestamp: new Date().toISOString().replace('T', ' ').substring(0, 19),
      tenantId: get().currentTenantId
    };
    set((state) => ({ auditLogs: [newAudit, ...state.auditLogs] }));
  },

  notifications: [
    {
      id: 'n-1',
      title: 'Ablaufender Nachweis',
      message: 'Erste-Hilfe-Nachweis von Tarkan Kaya ist abgelaufen. Nachzertifizierung erforderlich.',
      type: 'warning',
      time: 'Vor 15 Min.'
    }
  ],

  notificationDeliveries: initialNotificationDeliveries,
  notificationPreferences: initialNotificationPreferences,

  dismissNotification: (id) =>
    set((state) => ({ notifications: state.notifications.filter((n) => n.id !== id) })),

  addNotification: (title, message, type) => {
    set((state) => ({
      notifications: [
        { id: `notif-${Date.now()}`, title, message, type, time: 'Gerade eben' },
        ...state.notifications
      ]
    }));
  },

  markNotificationAsRead: (deliveryId) => {
    set((state) => ({
      notificationDeliveries: state.notificationDeliveries.map((nd) =>
        nd.id === deliveryId ? { ...nd, read: true } : nd
      )
    }));
  },

  updateNotificationPreferences: (prefs) => {
    set((state) => ({
      notificationPreferences: { ...state.notificationPreferences, ...prefs }
    }));
  },

  automations: initialAutomations,
  automationTemplates: initialAutomationTemplates,
  executionLogs: initialExecutionLogs,

  addAutomationRule: (rule) => {
    const newRule: AutomationRule = {
      ...rule,
      id: `rule-${Date.now()}`,
      tenantId: get().currentTenantId,
      actionsTriggeredCount: 0
    };
    set((state) => ({ automations: [newRule, ...state.automations] }));
  },

  updateAutomationRule: (id, updates) => {
    set((state) => ({
      automations: state.automations.map((a) => (a.id === id ? { ...a, ...updates } : a))
    }));
  },

  deleteAutomationRule: (id) => {
    set((state) => ({
      automations: state.automations.filter((a) => a.id !== id)
    }));
  },

  duplicateAutomationRule: (id) => {
    const existing = get().automations.find((a) => a.id === id);
    if (!existing) return;
    const duplicated: AutomationRule = {
      ...existing,
      id: `rule-${Date.now()}`,
      name: `${existing.name} (Kopie)`,
      actionsTriggeredCount: 0
    };
    set((state) => ({ automations: [duplicated, ...state.automations] }));
  },

  toggleAutomationRule: (id) => {
    set((state) => ({
      automations: state.automations.map((a) =>
        a.id === id ? { ...a, active: !a.active } : a
      )
    }));
  },

  testRunRule: (id) => {
    const rule = get().automations.find((a) => a.id === id);
    if (!rule) return { matched: false, actions: [], durationMs: 0 };
    return { matched: true, actions: rule.actions.map((a: any) => a.type), durationMs: 25 };
  },

  runAutomationsNow: () => {
    return 2;
  },

  clients: initialClients,
  sites: initialSites,
  employees: initialEmployees,
  shifts: initialShifts,
  guardBook: initialGuardBookEntries,
  sops: [],
  alarmTypes: [],
  alarmSites: [],
  pendingSOPAcknowledgements: [],
  emergencyPlans: initialEmergencyPlans,
  alarmIncidents: [],
  alarmIncidentFilterQuery: '',
  alarmIncidentNextCursor: null,
  hasMoreAlarmIncidents: false,
  isLoadingMoreAlarmIncidents: false,
  pendingAlarmMutations: [],
  keys: initialKeys,
  tasks: initialTasks,
  documents: [],
  setDocuments: (documents) => set({ documents }),
  patrolScans: [],
  shiftHandovers: [],

  getTenantClients: () => {
    const { clients, currentTenantId } = get();
    return clients.filter((c) => c.tenantId === currentTenantId);
  },
  getTenantSites: () => {
    const { sites, currentTenantId } = get();
    return sites.filter((s) => s.tenantId === currentTenantId);
  },
  getTenantEmployees: () => {
    const { employees, currentTenantId } = get();
    return employees.filter((e) => e.tenantId === currentTenantId);
  },
  getTenantShifts: () => {
    const { shifts, currentTenantId } = get();
    return shifts.filter((sh) => sh.tenantId === currentTenantId);
  },
  getTenantGuardBook: () => {
    const { guardBook, currentTenantId } = get();
    return guardBook.filter((gb) => gb.tenantId === currentTenantId);
  },
  getTenantSOPs: () => {
    const { sops, currentTenantId } = get();
    return sops.filter((sop) => sop.tenantId === currentTenantId);
  },
  getTenantEmergencyPlans: () => {
    const { emergencyPlans, currentTenantId } = get();
    return emergencyPlans.filter((ep) => ep.tenantId === currentTenantId);
  },
  getTenantAlarmIncidents: () => {
    const { alarmIncidents, currentTenantId } = get();
    return alarmIncidents.filter((incident) => incident.tenantId === currentTenantId);
  },
  getTenantKeys: () => {
    const { keys, currentTenantId } = get();
    return keys.filter((k) => k.tenantId === currentTenantId);
  },
  getTenantTasks: () => {
    const { tasks, currentTenantId } = get();
    return tasks.filter((t) => t.tenantId === currentTenantId);
  },
  getTenantDocuments: () => {
    const { documents, authUser } = get();
    const trustedTenantId = authUser?.tenantId;
    return trustedTenantId ? documents.filter((d) => d.tenantId === trustedTenantId) : [];
  },
  getTenantPatrolScans: () => {
    const { patrolScans, currentTenantId } = get();
    return patrolScans.filter((scan) => scan.tenantId === currentTenantId);
  },
  getTenantShiftHandovers: () => {
    const { shiftHandovers, currentTenantId } = get();
    return shiftHandovers.filter((handover) => handover.tenantId === currentTenantId);
  },
  getTenantAutomations: () => {
    const { automations, currentTenantId } = get();
    return automations.filter((a) => !a.tenantId || a.tenantId === currentTenantId);
  },
  getTenantAuditLogs: () => {
    const { auditLogs, currentTenantId } = get();
    return (auditLogs || []).filter((a) => a.tenantId === currentTenantId);
  },
  getTenantExecutionLogs: () => {
    const { executionLogs, currentTenantId } = get();
    return (executionLogs || []).filter((l) => l.tenantId === currentTenantId);
  },
  getTenantNotificationDeliveries: () => {
    const { notificationDeliveries, currentTenantId } = get();
    return (notificationDeliveries || []).filter((nd) => nd.tenantId === currentTenantId);
  },

  addClient: async (c) => {
    const { currentTenantId } = get();

    if (!get().isOnline) {
      const id = crypto.randomUUID();
      await get().enqueueOfflineAction({ tenantId: currentTenantId, entityType: 'client' as any, action: 'CREATE', payload: { id, ...c }, baseVersion: 1 });
      set((state) => ({ clients: [mapClientRow({ id, ...c, revision_version: 1 }, currentTenantId), ...state.clients] }));
      return;
    }

    try {
      const created = await apiClient.post<any>('/customers', {
        clientNumber: c.clientNumber,
        companyName: c.companyName,
        contactPerson: c.contactPerson,
        email: c.email,
        phone: c.phone,
        address: c.address,
        contractStart: c.contractStart,
        contractEnd: c.contractEnd,
        slaLevel: c.slaLevel
      });

      const newClient = mapClientRow(
        {
          ...created,
          client_number: c.clientNumber,
          company_name: c.companyName,
          contact_person: c.contactPerson,
          email: c.email,
          phone: c.phone,
          address: c.address,
          contract_start: c.contractStart,
          contract_end: c.contractEnd,
          sla_level: c.slaLevel,
          billing_status: c.billingStatus
        },
        currentTenantId
      );

      set((state) => ({ clients: [newClient, ...state.clients] }));
      get().addNotification(
        'Kunde gespeichert',
        `${c.companyName} wurde in PostgreSQL gespeichert.`,
        'info'
      );
    } catch (error: any) {
      get().addNotification(
        'Kunde nicht gespeichert',
        error?.message || 'Die API-Anfrage ist fehlgeschlagen. Es wurde nichts gespeichert.',
        'alert'
      );
    }
  },

  updateClient: async (id, updates) => {
    const client = get().clients.find((c) => c.id === id);
    if (!client) return;
    const revisionVersion = client.revisionVersion || 1;
    try {
      if (!get().isOnline) throw new Error('offline');
      const saved = await apiClient.patch<any>(`/customers/${id}`, { ...updates, revisionVersion });
      set((s) => ({ clients: s.clients.map((c) => c.id === id ? mapClientRow(saved, c.tenantId) : c) }));
    } catch (error: any) {
      if (get().isOnline) { get().addNotification('Kunde nicht gespeichert', error?.message || 'Änderung fehlgeschlagen.', 'alert'); return; }
      await get().enqueueOfflineAction({ tenantId: client.tenantId, entityType: 'client' as any, action: 'UPDATE', payload: { id, ...updates }, baseVersion: revisionVersion });
      set((s) => ({ clients: s.clients.map((c) => c.id === id ? { ...c, ...updates } : c) }));
    }
  },

  archiveClient: async (id) => {
    const client = get().clients.find((c) => c.id === id);
    if (!client) return;
    const revisionVersion = client.revisionVersion || 1;
    try {
      if (!get().isOnline) throw new Error('offline');
      await apiClient.post(`/customers/${id}/archive`, { revisionVersion });
      set((s) => ({ clients: s.clients.filter((c) => c.id !== id) }));
    } catch (error: any) {
      if (get().isOnline) { get().addNotification('Kunde nicht archiviert', error?.message || 'Archivierung fehlgeschlagen.', 'alert'); return; }
      await get().enqueueOfflineAction({ tenantId: client.tenantId, entityType: 'client' as any, action: 'DELETE', payload: { id }, baseVersion: revisionVersion });
      set((s) => ({ clients: s.clients.filter((c) => c.id !== id) }));
    }
  },

  addSite: async (s) => {
    const { currentTenantId } = get();

    try {
      const payload = {
        clientId: s.clientId,
        siteCode: s.siteCode,
        name: s.name,
        address: s.address,
        securityLevel: s.securityLevel,
        requiredGuardsDay: s.requiredGuardsDay,
        requiredGuardsNight: s.requiredGuardsNight,
        alarmSystem: s.alarmSystem,
        accessRules: s.accessRules
      };
      if (!get().isOnline) {
        const id = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `site-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        await get().enqueueOfflineAction({ tenantId: currentTenantId, entityType: 'site', action: 'CREATE', payload: { id, ...payload }, baseVersion: 1 });
        set(state => ({ sites: [mapSiteRow({ id, ...payload, client_name: s.clientName }, currentTenantId), ...state.sites] }));
        get().addNotification('Objekt vorgemerkt', `${s.name} wird bei Verbindung synchronisiert.`, 'info'); return;
      }
      const created = await apiClient.post<any>('/sites', payload);

      const newSite = mapSiteRow(
        {
          ...created,
          client_name: s.clientName,
          site_code: s.siteCode,
          name: s.name,
          address: s.address,
          security_level: s.securityLevel,
          required_guards_day: s.requiredGuardsDay,
          required_guards_night: s.requiredGuardsNight,
          alarm_system: s.alarmSystem,
          access_rules: s.accessRules
        },
        currentTenantId
      );

      set((state) => ({ sites: [newSite, ...state.sites] }));
      get().addNotification('Objekt gespeichert', `${s.name} wurde in PostgreSQL gespeichert.`, 'info');
    } catch (error: any) {
      get().addNotification(
        'Objekt nicht gespeichert',
        error?.message || 'Die API-Anfrage ist fehlgeschlagen. Es wurde nichts gespeichert.',
        'alert'
      );
    }
  },

  updateSite: async (id, updates) => {
    const site = get().sites.find(s => s.id === id); if (!site) return;
    const revisionVersion = site.revisionVersion || 1;
    const changes = { clientId: updates.clientId ?? site.clientId, siteCode: updates.siteCode ?? site.siteCode, name: updates.name ?? site.name, address: updates.address ?? site.address, securityLevel: updates.securityLevel ?? site.securityLevel };
    try {
      if (!get().isOnline) throw new Error('offline');
      const result = await apiClient.patch<any>(`/sites/${id}`, { ...changes, revisionVersion });
      const updated = mapSiteRow({ ...result, client_name: get().clients.find(c=>c.id===changes.clientId)?.companyName, ...changes, revision_version: result.revision_version }, site.tenantId);
      set(state => ({ sites: state.sites.map(s => s.id === id ? updated : s) }));
      get().addNotification('Objekt aktualisiert', `${site.name} wurde gespeichert.`, 'info');
    } catch (error: any) {
      if (get().isOnline) { get().addNotification(error?.status === 409 ? 'Versionskonflikt' : 'Objekt nicht gespeichert', error?.message || 'Änderung fehlgeschlagen.', 'alert'); return; }
      await get().enqueueOfflineAction({ tenantId: site.tenantId, entityType: 'site', action: 'UPDATE', payload: { id, ...changes }, baseVersion: revisionVersion });
      set(state => ({ sites: state.sites.map(s => s.id === id ? { ...s, ...changes, revisionVersion: revisionVersion + 1 } : s) }));
    }
  },

  archiveSite: async (id) => {
    const site = get().sites.find(s=>s.id===id); if (!site) return;
    const revisionVersion = site.revisionVersion || 1;
    try { if (!get().isOnline) throw new Error('offline');
      const result = await apiClient.post<any>(`/sites/${id}/archive`, { revisionVersion });
      set(state => ({ sites: state.sites.map(s => s.id === id ? { ...s, archivedAt: result.archived_at, revisionVersion: result.revision_version } : s) }));
      get().addNotification('Standort archiviert', `${site.name} wurde archiviert. Verknüpfte Einsatzdaten bleiben erhalten.`, 'info');
    } catch (error: any) { if (get().isOnline) { get().addNotification(error?.status === 409 ? 'Versionskonflikt' : 'Archivierung fehlgeschlagen', error?.message || 'Objekt nicht archiviert.', 'alert'); return; }
      await get().enqueueOfflineAction({ tenantId: site.tenantId, entityType: 'site', action: 'DELETE', payload: { id }, baseVersion: revisionVersion });
      set(state => ({ sites: state.sites.map(s => s.id === id ? { ...s, archivedAt: new Date().toISOString(), revisionVersion: revisionVersion + 1 } : s) }));
    }
  },

  restoreSite: async (id) => {
    const site = get().sites.find(s=>s.id===id); if (!site) return;
    const revisionVersion = site.revisionVersion || 1;
    try { if (!get().isOnline) throw new Error('offline');
      const result = await apiClient.post<any>(`/sites/${id}/restore`, { revisionVersion });
      set(state => ({ sites: state.sites.map(s => s.id === id ? { ...s, archivedAt: null, revisionVersion: result.revision_version } : s) }));
      get().addNotification('Standort wiederhergestellt', `${site.name} ist wieder aktiv.`, 'info');
    } catch (error: any) { if (get().isOnline) { get().addNotification(error?.status === 409 ? 'Versionskonflikt' : 'Wiederherstellung fehlgeschlagen', error?.message || 'Objekt nicht wiederhergestellt.', 'alert'); return; }
      await get().enqueueOfflineAction({ tenantId: site.tenantId, entityType: 'site', action: 'RESTORE', payload: { id }, baseVersion: revisionVersion });
      set(state => ({ sites: state.sites.map(s => s.id === id ? { ...s, archivedAt: null, revisionVersion: revisionVersion + 1 } : s) }));
    }
  },

  addEmployee: async (e) => {
    const { currentTenantId } = get();

    try {
      const id = newMutationEntityId();
      const payload = {
        personnelNumber: e.personnelNumber,
        firstName: e.firstName,
        lastName: e.lastName,
        email: e.email,
        phone: e.phone,
        role: String(e.role),
        status: e.status,
        weeklyHours: e.weeklyHours,
        hourlyRate: e.hourlyRate,
        dateOfJoining: e.dateOfJoining,
        assignedSiteIds: e.assignedSiteIds || []
      };
      if (!get().isOnline) {
        await get().enqueueOfflineAction({ tenantId: currentTenantId, entityType: 'employee', action: 'CREATE', payload: { id, ...payload }, baseVersion: 1 });
        set(state => ({ employees: [{ ...e, id, tenantId: currentTenantId, revisionVersion: 1, archivedAt: null, synced: false }, ...state.employees] }));
        for (const q of e.qualifications || []) await get().addQualification(id, q);
        get().addNotification('Mitarbeiter vorgemerkt', `${e.firstName} ${e.lastName} wird nach der Verbindung synchronisiert.`, 'info'); return;
      }
      const created = await apiClient.post<any>('/employees', payload);

      const newEmp = mapEmployeeRow(
        {
          ...created,
          personnel_number: e.personnelNumber,
          first_name: e.firstName,
          last_name: e.lastName,
          email: e.email,
          phone: e.phone,
          role: String(e.role),
          status: e.status,
          weekly_hours: e.weeklyHours,
          hourly_rate: e.hourlyRate,
          date_of_joining: e.dateOfJoining
        },
        currentTenantId
      );

      set((state) => ({ employees: [newEmp, ...state.employees] }));
      for (const q of e.qualifications || []) await get().addQualification(newEmp.id, q);
      get().addNotification(
        'Mitarbeiter gespeichert',
        `${e.firstName} ${e.lastName} wurde in PostgreSQL gespeichert.`,
        'info'
      );
    } catch (error: any) {
      get().addNotification(
        'Mitarbeiter nicht gespeichert',
        error?.message || 'Die API-Anfrage ist fehlgeschlagen. Es wurde nichts gespeichert.',
        'alert'
      );
    }
  },

  updateEmployee: async (id, updates) => {
    const employee = get().employees.find(e => e.id === id); if (!employee) return;
    const payload: Record<string, unknown> = {};
    const allowed: Array<keyof Employee> = [
      'personnelNumber',
      'firstName',
      'lastName',
      'email',
      'phone',
      'role',
      'status',
      'weeklyHours',
      'hourlyRate',
      'dateOfJoining',
      'assignedSiteIds'
    ];

    for (const key of allowed) {
      const value = updates[key];
      if (value !== undefined) {
        payload[key as string] = key === 'role' ? String(value) : value;
      }
    }

    const revisionVersion = employee.revisionVersion || 1;
    try {
      if (!get().isOnline) throw new Error('offline');
      const updated = await apiClient.patch<any>(`/employees/${id}`, { ...payload, revisionVersion });
      set((state) => ({
        employees: state.employees.map((emp) =>
          emp.id === id ? { ...emp, ...updates, revisionVersion: updated.revision_version, synced: true } : emp
        )
      }));
      get().addNotification('Mitarbeiter aktualisiert', 'Die Änderung wurde in PostgreSQL gespeichert.', 'info');
    } catch (error: any) {
      if (!get().isOnline) {
        await get().enqueueOfflineAction({ tenantId: employee.tenantId, entityType: 'employee', action: 'UPDATE', payload: { id, ...payload }, baseVersion: revisionVersion });
        set(state => ({ employees: state.employees.map(emp => emp.id === id ? { ...emp, ...updates, revisionVersion: revisionVersion + 1, synced: false } : emp) })); return;
      }
      get().addNotification(
        error?.status === 409 ? 'Versionskonflikt beim Mitarbeiter' : 'Mitarbeiter nicht aktualisiert',
        error?.message || 'Die API-Anfrage ist fehlgeschlagen. Es wurde nichts gespeichert.',
        'alert'
      );
    }
  },

  archiveEmployee: async (id) => {
    const employee=get().employees.find(e=>e.id===id);if(!employee)return;const revisionVersion=employee.revisionVersion||1;
    try{if(!get().isOnline)throw new Error('offline');const result=await apiClient.post<any>(`/employees/${id}/archive`,{revisionVersion});set(s=>({employees:s.employees.map(e=>e.id===id?{...e,archivedAt:result.archived_at,revisionVersion:result.revision_version}:e)}));get().addNotification('Mitarbeiter archiviert','Stammdaten und Einsatzbezüge bleiben erhalten.','info');}
    catch(error:any){if(!get().isOnline){await get().enqueueOfflineAction({tenantId:employee.tenantId,entityType:'employee',action:'DELETE',payload:{id},baseVersion:revisionVersion});set(s=>({employees:s.employees.map(e=>e.id===id?{...e,archivedAt:new Date().toISOString(),revisionVersion:revisionVersion+1}:e)}));return;}get().addNotification(error?.status===409?'Versionskonflikt':'Archivierung fehlgeschlagen',error?.message||'Mitarbeiter nicht archiviert.','alert');}
  },
  restoreEmployee: async (id) => {
    const employee=get().employees.find(e=>e.id===id);if(!employee)return;const revisionVersion=employee.revisionVersion||1;
    try{if(!get().isOnline)throw new Error('offline');const result=await apiClient.post<any>(`/employees/${id}/restore`,{revisionVersion});set(s=>({employees:s.employees.map(e=>e.id===id?{...e,archivedAt:null,revisionVersion:result.revision_version}:e)}));get().addNotification('Mitarbeiter wiederhergestellt','Der Mitarbeiter ist wieder aktiv.','info');}
    catch(error:any){if(!get().isOnline){await get().enqueueOfflineAction({tenantId:employee.tenantId,entityType:'employee',action:'RESTORE',payload:{id},baseVersion:revisionVersion});set(s=>({employees:s.employees.map(e=>e.id===id?{...e,archivedAt:null,revisionVersion:revisionVersion+1}:e)}));return;}get().addNotification(error?.status===409?'Versionskonflikt':'Wiederherstellung fehlgeschlagen',error?.message||'Mitarbeiter nicht wiederhergestellt.','alert');}
  },
  addQualification: async (employeeId, qualification) => {
    const employee=get().employees.find(e=>e.id===employeeId);if(!employee)return;const id=newMutationEntityId();const payload={id,employeeId,type:qualification.type,certificateNumber:qualification.certificateNumber,issueDate:qualification.issueDate||null,expiryDate:qualification.expiryDate||null,verified:qualification.verified,documentReference:qualification.documentReference||null};
    try{if(!get().isOnline)throw new Error('offline');const result=await apiClient.post<any>(`/employees/${employeeId}/qualifications`,{type:payload.type,certificateNumber:payload.certificateNumber,issueDate:payload.issueDate,expiryDate:payload.expiryDate,verified:payload.verified,documentReference:payload.documentReference});const q={...qualification,id:result.id,status:qualificationStatus(result.status),revisionVersion:result.revision_version};set(s=>({employees:s.employees.map(e=>e.id===employeeId?{...e,qualifications:[q,...e.qualifications]}:e)}));}
    catch(error:any){if(!get().isOnline){await get().enqueueOfflineAction({tenantId:employee.tenantId,entityType:'employee',action:'QUALIFICATION_CREATE',payload,baseVersion:1});set(s=>({employees:s.employees.map(e=>e.id===employeeId?{...e,qualifications:[{...qualification,id,status:qualification.verified?'GÜLTIG':'AUSSTEHEND',revisionVersion:1},...e.qualifications]}:e)}));return;}get().addNotification('Qualifikation nicht gespeichert',error?.message||'Speichern fehlgeschlagen.','alert');}
  },
  updateQualification: async (employeeId, qualificationId, changes) => {
    const employee=get().employees.find(e=>e.id===employeeId);const qualification=employee?.qualifications.find(q=>q.id===qualificationId);if(!employee||!qualification)return;const revisionVersion=qualification.revisionVersion||1;const payload={qualificationId,...changes};
    try{if(!get().isOnline)throw new Error('offline');const result=await apiClient.patch<any>(`/employees/${employeeId}/qualifications/${qualificationId}`,{...changes,revisionVersion});set(s=>({employees:s.employees.map(e=>e.id===employeeId?{...e,qualifications:e.qualifications.map(q=>q.id===qualificationId?{...q,...changes,status:qualificationStatus(result.status),revisionVersion:result.revision_version}:q)}:e)}));}
    catch(error:any){if(!get().isOnline){await get().enqueueOfflineAction({tenantId:employee.tenantId,entityType:'employee',action:'QUALIFICATION_UPDATE',payload:{id:qualificationId,...payload},baseVersion:revisionVersion});set(s=>({employees:s.employees.map(e=>e.id===employeeId?{...e,qualifications:e.qualifications.map(q=>q.id===qualificationId?{...q,...changes,revisionVersion:revisionVersion+1}:q)}:e)}));return;}get().addNotification(error?.status===409?'Versionskonflikt Qualifikation':'Qualifikation nicht aktualisiert',error?.message||'Änderung fehlgeschlagen.','alert');}
  },
  addAbsence: async (employeeId, absence) => {
    const employee=get().employees.find(e=>e.id===employeeId);if(!employee)return;const id=newMutationEntityId();const payload={id,employeeId,type:absence.type,startDate:absence.startDate,endDate:absence.endDate,notes:absence.notes};
    try{if(!get().isOnline)throw new Error('offline');const result=await apiClient.post<any>(`/employees/${employeeId}/absences`,{type:payload.type,startDate:payload.startDate,endDate:payload.endDate,notes:payload.notes});const record={id:result.id,type:absence.type,startDate:absence.startDate,endDate:absence.endDate,approved:false,status:'PENDING' as const,revisionVersion:result.revision_version,notes:absence.notes};set(s=>({employees:s.employees.map(e=>e.id===employeeId?{...e,absences:[record,...(e.absences||[])]}:e)}));get().addNotification('Abwesenheit beantragt','Der Antrag wartet auf Freigabe.','info');}
    catch(error:any){if(!get().isOnline){await get().enqueueOfflineAction({tenantId:employee.tenantId,entityType:'employee',action:'ABSENCE_CREATE',payload,baseVersion:1});set(s=>({employees:s.employees.map(e=>e.id===employeeId?{...e,absences:[{id,type:absence.type,startDate:absence.startDate,endDate:absence.endDate,approved:false,status:'PENDING',revisionVersion:1,notes:absence.notes},...(e.absences||[])]}:e)}));return;}get().addNotification(error?.status===409?'Abwesenheitskonflikt':'Abwesenheit nicht gespeichert',error?.message||'Antrag fehlgeschlagen.','alert');}
  },
  reviewAbsence: async (employeeId, absenceId, decision) => {
    const employee=get().employees.find(e=>e.id===employeeId);const absence=employee?.absences?.find(a=>a.id===absenceId);if(!employee||!absence)return;const revisionVersion=absence.revisionVersion||1;
    try{if(!get().isOnline)throw new Error('offline');const result=await apiClient.post<any>(`/employees/${employeeId}/absences/${absenceId}/review`,{revisionVersion,decision});set(s=>({employees:s.employees.map(e=>e.id===employeeId?{...e,absences:e.absences?.map(a=>a.id===absenceId?{...a,status:decision,approved:decision==='APPROVED',revisionVersion:result.revision_version}:a)}:e)}));}
    catch(error:any){if(!get().isOnline){await get().enqueueOfflineAction({tenantId:employee.tenantId,entityType:'employee',action:'ABSENCE_REVIEW',payload:{id:absenceId,absenceId,decision},baseVersion:revisionVersion});return;}get().addNotification(error?.status===409?'Abwesenheitskonflikt':'Freigabe fehlgeschlagen',error?.message||'Status nicht geändert.','alert');}
  },

  addShift: async (s) => {
    const { currentTenantId } = get();

    try {
      const created = await apiClient.post<any>('/shifts', {
        siteId: s.siteId,
        employeeId: s.employeeId ?? null,
        date: s.date,
        startTime: s.startTime,
        endTime: s.endTime,
        type: s.type,
        status: s.status,
        requiredQualification: String(s.requiredQualification),
        conflictReason: s.conflictReason ?? null
      });

      const newShift = mapShiftRow(
        {
          ...created,
          site_name: s.siteName,
          employee_name: s.employeeName,
          shift_date: s.date,
          start_time: s.startTime,
          end_time: s.endTime,
          type: s.type,
          status: s.status,
          required_qualification: String(s.requiredQualification),
          conflict_reason: s.conflictReason
        },
        currentTenantId
      );

      set((state) => ({ shifts: [newShift, ...state.shifts] }));
      get().addNotification('Schicht gespeichert', 'Die Schicht wurde in PostgreSQL gespeichert.', 'info');
    } catch (error: any) {
      get().addNotification(
        'Schicht nicht gespeichert',
        error?.message || 'Die API-Anfrage ist fehlgeschlagen. Es wurde nichts gespeichert.',
        'alert'
      );
    }
  },

  assignShiftEmployee: async (shiftId, employeeId, employeeName) => {
    const { employees } = get();
    const emp = employees.find((e) => e.id === employeeId);

    let conflictReason: string | undefined = undefined;
    let status: Shift['status'] = 'Besetzt';

    if (emp && (emp.status === 'Krank' || emp.status === 'Urlaub')) {
      status = 'Konflikt';
      conflictReason = `Mitarbeiter hat Status ${emp.status}! Nicht disponierbar.`;
    }

    try {
      await apiClient.patch(`/shifts/${shiftId}`, {
        employeeId,
        status,
        conflictReason: conflictReason ?? null
      });

      set((state) => ({
        shifts: state.shifts.map((sh) =>
          sh.id === shiftId
            ? {
                ...sh,
                employeeId,
                employeeName,
                status,
                conflictReason
              }
            : sh
        )
      }));
      get().addNotification('Schichtzuweisung gespeichert', 'Die Zuweisung wurde in PostgreSQL gespeichert.', 'info');
    } catch (error: any) {
      get().addNotification(
        'Schichtzuweisung nicht gespeichert',
        error?.message || 'Die API-Anfrage ist fehlgeschlagen.',
        'alert'
      );
    }
  },

  addPatrolScan: async (scan) => {
    const { currentTenantId, isOnline, patrolScans } = get();
    const scannedAt = new Date().toISOString();
    const id = crypto.randomUUID();
    const { checkpointToken, ...displayScan } = scan;
    const record: PatrolScanEvent = { ...displayScan, id, tenantId: currentTenantId, scannedAt, offlineCaptured: !isOnline };
    const queuedPatrol = await offlineVault.getOutbox(currentTenantId, 'patrol');
    const recentQueued = queuedPatrol.some(item => item.payload.checkpointId === scan.checkpointId &&
      Math.abs(Date.parse(scannedAt) - Date.parse(item.payload.scannedAt || item.occurredAt)) < 2 * 60 * 1000);
    const recentLocal = patrolScans.some(item => item.checkpointId === scan.checkpointId &&
      Math.abs(Date.parse(scannedAt) - Date.parse(item.scannedAt)) < 2 * 60 * 1000);
    if (recentQueued || recentLocal) {
      throw new Error('Dieser Kontrollpunkt wurde innerhalb des Zwei-Minuten-Fensters bereits erfasst.');
    }
    await get().enqueueOfflineAction({
      tenantId: currentTenantId,
      entityType: 'patrol',
      action: 'CREATE',
      payload: {
        recordType: 'scan',
        siteId: scan.siteId,
        checkpointId: scan.checkpointId,
        method: scan.method,
        checkpointToken,
        checkpointTokenVersion: scan.checkpointTokenVersion,
        roundId: scan.roundId,
        notes: scan.notes,
        scannedAt
      }
    });
    set((state) => ({ patrolScans: [record, ...state.patrolScans] }));
    if (isOnline) void get().triggerManualSync();
  },

  submitShiftHandover: async (handover) => {
    const { currentTenantId, isOnline } = get();
    const handoverTime = new Date().toISOString();
    const id = crypto.randomUUID();
    const record: ShiftHandoverProtocol = { ...handover, id, tenantId: currentTenantId, handoverTime, offlineCaptured: !isOnline };
    await get().enqueueOfflineAction({ tenantId: currentTenantId, entityType: 'handover', action: 'CREATE', payload: record });
    set((state) => ({ shiftHandovers: [record, ...state.shiftHandovers] }));
    if (isOnline) void get().triggerManualSync();
  },

  addGuardBookEntry: async (entry) => {
    const { currentTenantId, isOnline, enqueueOfflineAction, addTask, addNotification, addAuditLog } = get();
    const entryId = `gb-${Date.now()}`;
    const newEntry: GuardBookEntry = {
      ...entry,
      id: entryId,
      tenantId: currentTenantId,
      timestamp: new Date().toISOString(),
      stage: entry.stage || 'Erfasst',
      offlineCreated: !isOnline,
      revisions: [
        {
          id: `rev-${Date.now()}`,
          timestamp: new Date().toISOString(),
          authorName: entry.guardName,
          note: 'Ersterfassung im digitalen Wachbuch'
        }
      ]
    };

    await enqueueOfflineAction({
      tenantId: currentTenantId,
      entityType: 'guardbook',
      action: 'CREATE',
      payload: newEntry
    });

    if (entry.priority === 'Kritisch' || entry.priority === 'Dringend') {
      const taskId = `t-inc-${Date.now()}`;
      newEntry.createdTaskId = taskId;
      addTask({
        title: `Vorfallsbearbeitung: ${entry.title}`,
        assignedToName: entry.assignedManagerName || 'Objektleiter / Einsatzleiter',
        siteName: entry.siteName,
        sourceModule: 'Wachbuch',
        sourceEntityId: entryId,
        dueDate: new Date(Date.now() + 1000 * 3600 * 24 * 2).toISOString().split('T')[0],
        priority: entry.priority === 'Kritisch' ? 'Hoch' : 'Mittel',
        status: 'Offen',
        category: 'Vorfallsbearbeitung'
      });

      addNotification(
        `Aufgabe für Vorfall erzeugt`,
        `Automatisierte Maßnahme für "${entry.title}" (${entry.siteName}) an Objektleiter zugewiesen.`,
        'warning'
      );
    }

    set((state) => ({
      guardBook: [newEntry, ...state.guardBook]
    }));

    addAuditLog({
      actorEmail: 'guard@secops.local',
      actorRole: 'Wachdienstmitarbeiter',
      actionType: 'INCIDENT_MOD',
      severity: entry.priority === 'Kritisch' ? 'ALARM' : 'INFO',
      targetEntity: `Logbook ${entryId}`,
      details: `Neuer Wachbucheintrag "${entry.title}" am Objekt ${entry.siteName} erfasst.`,
      ipAddress: '194.25.101.44'
    });

    if (isOnline) {
      get().triggerManualSync().catch(console.error);
    }
  },

  updateGuardBookStage: (id, stage, note) => {
    const { currentUserName } = get();
    set((state) => ({
      guardBook: state.guardBook.map((item) => {
        if (item.id === id) {
          const newRevisions = item.revisions ? [...item.revisions] : [];
          if (note) {
            newRevisions.push({
              id: `rev-${Date.now()}`,
              timestamp: new Date().toISOString(),
              authorName: currentUserName,
              note: `Statusänderung zu "${stage}": ${note}`
            });
          }
          return {
            ...item,
            stage,
            resolved: stage === 'Abgeschlossen' || stage === 'Archiviert',
            resolutionNote: note || item.resolutionNote,
            revisions: newRevisions
          };
        }
        return item;
      })
    }));
  },

  resolveGuardBookEntry: (id, note) => {
    get().updateGuardBookStage(id, 'Abgeschlossen', note);
  },

  acknowledgeSOP: async (sopId) => {
    const state = get();
    const identity = currentSOPIdentity(state);
    const sop = state.sops.find((item) => item.id === sopId);
    if (!sop || sop.currentUserAcknowledgment === 'confirmed') return false;
    if (!identity.tenantId || !identity.userId || sop.tenantId !== identity.tenantId) {
      get().addNotification('Kenntnisnahme nicht gespeichert', 'Die Sitzung passt nicht zum Mandanten dieser Dienstanweisung.', 'alert');
      return false;
    }
    if (!sop.assignmentId) {
      get().addNotification('Keine Zuweisung gefunden', 'Für diese Dienstanweisung ist keine persönliche Kenntnisnahme-Zuweisung verfügbar.', 'alert');
      return false;
    }
    if (!sop.versionId) {
      get().addNotification('Kenntnisnahme nicht gespeichert', 'Die exakte SOP-Version ist nicht verfügbar.', 'alert');
      return false;
    }

    try {
      const { acknowledgement, created } = await offlineVault.enqueueSOPAcknowledgement({
        tenantId: identity.tenantId,
        userId: identity.userId,
        sopId,
        assignmentId: sop.assignmentId,
        versionId: sop.versionId,
        version: sop.version,
        clientMutationId: newMutationEntityId(),
        capturedAt: new Date().toISOString(),
        status: 'pending'
      });
      if (acknowledgement.status === 'stale') {
        get().addNotification('Kenntnisnahme veraltet', 'Diese Version wurde bereits als veraltet erkannt und wird nicht erneut übertragen.', 'warning');
        return false;
      }
      const pendingAck: SOPPendingAcknowledgement = { ...acknowledgement, status: 'pending' };
      if (!isCurrentSOPIdentity(identity.tenantId, identity.userId)) return true;
      set((current) => ({
        pendingSOPAcknowledgements: [
          ...current.pendingSOPAcknowledgements.filter((ack) => ack.clientMutationId !== pendingAck.clientMutationId),
          pendingAck
        ],
        sops: current.sops.map((item) => item.id === sopId && matchesPendingSOPRevision(item, pendingAck)
          ? { ...item, currentUserAcknowledgment: 'pending', acknowledgedAt: pendingAck.capturedAt }
          : item)
      }));

      if (get().isOnline && !(typeof navigator !== 'undefined' && navigator.onLine === false)) {
        await get().syncPendingSOPAcknowledgements();
      }
      const currentSOP = get().sops.find((item) => item.id === sopId);
      if (currentSOP?.currentUserAcknowledgment === 'confirmed') {
        get().addNotification('Kenntnisnahme bestätigt', 'Die Bestätigung wurde vom Server gespeichert.', 'info');
      } else {
        get().addNotification(
          created ? 'Kenntnisnahme vorgemerkt' : 'Kenntnisnahme weiterhin vorgemerkt',
          'Dauerhaft lokal gespeichert; die Übertragung wird bei verfügbarer Verbindung mit derselben Kennung wiederholt.',
          'warning'
        );
      }
      return true;
    } catch (error) {
      get().addNotification('Kenntnisnahme nicht gespeichert', errorText(error), 'alert');
      return false;
    }
  },

  syncPendingSOPAcknowledgements: async () => {
    if (!get().isOnline || (typeof navigator !== 'undefined' && navigator.onLine === false)) return;
    const permissions = get().authUser?.permissions || [];
    if (!permissions.includes('sop:read') && !permissions.includes('sop:manage')) return;
    if (isSOPSyncRunning) return;
    const identity = currentSOPIdentity(get());
    if (!identity.tenantId || !identity.userId) return;
    isSOPSyncRunning = true;
    try {
      await migrateLegacySOPAcknowledgements(identity.tenantId, identity.userId);
      const pending = await offlineVault.getSOPAcknowledgements(identity.tenantId, identity.userId);
      if (!isCurrentSOPIdentity(identity.tenantId, identity.userId) || !pending.length) return;
      const rows = await apiClient.get<any[]>('/sops');
      const latestSOPs = rows.map((row) => mapSOPRow(row, identity.tenantId));
      if (!isCurrentSOPIdentity(identity.tenantId, identity.userId)) return;
      for (const ack of pending) {
        if (ack.tenantId !== identity.tenantId || ack.userId !== identity.userId) continue;
        if (ack.status === 'stale') continue;
        const latestSOP = latestSOPs.find((sop) => sop.id === ack.sopId);
        const currentSOP = get().sops.find((sop) => sop.id === ack.sopId);
        if (!matchesPendingSOPRevision(latestSOP, ack) || !matchesPendingSOPRevision(currentSOP, ack)) {
          await offlineVault.updateSOPAcknowledgement(ack.clientMutationId, 'stale').catch(() => undefined);
          if (!isCurrentSOPIdentity(identity.tenantId, identity.userId)) return;
          set((current) => ({
            pendingSOPAcknowledgements: current.pendingSOPAcknowledgements.map((entry) =>
              entry.clientMutationId === ack.clientMutationId ? { ...entry, status: 'stale' } : entry
            ),
            sops: current.sops.map((item) => item.id === ack.sopId
              ? { ...item, currentUserAcknowledgment: 'stale' }
              : item)
          }));
          continue;
        }
        if (!isCurrentSOPIdentity(identity.tenantId, identity.userId)) return;
        await apiClient.post(`/sops/assignments/${ack.assignmentId}/acknowledge`, {
          confirmed: true,
          clientMutationId: ack.clientMutationId,
          capturedAt: ack.capturedAt
        });
        await offlineVault.removeSOPAcknowledgement(ack.clientMutationId);
        if (!isCurrentSOPIdentity(identity.tenantId, identity.userId)) return;
        set((current) => ({
          pendingSOPAcknowledgements: current.pendingSOPAcknowledgements.filter(
            (entry) => entry.clientMutationId !== ack.clientMutationId
          ),
          sops: current.sops.map((item) => item.id === ack.sopId && matchesPendingSOPRevision(item, ack)
            ? { ...item, currentUserAcknowledgment: 'confirmed', acknowledgedAt: ack.capturedAt }
            : item)
        }));
      }
    } catch (error) {
      const now = Date.now();
      if (isCurrentSOPIdentity(identity.tenantId, identity.userId) &&
        now - lastSOPSyncFailureNoticeAt >= SOP_SYNC_FAILURE_NOTICE_COOLDOWN_MS) {
        lastSOPSyncFailureNoticeAt = now;
        get().addNotification(
          'SOP-Synchronisierung ausstehend',
          `Die lokal gespeicherte Kenntnisnahme bleibt für einen späteren Versuch erhalten. ${errorText(error)}`,
          'warning'
        );
      }
    } finally {
      isSOPSyncRunning = false;
    }
  },

  reportAlarmIncident: (payload) => submitAlarmMutation(set, get, 'incident_report', payload, '/alarms'),

  addAlarmAction: (incidentId, payload) => submitAlarmMutation(
    set, get, 'action_create', { ...payload, incidentId }, `/alarms/${incidentId}/actions`
  ),

  changeAlarmStatus: (incidentId, payload) => submitAlarmMutation(
    set, get, 'status_change', { ...payload, incidentId }, `/alarms/${incidentId}/transitions`
  ),

  syncPendingAlarmMutations: async () => {
    if (!get().isOnline || (typeof navigator !== 'undefined' && navigator.onLine === false) || isAlarmSyncRunning) return;
    const identity = currentSOPIdentity(get());
    if (!identity.tenantId || !identity.userId) return;
    if (!get().authUser?.permissions.includes('alarm:report')) return;
    isAlarmSyncRunning = true;
    try {
      const records = await offlineVault.getAlarmMutations(identity.tenantId, identity.userId);
      const pending = records.filter(record => record.status === 'pending').sort((left, right) => {
        const leftIsReport = left.type === 'incident_report' ? 0 : 1;
        const rightIsReport = right.type === 'incident_report' ? 0 : 1;
        return leftIsReport - rightIsReport || left.capturedAt.localeCompare(right.capturedAt);
      });
      if (!pending.length || !isCurrentSOPIdentity(identity.tenantId, identity.userId)) return;
      const results = await apiClient.post<any[]>('/alarms/sync', {
        mutations: pending.map(record => ({
          clientMutationId: record.clientMutationId,
          type: record.type,
          payload: record.payload
        }))
      });
      if (!isCurrentSOPIdentity(identity.tenantId, identity.userId)) return;
      for (const result of results) {
        if (result.state === 'confirmed') {
          await offlineVault.updateAlarmMutation(result.clientMutationId, {
            status: 'confirmed',
            serverId: result.incident?.id ?? result.action?.id,
            errorMessage: undefined
          });
        } else if (result.state === 'conflict') {
          await offlineVault.updateAlarmMutation(result.clientMutationId, {
            status: 'conflict',
            errorMessage: result.error ?? 'Der Server meldet einen Versionskonflikt.'
          });
        } else if (result.state === 'retry') {
          await offlineVault.updateAlarmMutation(result.clientMutationId, {
            errorMessage: result.error ?? 'Synchronisierung wird erneut versucht.'
          });
        }
      }
      const updatedRecords = await offlineVault.getAlarmMutations(identity.tenantId, identity.userId);
      if (!isCurrentSOPIdentity(identity.tenantId, identity.userId)) return;
      set({
        pendingAlarmMutations: updatedRecords.map(storedAlarmMutationToState),
        alarmIncidents: get().alarmIncidents.map(incident => {
          const mutation = updatedRecords.find(record => record.clientMutationId === incident.clientMutationId);
          return mutation
            ? { ...incident, syncStatus: mutation.status, clientMutationId: mutation.clientMutationId }
            : incident;
        })
      });
      if (results.some(result => result.state === 'confirmed')) {
        await get().loadTenantData();
      }
    } catch (error) {
      if (isCurrentSOPIdentity(identity.tenantId, identity.userId)) {
        get().addNotification(
          'Alarm-Synchronisierung ausstehend',
          `Lokal gespeicherte Alarmmutationen bleiben erhalten. ${errorText(error)}`,
          'warning'
        );
      }
    } finally {
      isAlarmSyncRunning = false;
    }
  },

  issueKey: async (keyId, holderName, holderId, returnDate) => {
    const issuedAt = new Date().toISOString().replace('T', ' ').substring(0, 16);

    try {
      await apiClient.patch(`/keys/${keyId}`, {
        status: 'Ausgegeben',
        currentHolderId: holderId,
        issuedAt,
        expectedReturn: returnDate
      });

      set((state) => ({
        keys: state.keys.map((k) =>
          k.id === keyId
            ? {
                ...k,
                status: 'Ausgegeben',
                currentHolderName: holderName,
                currentHolderId: holderId,
                issuedAt,
                expectedReturn: returnDate,
                isOverdue: false
              }
            : k
        )
      }));
      get().addNotification('Schlüssel ausgegeben', 'Die Ausgabe wurde in PostgreSQL gespeichert.', 'info');
    } catch (error: any) {
      get().addNotification(
        'Schlüssel nicht ausgegeben',
        error?.message || 'Die API-Anfrage ist fehlgeschlagen.',
        'alert'
      );
    }
  },

  returnKey: async (keyId) => {
    try {
      await apiClient.patch(`/keys/${keyId}`, {
        status: 'Im Tresor',
        currentHolderId: null,
        issuedAt: null,
        expectedReturn: null
      });

      set((state) => ({
        keys: state.keys.map((k) =>
          k.id === keyId
            ? {
                ...k,
                status: 'Im Tresor',
                currentHolderName: undefined,
                currentHolderId: undefined,
                issuedAt: undefined,
                expectedReturn: undefined,
                isOverdue: false
              }
            : k
        )
      }));
      get().addNotification('Schlüssel zurückgenommen', 'Die Rückgabe wurde in PostgreSQL gespeichert.', 'info');
    } catch (error: any) {
      get().addNotification(
        'Schlüssel nicht zurückgenommen',
        error?.message || 'Die API-Anfrage ist fehlgeschlagen.',
        'alert'
      );
    }
  },

  addTask: async (t) => {
    const { currentTenantId } = get();

    try {
      const created = await apiClient.post<any>('/tasks', {
        title: t.title,
        assignedToName: t.assignedToName,
        siteName: t.siteName ?? null,
        dueDate: t.dueDate,
        priority: t.priority,
        status: t.status,
        category: t.category
      });

      const newTask = mapTaskRow(
        {
          ...created,
          title: t.title,
          assigned_to_name: t.assignedToName,
          site_name: t.siteName,
          due_date: t.dueDate,
          priority: t.priority,
          status: t.status,
          category: t.category
        },
        currentTenantId
      );

      set((state) => ({ tasks: [newTask, ...state.tasks] }));
      get().addNotification('Aufgabe gespeichert', 'Die Aufgabe wurde in PostgreSQL gespeichert.', 'info');
    } catch (error: any) {
      get().addNotification(
        'Aufgabe nicht gespeichert',
        error?.message || 'Die API-Anfrage ist fehlgeschlagen. Es wurde nichts gespeichert.',
        'alert'
      );
    }
  },

  toggleTaskStatus: async (taskId) => {
    const task = get().tasks.find((item) => item.id === taskId);
    if (!task) return;

    const status: TaskItem['status'] = task.status === 'Erledigt' ? 'In Bearbeitung' : 'Erledigt';

    try {
      await apiClient.patch(`/tasks/${taskId}`, { status });
      set((state) => ({
        tasks: state.tasks.map((item) => (item.id === taskId ? { ...item, status } : item))
      }));
      get().addNotification('Aufgabe aktualisiert', 'Der Status wurde in PostgreSQL gespeichert.', 'info');
    } catch (error: any) {
      get().addNotification(
        'Aufgabe nicht aktualisiert',
        error?.message || 'Die API-Anfrage ist fehlgeschlagen.',
        'alert'
      );
    }
  },

  addEmergencyPlan: (plan) => {
    const { currentTenantId } = get();
    set((state) => ({
      emergencyPlans: [{ ...plan, id: `ep-${Date.now()}`, tenantId: currentTenantId }, ...state.emergencyPlans]
    }));
  },

  resolveAlarm: (siteId) =>
    set((state) => ({
      sites: state.sites.map((s) => (s.id === siteId ? { ...s, activeAlarms: 0 } : s))
    }))
}));

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    useSecurityStore.setState({ isOnline: true });
    void useSecurityStore.getState().syncPendingSOPAcknowledgements();
    void useSecurityStore.getState().syncPendingAlarmMutations();
    void useSecurityStore.getState().triggerManualSync();
  });
  window.addEventListener('offline', () => {
    useSecurityStore.setState({ isOnline: false });
  });
}
