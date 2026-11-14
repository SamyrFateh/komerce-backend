'use strict';
/**
 * @test-kind integration
 * @test-runner jest
 * @test-requires postgres
 * @integration relay-return-compensation-cap-postgres.test.js
 * @brief FA-10 : cumul des compensations SAV ≤ unités réellement remises, tous dossiers (y compris clos), sous deux opérateurs ; devises KMF/XAF et isolation par article.
 */
jest.setTimeout(60000);
if (!process.env.DATABASE_URL) {
  describe.skip('relay-return-compensation-cap PostgreSQL (DATABASE_URL required)', () => { test('skipped', () => {}); });
} else {
  const { randomUUID, randomBytes } = require('crypto');
  const db = require('../../db');
  const comp = require('../../services/relay-return-compensation-service');
  const requests = require('../../services/relay-return-request-service');
  const uid = () => randomUUID();
  const tag = 'FA10-' + randomBytes(5).toString('hex').toUpperCase();
  const ids = { orders: [], items: [], products: [], disputes: [], relais: [], users: [] };
  let admin; let admin2; let relays; let markets; let seq = 0;
  const sql = (s, p) => db.query(s, p);
  // Fixture privilégiée : replica limité à une connexion dédiée (le pool n'est pas collant).
  async function priv(statement, params) {
    const c = await db.getClient();
    try { await c.query("SET session_replication_role='replica'"); return await c.query(statement, params); } finally {
      await c.query("SET session_replication_role='origin'").catch(() => {}); c.release();
    }
  }

  async function seedItem({ market = 'KM', collected = 1 }) {
    seq += 1;
    const order = uid(); const item = uid(); const product = uid();
    ids.orders.push(order); ids.items.push(item); ids.products.push(product);
    const xaf = market === 'CM';
    await sql(`INSERT INTO products(id,name,price_kmf,cost_kmf,volume_cm3,stock,price_aed,inventory_model) VALUES($1,$2,10000,3000,1000,0,100,'SKU')`, [product, `P ${tag}-${seq}`]);
    await sql(`INSERT INTO orders(id,user_id,relais_id,market_id,reference,status,payment_status,payment_mode,total_kmf,total_eur,fx_snapshot)
               VALUES($1,$2,$3,$4,$5,'collected','paid','cash_relais',${10000 * collected},20,$6)`,
    [order, admin, relays[market], markets[market], `${tag}-${seq}`, xaf ? JSON.stringify({ market: { currency: 'XAF', amount: 15000 * collected, minor_unit: 0 } }) : null]);
    await priv(`INSERT INTO order_items(id,order_id,product_id,quantity,qty_collected,price_kmf,fulfillment_source) VALUES($1,$2,$3,$4,$4,10000,NULL)`, [item, order, product, collected]);
    return { order, item };
  }
  async function dossier(it, status) {
    const id = uid(); ids.disputes.push(id);
    await sql(`INSERT INTO disputes(id,order_id,type,status,description,return_order_item_id,return_quantity,return_reason,created_by)
               VALUES($1,$2,'product_return',$3,'Produit à examiner',$4,1,'defective',$5)`, [id, it.order, status, it.item, admin]);
    return id;
  }
  const decide = (requestId, actor = { id: admin, role: 'admin' }, amount = 1000) => comp.decideCompensation({
    actor, requestId, movement: 'wallet_credit', amount, reason: 'Défaut cosmétique constaté au relais', db });
  const code = (p) => p.then(() => 'ok', (e) => e.code);

  beforeAll(async () => {
    markets = Object.fromEntries((await sql("SELECT code,id FROM markets WHERE code IN ('KM','CM')")).rows.map((r) => [r.code, r.id]));
    const mk = async (label) => {
      const id = uid(); ids.users.push(id);
      await sql("INSERT INTO users(id,full_name,email,phone,role) VALUES($1,$2,$3,$4,'admin')",
        [id, `SAV ${label} ${tag}`, `${tag}-${label}@komerce.test`.toLowerCase(), '+2693' + String(BigInt('0x' + randomBytes(4).toString('hex')) % 10000000n).padStart(7, '0')]);
      return id;
    };
    admin = await mk('a'); admin2 = await mk('b');
    relays = {};
    for (const code of ['KM', 'CM']) {
      relays[code] = uid(); ids.relais.push(relays[code]);
      await sql("INSERT INTO relais(id,name,agent_name,phone,address,market_id) VALUES($1,$2,'A','+2693000091','R',$3)", [relays[code], `${tag}-R-${code}`, markets[code]]);
    }
  });
  afterAll(async () => {
    try {
      for (const [t, c, v] of [['wallet_transactions', 'reference_id', ids.orders], ['relay_return_compensations', 'request_id', ids.disputes], ['disputes', 'id', ids.disputes],
        ['order_items', 'id', ids.items], ['orders', 'id', ids.orders], ['products', 'id', ids.products], ['relais', 'id', ids.relais]]) {
        if (v.length) await priv(`DELETE FROM ${t} WHERE ${c} = ANY($1::uuid[])`, [v]).catch(() => {});
      }
    } finally { await db.pool.end().catch(() => {}); }
  });

  test('nominal : une unité remise → une compensation ; rejeu idempotent', async () => {
    const it = await seedItem({}); const d = await dossier(it, 'open');
    expect(await code(decide(d))).toBe('ok');
    expect((await decide(d)).replayed).toBe(true);
  });

  test('un dossier CLOS déjà compensé consomme l\'unité : un 2e dossier sur la même unité est refusé (décision et création)', async () => {
    const it = await seedItem({}); const a = await dossier(it, 'open');
    await decide(a);
    await priv("UPDATE disputes SET status='closed' WHERE id=$1", [a]);
    const b = await dossier(it, 'open');
    expect(await code(decide(b))).toBe('COMPENSATION_EXCEEDS_DELIVERED_UNITS');
    await priv("UPDATE disputes SET status='closed' WHERE id=$1", [b]);
    const { rows: [r] } = await sql('SELECT reference FROM orders WHERE id=$1', [it.order]);
    await expect(requests.createReturnRequest({ actor: { id: admin, role: 'admin' }, reference: r.reference, orderItemId: it.item, quantity: 1, reason: 'defective', db }))
      .rejects.toMatchObject({ code: 'RETURN_EXCEEDS_COLLECTED' });
  });

  test('concurrence : deux opérateurs décident deux dossiers sur la seule unité remise → un seul passe', async () => {
    const it = await seedItem({}); const a = await dossier(it, 'resolved'); const b = await dossier(it, 'open');
    const res = await Promise.all([code(decide(a, { id: admin, role: 'admin' })), code(decide(b, { id: admin2, role: 'admin' }))]);
    expect(res.filter((r) => r === 'ok')).toHaveLength(1);
    expect(res.filter((r) => r === 'COMPENSATION_EXCEEDS_DELIVERED_UNITS')).toHaveLength(1);
    expect((await sql('SELECT COUNT(*)::int n FROM relay_return_compensations WHERE order_id=$1', [it.order])).rows[0].n).toBe(1);
  });

  test('2 unités remises : deux dossiers passent, un troisième est refusé ; devise XAF et isolation par article', async () => {
    const it = await seedItem({ market: 'CM', collected: 2 });
    const a = await dossier(it, 'resolved'); const b = await dossier(it, 'resolved'); const c = await dossier(it, 'open');
    expect(await code(decide(a, undefined, 1500))).toBe('ok');
    expect(await code(decide(b, { id: admin2, role: 'admin' }, 1500))).toBe('ok');
    expect(await code(decide(c))).toBe('COMPENSATION_EXCEEDS_DELIVERED_UNITS');
    expect((await sql('SELECT DISTINCT currency FROM relay_return_compensations WHERE order_id=$1', [it.order])).rows).toEqual([{ currency: 'XAF' }]);
    const other = await seedItem({}); const o = await dossier(other, 'open');
    expect(await code(decide(o))).toBe('ok');
  });
}
