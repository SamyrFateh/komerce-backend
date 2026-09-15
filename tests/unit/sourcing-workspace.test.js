'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const mockQuery = jest.fn();
const mockListSources = jest.fn();
const mockSetSourceActive = jest.fn();

jest.mock('../../db', () => ({ query: (...args) => mockQuery(...args) }));
jest.mock('../../services/sourcing-analysis', () => ({ getSynthesis: jest.fn(), getAnalysis: jest.fn() }));
jest.mock('../../services/sourcing-mutations', () => ({ updateProduct: jest.fn() }));
jest.mock('../../services/sourcing-candidate-actions', () => ({
  updateCandidate: jest.fn(), scanCandidate: jest.fn(), watchlistCandidate: jest.fn(),
  rejectCandidate: jest.fn(), promoteCandidate: jest.fn(),
}));
jest.mock('../../services/sourcing-import-dispatch', () => ({ connectorCatalog: jest.fn(() => ({})), dispatchToConnector: jest.fn() }));
jest.mock('../../services/sourcing-source-autopilot', () => ({
  listSources: (...args) => mockListSources(...args),
  setSourceActive: (...args) => mockSetSourceActive(...args),
}));
jest.mock('../../services/suppliers/catalog-import-orchestrator', () => ({ importCatalog: jest.fn() }));
jest.mock('../../services/partner-admin-service', () => ({
  listPartners: jest.fn(), getStats: jest.fn(), createPartner: jest.fn(), updatePartner: jest.fn(),
}));

const workspace = require('../../services/sourcing-workspace');

beforeEach(() => {
  jest.clearAllMocks();
  mockListSources.mockResolvedValue([]);
});

test('product_ref est résolu côté serveur', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [{ id: 'product-internal', product_ref: 'KPR-000001' }] });
  await expect(workspace.resolveProductRef('KPR-000001')).resolves.toEqual({ id: 'product-internal', product_ref: 'KPR-000001' });
  expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('product_ref = $1'), ['KPR-000001']);
});

test('candidate_ref est résolu côté serveur', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [{ id: 'candidate-internal', candidate_ref: 'KSC-000001' }] });
  await expect(workspace.resolveCandidateRef('KSC-000001')).resolves.toEqual({ id: 'candidate-internal', candidate_ref: 'KSC-000001' });
});

test('partner_ref reste limité au type sourcing', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [] });
  await expect(workspace.resolvePartnerRef('KPT-000001')).rejects.toMatchObject({ code: 'sourcing_partner_not_found' });
  expect(mockQuery.mock.calls[0][0]).toContain("partner_type = 'sourcing'");
});

test('les identifiants internes sont retirés de toute projection', () => {
  const value = workspace.stripInternalIds({ id: 'a', product_id: 'b', keep: 1, nested: { partner_id: 'c', label: 'ok' } });
  expect(value).toEqual({ keep: 1, nested: { label: 'ok' } });
});

test('interrupteur source délègue à l’autorité autopilot avec premier passage quand ON', async () => {
  mockSetSourceActive.mockResolvedValue({ source_ref: 'api:cj', autopilot_enabled: true });
  await expect(workspace.setSourceAutopilot('api:cj', true))
    .resolves.toEqual({ source_ref: 'api:cj', autopilot_enabled: true });
  expect(mockSetSourceActive).toHaveBeenCalledWith('api:cj', true, { runNow: true });
});

test('interrupteur source OFF ne déclenche aucun premier passage', async () => {
  mockSetSourceActive.mockResolvedValue({ source_ref: 'api:cj', autopilot_enabled: false });
  await expect(workspace.setSourceAutopilot('api:cj', false))
    .resolves.toEqual({ source_ref: 'api:cj', autopilot_enabled: false });
  expect(mockSetSourceActive).toHaveBeenCalledWith('api:cj', false, { runNow: false });
});

test('un type partenaire hors sourcing est refusé avant écriture', async () => {
  await expect(workspace.createSupplier({ name: 'Relay', partner_type: 'relais' }))
    .rejects.toMatchObject({ code: 'sourcing_partner_type_forbidden' });
});
