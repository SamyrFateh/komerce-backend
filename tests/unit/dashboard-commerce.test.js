'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

jest.mock('../../db', () => ({ query: jest.fn() }));
// Le journal financier a sa propre lecture bornée (m.market_id) et ses propres tests PG : ici seule la cohorte commandes est comptée.
jest.mock('../../services/financial-journal-reporting', () => ({ projection: jest.fn(async () => ({ journal_empty: true, lines: [] })) }));

const mockMetrics = {
  getCAEncaisse: jest.fn(),
  getCmdsCreees: jest.fn(),
  getMargeConsolidee: jest.fn(),
  getProduitsActifsVendus: jest.fn(),
};
jest.mock('../../services/dashboard-metrics', () => mockMetrics);

const mockPricingMarketCorridor = {
  buildMarketCorridor: jest.fn(),
};
jest.mock('../../services/pricing-market-corridor', () => mockPricingMarketCorridor);

const mockLocalStockDecision = {
  getDecisionAvailabilityEvidence: jest.fn(),
};
jest.mock('../../services/local-stock-decision-projection', () => mockLocalStockDecision);

const db = require('../../db');
const commerce = require('../../services/dashboard-commerce');

const metric = (key, label, value, unit = 'count') => ({
  key,
  label,
  value,
  unit,
  delta: null,
  data_quality: { completeness: 'complete', items_total: null, items_with_data: null, warning: null },
  drill_to: null,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockMetrics.getCAEncaisse.mockResolvedValue(metric('ca_encaisse', 'CA encaissé', 120000, 'KMF'));
  mockMetrics.getCmdsCreees.mockResolvedValue(metric('cmds_creees', 'Commandes créées', 12));
  mockMetrics.getMargeConsolidee.mockResolvedValue(metric('marge_consolidee', 'Marge consolidée', 24500, 'KMF'));
  mockMetrics.getProduitsActifsVendus.mockResolvedValue(metric('produits_actifs_vendus', 'Produits actifs vendus', 8));
  mockPricingMarketCorridor.buildMarketCorridor.mockResolvedValue({
    corridor: {
      local: {
        confidence: 'high',
        viability: {
          status: 'VIABLE_UNDER_CONDITIONS',
          label: 'Viable sous conditions',
          reason: 'La cible marché exige une meilleure condition de sourcing.',
          sourcing_action: 'RENEGOTIATE_OR_REPOSITION',
          market_confidence: 'high',
          contribution_scenarios_kmf: { low_kmf: -500, target_kmf: 400, high_kmf: 1600 },
          purchase_cost_kmf: 35000,
          purchase_cost_ceiling_at_target_kmf: { safe_kmf: 33000 },
          purchase_cost_gap_to_safe_ceiling_kmf: -2000,
          authority: 'SERVER_DERIVED_DECISION_SUPPORT_NOT_GATE',
        },
      },
    },
  });
  mockLocalStockDecision.getDecisionAvailabilityEvidence.mockResolvedValue({
    tracked: true,
    commercial_exposure: 'ENABLED',
    availability: 'UNAVAILABLE',
    exposable: false,
    authority: 'LOCAL_STOCK',
    basis: 'physical_minus_active_allocations',
  });

  db.query
    .mockResolvedValueOnce({ rows: [{ sales_kmf: '120000', basket_kmf: '10000', items_total: '12' }] })
    .mockResolvedValueOnce({ rows: [{ product_id: 'product-cm-1', product_ref: 'PRD-1', name: 'Téléphone', category: 'Électronique', quantity: '3', revenue_kmf: '90000' }] })
    .mockResolvedValueOnce({ rows: [{
      product_ref: 'PRD-1',
      product_name: 'Téléphone',
      category: 'Électronique',
      orders: '3',
      quantity: '3',
      revenue_kmf: '90000',
      estimated_cost_kmf: '54000',
      actual_orders: '2',
      actual_revenue_kmf: '60000',
      real_cost_kmf: '35000',
    }] })
    .mockResolvedValueOnce({ rows: [{ category: 'Électronique', orders: '3', quantity: '3', revenue_kmf: '90000' }] })
    .mockResolvedValueOnce({ rows: [{ created: '12', paid: '10', shipped: '8', available: '6', collected: '4', lost: '2' }] })
    .mockResolvedValueOnce({ rows: [{ day: '2026-08-20', sales_kmf: '50000', orders: 5 }, { day: '2026-08-22', sales_kmf: '70000', orders: 7 }] })
    .mockResolvedValueOnce({ rows: [{ market_code: 'CM', market_name: 'Cameroun', sales_kmf: '90000' }, { market_code: 'CG', market_name: 'Congo', sales_kmf: '30000' }] })
    .mockResolvedValueOnce({ rows: [{ reference: 'CMD-1', created_at: new Date('2026-08-23T10:00:00Z'), status: 'confirmed', total_kmf: '10000', market_code: 'CM', client_name: null }] });
});

