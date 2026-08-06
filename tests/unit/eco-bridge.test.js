'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * tests/unit/eco-bridge.test.js
 * Couvre utils/eco-bridge.js
 *
 * Cache mémoire (module-level, TTL 60s) → jest.resetModules() + re-require
 * avant chaque test pour repartir d'un cache vide, comme dashboard-shared.
 */

const mockDbQuery = jest.fn();
jest.mock('../../db', () => ({ query: (...args) => mockDbQuery(...args) }));

jest.mock('../../utils/logger', () => ({
  child: jest.fn(() => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() })),
}));

let ecoBridge;

beforeEach(() => {
  jest.resetModules();
  jest.clearAllMocks();
  ecoBridge = require('../../utils/eco-bridge');
});

afterEach(() => {
  jest.useRealTimers();
});

describe('loadEcoVars', () => {
  it('nominal → construit une map key→value', async () => {
    mockDbQuery.mockResolvedValueOnce({
      rows: [
        { key: 'eur_kmf', value_used: '500', value_supposed: '490' },
        { key: 'aed_kmf', value_used: null, value_supposed: '130' },
      ],
    });
    const result = await ecoBridge.loadEcoVars();
    expect(result).toEqual({ eur_kmf: 500, aed_kmf: 130 });
  });

  it('value_used prioritaire sur value_supposed', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [{ key: 'k1', value_used: '10', value_supposed: '999' }] });
    const result = await ecoBridge.loadEcoVars();
    expect(result.k1).toBe(10);
  });

  it('value_used ET value_supposed null → valeur null', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [{ key: 'k1', value_used: null, value_supposed: null }] });
    const result = await ecoBridge.loadEcoVars();
    expect(result.k1).toBeNull();
  });

  it('filtre is_active = TRUE dans la requête', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [] });
    await ecoBridge.loadEcoVars();
    expect(mockDbQuery).toHaveBeenCalledWith(expect.stringContaining('WHERE is_active = TRUE'));
  });

  it('aucune ligne → map vide', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [] });
    expect(await ecoBridge.loadEcoVars()).toEqual({});
  });

  it('appel suivant dans le TTL (60s) → utilise le cache, pas de nouvelle requête', async () => {
    jest.useFakeTimers();
    mockDbQuery.mockResolvedValueOnce({ rows: [{ key: 'k1', value_used: '1', value_supposed: null }] });
    await ecoBridge.loadEcoVars();
    jest.advanceTimersByTime(30_000);
    const result = await ecoBridge.loadEcoVars();
    expect(result).toEqual({ k1: 1 });
    expect(mockDbQuery).toHaveBeenCalledTimes(1);
  });

  it('appel après expiration du TTL → relit la DB', async () => {
    jest.useFakeTimers();
    mockDbQuery.mockResolvedValueOnce({ rows: [{ key: 'k1', value_used: '1', value_supposed: null }] });
    await ecoBridge.loadEcoVars();
    jest.advanceTimersByTime(61_000);
    mockDbQuery.mockResolvedValueOnce({ rows: [{ key: 'k1', value_used: '2', value_supposed: null }] });
    const result = await ecoBridge.loadEcoVars();
    expect(result).toEqual({ k1: 2 });
    expect(mockDbQuery).toHaveBeenCalledTimes(2);
  });

  it('erreur DB sans cache préexistant → retourne {} sans throw', async () => {
    mockDbQuery.mockRejectedValueOnce(new Error('db down'));
    const result = await ecoBridge.loadEcoVars();
    expect(result).toEqual({});
  });

  it('erreur DB avec cache préexistant (expiré) → retombe sur l\'ancien cache', async () => {
    jest.useFakeTimers();
    mockDbQuery.mockResolvedValueOnce({ rows: [{ key: 'k1', value_used: '1', value_supposed: null }] });
    await ecoBridge.loadEcoVars();
    jest.advanceTimersByTime(61_000);
    mockDbQuery.mockRejectedValueOnce(new Error('db down'));
    const result = await ecoBridge.loadEcoVars();
    expect(result).toEqual({ k1: 1 });
  });
});

describe('getEcoVar', () => {
  it('clé existante → retourne sa valeur (ignore le fallback)', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [{ key: 'eur_kmf', value_used: '500', value_supposed: null }] });
    expect(await ecoBridge.getEcoVar('eur_kmf', 0)).toBe(500);
  });

  it('clé absente → retourne le fallback', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [] });
    expect(await ecoBridge.getEcoVar('inconnu', 42)).toBe(42);
  });

  it('clé présente mais valeur null → retourne le fallback', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [{ key: 'k1', value_used: null, value_supposed: null }] });
    expect(await ecoBridge.getEcoVar('k1', 7)).toBe(7);
  });

  it('valeur 0 (falsy) → retourne 0, pas le fallback', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [{ key: 'k1', value_used: '0', value_supposed: null }] });
    expect(await ecoBridge.getEcoVar('k1', 99)).toBe(0);
  });
});

describe('getEcoVars (batch)', () => {
  it('résout chaque spec indépendamment (trouvé/fallback)', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [{ key: 'eur_kmf', value_used: '500', value_supposed: null }] });
    const result = await ecoBridge.getEcoVars([
      { key: 'eur_kmf', fallback: 0 },
      { key: 'aed_kmf', fallback: 130 },
    ]);
    expect(result).toEqual({ eur_kmf: 500, aed_kmf: 130 });
  });

  it('liste vide → objet vide', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [] });
    expect(await ecoBridge.getEcoVars([])).toEqual({});
  });

  it('un seul appel DB pour plusieurs specs (loadEcoVars mutualisé)', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [] });
    await ecoBridge.getEcoVars([{ key: 'a', fallback: 1 }, { key: 'b', fallback: 2 }, { key: 'c', fallback: 3 }]);
    expect(mockDbQuery).toHaveBeenCalledTimes(1);
  });
});

