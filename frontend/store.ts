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
  ShiftHandoverProtocol
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

// Synchronisations-Mutex gegen parallele Läufe
let isGlobalSyncInProgress = false;

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
  enqueueOfflineAction: (item: Omit<OfflineQueueItem, 'id' | 'createdAt' | 'status' | 'retryCount'>) => Promise<boolean>;
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

  addClient: (client: Omit<Client, 'id' | 'tenantId'>) => void;
  addSite: (site: Omit<Site, 'id' | 'tenantId'>) => void;
  addEmployee: (emp: Omit<Employee, 'id' | 'tenantId'>) => void;
  updateEmployee: (id: string, updates: Partial<Employee>) => void;
  addShift: (shift: Omit<Shift, 'id' | 'tenantId'>) => void;
  assignShiftEmployee: (shiftId: string, employeeId: string, employeeName: string) => void;
  addGuardBookEntry: (entry: Omit<GuardBookEntry, 'id' | 'timestamp' | 'tenantId'>) => Promise<boolean>;
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
  theme: (typeof localStorage !== 'undefined' ? localStorage.getItem('secops_theme') as ThemeMode : 'dark') || 'dark',
  toggleTheme: () => {
    const nextTheme = get().theme === 'dark' ? 'light' : 'dark';
    if (typeof localStorage !== 'undefined') localStorage.setItem('secops_theme', nextTheme);
    if (typeof document !== 'undefined') {
      if (nextTheme === 'dark') document.documentElement.classList.add('dark');
      else document.documentElement.classList.remove('dark');
    }
    set({ theme: nextTheme });
  },

  tenants: initialTenants,
  currentTenantId: (typeof localStorage !== 'undefined' ? localStorage.getItem('secops_tenant_id') : null) || 'tenant-frankfurt',
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
      // Verbindlich in IndexedDB schreiben und auf Bestätigung warten
      await offlineVault.enqueueMutation({
        id: queueEntry.id,
        tenantId: queueEntry.tenantId,
        userId: get().currentUserId,
        entityType: queueEntry.entityType as any,
        action: queueEntry.action,
        payload: queueEntry.payload,
        occurredAt: new Date().toISOString(),
        baseVersion: 1
      });

      set((state) => ({ syncQueue: [queueEntry, ...state.syncQueue] }));
      return true;
    } catch (err: any) {
      console.error('[OFFLINE ENQUEUE FAILED]', err);
      const failedEntry: OfflineQueueItem = {
        ...queueEntry,
        status: 'failed',
        errorMessage: err?.message || 'Schreibfehler in IndexedDB'
      };
      set((state) => ({ syncQueue: [failedEntry, ...state.syncQueue] }));
      get().addNotification(
        'Speicherfehler',
        `Eintrag konnte nicht in lokaler Datenbank gesichert werden: ${err?.message}`,
        'alert'
      );
      return false;
    }
  },

  /**
   * Aufgabe 1: Vollständige und verlässliche Synchronisation mit echtem Backend
   * - Lädt pending Outbox aus IndexedDB
   * - Filtert strikt nach Mandant & Benutzer
   * - Sendet Mutation-Batch via apiClient an /api/v1/sync/push
   * - Verarbeitet Bestätigungen und markiert ERST DANN als synchronisiert
   * - Behält Einträge bei Netzwerkfehler
   * - Kennzeichnet Konflikte als CONFLICT
   */
  triggerManualSync: async () => {
    const { isOnline, currentTenantId, currentUserId } = get();
    if (!isOnline) {
      return { success: 0, failed: 0 };
    }

    if (isGlobalSyncInProgress) {
      console.warn('[SYNC BLOCKED] Ein Synchronisationslauf ist bereits aktiv.');
      return { success: 0, failed: 0 };
    }

    isGlobalSyncInProgress = true;
    let successCount = 0;
    let failedCount = 0;

    try {
      // 1. Lokale Outbox aus IndexedDB laden
      const pendingMutations = await offlineVault.getPendingOutbox(currentTenantId, currentUserId);
      if (pendingMutations.length === 0) {
        return { success: 0, failed: 0 };
      }

      // 2. Formatieren für den Server-Batch-Endpunkt
      const batchPayload = {
        device_id: offlineVault.getDeviceId(),
        mutations: pendingMutations.map((m) => ({
          client_uuid: m.id,
          entity_type: m.entityType,
          action: m.action,
          client_timestamp: m.occurredAt,
          version: m.baseVersion,
          payload: m.payload
        }))
      };

      // 3. Echte Übertragung an das Backend
      let serverResults: any[] = [];
      try {
        const response = await apiClient.post('/sync/push', batchPayload);
        serverResults = Array.isArray(response) ? response : (response?.data || []);
      } catch (networkErr: any) {
        console.warn('[SYNC NETWORK ERROR] Backend vorübergehend unerreichbar:', networkErr.message);
        // Bei Netzwerkfehler: Einträge verbleiben unverändert in Outbox!
        get().addNotification(
          'Synchronisation pausiert',
          `Server nicht erreichbar (${networkErr.message}). Einträge bleiben lokal gesichert.`,
          'warning'
        );
        return { success: 0, failed: pendingMutations.length };
      }

      // 4. Server-Antworten auswerten
      for (const resItem of serverResults) {
        const outboxMatch = pendingMutations.find((m) => m.id === resItem.client_uuid);
        if (!outboxMatch) continue;

        if (resItem.status === 'SYNCED') {
          // ERST JETZT lokal quittieren und entfernen
          await offlineVault.markSynced(resItem.client_uuid);
          successCount++;
          set((state) => ({
            syncQueue: state.syncQueue.map((q) =>
              q.id === resItem.client_uuid ? { ...q, status: 'synced', errorMessage: undefined } : q
            )
          }));
        } else if (resItem.status === 'CONFLICT') {
          // Als Konflikt markieren, NICHT löschen!
          await offlineVault.updateMutationStatus(resItem.client_uuid, 'CONFLICT', {
            conflictDetails: resItem.conflict_data
          });
          failedCount++;
          set((state) => ({
            syncQueue: state.syncQueue.map((q) =>
              q.id === resItem.client_uuid
                ? { ...q, status: 'conflict', conflictDetails: resItem.conflict_data }
                : q
            )
          }));
        } else {
          // FAILED Status
          await offlineVault.updateMutationStatus(resItem.client_uuid, 'FAILED', {
            errorMessage: resItem.message || 'Server-Verarbeitungsfehler'
          });
          failedCount++;
          set((state) => ({
            syncQueue: state.syncQueue.map((q) =>
              q.id === resItem.client_uuid ? { ...q, status: 'failed', errorMessage: resItem.message } : q
            )
          }));
        }
      }

      if (successCount > 0) {
        get().addNotification(
          'Synchronisation erfolgreich',
          `${successCount} Datensätze erfolgreich an PostgreSQL übertragen.`,
          'info'
        );
      }

      return { success: successCount, failed: failedCount };
    } finally {
      isGlobalSyncInProgress = false;
    }
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

  reportDefinitions: [],

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

  shiftSwaps: [],
  patrolScans: [],
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
        entityType: 'patrol' as any,
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
        entityType: 'handover' as any,
        action: 'CREATE',
        payload: protocol
      });
    }
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
  getTenantReportDefinitions: () => {
    const { reportDefinitions, currentTenantId } = get();
    return (reportDefinitions || []).filter((r) => r.tenantId === currentTenantId);
  },
  getTenantShiftSwaps: () => {
    const { shiftSwaps, currentTenantId } = get();
    return (shiftSwaps || []).filter((s) => s.tenantId === currentTenantId);
  },
  getTenantPatrolScans: () => {
    const { patrolScans, currentTenantId } = get();
    return (patrolScans || []).filter((p) => p.tenantId === currentTenantId);
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
    const { isOnline, currentTenantId, enqueueOfflineAction, employees } = get();
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

    // Wenn Offline: Speichere primär in IndexedDB und verifiziere Erfolg
    if (!isOnline) {
      const savedOk = await enqueueOfflineAction({
        tenantId: currentTenantId,
        entityType: 'guardbook',
        action: 'CREATE',
        payload: newEntry
      });

      if (!savedOk) {
        return false; // Verhindert falsche Erfolgsmeldung im Frontend
      }
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

    return true;
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
    const { currentTenantId } = get();
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
