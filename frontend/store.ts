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
  KioskOperatingMode,
  StationProfileType,
  StationProfile,
  MobileDeviceEntity
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
import { offlineStorage } from './services/indexedDbService';

export type ThemeMode = 'dark' | 'light';

export const initialStationProfiles: StationProfile[] = [
  {
    id: 'sp-pforte',
    type: StationProfileType.PFORTE,
    name: 'Pforte & Empfangs-Terminal',
    description: 'Fokussiert auf Wachbucheintragungen, Besucherausweise und Schlüsselausgabe.',
    allowedViews: ['duty', 'guardbook', 'handover', 'sop'],
    defaultKioskMode: KioskOperatingMode.SINGLE_APP,
    autoLogoutMinutes: 15,
    requireBiometricOnAction: false,
    preventScreenCapture: true
  },
  {
    id: 'sp-rundgang',
    type: StationProfileType.RUNDGANG,
    name: 'Rundgangskontrolle (Mobil)',
    description: 'Für Bestreifungs-Smartphones mit QR-Code/NFC-Scanner, Vorfallsmeldungen und Aufgaben.',
    allowedViews: ['duty', 'patrol', 'guardbook', 'tasks'],
    defaultKioskMode: KioskOperatingMode.SINGLE_APP,
    autoLogoutMinutes: 0,
    requireBiometricOnAction: true,
    preventScreenCapture: true
  },
  {
    id: 'sp-wachbuch',
    type: StationProfileType.WACHBUCH_TERMINAL,
    name: 'Wachbuch-Terminal (Stationär)',
    description: 'Stationäres Wand-Tablet im Foyer für Schichtwechsel und Protokollerfassung.',
    allowedViews: ['guardbook', 'handover', 'sop'],
    defaultKioskMode: KioskOperatingMode.SINGLE_APP,
    autoLogoutMinutes: 10,
    requireBiometricOnAction: false,
    preventScreenCapture: true
  },
  {
    id: 'sp-byod',
    type: StationProfileType.OBJEKTSCHUTZ,
    name: 'Dienst-Smartphone (Standard)',
    description: 'Volle Mitarbeiter-App ohne Kiosk-Sperre für persönliche Dienstgeräte.',
    allowedViews: ['home', 'duty', 'guardbook', 'patrol', 'handover', 'sop', 'tasks'],
    defaultKioskMode: KioskOperatingMode.STANDARD,
    autoLogoutMinutes: 0,
    requireBiometricOnAction: false,
    preventScreenCapture: false
  }
];

export const initialMobileDevices: MobileDeviceEntity[] = [
  {
    id: 'dev-001',
    tenantId: 'tenant-frankfurt',
    deviceId: 'android-ent-ffm-pforte1',
    deviceName: 'Samsung Galaxy Tab Active4 Pro (Pforte Nord)',
    platform: 'Android Enterprise',
    appVersion: '2.0.4-rc1 (Capacitor 6)',
    osVersion: 'Android 14 (Knox 3.10)',
    batteryLevel: 94,
    assignedUserName: 'Wachposten Pforte 1',
    assignedStationProfile: StationProfileType.PFORTE,
    currentKioskMode: KioskOperatingMode.SINGLE_APP,
    status: 'ACTIVE',
    isDeviceOwner: true,
    lockTaskModeActive: true,
    registeredAt: '2025-01-10',
    lastContactAt: 'Vor 1 Minute',
    pendingSyncCount: 0
  },
  {
    id: 'dev-002',
    tenantId: 'tenant-frankfurt',
    deviceId: 'ios-supervised-ffm-revier2',
    deviceName: 'Apple iPhone 14 Enterprise (Revierdienst Ost)',
    platform: 'Apple iOS (Supervised)',
    appVersion: '2.0.4-rc1 (Capacitor 6)',
    osVersion: 'iOS 17.5.1 (MDM ASAM)',
    batteryLevel: 78,
    assignedUserId: 'e-3',
    assignedUserName: 'Sabine Becker',
    assignedStationProfile: StationProfileType.RUNDGANG,
    currentKioskMode: KioskOperatingMode.SINGLE_APP,
    status: 'ACTIVE',
    isDeviceOwner: true,
    lockTaskModeActive: true,
    registeredAt: '2025-02-14',
    lastContactAt: 'Vor 3 Minuten',
    pendingSyncCount: 1
  },
  {
    id: 'dev-003',
    tenantId: 'tenant-frankfurt',
    deviceId: 'android-ent-ffm-byod-99',
    deviceName: 'Google Pixel 8 Pro (Objektleiter Mobil)',
    platform: 'Android Enterprise',
    appVersion: '2.0.4-rc1',
    osVersion: 'Android 14',
    batteryLevel: 62,
    assignedUserId: 'e-2',
    assignedUserName: 'Tarkan Kaya',
    assignedStationProfile: StationProfileType.EINSATZLEITUNG,
    currentKioskMode: KioskOperatingMode.STANDARD,
    status: 'ACTIVE',
    isDeviceOwner: false,
    lockTaskModeActive: false,
    registeredAt: '2025-03-01',
    lastContactAt: 'Vor 18 Minuten',
    pendingSyncCount: 0
  }
];

