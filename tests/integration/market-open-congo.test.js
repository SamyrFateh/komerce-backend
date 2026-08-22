'use strict';

/**
 * @test-kind integration
 * @test-runner jest
 * @test-requires postgres
 */

/**
 * tests/integration/market-open-congo.test.js
 *
 * Ouverture du marché Congo (CG, XAF, minor_unit=0) — même doctrine et
 * même structure de preuve que tests/integration/market-open-mayotte.test.js
 * (M10) : ouvrir un marché est un INSERT, la chaîne M0/M1/M1b/M2/M5 le
 * supporte sans modification.
 *
 * Sans DATABASE_URL → suite skippée proprement.
 */

const dbUrl = process.env.DATABASE_URL || '';
const hasIntegrationEnv = dbUrl.startsWith('postgresql://') && dbUrl.length > 20;

if (!hasIntegrationEnv) {
  describe.skip('market-open-congo (needs DATABASE_URL)', () => {
    test('skipped — DATABASE_URL not configured', () => {});
  });
} else {
  let db;
  let getMarketCurrency, formatAmountForMarket;
  let resolveAuthorizedMarkets;
  let congoId, comoresId;

  const PFX = 'itest-cg+';
  const CI_PLACEHOLDER_HASH = '$2a$04$AYmAyvzy6sAbPHhY01nPau5qvXBxnD/DFrgbpUzd5QXDR3VgjkISm';

  beforeAll(async () => {
    db = require('../../db');
    ({ getMarketCurrency, formatAmountForMarket } = require('../../utils/currency'));
    ({ resolveAuthorizedMarkets } = require('../../middleware/require-market-scope'));

    const cg = await db.query(`SELECT id FROM markets WHERE code = 'CG'`);
    const km = await db.query(`SELECT id FROM markets WHERE code = 'KM'`);
    congoId = cg.rows[0]?.id;
    comoresId = km.rows[0]?.id;
  });

  afterAll(async () => {
    await db.query(`DELETE FROM operator_market_scopes WHERE user_id IN
      (SELECT id FROM users WHERE email LIKE $1)`, [`${PFX}%`]);
    await db.query(`DELETE FROM users WHERE email LIKE $1`, [`${PFX}%`]);
  });

  test('la migration 141 a bien créé le marché Congo', () => {
    expect(congoId).toBeDefined();
  });

  test('XAF/minor_unit=0, pas hérité ni recopié de KM', async () => {
    const { rows } = await db.query(
      `SELECT currency, minor_unit, is_active FROM markets WHERE id = $1`,
      [congoId]
    );
    expect(rows[0]).toEqual({ currency: 'XAF', minor_unit: 0, is_active: true });
  });

  test('M5 : utils/currency.js résout Congo sans modification de code', async () => {
    const currency = await getMarketCurrency(congoId);
    expect(currency).toEqual({ currency: 'XAF', minor_unit: 0 });
  });

  test('M5 : formatAmountForMarket produit un montant XAF sans décimale', async () => {
    const formatted = await formatAmountForMarket(15000, congoId);
    expect(formatted).toBe('15\u202f000 XAF');
  });

  test('M2 : un grant sur KM n\'autorise jamais le Congo (isolation, marché réel)', async () => {
    const u = await db.query(
      `INSERT INTO users (email, full_name, phone, role, password_hash)
       VALUES ($1, 'ITest Congo', $2, 'admin', $3) RETURNING id`,
      [`${PFX}${Date.now()}@test.local`, `+2693${Math.floor(1000000 + Math.random() * 8999999)}`, CI_PLACEHOLDER_HASH]
    );
    const userId = u.rows[0].id;

    await db.query(
      `INSERT INTO operator_market_scopes (user_id, market_id, role) VALUES ($1, $2, 'manager')`,
      [userId, comoresId]
    );

    const scopes = await resolveAuthorizedMarkets(userId);
    expect(scopes.has(comoresId)).toBe(true);
    expect(scopes.has(congoId)).toBe(false);
  });

  test('les quatre marchés (KM, YT, CM, CG) coexistent sans interférence', async () => {
    const { rows } = await db.query(
      `SELECT code FROM markets WHERE code IN ('KM', 'YT', 'CM', 'CG') ORDER BY code`
    );
    expect(rows.map(r => r.code)).toEqual(['CG', 'CM', 'KM', 'YT']);
  });
}
