'use strict';

/**
 * @test-kind integration
 * @test-runner jest
 * @test-requires postgres
 * @integration hub-order-bag-ownership-postgres.test.js
 * @brief #3329 M6 : un sac HANDLING_UNIT ne contient que les allocations de sa commande.
 */
jest.setTimeout(60000);

const crypto = require('crypto');
const db = require('../../db');
const grouped = require('../../services/purchasing-grouped-service');
const engagement = require('../../services/purchasing-engagement-service');
const hubOps = require('../../services/hub-operations');
const { submitAuthorized } = require('../helpers/submit-authorized');

const q = (sql, params) => db.query(sql, params);
const id = () => crypto.randomUUID();
const describeDb = process.env.DATABASE_URL ? describe : describe.skip;

describeDb('Hub V1 — sac client mono-commande (PG réel)', () => {
  const tag = 'HBAG-' + Date.now().toString(36) + '-' + crypto.randomBytes(3).toString('hex');
  let marketId, actorId, supplierId, order1, order2, line1, line2, item1, item2, barcode;
  let sourceUnitId, allocation1, allocation2, bag1Id, bag2Id;

  beforeAll(async () => {
    marketId = (await q("SELECT id FROM markets WHERE code = 'KM'")).rows[0].id;
    actorId = id();
    await q("INSERT INTO users(id,full_name,email,phone,role) VALUES($1,'Hub Bag Test',$2,$3,'admin')",
      [actorId, tag.toLowerCase() + '@komerce.test', '+2693' + String(Date.now()).slice(-7)]);
    const relayId = id();
    await q("INSERT INTO relais(id,name,agent_name,phone,address,market_id) VALUES($1,$2,'A','+2693000002','R',$3)",
      [relayId, 'R-' + tag, marketId]);
    supplierId = id();
    await q("INSERT INTO suppliers(id,name,platform,is_active) VALUES($1,$2,'whatsapp',true)",
      [supplierId, 'S-' + tag]);
    const productId = id(), skuId = id();
    const supplierIdentity = JSON.stringify({ provider: 'whatsapp', version: 1, payload: { supplier_sku: tag + '-SKU' } });
    await q("INSERT INTO products(id,name,price_kmf,cost_kmf,volume_cm3,stock,price_aed,inventory_model) " +
      "VALUES($1,$2,10000,3000,1000,0,100,'SKU')", [productId, 'P-' + tag]);
    await q("INSERT INTO product_skus(id,product_id,sku,stock,is_active,source,supplier_sku,supplier_unit_ref,supplier_order_identity) " +
      "VALUES($1,$2,$3,0,true,'SUPPLIER',$4,$5,$6::jsonb)",
      [skuId, productId, tag + '-SKU', tag + '-SKU', tag + '-UNIT', supplierIdentity]);

    async function seedOrder(reference) {
      const oid = id(), itemId = id(), purchaseLineId = id();
      await q("INSERT INTO orders(id,user_id,relais_id,market_id,reference,status,payment_status,payment_mode,total_kmf,total_eur) " +
        "VALUES($1,$2,$3,$4,$5,'ordered','paid','stripe_eur',10000,20)",
        [oid, actorId, relayId, marketId, reference]);
      await q("INSERT INTO order_items(id,order_id,product_id,quantity,price_kmf,sku_id,fulfillment_source) " +
        "VALUES($1,$2,$3,1,10000,$4,'IMPORT')", [itemId, oid, productId, skuId]);
      await q("INSERT INTO purchase_lines(id,purchase_order_id,order_item_id,supplier_id,product_sku_id,supplier_sku,supplier_unit_ref,supplier_order_identity,quantity,supplier_unit_price,supplier_currency,procurement_hub_ref) " +
        "VALUES($1,NULL,$2,$3,$4,$5,$6,$7::jsonb,1,7,'USD','DXB')",
        [purchaseLineId, itemId, supplierId, skuId, tag + '-SKU', tag + '-UNIT', supplierIdentity]);
      return { oid, purchaseLineId, itemId };
    }

    const first = await seedOrder(tag + '-C1');
    const second = await seedOrder(tag + '-C2');
    order1 = first.oid; order2 = second.oid;
    line1 = first.purchaseLineId; line2 = second.purchaseLineId;
    item1 = first.itemId; item2 = second.itemId;
    barcode = '008899' + String(Date.now());
    await q("INSERT INTO product_sku_physical_codes " +
      "(product_sku_id,supplier_id,code,code_type,trust,printed_on_pack,confirmed_by,confirmed_at,confirmation_proof_ref) " +
      "VALUES($1,$2,$3,'SUPPLIER_BARCODE','CONFIRMED',true,$4,now(),'observation-emballage')",
      [skuId, supplierId, barcode, actorId]);

    const prepared = await grouped.preparePurchaseOrder(
      { supplier_id: supplierId, procurement_hub_ref: 'DXB', line_ids: [line1, line2] },
      { actor: { id: actorId, role: 'admin' } }
    );
    const poId = prepared.purchase_order.id;
    await submitAuthorized(engagement, poId, { actor: { id: actorId, role: 'admin' } });
    const received = await hubOps.receiveSupplierPackageCommand({
      reference: tag + '-IN',
      contents: [{ purchase_order_id: poId, product_sku_id: skuId, quantity: 2 }],
    }, actorId);
    expect(received.status).toBe(201);
    sourceUnitId = received.body.unit.id;
    allocation1 = (await q('SELECT id FROM hub_purchase_allocations WHERE purchase_line_id=$1', [line1])).rows[0].id;
    allocation2 = (await q('SELECT id FROM hub_purchase_allocations WHERE purchase_line_id=$1', [line2])).rows[0].id;
  });

  afterAll(async () => {
    await db.pool.end().catch(() => {});
  });

  test('creation d un sac identifié dédié à une commande', async () => {
    const bag1 = await hubOps.createOperatorUnitCommand({
      unit_type: 'HANDLING_UNIT', order_id: order1, reference: tag + '-SAC1',
      bag_plan: [{ order_item_id: item1, quantity: 1 }],
    }, actorId);
    const bag2 = await hubOps.createOperatorUnitCommand({
      unit_type: 'HANDLING_UNIT', order_id: order2, reference: tag + '-SAC2',
      bag_plan: [{ order_item_id: item2, quantity: 1 }],
    }, actorId);
    expect(bag1.status).toBe(201);
    expect(bag2.status).toBe(201);
    bag1Id = bag1.body.physical_unit.id;
    bag2Id = bag2.body.physical_unit.id;
    expect(bag1.body.label.kind).toBe('KOM-SAC');
    expect(bag1.body.physical_unit.order_id).toBe(order1);
  });


  test('sans preuve de dépôt, la base refuse un placement dans le sac', async () => {
    await expect(q(
      "INSERT INTO hub_physical_unit_placements " +
      "(physical_unit_id,allocation_id,quantity,operation_id,operation_type,created_by) " +
      "VALUES($1,$2,1,$3,'REPACK',$4)",
      [bag1Id, allocation1, id(), actorId]
    )).rejects.toThrow(/HUB_ORDER_BAG_DEPOSIT_EVIDENCE_REQUIRED/);
  });

  test('un mauvais code à la préparation est bloqué avant tout déplacement', async () => {
    const invalid = await hubOps.moveAllocationCommand({
      from_unit_id: sourceUnitId, to_unit_id: bag1Id, allocation_id: allocation1,
      quantity: 1, operation_type: 'REPACK', evidence_method: 'SCAN',
      evidence_code: 'EAN-DIFFERENT',
    }, actorId);
    expect(invalid.status).not.toBe(200);
    expect(invalid.body.code).toMatch(/HUB_ORDER_BAG_SCAN_INVALID|HUB_ORDER_BAG_SCAN_SKU_MISMATCH/);
  });

  test('allocation de commande 1 acceptée dans son propre sac', async () => {
    const result = await hubOps.moveAllocationCommand({
      from_unit_id: sourceUnitId, to_unit_id: bag1Id, allocation_id: allocation1,
      quantity: 1, operation_type: 'REPACK', evidence_method: 'SCAN', evidence_code: barcode,
    }, actorId);
    expect(result.status).toBe(200);
  });

  test('une allocation de commande 2 ne peut pas entrer dans le sac de commande 1', async () => {
    await expect(q(
      "INSERT INTO hub_physical_unit_placements " +
      "(physical_unit_id,allocation_id,quantity,operation_id,operation_type,created_by,evidence_method,evidence_code) " +
      "VALUES($1,$2,1,$3,'REPACK',$4,'SCAN',$5)",
      [bag1Id, allocation2, id(), actorId, barcode]
    )).rejects.toThrow(/HUB_ORDER_BAG_ALLOCATION_MISMATCH/);
    const wrong = await q("SELECT count(*)::int AS n FROM hub_physical_unit_placements " +
      "WHERE physical_unit_id=$1 AND allocation_id=$2 AND removed_at IS NULL",
      [bag1Id, allocation2]);
    expect(wrong.rows[0].n).toBe(0);
  });

  test('un sac affecté à un client ne peut pas changer de propriétaire', async () => {
    await expect(q('UPDATE hub_physical_units SET order_id=$1 WHERE id=$2', [order2, bag1Id]))
      .rejects.toThrow(/HUB_ORDER_BAG_OWNER_IMMUTABLE/);
    await expect(q('UPDATE hub_physical_units SET order_id=NULL WHERE id=$1', [bag1Id]))
      .rejects.toThrow(/HUB_ORDER_BAG_OWNER_IMMUTABLE/);
  });

  test('aucune KOM-BOX ne peut revendiquer un order_id de sac client', async () => {
    const result = await hubOps.createOperatorUnitCommand({
      unit_type: 'MARKET_PARCEL', order_id: order1, reference: tag + '-INVALID',
    }, actorId);
    expect(result.status).toBe(400);
    expect(result.body.code).toBe('HUB_ORDER_BAG_REQUIRES_HANDLING_UNIT');
  });

  test('la commande 2 peut préparer son propre sac avec la quantité restante', async () => {
    const result = await hubOps.moveAllocationCommand({
      from_unit_id: sourceUnitId, to_unit_id: bag2Id, allocation_id: allocation2,
      quantity: 1, operation_type: 'REPACK',
    }, actorId);
    expect(result.status).toBe(200);
    const rows = await q(
      'SELECT p.physical_unit_id, a.order_id FROM hub_physical_unit_placements p ' +
      'JOIN hub_purchase_allocations a ON a.id=p.allocation_id ' +
      'WHERE p.physical_unit_id = ANY($1::uuid[]) AND p.removed_at IS NULL ORDER BY p.physical_unit_id',
      [[bag1Id, bag2Id]]
    );
    expect(rows.rows).toEqual(expect.arrayContaining([
      { physical_unit_id: bag1Id, order_id: order1 },
      { physical_unit_id: bag2Id, order_id: order2 },
    ]));
  });  test('fermeture du sac uniquement avec plan et preuves conformes', async () => {
    for (const unitId of [bag1Id, bag2Id]) {
      for (const stage of ['IDENTIFIED', 'QUALITY_CHECKED', 'LOCATED', 'ALLOCATED', 'PICKED']) {
        const transition = await hubOps.transitionOperatorUnitCommand({
          unit_id: unitId, to_state: stage, location_ref: 'HUB-DXB-PREPARATION',
        }, actorId);
        expect(transition.status).toBe(200);
      }
      const close = await hubOps.transitionOperatorUnitCommand({
        unit_id: unitId, to_state: 'PACKED', location_ref: 'HUB-DXB-SACS',
      }, actorId);
      expect(close.status).toBe(200);
    }
  });

  test('plan de sac figé et fermeture sans plan interdites', async () => {
    await expect(q(
      'UPDATE hub_physical_units SET bag_plan=$1::jsonb WHERE id=$2',
      [JSON.stringify([{ order_item_id: item1, quantity: 2 }]), bag1Id]
    )).rejects.toThrow(/HUB_ORDER_BAG_PLAN_IMMUTABLE/);

    const emptyPlan = await hubOps.createOperatorUnitCommand({
      unit_type: 'HANDLING_UNIT', order_id: order1,
      reference: tag + '-NO-PLAN',
    }, actorId);
    expect(emptyPlan.status).toBe(201);
    const bagId = emptyPlan.body.physical_unit.id;
    for (const stage of ['IDENTIFIED', 'QUALITY_CHECKED', 'LOCATED', 'ALLOCATED', 'PICKED']) {
      await hubOps.transitionOperatorUnitCommand({ unit_id: bagId, to_state: stage }, actorId);
    }
    const closed = await hubOps.transitionOperatorUnitCommand({
      unit_id: bagId, to_state: 'PACKED',
    }, actorId);
    expect(closed.status).not.toBe(200);
  });


});