describe('dashboard-commerce', () => {
  test('normalise uniquement les périodes supportées', () => {
    expect(commerce.normalizePeriod('7')).toBe(7);
    expect(commerce.normalizePeriod('90')).toBe(90);
    expect(commerce.normalizePeriod('365')).toBe(30);
    expect(commerce.normalizePeriod('x')).toBe(30);
  });

  test('buildPeriodFilters : N jours civils du marché incluant aujourd\'hui, fuseau exposé', () => {
    const now = new Date('2026-10-17T22:30:00Z');
    const km = commerce.buildPeriodFilters({ period: '7' }, 'mk', now, { code: 'KM' });
    expect(km).toMatchObject({ period: 7, timezone: 'Indian/Comoro', timezone_source: 'market' });
    expect(km.filters.from).toBe('2026-10-11T21:00:00.000Z'); // 12/10 00:00 UTC+3 = 11/10 21:00Z ; 18/10 - 6 j
    expect(km.filters.to).toBe(now.toISOString());
    const cm = commerce.buildPeriodFilters({ period: '7' }, 'mc', now, { code: 'CM' });
    expect(cm.filters.from).toBe('2026-10-10T23:00:00.000Z'); // 11/10 00:00 UTC+1
    const g = commerce.buildPeriodFilters({ period: '7' }, null, now);
    expect(g).toMatchObject({ timezone: 'UTC', timezone_source: 'global_utc' });
    expect(g.filters.from).toBe('2026-10-11T00:00:00.000Z');
  });

  test('projection market-scoped injecte le market_id dans métriques et projette viabilité + disponibilité locale canoniques', async () => {
    const now = new Date('2026-08-24T12:00:00.000Z');
    const market = { id: 'market-cm-id', code: 'CM', name: 'Cameroun', currency: 'XAF' };

    const result = await commerce.buildCommerce({ period: '30' }, { market, now });

    expect(result.scope).toEqual({
      mode: 'market',
      market: { code: 'CM', name: 'Cameroun', currency: 'XAF' },
    });
    expect(result.period).toBe(30);
    expect(result.business_timezone).toBe('Africa/Douala');
    expect(result.period_definition).toMatchObject({ kind: 'civil_days_including_today', days: 30, timezone: 'Africa/Douala' });
    expect(result.recent_orders[0].business_day).toBe('2026-08-23');
    expect(result.sales_series).toEqual([{ day: '2026-08-20', sales_kmf: 50000, orders: 5 }, { day: '2026-08-22', sales_kmf: 70000, orders: 7 }]);
    expect(result.sales_by_market.map(m => [m.market_code, m.share_pct])).toEqual([['CM', 75], ['CG', 25]]);
    expect(result.recent_orders[0]).toMatchObject({ reference: 'CMD-1', market_code: 'CM', client_name: null, total_kmf: 10000 });
    expect(result.data_quality).toMatchObject({
      scope_enforced: true,
      scope_mode: 'market',
      product_real_margin_basis: 'actual_cost_orders_only',
      product_viability_basis: 'market_price_corridor_local_evidence',
      product_availability_basis: 'local_stock_exposure_and_active_allocations',
      decision_authority: 'server',
      decision_signal_contract: 'decision_signals_projection_only_v1',
      warnings: [],
      source_features: ['economic-engine', 'local-stock'],
    });
    expect(JSON.stringify(result)).not.toContain('market-cm-id');
    expect(JSON.stringify(result)).not.toContain('product-cm-1');

    expect(mockMetrics.getCAEncaisse).not.toHaveBeenCalled(); // Commerce != cash receipts
    for (const fn of [mockMetrics.getCmdsCreees, mockMetrics.getMargeConsolidee, mockMetrics.getProduitsActifsVendus]) {
      expect(fn).toHaveBeenCalledWith(expect.objectContaining({
        market_id: 'market-cm-id',
        from: '2026-07-25T23:00:00.000Z', // 30 jours civils Douala incl. 24/08 -> 26/07 00:00 (ancien : now-30x24h UTC)
        to: '2026-08-24T12:00:00.000Z',
      }));
    }

    expect(db.query).toHaveBeenCalledTimes(8);
    db.query.mock.calls.forEach(([sql, params]) => {
      expect(String(sql)).toContain('o.market_id =');
      expect(params).toContain('market-cm-id');
    });
    expect(mockPricingMarketCorridor.buildMarketCorridor).toHaveBeenCalledWith({ market, productRef: 'PRD-1' });
    expect(mockLocalStockDecision.getDecisionAvailabilityEvidence).toHaveBeenCalledWith('product-cm-1', 'market-cm-id');

    expect(result.kpis.map(item => item.key)).toEqual([
      'ca_encaisse', 'cmds_creees', 'panier_moyen', 'marge_consolidee', 'produits_actifs_vendus', 'quantites_vendues',
    ]);
    expect(result.kpis[0]).toMatchObject({ key: 'ca_encaisse', label: 'Ventes payées (avoir inclus)', value: 120000, data_quality: { cash_basis: false } });
    expect(result.kpis[2]).toMatchObject({ key: 'panier_moyen', value: 10000 });
    expect(result.kpis[2].drill_to).toBe('/admin/operations');
    expect(result.kpis[4].unit).toBe('count');
    expect(result.kpis[5]).toMatchObject({ key: 'quantites_vendues', value: 3, unit: 'count' });
    expect(result.top_products[0]).toEqual({
      product_ref: 'PRD-1', name: 'Téléphone', category: 'Électronique', quantity: 3, revenue_kmf: 90000, share_pct: 100,
    });
    expect(result.product_profitability[0]).toEqual(expect.objectContaining({
      product_ref: 'PRD-1',
      revenue_kmf: 90000,
      estimated_margin_kmf: 36000,
      consolidated_margin_kmf: 25000,
      actual_orders: 2,
      cost_coverage_pct: 66.7,
    }));
    expect(result.product_viability[0]).toEqual(expect.objectContaining({
      product_ref: 'PRD-1',
      status: 'VIABLE_UNDER_CONDITIONS',
      sourcing_action: 'RENEGOTIATE_OR_REPOSITION',
      purchase_cost_gap_to_safe_ceiling_kmf: -2000,
    }));
    expect(result.product_availability[0]).toEqual(expect.objectContaining({
      product_ref: 'PRD-1',
      state: 'LOCAL_EXPOSED_UNAVAILABLE',
      commercial_exposure: 'ENABLED',
      authority: 'LOCAL_STOCK',
    }));
    expect(result.decision_signals.map(signal => signal.kind)).toEqual([
      'best_seller_local_unavailable',
      'sku_viable_under_conditions',
      'orders_lost',
      'costing_incomplete',
    ]);
    expect(result.decision_signals[0]).toMatchObject({
      severity: 'warning',
      product_ref: 'PRD-1',
      signal_type: 'best_seller_local_unavailable',
      title: 'Best-seller sans disponibilité immédiate',
      scope: { mode: 'market', market_code: 'CM' },
      lifecycle: { mode: 'projection_only', persisted: false },
      destination: { kind: 'market_catalog', market_code: 'CM', product_ref: 'PRD-1' },
    });
    expect(result.decision_signals[1]).toMatchObject({
      severity: 'warning',
      product_ref: 'PRD-1',
      destination: { kind: 'pricing_workspace', market_code: 'CM', product_ref: 'PRD-1' },
    });
    expect(result.funnel.steps.map(step => step.pct)).toEqual([100, 83.3, 66.7, 50, 33.3]);
  });

  test('aucune commande payée : le panier moyen est non calculable, pas 0 KMF', async () => {
    db.query.mockReset().mockResolvedValueOnce({ rows: [{ sales_kmf: '0', basket_kmf: null, items_total: 0 }] });
    const result = await commerce.getCommercePaidSales({ market_id: 'market-cm-id', simulation_scope: 'RCT1' });
    expect(result.panier).toMatchObject({ key: 'panier_moyen', value: null, data_quality: { completeness: 'provisional', items_total: 0 } });
    expect(result.ca.value).toBe(0);
    expect(db.query.mock.calls[0][1]).toContain('market-cm-id');
    expect(db.query.mock.calls[0][1]).toContain('RCT1');
  });

  test('ventes payées : wallet est une composante du règlement, jamais une déduction de CA', async () => {
    db.query.mockReset().mockResolvedValueOnce({ rows: [{ sales_kmf: '18000', basket_kmf: '9000', items_total: 2 }] });
    const metrics = await commerce.getCommercePaidSales({ market_id: 'market-cm-id' });
    expect(metrics.ca.value).toBe(18000);
    expect(metrics.panier.value).toBe(9000);
    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toContain('o.total_kmf + COALESCE(o.wallet_applied_kmf, 0)');
    expect(sql).toContain("o.payment_status = 'paid'");
    expect(sql).toContain("o.status NOT IN ('cancelled', 'refunded')");
    expect(sql).toContain('o.simulation_scope IS NULL');
    expect(params).toContain('market-cm-id');
  });

  test('une rentabilité sans costing actual ne fabrique jamais de marge réelle', async () => {
    db.query.mockReset();
    db.query.mockResolvedValueOnce({ rows: [{
      product_ref: 'PRD-X',
      product_name: 'Produit X',
      category: 'Test',
      orders: '4',
      quantity: '4',
      revenue_kmf: '100000',
      estimated_cost_kmf: '60000',
      actual_orders: '0',
      actual_revenue_kmf: null,
      real_cost_kmf: null,
    }] });

    const rows = await commerce.getProductProfitability({ market_id: 'market-cm-id' });
    expect(rows[0]).toMatchObject({ estimated_margin_kmf: 40000, consolidated_margin_kmf: null, real_cost_kmf: null });
    expect(String(db.query.mock.calls[0][0])).toContain('o.market_id =');
    expect(db.query.mock.calls[0][1]).toContain('market-cm-id');
  });

  test('une indisponibilité ponctuelle du corridor n’abat pas Commerce et reste visible en qualité des données', async () => {
    const market = { id: 'market-cm-id', code: 'CM', name: 'Cameroun', currency: 'XAF' };
    const projection = await commerce.getTopProductViability([
      { product_ref: 'PRD-X', name: 'Produit X', category: 'Test', quantity: 2, revenue_kmf: 20000 },
    ], market, {
      buildMarketCorridor: jest.fn().mockRejectedValue(new Error('corridor unavailable')),
    });

    expect(projection.items).toEqual([]);
    expect(projection.warnings).toEqual([
      expect.objectContaining({ code: 'commerce_product_viability_unavailable', product_ref: 'PRD-X' }),
    ]);
  });

  test('absence de ligne locale et exposition désactivée ne sont jamais qualifiées de rupture best-seller', async () => {
    const market = { id: 'market-cm-id', code: 'CM', name: 'Cameroun', currency: 'XAF' };
    const products = [{ product_id: 'product-x', product_ref: 'PRD-X', name: 'Produit X', quantity: 4, revenue_kmf: 50000 }];

    const noRow = await commerce.getTopProductAvailability(products, market, {
      getAvailabilityEvidence: jest.fn().mockResolvedValue({
        tracked: false, commercial_exposure: null, availability: 'UNAVAILABLE', exposable: false, authority: 'LOCAL_STOCK',
      }),
    });
    expect(noRow.items[0].state).toBe('NO_LOCAL_STOCK');
    expect(commerce.availabilitySignal(noRow.items[0], market)).toBeNull();

    const disabled = await commerce.getTopProductAvailability(products, market, {
      getAvailabilityEvidence: jest.fn().mockResolvedValue({
        tracked: true, commercial_exposure: 'DISABLED', availability: 'AVAILABLE_NOW', exposable: false, authority: 'LOCAL_STOCK',
      }),
    });
    expect(disabled.items[0].state).toBe('LOCAL_NOT_EXPOSED');
    expect(commerce.availabilitySignal(disabled.items[0], market)).toBeNull();
  });

  test('seul un stock local explicitement exposé mais non disponible devient un signal', async () => {
    const market = { id: 'market-cm-id', code: 'CM', name: 'Cameroun', currency: 'XAF' };
    const products = [{ product_id: 'product-x', product_ref: 'PRD-X', name: 'Produit X', quantity: 4, revenue_kmf: 50000 }];
    const projection = await commerce.getTopProductAvailability(products, market, {
      getAvailabilityEvidence: jest.fn().mockResolvedValue({
        tracked: true, commercial_exposure: 'ENABLED', availability: 'UNAVAILABLE', exposable: false, authority: 'LOCAL_STOCK',
      }),
    });
    const signal = commerce.availabilitySignal(projection.items[0], market);
    expect(projection.items[0].state).toBe('LOCAL_EXPOSED_UNAVAILABLE');
    expect(signal).toMatchObject({
      kind: 'best_seller_local_unavailable',
      severity: 'warning',
      source: 'local_stock_service',
      recommendation: 'REVIEW_LOCAL_STOCK',
    });
    expect(signal.helper).toMatch(/import peut rester disponible/i);
  });

  test('une panne de lecture local-stock n’abat pas Commerce et devient un warning de qualité', async () => {
    const market = { id: 'market-cm-id', code: 'CM', name: 'Cameroun', currency: 'XAF' };
    const projection = await commerce.getTopProductAvailability([
      { product_id: 'product-x', product_ref: 'PRD-X', name: 'Produit X', quantity: 1, revenue_kmf: 10000 },
    ], market, {
      getAvailabilityEvidence: jest.fn().mockRejectedValue(new Error('local stock unavailable')),
    });
    expect(projection.items).toEqual([]);
    expect(projection.warnings).toEqual([
      expect.objectContaining({ code: 'commerce_product_availability_unavailable', product_ref: 'PRD-X' }),
    ]);
  });

  test('la priorité serveur place non-viabilité puis disponibilité immédiate avant les pertes et le costing incomplet', () => {
    const market = { code: 'KM' };
    const signals = commerce.buildDecisionSignals({
      market,
      funnel: { lost: 2 },
      margin: metric('marge_consolidee', 'Marge consolidée', 1000, 'KMF'),
      productProfitability: [{ consolidated_margin_kmf: null, cost_coverage_pct: 0 }],
      productViability: [{
        product_ref: 'PRD-9', name: 'Produit 9', status: 'NON_VIABLE_STRUCTURAL',
        reason: 'Même la borne haute ne couvre pas le coût variable.', market_confidence: 'high', revenue_kmf: 50000,
      }],
      productAvailability: [{
        product_ref: 'PRD-8', name: 'Produit 8', state: 'LOCAL_EXPOSED_UNAVAILABLE',
        commercial_exposure: 'ENABLED', revenue_kmf: 40000, quantity: 5,
      }],
    });
    expect(signals.map(signal => signal.kind)).toEqual([
      'sku_non_viable',
      'best_seller_local_unavailable',
      'orders_lost',
      'costing_incomplete',
    ]);
    expect(signals.every(signal => signal.lifecycle?.mode === 'projection_only')).toBe(true);
  });

  test('projection globale n’invente aucun market_id, aucune viabilité locale ni disponibilité locale', async () => {
    const now = new Date('2026-08-24T12:00:00.000Z');
    const result = await commerce.buildCommerce({ period: '7' }, { now });

    expect(result.scope).toEqual({ mode: 'global', market: null });
    expect(result.product_viability).toEqual([]);
    expect(result.product_availability).toEqual([]);
    expect(result.data_quality).toMatchObject({
      scope_enforced: true,
      scope_mode: 'global',
      product_viability_basis: 'not_applicable_global',
      product_availability_basis: 'not_applicable_global',
      decision_authority: 'server',
    });
    expect(mockPricingMarketCorridor.buildMarketCorridor).not.toHaveBeenCalled();
    expect(mockLocalStockDecision.getDecisionAvailabilityEvidence).not.toHaveBeenCalled();
    expect(mockMetrics.getCAEncaisse).not.toHaveBeenCalled();
    expect(mockMetrics.getCmdsCreees.mock.calls[0][0]).not.toHaveProperty('market_id');
    db.query.mock.calls.forEach(([sql, params]) => {
      expect(String(sql)).not.toContain('o.market_id =');
      expect(params || []).not.toContain('market-cm-id');
    });
  });

  test('encaissé net : journal vide → indisponible (jamais le CA) ; part des lignes calculée sur la même cohorte', async () => {
    const reporting = require('../../services/financial-journal-reporting');
    reporting.projection.mockResolvedValueOnce({ journal_empty: false, lines: [
      { category: 'sale', state: 'observed', eur_total: 100, eur_unavailable: 0, native: [{ currency: 'KMF', total: '49200' }] },
      { category: 'refund', state: 'settled', eur_total: 10, eur_unavailable: 1, native: [{ currency: 'KMF', total: '4920' }] },
    ] });
    expect(typeof commerce.getCollectedFromJournal).toBe('function');
    const got = await commerce.getCollectedFromJournal({ from: 'a', to: 'b' }, { id: 'm1' });
    expect(got).toMatchObject({ available: true, eur_net: 90, eur_partial: true, native_net: [{ currency: 'KMF', total: 44280 }] });
    const empty = await commerce.getCollectedFromJournal({}, null);
    expect(empty).toEqual({ available: false, reason: 'journal_empty' });
  });
});
