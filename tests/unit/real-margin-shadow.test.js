'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * Marge réelle canonique — shadow mode : classement de complétude, achat
 * catalogue ≠ réel, achat confirmé sans taux, douane inconnue, pas de double
 * comptage, annulée, et aucune requête d'écriture.
 */

const mockQuery = jest.fn();
jest.mock('../../db', () => ({ query: (...a) => mockQuery(...a) }));

const { computeOrderRealMarginShadow, listRealMarginShadow } = require('../../services/cost-allocation/real-margin-shadow');

const MARKET = '11111111-1111-4111-8111-111111111111';

function setup({
  order = {}, est = {}, real = [], refunds = {}, purchase = {}, pay = {}, settle = {},
} = {}) {
  const o = {
    id: 'o1', market_id: MARKET, status: 'confirmed', payment_status: 'paid',
    total_kmf: '10000', discount_kmf: '0', wallet_applied_kmf: '0', transport_price_kmf: '0',
    cost_real_kmf: null, cost_transport_kmf: '0', cost_douane_kmf: '0',
    margin_real_pct: null, margin_alert: false, sourcing_blocked: false, customs_unknown: false,
    ...order,
  };
  const e = {
    imputations_count: 1, missing_snapshot_count: 0,
    e_product_purchase: '4000', e_sourcing: '0', e_hub: '0', e_packaging: '0', e_freight: '500',
    e_customs: '1000', e_port_transitary: '0', e_local_distribution: '0', e_relay: '0',
    e_payment: '0', e_risk: '0', ...est,
  };
  mockQuery.mockImplementation(async (sql) => {
    if (/settle:lines/.test(sql)) return { rows: settle.lines || [] };
    if (/settle:payments/.test(sql)) return { rows: settle.payments || [] };
    if (/settle:settlements/.test(sql)) return { rows: settle.settlements || [] };
    if (/FROM orders o WHERE o\.id/.test(sql)) return { rows: [o] };
    if (/FROM order_item_cost_imputations/.test(sql)) return { rows: [e] };
    if (/FROM order_item_real_cost_allocations/.test(sql)) return { rows: real };
    if (/FROM refunds/.test(sql)) return { rows: [{ done: '0', pending: '0', ...refunds }] };
    if (/FROM purchase_lines pl JOIN order_items/.test(sql)) {
      return { rows: [{ lines: 0, quantity: 0, amount: null, currencies: 0, currency: null, ...purchase }] };
    }
    if (/FROM supplier_execution_payments/.test(sql)) return { rows: [{ payments: 0, verified: 0, ...pay }] };
    if (/SELECT id FROM orders/.test(sql)) return { rows: [{ id: 'o1' }] };
    throw new Error(`SQL inattendu: ${sql.slice(0, 60)}`);
  });
}

const realRow = (cost_type, amount, extra = {}) => ({
  cost_type, amount, source: 'customs_shipments', allocation_method: 'by_value', is_actual: true, ...extra,
});

beforeEach(() => mockQuery.mockReset());

