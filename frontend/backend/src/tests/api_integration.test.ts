import request from 'supertest';
import argon2 from 'argon2';
import { app } from '../app';
import { pool, migrationPool } from '../config/database';

const SEED_PASSWORD = 'SecOpsVault2025SecurePassword!';
const SEED_USER_EMAIL = 'a.schmidt@ffm-sec.de';
const BAVARIA_USER_EMAIL = 'api.bavaria@secops.local';
const TENANT_BAVARIA_ID = '22222222-2222-2222-2222-222222222222';
const clientNumber = `API-TEST-${Date.now()}`;
const siteCode = `API-SITE-${Date.now()}`;
const personnelNumber = `API-MA-${Date.now()}`;
let createdSiteId: string | undefined;
let createdEmployeeId: string | undefined;

async function login(email: string): Promise<string> {
  const response = await request(app)
    .post('/api/v1/auth/login')
    .send({ email, password: SEED_PASSWORD });

  expect(response.status).toBe(200);
  return response.body.data.accessToken as string;
}

beforeAll(async () => {
  await migrationPool.query('DELETE FROM user_roles WHERE user_id IN (SELECT id FROM users WHERE email = $1)', [
    BAVARIA_USER_EMAIL
  ]);
  await migrationPool.query('DELETE FROM users WHERE email = $1', [BAVARIA_USER_EMAIL]);

  const passwordHash = await argon2.hash(SEED_PASSWORD, { type: argon2.argon2id });
  const userResult = await migrationPool.query(
    `INSERT INTO users (email, password_hash, first_name, last_name, phone)
     VALUES ($1, $2, 'API', 'Bavaria', '+49 89 000')
     RETURNING id`,
    [BAVARIA_USER_EMAIL, passwordHash]
  );

  const roleResult = await migrationPool.query(
    `SELECT id FROM roles WHERE name = 'Einsatzleitung' LIMIT 1`
  );

  if (roleResult.rows.length === 0) {
    throw new Error('Seed-Rolle Einsatzleitung fehlt. Bitte `npm run seed` ausführen.');
  }

  await migrationPool.query(
    `INSERT INTO user_roles (user_id, role_id, tenant_id) VALUES ($1, $2, $3)
     ON CONFLICT DO NOTHING`,
    [userResult.rows[0].id, roleResult.rows[0].id, TENANT_BAVARIA_ID]
  );
});

afterAll(async () => {
  await migrationPool.query('DELETE FROM employees WHERE id = $1 OR personnel_number = $2', [createdEmployeeId ?? null, personnelNumber]);
  await migrationPool.query('DELETE FROM sites WHERE id = $1 OR site_code = $2', [createdSiteId ?? null, siteCode]);
  await migrationPool.query('DELETE FROM clients WHERE client_number = $1', [clientNumber]);
  await migrationPool.query('DELETE FROM user_roles WHERE user_id IN (SELECT id FROM users WHERE email = $1)', [
    BAVARIA_USER_EMAIL
  ]);
  await migrationPool.query('DELETE FROM users WHERE email = $1', [BAVARIA_USER_EMAIL]);
  await pool.end();
  await migrationPool.end();
});