export const initialReportDefinitions: ReportDefinition[] = [
  {
    id: 'rep-gf-monthly',
    tenantId: 'tenant-frankfurt',
    name: 'Monatscontrolling Geschäftsführung (Soll/Ist & DIN 77200)',
    description: 'Vollständiger Monatsabschluss mit Stundenbilanz, Überstunden, Personalauslastung und Vorfallsquote.',
    category: 'GESCHAEFTSFUEHRUNG',
    requiredRole: [UserRole.ADMIN, UserRole.GF],
    dataSource: 'shifts',
    selectedColumns: ['siteName', 'date', 'type', 'status', 'employeeName'],
    filterConfig: { dateRange: 'THIS_MONTH' },
    groupBy: 'siteName',
    scheduleInterval: 'MONTHLY',
    lastGeneratedAt: '2025-05-14 23:59',
    createdAt: '2025-01-01'
  }
];

export const initialShiftSwaps: ShiftSwapRequest[] = [
  {
    id: 'swap-1',
    tenantId: 'tenant-frankfurt',
    shiftId: 'sh-1',
    requestingEmployeeId: 'e-3',
    requestingEmployeeName: 'Sabine Becker',
    targetEmployeeId: 'e-4',
    targetEmployeeName: 'Dennis Kowalski',
    reason: 'Familiäre Angelegenheit / Arzttermin',
    status: 'ANGEFRAGT',
    requestedAt: '2025-05-15 08:30'
  }
];

export const initialPatrolScans: PatrolScanEvent[] = [
  {
    id: 'scan-1',
    tenantId: 'tenant-frankfurt',
    siteId: 's-1',
    siteName: 'Finanzturm Alpha (Hauptverwaltung)',
    checkpointId: 'cp-1',
    checkpointCode: 'CP-01',
    checkpointName: 'Hauptfoyer Schrankenanlage',
    guardId: 'e-3',
    guardName: 'Sabine Becker',
    scannedAt: '2025-05-15 06:15',
    method: 'NFC_TAG',
    verifiedTag: 'RFID-9901-A',
    offlineCaptured: false
  }
];

interface SecurityOpsStore {
  theme: ThemeMode;
  toggleTheme: () => void;

  tenants: Tenant[];
  currentTenantId: string;
  setCurrentTenantId: (tenantId: string) => void;
  getCurrentTenant: () => Tenant;

  currentUserRole: UserRole;
  currentUserName: string;
  currentUserId: string;
  setCurrentUserRole: (role: UserRole) => void;

  activeTab: string;
  setActiveTab: (tab: string) => void;

  globalSearch: string;
  setGlobalSearch: (q: string) => void;
  performGlobalSearch: (q: string) => GlobalSearchResult[];

  isOnline: boolean;
  toggleNetworkSimulation: () => void;
  syncQueue: OfflineQueueItem[];
  enqueueOfflineAction: (item: Omit<OfflineQueueItem, 'id' | 'createdAt' | 'status' | 'retryCount'>) => void;
  triggerManualSync: () => Promise<{ success: number; failed: number }>;
  resolveConflict: (queueId: string, resolution: 'USE_LOCAL' | 'USE_SERVER') => void;
  clearCompletedSyncs: () => void;

  modules: SecurityModuleManifest[];
  toggleModule: (moduleId: string) => void;
  isModuleActive: (moduleId: string) => boolean;

  auditLogs: SecurityAuditEntry[];
  activeSessions: UserSessionDevice[];
  gdprPolicies: GdprRetentionPolicy[];
  revokeSession: (sessionId: string) => void;
  addAuditLog: (entry: Omit<SecurityAuditEntry, 'id' | 'timestamp' | 'tenantId'>) => void;

  notifications: { id: string; title: string; message: string; type: 'info' | 'warning' | 'alert'; time: string }[];
  notificationDeliveries: NotificationDelivery[];
  notificationPreferences: NotificationPreference;
  dismissNotification: (id: string) => void;
  addNotification: (title: string, message: string, type: 'info' | 'warning' | 'alert') => void;
  markNotificationAsRead: (deliveryId: string) => void;
  updateNotificationPreferences: (prefs: Partial<NotificationPreference>) => void;

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

  reportDefinitions: ReportDefinition[];
  addReportDefinition: (rep: Omit<ReportDefinition, 'id' | 'createdAt'>) => void;
  deleteReportDefinition: (id: string) => void;
  calculateTenantKPIs: () => ControllingKPIs;

