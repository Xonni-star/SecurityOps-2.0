import { describe, test, expect, beforeEach, vi } from 'vitest';

vi.mock('../services/apiClient', () => {
  const apiClient = {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
    setCsrfToken: vi.fn(),
    getTenantId: vi.fn(() => 'tenant-frankfurt'),
    setTenantId: vi.fn()
  };

  class ApiError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  }

  return { apiClient, ApiError };
});

import { useSecurityStore } from '../store';
import { apiClient } from '../services/apiClient';
import { offlineVault, type StoredSOPAcknowledgement } from '../services/indexedDbService';

const mockedApi = apiClient as unknown as {
  get: ReturnType<typeof vi.fn>;
  post: ReturnType<typeof vi.fn>;
  patch: ReturnType<typeof vi.fn>;
  setCsrfToken: ReturnType<typeof vi.fn>;
  post: ReturnType<typeof vi.fn>;
};
const durableSOPQueue = new Map<string, StoredSOPAcknowledgement>();

function acknowledgementKey(ack: StoredSOPAcknowledgement): string {
  return [ack.tenantId, ack.userId, ack.assignmentId, ack.versionId].join(':');
}

const customerRow = {
  id: '11111111-1111-1111-1111-111111111111',
  client_number: 'KUN-API-1',
  company_name: 'API Test GmbH',
  contact_person: 'Max Test',
  email: 'max@test.de',
  phone: '+49 69 123',
  address: 'Teststraße 1',
  contract_start: '2026-01-01',
  contract_end: '2028-12-31',
  sla_level: 'Gold (24/7 Vor-Ort)',
  billing_status: 'Regulär'
};

const siteRow = {
  id: '22222222-2222-2222-2222-222222222222',
  client_id: customerRow.id,
  client_name: customerRow.company_name,
  site_code: 'OBJ-API-1',
  name: 'API Objekt',
  address: 'Objektweg 2',
  security_level: 'Hoch (KRITIS / BSI)',
  required_guards_day: 2,
  required_guards_night: 1,
  alarm_system: 'EMA',
  access_rules: 'Zutrittskontrolle'
};

const employeeRow = {
  id: '33333333-3333-3333-3333-333333333333',
  personnel_number: 'MA-API-1',
  first_name: 'Erika',
  last_name: 'Muster',
  email: 'erika@test.de',
  phone: '+49 171 123',
  role: 'Wachdienstmitarbeiter',
  status: 'Aktiv',
  weekly_hours: 40,
  hourly_rate: 19.5,
  date_of_joining: '2024-01-01'
};

const logbookRow = {
  id: '44444444-4444-4444-4444-444444444444',
  site_id: siteRow.id,
  site_name: siteRow.name,
  guard_id: employeeRow.id,
  guard_name: 'Erika Muster',
  entry_timestamp: '2026-11-11T10:00:00.000Z',
  category: 'Routinemeldung',
  priority: 'Normal',
  stage: 'Erfasst',
  title: 'API Wachbucheintrag',
  description: 'Aus PostgreSQL geladen',
  police_involved: false,
  resolved: false
};

function mockReadEndpoints(): void {
  mockedApi.get.mockImplementation((endpoint: string) => {
    switch (endpoint) {
      case '/customers':
        return Promise.resolve([customerRow]);
      case '/sites':
        return Promise.resolve([siteRow]);
      case '/employees':
        return Promise.resolve([employeeRow]);
      case '/logbook':
        return Promise.resolve([logbookRow]);
      case '/shifts':
        return Promise.resolve([]);
      case '/keys':
        return Promise.resolve([]);
      case '/tasks':
        return Promise.resolve([]);
      case '/sops':
        return Promise.resolve([]);
      default:
        return Promise.reject(new Error(`Unerwarteter Endpunkt: ${endpoint}`));
    }
  });
}

function makeSOP(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sop-ack-test',
    assignmentId: 'assignment-ack-test',
    tenantId: 'tenant-frankfurt',
    sopNumber: 'DA-1',
    title: 'Testanweisung',
    category: 'Allgemeine Dienstanweisung',
    version: '1',
    versionId: 'version-1',
    effectiveDate: '2026-01-01',
    author: 'QM',
    content: 'Test',
    mandatoryAcknowledgment: true,
    currentUserAcknowledgment: 'unacknowledged' as const,
    ...overrides
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.restoreAllMocks();
  localStorage.clear();
  durableSOPQueue.clear();
  vi.spyOn(offlineVault, 'enqueueSOPAcknowledgement').mockImplementation(async (acknowledgement) => {
    const key = acknowledgementKey(acknowledgement);
    const existing = [...durableSOPQueue.values()].find((item) => acknowledgementKey(item) === key);
    if (existing) return { acknowledgement: existing, created: false };
    durableSOPQueue.set(acknowledgement.clientMutationId, acknowledgement);
    return { acknowledgement, created: true };
  });
  vi.spyOn(offlineVault, 'getSOPAcknowledgements').mockImplementation(async (tenantId, userId) =>
    [...durableSOPQueue.values()].filter((item) => item.tenantId === tenantId && item.userId === userId)
  );
  vi.spyOn(offlineVault, 'updateSOPAcknowledgement').mockImplementation(async (clientMutationId, status) => {
    const item = durableSOPQueue.get(clientMutationId);
    if (item) durableSOPQueue.set(clientMutationId, { ...item, status });
  });
  vi.spyOn(offlineVault, 'removeSOPAcknowledgement').mockImplementation(async (clientMutationId) => {
    durableSOPQueue.delete(clientMutationId);
  });
  useSecurityStore.setState({
    clients: [],
    sites: [],
    employees: [],
    guardBook: [],
    shifts: [],
    keys: [],
    tasks: [],
    notifications: [],
    authUser: null,
    currentTenantId: 'tenant-frankfurt',
    currentUserId: 'user-regression',
    sops: [],
    pendingSOPAcknowledgements: [],
    isAuthenticated: false,
    isAuthenticating: false,
    authError: null,
    isLoadingData: false,
    isOnline: true,
    syncQueue: [],
    dataLoadError: null
  });
});

