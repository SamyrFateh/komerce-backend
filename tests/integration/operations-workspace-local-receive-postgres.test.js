'use strict';

/**
 * @test-kind integration
 * @test-runner jest
 * @test-requires postgres
 *
 * Feature proprietaire : logistics (Workspace Operations, geste Relais · Receptionner).
 * Regle a deux branches : colis LOCAL expedie = reception par scan Workspace ; colis rattache a une expedition
 * (article IMPORT) = refus serveur RELAY_RECEIVE_REQUIRES_SHIPMENT_ATTESTATION (attestation d'expedition).
 */
const hasEnv = Boolean(process.env.DATABASE_URL);
if (!hasEnv) {
  describe.skip('Workspace receive local — SKIPPED: no DATABASE_URL', () => { it('requires DATABASE_URL', () => {}); });
} else {
  const crypto = require('crypto');
  const db = require('../../db');
  const workspace = require('../../services/operations-workspace');
  jest.setTimeout(30000);
  const TAG = `wsrecv${Date.now().toString(36)}`;
  const created = { orders: [], parcels: [], relais: [], products: [] };
  let market; let relaisId;

  async function seed(label, source) {
    const productId = crypto.randomUUID();
    created.products.push(productId);
    await db.query('INSERT INTO products (id, name, price_kmf, stock) VALUES ($1,$2,1000,10)', [productId, `${TAG}-${label}`]);
    const orderId = crypto.randomUUID();
    created.orders.push(orderId);
    await db.query(
      `INSERT INTO orders (id, reference, relais_id, market_id, total_kmf, payment_mode, payment_status, status)
       VALUES ($1,$2,$3,$4,1000,'cash_relais','paid','confirmed')`, [orderId, `${TAG}-${label}`, relaisId, market.id]);
    const itemId = crypto.randomUUID();
    await db.query(
      `INSERT INTO order_items (id, order_id, product_id, quantity, price_kmf, fulfillment_source)
       VALUES ($1,$2,$3,1,1000,$4)`, [itemId, orderId, productId, source]);
    const parcelId = crypto.randomUUID();
    created.parcels.push(parcelId);
    await db.query(
      `INSERT INTO parcels (id, order_id, reference, status, relais_id) VALUES ($1,$2,$3,'shipped',$4)`,
      [parcelId, orderId, `${TAG}-P-${label}`, relaisId]);
    await db.query('INSERT INTO parcel_items (parcel_id, order_item_id, product_id, quantity) VALUES ($1,$2,$3,1)', [parcelId, itemId, productId]);
    return { parcelId, reference: `${TAG}-P-${label}` };
  }
  const status = async (id) => (await db.query('SELECT status::text AS s FROM parcels WHERE id=$1', [id])).rows[0].s;

  beforeAll(async () => {
    [market] = (await db.query("SELECT id, code, name, currency, lifecycle_status FROM markets WHERE code='KM'")).rows;
    relaisId = crypto.randomUUID();
    created.relais.push(relaisId);
    await db.query(`INSERT INTO relais (id, name, agent_name, phone, address, island, market_id)
                    VALUES ($1,$2,'E2E','+269000111','Moroni','Ngazidja',$3)`, [relaisId, `${TAG}-relais`, market.id]);
  });
  afterAll(async () => {
    try {
      for (const id of created.parcels) { await db.query('DELETE FROM scan_events WHERE parcel_id=$1', [id]).catch(() => {}); await db.query('DELETE FROM incidents WHERE parcel_id=$1', [id]).catch(() => {}); await db.query('DELETE FROM parcel_events WHERE parcel_id=$1', [id]).catch(() => {}); await db.query('DELETE FROM parcel_items WHERE parcel_id=$1', [id]); await db.query('DELETE FROM parcels WHERE id=$1', [id]).catch(() => {}); }
      for (const id of created.orders) { await db.query('DELETE FROM order_items WHERE order_id=$1', [id]).catch(() => {}); await db.query('DELETE FROM orders WHERE id=$1', [id]).catch(() => {}); }
      for (const id of created.products) await db.query('DELETE FROM products WHERE id=$1', [id]).catch(() => {});
      for (const id of created.relais) await db.query('DELETE FROM relais WHERE id=$1', [id]).catch(() => {});
    } finally { if (db.pool && db.pool.end) await db.pool.end(); }
  });

  const ACTOR = { id: null, role: 'admin', full_name: 'Test' };
  const MANUAL = { reason: 'scanner_unavailable' };

  test('file to_receive : local_receivable vrai pour le colis local, faux pour le colis import', async () => {
    const local = await seed('LOCALQ', 'LOCAL_STOCK');
    const imp = await seed('IMPORTQ', 'IMPORT');
    const rows = (await workspace.buildWorkspace({ market })).queues.relay.to_receive;
    expect(rows.find((r) => r.reference === local.reference).local_receivable).toBe(true);
    expect(rows.find((r) => r.reference === imp.reference).local_receivable).toBe(false);
  });

  test('colis local expedie : receive passe (statut available)', async () => {
    const local = await seed('LOCALOK', 'LOCAL_STOCK');
    await workspace.scanParcel(local.reference, 'receive', market, ACTOR, MANUAL);
    expect(await status(local.parcelId)).toBe('available');
  });

  test('colis import : receive refuse cote serveur, code explicite vers l\'attestation, statut inchange', async () => {
    const imp = await seed('IMPORTREFUSE', 'IMPORT');
    await expect(workspace.scanParcel(imp.reference, 'receive', market, ACTOR, MANUAL))
      .rejects.toMatchObject({ code: 'RELAY_RECEIVE_REQUIRES_SHIPMENT_ATTESTATION', status: 409 });
    expect(await status(imp.parcelId)).toBe('shipped');
  });
}
