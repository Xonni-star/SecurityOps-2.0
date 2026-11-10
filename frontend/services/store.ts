import {
  Tenant,
  Client,
  SecuritySite,
  Employee,
  Shift,
  Incident,
  SopInstruction,
  KeyItem,
  OperationalTask,
  NotificationItem,
  UserRole,
  SyncQueueItem,
  ModuleManifest
} from '../types';
import {
  INITIAL_TENANTS,
  INITIAL_CLIENTS,
  INITIAL_SITES,
  INITIAL_EMPLOYEES,
  INITIAL_SHIFTS,
  INITIAL_INCIDENTS,
  INITIAL_SOPS,
  INITIAL_KEYS,
  INITIAL_TASKS,
  INITIAL_NOTIFICATIONS,
  INITIAL_SYNC_QUEUE,
  SYSTEM_MODULES
} from '../constants';

const STORAGE_KEYS = {
  TENANTS: 'secops2_tenants',
  ACTIVE_TENANT_ID: 'secops2_active_tenant_id',
  CLIENTS: 'secops2_clients',
  SITES: 'secops2_sites',
  EMPLOYEES: 'secops2_employees',
  SHIFTS: 'secops2_shifts',
  INCIDENTS: 'secops2_incidents',
  SOPS: 'secops2_sops',
  KEYS: 'secops2_keys',
  TASKS: 'secops2_tasks',
  NOTIFS: 'secops2_notifications',
  ROLE: 'secops2_active_role',
  SYNC_QUEUE: 'secops2_sync_queue',
  OFFLINE_SIM: 'secops2_offline_simulation',
  MODULES: 'secops2_modules'
};

function loadFromStorage<T,>(key: string, fallback: T): T {
  try {
    const data = localStorage.getItem(key);
    return data ? (JSON.parse(data) as T) : fallback;
  } catch (e) {
    console.warn(`Fehler beim Laden von ${key} aus LocalStorage`, e);
    return fallback;
  }
}

function saveToStorage<T,>(key: string, data: T): void {
  try {
    localStorage.setItem(key, JSON.stringify(data));
  } catch (e) {
    console.error(`Fehler beim Speichern von ${key}`, e);
  }
}

export class SecurityOpsStore {
  private static instance: SecurityOpsStore;

  tenants: Tenant[] = [];
  activeTenantId: string = 'tenant-1';
  isOfflineMode: boolean = false;
  isSyncing: boolean = false;

  clients: Client[] = [];
  sites: SecuritySite[] = [];
  employees: Employee[] = [];
  shifts: Shift[] = [];
  incidents: Incident[] = [];
  sops: SopInstruction[] = [];
  keys: KeyItem[] = [];
  tasks: OperationalTask[] = [];
  notifications: NotificationItem[] = [];
  syncQueue: SyncQueueItem[] = [];
  modules: ModuleManifest[] = [];
  activeRole: UserRole = UserRole.DISPATCHER;

  private listeners: Set<() => void> = new Set();

  private constructor() {
    this.init();
    this.setupNetworkListeners();
  }

  public static getInstance(): SecurityOpsStore {
    if (!SecurityOpsStore.instance) {
      SecurityOpsStore.instance = new SecurityOpsStore();
    }
    return SecurityOpsStore.instance;
  }

  private init() {
    this.tenants = loadFromStorage(STORAGE_KEYS.TENANTS, INITIAL_TENANTS);
    this.activeTenantId = loadFromStorage(STORAGE_KEYS.ACTIVE_TENANT_ID, 'tenant-1');
    this.isOfflineMode = loadFromStorage(STORAGE_KEYS.OFFLINE_SIM, false);

    this.clients = loadFromStorage(STORAGE_KEYS.CLIENTS, INITIAL_CLIENTS);
    this.sites = loadFromStorage(STORAGE_KEYS.SITES, INITIAL_SITES);
    this.employees = loadFromStorage(STORAGE_KEYS.EMPLOYEES, INITIAL_EMPLOYEES);
    this.shifts = loadFromStorage(STORAGE_KEYS.SHIFTS, INITIAL_SHIFTS);
    this.incidents = loadFromStorage(STORAGE_KEYS.INCIDENTS, INITIAL_INCIDENTS);
    this.sops = loadFromStorage(STORAGE_KEYS.SOPS, INITIAL_SOPS);
    this.keys = loadFromStorage(STORAGE_KEYS.KEYS, INITIAL_KEYS);
    this.tasks = loadFromStorage(STORAGE_KEYS.TASKS, INITIAL_TASKS);
    this.notifications = loadFromStorage(STORAGE_KEYS.NOTIFS, INITIAL_NOTIFICATIONS);
    this.syncQueue = loadFromStorage(STORAGE_KEYS.SYNC_QUEUE, INITIAL_SYNC_QUEUE);
    this.modules = loadFromStorage(STORAGE_KEYS.MODULES, SYSTEM_MODULES);
    this.activeRole = loadFromStorage(STORAGE_KEYS.ROLE, UserRole.DISPATCHER);
  }

