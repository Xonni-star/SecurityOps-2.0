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

interface SecurityOpsStore {
  // Theme
  theme: ThemeMode;
  toggleTheme: () => void;

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
  addClient: (client: Omit<Client, 'id' | 'tenantId'>) => void;
  addSite: (site: Omit<Site, 'id' | 'tenantId'>) => void;
  addEmployee: (emp: Omit<Employee, 'id' | 'tenantId'>) => void;
  updateEmployee: (id: string, updates: Partial<Employee>) => void;
  addShift: (shift: Omit<Shift, 'id' | 'tenantId'>) => void;
  assignShiftEmployee: (shiftId: string, employeeId: string, employeeName: string) => void;
  addGuardBookEntry: (entry: Omit<GuardBookEntry, 'id' | 'timestamp' | 'tenantId'>) => Promise<void>;
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
        baseVersion: 1
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

      const syncPayload = {
        deviceId: offlineVault.getDeviceId(),
        mutations: pendingItems.map((p) => ({
          clientUuid: p.id,
          entityType: p.entityType,
          action: p.action,
          clientTimestamp: p.occurredAt,
          baseVersion: p.baseVersion,
          payload: p.payload
        }))
      };

      let serverResponse: any = null;
      try {
        serverResponse = await apiClient.post('/sync/push', syncPayload);
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

      if (serverResponse && Array.isArray(serverResponse)) {
        for (const receipt of serverResponse) {
          if (receipt.status === 'SYNCED') {
            successCount++;
            await offlineVault.markSynced(receipt.clientUuid);
          } else if (receipt.status === 'CONFLICT') {
            conflictCount++;
            await offlineVault.updateMutationStatus(receipt.clientUuid, 'CONFLICT', {
              conflictDetails: receipt.conflictData
            });
          } else {
            failedCount++;
            await offlineVault.updateMutationStatus(receipt.clientUuid, 'FAILED', {
              errorMessage: receipt.message || 'Server hat Mutation abgewiesen'
            });
          }
        }
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
    const { currentTenantId } = get();
    const newEmp: Employee = { ...e, tenantId: currentTenantId, id: `e-${Date.now()}` };
    set((state) => ({ employees: [newEmp, ...state.employees] }));
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
    const { employees } = get();
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
    const { currentTenantId } = get();
    const newTask: TaskItem = {
      ...t,
      id: `t-${Date.now()}`,
      tenantId: currentTenantId
    };
    set((state) => ({
      tasks: [newTask, ...state.tasks]
    }));
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
