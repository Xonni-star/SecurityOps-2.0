import request from 'supertest';
import { app } from '../app';
import { pool } from '../config/database';
import { parsedCorsOrigins } from '../config/env';

describe('SecurityOps 2.0 - Schritt 4 CORS & Datenbank-Rollen Sicherheitstests', () => {
  afterAll(async () => {
    await pool.end();
  });

  // 1. CORS-Tests
  test('1. Erlaubter Origin erhält CORS-Header Access-Control-Allow-Origin', async () => {
    const allowedOrigin = parsedCorsOrigins[0] || 'http://localhost:3000';
    const res = await request(app)
      .get('/api/v1/health')
      .set('Origin', allowedOrigin);

    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe(allowedOrigin);
  });

  test('2. Nicht autorisierter Origin wird mit CORS-Fehler abgewiesen', async () => {
    const unauthorizedOrigin = 'https://malicious-attacker-domain.com';
    const res = await request(app)
      .get('/api/v1/health')
      .set('Origin', unauthorizedOrigin);

    // Express-CORS blockiert über Error-Handler oder unterdrückt den Allow-Origin Header
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  test('3. Anfrage ohne Origin (z. B. interne API-Aufrufe, PWA Shell) wird zugelassen', async () => {
    const res = await request(app).get('/api/v1/health');
    expect(res.status).toBe(200);
  });

  // 2. Datenbank-Rollen Härtungstest
  test('4. PostgreSQL Rolle secops_app_user besitzt garantiert NOSUPERUSER, NOBYPASSRLS, NOCREATEROLE, NOCREATEDB', async () => {
    const res = await pool.query(`
      SELECT rolname, rolsuper, rolbypassrls, rolcreaterole, rolcreatedb 
      FROM pg_roles 
      WHERE rolname = 'secops_app_user'
    `);

    expect(res.rows.length).toBe(1);
    const role = res.rows[0];
    expect(role.rolsuper).toBe(false);
    expect(role.rolbypassrls).toBe(false);
    expect(role.rolcreaterole).toBe(false);
    expect(role.rolcreatedb).toBe(false);
  });

  test('5. PostgreSQL Rolle secops_app_user besitzt KEINE DELETE-Rechte auf guardbook_entries', async () => {
    const res = await pool.query(`
      SELECT has_table_privilege('secops_app_user', 'guardbook_entries', 'DELETE') as has_delete
    `);
    expect(res.rows[0].has_delete).toBe(false);
  });
});
