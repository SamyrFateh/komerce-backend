'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

jest.mock('../../db', () => ({ query: jest.fn() }));

const db = require('../../db');
const {
  getOrderMaturity,
  deriveMaturityWatermark,
  computeMarketMaturityWatermark,
  _evaluateEvidence,
} = require('../../services/pricing-maturity');

function baseEvidence(overrides = {}) {
  return {
    order_id: 'order-1',
    market_id: 'market-cm',
    created_at: '2026-09-01T10:00:00.000Z',
    status: 'confirmed',
    payment_status: 'paid',
    item_count: 1,
    unknown_fulfillment_count: 0,
    import_item_count: 0,
    local_item_count: 1,
    missing_breakdown_count: 0,

    expected_product_purchase_items: 1,
    expected_sourcing_items: 0,
    expected_hub_items: 0,
    expected_packaging_items: 0,
    expected_freight_items: 0,
    expected_customs_items: 0,
    expected_port_transitary_items: 0,
    expected_local_distribution_items: 0,
    expected_relay_items: 0,
    expected_payment_items: 0,

    verified_product_purchase_items: 1,
    verified_sourcing_items: 0,
    verified_hub_items: 0,
    verified_packaging_items: 0,
    verified_port_transitary_items: 0,
    verified_local_distribution_items: 0,
    verified_relay_items: 0,
    configured_relay_items: 0,
    actual_payment_records: 0,

    parcel_count: 0,
    collected_parcel_count: 0,
    shipment_count: 0,
    confirmed_shipment_count: 0,
    customs_liquidated_shipment_count: 0,
    freight_known_shipment_count: 0,
    positive_freight_shipment_count: 0,
    positive_customs_shipment_count: 0,
    freight_allocated_shipment_count: 0,
    customs_allocated_shipment_count: 0,
    import_items_linked_to_shipment_count: 0,
    ...overrides,
  };
}

function maturity(order_id, created_at, mature, reasons = []) {
  return {
    order_id,
    market_id: 'market-cm',
    created_at,
    mature,
    blocking_reasons: reasons,
  };
}

describe('pricing-maturity — verdict commande', () => {
  beforeEach(() => jest.clearAllMocks());

  it('accepte une commande locale quand tous les coûts variables attendus sont réellement réconciliés', () => {
    const result = _evaluateEvidence(baseEvidence());

    expect(result.mature).toBe(true);
    expect(result.maturity_status).toBe('MATURE');
    expect(result.blocking_reasons).toEqual([]);
  });

  it('refuse de traiter products.cost_kmf comme une preuve d achat réel', () => {
    const result = _evaluateEvidence(baseEvidence({ verified_product_purchase_items: 0 }));

    expect(result.mature).toBe(false);
    expect(result.blocking_reasons).toContain('product_purchase_reconciled');
  });

  it('fail-close quand fulfillment_source est inconnu', () => {
    const result = _evaluateEvidence(baseEvidence({
      unknown_fulfillment_count: 1,
      local_item_count: 0,
    }));

    expect(result.mature).toBe(false);
    expect(result.blocking_reasons).toContain('fulfillment_source_known');
  });

  it('n accepte pas la commission relais configurée comme preuve de règlement', () => {
    const result = _evaluateEvidence(baseEvidence({
      expected_relay_items: 1,
      parcel_count: 1,
      collected_parcel_count: 1,
      verified_relay_items: 0,
      configured_relay_items: 1,
    }));

    expect(result.mature).toBe(false);
    expect(result.blocking_reasons).toContain('relay_settlement_reconciled');
    const relayCriterion = result.criteria.find((c) => c.code === 'relay_settlement_reconciled');
    expect(relayCriterion.evidence.configured_only_items).toBe(1);
  });

  it('exige une preuve réelle des frais de paiement quand le snapshot en attend', () => {
    const result = _evaluateEvidence(baseEvidence({
      expected_payment_items: 1,
      actual_payment_records: 0,
    }));

    expect(result.mature).toBe(false);
    expect(result.blocking_reasons).toContain('payment_cost_reconciled');
  });

  it('exige pour un import le lien shipment, sa clôture, la douane et le fret réconciliés', () => {
    const result = _evaluateEvidence(baseEvidence({
      import_item_count: 1,
      local_item_count: 0,
      expected_freight_items: 1,
      expected_customs_items: 1,
      shipment_count: 1,
      confirmed_shipment_count: 1,
      customs_liquidated_shipment_count: 1,
      freight_known_shipment_count: 1,
      positive_freight_shipment_count: 1,
      positive_customs_shipment_count: 1,
      freight_allocated_shipment_count: 1,
      customs_allocated_shipment_count: 1,
      import_items_linked_to_shipment_count: 1,
    }));

    expect(result.mature).toBe(true);
  });

  it('bloque un import dont le shipment n est pas confirmé même si les coûts sont saisis', () => {
    const result = _evaluateEvidence(baseEvidence({
      import_item_count: 1,
      local_item_count: 0,
      shipment_count: 1,
      confirmed_shipment_count: 0,
      customs_liquidated_shipment_count: 1,
      freight_known_shipment_count: 1,
      import_items_linked_to_shipment_count: 1,
    }));

    expect(result.mature).toBe(false);
    expect(result.blocking_reasons).toContain('shipment_closed');
  });

  it('bloque si le breakdown snapshot manque : absence de preuve != zéro', () => {
    const result = _evaluateEvidence(baseEvidence({ missing_breakdown_count: 1 }));

    expect(result.mature).toBe(false);
    expect(result.blocking_reasons).toContain('snapshot_breakdown_available');
  });

  it('getOrderMaturity lit les sources terrain sans écrire', async () => {
    db.query.mockResolvedValueOnce({ rows: [baseEvidence()] });

    const result = await getOrderMaturity('order-1');

    expect(result.mature).toBe(true);
    expect(db.query).toHaveBeenCalledTimes(1);
    const sql = db.query.mock.calls[0][0];
    expect(sql).toContain('order_item_real_cost_allocations');
    expect(sql).toContain('customs_shipments');
    expect(sql).toContain('fulfillment_source');
    expect(sql).toContain('products.cost_kmf');
  });
});

