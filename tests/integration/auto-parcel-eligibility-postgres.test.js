'use strict';
/**
 * @test-kind integration
 * @test-runner jest
 * @test-requires postgres
 * @integration auto-parcel-eligibility-postgres.test.js
 * @brief Repartition automatique : un colis ne melange jamais local et import, ni articles prets et non recus (cas fixture KOM-101/102/103/LOCAL).
 */
const crypto = require('crypto');
const { Client } = require('pg');
const db = require('../../db');
const { assertTestDatabase } = require('../helpers/e2eDbKit');
const autoParcel = require('../../services/auto-parcel');

jest.setTimeout(60000);
const describeDb = process.env.DATABASE_URL ? describe : describe.skip;
const q = (sql, args) => db.query(sql, args);
const run = crypto.randomBytes(4).toString('hex');
const uuid = () => crypto.randomUUID();

describeDb('Repartition automatique — eligibilite des colis (PG16 jetable)', () => {
  let marketId; let userId; let relais; let supplierId; const o = {}; const item = {};

  async function mkOrder(key, source, { received = null } = {}) {
    o[key] = uuid(); item[key] = uuid();
    await q("INSERT INTO orders(id,reference,user_id,relais_id,total_kmf,payment_mode,market_id,status,payment_status) VALUES ($1,$2,$3,$4,1000,(SELECT (enum_range(NULL::payment_mode))[1]),$5,'ordered',(SELECT (enum_range(NULL::payment_status))[1]))",
      [o[key], `ELIG-${run}-${key}`, userId, relais, marketId]);
    const productId = uuid();
    await q('INSERT INTO products(id,name) VALUES ($1,$2)', [productId, `Elig ${run} ${key}`]);
    await q('INSERT INTO order_items(id,order_id,product_id,quantity,price_kmf,fulfillment_source) VALUES ($1,$2,$3,2,1000,$4)', [item[key], o[key], productId, source]);
    if (received !== null) await receive(key, received);
  }
  // Reception physique reelle au sens de v_purchase_line_progress : allocation + unite physique + placement RECEIVE.
  // Insertion directe sur la base jetable (triggers/FK du Hub desactives pour ce seul seeding).
  async function receive(key, qty) {
    const c = new Client({ connectionString: process.env.DATABASE_URL });
    await c.connect();
    try {
      await c.query("SET session_replication_role = 'replica'");
      const po = uuid(); const line = uuid(); const alloc = uuid(); const unit = uuid();
      await c.query("INSERT INTO purchase_orders(id,order_id,order_item_id,supplier_id,market_id,qty,supplier_sku) VALUES ($1,$2,$3,$4,$5,2,'SKU')", [po, o[key], item[key], supplierId, marketId]);
      await c.query("INSERT INTO purchase_lines(id,order_item_id,supplier_id,supplier_sku,quantity,procurement_hub_ref,purchase_order_id) VALUES ($1,$2,$3,'SKU',2,'DXB',$4)", [line, item[key], supplierId, po]);
      await c.query("INSERT INTO hub_purchase_allocations(id,purchase_order_id,purchase_line_id,order_id,order_item_id,product_sku_id,supplier_id,supplier_unit_ref,supplier_order_identity,quantity,market_id,destination_ref) VALUES ($1,$2,$3,$4,$5,$6,$7,'REF','{}'::jsonb,2,$8,'KM')", [alloc, po, line, o[key], item[key], uuid(), supplierId, marketId]);
      await c.query("INSERT INTO hub_physical_units(id,reference,unit_type,state) VALUES ($1,$2,'HANDLING_UNIT','RECEIVED')", [unit, `U-${run}-${key}`]);
      await c.query("INSERT INTO hub_physical_unit_placements(physical_unit_id,allocation_id,quantity,operation_type) VALUES ($1,$2,$3,'RECEIVE')", [unit, alloc, qty]);
    } finally { await c.end(); }
  }
  const parcelOf = async (key) => (await q('SELECT p.id, p.reference FROM parcel_items pi JOIN parcels p ON p.id=pi.parcel_id WHERE pi.order_item_id=$1 AND p.status<>$2', [item[key], 'cancelled'])).rows[0] || null;
  const itemsIn = async (parcelId) => (await q('SELECT order_item_id FROM parcel_items WHERE parcel_id=$1', [parcelId])).rows.map((r) => r.order_item_id);

  beforeAll(async () => {
    assertTestDatabase();
    const host = new URL(process.env.DATABASE_URL).hostname;
    if (!['localhost', '127.0.0.1', '::1'].includes(host)) throw new Error('ELIGIBILITY_TEST_LOCAL_POSTGRES_ONLY');
    ({ rows: [{ id: marketId }] } = await q("SELECT id FROM markets WHERE code='KM' LIMIT 1"));
    userId = uuid(); relais = uuid(); supplierId = uuid();
    await q("INSERT INTO users(id,full_name,email,phone,role) VALUES ($1,$2,$3,$4,'client')", [userId, `Elig ${run}`, `elig-${run}@komerce.test`, `+2699${String(Math.floor(Math.random() * 1e7)).padStart(7, '0')}`]);
    await q("INSERT INTO relais(id,name,phone,address,market_id,island,island_code,is_active) VALUES ($1,$2,$3,'Moroni',$4,'Grande Comore','MORONI',TRUE)", [relais, `Relais ${run}`, `+2698${String(Math.floor(Math.random() * 1e7)).padStart(7, '0')}`, marketId]);
    await q("INSERT INTO suppliers(id,name,platform) VALUES ($1,$2,'noon')", [supplierId, `Fournisseur ${run}`]);
    await mkOrder('101', 'IMPORT', { received: 2 });   // import, recu au Hub
    await mkOrder('102', 'IMPORT', { received: 2 });   // import, recu au Hub
    await mkOrder('103', 'IMPORT');                    // import, sourcing requis : ni ligne d'achat ni reception
    await mkOrder('LOCAL', 'LOCAL_STOCK');                   // circuit local
  });
  afterAll(async () => { await db.pool.end().catch(() => {}); });

  test('import prêt sans colis local : LOCAL_STOCK attend sa preuve physique au relais', async () => {
    const results = [];
    for (const k of ['101', '102', '103', 'LOCAL']) results.push(await autoParcel.distributeOrder(o[k]));
    const p101 = await parcelOf('101'); const p102 = await parcelOf('102'); const pLocal = await parcelOf('LOCAL');
    expect(p101).not.toBeNull(); expect(p102).not.toBeNull();
    expect(p101.id).not.toBe(p102.id);
    expect((await q('SELECT order_id FROM parcels WHERE id=$1', [p101.id])).rows[0].order_id).toBe(o['101']);
    expect(pLocal).toBeNull(); // Le relais seul peut attester et créer ce colis.
    expect(await parcelOf('103')).toBeNull();
    expect(results[2]).toMatchObject({ success: true, nothing_eligible: true });
    expect(results[3]).toMatchObject({ success: true, nothing_eligible: true, local_direct_items: 1 });
    expect(await itemsIn(p101.id)).toEqual([item['101']]);
    expect(await itemsIn(p102.id)).toEqual([item['102']]);
    expect((await q('SELECT count(*)::int AS n FROM parcel_items WHERE order_item_id=$1', [item.LOCAL])).rows[0].n).toBe(0);
  });

  test('idempotent : un second passage ne crée rien pour IMPORT non reçu ou LOCAL_STOCK', async () => {
    const before = (await q('SELECT count(*)::int AS n FROM parcel_items pi JOIN order_items oi ON oi.id=pi.order_item_id WHERE oi.order_id = ANY($1)', [Object.values(o)])).rows[0].n;
    const r101 = await autoParcel.distributeOrder(o['101']);
    const r103 = await autoParcel.distributeOrder(o['103']);
    const rLocal = await autoParcel.distributeOrder(o.LOCAL);
    const after = (await q('SELECT count(*)::int AS n FROM parcel_items pi JOIN order_items oi ON oi.id=pi.order_item_id WHERE oi.order_id = ANY($1)', [Object.values(o)])).rows[0].n;
    expect(r101).toMatchObject({ already_assigned: true });
    expect(r103.nothing_eligible).toBe(true);
    expect(rLocal).toMatchObject({ nothing_eligible: true, local_direct_items: 1 });
    expect(await parcelOf('LOCAL')).toBeNull();
    expect(after).toBe(before);
  });

  test('une fois recu, l article 103 a son propre colis import (jamais le colis local)', async () => {
    await receive('103', 2);
    const r = await autoParcel.distributeOrder(o['103']);
    expect(r.success).toBe(true);
    const p103 = await parcelOf('103'); const pLocal = await parcelOf('LOCAL');
    expect(p103).not.toBeNull();
    expect(pLocal).toBeNull();
  });
});
