'use strict';

/** @test-kind unit @test-runner jest @test-requires none */

const mockQuery = jest.fn();
jest.mock('../../db', () => ({ query: (...args) => mockQuery(...args) }));

const mockRecommend = jest.fn();
const mockRecommendBatch = jest.fn();
jest.mock('../../services/pricing-recommend', () => ({
  computeRecommend: (...args) => mockRecommend(...args),
  computeRecommendBatch: (...args) => mockRecommendBatch(...args),
}));

const mockFlow = jest.fn();
jest.mock('../../services/pricing-engine', () => ({ recommend: (...args) => mockFlow(...args) }));

const mockRates = jest.fn();
jest.mock('../../services/pricing-rates', () => ({ getCurrentRates: (...args) => mockRates(...args) }));

const mockApplyPrice = jest.fn();
jest.mock('../../services/pricing-apply', () => ({ applyPrice: (...args) => mockApplyPrice(...args) }));

const mockGetStrategy = jest.fn();
const mockGetCompetitors = jest.fn();
const mockApplyStrategy = jest.fn();
const mockAddCompetitor = jest.fn();
const mockSoftDeleteCompetitor = jest.fn();
jest.mock('../../services/pricing-strategy-service', () => ({
  getStrategy: (...args) => mockGetStrategy(...args),
  getCompetitors: (...args) => mockGetCompetitors(...args),
  applyStrategy: (...args) => mockApplyStrategy(...args),
  addCompetitor: (...args) => mockAddCompetitor(...args),
  softDeleteCompetitor: (...args) => mockSoftDeleteCompetitor(...args),
}));

const mockListComponents = jest.fn();
const mockCreateComponent = jest.fn();
const mockUpdateComponent = jest.fn();
const mockToggleComponent = jest.fn();
jest.mock('../../services/cost-component-admin-service', () => ({
  META: { families: ['landed_relay'] },
  listComponents: (...args) => mockListComponents(...args),
  createComponent: (...args) => mockCreateComponent(...args),
  updateComponent: (...args) => mockUpdateComponent(...args),
  toggleComponent: (...args) => mockToggleComponent(...args),
}));

const workspace = require('../../services/pricing-workspace');

beforeEach(() => {
  jest.clearAllMocks();
  mockRates.mockResolvedValue({ eur_kmf: 492, aed_kmf: 138 });
  mockListComponents.mockResolvedValue({ components: [], grouped: {}, count: 0 });
  mockRecommendBatch.mockResolvedValue({ items: [] });
});

test('product_ref est résolu côté serveur', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [{ id: 'internal-product', product_ref: 'KPR-000001' }] });
  await expect(workspace.resolveProductRef('KPR-000001')).resolves.toEqual(expect.objectContaining({ id: 'internal-product', product_ref: 'KPR-000001' }));
  expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('product_ref = $1'), ['KPR-000001']);
});

test('simulation convertit product_ref en id uniquement pour le moteur', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [{ id: 'internal-product', product_ref: 'KPR-000001' }] });
  mockRecommend.mockResolvedValueOnce({ product_id: 'internal-product', recommended_price_kmf: 5000 });
  const result = await workspace.simulate({ product_ref: 'KPR-000001', channel: 'cash_relais' });
  expect(mockRecommend).toHaveBeenCalledWith({ product_id: 'internal-product', channel: 'cash_relais' });
  expect(result).toEqual({ recommended_price_kmf: 5000 });
});

test('apply price délègue à pricing-apply et n’expose pas id', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [{ id: 'internal-product', product_ref: 'KPR-000001' }] });
  mockApplyPrice.mockResolvedValueOnce({ status: 200, body: { old_price_kmf: 4000, new_price_kmf: 5000, product: { id: 'internal-product' } } });
  const result = await workspace.applyPrice('KPR-000001', { price_kmf: 5000 }, { id: 'admin-1' });
  expect(mockApplyPrice).toHaveBeenCalledWith('internal-product', { price_kmf: 5000 }, 'admin-1');
  expect(result).toEqual(expect.objectContaining({ product_ref: 'KPR-000001', old_price_kmf: 4000, new_price_kmf: 5000 }));
  expect(JSON.stringify(result)).not.toContain('internal-product');
});

test('competitor_ref est résolue avant désactivation', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [{ id: 'internal-comp', competitor_ref: 'KPC-000001' }] });
  await workspace.deactivateCompetitor('KPC-000001');
  expect(mockSoftDeleteCompetitor).toHaveBeenCalledWith(expect.anything(), 'internal-comp');
});

test('clé cost component reste la référence Canonical', async () => {
  mockUpdateComponent.mockResolvedValueOnce({ id: 'internal-cc', key: 'freight_air', default_value: 1200 });
  const result = await workspace.updateCostComponent('freight_air', { default_value: 1200 }, { id: 'admin-1' });
  expect(mockUpdateComponent).toHaveBeenCalledWith({ key: 'freight_air' }, { default_value: 1200 }, 'admin-1');
  expect(result).toEqual({ key: 'freight_air', default_value: 1200 });
});

test('stripInternalIds retire les identifiants internes récursivement', () => {
  expect(workspace.stripInternalIds({
    id: 'x', product_id: 'p', competitor_id: 'c', keep: 1,
    nested: { component_id: 'cc', label: 'ok' },
  })).toEqual({ keep: 1, nested: { label: 'ok' } });
});
