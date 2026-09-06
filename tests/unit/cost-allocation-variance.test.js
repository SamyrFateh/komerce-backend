'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
jest.mock('../../db', () => ({ query: jest.fn() }));

const db = require('../../db');
const {
  computeOrderCostVariance,
  computeProductCostVariance,
  getOrderCostTruth,
} = require('../../services/cost-allocation/variance');

describe('cost-allocation/variance', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('computeOrderCostVariance', () => {
    it('compare N1+N2 estime au reel variable et exclut N3 de la variance', async () => {
      db.query
        .mockResolvedValueOnce({ rows: [{
          landed: '9000',
          business_complete: '12000',
          business_variable: '1000',
          fixed_overhead: '2000',
          imputations_count: 1,
          missing_variable_snapshot_count: 0,
        }] })
        .mockResolvedValueOnce({ rows: [
          { cost_type: 'freight', amount: '4000', all_actual: true },
          { cost_type: 'customs', amount: '6000', all_actual: true },
          { cost_type: 'fixed_overhead', amount: '2000', all_actual: true },
        ] });

      const result = await computeOrderCostVariance('order-001');

      expect(result.estimated.variable_total_kmf).toBe(10000);
      expect(result.estimated.business_complete_kmf).toBe(12000);
      expect(result.real.total_kmf).toBe(12000);
      expect(result.real.variable_total_kmf).toBe(10000);
      expect(result.real.structure_total_kmf).toBe(2000);
      expect(result.variance).toEqual({ scope: 'N1+N2', total_kmf: 0, total_pct: 0 });
      expect(result.reconciliation_status).toBe('comparable_scope');
    });

    it('calcule une variance positive sur le seul perimetre variable', async () => {
      db.query
        .mockResolvedValueOnce({ rows: [{
          landed: '8000', business_complete: '13000', business_variable: '2000', fixed_overhead: '3000',
          imputations_count: 1, missing_variable_snapshot_count: 0,
        }] })
        .mockResolvedValueOnce({ rows: [
          { cost_type: 'freight', amount: '12500', all_actual: true },
          { cost_type: 'fixed_overhead', amount: '9000', all_actual: true },
        ] });

      const result = await computeOrderCostVariance('order-002');

      expect(result.variance.total_kmf).toBe(2500);
      expect(result.variance.total_pct).toBe(25);
      expect(result.real.structure_total_kmf).toBe(9000);
    });

    it('retourne NOT_DECISIONAL si le split N2 manque dans un snapshot legacy', async () => {
      db.query
        .mockResolvedValueOnce({ rows: [{
          landed: '9000', business_complete: '12000', business_variable: null, fixed_overhead: null,
          imputations_count: 1, missing_variable_snapshot_count: 1,
        }] })
        .mockResolvedValueOnce({ rows: [{ cost_type: 'freight', amount: '10000', all_actual: true }] });

      const result = await computeOrderCostVariance('order-legacy');

      expect(result.estimated.variable_total_kmf).toBeNull();
      expect(result.variance).toBeNull();
      expect(result.reconciliation_status).toBe('not_decisional');
    });
  });

  describe('computeProductCostVariance', () => {
    it('retourne no_data quand aucun produit ne correspond', async () => {
      db.query.mockResolvedValueOnce({ rows: [] });

      await expect(computeProductCostVariance('product-missing')).resolves.toEqual({
        product_id: 'product-missing',
        no_data: true,
      });
    });

    it('borne la variance produit dans le temps et compare N1+N2 a N1+N2', async () => {
      db.query.mockResolvedValueOnce({ rows: [{
        product_id: 'product-001',
        quantity_sold: 3,
        orders_count: 2,
        missing_variable_snapshot_count: 0,
        total_estimated_variable_kmf: '9000',
        total_real_variable_kmf: '9900',
        total_real_structure_kmf: '1200',
      }] });

      const result = await computeProductCostVariance('product-001', {
        from: '2026-08-01T00:00:00Z',
        to: '2026-09-01T00:00:00Z',
      });

      expect(result).toMatchObject({
        product_id: 'product-001',
        quantity_sold: 3,
        orders_count: 2,
        total_estimated_kmf: 9000,
        total_real_kmf: 9900,
        total_estimated_variable_kmf: 9000,
        total_real_variable_kmf: 9900,
        total_real_structure_kmf: 1200,
        variance_kmf: 900,
        variance_pct: 10,
        variance_scope: 'N1+N2',
        reconciliation_status: 'comparable_scope',
      });
      expect(db.query.mock.calls[0][0]).toContain('o.created_at >= $2');
      expect(db.query.mock.calls[0][0]).toContain('ro.created_at <= $3');
      expect(db.query.mock.calls[0][1]).toEqual([
        'product-001', '2026-08-01T00:00:00Z', '2026-09-01T00:00:00Z',
      ]);
    });

    it('ne fabrique pas de variance si un ancien snapshot ne permet pas de reconstruire N2', async () => {
      db.query.mockResolvedValueOnce({ rows: [{
        product_id: 'product-legacy',
        quantity_sold: 1,
        orders_count: 1,
        missing_variable_snapshot_count: 1,
        total_estimated_variable_kmf: null,
        total_real_variable_kmf: '5000',
        total_real_structure_kmf: '1000',
      }] });

      const result = await computeProductCostVariance('product-legacy');

      expect(result.total_estimated_variable_kmf).toBeNull();
      expect(result.variance_kmf).toBeNull();
      expect(result.variance_pct).toBeNull();
      expect(result.reconciliation_status).toBe('not_decisional');
    });
  });

  describe('getOrderCostTruth', () => {
    it('retourne null si la commande est introuvable', async () => {
      db.query.mockResolvedValueOnce({ rows: [] });
      await expect(getOrderCostTruth('missing-order')).resolves.toBeNull();
    });

    it('expose N2/N3 separes et calcule la variance sur le perimetre N1+N2', async () => {
      db.query
        .mockResolvedValueOnce({ rows: [{
          id: 'order-001', reference: 'CMD-001', status: 'confirmed', payment_status: 'paid', total_kmf: '20000',
        }] })
        .mockResolvedValueOnce({ rows: [{
          imputations_count: '1', items_quantity: '2', sale_total: '20000',
          estimated_landed: '9000', estimated_business: '12000', estimated_business_variable: '2000',
          estimated_fixed_overhead: '1000', missing_variable_snapshot_count: '0', estimated_margin: '8000',
        }] })
        .mockResolvedValueOnce({ rows: [
          { cost_type: 'product_purchase', amount: '5000', all_actual: true },
          { cost_type: 'freight', amount: '2000', all_actual: true },
        ] });

      const result = await getOrderCostTruth('order-001');

      expect(result.cost_status).toBe('partial_real');
      expect(result.estimated).toMatchObject({
        landed_relay_cost_kmf: 9000,
        business_variable_cost_kmf: 2000,
        fixed_overhead_kmf: 1000,
        variable_total_kmf: 11000,
        business_complete_cost_kmf: 12000,
      });
      expect(result.real.variable_total_kmf).toBe(7000);
      expect(result.variance).toEqual({ scope: 'N1+N2', total_kmf: -4000, total_pct: -36.36 });
      expect(result.missing_cost_fields).toEqual(expect.arrayContaining(['customs', 'local_distribution', 'relay', 'payment']));
    });

    it('conserve le statut actual legacy quand tous les types attendus sont presents', async () => {
      const allCosts = [
        'product_purchase', 'freight', 'customs', 'local_distribution', 'relay',
        'hub', 'risk_provision', 'fixed_overhead', 'payment',
      ].map((cost_type) => ({ cost_type, amount: '1000', all_actual: true }));

      db.query
        .mockResolvedValueOnce({ rows: [{ id: 'order-002', reference: 'CMD-002', status: 'confirmed', payment_status: 'paid', total_kmf: '20000' }] })
        .mockResolvedValueOnce({ rows: [{
          imputations_count: '1', items_quantity: '1', sale_total: '20000',
          estimated_landed: '5000', estimated_business: '9000', estimated_business_variable: '3000',
          estimated_fixed_overhead: '1000', missing_variable_snapshot_count: '0', estimated_margin: '11000',
        }] })
        .mockResolvedValueOnce({ rows: allCosts });

      const result = await getOrderCostTruth('order-002');

      expect(result.cost_status).toBe('actual');
      expect(result.missing_cost_fields).toEqual([]);
      expect(result.real.total_kmf).toBe(9000);
      expect(result.real.variable_total_kmf).toBe(8000);
      expect(result.real.structure_total_kmf).toBe(1000);
      expect(result.variance).toEqual({ scope: 'N1+N2', total_kmf: 0, total_pct: 0 });
    });
  });
});
