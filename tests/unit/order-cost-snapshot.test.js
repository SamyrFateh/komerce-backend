'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
jest.mock('../../services/pricing-engine', () => ({
  loadGlobalConfig: jest.fn(),
  recommend: jest.fn(),
}));
jest.mock('../../utils/logger', () => ({
  child: jest.fn(() => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() })),
  forModule: jest.fn(() => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() })),
}));

const pricingEngine = require('../../services/pricing-engine');
const { lockEstimatedCostsForOrder, _isActive, _deriveCanonicalCosts } = require('../../services/order-cost-snapshot');

describe('order-cost-snapshot', () => {
  const previousFlag = process.env.ORDER_COST_SNAPSHOT_ACTIVE;

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.ORDER_COST_SNAPSHOT_ACTIVE;
  });

  afterAll(() => {
    if (previousFlag === undefined) delete process.env.ORDER_COST_SNAPSHOT_ACTIVE;
    else process.env.ORDER_COST_SNAPSHOT_ACTIVE = previousFlag;
  });

  it('_isActive lit strictement ORDER_COST_SNAPSHOT_ACTIVE=true', () => {
    expect(_isActive()).toBe(false);
    process.env.ORDER_COST_SNAPSHOT_ACTIVE = 'TRUE';
    expect(_isActive()).toBe(true);
    process.env.ORDER_COST_SNAPSHOT_ACTIVE = '1';
    expect(_isActive()).toBe(false);
  });

  it('derive N1/N2/N3 depuis le contrat canonique sans confondre CDR et N2', () => {
    expect(_deriveCanonicalCosts({
      n1_landed_relay_cost_kmf: 1350,
      n2_business_variable_cost_kmf: 50,
      n3_fixed_overhead_allocation_kmf: 100,
      cdr_complete_kmf: 1500,
    })).toEqual({ n1: 1350, n2: 50, n3: 100, cdr: 1500 });
  });

  it('derive N2/N3 depuis le breakdown legacy quand les champs canoniques manquent', () => {
    expect(_deriveCanonicalCosts({
      landed_relay_cost_kmf: 1350,
      business_complete_cost_kmf: 1500,
      cost_breakdown: { business: { payment: 30, risk_provision: 20, fixed_overhead: 100 } },
    })).toEqual({ n1: 1350, n2: 50, n3: 100, cdr: 1500 });
  });

  it('no-op si feature flag desactive', async () => {
    const client = { query: jest.fn() };

    await expect(lockEstimatedCostsForOrder('order-001', client)).resolves.toEqual({
      order_id: 'order-001',
      imputations_count: 0,
      skipped: true,
      reason: 'ORDER_COST_SNAPSHOT_ACTIVE=false',
      total_estimated_landed_kmf: 0,
      total_estimated_business_variable_kmf: 0,
      total_estimated_fixed_overhead_kmf: 0,
      total_estimated_business_kmf: 0,
    });
    expect(client.query).not.toHaveBeenCalled();
  });

  it('exige un dbClient transactionnel quand actif', async () => {
    process.env.ORDER_COST_SNAPSHOT_ACTIVE = 'true';
    await expect(lockEstimatedCostsForOrder('order-001')).rejects.toThrow('dbClient is required');
  });

  it('skip sans order_items', async () => {
    process.env.ORDER_COST_SNAPSHOT_ACTIVE = 'true';
    const client = { query: jest.fn().mockResolvedValueOnce({ rows: [] }) };

    await expect(lockEstimatedCostsForOrder('order-empty', client)).resolves.toEqual({
      order_id: 'order-empty',
      imputations_count: 0,
      skipped: true,
      reason: 'no_order_items',
      total_estimated_landed_kmf: 0,
      total_estimated_business_variable_kmf: 0,
      total_estimated_fixed_overhead_kmf: 0,
      total_estimated_business_kmf: 0,
    });
    expect(pricingEngine.loadGlobalConfig).not.toHaveBeenCalled();
  });

  it('fige N1/N2/N3 par item et garde le CDR legacy pour compatibilite', async () => {
    process.env.ORDER_COST_SNAPSHOT_ACTIVE = 'true';
    const items = [
      { order_item_id: 'oi-1', product_id: 'prod-1', quantity: 2, price_kmf: 3000, category: 'food', weight_kg: 1, product_cost_kmf: 1000, volume_m3: 0.1 },
      { order_item_id: 'oi-2', product_id: 'prod-2', quantity: 1, price_kmf: 5000, category: 'home', weight_kg: 2, product_cost_kmf: 2000, volume_m3: 0.2 },
    ];
    const client = { query: jest.fn()
      .mockResolvedValueOnce({ rows: items })
      .mockResolvedValueOnce({ rows: [{ id: 'imp-1' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'imp-2' }] })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }) };
    pricingEngine.loadGlobalConfig.mockResolvedValueOnce({ cfg: true });
    pricingEngine.recommend
      .mockResolvedValueOnce({
        n1_landed_relay_cost_kmf: 1200,
        n2_business_variable_cost_kmf: 300,
        n3_fixed_overhead_allocation_kmf: 500,
        cdr_complete_kmf: 2000,
        cost_breakdown: { business: { payment: 200, risk_provision: 100, fixed_overhead: 500 }, allocation_averages: { confidence: 'high' } },
        data_quality: { confidence: 'high' },
      })
      .mockResolvedValueOnce({
        n1_landed_relay_cost_kmf: 2500,
        n2_business_variable_cost_kmf: 700,
        n3_fixed_overhead_allocation_kmf: 800,
        cdr_complete_kmf: 4000,
        cost_breakdown: { business: { payment: 500, risk_provision: 200, fixed_overhead: 800 }, allocation_averages: { confidence: 'medium' } },
        data_quality: { confidence: 'medium' },
      });

    const result = await lockEstimatedCostsForOrder('order-001', client, { source: 'checkout' });

    expect(result).toEqual({
      order_id: 'order-001',
      imputations_count: 2,
      skipped: false,
      total_estimated_landed_kmf: 4900,
      total_estimated_business_variable_kmf: 1300,
      total_estimated_fixed_overhead_kmf: 1800,
      total_estimated_business_kmf: 8000,
    });
    expect(pricingEngine.loadGlobalConfig).toHaveBeenCalledTimes(1);
    expect(pricingEngine.recommend).toHaveBeenCalledWith(expect.objectContaining({ product_id: 'prod-1', current_price_kmf: 3000 }), { config: { cfg: true } });

    const insertSql = client.query.mock.calls[1][0];
    const insertParams = client.query.mock.calls[1][1];
    expect(insertSql).toContain('estimated_business_variable_cost_kmf');
    expect(insertSql).toContain('estimated_fixed_overhead_kmf');
    expect(insertParams.slice(0, 12)).toEqual([
      'order-001', 'oi-1', 'prod-1', 2, 3000, 6000,
      2400, 4000, 600, 1000, 2000, 33.33,
    ]);
    expect(client.query.mock.calls[3][0]).toContain('UPDATE orders');
  });

  it('charge le modèle de coûts du marché figé sur la commande', async () => {
    process.env.ORDER_COST_SNAPSHOT_ACTIVE = 'true';
    const client = { query: jest.fn()
      .mockResolvedValueOnce({ rows: [{ order_item_id: 'oi-cm', product_id: 'prod-1', quantity: 1, price_kmf: 3000, market_id: 'market-cm' }] })
      .mockResolvedValueOnce({ rows: [] }) };
    pricingEngine.loadGlobalConfig.mockResolvedValueOnce({ market: 'CM' });
    pricingEngine.recommend.mockResolvedValueOnce({
      n1_landed_relay_cost_kmf: 1000,
      n2_business_variable_cost_kmf: 500,
      n3_fixed_overhead_allocation_kmf: 500,
      cdr_complete_kmf: 2000,
    });

    await lockEstimatedCostsForOrder('order-cm', client);

    expect(pricingEngine.loadGlobalConfig).toHaveBeenCalledWith({ marketId: 'market-cm' });
    expect(pricingEngine.recommend).toHaveBeenCalledWith(expect.any(Object), { config: { market: 'CM' } });
  });

  it('reste idempotent si ON CONFLICT DO NOTHING ne retourne aucune ligne', async () => {
    process.env.ORDER_COST_SNAPSHOT_ACTIVE = 'true';
    const client = { query: jest.fn()
      .mockResolvedValueOnce({ rows: [{ order_item_id: 'oi-1', product_id: 'prod-1', quantity: 1, price_kmf: 3000 }] })
      .mockResolvedValueOnce({ rows: [] }) };
    pricingEngine.loadGlobalConfig.mockResolvedValueOnce({});
    pricingEngine.recommend.mockResolvedValueOnce({
      n1_landed_relay_cost_kmf: 1000,
      n2_business_variable_cost_kmf: 500,
      n3_fixed_overhead_allocation_kmf: 500,
      cdr_complete_kmf: 2000,
    });

    await expect(lockEstimatedCostsForOrder('order-001', client)).resolves.toEqual({
      order_id: 'order-001',
      imputations_count: 0,
      skipped: false,
      total_estimated_landed_kmf: 0,
      total_estimated_business_variable_kmf: 0,
      total_estimated_fixed_overhead_kmf: 0,
      total_estimated_business_kmf: 0,
    });
    expect(client.query).toHaveBeenCalledTimes(2);
  });

  it('insere une imputation fallback avec N2/N3 NULL si pricing-engine echoue', async () => {
    process.env.ORDER_COST_SNAPSHOT_ACTIVE = 'true';
    const client = { query: jest.fn()
      .mockResolvedValueOnce({ rows: [{ order_item_id: 'oi-1', product_id: 'prod-1', quantity: 1, price_kmf: 3000 }] })
      .mockResolvedValueOnce({ rows: [{ id: 'imp-fallback' }] })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }) };
    pricingEngine.loadGlobalConfig.mockResolvedValueOnce({});
    pricingEngine.recommend.mockRejectedValueOnce(new Error('pricing_down'));

    const result = await lockEstimatedCostsForOrder('order-001', client);

    expect(result).toMatchObject({
      imputations_count: 1,
      total_estimated_landed_kmf: 0,
      total_estimated_business_variable_kmf: 0,
      total_estimated_fixed_overhead_kmf: 0,
      total_estimated_business_kmf: 0,
    });
    const params = client.query.mock.calls[1][1];
    expect(params[8]).toBeNull();
    expect(params[9]).toBeNull();
    expect(params[17]).toBe('fallback');
  });
});