describe('invalidateEcoCache', () => {
  it('force une relecture DB même dans le TTL', async () => {
    jest.useFakeTimers();
    mockDbQuery.mockResolvedValueOnce({ rows: [{ key: 'k1', value_used: '1', value_supposed: null }] });
    await ecoBridge.loadEcoVars();
    ecoBridge.invalidateEcoCache();
    mockDbQuery.mockResolvedValueOnce({ rows: [{ key: 'k1', value_used: '2', value_supposed: null }] });
    const result = await ecoBridge.loadEcoVars();
    expect(result).toEqual({ k1: 2 });
    expect(mockDbQuery).toHaveBeenCalledTimes(2);
  });
});

describe('loadChargesSummary', () => {
  it('nominal → ventile per_order / monthly / weekly et calcule le coût par commande', async () => {
    mockDbQuery
      .mockResolvedValueOnce({
        rows: [
          { amount_kmf: '100', recurrence_period: 'per_order' },
          { amount_kmf: '60000', recurrence_period: 'monthly' },
          { amount_kmf: '1000', recurrence_period: 'weekly' },
        ],
      })
      .mockResolvedValueOnce({ rows: [{ key: 'orders_per_month', value_used: '100', value_supposed: null }] });

    const result = await ecoBridge.loadChargesSummary();
    // weeklyTotal*4.33 = 4330 -> round -> 4330 ; totalMonthlyFixed = 60000+4330=64330
    expect(result.per_order_total).toBe(100);
    expect(result.monthly_total).toBe(64330);
    expect(result.monthly_per_order).toBe(Math.round(64330 / 100));
    expect(result.total_cost_per_order).toBe(100 + Math.round(64330 / 100));
    expect(result.orders_per_month).toBe(100);
    expect(result.charges).toHaveLength(3);
  });

  it('filtre is_active = TRUE', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [] });
    await ecoBridge.loadChargesSummary();
    expect(mockDbQuery).toHaveBeenCalledWith('SELECT * FROM charges WHERE is_active = TRUE');
  });

  it('orders_per_month absent en DB → fallback 100', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [] });
    const result = await ecoBridge.loadChargesSummary();
    expect(result.orders_per_month).toBe(100);
    expect(result.monthly_per_order).toBe(0);
  });

  it('orders_per_month = 0 → monthly_per_order = 0 (pas de division par zéro)', async () => {
    mockDbQuery
      .mockResolvedValueOnce({ rows: [{ amount_kmf: '5000', recurrence_period: 'monthly' }] })
      .mockResolvedValueOnce({ rows: [{ key: 'orders_per_month', value_used: '0', value_supposed: null }] });
    const result = await ecoBridge.loadChargesSummary();
    expect(result.monthly_per_order).toBe(0);
  });

  it('recurrence_period inconnue → ignorée (pas ajoutée à un total)', async () => {
    mockDbQuery
      .mockResolvedValueOnce({ rows: [{ amount_kmf: '1000', recurrence_period: 'yearly' }] })
      .mockResolvedValueOnce({ rows: [] });
    const result = await ecoBridge.loadChargesSummary();
    expect(result.per_order_total).toBe(0);
    expect(result.monthly_total).toBe(0);
  });

  it('appel suivant dans le TTL → cache, pas de nouvelle requête', async () => {
    jest.useFakeTimers();
    mockDbQuery.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [] });
    await ecoBridge.loadChargesSummary();
    jest.advanceTimersByTime(30_000);
    await ecoBridge.loadChargesSummary();
    expect(mockDbQuery).toHaveBeenCalledTimes(2); // charges + orders_per_month, une seule fois au total
  });

  it('erreur DB sans cache préexistant → retourne le résultat neutre par défaut', async () => {
    mockDbQuery.mockRejectedValueOnce(new Error('db down'));
    const result = await ecoBridge.loadChargesSummary();
    expect(result).toEqual({
      charges: [], per_order_total: 0, monthly_total: 0,
      monthly_per_order: 0, total_cost_per_order: 0, orders_per_month: 100,
    });
  });

  it('erreur DB avec cache préexistant (expiré) → retombe sur l\'ancien résultat', async () => {
    jest.useFakeTimers();
    mockDbQuery
      .mockResolvedValueOnce({ rows: [{ amount_kmf: '100', recurrence_period: 'per_order' }] })
      .mockResolvedValueOnce({ rows: [] });
    const first = await ecoBridge.loadChargesSummary();
    jest.advanceTimersByTime(61_000);
    mockDbQuery.mockRejectedValueOnce(new Error('db down'));
    const second = await ecoBridge.loadChargesSummary();
    expect(second).toEqual(first);
  });
});

describe('invalidateChargesCache', () => {
  it('force une relecture DB même dans le TTL', async () => {
    jest.useFakeTimers();
    mockDbQuery.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [] });
    await ecoBridge.loadChargesSummary();
    ecoBridge.invalidateChargesCache();
    mockDbQuery.mockResolvedValueOnce({ rows: [{ amount_kmf: '50', recurrence_period: 'per_order' }] }).mockResolvedValueOnce({ rows: [] });
    const result = await ecoBridge.loadChargesSummary();
    expect(result.per_order_total).toBe(50);
    // 1er appel: charges + orders_per_month (2 requêtes) ; 2e appel après invalidation
    // des charges seules: charges relu, mais orders_per_month reste en cache (TTL eco
    // intact) → 1 requête de plus, soit 3 au total.
    expect(mockDbQuery).toHaveBeenCalledTimes(3);
  });
});
