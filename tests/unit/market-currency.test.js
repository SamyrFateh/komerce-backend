'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const mockQuery = jest.fn();
jest.mock('../../db', () => ({ query: (...args) => mockQuery(...args) }));

const { projectMarketPayload, projectCommerceMarketPayload, isKmfKpi } = require('../../services/dashboard-metrics/market-currency');
const { invalidateCurrencyParityCache } = require('../../utils/currency');

const RATES = { KMF: 491.96775, XAF: 655.957, EUR: 1 };

beforeEach(() => {
  invalidateCurrencyParityCache();
  mockQuery.mockReset();
  mockQuery.mockImplementation(async (_sql, [currency]) => (
    RATES[currency] ? { rows: [{ rate: String(RATES[currency]), updated_at: "2026-01-01T00:00:00.000Z" }] } : { rows: [] }
  ));
});

const kpi = (value, unit = 'KMF') => ({ key: 'ca', label: 'CA', value, unit, delta: { value: 12.5, unit: '%' } });

test('un marché KMF (ou sans devise) reçoit le payload tel quel, sans requête', async () => {
  const payload = { kpis: [kpi(1000)] };
  expect(await projectMarketPayload(payload, { currency: 'KMF', minor_unit: 0 })).toBe(payload);
  expect(await projectMarketPayload(payload, null)).toBe(payload);
  expect(mockQuery).not.toHaveBeenCalled();
});

test('un marché XAF voit ses KPI KMF projetés en XAF via EUR, arrondis au minor_unit, delta % intact', async () => {
  const payload = { header: { kpis: [kpi(491.96775 * 10)] }, rows: [{ total_kmf: 5000 }] };
  const out = await projectMarketPayload(payload, { currency: 'XAF', minor_unit: 0 });
  const k = out.header.kpis[0];
  expect(k.unit).toBe('XAF');
  expect(k.base_currency).toBe('KMF');
  expect(k.value).toBe(Math.round(10 * 655.957));
  expect(k.delta).toEqual({ value: 12.5, unit: '%' });
  // un champ nommé *_kmf reste en KMF : son nom dit déjà sa devise, jamais réétiqueté
  expect(out.rows[0].total_kmf).toBe(5000);
});

test('une alerte cash structurée suit aussi la devise d’affichage du marché', async () => {
  const payload = { signals: [{ amount: { value: 491.96775, unit: 'KMF' } }] };
  const out = await projectMarketPayload(payload, { currency: 'XAF', minor_unit: 0 });
  expect(out.signals[0].amount).toEqual({
    value: Math.round(655.957), unit: 'XAF', base_currency: 'KMF',
  });
  expect(payload.signals[0].amount).toEqual({ value: 491.96775, unit: 'KMF' });
});

test('le payload source (cache partagé) n’est jamais muté', async () => {
  const payload = { kpis: [kpi(1000)] };
  await projectMarketPayload(payload, { currency: 'XAF', minor_unit: 0 });
  expect(payload.kpis[0]).toEqual(kpi(1000));
});

test('valeurs nulles, vides, non numériques ou d’une autre unité : laissées telles quelles', async () => {
  expect(isKmfKpi(kpi(null))).toBe(false);
  expect(isKmfKpi(kpi(''))).toBe(false);
  expect(isKmfKpi(kpi('abc'))).toBe(false);
  expect(isKmfKpi(kpi(10, '%'))).toBe(false);
  expect(isKmfKpi(kpi('42.5'))).toBe(true);
  const out = await projectMarketPayload({ a: kpi(null), b: kpi(10, 'count') }, { currency: 'XAF', minor_unit: 0 });
  // KPI indisponible (null) : valeur inchangée, mais l'unité suit le marché (pas de fuite KMF).
  expect(out.a.value).toBeNull();
  expect(out.a.unit).toBe('XAF');
  expect(out.a.base_currency).toBe('KMF');
  expect(out.b.unit).toBe('count');
});

