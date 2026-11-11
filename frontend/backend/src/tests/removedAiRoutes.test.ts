import request from 'supertest';
import { app } from '../app';

describe('Entfernte optionale Integrationen', () => {
  it.each([
    '/api/v1/ai/incident-analysis',
    '/api/v1/ai/copilot'
  ])('registriert keinen früheren KI-Endpunkt: %s', async (path) => {
    await request(app).post(path).send({}).expect(404);
  });
});