  shiftSwaps: ShiftSwapRequest[];
  patrolScans: PatrolScanEvent[];
  shiftHandovers: ShiftHandoverProtocol[];
  addShiftSwapRequest: (req: Omit<ShiftSwapRequest, 'id' | 'tenantId' | 'requestedAt' | 'status'>) => void;
  approveShiftSwap: (swapId: string, approved: boolean) => void;
  addPatrolScan: (scan: Omit<PatrolScanEvent, 'id' | 'tenantId' | 'scannedAt' | 'offlineCaptured'>) => void;
  submitShiftHandover: (handover: Omit<ShiftHandoverProtocol, 'id' | 'tenantId' | 'handoverTime' | 'offlineCaptured'>) => void;

  // Phase 14: Mobile Fleet & Kiosk Mode Engine
  mobileDevices: MobileDeviceEntity[];
  stationProfiles: StationProfile[];
  activeStationProfile: StationProfile;
  currentKioskMode: KioskOperatingMode;
  isKioskLocked: boolean;
  biometricAuthActive: boolean;
  setKioskMode: (mode: KioskOperatingMode, pin?: string) => boolean;
  setActiveStationProfile: (profileType: StationProfileType) => void;
  lockDeviceRemotely: (deviceId: string) => void;
  wipeDeviceRemotely: (deviceId: string) => void;
  registerMobileDevice: (device: Omit<MobileDeviceEntity, 'id' | 'tenantId' | 'registeredAt' | 'lastContactAt' | 'pendingSyncCount'>) => void;
  authenticateWithBiometrics: () => Promise<boolean>;

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
  getTenantReportDefinitions: () => ReportDefinition[];
  getTenantShiftSwaps: () => ShiftSwapRequest[];
  getTenantPatrolScans: () => PatrolScanEvent[];
  getTenantMobileDevices: () => MobileDeviceEntity[];

  addClient: (client: Omit<Client, 'id' | 'tenantId'>) => void;
  addSite: (site: Omit<Site, 'id' | 'tenantId'>) => void;
  addEmployee: (emp: Omit<Employee, 'id' | 'tenantId'>) => void;
  updateEmployee: (id: string, updates: Partial<Employee>) => void;
  addShift: (shift: Omit<Shift, 'id' | 'tenantId'>) => void;
  assignShiftEmployee: (shiftId: string, employeeId: string, employeeName: string) => void;
  addGuardBookEntry: (entry: Omit<GuardBookEntry, 'id' | 'timestamp' | 'tenantId'>) => void;
  updateGuardBookStage: (id: string, stage: GuardBookEntry['stage'], note?: string) => void;
  resolveGuardBookEntry: (id: string, note: string) => void;
  acknowledgeSOP: (sopId: string) => void;
  issueKey: (keyId: string, holderName: string, holderId: string, returnDate: string) => void;
  returnKey: (keyId: string) => void;
  addTask: (task: Omit<TaskItem, 'id' | 'tenantId'>) => void;
  toggleTaskStatus: (taskId: string) => void;
  addDocument: (doc: Omit<ManagedDocument, 'id' | 'tenantId' | 'uploadedAt'>) => void;
  deleteDocument: (docId: string) => void;
  addEmergencyPlan: (plan: Omit<EmergencyPlan, 'id' | 'tenantId'>) => void;
  resolveAlarm: (siteId: string) => void;
}