test('parité manquante : erreur explicite, jamais de repli silencieux en KMF', async () => {
  await expect(projectMarketPayload({ kpis: [kpi(1000)] }, { currency: 'ZZZ', minor_unit: 0 }))
    .rejects.toThrow(/parité/);
});

test('minor_unit non entier : traité comme 0', async () => {
  const out = await projectMarketPayload({ k: kpi(491.96775)}, { currency: 'EUR' });
  expect(out.k).toMatchObject({ unit: 'EUR', value: 1 });
});

test('Commerce CM : KPI et top produits en XAF, données *_kmf inchangées', async () => {
  const payload = {
    kpis: [kpi(4919.6775)],
    top_products: [{ name: 'Produit test', revenue_kmf: 4919.6775, quantity: 2 }],
    categories: [{ category: 'Maison', revenue_kmf: 4919.6775 }],
  };
  const projected = await projectCommerceMarketPayload(payload, { currency: 'XAF', minor_unit: 0 });
  expect(projected.kpis[0]).toMatchObject({ unit: 'XAF', value: Math.round(10 * 655.957) });
  expect(projected.top_products[0].revenue_kmf).toBe(4919.6775);
  expect(projected.top_products[0].revenue_display).toEqual({
    value: Math.round(10 * 655.957), unit: 'XAF', base_currency: 'KMF', minor_unit: 0,
  });
  expect(projected.categories[0].revenue_display.unit).toBe('XAF');
  expect(payload.top_products[0].revenue_display).toBeUndefined();
  expect(payload.kpis[0].unit).toBe('KMF');
});

test('Commerce KM : ne change aucun montant ni cohorte', async () => {
  const payload = { kpis: [kpi(15)], top_products: [{ revenue_kmf: 5000 }] };
  expect(await projectCommerceMarketPayload(payload, { currency: 'KMF' })).toBe(payload);
});

test('Commerce : parité manquante refuse toute valeur monétaire affichée, sans substitution ni mutation', async () => {
  const payload = {
    kpis: [kpi(1000), kpi(4, 'count')],
    top_products: [{ revenue_kmf: 1000 }],
    categories: [{ revenue_kmf: 1000 }],
    sales_series: [{ sales_kmf: 1000, orders: 4 }],
    sales_by_market: [{ sales_kmf: 1000, share_pct: 100 }],
    decision_signals: [{ value_kmf: -500 }],
  };
  const original=structuredClone(payload);
  const out=await projectCommerceMarketPayload(payload, { currency: 'ZZZ', minor_unit: 2 });
  expect(out.kpis[0]).toMatchObject({unit:'ZZZ',value:null,minor_unit:2,base_currency:'KMF',data_quality:{fx_status:'UNAVAILABLE',completeness:'provisional'}});
  expect(out.kpis[1]).toEqual(payload.kpis[1]);
  const missing={unit:'ZZZ',value:null,minor_unit:2,base_currency:'KMF'};
  expect(out.top_products[0].revenue_display).toEqual(missing);
  expect(out.categories[0].revenue_display).toEqual(missing);
  expect(out.sales_series[0]).toMatchObject({sales_display:missing,orders:4});
  expect(out.sales_by_market[0]).toMatchObject({sales_display:missing,share_pct:100});
  expect(out.decision_signals[0].value_display).toEqual(missing);
  expect(out.data_quality.warnings).toContainEqual(expect.objectContaining({code:'commerce_display_fx_unavailable'}));
  expect(payload).toEqual(original);
});

test('Commerce groupe : projection EUR à deux décimales, sans altérer la cohorte', async () => {
  const payload={kpis:[kpi(491.96775*12.34)],sales_series:[{sales_kmf:491.96775*12.34,orders:1}],buyer_cohort:{paid_buyers:1,population_token:'a'.repeat(32)}};
  const out=await projectCommerceMarketPayload(payload,null);
  expect(out.kpis[0]).toMatchObject({unit:'EUR',value:12.34,minor_unit:2});
  expect(out.sales_series[0].sales_display).toEqual({unit:'EUR',value:12.34,minor_unit:2,base_currency:'KMF'});
  expect(out.buyer_cohort).toEqual(payload.buyer_cohort);
});
