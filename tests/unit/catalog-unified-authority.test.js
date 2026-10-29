'use strict';
/** @test-kind unit @test-runner jest @test-requires none */

jest.mock('../../middleware/require-sourcing-global-authority', () => ({
  requireSourcingGlobalAuthority: jest.fn((req, res) =>
    res.status(403).json({ code: 'sourcing_global_access_denied' })),
}));
const { requireSourcingGlobalAuthority } =
  require('../../middleware/require-sourcing-global-authority');
const router = require('../../routes/admin-catalog-workspace');

const catalogGet = router.stack.find(layer =>
  layer.route && layer.route.path === '/' && layer.route.methods.get
).route.stack[0].handle;

test('GET Catalogue unifié exige le grant Sourcing distinct du grant Catalogue', () => {
  const next = jest.fn();
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
  };
  catalogGet({ query: { unified: '1' }, user: { id: 'admin' } }, res, next);
  expect(requireSourcingGlobalAuthority).toHaveBeenCalledTimes(1);
  expect(res.status).toHaveBeenCalledWith(403);
  expect(res.json).toHaveBeenCalledWith({ code: 'sourcing_global_access_denied' });
  expect(next).not.toHaveBeenCalled();
});

test('GET historique et vue Raffinerie ne gagnent pas de droit Sourcing implicite', () => {
  requireSourcingGlobalAuthority.mockClear();
  const res = { status: jest.fn(), json: jest.fn() };
  const next = jest.fn();
  catalogGet({ query: {} }, res, next);
  catalogGet({ query: { unified: '1', refinery_view: '1' } }, res, next);
  expect(next).toHaveBeenCalledTimes(2);
  expect(requireSourcingGlobalAuthority).not.toHaveBeenCalled();
});
