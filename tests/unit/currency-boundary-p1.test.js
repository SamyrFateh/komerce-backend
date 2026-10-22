'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

/**
 * tests/unit/currency-boundary-p1.test.js
 *
 * P1 — projectAmount()/getCurrencyParity() avec db.query mocké. Complète
 * tests/unit/currency.test.js (M5) sans le dupliquer — celui-là couvre
 * formatAmount/getMarketCurrency, celui-ci couvre la projection ajoutée
 * par P1 (freeze 22-08-2026).
 */

const mockDbQuery = jest.fn();
jest.mock('../../db', () => ({ query: (...args) => mockDbQuery(...args) }));

const {
  getCurrencyParity,
  invalidateCurrencyParityCache,
  projectAmount,
  projectAndFormatForMarket,
} = require('../../utils/currency');

beforeEach(() => {
  mockDbQuery.mockReset();
  invalidateCurrencyParityCache(); // no-op (plus de cache)
});

// La conversion passe par l'autorité unique (services/fx-authority.js) : parités lues par devise, sans cache.
function mockParities(map) {
  mockDbQuery.mockImplementation(async (sql, params) => {
    if (/FROM currency_parities/.test(sql)) {
      const rate = map[params[0]];
      return { rows: rate ? [{ rate, updated_at: '2026-01-01T00:00:00.000Z' }] : [] };
    }
    if (/FROM markets/.test(sql)) return { rows: [{ currency: 'EUR', minor_unit: 2 }] };
    return { rows: [] };
  });
}

describe('getCurrencyParity (relais vers fx-authority)', () => {
  test('lit eur_rate depuis currency_parities', async () => {
    mockParities({ KMF: '491.96775' });
    expect(await getCurrencyParity('KMF')).toBe(491.96775);
    const [sql, params] = mockDbQuery.mock.calls[0];
    expect(sql).toMatch(/FROM currency_parities/);
    expect(params).toEqual(['KMF']);
  });

  test('parité fixe absente : refus explicite 503, jamais un taux par défaut', async () => {
    mockParities({});
    await expect(getCurrencyParity('XAF')).rejects.toMatchObject({ code: 'fx_rate_unavailable', statusCode: 503 });
  });

  test('devise flottante / inconnue : refus typé 422 (USD passe par convert(), pas une parité fixe)', async () => {
    mockParities({});
    await expect(getCurrencyParity('USD')).rejects.toMatchObject({ code: 'fx_currency_unsupported', statusCode: 422 });
    await expect(getCurrencyParity('GBP')).rejects.toMatchObject({ code: 'fx_currency_unsupported' });
  });

  test('EUR = 1 sans requête', async () => {
    expect(await getCurrencyParity('EUR')).toBe(1);
    expect(mockDbQuery).not.toHaveBeenCalled();
  });
});

describe('projectAmount — invariant 9 : toujours dérivé via EUR', () => {
  test('même devise source et cible : montant tel quel, 0 requête DB', async () => {
    expect(await projectAmount(1000, 'KMF', 'KMF')).toBe(1000);
    expect(mockDbQuery).not.toHaveBeenCalled();
  });

  test('KMF -> XAF : passe par EUR (deux parités), jamais un axe direct stocké', async () => {
    mockParities({ KMF: '491.96775', XAF: '655.957' });
    const result = await projectAmount(491967.75, 'KMF', 'XAF');
    expect(result).toBeCloseTo(655957, 6);
    expect(mockDbQuery).toHaveBeenCalledTimes(2);
    for (const [sql] of mockDbQuery.mock.calls) expect(sql).not.toMatch(/XAF.*KMF|KMF.*XAF/);
  });

  test('round-trip KMF -> EUR -> KMF exact (décimal, pas d’epsilon flottant)', async () => {
    mockParities({ KMF: '491.96775' });
    const eur = await projectAmount(1000, 'KMF', 'EUR');
    const back = await projectAmount(eur, 'EUR', 'KMF');
    expect(back).toBeCloseTo(1000, 9);
  });

  test('montant invalide (NaN/null/undefined) : refus fx_amount_invalid, plus de 0 silencieux', async () => {
    for (const bad of [null, undefined, NaN]) {
      await expect(projectAmount(bad, 'KMF', 'KMF')).rejects.toMatchObject({ code: 'fx_amount_invalid', statusCode: 422 });
    }
  });
});

describe('projectAndFormatForMarket', () => {
  test('résout le marché, projette, puis formate — un seul appel pour le consommateur', async () => {
    mockParities({ KMF: '491.96775' });
    expect(await projectAndFormatForMarket(49196.775, 'KMF', 'market-yt')).toBe('100,00 €');
  });
});
