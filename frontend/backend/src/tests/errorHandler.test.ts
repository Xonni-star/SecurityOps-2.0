import { errorHandler } from '../middleware/errorHandler';

describe('API error disclosure', () => {
  test('hides internal exception details and does not log secret-bearing messages or stacks', () => {
    const secret = 'db-password=never-expose-this';
    const err = new Error(secret);
    const req: any = { path: '/api/v1/private', method: 'GET' };
    const body: any = {};
    const res: any = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn((value) => Object.assign(body, value))
    };
    const next = jest.fn();
    const log = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    try {
      errorHandler(err, req, res, next);
      expect(res.status).toHaveBeenCalledWith(500);
      expect(body).toEqual({ success: false, message: 'Interner Serverfehler' });
      expect(JSON.stringify(body)).not.toContain(secret);
      expect(JSON.stringify(log.mock.calls)).not.toContain(secret);
      expect(JSON.stringify(log.mock.calls)).not.toContain(err.stack);
    } finally {
      log.mockRestore();
    }
  });

  test('preserves safe client-error status and message', () => {
    const req: any = { path: '/api/v1/private', method: 'POST' };
    const res: any = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const log = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    try {
      errorHandler(Object.assign(new Error('Zugriff verweigert'), { statusCode: 403 }), req, res, jest.fn());
      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({ success: false, message: 'Zugriff verweigert' });
    } finally {
      log.mockRestore();
    }
  });
});
