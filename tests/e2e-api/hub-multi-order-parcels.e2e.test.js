'use strict';
/**
 * @test-kind e2e-api
 * @test-runner jest
 * @test-requires postgres
 */
// HUB-A — le Hub organise librement ses colis : colis multi-commandes, commandes multi-colis, réaffectations tracées.
// Niveau L4 (vraie base PostgreSQL de test). Aucune donnée staging, aucun flux réel.
const db = require('../../db');
const { describeE2E, createCleanup, uuid, tag } = require('../helpers/e2eDbKit');
const { syncScanToParcels } = require('../../utils/parcelSync');
const {
  addParcelItemTraced, removeParcelItemTraced, reassignParcelItem,
} = require('../../services/parcel-item-mutation-service');
const { listParcelsRepresentingOrder, listOrdersRepresentedByParcel } = require('../../services/parcel-order-membership');

async function inTx(work) {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    const out = await work(client);
    await client.query('COMMIT');
    return out;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

describeE2E('HUB-A — colis multi-commandes, commandes multi-colis, réaffectations tracées', () => {
  const cleanup = createCleanup(db);
  afterAll(async () => cleanup.run());

  let market; let user; let relais; let otherRelais; let product; let actor;

  beforeAll(async () => {
    market = (await db.query("SELECT id FROM markets WHERE code='KM' LIMIT 1")).rows[0];
    user = uuid(); relais = uuid(); otherRelais = uuid(); product = uuid(); actor = uuid();
    await db.query("INSERT INTO users(id,full_name,email,phone,role) VALUES($1,'Hub A Customer',$2,$3,'client')",
      [user, `${tag('hubA')}@komerce.test`, `+2693${String(Date.now()).slice(-7)}`]);
    await db.query("INSERT INTO users(id,full_name,email,phone,role) VALUES($1,'Hub A Agent',$2,$3,'agent_hub')",
      [actor, `${tag('hubA-agent')}@komerce.test`, `+2694${String(Date.now()).slice(-7)}`]);
    for (const r of [relais, otherRelais]) {
      await db.query("INSERT INTO relais(id,name,agent_name,phone,address,market_id) VALUES($1,$2,'Agent','+2693000001','Addr',$3)",
        [r, tag('relay'), market.id]);
    }
    await db.query("INSERT INTO products(id,name,price_kmf,cost_kmf,volume_cm3,stock,price_aed,inventory_model) VALUES($1,$2,1000,500,1000,10,10,'SKU')",
      [product, tag('prod')]);
  });

  async function makeOrder({ items = 1, relaisId = relais, paid = true } = {}) {
    const id = uuid();
    await db.query(`INSERT INTO orders(id,user_id,relais_id,market_id,reference,status,payment_status,payment_mode,total_kmf,total_eur)
      VALUES($1,$2,$3,$4,$5,'preparation',$6,'stripe_eur',1000,2)`, [id, user, relaisId, market.id, tag('K-HUBA'), paid ? 'paid' : 'pending']);
    cleanup.trackSql("UPDATE orders SET status='cancelled', updated_at=NOW() WHERE id=$1", [id]);
    const itemIds = [];
    for (let i = 0; i < items; i += 1) {
      const itemId = uuid();
      await db.query('INSERT INTO order_items(id,order_id,product_id,quantity,price_kmf) VALUES($1,$2,$3,2,1000)', [itemId, id, product]);
      itemIds.push(itemId);
    }
    return { id, itemIds };
  }

  async function makeParcel(order, { status = 'preparation', relaisId = relais } = {}) {
    const id = uuid();
    await db.query("INSERT INTO parcels(id,order_id,relais_id,reference,status) VALUES($1,$2,$3,$4,$5)", [id, order.id, relaisId, tag('COL'), status]);
    cleanup.trackSql('DELETE FROM parcel_items WHERE parcel_id=$1', [id]);
    return id;
  }

  const events = async (parcelId) => (await db.query("SELECT event_type, metadata FROM parcel_events WHERE parcel_id=$1 AND event_type LIKE 'item_%' ORDER BY created_at", [parcelId])).rows;
  const orderStatus = async (id) => (await db.query('SELECT status FROM orders WHERE id=$1', [id])).rows[0].status;

  test('colis multi-commandes : lignes de deux commandes, tracées, représentant les deux commandes', async () => {
    const x = await makeOrder(); const y = await makeOrder();
    const p = await makeParcel(x);
    const a = await inTx((c) => addParcelItemTraced(c, { parcelId: p, orderItemId: x.itemIds[0], actorId: actor }));
    const b = await inTx((c) => addParcelItemTraced(c, { parcelId: p, orderItemId: y.itemIds[0], actorId: actor }));
    expect(a.row.quantity).toBe(2);
    expect(b.row.quantity).toBe(2);
    expect((await listOrdersRepresentedByParcel(db, p)).sort()).toEqual([x.id, y.id].sort());
    expect((await listParcelsRepresentingOrder(db, y.id)).map((r) => r.id)).toEqual([p]);
    const ev = await events(p);
    expect(ev.map((e) => e.event_type)).toEqual(['item_assigned', 'item_assigned']);
    expect(ev[1].metadata).toMatchObject({ cross_order: true, order_id: y.id, carrier_order_id: x.id });
    // parcels.order_id n'est jamais réécrit
    expect((await db.query('SELECT order_id FROM parcels WHERE id=$1', [p])).rows[0].order_id).toBe(x.id);
  });

  test("l'expédition d'un colis multi-commandes fait avancer CHAQUE commande représentée", async () => {
    const x = await makeOrder(); const y = await makeOrder();
    const p = await makeParcel(x, { status: 'preparation' });
    await inTx((c) => addParcelItemTraced(c, { parcelId: p, orderItemId: x.itemIds[0], actorId: actor }));
    await inTx((c) => addParcelItemTraced(c, { parcelId: p, orderItemId: y.itemIds[0], actorId: actor }));
    const res = await syncScanToParcels({ order_id: x.id, step: 'shipped', scan_id: null, scanned_by: actor });
    expect(res.synced).toBe(true);
    expect((await db.query('SELECT status FROM parcels WHERE id=$1', [p])).rows[0].status).toBe('shipped');
    expect(await orderStatus(x.id)).toBe('shipped');
    expect(await orderStatus(y.id)).toBe('shipped');
  });

  test('commande multi-colis : deux colis, une expédition → statut cohérent', async () => {
    const x = await makeOrder({ items: 2 });
    const p1 = await makeParcel(x, { status: 'preparation' });
    const p2 = await makeParcel(x, { status: 'preparation' });
    await db.query('INSERT INTO parcel_items(parcel_id,order_item_id,product_id,quantity) VALUES($1,$2,$3,2)', [p1, x.itemIds[0], product]);
    await db.query('INSERT INTO parcel_items(parcel_id,order_item_id,product_id,quantity) VALUES($1,$2,$3,2)', [p2, x.itemIds[1], product]);
    expect((await listParcelsRepresentingOrder(db, x.id)).length).toBe(2);
    await syncScanToParcels({ order_id: x.id, step: 'shipped', scan_id: null, scanned_by: actor });
    expect(await orderStatus(x.id)).toBe('shipped');
  });

  test('réaffectation : identité, quantité et compteurs conservés ; trace sur les deux colis', async () => {
    const x = await makeOrder(); const y = await makeOrder();
    const p1 = await makeParcel(x); const p2 = await makeParcel(y);
    await db.query('INSERT INTO parcel_items(parcel_id,order_item_id,product_id,quantity,qty_allocated,qty_packed) VALUES($1,$2,$3,2,2,2)', [p1, x.itemIds[0], product]);
    const out = await inTx((c) => reassignParcelItem(c, { fromParcelId: p1, toParcelId: p2, orderItemId: x.itemIds[0], actorId: actor, reason: 'regroupement' }));
    expect(out.moved).toMatchObject({ parcel_id: p2, order_item_id: x.itemIds[0], product_id: product, quantity: 2, qty_allocated: 2, qty_packed: 2 });
    expect((await db.query('SELECT count(*)::int AS n FROM parcel_items WHERE order_item_id=$1', [x.itemIds[0]])).rows[0].n).toBe(1);
    expect((await events(p1)).map((e) => e.event_type)).toEqual(['item_reassigned_out']);
    const inEv = await events(p2);
    expect(inEv.map((e) => e.event_type)).toEqual(['item_reassigned_in']);
    expect(inEv[0].metadata).toMatchObject({ from_parcel_id: p1, to_parcel_id: p2, order_item_id: x.itemIds[0], quantity: 2, reason: 'regroupement' });
  });

  test('refus : colis expédié, destination différente, article déjà ailleurs, absent de la source — rien déplacé, rien tracé', async () => {
    const x = await makeOrder(); const z = await makeOrder({ relaisId: otherRelais });
    const draft = await makeParcel(x); const shipped = await makeParcel(x, { status: 'shipped' });
    const draft2 = await makeParcel(x);
    await db.query('INSERT INTO parcel_items(parcel_id,order_item_id,product_id,quantity) VALUES($1,$2,$3,2)', [draft, x.itemIds[0], product]);

    await expect(inTx((c) => reassignParcelItem(c, { fromParcelId: draft, toParcelId: shipped, orderItemId: x.itemIds[0], actorId: actor })))
      .rejects.toMatchObject({ code: 'PARCEL_NOT_MUTABLE' });
    await expect(inTx((c) => removeParcelItemTraced(c, { parcelId: shipped, orderItemId: x.itemIds[0], actorId: actor })))
      .rejects.toMatchObject({ code: 'PARCEL_NOT_MUTABLE' });
    await expect(inTx((c) => addParcelItemTraced(c, { parcelId: draft, orderItemId: z.itemIds[0], actorId: actor })))
      .rejects.toMatchObject({ code: 'DESTINATION_MISMATCH' });
    await expect(inTx((c) => addParcelItemTraced(c, { parcelId: draft2, orderItemId: x.itemIds[0], actorId: actor })))
      .rejects.toMatchObject({ code: 'ITEM_ALREADY_IN_OTHER_PARCEL' });
    await expect(inTx((c) => reassignParcelItem(c, { fromParcelId: draft2, toParcelId: draft, orderItemId: x.itemIds[0], actorId: actor })))
      .rejects.toMatchObject({ code: 'ITEM_NOT_IN_SOURCE_PARCEL' });

    expect((await db.query('SELECT parcel_id FROM parcel_items WHERE order_item_id=$1', [x.itemIds[0]])).rows).toEqual([{ parcel_id: draft }]);
    for (const pid of [draft, shipped, draft2]) expect(await events(pid)).toEqual([]);
  });

  test('retrait tracé : la ligne retirée laisse une trace avec identité et quantité', async () => {
    const x = await makeOrder(); const p = await makeParcel(x);
    await inTx((c) => addParcelItemTraced(c, { parcelId: p, orderItemId: x.itemIds[0], actorId: actor }));
    const deleted = await inTx((c) => removeParcelItemTraced(c, { parcelId: p, orderItemId: x.itemIds[0], actorId: actor }));
    expect(deleted).toMatchObject({ order_item_id: x.itemIds[0], quantity: 2 });
    const ev = await events(p);
    expect(ev.map((e) => e.event_type)).toEqual(['item_assigned', 'item_removed']);
    expect(ev[1].metadata).toMatchObject({ order_item_id: x.itemIds[0], quantity: 2 });
  });

  test('concurrence : deux réaffectations simultanées de la même ligne → une seule gagne, ligne unique conservée', async () => {
    const x = await makeOrder();
    const src = await makeParcel(x); const dstA = await makeParcel(x); const dstB = await makeParcel(x);
    await db.query('INSERT INTO parcel_items(parcel_id,order_item_id,product_id,quantity) VALUES($1,$2,$3,2)', [src, x.itemIds[0], product]);
    const results = await Promise.allSettled([
      inTx((c) => reassignParcelItem(c, { fromParcelId: src, toParcelId: dstA, orderItemId: x.itemIds[0], actorId: actor })),
      inTx((c) => reassignParcelItem(c, { fromParcelId: src, toParcelId: dstB, orderItemId: x.itemIds[0], actorId: actor })),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const loser = results.find((r) => r.status === 'rejected');
    expect(loser.reason.code).toBe('ITEM_NOT_IN_SOURCE_PARCEL');
    const rows = (await db.query('SELECT parcel_id, quantity FROM parcel_items WHERE order_item_id=$1', [x.itemIds[0]])).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0].quantity).toBe(2);
    const traces = [...await events(dstA), ...await events(dstB), ...await events(src)];
    expect(traces.map((t) => t.event_type).sort()).toEqual(['item_reassigned_in', 'item_reassigned_out']);
  });

  test('concurrence croisée A→B / B→A sur deux lignes : pas de deadlock, les deux lignes restent uniques', async () => {
    const x = await makeOrder({ items: 2 });
    const a = await makeParcel(x); const b = await makeParcel(x);
    await db.query('INSERT INTO parcel_items(parcel_id,order_item_id,product_id,quantity) VALUES($1,$2,$3,2)', [a, x.itemIds[0], product]);
    await db.query('INSERT INTO parcel_items(parcel_id,order_item_id,product_id,quantity) VALUES($1,$2,$3,2)', [b, x.itemIds[1], product]);
    const results = await Promise.allSettled([
      inTx((c) => reassignParcelItem(c, { fromParcelId: a, toParcelId: b, orderItemId: x.itemIds[0], actorId: actor })),
      inTx((c) => reassignParcelItem(c, { fromParcelId: b, toParcelId: a, orderItemId: x.itemIds[1], actorId: actor })),
    ]);
    expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
    const rows = (await db.query('SELECT order_item_id, parcel_id FROM parcel_items WHERE order_item_id = ANY($1::uuid[])', [x.itemIds])).rows;
    expect(rows).toHaveLength(2);
  });

  test('non-régression : colis historique mono-commande et colis sans ligne gardent la sémantique parcels.order_id', async () => {
    const x = await makeOrder(); const empty = await makeParcel(x, { status: 'preparation' });
    expect((await listParcelsRepresentingOrder(db, x.id)).map((r) => r.id)).toEqual([empty]);
    expect(await listOrdersRepresentedByParcel(db, empty)).toEqual([x.id]);
    await syncScanToParcels({ order_id: x.id, step: 'shipped', scan_id: null, scanned_by: actor });
    expect((await db.query('SELECT status FROM parcels WHERE id=$1', [empty])).rows[0].status).toBe('shipped');
    expect(await orderStatus(x.id)).toBe('shipped');
  });
});
