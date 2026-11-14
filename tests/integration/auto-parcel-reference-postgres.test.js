'use strict';
/**
 * @test-kind integration
 * @test-runner jest
 * @test-requires postgres
 * @integration auto-parcel-reference-postgres.test.js
 * @brief Générateur unique de références colis (parcel_ref_seq) : concurrence, migration de réalignement.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
const db = require('../../db');
const { assertTestDatabase } = require('../helpers/e2eDbKit');
const { generateParcelRef } = require('../../utils/reference');

jest.setTimeout(120000);
const describeDb = process.env.DATABASE_URL ? describe : describe.skip;
const q = (sql, args) => db.query(sql, args);
const run = crypto.randomBytes(4).toString('hex');
const MIGRATION = fs.readFileSync(path.join(__dirname, '../../migrations/396_parcel_ref_seq_realign.sql'), 'utf8');
const N = 24;

describeDb('Références colis — un seul générateur (PG16 jetable)', () => {
  let marketId; let userId; let productId; const orders = [];

  beforeAll(async () => {
    assertTestDatabase();
    const host = new URL(process.env.DATABASE_URL).hostname;
    if (!['localhost', '127.0.0.1', '::1'].includes(host)) throw new Error('PARCEL_REF_TEST_LOCAL_POSTGRES_ONLY');
    ({ rows: [{ id: marketId }] } = await q("SELECT id FROM markets WHERE code='KM' LIMIT 1"));
    userId = crypto.randomUUID(); productId = crypto.randomUUID();
    await q("INSERT INTO users(id,full_name,email,phone,role) VALUES ($1,$2,$3,$4,'client')", [userId, `Parcel ref ${run}`, `parcel-ref-${run}@komerce.test`, `+2699${parseInt(run.slice(0, 6), 16) % 10000000}`.slice(0, 12)]);
    await q('INSERT INTO products(id,name) VALUES ($1,$2)', [productId, `Parcel ref product ${run}`]);
    for (let i = 0; i < N; i += 1) {
      const relais = crypto.randomUUID(); const order = crypto.randomUUID(); const item = crypto.randomUUID();
      await q("INSERT INTO relais(id,name,phone,address,market_id,island,island_code,is_active) VALUES ($1,$2,$3,'Moroni',$4,'Grande Comore','MORONI',TRUE)", [relais, `Relais ref ${run}-${i}`, `+2698${String(i).padStart(2, '0')}${parseInt(run.slice(0, 5), 16) % 100000}`.slice(0, 12), marketId]);
      await q("INSERT INTO orders(id,reference,user_id,relais_id,total_kmf,payment_mode,market_id,status,payment_status) VALUES ($1,$2,$3,$4,1000,(SELECT (enum_range(NULL::payment_mode))[1]),$5,'preparation','paid')", [order, `PREF-${run}-${i}`, userId, relais, marketId]);
      await q('INSERT INTO order_items(id,order_id,product_id,quantity,price_kmf) VALUES ($1,$2,$3,1,1000)', [item, order, productId]);
      orders.push({ order, relais });
    }
  });
  afterAll(async () => { await db.pool.end().catch(() => {}); });

  test(`${N} créations concurrentes (connexions distinctes) : aucune collision, références uniques et séquentielles`, async () => {
    // Historique « en avance » sur la séquence, comme sur une base ayant vécu avec l'ancien max + 1.
    const ahead = `KOM-P-2026-9${String(Math.floor(Math.random() * 90000) + 10000)}`;
    await q("INSERT INTO parcels(id,order_id,reference,status,type,label) VALUES ($1,$2,$3,'cancelled','standard','historique max+1')", [crypto.randomUUID(), orders[0].order, ahead]);
    await q("INSERT INTO parcels(id,order_id,reference,status,type,label) VALUES ($1,$2,$3,'cancelled','standard','historique non numérique')", [crypto.randomUUID(), orders[0].order, `KOM-P-LEGACY-${run}`]);
    await q(MIGRATION);
    const clients = await Promise.all(orders.map(async () => { const c = new Client({ connectionString: process.env.DATABASE_URL }); await c.connect(); return c; }));
    expect(new Set(clients.map((c) => c.processID)).size).toBe(N); // connexions distinctes
    let results;
    try {
      // Ce test certifie le générateur unique de références, pas la décision
      // de répartir physiquement un colis. Cette décision exige désormais
      // IMPORT reçu ; son E2E propre est auto-parcel-eligibility-postgres.
      // INSERT réservé exclusivement à cette base PG16 jetable, pour prouver
      // la contrainte UNIQUE persistée sous concurrence réelle.
      results = await Promise.all(orders.map(async (o, i) => {
        const ref = await generateParcelRef(clients[i]);
        await clients[i].query(
          "INSERT INTO parcels(id,order_id,reference,status,type,label) VALUES ($1,$2,$3,'preparation','standard','test sequence concurrence')",
          [crypto.randomUUID(), o.order, ref]
        );
        return { success: true, parcel_created: true, parcel_ref: ref };
      }));
    } finally { await Promise.all(clients.map((c) => c.end())); }
    expect(results.every((r) => r.success && r.parcel_created)).toBe(true);
    const refs = results.map((r) => r.parcel_ref);
    expect(new Set(refs).size).toBe(N);
    const numbers = refs.map((r) => Number(r.split('-').pop())).sort((a, b) => a - b);
    expect(numbers[0]).toBeGreaterThan(Number(ahead.split('-').pop()));
    expect(numbers[N - 1] - numbers[0]).toBe(N - 1);
    const { rows } = await q('SELECT count(*)::int AS n, count(DISTINCT reference)::int AS d FROM parcels WHERE reference = ANY($1)', [refs]);
    expect(rows[0]).toEqual({ n: N, d: N });
  });

  test('migration de réalignement : idempotente, ne recule jamais, ignore les références non numériques', async () => {
    const read = async () => (await q('SELECT last_value::bigint AS v FROM parcel_ref_seq')).rows[0].v;
    const before = await read();
    await q(MIGRATION); await q(MIGRATION);
    expect(await read()).toBe(before);
    await q('SELECT setval($1, $2, true)', ['parcel_ref_seq', Number(before) + 5000]);
    const high = await read();
    await q(MIGRATION);
    expect(await read()).toBe(high); // jamais en arrière
  });
});
