'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const mockQuery = jest.fn();
jest.mock('../../db', () => ({ query: (...args) => mockQuery(...args) }));

const {
  hasSourcingGlobalAuthority,
  requireSourcingGlobalAuthority,
} = require('../../middleware/require-sourcing-global-authority');

function response() {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
}

beforeEach(() => jest.clearAllMocks());

test('autorité sourcing provient du grant actif persisté', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [{ one: 1 }] });
  await expect(hasSourcingGlobalAuthority('central-sourcing')).resolves.toBe(true);
  expect(mockQuery).toHaveBeenCalledWith(
    expect.stringContaining('FROM sourcing_global_access_grants'),
    ['central-sourcing']
  );
  expect(mockQuery.mock.calls[0][0]).toContain('revoked_at IS NULL');
});

test('absence de grant refuse même un admin authentifié', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [] });
  const req = { user: { id: 'admin-without-grant', role: 'admin' } };
  const res = response();
  const next = jest.fn();
  await requireSourcingGlobalAuthority(req, res, next);
  expect(res.status).toHaveBeenCalledWith(403);
  expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'sourcing_global_access_denied' }));
  expect(next).not.toHaveBeenCalled();
});

test('grant validé est attaché au contexte de requête', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [{ one: 1 }] });
  const req = { user: { id: 'central-sourcing', role: 'sourcing' } };
  const res = response();
  const next = jest.fn();
  await requireSourcingGlobalAuthority(req, res, next);
  expect(req.sourcingGlobalAuthority).toBe(true);
  expect(next).toHaveBeenCalledTimes(1);
});

test('autorité déjà résolue ne relit pas la base', () => {
  const req = { user: { id: 'central-sourcing' }, sourcingGlobalAuthority: true };
  const res = response();
  const next = jest.fn();
  requireSourcingGlobalAuthority(req, res, next);
  expect(next).toHaveBeenCalledTimes(1);
  expect(mockQuery).not.toHaveBeenCalled();
});
