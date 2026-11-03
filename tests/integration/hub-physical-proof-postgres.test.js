'use strict';

/**
 * @test-kind integration
 * @test-runner jest
 * @test-requires postgres
 * @integration hub-physical-proof-postgres.test.js
 * @brief HUB lot 2 — une seule vérité physique : le colis client (parcel_items) d'un article d'import est dérivé des réceptions Hub et des placements en KOM-BOX ; aucune quantité affectée/emballée/expédiée sans preuve, expédié <= placé <= reçu.
 */

jest.setTimeout(60000);

const crypto = require('crypto');
const db = require('../../db');
const grouped = require('../../services/purchasing-grouped-service');
const engagement = require('../../services/purchasing-engagement-service');
const hubOps = require('../../services/hub-operations');

const hasDb = Boolean(process.env.DATABASE_URL);
const describeDb = hasDb ? describe : describe.skip;
const id = () => crypto.randomUUID();
const q = (sql, params) => db.query(sql, params);

describeDb('Hub lot 2 — preuve physique des quantités du colis client (REAL_DB)', () => {
  const tag = `HP2-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`;
  let km; let admin; let relais; let supplier; let sku; let orderId; let itemId; let parcelId; let parcelItemId; let po; let lineId;

  const qtys = async () => (await q('SELECT qty_allocated, qty_packed, qty_shipped FROM parcel_items WHERE id=$1', [parcelItemId])).rows[0];
  const advance = async (unitId, states) => {
    for (const st of states) {
      const res = await hubOps.transitionOperatorUnitCommand({ unit_id: unitId, to_state: st, location_ref: 'HUB-DXB-A1' }, admin);
      expect(res.status).toBe(200);
    }
  };
  const QC = ['IDENTIFIED', 'QUALITY_CHECKED', 'LOCATED', 'ALLOCATED', 'PICKED'];

  beforeAll(async () => {
    km = (await q("SELECT id FROM markets WHERE code='KM'")).rows[0].id;
    admin = id();
    await q("INSERT INTO users(id,full_name,email,phone,role) VALUES($1,'HP2 Admin',$2,$3,'admin')", [admin, `${tag.toLowerCase()}@komerce.test`, `+2693${String(Date.now()).slice(-7)}`]);
    relais = id();
    await q("INSERT INTO relais(id,name,agent_name,phone,address,market_id) VALUES($1,$2,'A','+2693000002','R',$3)", [relais, `R-${tag}`, km]);
    supplier = id();
    await q("INSERT INTO suppliers(id,name,platform,is_active) VALUES($1,$2,'whatsapp',true)", [supplier, `F ${tag}`]);
    const productId = id(); const skuId = id();
    const identity = { provider: 'whatsapp', version: 1, payload: { supplier_sku: `${tag}-S` } };
    await q(`INSERT INTO products(id,name,price_kmf,cost_kmf,volume_cm3,stock,price_aed,inventory_model) VALUES($1,$2,10000,3000,1000,0,100,'SKU')`, [productId, `P ${tag}`]);
    await q(`INSERT INTO product_skus(id,product_id,sku,stock,is_active,source,supplier_sku,supplier_unit_ref,supplier_order_identity)
             VALUES($1,$2,$3,0,true,'SUPPLIER',$4,$5,$6::jsonb)`, [skuId, productId, `${tag}-SKU`, identity.payload.supplier_sku, `${tag}-U`, JSON.stringify(identity)]);
    sku = { id: skuId, productId, identity: JSON.stringify(identity) };

    orderId = id(); itemId = id(); lineId = id(); parcelId = id(); parcelItemId = id();
    await q(`INSERT INTO orders(id,user_id,relais_id,market_id,reference,status,payment_status,payment_mode,total_kmf,total_eur)
             VALUES($1,$2,$3,$4,$5,'ordered','paid','stripe_eur',10000,20)`, [orderId, admin, relais, km, `${tag}-O`]);
    await q(`INSERT INTO order_items(id,order_id,product_id,quantity,price_kmf,sku_id,fulfillment_source) VALUES($1,$2,$3,5,10000,$4,'IMPORT')`, [itemId, orderId, productId, skuId]);
    await q(`INSERT INTO purchase_lines(id,purchase_order_id,order_item_id,supplier_id,product_sku_id,supplier_sku,supplier_unit_ref,supplier_order_identity,quantity,supplier_unit_price,supplier_currency,procurement_hub_ref)
             VALUES($1,NULL,$2,$3,$4,$5,$6,$7::jsonb,5,7,'USD','DXB')`, [lineId, itemId, supplier, skuId, `${tag}-S`, `${tag}-U`, sku.identity]);
    // Colis client créé AVANT toute réception, comme à l'encaissement : aucune quantité préremplie.
    await q(`INSERT INTO parcels(id,order_id,reference,status) VALUES($1,$2,$3,'preparation')`, [parcelId, orderId, `${tag}-PCL`]);
    await q(`INSERT INTO parcel_items(id,parcel_id,order_item_id,product_id,quantity) VALUES($1,$2,$3,$4,5)`, [parcelItemId, parcelId, itemId, productId]);
  });
  afterAll(async () => { await db.pool.end().catch(() => {}); });

  test('avant toute réception : rien affecté, et une écriture sans preuve est refusée par la base', async () => {
    expect(await qtys()).toEqual({ qty_allocated: 0, qty_packed: 0, qty_shipped: 0 });
    await expect(q('UPDATE parcel_items SET qty_allocated = 1 WHERE id=$1', [parcelItemId])).rejects.toThrow(/parcel_item_no_physical_proof/);
    await expect(q('UPDATE parcel_items SET qty_allocated = 5, qty_packed = 5 WHERE id=$1', [parcelItemId])).rejects.toThrow(/parcel_item_no_physical_proof/);
  });

  test('réception partielle : affecté = reçu (3 sur 5), emballé encore 0', async () => {
    po = (await grouped.preparePurchaseOrder({ supplier_id: supplier, procurement_hub_ref: 'DXB', line_ids: [lineId] }, { actor: { id: admin, role: 'admin' } })).purchase_order.id;
    await engagement.submitPurchaseOrder(po, { actor: { id: admin, role: 'admin' } });
    const r = await hubOps.receiveSupplierPackageCommand({ reference: `${tag}-COLIS`, location_ref: 'HUB-DXB-RECEIVE', contents: [{ purchase_order_id: po, product_sku_id: sku.id, quantity: 3 }] }, admin);
    expect(r.status).toBe(201);
    global.__unit = r.body.unit.id;
    expect(await qtys()).toEqual({ qty_allocated: 3, qty_packed: 0, qty_shipped: 0 });
    await expect(q('UPDATE parcel_items SET qty_allocated = 4 WHERE id=$1', [parcelItemId])).rejects.toThrow(/parcel_item_no_physical_proof/);
  });

  test('placement en KOM-BOX : emballé = placé (2 sur 3 reçus) ; expédié ne dépasse jamais le placé', async () => {
    await advance(global.__unit, QC);
    const mk = await hubOps.createOperatorUnitCommand({ unit_type: 'MARKET_PARCEL', reference: `${tag}-BOX`, location_ref: 'HUB-DXB-PACK' }, admin);
    expect(mk.status).toBe(201);
    const boxId = mk.body.physical_unit.id;
    await advance(boxId, QC);
    const alloc = (await q('SELECT id FROM hub_purchase_allocations WHERE purchase_line_id=$1', [lineId])).rows[0].id;
    const mv = await hubOps.moveAllocationCommand({ from_unit_id: global.__unit, to_unit_id: boxId, allocation_id: alloc, quantity: 2, operation_type: 'REPACK' }, admin);
    expect(mv.status).toBe(200);
    expect(await qtys()).toEqual({ qty_allocated: 3, qty_packed: 2, qty_shipped: 0 });
    await expect(q('UPDATE parcel_items SET qty_packed = 3 WHERE id=$1', [parcelItemId])).rejects.toThrow(/parcel_item_no_physical_proof/);
    await expect(q('UPDATE parcel_items SET qty_shipped = 3 WHERE id=$1', [parcelItemId])).rejects.toThrow(/qty_shipped/);
    await q('UPDATE parcel_items SET qty_shipped = 2 WHERE id=$1', [parcelItemId]);
    expect(await qtys()).toEqual({ qty_allocated: 3, qty_packed: 2, qty_shipped: 2 });
  });

  test('hors import (stock local) : circuit direct relais, aucune preuve Hub exigée', async () => {
    const o = id(); const it = id(); const pc = id(); const pi = id();
    await q(`INSERT INTO orders(id,user_id,relais_id,market_id,reference,status,payment_status,payment_mode,total_kmf,total_eur)
             VALUES($1,$2,$3,$4,$5,'ordered','paid','stripe_eur',10000,20)`, [o, admin, relais, km, `${tag}-OL`]);
    await q(`INSERT INTO order_items(id,order_id,product_id,quantity,price_kmf,sku_id,fulfillment_source) VALUES($1,$2,$3,2,10000,$4,'LOCAL_STOCK')`, [it, o, sku.productId, sku.id]);
    await q(`INSERT INTO parcels(id,order_id,reference,status) VALUES($1,$2,$3,'preparation')`, [pc, o, `${tag}-PCL2`]);
    await q(`INSERT INTO parcel_items(id,parcel_id,order_item_id,product_id,quantity,qty_allocated,qty_packed) VALUES($1,$2,$3,$4,2,2,2)`, [pi, pc, it, sku.productId]);
    expect((await q('SELECT qty_packed FROM parcel_items WHERE id=$1', [pi])).rows[0].qty_packed).toBe(2);
  });
});
