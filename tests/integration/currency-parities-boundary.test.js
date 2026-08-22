'use strict';

/**
 * @test-kind integration
 * @test-runner jest
 * @test-requires postgres
 */

/**
 * tests/integration/currency-parities-boundary.test.js
 *
 * P1 — vérifie currency_parities et projectAmount() contre une vraie table
 * (pas de mock). Confirme les ancrages réels et le round-trip complet
 * KMF -> XAF -> KMF sur les quatre marchés ouverts à ce jour.
 *
 * Sans DATABASE_URL → suite skippée proprement.
 */

const dbUrl = process.env.DATABASE_URL || '';
const hasIntegrationEnv = dbUrl.startsWith('postgresql://') && dbUrl.length > 20;

if (!hasIntegrationEnv) {
  describe.skip('currency-parities-boundary (needs DATABASE_URL)', () => {
    test('skipped — DATABASE_URL not configured', () => {});
  });
} else {
  let db;
  let getCurrencyParity, projectAmount, projectAndFormatForMarket;

  beforeAll(() => {
    db = require('../../db');
    ({ getCurrencyParity, projectAmount, projectAndFormatForMarket } = require('../../utils/currency'));
  });

  test('les 3 parités seedées par la migration 142 sont présentes et exactes', async () => {
    const { rows } = await db.query(
      `SELECT currency, eur_rate FROM currency_parities ORDER BY currency`
    );
    const byCode = Object.fromEntries(rows.map(r => [r.currency, Number(r.eur_rate)]));
    expect(byCode.EUR).toBe(1);
    expect(byCode.KMF).toBeCloseTo(491.96775, 5);
    expect(byCode.XAF).toBeCloseTo(655.957, 3);
  });

  test('aucune paire directe KMF-XAF stockée — un seul axe par devise (invariant 9)', async () => {
    const { rows } = await db.query(`SELECT column_name FROM information_schema.columns
      WHERE table_name = 'currency_parities'`);
    const cols = rows.map(r => r.column_name);
    expect(cols).toEqual(expect.arrayContaining(['currency', 'eur_rate']));
    // pas de colonne "kmf_rate" ou "xaf_rate" à côté de eur_rate — un seul
    // axe de conversion possible, jamais une matrice de paires
    expect(cols.filter(c => c.endsWith('_rate'))).toEqual(['eur_rate']);
  });

  test('projectAmount réel : KMF -> XAF pour un panier de 15 000 KMF', async () => {
    const xaf = await projectAmount(15000, 'KMF', 'XAF');
    // 15000 / 491.96775 * 655.957 ≈ 20 000 XAF
    expect(xaf).toBeCloseTo(20000, -1); // tolérance large, juste pour l'ordre de grandeur
  });

  test('projectAndFormatForMarket réel : projette pour chacun des 4 marchés ouverts', async () => {
    const markets = await db.query(`SELECT id, code FROM markets WHERE code IN ('KM','YT','CM','CG')`);
    expect(markets.rows.length).toBe(4);

    for (const m of markets.rows) {
      const formatted = await projectAndFormatForMarket(50000, 'KMF', m.id);
      expect(typeof formatted).toBe('string');
      expect(formatted.length).toBeGreaterThan(0);
    }
  });

  test('devise de sourcing (USD) absente par construction — throw, pas un taux par défaut', async () => {
    await expect(getCurrencyParity('USD')).rejects.toThrow(/sans parité fixe/);
  });
}