describe('pricing-maturity — watermark anti cherry-picking', () => {
  it('s arrête au premier timestamp immature et ignore les matures plus récentes pour la frontière', () => {
    const result = deriveMaturityWatermark([
      maturity('o1', '2026-09-01T10:00:00Z', true),
      maturity('o2', '2026-09-02T10:00:00Z', true),
      maturity('o3', '2026-09-03T10:00:00Z', false, ['payment_cost_reconciled']),
      maturity('o4', '2026-09-04T10:00:00Z', true),
    ]);

    expect(result.status).toBe('PARTIAL');
    expect(result.maturity_ratio).toBe(0.75);
    expect(result.safe_prefix_order_count).toBe(2);
    expect(result.watermark_at).toBe('2026-09-02T10:00:00.000Z');
    expect(result.first_blocking_order_ids).toEqual(['o3']);
    expect(result.first_blocking_reasons).toEqual(['payment_cost_reconciled']);
  });

  it('ne sélectionne pas une commande mature partageant le timestamp d une immature', () => {
    const result = deriveMaturityWatermark([
      maturity('o1', '2026-09-01T10:00:00Z', true),
      maturity('o2', '2026-09-02T10:00:00Z', true),
      maturity('o3', '2026-09-02T10:00:00Z', false, ['relay_settlement_reconciled']),
    ]);

    expect(result.watermark_at).toBe('2026-09-01T10:00:00.000Z');
    expect(result.safe_prefix_order_count).toBe(1);
    expect(result.first_blocking_order_ids).toEqual(['o3']);
  });

  it('retourne un watermark nul si la première cohorte temporelle est immature', () => {
    const result = deriveMaturityWatermark([
      maturity('o1', '2026-09-01T10:00:00Z', false, ['payment_cost_reconciled']),
      maturity('o2', '2026-09-02T10:00:00Z', true),
    ]);

    expect(result.status).toBe('BLOCKED_AT_START');
    expect(result.watermark_at).toBeNull();
    expect(result.safe_prefix_order_count).toBe(0);
  });

  it('avance jusqu à la dernière commande quand toute la cohorte est mûre', () => {
    const result = deriveMaturityWatermark([
      maturity('o1', '2026-09-01T10:00:00Z', true),
      maturity('o2', '2026-09-02T10:00:00Z', true),
    ]);

    expect(result.status).toBe('FULLY_MATURE');
    expect(result.maturity_ratio).toBe(1);
    expect(result.watermark_at).toBe('2026-09-02T10:00:00.000Z');
  });

  it('retourne EMPTY sans inventer un ratio', () => {
    expect(deriveMaturityWatermark([])).toMatchObject({
      status: 'EMPTY',
      total_orders: 0,
      maturity_ratio: null,
      watermark_at: null,
    });
  });
});

describe('computeMarketMaturityWatermark — bornes canoniques obligatoires', () => {
  beforeEach(() => jest.clearAllMocks());

  it('refuse toute largeur implicite', async () => {
    await expect(computeMarketMaturityWatermark('market-cm')).rejects.toThrow('canonical cohort bounds');
    expect(db.query).not.toHaveBeenCalled();
  });

  it('scope strictement le marché et ne calcule aucun coverage gate', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ id: 'order-1', created_at: '2026-09-01T10:00:00Z' }] })
      .mockResolvedValueOnce({ rows: [baseEvidence()] });

    const result = await computeMarketMaturityWatermark('market-cm', {
      from: '2026-09-01T00:00:00Z',
      to: '2026-10-01T00:00:00Z',
    });

    expect(result.market_id).toBe('market-cm');
    expect(result.status).toBe('FULLY_MATURE');
    expect(result.threshold_applied).toBe(false);
    expect(result.coverage_status).toBeNull();
    expect(result.cohort.policy).toBe('externally_fixed_canonical_bounds');
    expect(db.query.mock.calls[0][0]).toContain('market_id = $1');
    expect(db.query.mock.calls[0][1]).toEqual([
      'market-cm',
      '2026-09-01T00:00:00Z',
      '2026-10-01T00:00:00Z',
    ]);
  });
});
