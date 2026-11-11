import { describe, test, expect, beforeEach, vi } from 'vitest';

vi.mock('../services/apiClient', () => {
  const apiClient = {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
    setToken: vi.fn(),
    getToken: vi.fn(() => 'test-token'),
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

const mockedApi = apiClient as unknown as {
  get: ReturnType<typeof vi.fn>;
  post: ReturnType<typeof vi.fn>;
  patch: ReturnType<typeof vi.fn>;
  setToken: ReturnType<typeof vi.fn>;
};

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
      default:
        return Promise.reject(new Error(`Unerwarteter Endpunkt: ${endpoint}`));
    }
  });
}

beforeEach(() => {
  vi.clearAllMocks();
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
    isAuthenticated: false,
    isAuthenticating: false,
    authError: null,
    isLoadingData: false,
    dataLoadError: null
  });
});

describe('SecurityOps 2.0 – Frontend/Backend-Integration', () => {
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

  test('4. Login setzt Token und lädt Mandantendaten aus PostgreSQL', async () => {
    mockedApi.post.mockResolvedValueOnce({
      accessToken: 'jwt-test-token',
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

    expect(mockedApi.setToken).toHaveBeenCalledWith('jwt-test-token');
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
      date_of_joining: '2026-01-01'
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
      assignedSiteIds: [],
      hourlyRate: 19.5,
      dateOfJoining: '2026-01-01'
    });

    expect(mockedApi.post).toHaveBeenCalledWith(
      '/employees',
      expect.objectContaining({ personnelNumber: 'MA-API-2', status: 'Aktiv' })
    );

    mockedApi.patch.mockResolvedValueOnce({});

    await useSecurityStore.getState().updateEmployee('77777777-7777-7777-7777-777777777777', {
      status: 'Urlaub'
    });

    expect(mockedApi.patch).toHaveBeenCalledWith(
      '/employees/77777777-7777-7777-7777-777777777777',
      expect.objectContaining({ status: 'Urlaub' })
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
