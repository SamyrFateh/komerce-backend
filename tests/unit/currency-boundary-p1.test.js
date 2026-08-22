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
  invalidateCurrencyParityCache();
});

describe('getCurrencyParity', () => {
  test('lit eur_rate depuis currency_parities', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [{ eur_rate: '491.96775' }] });
    const rate = await getCurrencyParity('KMF');
    expect(rate).toBe(491.96775);
    const [sql, params] = mockDbQuery.mock.calls[0];
    expect(sql).toMatch(/FROM currency_parities WHERE currency = \$1/);
    expect(params).toEqual(['KMF']);
  });

  test('devise absente : throw explicite, jamais un taux par défaut', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [] });
    await expect(getCurrencyParity('USD')).rejects.toThrow(/sans parité fixe/);
  });

  test('cache : un second appel dans le TTL ne relance pas de requête', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [{ eur_rate: '655.957' }] });
    await getCurrencyParity('XAF');
    await getCurrencyParity('XAF');
    expect(mockDbQuery).toHaveBeenCalledTimes(1);
  });
});

describe('projectAmount — invariant 9 : toujours dérivé via EUR', () => {
  test('même devise source et cible : retourne le montant tel quel, 0 requête DB', async () => {
    const result = await projectAmount(1000, 'KMF', 'KMF');
    expect(result).toBe(1000);
    expect(mockDbQuery).not.toHaveBeenCalled();
  });

  test('KMF -> XAF : passe par EUR, jamais un axe direct stocké', async () => {
    mockDbQuery
      .mockResolvedValueOnce({ rows: [{ eur_rate: '491.96775' }] }) // KMF
      .mockResolvedValueOnce({ rows: [{ eur_rate: '655.957' }] });  // XAF

    const result = await projectAmount(1000, 'KMF', 'XAF');
    // 1000 KMF -> (1000/491.96775) EUR -> * 655.957 XAF
    const expected = (1000 / 491.96775) * 655.957;
    expect(result).toBeCloseTo(expected, 8);

    // les deux SEULES requêtes émises portent sur les parités individuelles,
    // jamais sur une paire KMF-XAF
    expect(mockDbQuery).toHaveBeenCalledTimes(2);
    for (const [sql] of mockDbQuery.mock.calls) {
      expect(sql).toMatch(/currency_parities WHERE currency = \$1/);
      expect(sql).not.toMatch(/KMF.*XAF|XAF.*KMF/);
    }
  });

  test('round-trip KMF -> EUR -> KMF revient au montant de départ (à l\'epsilon flottant près)', async () => {
    mockDbQuery
      .mockResolvedValueOnce({ rows: [{ eur_rate: '491.96775' }] })
      .mockResolvedValueOnce({ rows: [{ eur_rate: '1' }] })
      .mockResolvedValueOnce({ rows: [{ eur_rate: '1' }] })
      .mockResolvedValueOnce({ rows: [{ eur_rate: '491.96775' }] });

    const eur = await projectAmount(1000, 'KMF', 'EUR');
    const back = await projectAmount(eur, 'EUR', 'KMF');
    expect(back).toBeCloseTo(1000, 6);
  });

  test('montant invalide (NaN/null/undefined) -> 0, jamais une exception', async () => {
    const r1 = await projectAmount(null, 'KMF', 'KMF');
    const r2 = await projectAmount(undefined, 'KMF', 'KMF');
    const r3 = await projectAmount(NaN, 'KMF', 'KMF');
    expect(r1).toBe(0);
    expect(r2).toBe(0);
    expect(r3).toBe(0);
  });
});

describe('projectAndFormatForMarket', () => {
  test('résout le marché, projette, puis formate — un seul appel pour le consommateur', async () => {
    mockDbQuery
      .mockResolvedValueOnce({ rows: [{ currency: 'EUR', minor_unit: 2 }] }) // getMarketCurrency
      .mockResolvedValueOnce({ rows: [{ eur_rate: '491.96775' }] })          // KMF
      .mockResolvedValueOnce({ rows: [{ eur_rate: '1' }] });                  // EUR

    const result = await projectAndFormatForMarket(49196.775, 'KMF', 'market-yt');
    expect(result).toBe('100,00 €');
  });
});
