#!/usr/bin/env node
'use strict';

const fs = require('fs');

const path = 'tests/unit/eco-bridge.test.js';
const source = fs.readFileSync(path, 'utf8');
if (!source.includes("describe('loadEcoVars'")) throw new Error('eco-bridge legacy test shape not found');
if (!source.includes("value_used prioritaire sur value_supposed")) throw new Error('expected legacy assertions missing');

fs.writeFileSync(path, `'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * LOT 1A-4 — utils/eco-bridge.js
 *
 * Le bridge ne lit plus economic_variables. Il expose les anciennes clés
 * runtime depuis finance_config et conserve son cache 60s + résumé charges.
 */

const mockDbQuery = jest.fn();
const mockLoadFinanceConfig = jest.fn();
const mockResolveLegacyInput = jest.fn();

jest.mock('../../db', () => ({ query: (...args) => mockDbQuery(...args) }));
jest.mock('../../services/economic-config', () => ({
  LEGACY_RUNTIME_INPUTS: {
    orders_per_month: { canonical: 'objectif_commandes_mois', fallback: 100 },
    target_basket_avg: { canonical: 'target_panier_moyen_kmf', fallback: 15000 },
    hub_monthly_cost_aed: { canonical: 'hub_monthly_cost_aed', fallback: 7000 },
    customs_rate_default_pct: { canonical: 'customs_rate_default_pct', fallback: 42 },
    mix_rail_a: { canonical: 'mix_rail_a', fallback: 60 },
    mix_rail_b: { canonical: 'mix_rail_b', fallback: 25 },
    mix_rail_c: { canonical: 'mix_rail_c', fallback: 10 },
    mix_rail_d: { canonical: 'mix_rail_d', fallback: 5 },
    margin_rail_a: { canonical: 'margin_rail_a', fallback: 45 },
    margin_rail_b: { canonical: 'margin_rail_b', fallback: 18 },
    margin_rail_c: { canonical: 'margin_rail_c', fallback: 35 },
    margin_rail_d: { canonical: 'margin_rail_d', fallback: 70 },
  },
  loadFinanceConfig: (...args) => mockLoadFinanceConfig(...args),
  resolveLegacyInput: (...args) => mockResolveLegacyInput(...args),
}));

jest.mock('../../utils/logger', () => ({
  child: jest.fn(() => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() })),
}));

const CURRENT = {
  objectif_commandes_mois: 100,
  target_panier_moyen_kmf: 15000,
  hub_monthly_cost_aed: 7000,
  customs_rate_default_pct: 42,
  mix_rail_a: 60, mix_rail_b: 25, mix_rail_c: 10, mix_rail_d: 5,
  margin_rail_a: 45, margin_rail_b: 18, margin_rail_c: 35, margin_rail_d: 70,
};

const MAP = {
  orders_per_month: 'objectif_commandes_mois',
  target_basket_avg: 'target_panier_moyen_kmf',
  hub_monthly_cost_aed: 'hub_monthly_cost_aed',
  customs_rate_default_pct: 'customs_rate_default_pct',
  mix_rail_a: 'mix_rail_a', mix_rail_b: 'mix_rail_b', mix_rail_c: 'mix_rail_c', mix_rail_d: 'mix_rail_d',
  margin_rail_a: 'margin_rail_a', margin_rail_b: 'margin_rail_b', margin_rail_c: 'margin_rail_c', margin_rail_d: 'margin_rail_d',
};

let ecoBridge;

beforeEach(() => {
  jest.resetModules();
  jest.clearAllMocks();
  mockLoadFinanceConfig.mockResolvedValue(CURRENT);
  mockResolveLegacyInput.mockImplementation((config, key) => {
    const column = MAP[key];
    if (!column) return undefined;
    const fallback = key === 'orders_per_month' ? 100 : undefined;
    return Number(config[column] ?? fallback);
  });
  ecoBridge = require('../../utils/eco-bridge');
});

afterEach(() => jest.useRealTimers());

function expectedMap(config = CURRENT) {
  const out = {};
  for (const [key, column] of Object.entries(MAP)) out[key] = Number(config[column]);
  return out;
}

describe('loadEcoVars — finance_config', () => {
  it('construit la map des 12 clés runtime depuis la SOV canonique', async () => {
    const result = await ecoBridge.loadEcoVars();
    expect(result).toEqual(expectedMap());
    expect(Object.keys(result)).toHaveLength(12);
    expect(mockLoadFinanceConfig).toHaveBeenCalledTimes(1);
    expect(mockDbQuery).not.toHaveBeenCalled();
  });

  it('utilise le cache dans le TTL', async () => {
    jest.useFakeTimers();
    await ecoBridge.loadEcoVars();
    jest.advanceTimersByTime(30_000);
    const second = await ecoBridge.loadEcoVars();
    expect(second.orders_per_month).toBe(100);
    expect(mockLoadFinanceConfig).toHaveBeenCalledTimes(1);
  });

  it('relit finance_config après expiration du TTL', async () => {
    jest.useFakeTimers();
    await ecoBridge.loadEcoVars();
    jest.advanceTimersByTime(61_000);
    mockLoadFinanceConfig.mockResolvedValueOnce({ ...CURRENT, objectif_commandes_mois: 120 });
    const result = await ecoBridge.loadEcoVars();
    expect(result.orders_per_month).toBe(120);
    expect(mockLoadFinanceConfig).toHaveBeenCalledTimes(2);
  });

  it('retourne {} sans cache si finance_config est indisponible', async () => {
    mockLoadFinanceConfig.mockRejectedValueOnce(new Error('db down'));
    expect(await ecoBridge.loadEcoVars()).toEqual({});
  });

  it('retombe sur le cache expiré si finance_config devient indisponible', async () => {
    jest.useFakeTimers();
    const first = await ecoBridge.loadEcoVars();
    jest.advanceTimersByTime(61_000);
    mockLoadFinanceConfig.mockRejectedValueOnce(new Error('db down'));
    expect(await ecoBridge.loadEcoVars()).toEqual(first);
  });
});

describe('getEcoVar / getEcoVars', () => {
  it('retourne une clé canonisée et ignore le fallback', async () => {
    expect(await ecoBridge.getEcoVar('hub_monthly_cost_aed', 1)).toBe(7000);
  });

  it('retourne le fallback pour une clé hors map runtime', async () => {
    expect(await ecoBridge.getEcoVar('eur_kmf', 492)).toBe(492);
  });

  it('préserve une vraie valeur zéro', async () => {
    mockLoadFinanceConfig.mockResolvedValueOnce({ ...CURRENT, objectif_commandes_mois: 0 });
    expect(await ecoBridge.getEcoVar('orders_per_month', 99)).toBe(0);
  });

  it('batch mélange valeur canonique et fallback', async () => {
    const result = await ecoBridge.getEcoVars([
      { key: 'orders_per_month', fallback: 1 },
      { key: 'inconnu', fallback: 7 },
    ]);
    expect(result).toEqual({ orders_per_month: 100, inconnu: 7 });
    expect(mockLoadFinanceConfig).toHaveBeenCalledTimes(1);
  });

  it('liste batch vide retourne {}', async () => {
    expect(await ecoBridge.getEcoVars([])).toEqual({});
  });
});

describe('invalidateEcoCache', () => {
  it('force une relecture finance_config dans le TTL', async () => {
    await ecoBridge.loadEcoVars();
    ecoBridge.invalidateEcoCache();
    mockLoadFinanceConfig.mockResolvedValueOnce({ ...CURRENT, objectif_commandes_mois: 121 });
    const result = await ecoBridge.loadEcoVars();
    expect(result.orders_per_month).toBe(121);
    expect(mockLoadFinanceConfig).toHaveBeenCalledTimes(2);
  });
});

describe('loadChargesSummary', () => {
  it('ventile per_order / monthly / weekly avec orders_per_month canonique', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [
      { amount_kmf: '100', recurrence_period: 'per_order' },
      { amount_kmf: '60000', recurrence_period: 'monthly' },
      { amount_kmf: '1000', recurrence_period: 'weekly' },
    ] });
    const result = await ecoBridge.loadChargesSummary();
    expect(result.per_order_total).toBe(100);
    expect(result.monthly_total).toBe(64330);
    expect(result.monthly_per_order).toBe(Math.round(64330 / 100));
    expect(result.total_cost_per_order).toBe(100 + Math.round(64330 / 100));
    expect(result.orders_per_month).toBe(100);
    expect(mockDbQuery).toHaveBeenCalledTimes(1);
    expect(mockLoadFinanceConfig).toHaveBeenCalledTimes(1);
  });

  it('orders_per_month = 0 évite la division par zéro', async () => {
    mockLoadFinanceConfig.mockResolvedValueOnce({ ...CURRENT, objectif_commandes_mois: 0 });
    mockDbQuery.mockResolvedValueOnce({ rows: [{ amount_kmf: '5000', recurrence_period: 'monthly' }] });
    const result = await ecoBridge.loadChargesSummary();
    expect(result.monthly_per_order).toBe(0);
  });

  it('une recurrence inconnue est ignorée', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [{ amount_kmf: '1000', recurrence_period: 'yearly' }] });
    const result = await ecoBridge.loadChargesSummary();
    expect(result.per_order_total).toBe(0);
    expect(result.monthly_total).toBe(0);
  });

  it('cache le résumé charges dans le TTL', async () => {
    jest.useFakeTimers();
    mockDbQuery.mockResolvedValueOnce({ rows: [] });
    await ecoBridge.loadChargesSummary();
    jest.advanceTimersByTime(30_000);
    await ecoBridge.loadChargesSummary();
    expect(mockDbQuery).toHaveBeenCalledTimes(1);
    expect(mockLoadFinanceConfig).toHaveBeenCalledTimes(1);
  });

  it('retourne un résultat neutre si la lecture charges échoue sans cache', async () => {
    mockDbQuery.mockRejectedValueOnce(new Error('db down'));
    expect(await ecoBridge.loadChargesSummary()).toEqual({
      charges: [], per_order_total: 0, monthly_total: 0,
      monthly_per_order: 0, total_cost_per_order: 0, orders_per_month: 100,
    });
  });

  it('retombe sur le résumé précédent si DB charges tombe après expiration', async () => {
    jest.useFakeTimers();
    mockDbQuery.mockResolvedValueOnce({ rows: [{ amount_kmf: '100', recurrence_period: 'per_order' }] });
    const first = await ecoBridge.loadChargesSummary();
    jest.advanceTimersByTime(61_000);
    mockDbQuery.mockRejectedValueOnce(new Error('db down'));
    expect(await ecoBridge.loadChargesSummary()).toEqual(first);
  });
});

describe('invalidateChargesCache', () => {
  it('relit les charges mais conserve le cache économique', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [] });
    await ecoBridge.loadChargesSummary();
    ecoBridge.invalidateChargesCache();
    mockDbQuery.mockResolvedValueOnce({ rows: [{ amount_kmf: '50', recurrence_period: 'per_order' }] });
    const result = await ecoBridge.loadChargesSummary();
    expect(result.per_order_total).toBe(50);
    expect(mockDbQuery).toHaveBeenCalledTimes(2);
    expect(mockLoadFinanceConfig).toHaveBeenCalledTimes(1);
  });
});
`);

console.log('LOT 1A-4 eco-bridge tests migrated to finance_config contract.');
