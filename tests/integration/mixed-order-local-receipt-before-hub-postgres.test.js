'use strict';

/**
 * @test-kind integration
 * @test-runner jest
 * @test-requires postgres
 * @integration mixed-order-local-receipt-before-hub-postgres.test.js
 * @brief #3900 A1 — commande mixte (LOCAL_STOCK + IMPORT) réceptionnée localement avant la répartition Hub : la ligne import reste répartissable, ensachable, mise en KOM-BOX, expédiée et reçue au relais ; les deux retraits aboutissent ; le stock local reste hors distribution Hub (#4068).
 */
jest.setTimeout(120000);

const crypto = require('crypto');
const db = require('../../db');
const grouped = require('../../services/purchasing-grouped-service');
const engagement = require('../../services/purchasing-engagement-service');
const hubOps = require('../../services/hub-operations');
const bagBox = require('../../services/hub-bag-box-service');
const workspace = require('../../services/operations-workspace');
const autoParcel = require('../../services/auto-parcel');
const relay = require('../../services/relay-shipment-receipt');
const { recordLocalRelayReceipt } = require('../../services/local-relay-receipt-service');
const { submitAuthorized } = require('../helpers/submit-authorized');

const q = (sql, params) => db.query(sql, params);
const id = () => crypto.randomUUID();
const describeDb = process.env.DATABASE_URL ? describe : describe.skip;

