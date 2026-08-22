'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

/**
 * tests/unit/currency.test.js
 *
 * Couvre utils/currency.js avec db.query mocké. formatAmount() est pure —
 * testée sans aucun mock. Complémentaire à
 * tests/integration/currency-boundary.test.js (vrai Postgres, markets réel).
 */

const mockDbQuery = jest.fn();
jest.mock('../../db', () => ({ query: (...args) => mockDbQuery(...args) }));

const {
  getMarketCurrency,
  invalidateMarketCurrencyCache,
  currencySymbol,
  formatAmount,
  formatAmountForMarket,
} = require('../../utils/currency');

beforeEach(() => {
  mockDbQuery.mockReset();
  invalidateMarketCurrencyCache(); // cache partagé entre tests — reset systématique
});

describe('formatAmount — pure, aucun mock nécessaire', () => {
  test('minor_unit=0 (KMF) : aucune décimale', () => {
    expect(formatAmount(12500, { currency: 'KMF', minor_unit: 0 })).toBe('12\u202f500 KMF');
  });

  test('minor_unit=2 (EUR) : toujours 2 décimales, symbole €', () => {
    expect(formatAmount(42.5, { currency: 'EUR', minor_unit: 2 })).toBe('42,50 €');
  });

  test('minor_unit=2 avec un entier : complète avec des zéros', () => {
    expect(formatAmount(100, { currency: 'EUR', minor_unit: 2 })).toBe('100,00 €');
  });

  test('montant null/undefined/NaN → 0, jamais une exception', () => {
    expect(formatAmount(null, { currency: 'KMF', minor_unit: 0 })).toBe('0 KMF');
    expect(formatAmount(undefined, { currency: 'KMF', minor_unit: 0 })).toBe('0 KMF');
    expect(formatAmount(NaN, { currency: 'KMF', minor_unit: 0 })).toBe('0 KMF');
  });

  test('devise inconnue (ni EUR) : affiche le code ISO tel quel, pas de symbole inventé', () => {
    expect(formatAmount(5000, { currency: 'XAF', minor_unit: 0 })).toBe('5\u202f000 XAF');
  });
});

describe('currencySymbol', () => {
  test('EUR → €', () => { expect(currencySymbol('EUR')).toBe('€'); });
  test('KMF → KMF (code tel quel)', () => { expect(currencySymbol('KMF')).toBe('KMF'); });
  test('vide/undefined → chaîne vide, jamais undefined littéral', () => {
    expect(currencySymbol(undefined)).toBe('');
  });
});

describe('getMarketCurrency', () => {
  test('interroge markets et retourne currency/minor_unit', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [{ currency: 'KMF', minor_unit: 0 }] });
    const result = await getMarketCurrency('market-km');
    expect(result).toEqual({ currency: 'KMF', minor_unit: 0 });
    expect(mockDbQuery).toHaveBeenCalledWith(
      expect.stringMatching(/SELECT currency, minor_unit FROM markets WHERE id = \$1/),
      ['market-km']
    );
  });

  test('marché introuvable : throw explicite, jamais une valeur par défaut silencieuse', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [] });
    await expect(getMarketCurrency('market-inconnu')).rejects.toThrow(/introuvable/);
  });

  test('cache : un second appel dans le TTL ne relance pas de requête DB', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [{ currency: 'EUR', minor_unit: 2 }] });
    await getMarketCurrency('market-yt');
    await getMarketCurrency('market-yt');
    expect(mockDbQuery).toHaveBeenCalledTimes(1);
  });

  test('invalidateMarketCurrencyCache(id) force une nouvelle requête pour ce marché', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [{ currency: 'EUR', minor_unit: 2 }] });
    await getMarketCurrency('market-yt');
    invalidateMarketCurrencyCache('market-yt');
    mockDbQuery.mockResolvedValueOnce({ rows: [{ currency: 'EUR', minor_unit: 2 }] });
    await getMarketCurrency('market-yt');
    expect(mockDbQuery).toHaveBeenCalledTimes(2);
  });

  test('invalidateMarketCurrencyCache() sans argument vide tout le cache', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [{ currency: 'KMF', minor_unit: 0 }] });
    await getMarketCurrency('market-a');
    mockDbQuery.mockResolvedValueOnce({ rows: [{ currency: 'EUR', minor_unit: 2 }] });
    await getMarketCurrency('market-b');

    invalidateMarketCurrencyCache();

    mockDbQuery.mockResolvedValueOnce({ rows: [{ currency: 'KMF', minor_unit: 0 }] });
    await getMarketCurrency('market-a');
    expect(mockDbQuery).toHaveBeenCalledTimes(3);
  });
});

describe('formatAmountForMarket', () => {
  test('résout puis formate en un seul appel', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [{ currency: 'EUR', minor_unit: 2 }] });
    const result = await formatAmountForMarket(99.9, 'market-yt');
    expect(result).toBe('99,90 €');
  });
});