describe('SecurityOps 2.0 – API-Persistenz & Mandantentrennung', () => {
  test('1. Kunde wird über die API in PostgreSQL gespeichert und nach erneutem Login wieder geladen', async () => {
    const firstToken = await login(SEED_USER_EMAIL);

    const createResponse = await request(app)
      .post('/api/v1/customers')
      .set('Authorization', `Bearer ${firstToken}`)
      .send({
        clientNumber,
        companyName: 'API Persistenz GmbH',
        contactPerson: 'Max Test',
        email: 'max@persistenz.de',
        phone: '+49 69 123456',
        address: 'Teststraße 1, 60311 Frankfurt',
        contractStart: '2026-01-01',
        contractEnd: '2028-12-31',
        slaLevel: 'Gold (24/7 Vor-Ort)'
      });

    expect(createResponse.status).toBe(201);

    // Neue Sitzung: Login erneut, danach muss der Datensatz aus PostgreSQL kommen.
    const secondToken = await login(SEED_USER_EMAIL);
    const listResponse = await request(app)
      .get('/api/v1/customers')
      .set('Authorization', `Bearer ${secondToken}`);

    expect(listResponse.status).toBe(200);
    expect(listResponse.body.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          client_number: clientNumber,
          company_name: 'API Persistenz GmbH'
        })
      ])
    );
  });

  test('2. Ein Benutzer aus Mandant B sieht den Kunden aus Mandant A nicht', async () => {
    const bavariaToken = await login(BAVARIA_USER_EMAIL);

    const listResponse = await request(app)
      .get('/api/v1/customers')
      .set('Authorization', `Bearer ${bavariaToken}`);

    expect(listResponse.status).toBe(200);
    const clientNumbers = (listResponse.body.data as Array<{ client_number: string }>).map(
      (row) => row.client_number
    );
    expect(clientNumbers).not.toContain(clientNumber);
  });

  test('3. Objekte und Mitarbeiter werden mandantengetrennt aus PostgreSQL gelesen', async () => {
    const token = await login(SEED_USER_EMAIL);

    const sitesResponse = await request(app)
      .get('/api/v1/sites')
      .set('Authorization', `Bearer ${token}`);
    const employeesResponse = await request(app)
      .get('/api/v1/employees')
      .set('Authorization', `Bearer ${token}`);

    expect(sitesResponse.status).toBe(200);
    expect(Array.isArray(sitesResponse.body.data)).toBe(true);
    expect(employeesResponse.status).toBe(200);
    expect(Array.isArray(employeesResponse.body.data)).toBe(true);
  });

  test('4. Objekt und Mitarbeiter werden gespeichert, nach erneutem Login geladen und aktualisiert', async () => {
    const token = await login(SEED_USER_EMAIL);

    const customersResponse = await request(app)
      .get('/api/v1/customers')
      .set('Authorization', `Bearer ${token}`);
    expect(customersResponse.status).toBe(200);
    const clientId = customersResponse.body.data[0].id as string;

    const siteResponse = await request(app)
      .post('/api/v1/sites')
      .set('Authorization', `Bearer ${token}`)
      .send({
        clientId,
        siteCode,
        name: 'API Testobjekt',
        address: 'Testweg 1, 60311 Frankfurt',
        securityLevel: 'Hoch (KRITIS / BSI)',
        requiredGuardsDay: 2,
        requiredGuardsNight: 1,
        alarmSystem: 'EMA Test',
        accessRules: 'Ausweispflicht'
      });
    expect(siteResponse.status).toBe(201);
    createdSiteId = siteResponse.body.data.id;

    const employeeResponse = await request(app)
      .post('/api/v1/employees')
      .set('Authorization', `Bearer ${token}`)
      .send({
        personnelNumber,
        firstName: 'API',
        lastName: 'Mitarbeiter',
        email: 'api.mitarbeiter@secops.local',
        phone: '+49 69 999',
        role: 'Wachdienstmitarbeiter',
        status: 'Aktiv',
        weeklyHours: 40,
        hourlyRate: 19.5,
        dateOfJoining: '2026-01-01'
      });
    expect(employeeResponse.status).toBe(201);
    createdEmployeeId = employeeResponse.body.data.id;

    const updateResponse = await request(app)
      .patch(`/api/v1/employees/${createdEmployeeId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'Urlaub' });
    expect(updateResponse.status).toBe(200);

    const secondToken = await login(SEED_USER_EMAIL);

    const sitesResponse = await request(app)
      .get('/api/v1/sites')
      .set('Authorization', `Bearer ${secondToken}`);
    expect(sitesResponse.body.data).toEqual(
      expect.arrayContaining([expect.objectContaining({ site_code: siteCode, name: 'API Testobjekt' })])
    );

    const employeesResponse = await request(app)
      .get('/api/v1/employees')
      .set('Authorization', `Bearer ${secondToken}`);
    expect(employeesResponse.body.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ personnel_number: personnelNumber, status: 'Urlaub' })
      ])
    );
  });

  test('5. Mandant B sieht die neu angelegten Objekte und Mitarbeiter nicht', async () => {
    const bavariaToken = await login(BAVARIA_USER_EMAIL);

    const sitesResponse = await request(app)
      .get('/api/v1/sites')
      .set('Authorization', `Bearer ${bavariaToken}`);
    const employeesResponse = await request(app)
      .get('/api/v1/employees')
      .set('Authorization', `Bearer ${bavariaToken}`);

    expect(sitesResponse.status).toBe(200);
    expect(employeesResponse.status).toBe(200);

    const siteCodes = (sitesResponse.body.data as Array<{ site_code: string }>).map((row) => row.site_code);
    const personnelNumbers = (employeesResponse.body.data as Array<{ personnel_number: string }>).map(
      (row) => row.personnel_number
    );

    expect(siteCodes).not.toContain(siteCode);
    expect(personnelNumbers).not.toContain(personnelNumber);
  });

});