describeDb('A1 — commande mixte : réception locale avant répartition Hub (PG réel)', () => {
  const tag = 'A1MIX-' + Date.now().toString(36) + '-' + crypto.randomBytes(3).toString('hex');
  let km, market, admin, relayId, relayAgent, orderId, orderRef, importItem, localItem;
  let importAllocation, sourceUnitId, barcode, importParcelId, localParcelId, bagId, boxId, shipmentRef;
  let importProductId, localProductId;

  async function fixture(fn) {
    const client = await db.getClient();
    try { await client.query("SET session_replication_role='replica'"); await fn(client); }
    finally { await client.query("SET session_replication_role='origin'"); client.release(); }
  }
  const orderStatus = async () => (await q('SELECT status FROM orders WHERE id=$1', [orderId])).rows[0].status;

  beforeAll(async () => {
    const host = new URL(process.env.DATABASE_URL).hostname;
    if (!['localhost', '127.0.0.1', '::1'].includes(host)) throw new Error('A1_TEST_LOCAL_POSTGRES_ONLY');
    km = (await q("SELECT id FROM markets WHERE code='KM'")).rows[0].id;
    market = { id: km, code: 'KM', name: 'Comores', currency: 'KMF' };
    admin = id(); relayId = id();
    await q("INSERT INTO users(id,full_name,email,phone,role) VALUES($1,'A1 Admin',$2,$3,'admin')",
      [admin, tag.toLowerCase() + '@komerce.test', '+2693' + String(Date.now()).slice(-7)]);
    await q("INSERT INTO relais(id,name,agent_name,phone,address,market_id,island,island_code,is_active) VALUES($1,$2,'A','+2693000077','R',$3,'Grande Comore','MORONI',TRUE)",
      [relayId, 'R-' + tag, km]);
    relayAgent = { id: admin, role: 'agent_relais', relais_id: relayId };
    await q('UPDATE users SET relais_id=$1 WHERE id=$2', [relayId, admin]);
    const supplierId = id();
    await q("INSERT INTO suppliers(id,name,platform,is_active) VALUES($1,$2,'whatsapp',true)", [supplierId, 'S-' + tag]);
    importProductId = id(); localProductId = id();
    const skuId = id();
    const identity = JSON.stringify({ provider: 'whatsapp', version: 1, payload: { supplier_sku: tag + '-SKU' } });
    for (const [pid, name] of [[importProductId, 'Import'], [localProductId, 'Local']]) {
      await q("INSERT INTO products(id,name,price_kmf,cost_kmf,volume_cm3,stock,price_aed,inventory_model) VALUES($1,$2,10000,3000,1000,0,100,'SKU')", [pid, `${name} ${tag}`]);
    }
    await q("INSERT INTO product_skus(id,product_id,sku,stock,is_active,source,supplier_sku,supplier_unit_ref,supplier_order_identity) VALUES($1,$2,$3,0,true,'SUPPLIER',$4,$5,$6::jsonb)",
      [skuId, importProductId, tag + '-SKU', tag + '-SKU', tag + '-UNIT', identity]);

    orderId = id(); orderRef = tag + '-MIX'; importItem = id(); localItem = id();
    await q("INSERT INTO orders(id,user_id,relais_id,market_id,reference,status,payment_status,payment_mode,total_kmf,total_eur) VALUES($1,$2,$3,$4,$5,'ordered','paid','stripe_eur',20000,40)",
      [orderId, admin, relayId, km, orderRef]);
    await q("INSERT INTO order_items(id,order_id,product_id,quantity,price_kmf,sku_id,fulfillment_source) VALUES($1,$2,$3,1,10000,$4,'IMPORT')", [importItem, orderId, importProductId, skuId]);
    await q("INSERT INTO order_items(id,order_id,product_id,quantity,price_kmf,fulfillment_source) VALUES($1,$2,$3,1,10000,'LOCAL_STOCK')", [localItem, orderId, localProductId]);
    const stockId = id();
    await q("INSERT INTO local_stock(id,product_id,market_id,qty_physical) VALUES($1,$2,$3,1)", [stockId, localProductId, km]);
    await q("INSERT INTO local_stock_allocations(local_stock_id,order_id,quantity,consumed_at) VALUES($1,$2,1,now())", [stockId, orderId]);

    const purchaseLineId = id();
    await q("INSERT INTO purchase_lines(id,purchase_order_id,order_item_id,supplier_id,product_sku_id,supplier_sku,supplier_unit_ref,supplier_order_identity,quantity,supplier_unit_price,supplier_currency,procurement_hub_ref) VALUES($1,NULL,$2,$3,$4,$5,$6,$7::jsonb,1,7,'USD','DXB')",
      [purchaseLineId, importItem, supplierId, skuId, tag + '-SKU', tag + '-UNIT', identity]);
    barcode = '007711' + String(Date.now());
    await q("INSERT INTO product_sku_physical_codes (product_sku_id,supplier_id,code,code_type,trust,printed_on_pack,confirmed_by,confirmed_at,confirmation_proof_ref) VALUES($1,$2,$3,'SUPPLIER_BARCODE','CONFIRMED',true,$4,now(),'observation-emballage')",
      [skuId, supplierId, barcode, admin]);
    const prepared = await grouped.preparePurchaseOrder(
      { supplier_id: supplierId, procurement_hub_ref: 'DXB', line_ids: [purchaseLineId] }, { actor: { id: admin, role: 'admin' } });
    await submitAuthorized(engagement, prepared.purchase_order.id, { actor: { id: admin, role: 'admin' } });
    // 1) Le relais atteste le stock local AVANT toute répartition de la ligne import.
    const local = await recordLocalRelayReceipt({ orderId, actor: relayAgent, physicalReceived: true, note: 'A1 réception locale' });
    expect(local).toMatchObject({ ok: true, status: 200, body: { status: 'available' } });
    localParcelId = local.body.parcel_id;
    // 2) Le Hub reçoit ensuite le colis fournisseur de la ligne import.
    const received = await hubOps.receiveSupplierPackageCommand({
      reference: tag + '-IN',
      contents: [{ purchase_order_id: prepared.purchase_order.id, product_sku_id: skuId, quantity: 1, evidence_code: barcode }],
    }, admin);
    expect(received.status).toBe(201);
    sourceUnitId = received.body.unit.id;
    importAllocation = (await q('SELECT id FROM hub_purchase_allocations WHERE purchase_line_id=$1', [purchaseLineId])).rows[0].id;
  });
  afterAll(async () => {
    // Le rattachement agent→relais ne doit pas survivre au test (le reset d'usine supprime les relais).
    await q('UPDATE users SET relais_id=NULL WHERE id=$1', [admin]).catch(() => {});
    await db.pool.end().catch(() => {});
  });

  test('état de départ : réception locale faite, commande available, ligne import sans colis', async () => {
    expect(await orderStatus()).toBe('available');
    const { rows } = await q('SELECT oi.fulfillment_source, count(pi.id)::int AS n FROM order_items oi LEFT JOIN parcel_items pi ON pi.order_item_id=oi.id WHERE oi.order_id=$1 GROUP BY 1 ORDER BY 1', [orderId]);
    expect(rows).toEqual([{ fulfillment_source: 'IMPORT', n: 0 }, { fulfillment_source: 'LOCAL_STOCK', n: 1 }]);
  });

  test('la ligne import non répartie apparaît dans « à répartir » (espace Hub et résumé de répartition)', async () => {
    const ws = await workspace.buildWorkspace({ market, viewer: { id: admin, role: 'admin' } });
    expect(ws.distribution.unassigned.map((o) => o.reference)).toContain(orderRef);
    const summary = await autoParcel.getDistribution();
    expect(summary.unassigned.map((o) => o.reference)).toContain(orderRef);
  });

  test('répartition d une seule commande : colis import créé, stock local hors distribution Hub (#4068)', async () => {
    const out = await workspace.distributeSingleOrder(orderRef, market);
    expect(out).toMatchObject({ success: true, error: null });
    expect(out.nothing_eligible).toBe(false);
    const { rows } = await q(
      "SELECT p.id, p.status, oi.fulfillment_source FROM parcel_items pi JOIN parcels p ON p.id=pi.parcel_id JOIN order_items oi ON oi.id=pi.order_item_id WHERE oi.order_id=$1 AND p.status<>'cancelled' ORDER BY oi.fulfillment_source",
      [orderId]);
    expect(rows.map((r) => r.fulfillment_source)).toEqual(['IMPORT', 'LOCAL_STOCK']);
    const importRow = rows.find((r) => r.fulfillment_source === 'IMPORT');
    const localRow = rows.find((r) => r.fulfillment_source === 'LOCAL_STOCK');
    importParcelId = importRow.id;
    expect(importParcelId).not.toBe(localRow.id);
    expect(localRow.id).toBe(localParcelId);          // le colis local n'a pas été touché
    expect(localRow.status).toBe('available');
    expect(importRow.status).toBe('preparation');
    // #4068 : aucun mélange local/import dans un même colis, aucune ligne locale dans un colis Hub.
    expect((await q('SELECT count(*)::int AS n FROM parcel_items WHERE parcel_id=$1 AND order_item_id=$2', [importParcelId, localItem])).rows[0].n).toBe(0);
    // Rejouer est idempotent.
    expect(await workspace.distributeSingleOrder(orderRef, market)).toMatchObject({ success: true, already_assigned: true });
  });

  test('sac → KOM-BOX : plus de 409 HUB_BAG_PARCEL_NOT_READY, le sac de la ligne import se range', async () => {
    const bag = await hubOps.createOperatorUnitCommand({
      unit_type: 'HANDLING_UNIT', order_id: orderId, reference: tag + '-SAC',
      bag_plan: [{ order_item_id: importItem, quantity: 1 }] }, admin);
    expect(bag.status).toBe(201);
    bagId = bag.body.physical_unit.id;
    const moved = await hubOps.moveAllocationCommand({
      from_unit_id: sourceUnitId, to_unit_id: bagId, allocation_id: importAllocation,
      quantity: 1, operation_type: 'REPACK', evidence_method: 'SCAN', evidence_code: barcode }, admin);
    expect(moved.status).toBe(200);
    for (const to_state of ['IDENTIFIED', 'QUALITY_CHECKED', 'LOCATED', 'ALLOCATED', 'PICKED', 'PACKED']) {
      expect((await hubOps.transitionOperatorUnitCommand({ unit_id: bagId, to_state, location_ref: 'HUB-DXB-SACS' }, admin)).status).toBe(200);
    }
    const box = await hubOps.createOperatorUnitCommand({ unit_type: 'MARKET_PARCEL', reference: tag + '-BOX' }, admin);
    expect(box.status).toBe(201);
    boxId = box.body.physical_unit.id;
    for (const to_state of ['IDENTIFIED', 'QUALITY_CHECKED', 'LOCATED', 'ALLOCATED', 'PICKED']) {
      expect((await hubOps.transitionOperatorUnitCommand({ unit_id: boxId, to_state }, admin)).status).toBe(200);
    }
    // parcelId omis : le service dérive le colis import unique ; le colis local (available) n'est jamais choisi.
    const linked = await bagBox.attachBagToBox({
      bagUnitId: bagId, boxUnitId: boxId, bagReferenceScan: tag + '-SAC', boxReferenceScan: tag + '-BOX',
      evidenceMethod: 'SCAN', expectedMarketId: km, actorId: admin });
    expect(linked).toMatchObject({ parcel_id: importParcelId, already_linked: false });
  });

  test('expédition puis réception relais de la ligne import', async () => {
    shipmentRef = tag + '-SHIP';
    const shipmentId = id();
    await q("INSERT INTO international_shipments(id,market_id,reference,forwarder_name,transport_mode,stage,created_by) VALUES($1,$2,$3,'Transitaire','sea','local_delivery',$4)",
      [shipmentId, km, shipmentRef, admin]);
    await fixture(async (c) => {
      await c.query("UPDATE hub_physical_units SET state='DISPATCHED' WHERE id=$1", [boxId]);
      await c.query('INSERT INTO international_shipment_hub_units(shipment_id,physical_unit_id) VALUES($1,$2)', [shipmentId, boxId]);
    });
    const out = await relay.receiveShipment({ market, actor: relayAgent, reference: shipmentRef,
      body: { proof_ref: 'BORD-A1', lines: [{ order_item_id: importItem, received_qty: 1 }] } });
    expect(out.complete).toBe(true);
    expect((await q('SELECT status FROM parcels WHERE id=$1', [importParcelId])).rows[0].status).toBe('available');
    expect(await orderStatus()).toBe('available');
  });

  test('les deux retraits aboutissent : un colis par remise, la commande reste retirable jusqu au second', async () => {
    const { collectByPickupCode } = require('../../services/pickup-collection-service');
    const { regenerateCode } = require('../../services/pickup-secret-service');
    const statuses = async () => (await q("SELECT status FROM parcels WHERE order_id=$1 ORDER BY status", [orderId])).rows.map((r) => r.status);
    expect(await statuses()).toEqual(['available', 'available']);
    for (const expectedAfter of [['available', 'collected'], ['collected', 'collected']]) {
      // Le code clair n'est jamais conservé : l'admin en régénère un (procédure de perte) avant chaque remise.
      const issued = await regenerateCode({ orderId, adminId: admin, reason: 'A1 test remise' });
      expect(issued.status).toBe(200);
      const code = issued.body.code;
      const out = await collectByPickupCode({ code, user: relayAgent, expectedOrderId: orderId });
      expect(out.status).toBe(200);
      expect(await statuses()).toEqual(expectedAfter);
    }
    expect(await orderStatus()).toBe('collected');
  });
});
