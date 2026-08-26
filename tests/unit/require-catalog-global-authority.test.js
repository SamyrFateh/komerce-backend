'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const mockQuery = jest.fn();
jest.mock('../../db', () => ({ query: (...args) => mockQuery(...args) }));

const {
  hasCatalogGlobalAuthority,
  requireCatalogGlobalAuthority,
} = require('../../middleware/require-catalog-global-authority');

function response() {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

test('autorité catalogue provient exclusivement du grant actif persisté', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [{ '?column?': 1 }] });
  await expect(hasCatalogGlobalAuthority('admin-central')).resolves.toBe(true);
  expect(mockQuery).toHaveBeenCalledWith(
    expect.stringContaining('FROM catalog_global_access_grants'),
    ['admin-central']
  );
  expect(mockQuery.mock.calls[0][0]).toContain('revoked_at IS NULL');
});

test('absence de grant actif refuse même un utilisateur authentifié', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [] });
  const req = { user: { id: 'admin-market', role: 'admin' } };
  const res = response();
  const next = jest.fn();

  await requireCatalogGlobalAuthority(req, res, next);

  expect(res.status).toHaveBeenCalledWith(403);
  expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'catalog_global_access_denied' }));
  expect(next).not.toHaveBeenCalled();
});

test('grant validé est attaché au contexte de requête', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [{ one: 1 }] });
  const req = { user: { id: 'admin-central', role: 'admin' } };
  const res = response();
  const next = jest.fn();

  await requireCatalogGlobalAuthority(req, res, next);

  expect(req.catalogGlobalAuthority).toBe(true);
  expect(next).toHaveBeenCalledTimes(1);
  expect(res.status).not.toHaveBeenCalled();
});

test('autorité déjà résolue ne relit pas la base', async () => {
  const req = { user: { id: 'admin-central', role: 'admin' }, catalogGlobalAuthority: true };
  const res = response();
  const next = jest.fn();

  requireCatalogGlobalAuthority(req, res, next);

  expect(next).toHaveBeenCalledTimes(1);
  expect(mockQuery).not.toHaveBeenCalled();
});
