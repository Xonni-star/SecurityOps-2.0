import { requirePermission } from '../middleware/auth';
import { Request, Response, NextFunction } from 'express';

function responseMock() {
  const res: any = { status: jest.fn(), json: jest.fn() };
  res.status.mockReturnValue(res);
  return res as Response;
}

describe('KI-Berechtigungsprüfung', () => {
  it('weist nicht authentifizierte Anfragen zurück', () => {
    const res = responseMock(); const next = jest.fn() as NextFunction;
    requirePermission('logbook:read')({ user: undefined } as Request, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('weist authentifizierte Benutzer ohne KI-Berechtigung zurück', () => {
    const res = responseMock(); const next = jest.fn() as NextFunction;
    requirePermission('logbook:read')({ user: { permissions: [], userId: 'u', tenantId: 't', role: 'Test', email: 'test' } } as unknown as Request, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });
});
