import { create } from 'zustand';
import {
  Tenant,
  Client,
  Site,
  Employee,
  Shift,
  GuardBookEntry,
  SOPDocument,
  EmergencyPlan,
  KeyItem,
  TaskItem,
  ManagedDocument,
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
  PatrolScanEvent,
  ShiftHandoverProtocol,
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
  initialSOPs,
  initialEmergencyPlans,
  initialKeys,
  initialTasks,
  initialDocuments,
  initialAutomations,
  initialAutomationTemplates,
  initialExecutionLogs,
  initialNotificationDeliveries,
  initialNotificationPreferences,
  initialAuditLogs,
  initialActiveSessions,
  initialGdprPolicies
} from './mockData';
import { apiClient } from './services/apiClient';
import { offlineVault } from './services/indexedDbService';

export type ThemeMode = 'dark' | 'light';

// Mutex zur Verhinderung paralleler Synchronisationsläufe
let isSyncRunningMutex = false;

export interface AuthUser {
  id: string;
  email: string;
  fullName: string;
  role: string;
  tenantId: string;
  tenantName: string;
  permissions: string[];
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
  enqueueOfflineAction: (item: Omit<OfflineQueueItem, 'id' | 'createdAt' | 'status' | 'retryCount'>) => Promise<void>;
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
  emergencyPlans: EmergencyPlan[];
  keys: KeyItem[];
  tasks: TaskItem[];
  documents: ManagedDocument[];

