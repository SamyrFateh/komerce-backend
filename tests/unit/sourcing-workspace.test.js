'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const query = jest.fn();
jest.mock('../../db', () => ({ query: (...args) => query(...args) }));
jest.mock('../../services/sourcing-analysis', () => ({ getSynthesis: jest.fn(), getAnalysis: jest.fn() }));
jest.mock('../../services/sourcing-mutations', () => ({ updateProduct: jest.fn() }));
jest.mock('../../services/sourcing-candidate-actions', () => ({
  updateCandidate: jest.fn(), scanCandidate: jest.fn(), watchlistCandidate: jest.fn(),
  rejectCandidate: jest.fn(), promoteCandidate: jest.fn(),
}));
jest.mock('../../services/sourcing-import-dispatch', () => ({ connectorCatalog: jest.fn(() => ({})), dispatchToConnector: jest.fn() }));
jest.mock('../../services/suppliers/catalog-import-orchestrator', () => ({ importCatalog: jest.fn() }));
jest.mock('../../services/partner-admin-service', () => ({
  listPartners: jest.fn(), getStats: jest.fn(), createPartner: jest.fn(), updatePartner: jest.fn(),
}));

const workspace = require('../../services/sourcing-workspace');

beforeEach(() => jest.clearAllMocks());

test('product_ref est résolu côté serveur', async () => {
  query.mockResolvedValueOnce({ rows: [{ id: 'product-internal', product_ref: 'KPR-000001' }] });
  await expect(workspace.resolveProductRef('KPR-000001')).resolves.toEqual({ id: 'product-internal', product_ref: 'KPR-000001' });
  expect(query).toHaveBeenCalledWith(expect.stringContaining('product_ref = $1'), ['KPR-000001']);
});

test('candidate_ref est résolu côté serveur', async () => {
  query.mockResolvedValueOnce({ rows: [{ id: 'candidate-internal', candidate_ref: 'KSC-000001' }] });
  await expect(workspace.resolveCandidateRef('KSC-000001')).resolves.toEqual({ id: 'candidate-internal', candidate_ref: 'KSC-000001' });
});

test('partner_ref reste limité au type sourcing', async () => {
  query.mockResolvedValueOnce({ rows: [] });
  await expect(workspace.resolvePartnerRef('KPT-000001')).rejects.toMatchObject({ code: 'sourcing_partner_not_found' });
  expect(query.mock.calls[0][0]).toContain("partner_type = 'sourcing'");
});

test('les identifiants internes sont retirés de toute projection', () => {
  const value = workspace.stripInternalIds({ id: 'a', product_id: 'b', keep: 1, nested: { partner_id: 'c', label: 'ok' } });
  expect(value).toEqual({ keep: 1, nested: { label: 'ok' } });
});

test('un type partenaire hors sourcing est refusé avant écriture', async () => {
  await expect(workspace.createSupplier({ name: 'Relay', partner_type: 'relais' }))
    .rejects.toMatchObject({ code: 'sourcing_partner_type_forbidden' });
});