describe('SecurityOps 2.0 – Frontend/Backend-Integration', () => {
  test('Wiederverbindung startet automatisch die Synchronisierung der Offline-Outbox', () => {
    const originalSync = useSecurityStore.getState().triggerManualSync;
    const syncPatrolOutbox = vi.fn();
    useSecurityStore.setState({ triggerManualSync: syncPatrolOutbox });

    window.dispatchEvent(new Event('online'));

    expect(syncPatrolOutbox).toHaveBeenCalledOnce();
    useSecurityStore.setState({ triggerManualSync: originalSync });
  });

  test('1. loadTenantData hydratisiert Kunden, Objekte, Mitarbeiter und Wachbuch aus der API', async () => {
    mockReadEndpoints();

    await useSecurityStore.getState().loadTenantData();

    const state = useSecurityStore.getState();
    expect(state.clients).toHaveLength(1);
    expect(state.clients[0].companyName).toBe('API Test GmbH');
    expect(state.clients[0].id).toBe(customerRow.id);

    expect(state.sites[0].name).toBe('API Objekt');
    expect(state.sites[0].clientName).toBe(customerRow.company_name);

    expect(state.employees[0].lastName).toBe('Muster');
    expect(state.employees[0].weeklyHours).toBe(40);

    expect(state.guardBook[0].title).toBe('API Wachbucheintrag');
    expect(state.guardBook[0].siteId).toBe(siteRow.id);
    expect(state.isLoadingData).toBe(false);
    expect(state.dataLoadError).toBeNull();
  });

  test('replays the authenticated outbox after restoring a session while already online', async () => {
    mockReadEndpoints();
    const readEndpoint = mockedApi.get.getMockImplementation();
    mockedApi.get.mockImplementation((endpoint: string) => endpoint === '/auth/me'
      ? Promise.resolve({
        id: 'restored-user',
        tenantId: 'tenant-frankfurt',
        permissions: ['shifts:manage']
      })
      : readEndpoint!(endpoint));
    const queued = {
      id: 'restored-shift-mutation',
      tenantId: 'tenant-frankfurt',
      userId: 'restored-user',
      entityType: 'shift',
      action: 'CREATE',
      payload: { siteId: siteRow.id, date: '2026-11-13' },
      occurredAt: '2026-11-13T10:00:00.000Z',
      baseVersion: 1,
      retryCount: 0,
      status: 'PENDING'
    };
    vi.spyOn(offlineVault, 'getPendingOutbox').mockResolvedValue([queued] as any);
    vi.spyOn(offlineVault, 'getOutbox').mockResolvedValue([]);
    vi.spyOn(offlineVault, 'markSynced').mockResolvedValue(undefined);
    mockedApi.post.mockResolvedValueOnce([{
      clientUuid: queued.id,
      serverId: 'server-shift',
      status: 'SYNCED',
      serverVersion: 1
    }]);

    await useSecurityStore.getState().restoreSession();
    await vi.waitFor(() => expect(mockedApi.post).toHaveBeenCalledWith('/sync/push', expect.objectContaining({
      mutations: [expect.objectContaining({ clientUuid: queued.id })]
    })));

    expect(useSecurityStore.getState().currentUserId).toBe('restored-user');
    expect(offlineVault.getPendingOutbox).toHaveBeenCalledWith('tenant-frankfurt', 'restored-user');
    expect(offlineVault.markSynced).toHaveBeenCalledWith(queued.id);
  });

  test('replays only exact current-user ownership in a same-tenant outbox and quarantines unknown owners', async () => {
    const ownerA = {
      id: 'owner-a-mutation', tenantId: 'tenant-frankfurt', userId: 'user-a',
      entityType: 'shift', action: 'CREATE', payload: { date: '2026-11-13' },
      occurredAt: '2026-11-13T10:00:00.000Z', baseVersion: 1, retryCount: 0, status: 'PENDING'
    };
    const ownerB = {
      ...ownerA, id: 'owner-b-mutation', userId: 'user-b', entityType: 'handover'
    };
    const unknownOwner = {
      ...ownerA, id: 'unknown-owner-mutation', userId: undefined, entityType: 'task'
    };
    vi.spyOn(offlineVault, 'getPendingOutbox').mockResolvedValue([ownerA, ownerB, unknownOwner] as any);
    vi.spyOn(offlineVault, 'getOutbox').mockResolvedValue([{ ...ownerB, status: 'SYNCED' }] as any);
    vi.spyOn(offlineVault, 'markSynced').mockResolvedValue(undefined);
    mockedApi.post.mockResolvedValueOnce([{
      clientUuid: ownerB.id,
      serverId: 'server-shift-b',
      status: 'SYNCED',
      serverVersion: 1
    }]);
    useSecurityStore.setState({
      isOnline: true,
      currentTenantId: 'tenant-frankfurt',
      currentUserId: 'user-b',
      isAuthenticated: true,
      authUser: {
        id: 'user-b', email: '', fullName: '', role: '',
        tenantId: 'tenant-frankfurt', tenantName: '', permissions: ['shifts:manage']
      }
    });

    const result = await useSecurityStore.getState().triggerManualSync();

    expect(result).toMatchObject({ success: 1, failed: 0, conflicts: 0 });
    expect(offlineVault.getPendingOutbox).toHaveBeenCalledWith('tenant-frankfurt', 'user-b');
    expect(mockedApi.post).toHaveBeenCalledWith('/handovers/sync', expect.objectContaining({
      mutations: [expect.objectContaining({ clientUuid: ownerB.id })]
    }));
    expect(JSON.stringify(mockedApi.post.mock.calls)).not.toContain(ownerA.id);
    expect(JSON.stringify(mockedApi.post.mock.calls)).not.toContain(unknownOwner.id);
    expect(useSecurityStore.getState().syncQueue.map(item => item.userId)).toEqual(['user-b']);
  });

  test('loadTenantData überspringt /sops ohne sop:read oder sop:manage', async () => {
    mockReadEndpoints();
    useSecurityStore.setState({
      authUser: { id: 'read-limited', email: 'limited@example.test', fullName: 'Read limited', role: '', tenantId: 'tenant-frankfurt', tenantName: '', permissions: ['customers:read'] }
    });

    await useSecurityStore.getState().loadTenantData();

    expect(mockedApi.get).not.toHaveBeenCalledWith('/sops');
    expect(useSecurityStore.getState().dataLoadError).toBeNull();
  });

  test('loadTenantData lädt /sops für sop:read', async () => {
    mockReadEndpoints();
    useSecurityStore.setState({
      authUser: { id: 'sop-reader', email: 'reader@example.test', fullName: 'Reader', role: '', tenantId: 'tenant-frankfurt', tenantName: '', permissions: ['sop:read'] }
    });

    await useSecurityStore.getState().loadTenantData();

    expect(mockedApi.get).toHaveBeenCalledWith('/sops');
  });

  test('offline capture is durably bound to user, tenant, assignment and exact version before showing pending', async () => {
    const sop = makeSOP();
    useSecurityStore.setState({
      sops: [sop], isOnline: false, pendingSOPAcknowledgements: [], currentTenantId: 'tenant-frankfurt',
      authUser: { id: 'user-regression', email: '', fullName: '', role: '', tenantId: 'tenant-frankfurt', tenantName: '', permissions: ['sop:read'] }
    });

    expect(await useSecurityStore.getState().acknowledgeSOP(sop.id)).toBe(true);
    expect([...durableSOPQueue.values()]).toEqual([
      expect.objectContaining({
        tenantId: 'tenant-frankfurt', userId: 'user-regression', sopId: sop.id,
        assignmentId: sop.assignmentId, versionId: sop.versionId, capturedAt: expect.any(String),
        clientMutationId: expect.any(String), status: 'pending'
      })
    ]);
    expect(useSecurityStore.getState().sops[0].currentUserAcknowledgment).toBe('pending');
    expect(localStorage.getItem('sop-acknowledgements:tenant-frankfurt:user-regression')).toBeNull();
    expect(mockedApi.post).not.toHaveBeenCalled();
  });

  test('does not show pending when durable IndexedDB persistence fails', async () => {
    const sop = makeSOP();
    vi.spyOn(offlineVault, 'enqueueSOPAcknowledgement').mockRejectedValueOnce(new Error('IndexedDB unavailable'));
    useSecurityStore.setState({
      sops: [sop], isOnline: false, pendingSOPAcknowledgements: [],
      authUser: { id: 'user-regression', email: '', fullName: '', role: '', tenantId: 'tenant-frankfurt', tenantName: '', permissions: ['sop:read'] }
    });

    expect(await useSecurityStore.getState().acknowledgeSOP(sop.id)).toBe(false);
    expect(useSecurityStore.getState().sops[0].currentUserAcknowledgment).toBe('unacknowledged');
    expect(useSecurityStore.getState().pendingSOPAcknowledgements).toHaveLength(0);
  });

  test('deduplicates repeated capture of the same assignment revision', async () => {
    const sop = makeSOP();
    useSecurityStore.setState({
      sops: [sop], isOnline: false, pendingSOPAcknowledgements: [],
      authUser: { id: 'user-regression', email: '', fullName: '', role: '', tenantId: 'tenant-frankfurt', tenantName: '', permissions: ['sop:read'] }
    });

    expect(await useSecurityStore.getState().acknowledgeSOP(sop.id)).toBe(true);
    expect(await useSecurityStore.getState().acknowledgeSOP(sop.id)).toBe(true);
    expect(durableSOPQueue.size).toBe(1);
    expect(useSecurityStore.getState().pendingSOPAcknowledgements).toHaveLength(1);
    expect(useSecurityStore.getState().pendingSOPAcknowledgements[0].clientMutationId)
      .toBe([...durableSOPQueue.values()][0].clientMutationId);
  });

  test('re-hydrates after reload and retries failures with the same mutation ID and captured time', async () => {
    const sop = makeSOP();
    useSecurityStore.setState({
      sops: [sop], isOnline: false, pendingSOPAcknowledgements: [], currentTenantId: 'tenant-frankfurt',
      authUser: { id: 'user-regression', email: '', fullName: '', role: '', tenantId: 'tenant-frankfurt', tenantName: '', permissions: ['sop:read'] }
    });
    expect(await useSecurityStore.getState().acknowledgeSOP(sop.id)).toBe(true);
    const captured = [...durableSOPQueue.values()][0];

    mockReadEndpoints();
    mockedApi.get.mockImplementation((endpoint: string) => {
      if (endpoint === '/sops') return Promise.resolve([{
        id: sop.id, assignment_id: sop.assignmentId, version_id: sop.versionId,
        version_number: sop.version, status: 'published'
      }]);
      if (endpoint === '/customers' || endpoint === '/sites' || endpoint === '/employees' ||
        endpoint === '/logbook' || endpoint === '/shifts' || endpoint === '/keys' || endpoint === '/tasks') {
        return Promise.resolve([]);
      }
      return Promise.reject(new Error(`Unerwarteter Endpunkt: ${endpoint}`));
    });
    useSecurityStore.setState({ sops: [], pendingSOPAcknowledgements: [] });
    await useSecurityStore.getState().loadTenantData();
    expect(useSecurityStore.getState().pendingSOPAcknowledgements).toEqual([
      expect.objectContaining({ clientMutationId: captured.clientMutationId, capturedAt: captured.capturedAt })
    ]);

    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
    useSecurityStore.setState({ isOnline: true });
    window.dispatchEvent(new Event('offline'));
    expect(useSecurityStore.getState().isOnline).toBe(false);
    mockedApi.post.mockRejectedValue(new Error('temporärer Fehler'));
    window.dispatchEvent(new Event('online'));
    await vi.waitFor(() => expect(mockedApi.post).toHaveBeenCalledTimes(1));
    expect(useSecurityStore.getState().isOnline).toBe(true);
    expect(durableSOPQueue.get(captured.clientMutationId)).toMatchObject({
      clientMutationId: captured.clientMutationId, capturedAt: captured.capturedAt, status: 'pending'
    });
    expect(useSecurityStore.getState().pendingSOPAcknowledgements).toContainEqual(
      expect.objectContaining({ clientMutationId: captured.clientMutationId, status: 'pending' })
    );
    expect(useSecurityStore.getState().notifications.filter(
      (notification) => notification.title === 'SOP-Synchronisierung ausstehend'
    )).toHaveLength(1);

    window.dispatchEvent(new Event('online'));
    await vi.waitFor(() => expect(mockedApi.post).toHaveBeenCalledTimes(2));
    expect(useSecurityStore.getState().notifications.filter(
      (notification) => notification.title === 'SOP-Synchronisierung ausstehend'
    )).toHaveLength(1);

    mockedApi.post.mockResolvedValueOnce({ acknowledged: true });
    await useSecurityStore.getState().syncPendingSOPAcknowledgements();
    const payloads = mockedApi.post.mock.calls.map((call) => call[1]);
    expect(payloads).toHaveLength(3);
    expect(payloads[0]).toMatchObject({
      confirmed: true, clientMutationId: captured.clientMutationId, capturedAt: captured.capturedAt
    });
    expect(payloads[1]).toEqual(payloads[0]);
    expect(payloads[2]).toEqual(payloads[0]);
    expect(durableSOPQueue.has(captured.clientMutationId)).toBe(false);
    expect(useSecurityStore.getState().sops[0].currentUserAcknowledgment).toBe('confirmed');
  });

  test('marks an acknowledgement stale and never transfers it to a newer revision', async () => {
    const sop = makeSOP();
    useSecurityStore.setState({
      sops: [sop], isOnline: false, pendingSOPAcknowledgements: [],
      authUser: { id: 'user-regression', email: '', fullName: '', role: '', tenantId: 'tenant-frankfurt', tenantName: '', permissions: ['sop:read'] }
    });
    expect(await useSecurityStore.getState().acknowledgeSOP(sop.id)).toBe(true);
    const captured = [...durableSOPQueue.values()][0];
    useSecurityStore.setState({ isOnline: true });
    mockedApi.get.mockResolvedValueOnce([{
      id: sop.id, assignment_id: sop.assignmentId, version_id: 'version-2', version_number: '2', status: 'published'
    }]);
    await useSecurityStore.getState().syncPendingSOPAcknowledgements();

    expect(mockedApi.post).not.toHaveBeenCalled();
    expect(durableSOPQueue.get(captured.clientMutationId)?.status).toBe('stale');
    expect(useSecurityStore.getState().sops[0].currentUserAcknowledgment).toBe('stale');
  });

  test('does not replay a queued acknowledgement after tenant or user switching', async () => {
    const sop = makeSOP();
    useSecurityStore.setState({
      sops: [sop], isOnline: false, pendingSOPAcknowledgements: [],
      authUser: { id: 'user-regression', email: '', fullName: '', role: '', tenantId: 'tenant-frankfurt', tenantName: '', permissions: ['sop:read'] }
    });
    expect(await useSecurityStore.getState().acknowledgeSOP(sop.id)).toBe(true);
    const captured = [...durableSOPQueue.values()][0];

    useSecurityStore.setState({
      isOnline: true, currentTenantId: 'tenant-hamburg', pendingSOPAcknowledgements: [], sops: [makeSOP({ tenantId: 'tenant-hamburg' })],
      authUser: { id: 'different-user', email: '', fullName: '', role: '', tenantId: 'tenant-hamburg', tenantName: '', permissions: ['sop:read'] }
    });
    mockedApi.get.mockResolvedValueOnce([{
      id: sop.id, assignment_id: sop.assignmentId, version_id: sop.versionId, version_number: sop.version, status: 'published'
    }]);
    await useSecurityStore.getState().syncPendingSOPAcknowledgements();

    expect(offlineVault.getSOPAcknowledgements).toHaveBeenCalledWith('tenant-hamburg', 'different-user');
    expect(mockedApi.post).not.toHaveBeenCalled();
    expect(durableSOPQueue.get(captured.clientMutationId)).toEqual(captured);
    expect(useSecurityStore.getState().pendingSOPAcknowledgements).toHaveLength(0);
  });

  test('Wachbucheintrag bleibt manuell erfassbar und wird offline in der mandantengebundenen Outbox gesichert', async () => {
    const mutationWrite = vi.spyOn(offlineVault, 'enqueueMutation').mockResolvedValue({} as any);
    useSecurityStore.setState({
      isOnline: false,
      currentTenantId: 'tenant-frankfurt',
      currentUserId: 'user-regression'
    });

    await useSecurityStore.getState().addGuardBookEntry({
      siteId: siteRow.id,
      siteName: siteRow.name,
      guardId: employeeRow.id,
      guardName: 'Erika Muster',
      category: 'Vorkommnis',
      priority: 'Normal',
      stage: 'Erfasst',
      title: 'Manuell erfasster Vorfall',
      description: 'Sachverhalt wurde von der Wachkraft selbst eingetragen.',
      policeInvolved: false,
      resolved: false
    });

    const state = useSecurityStore.getState();
    expect(state.guardBook).toEqual(expect.arrayContaining([
      expect.objectContaining({ title: 'Manuell erfasster Vorfall', description: 'Sachverhalt wurde von der Wachkraft selbst eingetragen.' })
    ]));
    expect(state.syncQueue[0]).toMatchObject({
      tenantId: 'tenant-frankfurt',
      entityType: 'guardbook',
      action: 'CREATE',
      status: 'pending'
    });
    expect(mutationWrite).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'tenant-frankfurt', entityType: 'guardbook', action: 'CREATE'
    }));
  });

  test('Mitarbeiteränderungen bleiben bis zur bestätigten Outbox-Synchronisierung lokal erhalten', async () => {
    const enqueue = vi.spyOn(offlineVault, 'enqueueMutation').mockResolvedValue({} as any);
    const readPending = vi.spyOn(offlineVault, 'getPendingOutbox').mockResolvedValue([]);
    vi.spyOn(offlineVault, 'getOutbox').mockResolvedValue([]);
    const markSynced = vi.spyOn(offlineVault, 'markSynced').mockResolvedValue(undefined as any);
    vi.spyOn(offlineVault, 'getDeviceId').mockReturnValue('employee-device');
    useSecurityStore.setState({
      isOnline: false, isAuthenticated: true, currentTenantId: 'tenant-frankfurt', currentUserId: 'user-offline',
      authUser: { id: 'user-offline', email: '', fullName: '', role: '', tenantId: 'tenant-frankfurt', tenantName: '', permissions: ['employees:manage'] }
    });

    await useSecurityStore.getState().addEmployee({
      personnelNumber: 'MA-OFFLINE-1',
      firstName: 'Offline',
      lastName: 'Wache',
      email: 'offline.wache@example.test',
      phone: '+49 30 555',
      role: 'Wachdienstmitarbeiter' as any,
      status: 'Aktiv',
      weeklyHours: 40,
      hourlyRate: 19,
      dateOfJoining: '2026-01-01',
      assignedSiteIds: [],
      qualifications: []
    });

    const queued = useSecurityStore.getState().syncQueue[0];
    expect(queued).toMatchObject({ entityType: 'employee', action: 'CREATE', status: 'pending', tenantId: 'tenant-frankfurt' });
    expect(enqueue).toHaveBeenCalledWith(expect.objectContaining({ entityType: 'employee', action: 'CREATE', tenantId: 'tenant-frankfurt' }));
    const queuedMutation = {
      id: queued.id,
      tenantId: queued.tenantId,
      userId: queued.userId,
      entityType: queued.entityType,
      action: queued.action,
      payload: queued.payload,
      occurredAt: new Date().toISOString(),
      baseVersion: 1,
      retryCount: 0,
      status: 'PENDING'
    };
    readPending.mockResolvedValueOnce([queuedMutation] as any);
    mockedApi.post.mockResolvedValueOnce([{ clientUuid: queued.id, status: 'SYNCED', serverVersion: 1, serverId: queued.payload.id }]);
    useSecurityStore.setState({ isOnline: true });

    const result = await useSecurityStore.getState().triggerManualSync();
    expect(result).toMatchObject({ success: 1, failed: 0, conflicts: 0 });
    expect(mockedApi.post).toHaveBeenCalledWith('/employees/sync', expect.objectContaining({
      deviceId: 'employee-device',
      mutations: [expect.objectContaining({ clientUuid: queued.id, entityType: 'employee', action: 'CREATE', baseVersion: 1 })]
    }));
    expect(markSynced).toHaveBeenCalledWith(queued.id);
  });

  test('Mitarbeiter- und Qualifikations-Updates behalten IDs, Revisionen und NULL-Werte in der Outbox', async () => {
    const enqueue = vi.spyOn(offlineVault, 'enqueueMutation').mockResolvedValue({} as any);
    const readPending = vi.spyOn(offlineVault, 'getPendingOutbox').mockResolvedValue([]);
    vi.spyOn(offlineVault, 'getOutbox').mockResolvedValue([]);
    const markSynced = vi.spyOn(offlineVault, 'markSynced').mockResolvedValue(undefined as any);
    vi.spyOn(offlineVault, 'getDeviceId').mockReturnValue('employee-device');
    useSecurityStore.setState({
      isOnline: false,
      isAuthenticated: true,
      currentTenantId: 'tenant-frankfurt',
      currentUserId: 'user-offline',
      authUser: { id: 'user-offline', email: '', fullName: '', role: '', tenantId: 'tenant-frankfurt', tenantName: '', permissions: ['employees:manage'] },
      employees: [{
        id: employeeRow.id, tenantId: 'tenant-frankfurt', revisionVersion: 4, synced: true,
        firstName: 'Erika', lastName: 'Muster', personnelNumber: 'MA-API-1', email: 'erika@test.de',
        phone: '+49 171 123', role: 'Wachdienstmitarbeiter', status: 'Aktiv', weeklyHours: 40,
        hourlyRate: 19.5, dateOfJoining: '2024-01-01', assignedSiteIds: [], archivedAt: null,
        qualifications: [{ id: '55555555-5555-5555-5555-555555555555', type: 'Sachkunde',
          expiryDate: '2027-01-01', issueDate: '2024-01-01', certificateNumber: 'S-1',
          verified: true, status: 'GÜLTIG', revisionVersion: 7 }], absences: []
      } as any]
    });

    await useSecurityStore.getState().updateEmployee(employeeRow.id, { firstName: 'Erika Neu' });
    await useSecurityStore.getState().updateQualification(employeeRow.id,
      '55555555-5555-5555-5555-555555555555', { expiryDate: null });

    const queued = useSecurityStore.getState().syncQueue;
    expect(queued).toHaveLength(2);
    expect(queued.find(item => item.action === 'UPDATE')).toMatchObject({
      entityType: 'employee', baseVersion: 4,
      payload: { id: employeeRow.id, firstName: 'Erika Neu' }
    });
    expect(queued.find(item => item.action === 'QUALIFICATION_UPDATE')).toMatchObject({
      entityType: 'employee', baseVersion: 7,
      payload: { id: '55555555-5555-5555-5555-555555555555', qualificationId: '55555555-5555-5555-5555-555555555555', expiryDate: null }
    });
    expect(enqueue).toHaveBeenCalledTimes(2);

    const asOutbox = (item: (typeof queued)[number]) => ({
      id: item.id, tenantId: item.tenantId, userId: item.userId, entityType: item.entityType, action: item.action,
      payload: item.payload, occurredAt: item.createdAt, baseVersion: item.baseVersion ?? 1,
      retryCount: 0, status: 'PENDING'
    });
    readPending.mockResolvedValueOnce(queued.map(asOutbox) as any);
    mockedApi.post.mockResolvedValueOnce(queued.map(item => ({ clientUuid: item.id, status: 'SYNCED', serverVersion: (item.baseVersion || 1) + 1 })));
    useSecurityStore.setState({ isOnline: true });
    const result = await useSecurityStore.getState().triggerManualSync();
    expect(result).toMatchObject({ success: 2, failed: 0, conflicts: 0 });
    expect(mockedApi.post).toHaveBeenCalledWith('/employees/sync', expect.objectContaining({
      deviceId: 'employee-device',
      mutations: expect.arrayContaining([
        expect.objectContaining({ entityType: 'employee', action: 'UPDATE', baseVersion: 4,
          payload: { id: employeeRow.id, firstName: 'Erika Neu' } }),
        expect.objectContaining({ entityType: 'employee', action: 'QUALIFICATION_UPDATE', baseVersion: 7,
          payload: expect.objectContaining({ qualificationId: '55555555-5555-5555-5555-555555555555', expiryDate: null }) })
      ])
    }));
    expect(markSynced).toHaveBeenCalledTimes(2);
  });

  test('Regelbasierte Automatisierungsregeln bleiben tenantbezogen steuerbar', () => {
    useSecurityStore.setState({ currentTenantId: 'tenant-frankfurt', automations: [] });
    useSecurityStore.getState().addAutomationRule({
      name: 'Wachbuch-Regression',
      description: 'Regelbasierter Test ohne externen Dienst',
      trigger: 'LOGBOOK_ENTRY_CREATED',
      conditions: [{ field: 'priority', operator: 'equals', value: 'Kritisch' }],
      actions: [{ type: 'NOTIFY_MANAGER' }],
      active: true,
      category: 'Wachbuch',
      actionsTriggeredCount: 0
    });
    const rule = useSecurityStore.getState().getTenantAutomations()[0];
    expect(rule.tenantId).toBe('tenant-frankfurt');
    expect(useSecurityStore.getState().testRunRule(rule.id)).toMatchObject({ matched: true, actions: ['NOTIFY_MANAGER'] });

    useSecurityStore.getState().toggleAutomationRule(rule.id);
    expect(useSecurityStore.getState().getTenantAutomations()[0].active).toBe(false);
  });

  test('2. addClient persistiert über POST /customers und übernimmt die Server-ID', async () => {
    mockedApi.post.mockResolvedValueOnce({
      id: '55555555-5555-5555-5555-555555555555',
      client_number: 'KUN-API-2',
      company_name: 'Persistierte GmbH'
    });

    await useSecurityStore.getState().addClient({
      clientNumber: 'KUN-API-2',
      companyName: 'Persistierte GmbH',
      contactPerson: 'Max Test',
      email: 'max@test.de',
      phone: '+49 69 123',
      address: 'Teststraße 1',
      contractStart: '2026-01-01',
      contractEnd: '2028-12-31',
      contractAutoRenew: true,
      noticePeriodMonths: 3,
      slaLevel: 'Gold (24/7 Vor-Ort)',
      billingStatus: 'Regulär',
      assignedSiteCount: 0
    });

    expect(mockedApi.post).toHaveBeenCalledWith(
      '/customers',
      expect.objectContaining({
        clientNumber: 'KUN-API-2',
        companyName: 'Persistierte GmbH',
        slaLevel: 'Gold (24/7 Vor-Ort)'
      })
    );

    const state = useSecurityStore.getState();
    expect(state.clients[0].id).toBe('55555555-5555-5555-5555-555555555555');
    expect(state.clients[0].companyName).toBe('Persistierte GmbH');
    expect(state.notifications[0].title).toBe('Kunde gespeichert');
  });

  test('3. Fehlgeschlagene Kundenanlage erzeugt keinen Erfolg und keine lokale Scheinpersistenz', async () => {
    mockedApi.post.mockRejectedValueOnce(new Error('Backend nicht erreichbar'));

    await useSecurityStore.getState().addClient({
      clientNumber: 'KUN-FAIL',
      companyName: 'Nicht gespeichert GmbH',
      contactPerson: 'Max Test',
      email: 'max@test.de',
      phone: '+49 69 123',
      address: 'Teststraße 1',
      contractStart: '2026-01-01',
      contractEnd: '2028-12-31',
      contractAutoRenew: true,
      noticePeriodMonths: 3,
      slaLevel: 'Gold (24/7 Vor-Ort)',
      billingStatus: 'Regulär',
      assignedSiteCount: 0
    });

    const state = useSecurityStore.getState();
    expect(state.clients).toHaveLength(0);
    expect(state.notifications[0].title).toBe('Kunde nicht gespeichert');
    expect(state.notifications[0].type).toBe('alert');
  });

  test('Kundenbearbeitung und Archivierung verwenden die persistente API mit Revisionsstand', async () => {
    mockReadEndpoints();
    await useSecurityStore.getState().loadTenantData();
    expect(useSecurityStore.getState().clients).toHaveLength(1);
    expect(useSecurityStore.getState().isOnline).toBe(true);
    mockedApi.patch.mockResolvedValueOnce({ ...customerRow, company_name: 'Geändert GmbH', revision_version: 2 });
    await useSecurityStore.getState().updateClient(customerRow.id, { companyName: 'Geändert GmbH' });
    expect(mockedApi.patch).toHaveBeenCalledWith(`/customers/${customerRow.id}`, expect.objectContaining({ companyName: 'Geändert GmbH', revisionVersion: 1 }));
    expect(useSecurityStore.getState().clients[0].companyName).toBe('Geändert GmbH');

    mockedApi.post.mockResolvedValueOnce({ id: customerRow.id, archived_at: new Date().toISOString(), revision_version: 3 });
    await useSecurityStore.getState().archiveClient(customerRow.id);
    expect(mockedApi.post).toHaveBeenCalledWith(`/customers/${customerRow.id}/archive`, { revisionVersion: 2 });
    expect(useSecurityStore.getState().clients).toHaveLength(0);
  });

  test('Offline-Kundenänderung wird mandantengebunden in die Outbox übernommen', async () => {
    const mutationWrite = vi.spyOn(offlineVault, 'enqueueMutation').mockResolvedValue({} as any);
    useSecurityStore.setState({ clients: [{ ...customerRow, tenantId: 'tenant-frankfurt', clientNumber: customerRow.client_number, companyName: customerRow.company_name, contactPerson: customerRow.contact_person, contractStart: customerRow.contract_start, contractEnd: customerRow.contract_end, contractAutoRenew: true, noticePeriodMonths: 3, slaLevel: customerRow.sla_level as any, billingStatus: customerRow.billing_status as any, assignedSiteCount: 0 } as any], isOnline: false, currentTenantId: 'tenant-frankfurt' });
    await useSecurityStore.getState().updateClient(customerRow.id, { companyName: 'Offline GmbH' });
    expect(mutationWrite).toHaveBeenCalledWith(expect.objectContaining({ entityType: 'client', action: 'UPDATE', tenantId: 'tenant-frankfurt', baseVersion: 1 }));
    expect(useSecurityStore.getState().clients[0].companyName).toBe('Offline GmbH');
  });

  test('4. Login übernimmt CSRF-Token und lädt Mandantendaten aus der Sitzung', async () => {
    mockedApi.post.mockResolvedValueOnce({
      csrfToken: 'csrf-test-token',
      user: {
        id: 'user-1',
        email: 'a.schmidt@ffm-sec.de',
        fullName: 'Alexander Schmidt',
        role: 'Einsatzleitung',
        tenantId: '11111111-1111-1111-1111-111111111111',
        tenantName: 'Frankfurt',
        permissions: ['customers:read', 'customers:create', 'sites:read', 'employees:read', 'logbook:read']
      }
    });
    mockReadEndpoints();

    await useSecurityStore.getState().login('a.schmidt@ffm-sec.de', 'secret');

    expect(mockedApi.setCsrfToken).toHaveBeenCalledWith('csrf-test-token');
    const state = useSecurityStore.getState();
    expect(state.isAuthenticated).toBe(true);
    expect(state.authUser?.email).toBe('a.schmidt@ffm-sec.de');
    expect(state.clients).toHaveLength(1);
    expect(state.guardBook).toHaveLength(1);
  });

  test('5. addSite persistiert ein Objekt über POST /sites', async () => {
    mockedApi.post.mockResolvedValueOnce({
      id: '66666666-6666-6666-6666-666666666666',
      client_id: '11111111-1111-1111-1111-111111111111',
      site_code: 'OBJ-API-2',
      name: 'Persistiertes Objekt',
      address: 'Objektweg 2',
      security_level: 'Hoch (KRITIS / BSI)',
      required_guards_day: 2,
      required_guards_night: 1,
      alarm_system: 'EMA',
      access_rules: 'Zutrittskontrolle'
    });

    await useSecurityStore.getState().addSite({
      clientId: '11111111-1111-1111-1111-111111111111',
      clientName: 'API Test GmbH',
      siteCode: 'OBJ-API-2',
      name: 'Persistiertes Objekt',
      address: 'Objektweg 2',
      securityLevel: 'Hoch (KRITIS / BSI)',
      siteManagerId: '',
      siteManagerName: 'Nicht zugewiesen',
      requiredGuardsDay: 2,
      requiredGuardsNight: 1,
      checkpoints: [],
      alarmSystem: 'EMA',
      instructionsCount: 0,
      accessRules: 'Zutrittskontrolle',
      activeAlarms: 0
    });

    expect(mockedApi.post).toHaveBeenCalledWith(
      '/sites',
      expect.objectContaining({ siteCode: 'OBJ-API-2', name: 'Persistiertes Objekt' })
    );

    const state = useSecurityStore.getState();
    expect(state.sites[0].id).toBe('66666666-6666-6666-6666-666666666666');
    expect(state.sites[0].name).toBe('Persistiertes Objekt');
    expect(state.notifications[0].title).toBe('Objekt gespeichert');
  });

  test('Standortänderungen werden offline mit Basisrevision in der Outbox gesichert und an Site-Sync gesendet', async () => {
    const mutationWrite = vi.spyOn(offlineVault, 'enqueueMutation').mockResolvedValue({} as any);
    vi.spyOn(offlineVault, 'getOutbox').mockResolvedValue([]);
    useSecurityStore.setState({
      isOnline: false, isAuthenticated: true, currentTenantId: 'tenant-frankfurt', currentUserId: 'user-regression',
      authUser: { id: 'user-regression', email: '', fullName: '', role: '', tenantId: 'tenant-frankfurt', tenantName: '', permissions: ['sites:manage'] },
      sites: [{
      id: siteRow.id, tenantId: 'tenant-frankfurt', clientId: customerRow.id, clientName: customerRow.company_name,
      siteCode: siteRow.site_code, name: siteRow.name, address: siteRow.address, securityLevel: 'Mittel',
      siteManagerId: '', siteManagerName: '', requiredGuardsDay: 1, requiredGuardsNight: 1, checkpoints: [], alarmSystem: '', instructionsCount: 0, accessRules: '', activeAlarms: 0, revisionVersion: 7
      }]
    });

    await useSecurityStore.getState().updateSite(siteRow.id, { name: 'Lokal geändert' });
    expect(mutationWrite).toHaveBeenCalledWith(expect.objectContaining({ entityType: 'site', action: 'UPDATE', baseVersion: 7, payload: expect.objectContaining({ name: 'Lokal geändert' }) }));

    const pending = [{ id: 'site-mutation-1234', tenantId: 'tenant-frankfurt', userId: 'user-regression', deviceId: 'device-test', entityType: 'site', action: 'UPDATE', payload: { id: siteRow.id, name: 'Lokal geändert' }, occurredAt: new Date().toISOString(), baseVersion: 7, retryCount: 0, status: 'PENDING' }];
    vi.spyOn(offlineVault, 'getPendingOutbox').mockResolvedValue(pending as any);
    vi.spyOn(offlineVault, 'getDeviceId').mockReturnValue('device-test');
    vi.spyOn(offlineVault, 'markSynced').mockResolvedValue();
    mockedApi.post.mockResolvedValueOnce([{ clientUuid: pending[0].id, status: 'SYNCED', serverVersion: 8 }]);
    useSecurityStore.setState({ isOnline: true });
    const result = await useSecurityStore.getState().triggerManualSync();
    expect(mockedApi.post).toHaveBeenCalledWith('/sites/sync', expect.objectContaining({ mutations: [expect.objectContaining({ baseVersion: 7, action: 'UPDATE' })] }));
    expect(result.success).toBe(1);
  });

  test('6. addEmployee und updateEmployee persistieren über POST/PATCH', async () => {
    mockedApi.post.mockResolvedValueOnce({
      id: '77777777-7777-7777-7777-777777777777',
      personnel_number: 'MA-API-2',
      first_name: 'Erika',
      last_name: 'Muster',
      email: 'erika@test.de',
      phone: '+49 171 123',
      role: 'Wachdienstmitarbeiter',
      status: 'Aktiv',
      weekly_hours: 40,
      hourly_rate: 19.5,
      date_of_joining: '2026-01-01',
      assigned_site_ids: ['22222222-2222-2222-2222-222222222222']
    });

    await useSecurityStore.getState().addEmployee({
      personnelNumber: 'MA-API-2',
      firstName: 'Erika',
      lastName: 'Muster',
      email: 'erika@test.de',
      phone: '+49 171 123',
      role: 'Wachdienstmitarbeiter' as any,
      status: 'Aktiv',
      weeklyHours: 40,
      qualifications: [],
      assignedSiteIds: ['22222222-2222-2222-2222-222222222222'],
      hourlyRate: 19.5,
      dateOfJoining: '2026-01-01'
    });

    expect(mockedApi.post).toHaveBeenCalledWith(
      '/employees',
      expect.objectContaining({
        personnelNumber: 'MA-API-2',
        status: 'Aktiv',
        assignedSiteIds: ['22222222-2222-2222-2222-222222222222']
      })
    );

    mockedApi.patch.mockResolvedValueOnce({});

    await useSecurityStore.getState().updateEmployee('77777777-7777-7777-7777-777777777777', {
      status: 'Urlaub',
      assignedSiteIds: ['22222222-2222-2222-2222-222222222222']
    });

    expect(mockedApi.patch).toHaveBeenCalledWith(
      '/employees/77777777-7777-7777-7777-777777777777',
      expect.objectContaining({
        status: 'Urlaub',
        assignedSiteIds: ['22222222-2222-2222-2222-222222222222']
      })
    );

    const state = useSecurityStore.getState();
    expect(state.employees[0].status).toBe('Urlaub');
    expect(state.notifications[0].title).toBe('Mitarbeiter aktualisiert');
  });


  test('7. addShift und assignShiftEmployee persistieren über die API', async () => {
    mockedApi.post.mockResolvedValueOnce({
      id: '88888888-8888-8888-8888-888888888888',
      site_id: '22222222-2222-2222-2222-222222222222',
      employee_id: null,
      shift_date: '2026-11-12',
      start_time: '06:00',
      end_time: '18:00',
      type: 'Tagdienst',
      status: 'Offen',
      required_qualification: 'Unterrichtung § 34a GewO',
      revision_version: 1
    });

    await useSecurityStore.getState().addShift({
      siteId: '22222222-2222-2222-2222-222222222222',
      siteName: 'API Objekt',
      date: '2026-11-12',
      startTime: '06:00',
      endTime: '18:00',
      type: 'Tagdienst',
      status: 'Offen',
      requiredQualification: 'Unterrichtung § 34a GewO' as any
    });

    expect(mockedApi.post).toHaveBeenCalledWith(
      '/shifts',
      expect.objectContaining({ siteId: '22222222-2222-2222-2222-222222222222', status: 'Offen' })
    );

    useSecurityStore.setState({
      employees: [
        {
          id: '99999999-9999-9999-9999-999999999999',
          tenantId: 'tenant-frankfurt',
          personnelNumber: 'MA-1',
          firstName: 'Erika',
          lastName: 'Muster',
          email: 'erika@test.de',
          phone: '+49',
          role: 'Wachdienstmitarbeiter' as any,
          status: 'Aktiv',
          weeklyHours: 40,
          qualifications: [],
          assignedSiteIds: [],
          hourlyRate: 19,
          dateOfJoining: '2026-01-01'
        }
      ]
    });

    mockedApi.patch.mockResolvedValueOnce({});

    await useSecurityStore.getState().assignShiftEmployee(
      '88888888-8888-8888-8888-888888888888',
      '99999999-9999-9999-9999-999999999999',
      'Erika Muster'
    );

    expect(mockedApi.patch).toHaveBeenCalledWith(
      '/shifts/88888888-8888-8888-8888-888888888888',
      expect.objectContaining({ status: 'Besetzt' })
    );
    expect(useSecurityStore.getState().shifts[0].status).toBe('Besetzt');
  });

  test('8. addTask, toggleTaskStatus, issueKey und returnKey persistieren', async () => {
    mockedApi.post.mockResolvedValueOnce({
      id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      title: 'API Aufgabe',
      assigned_to_name: 'Einsatzleitung',
      site_name: 'API Objekt',
      due_date: '2026-11-20',
      priority: 'Hoch',
      status: 'Offen',
      category: 'Audit',
      revision_version: 1
    });

    await useSecurityStore.getState().addTask({
      title: 'API Aufgabe',
      assignedToName: 'Einsatzleitung',
      siteName: 'API Objekt',
      dueDate: '2026-11-20',
      priority: 'Hoch',
      status: 'Offen',
      category: 'Audit'
    });

    expect(mockedApi.post).toHaveBeenCalledWith(
      '/tasks',
      expect.objectContaining({ title: 'API Aufgabe', status: 'Offen' })
    );

    mockedApi.patch.mockResolvedValueOnce({});
    await useSecurityStore.getState().toggleTaskStatus('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
    expect(mockedApi.patch).toHaveBeenCalledWith(
      '/tasks/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      { status: 'Erledigt' }
    );
    expect(useSecurityStore.getState().tasks[0].status).toBe('Erledigt');

    useSecurityStore.setState({
      keys: [
        {
          id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
          tenantId: 'tenant-frankfurt',
          keyNumber: 'K-1',
          label: 'Testschlüssel',
          siteId: '22222222-2222-2222-2222-222222222222',
          siteName: 'API Objekt',
          type: 'Transponder',
          status: 'Im Tresor'
        }
      ]
    });

    mockedApi.patch.mockResolvedValueOnce({});
    await useSecurityStore
      .getState()
      .issueKey('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Erika Muster', '99999999-9999-9999-9999-999999999999', '2026-11-20');

    expect(mockedApi.patch).toHaveBeenCalledWith(
      '/keys/bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
      expect.objectContaining({ status: 'Ausgegeben' })
    );
    expect(useSecurityStore.getState().keys[0].status).toBe('Ausgegeben');

    mockedApi.patch.mockResolvedValueOnce({});
    await useSecurityStore.getState().returnKey('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
    expect(useSecurityStore.getState().keys[0].status).toBe('Im Tresor');
  });

});
