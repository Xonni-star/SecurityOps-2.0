import { authenticateJwt } from '../middleware/auth';
import { query } from '../config/database';

jest.mock('../config/database', () => ({ query: jest.fn() }));

describe('session authentication database failures', () => {
  test('forwards database errors instead of reporting an expired session', async () => {
    const databaseError = new Error('database unavailable');
    (query as jest.Mock).mockRejectedValueOnce(databaseError);
    const req: any = {
      headers: { cookie: `secops_session=${'a'.repeat(43)}` }
    };
    const res: any = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn()
    };
    const next = jest.fn();

    await authenticateJwt(req, res, next);

    expect(next).toHaveBeenCalledWith(databaseError);
    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
  });
});
