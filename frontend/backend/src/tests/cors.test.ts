import request from 'supertest';
import { app } from '../app';

const ALLOWED_ORIGIN = 'http://localhost:3000';
const PREFLIGHT_PATH = '/api/v1/sites/00000000-0000-0000-0000-000000000000';

function preflight(
  method: string,
  origin: string = ALLOWED_ORIGIN,
  requestedHeaders: string = 'authorization,content-type,x-requested-with'
) {
  return request(app)
    .options(PREFLIGHT_PATH)
    .set('Origin', origin)
    .set('Access-Control-Request-Method', method)
    .set('Access-Control-Request-Headers', requestedHeaders);
}

describe('SecurityOps 2.0 - CORS Whitelist & Header Security Tests', () => {
  test('1. Erlaubte Origin erhält korrekte Access-Control-Allow-Origin Header', async () => {
    const res = await request(app)
      .get('/api/v1/health')
      .set('Origin', ALLOWED_ORIGIN);

    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe(ALLOWED_ORIGIN);
  });

  test('2. Unerlaubte Origin wird von CORS abgewiesen', async () => {
    const res = await request(app)
      .get('/api/v1/health')
      .set('Origin', 'http://malicious-attacker.com');

    // Express CORS wirft Fehler bei unbekanntem Origin
    expect(res.status).toBe(500);
    expect(res.body.message).toBe('Interner Serverfehler');
  });

  test('3. Anfrage ohne Origin (z. B. Same-Origin oder interner Healthcheck) wird zugelassen', async () => {
    const res = await request(app).get('/api/v1/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('OPERATIONAL');
  });

  test('4. OPTIONS-Preflight für PATCH wird korrekt beantwortet', async () => {
    const res = await preflight('PATCH');

    expect(res.status).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe(ALLOWED_ORIGIN);
    expect(String(res.headers['access-control-allow-methods'])).toContain('PATCH');
    expect(String(res.headers['access-control-allow-headers']).toLowerCase()).toContain('authorization');
    expect(res.headers['access-control-allow-credentials']).toBe('true');
  });

  test('5. OPTIONS-Preflight für POST wird korrekt beantwortet', async () => {
    const res = await preflight('POST');

    expect(res.status).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe(ALLOWED_ORIGIN);
    expect(String(res.headers['access-control-allow-methods'])).toContain('POST');
  });

  test('6. OPTIONS-Preflight für DELETE wird korrekt beantwortet', async () => {
    const res = await preflight('DELETE');

    expect(res.status).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe(ALLOWED_ORIGIN);
    expect(String(res.headers['access-control-allow-methods'])).toContain('DELETE');
  });

  test('7. Access-Control-Allow-Methods entspricht den tatsächlich registrierten Methoden', async () => {
    const res = await preflight('PATCH');
    const allowedMethods = String(res.headers['access-control-allow-methods'])
      .split(',')
      .map((method) => method.trim().toUpperCase());

    expect(allowedMethods).toEqual(expect.arrayContaining(['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS']));
    // PUT ist keine registrierte API-Methode und darf nicht freigegeben werden.
    expect(allowedMethods).not.toContain('PUT');
  });

  test('8. Access-Control-Allow-Headers enthält die benötigten Request-Header', async () => {
    const res = await preflight('PATCH');
    const allowedHeaders = String(res.headers['access-control-allow-headers']).toLowerCase();

    expect(allowedHeaders).toContain('authorization');
    expect(allowedHeaders).toContain('content-type');
    expect(allowedHeaders).toContain('x-requested-with');
  });

  test('9. Credentials-Verhalten ist korrekt', async () => {
    const res = await preflight('PATCH');

    expect(res.headers['access-control-allow-credentials']).toBe('true');
    expect(res.headers['access-control-allow-origin']).toBe(ALLOWED_ORIGIN);
    expect(res.headers['access-control-allow-origin']).not.toBe('*');
  });

  test('10. Preflight von einer nicht erlaubten Origin wird abgewiesen', async () => {
    const res = await preflight('PATCH', 'http://malicious-attacker.com');

    expect(res.status).toBe(500);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
    expect(res.body.message).toBe('Interner Serverfehler');
  });
});
