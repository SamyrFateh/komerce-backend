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
    it('calcule une variance nulle quand le cout reel egale le cout estime', async () => {
      db.query
        .mockResolvedValueOnce({ rows: [{ landed: '9000', business: '10000', margin: '2500', by_cost_type: { freight: 3000 } }] })
        .mockResolvedValueOnce({ rows: [{ cost_type: 'freight', amount: '4000' }, { cost_type: 'customs', amount: '6000' }] });

      const result = await computeOrderCostVariance('order-001');

      expect(result.estimated.business_kmf).toBe(10000);
      expect(result.real.total_kmf).toBe(10000);
      expect(result.variance).toEqual({ total_kmf: 0, total_pct: 0 });
      expect(db.query).toHaveBeenCalledTimes(2);
    });

    it('calcule une variance positive quand le reel depasse l estime', async () => {
      db.query
        .mockResolvedValueOnce({ rows: [{ landed: '8000', business: '10000', margin: '3000', by_cost_type: {} }] })
        .mockResolvedValueOnce({ rows: [{ cost_type: 'freight', amount: '12500' }] });

      const result = await computeOrderCostVariance('order-002');

      expect(result.variance.total_kmf).toBe(2500);
      expect(result.variance.total_pct).toBe(25);
    });

    it('calcule une variance negative quand le reel est inferieur a l estime', async () => {
      db.query
        .mockResolvedValueOnce({ rows: [{ landed: '9000', business: '10000', margin: '3000', by_cost_type: {} }] })
        .mockResolvedValueOnce({ rows: [{ cost_type: 'freight', amount: '7500' }] });

      const result = await computeOrderCostVariance('order-003');

      expect(result.variance.total_kmf).toBe(-2500);
      expect(result.variance.total_pct).toBe(-25);
    });

    it('retourne total_pct null si le cout estime vaut zero', async () => {
      db.query
        .mockResolvedValueOnce({ rows: [{ landed: '0', business: '0', margin: '0', by_cost_type: {} }] })
        .mockResolvedValueOnce({ rows: [{ cost_type: 'freight', amount: '1000' }] });

      const result = await computeOrderCostVariance('order-zero');

      expect(result.variance.total_kmf).toBe(1000);
      expect(result.variance.total_pct).toBeNull();
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

    it('calcule la variance produit quand des couts reels existent', async () => {
      db.query.mockResolvedValueOnce({ rows: [{
        product_id: 'product-001',
        quantity_sold: 3,
        total_estimated_kmf: '9000',
        total_real_kmf: '9900',
        orders_count: 2,
      }] });

      const result = await computeProductCostVariance('product-001');

      expect(result).toEqual({
        product_id: 'product-001',
        quantity_sold: 3,
        orders_count: 2,
        total_estimated_kmf: 9000,
        total_real_kmf: 9900,
        variance_kmf: 900,
        variance_pct: 10,
      });
    });
  });

  describe('getOrderCostTruth', () => {
    it('retourne null si la commande est introuvable', async () => {
      db.query.mockResolvedValueOnce({ rows: [] });

      await expect(getOrderCostTruth('missing-order')).resolves.toBeNull();
    });

    it('signale partial_real si des couts reels variables manquent', async () => {
      db.query
        .mockResolvedValueOnce({ rows: [{ id: 'order-001', reference: 'CMD-001', status: 'confirmed', payment_status: 'paid', total_kmf: '20000' }] })
        .mockResolvedValueOnce({ rows: [{
          imputations_count: '1',
          items_quantity: '2',
          sale_total: '20000',
          estimated_landed: '9000',
          estimated_business: '12000',
          estimated_margin: '8000',
        }] })
        .mockResolvedValueOnce({ rows: [
          { cost_type: 'product_purchase', amount: '5000', all_actual: true },
          { cost_type: 'freight', amount: '2000', all_actual: true },
        ] });

      const result = await getOrderCostTruth('order-001');

      expect(result.cost_status).toBe('partial_real');
      expect(result.real.total_kmf).toBe(7000);
      expect(result.real.margin_kmf).toBeNull();
      expect(result.missing_cost_fields).toEqual(expect.arrayContaining(['customs', 'local_distribution', 'relay', 'payment']));
      expect(result.variance).toEqual({ total_kmf: -5000, total_pct: -41.67 });
    });

    it('signale actual quand tous les couts attendus sont presents', async () => {
      const allCosts = [
        'product_purchase', 'freight', 'customs', 'local_distribution', 'relay',
        'hub', 'risk_provision', 'fixed_overhead', 'payment',
      ].map((cost_type) => ({ cost_type, amount: '1000', all_actual: true }));

      db.query
        .mockResolvedValueOnce({ rows: [{ id: 'order-002', reference: 'CMD-002', status: 'confirmed', payment_status: 'paid', total_kmf: '20000' }] })
        .mockResolvedValueOnce({ rows: [{
          imputations_count: '1',
          items_quantity: '1',
          sale_total: '20000',
          estimated_landed: '8000',
          estimated_business: '9000',
          estimated_margin: '11000',
        }] })
        .mockResolvedValueOnce({ rows: allCosts });

      const result = await getOrderCostTruth('order-002');

      expect(result.cost_status).toBe('actual');
      expect(result.missing_cost_fields).toEqual([]);
      expect(result.real.total_kmf).toBe(9000);
      expect(result.real.margin_kmf).toBe(11000);
      expect(result.real.margin_pct).toBe(55);
    });
  });
});
