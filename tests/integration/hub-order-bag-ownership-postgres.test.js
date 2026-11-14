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
const bagBox = require('../../services/hub-bag-box-service');
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
      contents: [{ purchase_order_id: poId, product_sku_id: skuId, quantity: 2, evidence_code: barcode }],
    }, actorId);
    expect(received.status).toBe(201);
    sourceUnitId = received.body.unit.id;
    const {rows:[proof]}=await q(
      "SELECT count(*)::int AS lines, count(*) FILTER (WHERE evidence_method='SCAN' AND evidence_code=$2)::int AS scans " +
      "FROM hub_physical_unit_placements WHERE physical_unit_id=$1 AND operation_type='RECEIVE'",
      [sourceUnitId,barcode]);
    expect(proof).toEqual({lines:2,scans:2});
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
      quantity: 1, operation_type: 'REPACK', evidence_method: 'SCAN', evidence_code: barcode,
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

  test('M7 : deux sacs scellés restent intacts dans une KOM-BOX, avec preuve du colis relais', async () => {
    // H1 / HB-03 : la réception a déjà réparti les articles en colis clients.
    // Le test doit réutiliser cette preuve canonique, pas créer un deuxième colis par article
    // (le garde unique_order_item_per_parcel refuserait légitimement ce doublon).
    const { rows: [firstParcel] } = await q(
      'SELECT p.id, pi.id AS parcel_item_id FROM parcels p JOIN parcel_items pi ON pi.parcel_id=p.id WHERE p.order_id=$1 AND pi.order_item_id=$2',
      [order1, item1]);
    const { rows: [secondParcel] } = await q(
      'SELECT p.id, pi.id AS parcel_item_id FROM parcels p JOIN parcel_items pi ON pi.parcel_id=p.id WHERE p.order_id=$1 AND pi.order_item_id=$2',
      [order2, item2]);
    expect(firstParcel).toBeDefined();
    expect(secondParcel).toBeDefined();
    const parcel1 = firstParcel.id, parcel2 = secondParcel.id;
    const pi1 = firstParcel.parcel_item_id, pi2 = secondParcel.parcel_item_id;
    expect(parcel1).not.toBe(parcel2);

    const newBox = await hubOps.createOperatorUnitCommand({
      unit_type: 'MARKET_PARCEL', reference: tag + '-BOX',
    }, actorId);
    expect(newBox.status).toBe(201);
    const boxId = newBox.body.physical_unit.id;
    for (const stage of ['IDENTIFIED','QUALITY_CHECKED','LOCATED','ALLOCATED','PICKED']) {
      const t = await hubOps.transitionOperatorUnitCommand({ unit_id: boxId, to_state:stage }, actorId);
      expect(t.status).toBe(200);
    }

    // Les identifiants scannés et le colis client doivent concorder.
    await expect(bagBox.attachBagToBox({
      bagUnitId:bag1Id,boxUnitId:boxId,parcelId:parcel1,
      evidenceMethod:'SCAN',bagReferenceScan:tag+'-FAUX',boxReferenceScan:tag+'-BOX',
      expectedMarketId:marketId,actorId,
    })).rejects.toMatchObject({code:'HUB_BOX_BAG_SCAN_MISMATCH'});
    await expect(bagBox.attachBagToBox({
      bagUnitId:bag1Id,boxUnitId:boxId,parcelId:parcel2,
      evidenceMethod:'SCAN',bagReferenceScan:tag+'-SAC1',boxReferenceScan:tag+'-BOX',
      expectedMarketId:marketId,actorId,
    })).rejects.toMatchObject({code:'HUB_BOX_BAG_PARCEL_ORDER_MISMATCH'});

    // C5/H9 : deux opérateurs tentent simultanément le même sac dans la même KOM-BOX.
    // Chaque appel ouvre une transaction indépendante via db.withTransaction.
    const sameBag = () => bagBox.attachBagToBox({
      bagUnitId: bag1Id, boxUnitId: boxId, parcelId: parcel1,
      evidenceMethod:'SCAN',bagReferenceScan:tag + '-SAC1', boxReferenceScan: tag + '-BOX',
      expectedMarketId: marketId, actorId,
    });
    const concurrent = await Promise.allSettled([sameBag(), sameBag()]);
    const accepted = concurrent.filter(r => r.status === 'fulfilled').map(r => r.value);
    const refused = concurrent.filter(r => r.status === 'rejected').map(r => r.reason);
    expect(accepted.filter(r => r.already_linked === false)).toHaveLength(1);
    expect(accepted.every(r => r.already_linked === false || r.already_linked === true)).toBe(true);
    for (const error of refused) {
      expect(error).toMatchObject({ status: 409, code: 'HUB_BAG_ALREADY_BOXED' });
    }
    const { rows: [c5] } = await q(
      'SELECT COUNT(*)::int AS n FROM hub_box_bags WHERE bag_unit_id=$1', [bag1Id]
    );
    expect(c5.n).toBe(1);
    const second = await bagBox.attachBagToBox({
      bagUnitId: bag2Id, boxUnitId: boxId, parcelId: parcel2,
      evidenceMethod:'MANUAL',evidenceRef:'Constat clavier : étiquette abîmée',
      bagReferenceScan:tag + '-SAC2', boxReferenceScan: tag + '-BOX',
      expectedMarketId: marketId, actorId,
    });
    expect(second.already_linked).toBe(false);
    // Provenance réelle conservée : le scanner et la saisie manuelle ne se confondent jamais.
    const {rows:provenance}=await q(
      'SELECT bag_unit_id,evidence_method,evidence_ref FROM hub_box_bags WHERE box_unit_id=$1',[boxId]);
    const byBag=new Map(provenance.map(r=>[String(r.bag_unit_id),r]));
    expect(byBag.get(String(bag1Id))).toMatchObject({evidence_method:'SCAN',evidence_ref:null});
    expect(byBag.get(String(bag2Id))).toMatchObject({
      evidence_method:'MANUAL',evidence_ref:'Constat clavier : étiquette abîmée'});

    // La preuve physique est conservée dans CHAQUE sac ; aucun MOVE ni SUPERSEDED.
    const { rows: bags } = await q('SELECT id,state,order_id FROM hub_physical_units WHERE id=ANY($1::uuid[]) ORDER BY id',[[bag1Id,bag2Id]]);
    expect(bags).toHaveLength(2);
    expect(bags.map(b=>b.state)).toEqual(['PACKED','PACKED']);
    const {rows:[boxQuantities]}=await q(
      'SELECT count(*)::int AS lines, sum(quantity)::int AS qty FROM hub_box_effective_placements WHERE box_unit_id=$1',[boxId]
    );
    expect(boxQuantities).toEqual({lines:2,qty:2});
    const {rows:parcelQuantities}=await q(
      'SELECT order_item_id,qty_allocated,qty_packed,qty_shipped FROM parcel_items WHERE id=ANY($1::uuid[]) ORDER BY order_item_id',[[pi1,pi2]]
    );
    expect(parcelQuantities).toHaveLength(2);
    expect(parcelQuantities.map(p=>p.qty_packed)).toEqual([1,1]);
    expect(parcelQuantities.map(p=>p.qty_shipped)).toEqual([0,0]);

    const seal=await hubOps.transitionOperatorUnitCommand({unit_id:boxId,to_state:'PACKED'},actorId);
    expect(seal.status).toBe(200);
    const {rows:[packed]}=await q('SELECT state,market_id FROM hub_physical_units WHERE id=$1',[boxId]);
    expect(packed.state).toBe('PACKED');
    expect(packed.market_id).toBe(marketId);

    const replay=await bagBox.attachBagToBox({
      bagUnitId:bag1Id,boxUnitId:boxId,parcelId:parcel1,
      evidenceMethod:'SCAN',bagReferenceScan:tag+'-SAC1',boxReferenceScan:tag+'-BOX',expectedMarketId:marketId,actorId,
    });
    expect(replay.already_linked).toBe(true);
    const {rows:[still]}=await q('SELECT COUNT(*)::int AS n FROM hub_box_bags WHERE box_unit_id=$1',[boxId]);
    expect(still.n).toBe(2);
    const {rows:[placement]}=await q(
      'SELECT id FROM hub_physical_unit_placements WHERE physical_unit_id=$1 AND removed_at IS NULL LIMIT 1',
      [bag1Id]);
    await expect(q('UPDATE hub_physical_unit_placements SET removed_at=now() WHERE id=$1',
      [placement.id])).rejects.toThrow(/HUB_ORDER_BAG_SEALED_CONTENT_IMMUTABLE/);
    // Une nouvelle preuve ne peut pas être insérée dans le sac fermé.
    await expect(q(
      "INSERT INTO hub_physical_unit_placements " +
      "(physical_unit_id,allocation_id,quantity,operation_id,operation_type,created_by,evidence_method,evidence_code) " +
      "VALUES($1,$2,1,$3,'REPACK',$4,'SCAN',$5)",
      [bag1Id,allocation1,id(),actorId,barcode]
    )).rejects.toThrow(/HUB_ORDER_BAG_SEALED_CONTENT_IMMUTABLE/);
  });



});