describe('real-margin-shadow', () => {
  it('provisional : douane+fret réels, achat estimé figé, marge real_plus_estimated', async () => {
    setup({ real: [realRow('customs', '1200'), realRow('freight', '500')] });
    const r = await computeOrderRealMarginShadow('o1');
    expect(r.completeness).toBe('provisional');
    expect(r.costs.by_type.customs).toMatchObject({ state: 'real', real_kmf: 1200, estimated_kmf: 1000 });
    expect(r.costs.by_type.product_purchase.state).toBe('estimated_only');
    expect(r.margin.basis).toBe('real_plus_estimated');
    expect(r.margin.shadow_kmf).toBe(10000 - 4000 - 500 - 1200);
    expect(r.margin.shadow_pct).toBe(43);
    expect(r.contribution_after_logistics_kmf).toBe(4300);
  });

  it("achat catalogue (products.cost_kmf, is_actual) n'est jamais réel", async () => {
    setup({ real: [realRow('product_purchase', '4100', { source: 'products.cost_kmf' }), realRow('customs', '1000'), realRow('freight', '500')] });
    const r = await computeOrderRealMarginShadow('o1');
    expect(r.costs.by_type.product_purchase.state).toBe('estimated_only');
    expect(r.costs.by_type.product_purchase.real_kmf).toBeNull();
    expect(r.purchase.catalog_estimate_kmf).toBe(4100);
    expect(r.costs.real_total_kmf).toBe(1500);
    expect(r.completeness).toBe('provisional');
  });

  it('achat confirmé sans taux supporté -> confirmed_unvalued, fx_borne null', async () => {
    setup({
      real: [realRow('customs', '1000'), realRow('freight', '500')],
      purchase: { lines: 2, quantity: 3, amount: '120.5', currencies: 1, currency: 'AED' },
    });
    const r = await computeOrderRealMarginShadow('o1');
    expect(r.costs.by_type.product_purchase.state).toBe('confirmed_unvalued');
    expect(r.costs.unvalued_types).toEqual(['product_purchase']);
    expect(r.purchase).toMatchObject({ fx_borne: null, state: 'confirmed_unvalued' });
    expect(r.purchase.confirmed).toEqual({ lines: 2, quantity: 3, amount: 120.5, currency: 'AED' });
    expect(r.completeness).toBe('provisional');
    expect(r.margin.shadow_kmf).toBe(10000 - 4000 - 1500); // estimé figé conservé
  });

  it('devises mixtes : montant confirmé non sommé', async () => {
    setup({ purchase: { lines: 2, quantity: 2, amount: '10', currencies: 2, currency: 'AED' } });
    const r = await computeOrderRealMarginShadow('o1');
    expect(r.purchase.confirmed).toMatchObject({ amount: null, currency: 'MIXED' });
  });

  it('douane inconnue -> incomplete, marge null', async () => {
    setup({ order: { customs_unknown: true } });
    const r = await computeOrderRealMarginShadow('o1');
    expect(r.completeness).toBe('incomplete');
    expect(r.costs.unknown_types).toEqual(['customs']);
    expect(r.margin).toMatchObject({ shadow_kmf: null, shadow_pct: null, basis: null });
    expect(r.contribution_after_logistics_kmf).toBeNull();
  });

  it('imputations absentes -> incomplete', async () => {
    setup({ est: { imputations_count: 0, e_product_purchase: '0', e_freight: '0', e_customs: '0' } });
    const r = await computeOrderRealMarginShadow('o1');
    expect(r.completeness).toBe('incomplete');
    expect(r.costs.unknown_types).toEqual(['all_imputations']);
    expect(r.alerts.forecast_margin_lt_10).toBeNull();
  });

  it('final : tout type attendu a un réel traçable', async () => {
    setup({ est: { e_product_purchase: '0' }, real: [realRow('customs', '1000'), realRow('freight', '500')] });
    const r = await computeOrderRealMarginShadow('o1');
    expect(r.completeness).toBe('final');
    expect(r.margin.basis).toBe('real_only');
    expect(r.margin.shadow_kmf).toBe(8500);
  });

  it('estimated_fallback (répartition approximative d\'un montant déclaré) = réel, source marquée basse confiance', async () => {
    setup({ real: [realRow('customs', '1000', { allocation_method: 'estimated_fallback' }), realRow('freight', '500')] });
    const r = await computeOrderRealMarginShadow('o1');
    expect(r.costs.by_type.customs.state).toBe('real');
    expect(r.costs.by_type.customs.real_source).toContain('low_confidence_split');
  });

  it('allocation is_actual=false ne compte pas comme réel', async () => {
    setup({ real: [realRow('customs', '1000', { is_actual: false }), realRow('freight', '500')] });
    const r = await computeOrderRealMarginShadow('o1');
    expect(r.costs.by_type.customs.state).toBe('estimated_only');
  });

  it('pas de double comptage douane : cost_douane_kmf legacy jamais additionné', async () => {
    setup({
      order: { cost_douane_kmf: '9999', cost_transport_kmf: '8888', cost_real_kmf: '18887' },
      real: [realRow('customs', '1000'), realRow('freight', '500')],
    });
    const r = await computeOrderRealMarginShadow('o1');
    expect(r.margin.shadow_kmf).toBe(10000 - 4000 - 500 - 1000);
    expect(r.legacy).toMatchObject({ cost_douane_kmf: 9999, cost_transport_kmf: 8888, cost_real_kmf: 18887 });
  });

  it.each(['cancelled', 'refunded'])('commande %s -> not_applicable', async (status) => {
    setup({ order: { status } });
    const r = await computeOrderRealMarginShadow('o1');
    expect(r.completeness).toBe('not_applicable');
    expect(r.margin.shadow_pct).toBeNull();
  });

  it('CA net : remise, wallet, livraison, remboursement complété', async () => {
    setup({
      order: { total_kmf: '9000', discount_kmf: '500', wallet_applied_kmf: '1000', transport_price_kmf: '700' },
      refunds: { done: '1500', pending: '200' },
    });
    const r = await computeOrderRealMarginShadow('o1');
    expect(r.revenue).toMatchObject({ gross_kmf: 10500, discounts_kmf: 500, refunds_kmf: 1500, delivery_kmf: 700, delivery_counted: true, net_kmf: 8500 });
    expect(r.revenue.flags).toEqual(expect.arrayContaining([
      'wallet_credit_counted_as_revenue', 'refund_not_completed_not_deducted', 'refund_components_unknown_delivery_vs_goods',
    ]));
  });

  it('delta vs marge legacy et alertes distinctes', async () => {
    setup({ order: { margin_real_pct: '30.000' }, real: [realRow('customs', '1000'), realRow('freight', '500')] });
    const r = await computeOrderRealMarginShadow('o1');
    expect(r.delta_pct_points).toBe(r.margin.shadow_pct - 30);
    expect(r.alerts).toEqual({ forecast_margin_lt_10: false, real_margin_lt_10: false });
    setup({ est: { e_product_purchase: '9500' }, real: [realRow('customs', '1000'), realRow('freight', '500')] });
    const r2 = await computeOrderRealMarginShadow('o1');
    expect(r2.alerts.forecast_margin_lt_10).toBe(true);
    expect(r2.alerts.real_margin_lt_10).toBe(true);
  });

  it('isolation marché : autre marché -> null', async () => {
    setup();
    expect(await computeOrderRealMarginShadow('o1', { marketId: '22222222-2222-4222-8222-222222222222' })).toBeNull();
  });

  it('commande inexistante -> null', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    expect(await computeOrderRealMarginShadow('x')).toBeNull();
  });

  it('listing : marketId obligatoire + agrégat par complétude', async () => {
    await expect(listRealMarginShadow({})).rejects.toThrow(/marketId/);
    setup({ order: { margin_real_pct: '30' }, real: [realRow('customs', '1000'), realRow('freight', '500')] });
    const l = await listRealMarginShadow({ marketId: MARKET });
    expect(l.aggregate.by_completeness).toEqual({ provisional: 1 });
    expect(l.aggregate.orders_with_legacy_margin).toBe(1);
    expect(l.aggregate.avg_delta_pct_points).not.toBeNull();
    const listSql = mockQuery.mock.calls.find(([s]) => /SELECT id FROM orders/.test(s));
    expect(listSql[0]).toMatch(/market_id = \$1/);
    expect(listSql[1][0]).toBe(MARKET);
  });

  it("aucune requête d'écriture émise", async () => {
    setup({ purchase: { lines: 1, quantity: 1, amount: '5', currencies: 1, currency: 'AED' } });
    await computeOrderRealMarginShadow('o1');
    await listRealMarginShadow({ marketId: MARKET });
    const sqls = mockQuery.mock.calls.map(([s]) => String(s).trim());
    expect(sqls.length).toBeGreaterThan(0);
    for (const s of sqls) {
      expect(s).toMatch(/^SELECT/i);
      expect(s).not.toMatch(/^\s*(INSERT|UPDATE|DELETE|TRUNCATE|ALTER|DROP|CREATE)\b/i);
    }
  });
});
