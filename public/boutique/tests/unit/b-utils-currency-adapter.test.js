/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

'use strict';

/**
 * tests/unit/b-utils-currency-adapter.test.js (P2)
 *
 * Couvre fmt()/fmtPrice() après leur transformation en adapter de la
 * Currency Boundary (freeze 22-08-2026). jest.resetModules() + re-require
 * dans chaque bloc qui a besoin d'un état de module frais — _parities et
 * _parityFetchStarted sont des singletons module-level, comme
 * _kickOffParityFetch() qui se déclenche à l'import.
 */

jest.mock('../../js/b-store.js', () => ({ dom: {} }));

const MOCK_PARITIES = {
  currency_parities: [
    { currency: 'EUR', eur_rate: 1 },
    { currency: 'KMF', eur_rate: 491.96775 },
    { currency: 'XAF', eur_rate: 655.957 },
  ],
};

function flushPromises() {
  // setImmediate n'existe pas dans jsdom — plusieurs tours de microtâches
  // suffisent à laisser la chaîne .then() de _kickOffParityFetch() se résoudre.
  return Promise.resolve().then(() => Promise.resolve()).then(() => Promise.resolve());
}

function mockMarket(code, currency, minor_unit) {
  window.KomerceMarket = {
    DEFAULT: 'KM',
    getPreviewOverride: () => (code !== 'KM' ? code : null),
    getByCode: (c) => (c === code ? { code, currency, minor_unit } : null),
  };
}

afterEach(() => {
  delete window.KomerceMarket;
  jest.resetModules();
  jest.restoreAllMocks();
});

describe('fmt() — devise explicite \u2260 KMF : comportement littéral inchangé', () => {
  test('force EUR quel que soit le marché résolu, ignore les parités', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => MOCK_PARITIES });
    mockMarket('CM', 'XAF', 0);
    const { fmt } = require('../../js/b-utils.js');
    await flushPromises();

    expect(fmt(49500, 'EUR')).toBe('100 €'); // 49500/495 = 100, ancien _rates, inchangé
  });
});

describe('fmt(x, \'KMF\') / fmt(x) / fmtPrice(x) — projettent vers le marché courant', () => {
  test('marché KM (KMF) : aucune projection nécessaire, affichage KMF direct', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => MOCK_PARITIES });
    mockMarket('KM', 'KMF', 0);
    const { fmt, fmtPrice } = require('../../js/b-utils.js');
    await flushPromises();

    expect(fmt(15000, 'KMF')).toBe('15\u202f000 KMF');
    expect(fmt(15000)).toBe('15\u202f000 KMF');
    expect(fmtPrice(15000)).toBe('15\u202f000 KMF');
  });

  test('marché YT (EUR, minor_unit=2) : projection réelle via EUR', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => MOCK_PARITIES });
    mockMarket('YT', 'EUR', 2);
    const { fmt, fmtPrice } = require('../../js/b-utils.js');
    await flushPromises();

    // 15000 / 491.96775 = 30,4899... -> 30,49 €
    expect(fmt(15000, 'KMF')).toBe('30,49 €');
    expect(fmtPrice(15000)).toBe('30,49 €');
  });

  test('marché CM (XAF, minor_unit=0) : projection dérivée via EUR, jamais un axe direct', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => MOCK_PARITIES });
    mockMarket('CM', 'XAF', 0);
    const { fmt } = require('../../js/b-utils.js');
    await flushPromises();

    // 15000/491.96775 * 655.957 \u2248 20003.9 -> arrondi 20 000 (minor_unit=0)
    expect(fmt(15000, 'KMF')).toBe('20\u202f000 XAF');
  });

  test('appel unique fetch — jamais un round-trip réseau par appel fmt()', async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, json: async () => MOCK_PARITIES });
    global.fetch = fetchMock;
    mockMarket('CM', 'XAF', 0);
    const { fmt } = require('../../js/b-utils.js');
    await flushPromises();

    fmt(1000, 'KMF'); fmt(2000, 'KMF'); fmt(3000, 'KMF');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('repli avant résolution des parités — jamais un montant faux', () => {
  test('fetch pas encore résolu : affichage KMF brut, pas une projection erronée', () => {
    // fetch qui ne résout JAMAIS dans ce test (pas de flushPromises) —
    // simule la fenêtre entre le chargement du module et la réponse réseau.
    global.fetch = jest.fn(() => new Promise(() => {}));
    mockMarket('CM', 'XAF', 0);
    const { fmt } = require('../../js/b-utils.js');

    expect(fmt(15000, 'KMF')).toBe('15\u202f000 KMF');
  });

  test('fetch échoue (réseau/serveur) : repli KMF, jamais une exception', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('network down'));
    mockMarket('CM', 'XAF', 0);
    const { fmt } = require('../../js/b-utils.js');
    await flushPromises();

    expect(() => fmt(15000, 'KMF')).not.toThrow();
    expect(fmt(15000, 'KMF')).toBe('15\u202f000 KMF');
  });
});

describe('window.KomerceMarket absent — jamais un crash', () => {
  test('résout un repli KM/KMF par défaut', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => MOCK_PARITIES });
    const { fmt } = require('../../js/b-utils.js');
    await flushPromises();

    expect(() => fmt(15000, 'KMF')).not.toThrow();
    expect(fmt(15000, 'KMF')).toBe('15\u202f000 KMF');
  });
});
