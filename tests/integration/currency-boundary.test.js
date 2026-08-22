'use strict';

/**
 * @test-kind integration
 * @test-runner jest
 * @test-requires postgres
 */

/**
 * tests/integration/currency-boundary.test.js
 *
 * M5 — vérifie utils/currency.js contre une vraie table markets (pas de
 * mock). Complémentaire à tests/unit/currency.test.js.
 *
 * Sans DATABASE_URL → suite skippée proprement.
 * Run: DATABASE_URL=... npx jest tests/integration/currency-boundary.test.js
 */

const dbUrl = process.env.DATABASE_URL || '';
const hasIntegrationEnv = dbUrl.startsWith('postgresql://') && dbUrl.length > 20;

if (!hasIntegrationEnv) {
  describe.skip('currency-boundary (needs DATABASE_URL)', () => {
    test('skipped — DATABASE_URL not configured', () => {});
  });
} else {
  let db;
  let getMarketCurrency, invalidateMarketCurrencyCache, formatAmountForMarket;

  let marketKmfId, marketEurId;

  beforeAll(async () => {
    db = require('../../db');
    ({ getMarketCurrency, invalidateMarketCurrencyCache, formatAmountForMarket } =
      require('../../utils/currency'));

    const km = await db.query(
      `INSERT INTO markets (code, name, currency, minor_unit)
       VALUES ('T3', 'Marché Test KMF', 'KMF', 0)
       ON CONFLICT (code) DO UPDATE SET currency = EXCLUDED.currency
       RETURNING id`
    );
    marketKmfId = km.rows[0].id;

    const eur = await db.query(
      `INSERT INTO markets (code, name, currency, minor_unit)
       VALUES ('T4', 'Marché Test EUR', 'EUR', 2)
       ON CONFLICT (code) DO UPDATE SET currency = EXCLUDED.currency
       RETURNING id`
    );
    marketEurId = eur.rows[0].id;
  });

  afterAll(async () => {
    await db.query(`DELETE FROM markets WHERE code IN ('T3', 'T4')`);
  });

  test('lit currency/minor_unit réels depuis markets (KMF)', async () => {
    const result = await getMarketCurrency(marketKmfId);
    expect(result).toEqual({ currency: 'KMF', minor_unit: 0 });
  });

  test('lit currency/minor_unit réels depuis markets (EUR)', async () => {
    const result = await getMarketCurrency(marketEurId);
    expect(result).toEqual({ currency: 'EUR', minor_unit: 2 });
  });

  test('formatAmountForMarket résout et formate en un aller-retour DB réel', async () => {
    const kmfResult = await formatAmountForMarket(12500, marketKmfId);
    expect(kmfResult).toBe('12\u202f500 KMF');

    const eurResult = await formatAmountForMarket(42.5, marketEurId);
    expect(eurResult).toBe('42,50 €');
  });

  test('le marché seedé par M0 (KM) résout bien vers KMF/0', async () => {
    const { rows } = await db.query(`SELECT id FROM markets WHERE code = 'KM'`);
    expect(rows).toHaveLength(1); // confirme que M0 a bien tourné sur cette base
    const result = await getMarketCurrency(rows[0].id);
    expect(result).toEqual({ currency: 'KMF', minor_unit: 0 });
  });

  test('marché supprimé après mise en cache : le cache sert une valeur périmée ' +
       'jusqu\'à invalidation explicite — comportement documenté, pas un bug',
    async () => {
      const tmp = await db.query(
        `INSERT INTO markets (code, name, currency, minor_unit)
         VALUES ('T5', 'Marché Temporaire', 'XAF', 0) RETURNING id`
      );
      const tmpId = tmp.rows[0].id;

      await getMarketCurrency(tmpId); // peuple le cache
      await db.query(`DELETE FROM markets WHERE id = $1`, [tmpId]);

      // Le cache sert encore l'ancienne valeur — c'est le TTL de 5 min qui
      // fait foi, pas une vérification d'existence à chaque appel.
      const cached = await getMarketCurrency(tmpId);
      expect(cached).toEqual({ currency: 'XAF', minor_unit: 0 });

      invalidateMarketCurrencyCache(tmpId);
      await expect(getMarketCurrency(tmpId)).rejects.toThrow(/introuvable/);
    });
}
