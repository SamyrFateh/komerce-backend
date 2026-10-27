'use strict';
/**
 * @test-kind e2e-api
 * @test-runner jest
 * @test-requires postgres
 */
// HUB-B — les lecteurs de vérité suivent l'appartenance par lignes (colis multi-commandes).
// Niveau L4 (vraie base PostgreSQL de test). Aucune donnée staging, aucun flux réel.
const db = require('../../db');
const { describeE2E, createCleanup, uuid, tag } = require('../helpers/e2eDbKit');

const { reconcileCustomerHandoff } = require('../../services/customer-handoff-reconciliation');
const { collectP4P2Canonical } = require('../../scripts/research/p4-p2-canonical-collector');
const { autoCreateParcel } = require('../../services/parcel-auto-create-service');
const { evaluateOrderParcelLinkRules } = require('../../utils/orderParcelLinkRules');
const { memberParcelPredicate } = require('../../services/parcel-order-membership');

describeE2E('HUB-B — lecteurs de vérité alignés sur les colis multi-commandes', () => {
  const cleanup = createCleanup(db);
  afterAll(async () => cleanup.run());
  let market; let user; let relais; let product; let actor;

  beforeAll(async () => {
    market = (await db.query("SELECT id FROM markets WHERE code='KM' LIMIT 1")).rows[0];
    user = uuid(); relais = uuid(); product = uuid(); actor = uuid();
    await db.query("INSERT INTO users(id,full_name,email,phone,role) VALUES($1,'Hub B Customer',$2,$3,'client')",
      [user, `${tag('hubB')}@komerce.test`, `+2695${String(Date.now()).slice(-7)}`]);
    await db.query("INSERT INTO relais(id,name,agent_name,phone,address,market_id) VALUES($1,$2,'Agent','+2693000001','Addr',$3)",
      [relais, tag('relayB'), market.id]);
    await db.query("INSERT INTO products(id,name,price_kmf,cost_kmf,volume_cm3,stock,price_aed,inventory_model) VALUES($1,$2,1000,500,1000,10,10,'SKU')",
      [product, tag('prodB')]);
  });

  async function makeOrder(status = 'preparation') {
    const id = uuid(); const itemId = uuid();
    await db.query(`INSERT INTO orders(id,user_id,relais_id,market_id,reference,status,payment_status,payment_mode,total_kmf,total_eur)
      VALUES($1,$2,$3,$4,$5,$6,'paid','stripe_eur',1000,2)`, [id, user, relais, market.id, tag('K-HUBB'), status]);
    cleanup.trackSql("UPDATE orders SET status='cancelled', updated_at=NOW() WHERE id=$1", [id]);
    await db.query('INSERT INTO order_items(id,order_id,product_id,quantity,price_kmf) VALUES($1,$2,$3,1,1000)', [itemId, id, product]);
    return { id, itemId };
  }

  async function sharedParcel(carrier, other, status = 'preparation') {
    const id = uuid();
    await db.query('INSERT INTO parcels(id,order_id,relais_id,reference,status) VALUES($1,$2,$3,$4,$5)', [id, carrier.id, relais, tag('COLB'), status]);
    cleanup.trackSql('DELETE FROM parcel_items WHERE parcel_id=$1', [id]);
    for (const o of [carrier, other]) {
      await db.query('INSERT INTO parcel_items(parcel_id,order_item_id,product_id,quantity) VALUES($1,$2,$3,1)', [id, o.itemId, product]);
    }
    return id;
  }

  test('bilan de remise : la commande non porteuse voit le colis partagé (plus de « aucun colis actif »)', async () => {
    const x = await makeOrder(); const y = await makeOrder();
    const p = await sharedParcel(x, y);
    const verdict = await reconcileCustomerHandoff(db, { orderId: y.id });
    expect(verdict.reason).toBe('CUSTOMER_HANDOFF_NOT_COLLECTED');
    expect(verdict.parcel_count).toBe(1);
    const ref = (await db.query('SELECT reference FROM parcels WHERE id=$1', [p])).rows[0].reference;
    expect(verdict.parcel_refs).toEqual([ref]);
    // Seventh seam: physically shared carrier parcel must be linked by
    // parcel_items (not by parcels.order_id), and still remain PENDING before
    // its own authorized collection scan.
    const scanned = await collectP4P2Canonical(db, {
      item: { order_id:y.id, order_item_id:y.itemId, relais_id:relais },
    });
    expect(scanned.facts).toMatchObject({
      parcel_count:1,item_parcel_count:1,shared_carrier_parcels:1,
      handoff_verdict:'HANDOFF_PENDING',
    });
    expect(scanned.diagnostics.contradictions).toEqual([]);
    expect(scanned.diagnostics.gaps).toContain('CUSTOMER_HANDOFF_PENDING');

  });

  test('création automatique : une commande dont les lignes sont déjà dans un colis partagé ne crée pas de doublon', async () => {
    const x = await makeOrder(); const y = await makeOrder();
    await sharedParcel(x, y);
    const before = (await db.query('SELECT count(*)::int AS n FROM parcels')).rows[0].n;
    const out = await inTx((c) => autoCreateParcel(c, y.id, { id: actor, name: 'Hub', role: 'admin' }));
    expect(out).toMatchObject({ success: false, reason: 'parcel_exists' });
    expect((await db.query('SELECT count(*)::int AS n FROM parcels')).rows[0].n).toBe(before);
  });

  test('règles de lien commande↔colis : le statut de la commande non porteuse suit le colis partagé', async () => {
    const x = await makeOrder(); const y = await makeOrder();
    await sharedParcel(x, y, 'shipped');
    await evaluateOrderParcelLinkRules(y.id, db);
    expect((await db.query('SELECT status FROM orders WHERE id=$1', [y.id])).rows[0].status).toBe('shipped');
  });

  test('prédicat corrélé (listes « sans colis ») : la commande non porteuse n’est plus listée sans colis', async () => {
    const x = await makeOrder(); const y = await makeOrder(); const z = await makeOrder();
    await sharedParcel(x, y);
    const { rows } = await db.query(
      `SELECT o.id FROM orders o WHERE o.id = ANY($1::uuid[])
         AND NOT EXISTS (SELECT 1 FROM parcels p2 WHERE ${memberParcelPredicate('p2', 'o.id')} AND p2.status != 'cancelled')`,
      [[x.id, y.id, z.id]]
    );
    expect(rows.map((r) => r.id)).toEqual([z.id]);
  });
});

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
