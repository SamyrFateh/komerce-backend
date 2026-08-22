'use strict';

/**
 * @test-kind integration
 * @test-runner jest
 * @test-requires postgres
 */

/**
 * tests/integration/order-display-snapshot.test.js
 *
 * P3 — vérifie resolveDisplaySnapshot() et le stockage réel dans
 * orders.display_total_amount/currency/parity_snapshot contre une vraie
 * base (pas de mock). Confirme l'invariant 4 avec un cas concret :
 * relais market ≠ display market.
 *
 * Sans DATABASE_URL → suite skippée proprement.
 */

const dbUrl = process.env.DATABASE_URL || '';
const hasIntegrationEnv = dbUrl.startsWith('postgresql://') && dbUrl.length > 20;

if (!hasIntegrationEnv) {
  describe.skip('order-display-snapshot (needs DATABASE_URL)', () => {
    test('skipped — DATABASE_URL not configured', () => {});
  });
} else {
  let db;
  let resolveDisplaySnapshot;

  const PFX = 'itest-p3+';
  let kmMarketId, cmMarketId, relaisId, orderId;

  beforeAll(async () => {
    db = require('../../db');
    ({ resolveDisplaySnapshot } = require('../../services/order-display-snapshot'));

    kmMarketId = (await db.query(`SELECT id FROM markets WHERE code = 'KM'`)).rows[0].id;
    cmMarketId = (await db.query(`SELECT id FROM markets WHERE code = 'CM'`)).rows[0].id;

    // Relais du marché KM — utilisé pour prouver l'invariant 4 (relais ≠
    // marché de navigation du client).
    const r = await db.query(
      `INSERT INTO relais (name, agent_name, phone, address, island_code, market_id)
       VALUES ($1, 'Agent Test P3', '0000', 'Adresse Test', 'AJ', $2) RETURNING id`,
      [`${PFX}Relais`, kmMarketId]
    );
    relaisId = r.rows[0].id;
  });

  afterAll(async () => {
    if (orderId) await db.query(`DELETE FROM orders WHERE id = $1`, [orderId]);
    await db.query(`DELETE FROM relais WHERE id = $1`, [relaisId]);
  });

  test('résolution réelle : code client (CM/XAF) prime sur le relais (KM)', async () => {
    const snapshot = await resolveDisplaySnapshot({
      totalKmf: 15000,
      displayMarketCode: 'CM',
      relaisMarketId: kmMarketId,
    });
    expect(snapshot.currency).toBe('XAF');
    expect(snapshot.amount).toBe(20000);
    expect(snapshot.meta.source).toBe('display_market_code');
  });

  test('stockage réel : INSERT complet, market_id (relais) ≠ display_currency (navigation)', async () => {
    const snapshot = await resolveDisplaySnapshot({
      totalKmf: 15000,
      displayMarketCode: 'CM',
      relaisMarketId: kmMarketId,
    });

    const { rows: [order] } = await db.query(
      `INSERT INTO orders (
         reference, relais_id, market_id, total_kmf, payment_mode,
         display_total_amount, display_currency, display_parity_snapshot
       ) VALUES ($1, $2, $3, $4, 'cash_relais', $5, $6, $7)
       RETURNING *`,
      [
        `${PFX}${Date.now()}`, relaisId, kmMarketId, 15000,
        snapshot.amount, snapshot.currency, JSON.stringify(snapshot.meta),
      ]
    );
    orderId = order.id;

    // Invariant 4, prouvé en base : le marché de la commande (celui du
    // relais) et la devise affichée sont DIFFÉRENTS — pas une coïncidence,
    // le cas exact que l'invariant protège.
    expect(order.market_id).toBe(kmMarketId);
    expect(order.display_currency).toBe('XAF');
    expect(order.market_id).not.toBe(cmMarketId); // le marché de la commande reste KM (relais)

    // Invariant 1 : total_kmf/total_eur inchangés, aucune colonne Payment
    // Boundary touchée par ce chantier.
    expect(Number(order.total_kmf)).toBe(15000);
  });

  test('immutabilité : une relecture de la commande retourne exactement le même snapshot', async () => {
    const { rows: [reread] } = await db.query(
      `SELECT display_total_amount, display_currency FROM orders WHERE id = $1`,
      [orderId]
    );
    expect(Number(reread.display_total_amount)).toBe(20000);
    expect(reread.display_currency).toBe('XAF');
  });

  test('invariant 7 : une commande sans ces colonnes (legacy) reste NULL, jamais un backfill fabriqué', async () => {
    const legacy = await db.query(
      `INSERT INTO relais (name, agent_name, phone, address, island_code, market_id)
       VALUES ($1, 'Agent Legacy', '0000', 'Adresse Test', 'AJ', $2) RETURNING id`,
      [`${PFX}RelaisLegacy`, kmMarketId]
    );
    const { rows: [order] } = await db.query(
      `INSERT INTO orders (reference, relais_id, market_id, total_kmf, payment_mode)
       VALUES ($1, $2, $3, 10000, 'cash_relais') RETURNING *`,
      [`${PFX}legacy-${Date.now()}`, legacy.rows[0].id, kmMarketId]
    );
    expect(order.display_total_amount).toBeNull();
    expect(order.display_currency).toBeNull();
    expect(order.display_parity_snapshot).toBeNull();

    await db.query(`DELETE FROM orders WHERE id = $1`, [order.id]);
    await db.query(`DELETE FROM relais WHERE id = $1`, [legacy.rows[0].id]);
  });
}
