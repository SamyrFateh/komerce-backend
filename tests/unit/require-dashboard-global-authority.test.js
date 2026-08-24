'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const mockDbQuery = jest.fn();
jest.mock('../../db', () => ({ query: (...args) => mockDbQuery(...args) }));

const {
  hasDashboardGlobalAuthority,
  requireDashboardGlobalAuthority,
} = require('../../middleware/require-dashboard-global-authority');

function mockReqRes(user) {
  const req = { user: user ? { id: user, role: 'admin' } : null };
  const res = {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
  const next = jest.fn();
  return { req, res, next };
}

beforeEach(() => {
  mockDbQuery.mockReset();
});

describe('hasDashboardGlobalAuthority', () => {
  test('sans userId => false sans requête DB', async () => {
    await expect(hasDashboardGlobalAuthority(null)).resolves.toBe(false);
    expect(mockDbQuery).not.toHaveBeenCalled();
  });

  test('ne considère que les grants non révoqués', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [{ '?column?': 1 }] });
    await expect(hasDashboardGlobalAuthority('admin-1')).resolves.toBe(true);

    const [sql, params] = mockDbQuery.mock.calls[0];
    expect(sql).toContain('FROM dashboard_global_access_grants');
    expect(sql).toContain('revoked_at IS NULL');
    expect(sql).toContain('user_id = $1');
    expect(params).toEqual(['admin-1']);
  });

  test('aucune ligne active => false', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [] });
    await expect(hasDashboardGlobalAuthority('admin-1')).resolves.toBe(false);
  });
});

describe('requireDashboardGlobalAuthority', () => {
  test('401 si non authentifié', async () => {
    const { req, res, next } = mockReqRes(null);
    await requireDashboardGlobalAuthority(req, res, next);
    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
    expect(mockDbQuery).not.toHaveBeenCalled();
  });

  test('role=admin sans grant explicite => 403', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [] });
    const { req, res, next } = mockReqRes('admin-country');
    await requireDashboardGlobalAuthority(req, res, next);
    expect(res.statusCode).toBe(403);
    expect(res.body.code).toBe('dashboard_global_access_denied');
    expect(next).not.toHaveBeenCalled();
  });

  test('grant actif => next et marque le contexte serveur', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [{ ok: 1 }] });
    const { req, res, next } = mockReqRes('admin-central');
    await requireDashboardGlobalAuthority(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBe(200);
    expect(req.dashboardGlobalAuthority).toBe(true);
  });

  test('réutilise un contexte global déjà prouvé sans requête DB', async () => {
    const { req, next } = mockReqRes('admin-central');
    req.dashboardGlobalAuthority = true;
    await requireDashboardGlobalAuthority(req, {}, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(mockDbQuery).not.toHaveBeenCalled();
  });

  test('propage une erreur DB à next(err)', async () => {
    const err = new Error('db down');
    mockDbQuery.mockRejectedValueOnce(err);
    const { req, next } = mockReqRes('admin-central');
    await requireDashboardGlobalAuthority(req, {}, next);
    expect(next).toHaveBeenCalledWith(err);
  });
});