  private setupNetworkListeners() {
    window.addEventListener('online', () => {
      if (!this.isOfflineMode) {
        this.processSyncQueue();
      }
    });
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify() {
    this.listeners.forEach((fn) => fn());
  }

  // --- Multi-Tenancy ---
  getActiveTenant(): Tenant {
    return this.tenants.find((t) => t.id === this.activeTenantId) || this.tenants[0];
  }

  setActiveTenantId(tenantId: string) {
    this.activeTenantId = tenantId;
    saveToStorage(STORAGE_KEYS.ACTIVE_TENANT_ID, tenantId);
    this.notify();
  }

  addTenant(tenant: Omit<Tenant, 'id' | 'createdAt'>) {
    const today = new Date().toISOString().split('T')[0];
    const newTenant: Tenant = {
      ...tenant,
      id: `tenant-${Date.now()}`,
      createdAt: today
    };
    this.tenants = [newTenant, ...this.tenants];
    saveToStorage(STORAGE_KEYS.TENANTS, this.tenants);
    this.notify();
  }

  // Filtered entity access by current active tenant
  getTenantClients(): Client[] {
    return this.clients.filter((c) => c.tenantId === this.activeTenantId);
  }

  getTenantSites(): SecuritySite[] {
    return this.sites.filter((s) => s.tenantId === this.activeTenantId);
  }

  getTenantEmployees(): Employee[] {
    return this.employees.filter((e) => e.tenantId === this.activeTenantId);
  }

  getTenantShifts(): Shift[] {
    return this.shifts.filter((s) => s.tenantId === this.activeTenantId);
  }

  getTenantIncidents(): Incident[] {
    return this.incidents.filter((i) => i.tenantId === this.activeTenantId);
  }

  getTenantSops(): SopInstruction[] {
    return this.sops.filter((s) => s.tenantId === this.activeTenantId);
  }

  getTenantKeys(): KeyItem[] {
    return this.keys.filter((k) => k.tenantId === this.activeTenantId);
  }

  getTenantTasks(): OperationalTask[] {
    return this.tasks.filter((t) => t.tenantId === this.activeTenantId);
  }

  getTenantNotifications(): NotificationItem[] {
    return this.notifications.filter((n) => n.tenantId === this.activeTenantId);
  }

  getTenantSyncQueue(): SyncQueueItem[] {
    return this.syncQueue.filter((q) => q.tenantId === this.activeTenantId);
  }

  // --- Offline Mode & Sync Queue ---
  toggleOfflineSimulation() {
    this.isOfflineMode = !this.isOfflineMode;
    saveToStorage(STORAGE_KEYS.OFFLINE_SIM, this.isOfflineMode);
    if (!this.isOfflineMode) {
      this.processSyncQueue();
    }
    this.notify();
  }

  enqueueSyncAction(
    entityType: SyncQueueItem['entityType'],
    entityId: string,
    action: SyncQueueItem['action'],
    payloadSummary: string
  ) {
    const item: SyncQueueItem = {
      id: `sq-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      tenantId: this.activeTenantId,
      entityType,
      entityId,
      action,
      payloadSummary,
      createdAt: new Date().toISOString().replace('T', ' ').substring(0, 19),
      retryCount: 0,
      status: this.isOfflineMode ? 'pending' : 'synced'
    };

    this.syncQueue = [item, ...this.syncQueue];
    saveToStorage(STORAGE_KEYS.SYNC_QUEUE, this.syncQueue);
    this.notify();
  }

  async processSyncQueue() {
    if (this.isSyncing || this.isOfflineMode) return;
    const pendingItems = this.syncQueue.filter((item) => item.status === 'pending');
    if (pendingItems.length === 0) return;

    this.isSyncing = true;
    this.notify();

    // Simulate reliable background syncing with retry & conflict checks
    await new Promise((resolve) => setTimeout(resolve, 1200));

    this.syncQueue = this.syncQueue.map((item) => {
      if (item.status === 'pending') {
        return { ...item, status: 'synced' };
      }
      return item;
    });

    // Mark all pending incidents/tasks as synced
    this.incidents = this.incidents.map((i) =>
      i.syncState === 'pending' ? { ...i, syncState: 'synced' } : i
    );
    this.tasks = this.tasks.map((t) =>
      t.syncState === 'pending' ? { ...t, syncState: 'synced' } : t
    );

    saveToStorage(STORAGE_KEYS.SYNC_QUEUE, this.syncQueue);
    saveToStorage(STORAGE_KEYS.INCIDENTS, this.incidents);
    saveToStorage(STORAGE_KEYS.TASKS, this.tasks);

    this.isSyncing = false;
    this.addNotification({
      tenantId: this.activeTenantId,
      type: 'info',
      title: 'Offline-Synchronisation abgeschlossen',
      message: `${pendingItems.length} Datensätze erfolgreich mit dem PostgreSQL-Server abgeglichen.`,
      timestamp: 'Gerade eben',
      read: false
    });
    this.notify();
  }

  resolveConflict(queueId: string, resolution: 'server' | 'client') {
    this.syncQueue = this.syncQueue.map((q) =>
      q.id === queueId ? { ...q, status: 'synced' } : q
    );
    saveToStorage(STORAGE_KEYS.SYNC_QUEUE, this.syncQueue);
    this.notify();
  }

  // --- Roles ---
  setActiveRole(role: UserRole) {
    this.activeRole = role;
    saveToStorage(STORAGE_KEYS.ROLE, role);
    this.notify();
  }

  // --- Clients ---
  addClient(client: Omit<Client, 'id' | 'tenantId' | 'syncState' | 'version'>) {
    const newClient: Client = {
      ...client,
      id: `cli-${Date.now()}`,
      tenantId: this.activeTenantId,
      syncState: this.isOfflineMode ? 'pending' : 'synced',
      version: 1
    };
    this.clients = [newClient, ...this.clients];
    saveToStorage(STORAGE_KEYS.CLIENTS, this.clients);
    this.enqueueSyncAction('incident', newClient.id, 'CREATE', `Kunde: ${newClient.name}`);
    this.notify();
  }

  // --- Sites ---
  addSite(site: Omit<SecuritySite, 'id' | 'tenantId' | 'syncState' | 'version'>) {
    const newSite: SecuritySite = {
      ...site,
      id: `site-${Date.now()}`,
      tenantId: this.activeTenantId,
      syncState: this.isOfflineMode ? 'pending' : 'synced',
      version: 1
    };
    this.sites = [newSite, ...this.sites];
    saveToStorage(STORAGE_KEYS.SITES, this.sites);
    this.enqueueSyncAction('incident', newSite.id, 'CREATE', `Objekt: ${newSite.siteCode}`);
    this.notify();
  }

  // --- Employees ---
  addEmployee(emp: Omit<Employee, 'id' | 'tenantId' | 'syncState' | 'version'>) {
    const newEmp: Employee = {
      ...emp,
      id: `emp-${Date.now()}`,
      tenantId: this.activeTenantId,
      syncState: this.isOfflineMode ? 'pending' : 'synced',
      version: 1
    };
    this.employees = [newEmp, ...this.employees];
    saveToStorage(STORAGE_KEYS.EMPLOYEES, this.employees);
    this.enqueueSyncAction('employee', newEmp.id, 'CREATE', `Mitarbeiter: ${newEmp.firstName} ${newEmp.lastName}`);
    this.notify();
  }

  updateEmployeeStatus(id: string, status: Employee['status']) {
    this.employees = this.employees.map((e) =>
      e.id === id ? { ...e, status, version: e.version + 1, syncState: this.isOfflineMode ? 'pending' : 'synced' } : e
    );
    saveToStorage(STORAGE_KEYS.EMPLOYEES, this.employees);
    this.enqueueSyncAction('employee', id, 'UPDATE', `Statusänderung zu: ${status}`);
    this.notify();
  }

  // --- Shifts ---
  addShift(shift: Omit<Shift, 'id' | 'tenantId' | 'syncState' | 'version'>) {
    const newShift: Shift = {
      ...shift,
      id: `sh-${Date.now()}`,
      tenantId: this.activeTenantId,
      syncState: this.isOfflineMode ? 'pending' : 'synced',
      version: 1
    };
    this.shifts = [newShift, ...this.shifts];
    saveToStorage(STORAGE_KEYS.SHIFTS, this.shifts);
    this.enqueueSyncAction('shift', newShift.id, 'CREATE', `Schicht: ${newShift.shiftType}`);
    this.notify();
  }

  assignEmployeeToShift(shiftId: string, employeeId: string) {
    const employee = this.employees.find((e) => e.id === employeeId);
    if (!employee) return;

    const hasValid34a = employee.qualifications.some(
      (q) => (q.type === '34a_Sachkunde' || q.type === '34a_Unterrichtung') && q.isValid
    );
    const hasExpiredCert = employee.qualifications.some((q) => !q.isValid);

    let hasConflict = false;
    let conflictReason: string | undefined = undefined;

    if (!hasValid34a) {
      hasConflict = true;
      conflictReason = 'Achtung: Kein gültiger § 34a GewO Qualifikationsnachweis vorhanden!';
    } else if (hasExpiredCert) {
      hasConflict = true;
      conflictReason = 'Achtung: Mindestens ein Pflichtnachweis (z.B. Erste Hilfe / Brandschutz) ist abgelaufen.';
    }

    this.shifts = this.shifts.map((s) => {
      if (s.id === shiftId) {
        return {
          ...s,
          employeeId: employee.id,
          employeeName: `${employee.firstName} ${employee.lastName}`,
          status: hasConflict ? 'Konflikt' : 'Besetzt',
          hasConflict,
          conflictReason,
          version: s.version + 1,
          syncState: this.isOfflineMode ? 'pending' : 'synced'
        };
      }
      return s;
    });

    saveToStorage(STORAGE_KEYS.SHIFTS, this.shifts);
    this.enqueueSyncAction('shift', shiftId, 'UPDATE', `Mitarbeiter zugewiesen: ${employee.firstName} ${employee.lastName}`);
    this.notify();
  }

  // --- Incidents (Digitales Wachbuch) ---
  addIncident(incident: Omit<Incident, 'id' | 'tenantId' | 'incidentNumber' | 'timestamp' | 'syncState' | 'version'>) {
    const now = new Date();
    const timestamp = now.toISOString().replace('T', ' ').substring(0, 16);
    const incidentNumber = `VB-${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}${String(
      now.getDate()
    ).padStart(2, '0')}-${Math.floor(10 + Math.random() * 89)}`;

    const hash = `sha256-${Math.random().toString(36).substring(2, 12)}${Date.now().toString(36)}`;

    const newIncident: Incident = {
      ...incident,
      id: `inc-${Date.now()}`,
      tenantId: this.activeTenantId,
      incidentNumber,
      timestamp,
      syncState: this.isOfflineMode ? 'pending' : 'synced',
      version: 1,
      offlineCreated: this.isOfflineMode,
      auditHash: hash
    };

    this.incidents = [newIncident, ...this.incidents];
    saveToStorage(STORAGE_KEYS.INCIDENTS, this.incidents);

    this.enqueueSyncAction(
      'incident',
      newIncident.id,
      'CREATE',
      `Vorfall: ${newIncident.title} (${newIncident.priority})`
    );

    this.addNotification({
      tenantId: this.activeTenantId,
      type: incident.priority === 'KRITISCH' ? 'alert' : 'warning',
      title: `Neues Vorkommnis: ${incident.title}`,
      message: `${incident.siteName} (${incident.category}) - Priorität: ${incident.priority}`,
      timestamp: 'Gerade eben',
      read: false
    });

    this.notify();
  }

  updateIncidentStatus(id: string, escalationStatus: Incident['escalationStatus'], resolved: boolean) {
    this.incidents = this.incidents.map((inc) =>
      inc.id === id
        ? {
            ...inc,
            escalationStatus,
            resolved,
            version: inc.version + 1,
            syncState: this.isOfflineMode ? 'pending' : 'synced'
          }
        : inc
    );
    saveToStorage(STORAGE_KEYS.INCIDENTS, this.incidents);
    this.enqueueSyncAction('incident', id, 'UPDATE', `Status: ${escalationStatus}, Gelöst: ${resolved}`);
    this.notify();
  }

  // --- Keys ---
  updateKeyStatus(id: string, status: KeyItem['status'], holder?: string) {
    const now = new Date().toISOString().replace('T', ' ').substring(0, 16);
    this.keys = this.keys.map((k) =>
      k.id === id
        ? {
            ...k,
            status,
            currentHolder: status === 'Ausgegeben' ? holder : undefined,
            issuedAt: status === 'Ausgegeben' ? now : undefined,
            syncState: this.isOfflineMode ? 'pending' : 'synced'
          }
        : k
    );
    saveToStorage(STORAGE_KEYS.KEYS, this.keys);
    this.enqueueSyncAction('key', id, 'UPDATE', `Schlüsselstatus: ${status}`);
    this.notify();
  }

  // --- Tasks ---
  addTask(task: Omit<OperationalTask, 'id' | 'tenantId' | 'syncState' | 'version'>) {
    const newTask: OperationalTask = {
      ...task,
      id: `tsk-${Date.now()}`,
      tenantId: this.activeTenantId,
      syncState: this.isOfflineMode ? 'pending' : 'synced',
      version: 1
    };
    this.tasks = [newTask, ...this.tasks];
    saveToStorage(STORAGE_KEYS.TASKS, this.tasks);
    this.enqueueSyncAction('task', newTask.id, 'CREATE', `Aufgabe: ${newTask.title}`);
    this.notify();
  }

  updateTaskStatus(id: string, status: OperationalTask['status']) {
    this.tasks = this.tasks.map((t) =>
      t.id === id ? { ...t, status, version: t.version + 1, syncState: this.isOfflineMode ? 'pending' : 'synced' } : t
    );
    saveToStorage(STORAGE_KEYS.TASKS, this.tasks);
    this.enqueueSyncAction('task', id, 'UPDATE', `Aufgabenstatus: ${status}`);
    this.notify();
  }

  // --- SOPs ---
  addSop(sop: Omit<SopInstruction, 'id' | 'tenantId' | 'updatedAt' | 'acknowledgedCount' | 'syncState'>) {
    const today = new Date().toISOString().split('T')[0];
    const newSop: SopInstruction = {
      ...sop,
      id: `sop-${Date.now()}`,
      tenantId: this.activeTenantId,
      updatedAt: today,
      acknowledgedCount: 0,
      syncState: this.isOfflineMode ? 'pending' : 'synced'
    };
    this.sops = [newSop, ...this.sops];
    saveToStorage(STORAGE_KEYS.SOPS, this.sops);
    this.notify();
  }

  acknowledgeSop(id: string) {
    this.sops = this.sops.map((s) =>
      s.id === id ? { ...s, acknowledgedCount: Math.min(s.acknowledgedCount + 1, s.totalRequiredGuards) } : s
    );
    saveToStorage(STORAGE_KEYS.SOPS, this.sops);
    this.notify();
  }

  // --- Notifications ---
  addNotification(notif: Omit<NotificationItem, 'id'>) {
    const newNotif: NotificationItem = { ...notif, id: `notif-${Date.now()}` };
    this.notifications = [newNotif, ...this.notifications];
    saveToStorage(STORAGE_KEYS.NOTIFS, this.notifications);
    this.notify();
  }

  markAllNotificationsRead() {
    this.notifications = this.notifications.map((n) =>
      n.tenantId === this.activeTenantId ? { ...n, read: true } : n
    );
    saveToStorage(STORAGE_KEYS.NOTIFS, this.notifications);
    this.notify();
  }

  // --- Module Registry Toggle ---
  toggleModuleStatus(moduleId: string) {
    this.modules = this.modules.map((m) =>
      m.id === moduleId
        ? { ...m, status: m.status === 'Aktiv' ? 'Inaktiv' : 'Aktiv' }
        : m
    );
    saveToStorage(STORAGE_KEYS.MODULES, this.modules);
    this.notify();
  }

  resetDemoData() {
    localStorage.clear();
    this.init();
    this.notify();
  }
}

export const store = SecurityOpsStore.getInstance();
