import request from 'supertest';
import { app } from '../app';

describe('Cookie session security boundaries', () => {
  test('mutation without CSRF token is rejected', async () => {
    const response = await request(app).post('/api/v1/auth/logout').set('Origin', 'http://localhost:3000').set('Cookie', 'secops_session=dummy-session').send({});
    expect(response.status).toBe(403);
    expect(response.body.message).toContain('CSRF');
  });

  test('mutation with mismatched CSRF token is rejected', async () => {
    const response = await request(app)
      .post('/api/v1/auth/logout')
      .set('Origin', 'http://localhost:3000')
      .set('Cookie', 'secops_session=dummy-session; secops_csrf=valid-token')
      .set('X-CSRF-Token', 'invalid-token')
      .send({});
    expect(response.status).toBe(403);
  });

  test('foreign origin is rejected before login processing', async () => {
    const response = await request(app)
      .post('/api/v1/auth/login')
      .set('Origin', 'https://attacker.invalid')
      .send({ email: 'nobody@example.invalid', password: 'correct horse battery staple' });
    expect(response.status).toBe(403);
  });

  test('legacy bearer token alone is not accepted as a session', async () => {
    const response = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', 'Bearer legacy-token');
    expect(response.status).toBe(401);
  });
});
