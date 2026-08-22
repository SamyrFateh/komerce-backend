'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

/**
 * tests/unit/order-display-snapshot.test.js
 *
 * P3 — resolveDisplaySnapshot() avec db.query mocké. Vérifie les 7
 * invariants du freeze (22-08-2026) directement, pas seulement le calcul.
 */

const mockDbQuery = jest.fn();
jest.mock('../../db', () => ({ query: (...args) => mockDbQuery(...args) }));

const { resolveDisplaySnapshot } = require('../../services/order-display-snapshot');
const { invalidateMarketCurrencyCache, invalidateCurrencyParityCache } = require('../../utils/currency');

beforeEach(() => {
  mockDbQuery.mockReset();
  // utils/currency.js a un cache module-level (getMarketCurrencyByCode,
  // getCurrencyParity) qui persiste entre tests dans le même fichier —
  // sans ce reset, un test peut lire le cache peuplé par le précédent
  // plutôt que d'appeler réellement mockDbQuery (même piège déjà rencontré
  // dans tests/unit/currency.test.js, M5).
  invalidateMarketCurrencyCache();
  invalidateCurrencyParityCache();
});

describe('invariant 3 : le serveur calcule lui-même, jamais un montant client', () => {
  test('displayMarketCode est un CODE, jamais un montant — un code valide déclenche un vrai calcul serveur', async () => {
    mockDbQuery
      .mockResolvedValueOnce({ rows: [{ id: 'cm-id', currency: 'XAF', minor_unit: 0 }] }) // getMarketCurrencyByCode
      .mockResolvedValueOnce({ rows: [{ eur_rate: '491.96775' }] }) // KMF
      .mockResolvedValueOnce({ rows: [{ eur_rate: '655.957' }] });  // XAF

    const result = await resolveDisplaySnapshot({ totalKmf: 15000, displayMarketCode: 'CM' });
    expect(result.amount).toBe(20000);
    expect(result.currency).toBe('XAF');
    // le montant vient d'un calcul (projectAmount), jamais d'une valeur passée par l'appelant
    expect(typeof result.amount).toBe('number');
  });
});

describe('invariant 4 : ne suppose jamais que relaisMarketId == marché de navigation', () => {
  test('un code client valide fait TOUJOURS foi avant le relais, même si les deux diffèrent', async () => {
    mockDbQuery
      .mockResolvedValueOnce({ rows: [{ id: 'cm-id', currency: 'XAF', minor_unit: 0 }] }) // getMarketCurrencyByCode('CM')
      .mockResolvedValueOnce({ rows: [{ eur_rate: '491.96775' }] })
      .mockResolvedValueOnce({ rows: [{ eur_rate: '655.957' }] });

    // relaisMarketId pointe vers un autre marché (KM) — ne doit JAMAIS être
    // consulté puisqu'un code client valide est fourni.
    const result = await resolveDisplaySnapshot({
      totalKmf: 15000, displayMarketCode: 'CM', relaisMarketId: 'km-market-id',
    });
    expect(result.currency).toBe('XAF');
    expect(result.meta.source).toBe('display_market_code');
    // getMarketCurrency (repli relais) n'a jamais été appelé — seulement
    // getMarketCurrencyByCode + les 2 lookups de parité, 3 requêtes au total.
    expect(mockDbQuery).toHaveBeenCalledTimes(3);
  });

  test('relais utilisé seulement si aucun code client valide fourni', async () => {
    mockDbQuery
      .mockResolvedValueOnce({ rows: [{ currency: 'EUR', minor_unit: 2 }] }) // getMarketCurrency(relaisMarketId)
      .mockResolvedValueOnce({ rows: [{ eur_rate: '491.96775' }] })
      .mockResolvedValueOnce({ rows: [{ eur_rate: '1' }] });

    const result = await resolveDisplaySnapshot({
      totalKmf: 15000, displayMarketCode: null, relaisMarketId: 'yt-market-id',
    });
    expect(result.currency).toBe('EUR');
    expect(result.meta.source).toBe('relais_fallback');
  });
});

describe('invariant 5 : la métadonnée de parité n\'est jamais une source de vérité', () => {
  test('meta contient la trace de calcul, amount reste le seul champ contractuel', async () => {
    mockDbQuery
      .mockResolvedValueOnce({ rows: [{ id: 'km-id', currency: 'KMF', minor_unit: 0 }] });

    const result = await resolveDisplaySnapshot({ totalKmf: 15000, displayMarketCode: 'KM' });
    expect(result.amount).toBe(15000); // KMF->KMF, pas de requête de parité (court-circuit projectAmount)
    expect(result.meta.base_amount).toBe(15000);
    expect(result.meta.base_currency).toBe('KMF');
    expect(result.meta.computed_at).toBeDefined();
  });
});

describe('invariant 6 : aucun recalcul — la fonction est pure par appel, jamais de cache implicite trompeur', () => {
  test('deux appels avec des totalKmf différents donnent des snapshots différents', async () => {
    mockDbQuery
      .mockResolvedValueOnce({ rows: [{ id: 'km-id', currency: 'KMF', minor_unit: 0 }] });
    const r1 = await resolveDisplaySnapshot({ totalKmf: 10000, displayMarketCode: 'KM' });

    mockDbQuery
      .mockResolvedValueOnce({ rows: [{ id: 'km-id', currency: 'KMF', minor_unit: 0 }] });
    const r2 = await resolveDisplaySnapshot({ totalKmf: 20000, displayMarketCode: 'KM' });

    expect(r1.amount).toBe(10000);
    expect(r2.amount).toBe(20000);
  });
});

describe('invariant 7 (esprit) : jamais une valeur inventée si rien n\'est résolvable', () => {
  test('ni code ni relais : snapshot vide honnête, jamais une devise par défaut', async () => {
    const result = await resolveDisplaySnapshot({ totalKmf: 15000 });
    expect(result).toEqual({ amount: null, currency: null, meta: null });
    expect(mockDbQuery).not.toHaveBeenCalled();
  });

  test('code invalide sans relais de repli : snapshot vide, jamais une exception propagée', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [] }); // getMarketCurrencyByCode('XX') -> throw interne
    const result = await resolveDisplaySnapshot({ totalKmf: 15000, displayMarketCode: 'XX' });
    expect(result).toEqual({ amount: null, currency: null, meta: null });
  });
});

describe('ne bloque jamais la commande — jamais de throw propagé', () => {
  test('erreur DB inattendue pendant la résolution : snapshot vide, pas d\'exception', async () => {
    mockDbQuery.mockRejectedValueOnce(new Error('connection lost'));
    await expect(
      resolveDisplaySnapshot({ totalKmf: 15000, displayMarketCode: 'CM' })
    ).resolves.toEqual({ amount: null, currency: null, meta: null });
  });
});
