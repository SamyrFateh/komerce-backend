'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const mockQuery = jest.fn();
jest.mock('../../db', () => ({ query: (...args) => mockQuery(...args) }));

const { projectMarketPayload, isKmfKpi } = require('../../services/dashboard-metrics/market-currency');
const { invalidateCurrencyParityCache } = require('../../utils/currency');

const RATES = { KMF: 491.96775, XAF: 655.957, EUR: 1 };

beforeEach(() => {
  invalidateCurrencyParityCache();
  mockQuery.mockReset();
  mockQuery.mockImplementation(async (_sql, [currency]) => (
    RATES[currency] ? { rows: [{ eur_rate: RATES[currency] }] } : { rows: [] }
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
  expect(out.a.unit).toBe('KMF');
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