  // Tenant-Partitioned Selectors
  getTenantClients: () => Client[];
  getTenantSites: () => Site[];
  getTenantEmployees: () => Employee[];
  getTenantShifts: () => Shift[];
  getTenantGuardBook: () => GuardBookEntry[];
  getTenantSOPs: () => SOPDocument[];
  getTenantEmergencyPlans: () => EmergencyPlan[];
  getTenantKeys: () => KeyItem[];
  getTenantTasks: () => TaskItem[];
  getTenantDocuments: () => ManagedDocument[];
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
  acknowledgeSOP: (sopId: string) => void;
  issueKey: (keyId: string, holderName: string, holderId: string, returnDate: string) => Promise<void>;
  returnKey: (keyId: string) => Promise<void>;
  addTask: (task: Omit<TaskItem, 'id' | 'tenantId'>) => Promise<void>;
  toggleTaskStatus: (taskId: string) => Promise<void>;
  addDocument: (doc: Omit<ManagedDocument, 'id' | 'tenantId' | 'uploadedAt'>) => void;
  deleteDocument: (docId: string) => void;
  addEmergencyPlan: (plan: Omit<EmergencyPlan, 'id' | 'tenantId'>) => void;
  resolveAlarm: (siteId: string) => void;
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
  isAuthenticated: !!apiClient.getToken(),
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
      apiClient.setToken(data.accessToken);
      set({ authUser: data.user as AuthUser, isAuthenticated: true, isAuthenticating: false });
      await get().loadTenantData();
    } catch (error: any) {
      apiClient.setToken(null);
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
    apiClient.setToken(null);
    set({ authUser: null, isAuthenticated: false, authError: null });
  },

  restoreSession: async () => {
    if (!apiClient.getToken()) {
      set({ isAuthenticated: false, authUser: null });
      return;
    }

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
        isAuthenticated: true
      });
      await get().loadTenantData();
    } catch {
      apiClient.setToken(null);
      set({ authUser: null, isAuthenticated: false });
    }
  },

  loadTenantData: async () => {
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
      tasks: []
    });

    const [
      clientsResult,
      sitesResult,
      employeesResult,
      logbookResult,
      shiftsResult,
      keysResult,
      tasksResult
    ] = await Promise.allSettled([
      apiClient.get<any[]>('/customers'),
      apiClient.get<any[]>('/sites'),
      apiClient.get<any[]>('/employees'),
      apiClient.get<any[]>('/logbook'),
      apiClient.get<any[]>('/shifts'),
      apiClient.get<any[]>('/keys'),
      apiClient.get<any[]>('/tasks')
    ]);

    const tenantId = get().currentTenantId;
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

    const dataLoadError = errors.length > 0 ? errors.join(' | ') : null;
    set({ ...nextState, isLoadingData: false, dataLoadError });

    if (dataLoadError) {
      get().addNotification('Daten teilweise nicht geladen', dataLoadError, 'alert');
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
    set({ currentTenantId: tenantId });
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

  isOnline: true,
  isSyncing: false,
  lastSyncTime: null,
  toggleNetworkSimulation: () => {
    const nextState = !get().isOnline;
    set({ isOnline: nextState });

    if (nextState) {
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
      id: `queue-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
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

      set((state) => ({ syncQueue: [queueEntry, ...state.syncQueue] }));
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
        set({ isSyncing: false, lastSyncTime: new Date().toLocaleTimeString() });
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
        for (const items of [pendingItems.filter((p) => !['client', 'site', 'employee'].includes(p.entityType)), pendingItems.filter((p) => p.entityType === 'client'), pendingItems.filter((p) => p.entityType === 'site'), pendingItems.filter((p) => p.entityType === 'employee')]) {
          if (!items.length) continue;
          const path = items[0].entityType === 'client' ? '/customers/sync' : items[0].entityType === 'site' ? '/sites/sync' : items[0].entityType === 'employee' ? '/employees/sync' : '/sync/push';
          const orderedItems = ['site', 'employee'].includes(items[0].entityType) ? [...items].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt)) : items;
          const serverResponse: any = await apiClient.post(path, makeSyncPayload(orderedItems));
          const receipts = Array.isArray(serverResponse) ? serverResponse : serverResponse?.data;
          if (!Array.isArray(receipts)) continue;
          for (const receipt of receipts) {
            if (receipt.status === 'SYNCED') { successCount++; await offlineVault.markSynced(receipt.clientUuid); }
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

      const remainingPending = await offlineVault.getPendingOutbox(currentTenantId);
      set({
        syncQueue: remainingPending.map((p) => ({
          id: p.id,
          tenantId: p.tenantId,
          entityType: p.entityType as any,
          action: p.action,
          payload: p.payload,
          createdAt: p.occurredAt,
          retryCount: p.retryCount,
          status: p.status === 'CONFLICT' ? 'conflict' : 'pending'
        })),
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
  sops: initialSOPs,
  emergencyPlans: initialEmergencyPlans,
  keys: initialKeys,
  tasks: initialTasks,
  documents: initialDocuments,

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
  getTenantKeys: () => {
    const { keys, currentTenantId } = get();
    return keys.filter((k) => k.tenantId === currentTenantId);
  },
  getTenantTasks: () => {
    const { tasks, currentTenantId } = get();
    return tasks.filter((t) => t.tenantId === currentTenantId);
  },
  getTenantDocuments: () => {
    const { documents, currentTenantId } = get();
    return documents.filter((d) => d.tenantId === currentTenantId);
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
        dateOfJoining: e.dateOfJoining
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
      'dateOfJoining'
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

  acknowledgeSOP: (sopId) =>
    set((state) => ({
      sops: state.sops.map((sop) =>
        sop.id === sopId
          ? { ...sop, signedCount: Math.min(sop.totalRequired, sop.signedCount + 1) }
          : sop
      )
    })),

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

  addDocument: (doc) => {
    const { currentTenantId } = get();
    const newDoc: ManagedDocument = {
      ...doc,
      id: `doc-${Date.now()}`,
      tenantId: currentTenantId,
      uploadedAt: new Date().toISOString().replace('T', ' ').substring(0, 16)
    };
    set((state) => ({ documents: [newDoc, ...state.documents] }));
  },

  deleteDocument: (docId) =>
    set((state) => ({
      documents: state.documents.filter((d) => d.id !== docId)
    })),

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
