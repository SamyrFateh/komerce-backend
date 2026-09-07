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
const {
  RECONCILIABLE_VARIABLE_COST_TYPES,
  N2_PROVISION_COST_TYPES,
  ORDER_ALLOCATION_STRUCTURE_COST_TYPES,
} = require('../../services/cost-allocation/cost-types');

describe('cost-allocation/variance', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('computeOrderCostVariance', () => {
    it('compare le périmètre réconciliable N1+payment et exclut N3', async () => {
      db.query
        .mockResolvedValueOnce({ rows: [{
          landed: '9000',
          business_complete: '12000',
          business_variable: '1000',
          risk_provision: '0',
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
      expect(result.estimated.contribution_cost_total_kmf).toBe(10000);
      expect(result.estimated.business_complete_kmf).toBe(12000);
      expect(result.real.total_kmf).toBe(12000);
      expect(result.real.variable_total_kmf).toBe(10000);
      expect(result.real.structure_total_kmf).toBe(2000);
      expect(result.variance).toEqual({ scope: 'N1+payment', total_kmf: 0, total_pct: 0 });
      expect(result.reconciliation_status).toBe('comparable_scope');
    });

    it('retire la provision risque du périmètre de variance commande', async () => {
      db.query
        .mockResolvedValueOnce({ rows: [{
          landed: '8000', business_complete: '13000', business_variable: '2000', risk_provision: '500', fixed_overhead: '3000',
          imputations_count: 1, missing_variable_snapshot_count: 0,
        }] })
        .mockResolvedValueOnce({ rows: [
          { cost_type: 'freight', amount: '11000', all_actual: true },
          { cost_type: 'risk_provision', amount: '900', all_actual: true },
          { cost_type: 'fixed_overhead', amount: '9000', all_actual: true },
        ] });

      const result = await computeOrderCostVariance('order-002');

      expect(result.estimated.contribution_cost_total_kmf).toBe(10000);
      expect(result.estimated.variable_total_kmf).toBe(9500);
      expect(result.real.variable_total_kmf).toBe(11000);
      expect(result.real.provision_total_kmf).toBe(900);
      expect(result.variance.total_kmf).toBe(1500);
      expect(result.variance.total_pct).toBe(15.79);
      expect(result.risk_provision_status).toBe('period_reconciliation_pending');
    });

    it('retourne NOT_DECISIONAL si le split N2 manque dans un snapshot legacy', async () => {
      db.query
        .mockResolvedValueOnce({ rows: [{
          landed: '9000', business_complete: '12000', business_variable: null, risk_provision: '0', fixed_overhead: null,
          imputations_count: 1, missing_variable_snapshot_count: 1,
        }] })
        .mockResolvedValueOnce({ rows: [{ cost_type: 'freight', amount: '10000', all_actual: true }] });

      const result = await computeOrderCostVariance('order-legacy');

      expect(result.estimated.variable_total_kmf).toBeNull();
      expect(result.variance).toBeNull();
      expect(result.reconciliation_status).toBe('not_decisional');
    });

    it('fail-close si un cost_type réel est inconnu', async () => {
      db.query
        .mockResolvedValueOnce({ rows: [{
          landed: '5000', business_complete: '6000', business_variable: '1000', risk_provision: '0', fixed_overhead: '0',
          imputations_count: 1, missing_variable_snapshot_count: 0,
        }] })
        .mockResolvedValueOnce({ rows: [
          { cost_type: 'freight', amount: '6000', all_actual: true },
          { cost_type: 'invented_cost', amount: '500', all_actual: true },
        ] });

      const result = await computeOrderCostVariance('order-unknown');
      expect(result.variance).toBeNull();
      expect(result.reconciliation_status).toBe('not_decisional');
      expect(result.real.unknown_by_cost_type).toEqual({ invented_cost: 500 });
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

    it('borne la variance produit dans le temps et passe les vocabulaires canoniques', async () => {
      db.query.mockResolvedValueOnce({ rows: [{
        product_id: 'product-001',
        quantity_sold: 3,
        orders_count: 2,
        missing_variable_snapshot_count: 0,
        total_estimated_variable_kmf: '9000',
        total_estimated_contribution_cost_kmf: '9500',
        total_estimated_risk_provision_kmf: '500',
        total_real_variable_kmf: '9900',
        total_real_provision_kmf: '600',
        total_real_structure_kmf: '1200',
        total_real_unknown_kmf: '0',
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
        total_estimated_contribution_cost_kmf: 9500,
        total_estimated_risk_provision_kmf: 500,
        total_real_variable_kmf: 9900,
        total_real_provision_kmf: 600,
        total_real_structure_kmf: 1200,
        variance_kmf: 900,
        variance_pct: 10,
        variance_scope: 'N1+payment',
        reconciliation_status: 'comparable_scope',
        risk_provision_status: 'period_reconciliation_pending',
      });
      expect(db.query.mock.calls[0][0]).toContain('o.created_at >= $2');
      expect(db.query.mock.calls[0][0]).toContain('ro.created_at <= $3');
      expect(db.query.mock.calls[0][1]).toEqual([
        'product-001',
        '2026-08-01T00:00:00Z',
        '2026-09-01T00:00:00Z',
        RECONCILIABLE_VARIABLE_COST_TYPES,
        N2_PROVISION_COST_TYPES,
        ORDER_ALLOCATION_STRUCTURE_COST_TYPES,
      ]);
    });

    it('ne fabrique pas de variance si un ancien snapshot ne permet pas de reconstruire N2', async () => {
      db.query.mockResolvedValueOnce({ rows: [{
        product_id: 'product-legacy',
        quantity_sold: 1,
        orders_count: 1,
        missing_variable_snapshot_count: 1,
        total_estimated_variable_kmf: null,
        total_estimated_contribution_cost_kmf: null,
        total_estimated_risk_provision_kmf: '0',
        total_real_variable_kmf: '5000',
        total_real_provision_kmf: '0',
        total_real_structure_kmf: '1000',
        total_real_unknown_kmf: '0',
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

    it('expose N2/N3 séparés et ne traite pas le risque comme un décaissement commande', async () => {
      db.query
        .mockResolvedValueOnce({ rows: [{
          id: 'order-001', reference: 'CMD-001', status: 'confirmed', payment_status: 'paid', total_kmf: '20000',
        }] })
        .mockResolvedValueOnce({ rows: [{
          imputations_count: '1', items_quantity: '2', sale_total: '20000',
          estimated_landed: '9000', estimated_business: '12000', estimated_business_variable: '2000',
          estimated_fixed_overhead: '1000', estimated_risk_provision: '1000',
          expected_product_purchase: '5000', expected_sourcing: '0', expected_hub: '0', expected_packaging: '0',
          expected_freight: '2000', expected_customs: '1000', expected_port_transitary: '0',
          expected_local_distribution: '500', expected_relay: '500', expected_payment: '1000',
          missing_variable_snapshot_count: '0', estimated_margin: '8000',
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
        risk_provision_kmf: 1000,
        fixed_overhead_kmf: 1000,
        variable_total_kmf: 10000,
        contribution_cost_total_kmf: 11000,
        business_complete_cost_kmf: 12000,
      });
      expect(result.real.variable_total_kmf).toBe(7000);
      expect(result.variance).toEqual({ scope: 'N1+payment', total_kmf: -3000, total_pct: -30 });
      expect(result.missing_cost_fields).toEqual(expect.arrayContaining(['customs', 'local_distribution', 'relay', 'payment']));
      expect(result.missing_cost_fields).not.toContain('risk_provision');
      expect(result.risk_provision_status).toBe('period_reconciliation_pending');
    });

    it('conserve le contrat cost_status=actual quand les coûts transactionnels attendus sont présents', async () => {
      const allCosts = [
        'product_purchase', 'freight', 'customs', 'local_distribution', 'relay',
        'hub', 'risk_provision', 'fixed_overhead', 'payment',
      ].map((cost_type) => ({ cost_type, amount: '1000', all_actual: true }));

      db.query
        .mockResolvedValueOnce({ rows: [{ id: 'order-002', reference: 'CMD-002', status: 'confirmed', payment_status: 'paid', total_kmf: '20000' }] })
        .mockResolvedValueOnce({ rows: [{
          imputations_count: '1', items_quantity: '1', sale_total: '20000',
          estimated_landed: '5000', estimated_business: '9000', estimated_business_variable: '3000',
          estimated_fixed_overhead: '1000', estimated_risk_provision: '1000',
          expected_product_purchase: '1000', expected_sourcing: '0', expected_hub: '1000', expected_packaging: '0',
          expected_freight: '1000', expected_customs: '1000', expected_port_transitary: '0',
          expected_local_distribution: '1000', expected_relay: '1000', expected_payment: '1000',
          missing_variable_snapshot_count: '0', estimated_margin: '11000',
        }] })
        .mockResolvedValueOnce({ rows: allCosts });

      const result = await getOrderCostTruth('order-002');

      expect(result.cost_status).toBe('actual');
      expect(result.cost_status_scope).toBe('transaction_variable_actual_with_period_risk_provision');
      expect(result.missing_cost_fields).toEqual([]);
      expect(result.real.total_kmf).toBe(9000);
      expect(result.real.variable_total_kmf).toBe(7000);
      expect(result.real.provision_legacy_total_kmf).toBe(1000);
      expect(result.real.structure_legacy_total_kmf).toBe(1000);
      expect(result.real.contribution_cost_total_kmf).toBe(8000);
      expect(result.variance).toEqual({ scope: 'N1+payment', total_kmf: 0, total_pct: 0 });
    });

    it('une provision risque absente des allocations réelles ne bloque pas actual', async () => {
      db.query
        .mockResolvedValueOnce({ rows: [{ id: 'order-003', reference: 'CMD-003', status: 'confirmed', payment_status: 'paid', total_kmf: '10000' }] })
        .mockResolvedValueOnce({ rows: [{
          imputations_count: '1', items_quantity: '1', sale_total: '10000',
          estimated_landed: '4000', estimated_business: '6000', estimated_business_variable: '1500',
          estimated_fixed_overhead: '500', estimated_risk_provision: '500',
          expected_product_purchase: '4000', expected_sourcing: '0', expected_hub: '0', expected_packaging: '0',
          expected_freight: '0', expected_customs: '0', expected_port_transitary: '0',
          expected_local_distribution: '0', expected_relay: '0', expected_payment: '1000',
          missing_variable_snapshot_count: '0', estimated_margin: '4000',
        }] })
        .mockResolvedValueOnce({ rows: [
          { cost_type: 'product_purchase', amount: '4000', all_actual: true },
          { cost_type: 'payment', amount: '1000', all_actual: true },
        ] });

      const result = await getOrderCostTruth('order-003');
      expect(result.cost_status).toBe('actual');
      expect(result.missing_cost_fields).toEqual([]);
      expect(result.risk_provision_status).toBe('period_reconciliation_pending');
      expect(result.real.contribution_cost_total_kmf).toBe(5500);
      expect(result.real.margin_kmf).toBe(4500);
    });
  });
});
