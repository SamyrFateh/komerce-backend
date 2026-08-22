'use strict';

/**
 * @test-kind integration
 * @test-runner jest
 * @test-requires postgres
 */

/**
 * tests/integration/market-open-mayotte.test.js
 *
 * M10 — la preuve que "ouvrir un marché est un INSERT" (doctrine M0,
 * migrations/135_markets_foundation.sql) tient réellement : Mayotte (YT)
 * traverse toute la chaîne M0/M1/M2/M5 sans qu'aucun de ces modules n'ait
 * été modifié pour ce lot. Seule la migration 139 (un INSERT) est neuve.
 *
 * Sans DATABASE_URL → suite skippée proprement.
 * Run: DATABASE_URL=... npx jest tests/integration/market-open-mayotte.test.js
 */

const dbUrl = process.env.DATABASE_URL || '';
const hasIntegrationEnv = dbUrl.startsWith('postgresql://') && dbUrl.length > 20;

if (!hasIntegrationEnv) {
  describe.skip('market-open-mayotte (needs DATABASE_URL)', () => {
    test('skipped — DATABASE_URL not configured', () => {});
  });
} else {
  let db;
  let getMarketCurrency, formatAmountForMarket;
  let resolveAuthorizedMarkets;
  let mayotteId, comoresId;

  const PFX = 'itest-m10+';
  const CI_PLACEHOLDER_HASH = '$2a$04$AYmAyvzy6sAbPHhY01nPau5qvXBxnD/DFrgbpUzd5QXDR3VgjkISm';

  beforeAll(async () => {
    db = require('../../db');
    ({ getMarketCurrency, formatAmountForMarket } = require('../../utils/currency'));
    ({ resolveAuthorizedMarkets } = require('../../middleware/require-market-scope'));

    const yt = await db.query(`SELECT id FROM markets WHERE code = 'YT'`);
    const km = await db.query(`SELECT id FROM markets WHERE code = 'KM'`);
    mayotteId = yt.rows[0]?.id;
    comoresId = km.rows[0]?.id;
  });

  afterAll(async () => {
    await db.query(`DELETE FROM operator_market_scopes WHERE user_id IN
      (SELECT id FROM users WHERE email LIKE $1)`, [`${PFX}%`]);
    await db.query(`DELETE FROM users WHERE email LIKE $1`, [`${PFX}%`]);
  });

  test('la migration 139 a bien créé le marché Mayotte (M0)', () => {
    expect(mayotteId).toBeDefined();
  });

  test('EUR/minor_unit=2, pas hérité ni recopié de KM', async () => {
    const { rows } = await db.query(
      `SELECT currency, minor_unit, is_active FROM markets WHERE id = $1`,
      [mayotteId]
    );
    expect(rows[0]).toEqual({ currency: 'EUR', minor_unit: 2, is_active: true });
  });

  test('M5 : utils/currency.js résout Mayotte sans modification de code', async () => {
    const currency = await getMarketCurrency(mayotteId);
    expect(currency).toEqual({ currency: 'EUR', minor_unit: 2 });
  });

  test('M5 : formatAmountForMarket produit un montant EUR correctement décimalisé', async () => {
    const formatted = await formatAmountForMarket(1499.9, mayotteId);
    expect(formatted).toBe('1\u202f499,90 €');
  });

  test('M2 : un grant sur KM n\'autorise jamais Mayotte (isolation, marché réel)', async () => {
    const u = await db.query(
      `INSERT INTO users (email, full_name, phone, role, password_hash)
       VALUES ($1, 'ITest M10', $2, 'admin', $3) RETURNING id`,
      [`${PFX}${Date.now()}@test.local`, `+2693${Math.floor(1000000 + Math.random() * 8999999)}`, CI_PLACEHOLDER_HASH]
    );
    const userId = u.rows[0].id;

    await db.query(
      `INSERT INTO operator_market_scopes (user_id, market_id, role) VALUES ($1, $2, 'manager')`,
      [userId, comoresId]
    );

    const scopes = await resolveAuthorizedMarkets(userId);
    expect(scopes.has(comoresId)).toBe(true);
    expect(scopes.has(mayotteId)).toBe(false);
  });

  test('M1b : un relais Mayotte se rattache correctement (schéma inchangé)', async () => {
    const r = await db.query(
      `INSERT INTO relais (name, agent_name, phone, address, island_code, market_id)
       VALUES ('ITest Relais Mayotte', 'Agent Test', '0269000000', 'Adresse Test', 'YT', $1)
       RETURNING id, market_id`,
      [mayotteId]
    );
    expect(r.rows[0].market_id).toBe(mayotteId);
    await db.query(`DELETE FROM relais WHERE id = $1`, [r.rows[0].id]);
  });

  test('les deux marchés (KM, YT) coexistent sans interférence', async () => {
    const { rows } = await db.query(
      `SELECT code FROM markets WHERE code IN ('KM', 'YT') ORDER BY code`
    );
    expect(rows.map(r => r.code)).toEqual(['KM', 'YT']);
  });
}
