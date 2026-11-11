import request from 'supertest';
import { app } from '../app';

describe('SecurityOps 2.0 - CORS Whitelist & Header Security Tests', () => {
  test('1. Erlaubte Origin erhält korrekte Access-Control-Allow-Origin Header', async () => {
    const res = await request(app)
      .get('/api/v1/health')
      .set('Origin', 'http://localhost:3000');

    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:3000');
  });

  test('2. Unerlaubte Origin wird von CORS abgewiesen', async () => {
    const res = await request(app)
      .get('/api/v1/health')
      .set('Origin', 'http://malicious-attacker.com');

    // Express CORS wirft Fehler bei unbekanntem Origin
    expect(res.status).toBe(500);
    expect(res.body.message).toContain('CORS blockiert');
  });

  test('3. Anfrage ohne Origin (z. B. Same-Origin oder interner Healthcheck) wird zugelassen', async () => {
    const res = await request(app).get('/api/v1/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('OPERATIONAL');
  });
});