export const useSecurityStore = create<SecurityOpsStore>((set, get) => ({
  theme: (localStorage.getItem('secops_theme') as ThemeMode) || 'dark',
  toggleTheme: () => {
    const nextTheme = get().theme === 'dark' ? 'light' : 'dark';
    localStorage.setItem('secops_theme', nextTheme);
    if (nextTheme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
    set({ theme: nextTheme });
  },

  tenants: initialTenants,
  currentTenantId: localStorage.getItem('secops_tenant_id') || 'tenant-frankfurt',
  setCurrentTenantId: (tenantId) => {
    apiClient.setTenantId(tenantId);
    set({ currentTenantId: tenantId });
    get().addAuditLog({
      actorEmail: 'admin@secops.local',
      actorRole: get().currentUserRole,
      actionType: 'ROLE_CHANGE',
      severity: 'INFO',
      targetEntity: `Tenant Switch to ${tenantId}`,
      details: 'Sitzungskontext wurde gewechselt. RLS-Filter neu synchronisiert.',
      ipAddress: '127.0.0.1'
    });
  },
  getCurrentTenant: () => {
    const { tenants, currentTenantId } = get();
    return tenants.find((t) => t.id === currentTenantId) || tenants[0];
  },

  currentUserRole: UserRole.GUARD,
  currentUserName: 'Sabine Becker (Wachdienstmitarbeiter)',
  currentUserId: 'e-3',
  setCurrentUserRole: (role) => {
    let name = 'Sabine Becker (Wachdienstmitarbeiter)';
    let uId = 'e-3';
    if (role === UserRole.EINSATZLEITUNG) {
      name = 'Alexander Schmidt (Einsatzleiter)';
      uId = 'e-1';
    } else if (role === UserRole.OBJEKTLEITUNG) {
      name = 'Tarkan Kaya (Objektleiter)';
      uId = 'e-2';
    } else if (role === UserRole.ADMIN || role === UserRole.GF) {
      name = 'Dr. Michael von Berg (Geschäftsführung)';
      uId = 'admin-1';
    }

    set({ currentUserRole: role, currentUserName: name, currentUserId: uId });
    get().addAuditLog({
      actorEmail: `${uId}@secops.local`,
      actorRole: role,
      actionType: 'ROLE_CHANGE',
      severity: 'WARNUNG',
      targetEntity: `RBAC Role -> ${role}`,
      details: `Rollenwechsel im System auf ${role} durchgeführt.`,
      ipAddress: '194.25.101.44'
    });
  },

  activeTab: 'mobile_app',
  setActiveTab: (tab) => set({ activeTab: tab }),

  globalSearch: '',
  setGlobalSearch: (q) => set({ globalSearch: q }),

  performGlobalSearch: (query) => {
    if (!query || query.trim().length < 2) return [];
    const q = query.toLowerCase().trim();
    const { getTenantClients, getTenantSites, getTenantEmployees, getTenantGuardBook, getTenantKeys, getTenantTasks, getTenantDocuments, getTenantAutomations } = get();
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
        results.push({ id: g.id, title: g.title, subtitle: `${g.siteName} • ${g.priority} (${g.stage})`, category: 'Wachbuch', targetTab: 'guardbook' });
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

    getTenantAutomations().forEach((a) => {
      if (a.name.toLowerCase().includes(q) || a.description.toLowerCase().includes(q)) {
        results.push({ id: a.id, title: a.name, subtitle: `Regel • ${a.trigger} (${a.category})`, category: 'Aufgabe', targetTab: 'automations' });
      }
    });

    return results;
  },

  isOnline: true,
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
        'Netzwerk unterbrochen. Wachbuch, Kontrollgänge und Aufgaben werden lokal in der Sync-Queue gespeichert.',
        'warning'
      );
    }
  },

  syncQueue: [
    {
      id: 'sync-demo-1',
      tenantId: 'tenant-frankfurt',
      entityType: 'guardbook',
      action: 'CREATE',
      payload: { title: 'Notausgang-Prüfung Tiefgarage West', category: 'Kontrollgang', siteName: 'Finanzturm Alpha' },
      createdAt: new Date(Date.now() - 1000 * 60 * 12).toLocaleTimeString(),
      retryCount: 0,
      status: 'synced'
    }
  ],

  enqueueOfflineAction: (item) => {
    const queueEntry: OfflineQueueItem = {
      ...item,
      id: `queue-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      createdAt: new Date().toLocaleTimeString(),
      retryCount: 0,
      status: 'pending'
    };

    offlineStorage.enqueueOffline({
      id: queueEntry.id,
      tenantId: queueEntry.tenantId,
      storeName: queueEntry.entityType,
      action: queueEntry.action,
      data: queueEntry.payload,
      timestamp: queueEntry.createdAt,
      synced: false
    }).catch(console.error);

    set((state) => ({ syncQueue: [queueEntry, ...state.syncQueue] }));
  },

  triggerManualSync: async () => {
    const { syncQueue, isOnline } = get();
    if (!isOnline) {
      return { success: 0, failed: syncQueue.filter(q => q.status === 'pending').length };
    }

    let successCount = 0;
    let failedCount = 0;

    const updated = syncQueue.map((item) => {
      if (item.status === 'pending') {
        successCount++;
        offlineStorage.markSynced(item.id).catch(console.error);
        return { ...item, status: 'synced' as SyncStatus };
      }
      return item;
    });

    set({ syncQueue: updated });
    return { success: successCount, failed: failedCount };
  },

  resolveConflict: (queueId) => {
    set((state) => ({
      syncQueue: state.syncQueue.map((q) =>
        q.id === queueId ? { ...q, status: 'synced' as SyncStatus, conflictDetails: undefined } : q
      )
    }));
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
    get().addAuditLog({
      actorEmail: 'a.schmidt@ffm-sec.de',
      actorRole: 'Einsatzleitung',
      actionType: 'DEVICE_REVOKE',
      severity: 'WARNUNG',
      targetEntity: `Session ${sessionId}`,
      details: `Gerätesitzung ${sessionId} widerrufen. Token auf Blacklist gesetzt.`,
      ipAddress: '194.25.101.44'
    });
    get().addNotification(
      'Sitzung widerrufen',
      `Sitzung ${sessionId} wurde gesperrt.`,
      'info'
    );
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
    const currentTenant = get().currentTenantId;
    const severityMap: Record<string, NotificationDelivery['severity']> = {
      info: 'INFO',
      warning: 'WARNUNG',
      alert: 'ALARM'
    };

    const newDelivery: NotificationDelivery = {
      id: `nd-${Date.now()}`,
      tenantId: currentTenant,
      title,
      message,
      channel: 'IN_APP',
      severity: severityMap[type] || 'INFO',
      status: 'DELIVERED',
      createdAt: new Date().toISOString().replace('T', ' ').substring(0, 19),
      deliveredAt: new Date().toISOString().replace('T', ' ').substring(0, 19),
      read: false,
      sourceModule: 'Automations'
    };

    set((state) => ({
      notifications: [
        { id: `notif-${Date.now()}`, title, message, type, time: 'Gerade eben' },
        ...state.notifications
      ],
      notificationDeliveries: [newDelivery, ...state.notificationDeliveries]
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
    return { matched: true, actions: rule.actions.map((a) => a.type), durationMs: 25 };
  },

  runAutomationsNow: () => {
    return 2;
  },

  reportDefinitions: initialReportDefinitions,

  addReportDefinition: (rep) => {
    const newDef: ReportDefinition = {
      ...rep,
      id: `rep-${Date.now()}`,
      tenantId: get().currentTenantId,
      createdAt: new Date().toISOString().split('T')[0]
    };
    set((state) => ({ reportDefinitions: [newDef, ...state.reportDefinitions] }));
  },

  deleteReportDefinition: (id) => {
    set((state) => ({
      reportDefinitions: state.reportDefinitions.filter((r) => r.id !== id)
    }));
  },

  calculateTenantKPIs: (): ControllingKPIs => {
    const clients = get().getTenantClients();
    const sites = get().getTenantSites();
    const employees = get().getTenantEmployees();
    const shifts = get().getTenantShifts();
    const guardBook = get().getTenantGuardBook();
    const tasks = get().getTenantTasks();
    const keys = get().getTenantKeys();

    const activeClientsCount = clients.length;
    const activeSitesCount = sites.length;
    const activeEmployeesCount = employees.filter((e) => e.status === 'Aktiv').length;

    let totalPlannedHours = 0;
    let totalActualHours = 0;

    shifts.forEach((sh) => {
      const hours = 12;
      totalPlannedHours += hours;
      if (sh.status === 'Besetzt') {
        totalActualHours += hours;
      }
    });

    const planFulfillmentRate = totalPlannedHours > 0
      ? Math.round((totalActualHours / totalPlannedHours) * 100)
      : 100;

    const openCriticalIncidentsCount = guardBook.filter(
      (g) => (g.priority === 'Kritisch' || g.priority === 'Dringend') && !g.resolved
    ).length;

    const overdueTasksCount = tasks.filter((t) => t.status !== 'Erledigt').length;

    const expiringContractsCount = clients.filter((c) => {
      const end = new Date(c.contractEnd).getTime();
      const daysLeft = (end - Date.now()) / (1000 * 3600 * 24);
      return daysLeft <= 90;
    }).length;

    const expiringQualificationsCount = employees.flatMap((emp) =>
      emp.qualifications.filter((q) => {
        const exp = new Date(q.expiryDate).getTime();
        const daysLeft = (exp - Date.now()) / (1000 * 3600 * 24);
        return daysLeft <= 30;
      })
    ).length;

    const activeAlarmsCount = sites.reduce((sum, s) => sum + s.activeAlarms, 0);

    const overdueKeysCount = keys.filter(
      (k) => k.isOverdue || (k.status === 'Ausgegeben' && k.expectedReturn && new Date(k.expectedReturn).getTime() < Date.now())
    ).length;

    let score = 100;
    score -= openCriticalIncidentsCount * 10;
    score -= overdueKeysCount * 5;
    score -= expiringQualificationsCount * 12;
    const din77200ComplianceScore = Math.max(0, Math.min(100, score));

    return {
      activeClientsCount,
      activeSitesCount,
      activeEmployeesCount,
      totalPlannedHours,
      totalActualHours,
      planFulfillmentRate,
      openCriticalIncidentsCount,
      overdueTasksCount,
      expiringContractsCount,
      expiringQualificationsCount,
      activeAlarmsCount,
      overdueKeysCount,
      din77200ComplianceScore
    };
  },

  shiftSwaps: initialShiftSwaps,
  patrolScans: initialPatrolScans,
  shiftHandovers: [],

  addShiftSwapRequest: (req) => {
    const { currentTenantId, isOnline, enqueueOfflineAction, addNotification } = get();
    const newSwap: ShiftSwapRequest = {
      ...req,
      id: `swap-${Date.now()}`,
      tenantId: currentTenantId,
      status: 'ANGEFRAGT',
      requestedAt: new Date().toISOString().replace('T', ' ').substring(0, 16)
    };

    set((state) => ({ shiftSwaps: [newSwap, ...state.shiftSwaps] }));

    addNotification(
      'Diensttausch-Anfrage eingereicht',
      `Anfrage für Schicht an ${req.targetEmployeeName} übermittelt.`,
      'info'
    );

    if (!isOnline) {
      enqueueOfflineAction({
        tenantId: currentTenantId,
        entityType: 'shift',
        action: 'UPDATE',
        payload: newSwap
      });
    }
  },

  approveShiftSwap: (swapId, approved) => {
    const { currentUserName, addNotification } = get();
    set((state) => ({
      shiftSwaps: state.shiftSwaps.map((s) =>
        s.id === swapId
          ? {
              ...s,
              status: approved ? 'BESTAETIGT' : 'ABGELEHNT',
              decidedAt: new Date().toISOString().replace('T', ' ').substring(0, 16),
              decidedByName: currentUserName
            }
          : s
      )
    }));

    addNotification(
      `Diensttausch ${approved ? 'bestätigt' : 'abgelehnt'}`,
      `Entscheidung durch ${currentUserName} im Dienstplan protokolliert.`,
      approved ? 'info' : 'warning'
    );
  },

  addPatrolScan: (scan) => {
    const { currentTenantId, isOnline, enqueueOfflineAction, addAuditLog } = get();
    const scanId = `scan-${Date.now()}`;
    const newScan: PatrolScanEvent = {
      ...scan,
      id: scanId,
      tenantId: currentTenantId,
      scannedAt: new Date().toISOString().replace('T', ' ').substring(0, 16),
      offlineCaptured: !isOnline
    };

    set((state) => ({ patrolScans: [newScan, ...state.patrolScans] }));

    addAuditLog({
      actorEmail: 'guard-mobile@secops.local',
      actorRole: 'Wachdienstmitarbeiter',
      actionType: 'INCIDENT_MOD',
      severity: 'INFO',
      targetEntity: `Checkpoint ${scan.checkpointCode}`,
      details: `Kontrollpunkt ${scan.checkpointName} (${scan.method}) am Objekt ${scan.siteName} abgetastet.`,
      ipAddress: '127.0.0.1'
    });

    if (!isOnline) {
      enqueueOfflineAction({
        tenantId: currentTenantId,
        entityType: 'patrol',
        action: 'CREATE',
        payload: newScan
      });
    }
  },

  submitShiftHandover: (handover) => {
    const { currentTenantId, isOnline, enqueueOfflineAction, addAuditLog, addNotification } = get();
    const handoverId = `ho-${Date.now()}`;
    const protocol: ShiftHandoverProtocol = {
      ...handover,
      id: handoverId,
      tenantId: currentTenantId,
      handoverTime: new Date().toISOString().replace('T', ' ').substring(0, 16),
      offlineCaptured: !isOnline
    };

    set((state) => ({ shiftHandovers: [protocol, ...state.shiftHandovers] }));

    addAuditLog({
      actorEmail: 'guard-mobile@secops.local',
      actorRole: 'Wachdienstmitarbeiter',
      actionType: 'INCIDENT_MOD',
      severity: 'INFO',
      targetEntity: `ShiftHandover ${handover.siteName}`,
      details: `Schichtübergabe von ${handover.relievedGuardName} an ${handover.relievingGuardName} ordnungsgemäß quittiert.`,
      ipAddress: '127.0.0.1'
    });

    addNotification(
      'Schichtübergabe bestätigt',
      `Übergabeprotokoll für ${handover.siteName} digital archiviert.`,
      'info'
    );

    if (!isOnline) {
      enqueueOfflineAction({
        tenantId: currentTenantId,
        entityType: 'handover',
        action: 'CREATE',
        payload: protocol
      });
    }
  },

  // ==============================================================================
  // PHASE 14: KIOSK-MODUS & MOBILE FLOTTENSTEUERUNG
  // ==============================================================================

  mobileDevices: initialMobileDevices,
  stationProfiles: initialStationProfiles,
  activeStationProfile: initialStationProfiles[3], // Default: BYOD / Standard
  currentKioskMode: KioskOperatingMode.STANDARD,
  isKioskLocked: false,
  biometricAuthActive: false,

  setKioskMode: (mode, pin) => {
    const { addAuditLog, addNotification, activeStationProfile } = get();

    if (mode === KioskOperatingMode.SINGLE_APP || mode === KioskOperatingMode.MULTI_APP) {
      set({ currentKioskMode: mode, isKioskLocked: true });
      addAuditLog({
        actorEmail: 'admin-kiosk@secops.local',
        actorRole: 'Systemadministrator',
        actionType: 'KIOSK_LOCKED',
        severity: 'ALARM',
        targetEntity: `Device Kiosk Lock`,
        details: `Kiosk-Modus (${mode}) aktiviert. Profil: ${activeStationProfile.name}. LockTaskMode aktiv.`,
        ipAddress: '127.0.0.1'
      });
      addNotification(
        'Kiosk-Modus aktiviert',
        `Gerät befindet sich jetzt im gesicherten ${mode}. Verlassen nur mit Administrator-PIN.`,
        'warning'
      );
      return true;
    } else {
      // Unlocking requires admin PIN
      if (pin === '7720' || pin === 'admin') {
        set({ currentKioskMode: KioskOperatingMode.STANDARD, isKioskLocked: false });
        addAuditLog({
          actorEmail: 'admin-kiosk@secops.local',
          actorRole: 'Systemadministrator',
          actionType: 'KIOSK_UNLOCKED',
          severity: 'WARNUNG',
          targetEntity: `Device Kiosk Unlock`,
          details: `Kiosk-Modus mit Master-PIN autorisiert beendet.`,
          ipAddress: '127.0.0.1'
        });
        addNotification(
          'Kiosk-Modus beendet',
          'Gerät wurde erfolgreich freigegeben.',
          'info'
        );
        return true;
      }
      return false;
    }
  },

  setActiveStationProfile: (profileType) => {
    const profile = get().stationProfiles.find((sp) => sp.type === profileType) || get().stationProfiles[0];
    set({
      activeStationProfile: profile,
      currentKioskMode: profile.defaultKioskMode,
      isKioskLocked: profile.defaultKioskMode === KioskOperatingMode.SINGLE_APP
    });
  },

  lockDeviceRemotely: (deviceId) => {
    const { addAuditLog, addNotification } = get();
    set((state) => ({
      mobileDevices: state.mobileDevices.map((d) =>
        d.deviceId === deviceId
          ? { ...d, status: 'LOCKED', lockTaskModeActive: true, currentKioskMode: KioskOperatingMode.SINGLE_APP }
          : d
      )
    }));

    addAuditLog({
      actorEmail: 'admin@secops.local',
      actorRole: 'Systemadministrator',
      actionType: 'KIOSK_LOCKED',
      severity: 'ALARM',
      targetEntity: `Device ${deviceId}`,
      details: `Gerät ${deviceId} wurde aus der Ferne gesperrt (Android Enterprise LockTask / iOS Single App).`,
      ipAddress: '194.25.101.44'
    });

    addNotification(
      'Gerät aus der Ferne gesperrt',
      `Sperrbefehl an ${deviceId} erfolgreich übermittelt.`,
      'warning'
    );
  },

  wipeDeviceRemotely: (deviceId) => {
    const { addAuditLog, addNotification } = get();
    set((state) => ({
      mobileDevices: state.mobileDevices.map((d) =>
        d.deviceId === deviceId
          ? { ...d, status: 'WIPED', currentKioskMode: KioskOperatingMode.SINGLE_APP }
          : d
      )
    }));

    addAuditLog({
      actorEmail: 'admin@secops.local',
      actorRole: 'Systemadministrator',
      actionType: 'DEVICE_REVOKE',
      severity: 'KRITISCH',
      targetEntity: `Device ${deviceId}`,
      details: `Fernlöschung (Enterprise Wipe) für Gerät ${deviceId} ausgeführt. Lokale Token & IndexedDB bereinigt.`,
      ipAddress: '194.25.101.44'
    });

    addNotification(
      'Enterprise Wipe durchgeführt',
      `Alle Daten auf ${deviceId} wurden unumkehrbar gelöscht.`,
      'alert'
    );
  },

  registerMobileDevice: (devData) => {
    const newDev: MobileDeviceEntity = {
      ...devData,
      id: `dev-${Date.now()}`,
      tenantId: get().currentTenantId,
      registeredAt: new Date().toISOString().split('T')[0],
      lastContactAt: 'Gerade eben',
      pendingSyncCount: 0
    };
    set((state) => ({ mobileDevices: [newDev, ...state.mobileDevices] }));
  },

  authenticateWithBiometrics: async () => {
    // WebAuthn platform authenticator verification simulation
    if (window.PublicKeyCredential) {
      try {
        set({ biometricAuthActive: true });
        await new Promise((r) => setTimeout(r, 600));
        set({ biometricAuthActive: false });
        get().addNotification(
          'Biometrie erfolgreich verifiziert',
          'Identität per Fingerabdruck / FaceID bestätigt.',
          'info'
        );
        return true;
      } catch {
        set({ biometricAuthActive: false });
        return false;
      }
    }
    return true;
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
    return auditLogs.filter((a) => a.tenantId === currentTenantId);
  },
  getTenantExecutionLogs: () => {
    const { executionLogs, currentTenantId } = get();
    return executionLogs.filter((l) => l.tenantId === currentTenantId);
  },
  getTenantNotificationDeliveries: () => {
    const { notificationDeliveries, currentTenantId } = get();
    return notificationDeliveries.filter((nd) => nd.tenantId === currentTenantId);
  },
  getTenantReportDefinitions: () => {
    const { reportDefinitions, currentTenantId } = get();
    return reportDefinitions.filter((r) => r.tenantId === currentTenantId);
  },
  getTenantShiftSwaps: () => {
    const { shiftSwaps, currentTenantId } = get();
    return shiftSwaps.filter((s) => s.tenantId === currentTenantId);
  },
  getTenantPatrolScans: () => {
    const { patrolScans, currentTenantId } = get();
    return patrolScans.filter((p) => p.tenantId === currentTenantId);
  },
  getTenantMobileDevices: () => {
    const { mobileDevices, currentTenantId } = get();
    return mobileDevices.filter((d) => d.tenantId === currentTenantId);
  },

  addClient: (c) => {
    const { currentTenantId } = get();
    const newClient: Client = {
      ...c,
      tenantId: currentTenantId,
      id: `c-${Date.now()}`,
      contractAutoRenew: c.contractAutoRenew ?? true,
      noticePeriodMonths: c.noticePeriodMonths ?? 3
    };
    set((state) => ({ clients: [newClient, ...state.clients] }));
  },

  addSite: (s) => {
    const { currentTenantId } = get();
    const newSite: Site = { ...s, tenantId: currentTenantId, id: `s-${Date.now()}` };
    set((state) => ({ sites: [newSite, ...state.sites] }));
  },

  addEmployee: (e) => {
    const { currentTenantId, isOnline, enqueueOfflineAction } = get();
    const newEmp: Employee = { ...e, tenantId: currentTenantId, id: `e-${Date.now()}` };
    set((state) => ({ employees: [newEmp, ...state.employees] }));

    if (!isOnline) {
      enqueueOfflineAction({
        tenantId: currentTenantId,
        entityType: 'employee',
        action: 'CREATE',
        payload: newEmp
      });
    }
  },

  updateEmployee: (id, updates) =>
    set((state) => ({
      employees: state.employees.map((emp) => (emp.id === id ? { ...emp, ...updates } : emp))
    })),

  addShift: (s) => {
    const { currentTenantId } = get();
    const newShift: Shift = { ...s, tenantId: currentTenantId, id: `sh-${Date.now()}` };
    set((state) => ({ shifts: [newShift, ...state.shifts] }));
  },

  assignShiftEmployee: (shiftId, employeeId, employeeName) => {
    const { isOnline, currentTenantId, enqueueOfflineAction, employees, shifts } = get();
    const shift = shifts.find((s) => s.id === shiftId);
    const emp = employees.find((e) => e.id === employeeId);

    let conflictReason: string | undefined = undefined;
    let status: Shift['status'] = 'Besetzt';

    if (emp && (emp.status === 'Krank' || emp.status === 'Urlaub')) {
      status = 'Konflikt';
      conflictReason = `Mitarbeiter hat Status ${emp.status}! Nicht disponierbar.`;
    }

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

    if (!isOnline) {
      enqueueOfflineAction({
        tenantId: currentTenantId,
        entityType: 'shift',
        action: 'UPDATE',
        payload: { shiftId, employeeId, employeeName, status, conflictReason }
      });
    }
  },

  addGuardBookEntry: (entry) => {
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

    if (!isOnline) {
      enqueueOfflineAction({
        tenantId: currentTenantId,
        entityType: 'guardbook',
        action: 'CREATE',
        payload: newEntry
      });
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

  issueKey: (keyId, holderName, holderId, returnDate) =>
    set((state) => ({
      keys: state.keys.map((k) =>
        k.id === keyId
          ? {
              ...k,
              status: 'Ausgegeben',
              currentHolderName: holderName,
              currentHolderId: holderId,
              issuedAt: new Date().toISOString().replace('T', ' ').substring(0, 16),
              expectedReturn: returnDate,
              isOverdue: false
            }
          : k
      )
    })),

  returnKey: (keyId) =>
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
    })),

  addTask: (t) => {
    const { currentTenantId, isOnline, enqueueOfflineAction } = get();
    const newTask: TaskItem = {
      ...t,
      id: `t-${Date.now()}`,
      tenantId: currentTenantId,
      offlineCreated: !isOnline
    };

    set((state) => ({
      tasks: [newTask, ...state.tasks]
    }));

    if (!isOnline) {
      enqueueOfflineAction({
        tenantId: currentTenantId,
        entityType: 'task',
        action: 'CREATE',
        payload: newTask
      });
    }
  },

  toggleTaskStatus: (taskId) =>
    set((state) => ({
      tasks: state.tasks.map((t) =>
        t.id === taskId
          ? { ...t, status: t.status === 'Erledigt' ? 'In Bearbeitung' : 'Erledigt' }
          : t
      )
    })),

  addDocument: (doc) => {
    const { currentTenantId, addAuditLog } = get();
    const newDoc: ManagedDocument = {
      ...doc,
      id: `doc-${Date.now()}`,
      tenantId: currentTenantId,
      uploadedAt: new Date().toISOString().replace('T', ' ').substring(0, 16),
      sha256Hash: 'a7b1c3d4e5f60123456789abcdef0123456789abcdef0123456789abcdef0123',
      scannedClean: true
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
