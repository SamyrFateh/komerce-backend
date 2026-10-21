'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 *
 * Projection coûts d'UNE commande (section Coûts & écarts de Commande 360) : même projection que la liste Finance.
 * Non-régression RCT1 : E1 4 765, G 1 850, consolidé 6 615 (aucune écriture, mock db).
 */
const mockQuery = jest.fn();
const mockVariance = jest.fn();
jest.mock('../../db', () => ({ query: (...args) => mockQuery(...args) }));
jest.mock('../../services/cost-allocation/variance', () => ({ computeOrderCostVariance: (...args) => mockVariance(...args) }));

const finance = require('../../services/dashboard-finance-canonical');
const { EXPECTED_MARGIN } = require('../../scripts/recette/rct1/data');

const row = (over = {}) => ({
  order_id: 'order-id', reference: 'RCT1-E1', status: 'collected', payment_status: 'paid', payment_mode: 'stripe_eur',
  total_kmf: '15065', created_at: '2026-10-01T00:00:00Z', market_code: 'KM',
  estimated_cost_kmf: '10000', real_cost_kmf: '10300', has_imputation: true, final_ready: true, missing_cost_types: [], ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockVariance.mockResolvedValue(null);
});

test('getOrderCosting : lecture seule, une commande, commandes annulées/remboursées exclues', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [row()] });
  await finance.getOrderCosting('order-id');
  const [sql, params] = mockQuery.mock.calls[0];
  expect(String(sql)).toMatch(/WHERE o\.id = \$1/);
  expect(String(sql)).toContain("o.status NOT IN ('cancelled', 'refunded')");
  expect(String(sql)).not.toMatch(/\b(INSERT|UPDATE|DELETE)\b/i);
  expect(params).toEqual(['order-id']);
});

test('RCT1 : marge réelle E1 4 765, G 1 850, consolidé 6 615 — marge seulement sur commande finalisée', async () => {
  const e1 = EXPECTED_MARGIN['RCT1-E1'];
  const g = EXPECTED_MARGIN['RCT1-G'];
  mockQuery.mockResolvedValueOnce({ rows: [row({ total_kmf: String(e1.revenue_kmf), real_cost_kmf: String(e1.cost_kmf) })] });
  mockQuery.mockResolvedValueOnce({ rows: [row({ reference: 'RCT1-G', total_kmf: String(g.revenue_kmf), real_cost_kmf: String(g.cost_kmf) })] });
  const a = await finance.getOrderCosting('e1');
  const b = await finance.getOrderCosting('g');
  expect(a.consolidated_margin_kmf).toBe(4765);
  expect(b.consolidated_margin_kmf).toBe(1850);
  expect(a.consolidated_margin_kmf + b.consolidated_margin_kmf).toBe(6615);
  expect(a.cost_status).toBe('actual');
});

test('commande non finalisée : aucune marge réelle extrapolée ; sans imputation : coûts incomplets, pas zéro', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [row({ final_ready: false })] });
  const partial = await finance.getOrderCosting('o1');
  expect(partial.cost_status).toBe('partial_real');
  expect(partial.consolidated_margin_kmf).toBeNull();

  mockQuery.mockResolvedValueOnce({ rows: [row({ has_imputation: false, estimated_cost_kmf: null, real_cost_kmf: null, final_ready: false })] });
  const unknown = await finance.getOrderCosting('o2');
  expect(unknown.cost_status).toBe('incomplete');
  expect(unknown.real_cost_kmf).toBeNull();
  expect(unknown.estimated_cost_kmf).toBeNull();
});

test('commande annulée / remboursée ou introuvable : null (non applicable)', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [] });
  expect(await finance.getOrderCosting('gone')).toBeNull();
});
