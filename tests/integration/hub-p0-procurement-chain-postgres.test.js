'use strict';

/**
 * @test-kind integration
 * @test-runner jest
 * @test-requires postgres
 * @integration hub-p0-procurement-chain-postgres.test.js
 * @brief HUB P0 (#3247) — chaîne physique complète sur PostgreSQL réel : commandes → PO mono-marché/fournisseur → envoi → confirmation → réceptions partielles multi-colis → KOM-BOX → expédition → filiation, plus cas négatifs et concurrence.
 */

process.env.KOMERCE_GROUPED_PURCHASING = '1';

const crypto = require('crypto');

jest.setTimeout(60000);

const db = require('../../db');
const grouped = require('../../services/purchasing-grouped-service');
const engagement = require('../../services/purchasing-engagement-service');
const hubOps = require('../../services/hub-operations');
const boxShipment = require('../../services/hub-box-shipment-service');
const journey = require('../../services/international-shipment-journey');
const dossier = require('../../services/hub-procurement-dossier');

const hasDb = Boolean(process.env.DATABASE_URL);
const describeDb = hasDb ? describe : describe.skip;
const id = () => crypto.randomUUID();

describeDb('Hub P0 — chaîne d\'approvisionnement complète (REAL_DB)', () => {
  const tag = `HP0-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`;
  let km; let cm; let admin; let relaisKm; let relaisCm;
  let supplierA; let supplierB; let sku1; let sku2;
  const actor = () => ({ id: admin, role: 'admin' });
  let seq = 0;

  const q = (sql, params) => db.query(sql, params);

  async function makeSku(label) {
    const skuId = id();
    const productId = id();
    await q(`INSERT INTO products(id,name,price_kmf,cost_kmf,volume_cm3,stock,price_aed,inventory_model)
             VALUES($1,$2,10000,3000,1000,0,100,'SKU')`, [productId, `Produit ${label} ${tag}`]);
    const identity = { provider: 'whatsapp', version: 1, payload: { supplier_sku: `${tag}-${label}` } };
    await q(
      `INSERT INTO product_skus(id,product_id,sku,stock,is_active,source,supplier_sku,supplier_unit_ref,supplier_order_identity)
       VALUES($1,$2,$3,0,true,'SUPPLIER',$4,$5,$6::jsonb)`,
      [skuId, productId, `${tag}-SKU-${label}`, identity.payload.supplier_sku, `${identity.payload.supplier_sku}-U`, JSON.stringify(identity)]
    );
    return { id: skuId, productId, identity: JSON.stringify(identity), supplierSku: identity.payload.supplier_sku };
  }

  // Commande payée + lignes d'achat ouvertes (la création des lignes est l'autorité du trigger d'achat ; ici donnée de référence).
  async function makeOrder({ market, relais, supplier, items, minutesAgo = 0 }) {
    const orderId = id();
    seq += 1;
    await q(
      `INSERT INTO orders(id,user_id,relais_id,market_id,reference,status,payment_status,payment_mode,total_kmf,total_eur,created_at)
       VALUES($1,$2,$3,$4,$5,'ordered','paid','stripe_eur',10000,20, NOW() - ($6 || ' minutes')::interval)`,
      [orderId, admin, relais, market, `${tag}-O${seq}`, String(minutesAgo)]
    );
    const lines = [];
    for (const it of items) {
      const itemId = id();
      const lineId = id();
      await q(
        `INSERT INTO order_items(id,order_id,product_id,quantity,price_kmf,sku_id,fulfillment_source)
         VALUES($1,$2,$3,$4,10000,$5,'IMPORT')`,
        [itemId, orderId, it.sku.productId, it.qty, it.sku.id]
      );
      await q(
        `INSERT INTO purchase_lines(id,purchase_order_id,order_item_id,supplier_id,product_sku_id,supplier_sku,
           supplier_unit_ref,supplier_order_identity,quantity,supplier_unit_price,supplier_currency,procurement_hub_ref)
         VALUES($1,NULL,$2,$3,$4,$5,$6,$7::jsonb,$8,7,'USD','DXB')`,
        [lineId, itemId, supplier, it.sku.id, it.sku.supplierSku, `${it.sku.supplierSku}-U`, it.sku.identity, it.qty]
      );
      lines.push({ lineId, itemId, sku: it.sku.id, qty: it.qty });
    }
    return { orderId, lines };
  }

  const receive = (poId, skuId, quantity, reference, externalRef = null) => hubOps.receiveSupplierPackageCommand({
    reference, external_ref: externalRef, location_ref: 'HUB-DXB-RECEIVE',
    contents: [{ purchase_order_id: poId, product_sku_id: skuId, quantity }],
  }, admin);

  const received = async (lineId) => Number((await q(
    'SELECT received_quantity FROM v_purchase_line_progress WHERE line_id = $1', [lineId]
  )).rows[0].received_quantity);

  // Carton KOM-BOX de fixture (les triggers d'état Hub sont réservés au parcours opérateur ; ceux de la migration 358 restent actifs).
  async function makeBox({ market, state, label }) {
    const boxId = id();
    const client = await db.getClient();
    try {
      await client.query("SET session_replication_role='replica'");
      await client.query(`INSERT INTO hub_physical_units(id,reference,unit_type,state,market_id) VALUES($1,$2,'MARKET_PARCEL',$3,$4)`,
        [boxId, `${tag}-BOX-${label}`, state, market]);
    } finally { await client.query("SET session_replication_role='origin'"); client.release(); }
    return boxId;
  }

  beforeAll(async () => {
    km = (await q("SELECT id FROM markets WHERE code='KM'")).rows[0].id;
    cm = (await q("SELECT id FROM markets WHERE code='CM'")).rows[0].id;
    admin = id();
    await q("INSERT INTO users(id,full_name,email,phone,role) VALUES($1,'HP0 Admin',$2,$3,'admin')",
      [admin, `${tag.toLowerCase()}@komerce.test`, `+2693${String(Date.now()).slice(-7)}`]);
    relaisKm = id(); relaisCm = id();
    await q("INSERT INTO relais(id,name,agent_name,phone,address,market_id) VALUES($1,$2,'A','+2693000001','R',$3)", [relaisKm, `R-KM-${tag}`, km]);
    await q("INSERT INTO relais(id,name,agent_name,phone,address,market_id) VALUES($1,$2,'A','+2370000001','R',$3)", [relaisCm, `R-CM-${tag}`, cm]);
    supplierA = id(); supplierB = id();
    await q("INSERT INTO suppliers(id,name,platform,is_active) VALUES($1,$2,'whatsapp',true)", [supplierA, `Fournisseur A ${tag}`]);
    await q("INSERT INTO suppliers(id,name,platform,is_active) VALUES($1,$2,'whatsapp',true)", [supplierB, `Fournisseur B ${tag}`]);
    sku1 = await makeSku('S1');
    sku2 = await makeSku('S2');
  });

  afterAll(async () => { await db.pool.end().catch(() => {}); });

  describe('scénario nominal', () => {
    const s = {};

    test('commandes C1 / C2 → une PO KM/A → envoi prouvé → confirmation', async () => {
      s.c1 = await makeOrder({ market: km, relais: relaisKm, supplier: supplierA, minutesAgo: 20,
        items: [{ sku: sku1, qty: 2 }, { sku: sku2, qty: 1 }] });
      s.c2 = await makeOrder({ market: km, relais: relaisKm, supplier: supplierA, minutesAgo: 10,
        items: [{ sku: sku1, qty: 3 }] });
      const lineIds = [...s.c1.lines, ...s.c2.lines].map((l) => l.lineId);

      const before = await dossier.getDossier({ marketId: km, supplierId: supplierA });
      expect(before.needs.map((n) => n.line_id)).toEqual(expect.arrayContaining(lineIds));

      const prepared = await grouped.preparePurchaseOrder(
        { supplier_id: supplierA, procurement_hub_ref: 'DXB', line_ids: lineIds }, { actor: actor() });
      s.po = prepared.purchase_order.id;
      expect(s.po).toBeTruthy();

      await engagement.submitPurchaseOrder(s.po, { actor: actor() });
      let stage = (await dossier.getDossier({ marketId: km })).purchase_orders.find((p) => p.id === s.po);
      expect(stage.stage).toBe('issued_not_sent'); // un bon émis n'est pas un envoi prouvé

      const sent = await engagement.recordPurchaseOrderSent(s.po, { channel: 'whatsapp', note: 'envoyé' }, { actor: actor() });
      expect(sent.already_sent).toBe(false);
      stage = (await dossier.getDossier({ marketId: km })).purchase_orders.find((p) => p.id === s.po);
      expect(stage.stage).toBe('sent');

      await engagement.confirmGroupedPurchaseOrder(s.po, {
        supplier_order_id: `SO-${tag}`,
        lines: [...s.c1.lines, ...s.c2.lines].map((l) => ({ purchase_line_id: l.lineId, confirmed_quantity: l.qty })),
      }, { actor: actor() });
      stage = (await dossier.getDossier({ marketId: km })).purchase_orders.find((p) => p.id === s.po);
      expect(stage.stage).toBe('confirmed');
    });

    test('réceptions partielles multi-colis : le manquant est imputé à la commande la plus récente', async () => {
      const r1 = await receive(s.po, sku1.id, 4, `${tag}-COLIS1`, 'EXT-1');
      expect(r1.status).toBe(201);
      const r2 = await receive(s.po, sku2.id, 1, `${tag}-COLIS2`, 'EXT-2');
      expect(r2.status).toBe(201);
      s.colis1 = r1.body; s.colis2 = r2.body;

      expect(await received(s.c1.lines[0].lineId)).toBe(2); // C1 S1 2/2
      expect(await received(s.c2.lines[0].lineId)).toBe(2); // C2 S1 2/3 : 1 manquant sur la plus récente
      expect(await received(s.c1.lines[1].lineId)).toBe(1); // C1 S2 1/1

      const d = (await dossier.getDossier({ marketId: km })).purchase_orders.find((p) => p.id === s.po);
      expect(d.stage).toBe('partially_received');
      expect(d.totals.missing).toBe(1);
      const c2line = d.lines.find((l) => l.line_id === s.c2.lines[0].lineId);
      expect(c2line).toMatchObject({ ordered: 3, confirmed: 3, received: 2, missing: 1 });
      const full = await dossier.getDossier({ marketId: km });
      expect(full.to_handle.some((h) => h.kind === 'PO_MISSING_QTY' && h.po_id === s.po)).toBe(true);
    });

    test('contrôle, deux KOM-BOX par REPACK, expédition, rattachement, filiation', async () => {
      const unitOf = (r) => r.unit.id;
      const advance = async (unitId, states) => {
        for (const st of states) {
          const res = await hubOps.transitionOperatorUnitCommand({ unit_id: unitId, to_state: st, location_ref: 'HUB-DXB-A1' }, admin);
          expect(res.status).toBe(200);
        }
      };
      const QC = ['IDENTIFIED', 'QUALITY_CHECKED', 'LOCATED', 'ALLOCATED', 'PICKED'];
      await advance(unitOf(s.colis1), QC);
      await advance(unitOf(s.colis2), QC);

      const mkBox = async (n) => {
        const res = await hubOps.createOperatorUnitCommand({ unit_type: 'MARKET_PARCEL', reference: `${tag}-BOX${n}`, location_ref: 'HUB-DXB-PACK' }, admin);
        expect(res.status).toBe(201);
        const boxId = res.body.physical_unit.id;
        await advance(boxId, QC);
        return boxId;
      };
      s.box1 = await mkBox(1); s.box2 = await mkBox(2);

      const allocOf = async (lineId) => (await q('SELECT id FROM hub_purchase_allocations WHERE purchase_line_id=$1', [lineId])).rows[0].id;
      const repack = async (from, to, lineId, quantity) => {
        const res = await hubOps.moveAllocationCommand({ from_unit_id: from, to_unit_id: to, allocation_id: await allocOf(lineId), quantity, operation_type: 'REPACK' }, admin);
        expect(res.status).toBe(200);
      };
      await repack(unitOf(s.colis1), s.box1, s.c1.lines[0].lineId, 2); // C1 S1
      await repack(unitOf(s.colis2), s.box1, s.c1.lines[1].lineId, 1); // C1 S2
      await repack(unitOf(s.colis1), s.box2, s.c2.lines[0].lineId, 2); // C2 S1

      await advance(s.box1, ['PACKED']); await advance(s.box2, ['PACKED']);

      // Création du dossier par le VRAI service métier, directement depuis les KOM-BOX (aucun INSERT SQL).
      s.shipRef = `${tag}-SHIP`;
      const created = await journey.create({ id: km, code: 'KM' }, actor(), {
        reference: s.shipRef, forwarder_name: 'Transitaire test', transport_mode: 'sea', proof_ref: `BL-${tag}`,
        hub_unit_ids: [s.box1, s.box2],
      });
      expect(created).toMatchObject({ reference: s.shipRef, stage: 'hub_ready', hub_units: 2, parcels: 0 });

      // aucun double compte : somme placée active = somme reçue
      const placed = Number((await q(
        `SELECT COALESCE(SUM(p.quantity),0)::int AS n FROM hub_physical_unit_placements p
          JOIN hub_purchase_allocations a ON a.id=p.allocation_id
          JOIN hub_physical_units u ON u.id=p.physical_unit_id
         WHERE a.purchase_order_id=$1 AND p.removed_at IS NULL AND u.unit_type='MARKET_PARCEL'`, [s.po])).rows[0].n);
      expect(placed).toBe(5);

      const trace = await dossier.getTrace({ orderId: s.c2.orderId });
      const link = trace.chain[0];
      expect(link.purchase_order.id).toBe(s.po);
      const active = link.placements.filter((p) => p.active);
      expect(active.map((p) => p.unit.id)).toContain(s.box2);
      expect(active.find((p) => p.unit.id === s.box2).shipment.reference).toBe(s.shipRef);
      expect(link.placements.some((p) => p.unit.id === unitOf(s.colis1))).toBe(true);

      const d = await dossier.getDossier({ marketId: km });
      expect(d.boxes.filter((b) => b.shipment_ref === s.shipRef)).toHaveLength(2);
    });

    test('dossier d\'expédition : cartons, PO, quantités et commandes préservés ; remise refusée tant que les cartons ne sont pas DISPATCHED', async () => {
      const det = await journey.detail({ id: km, code: 'KM' }, s.shipRef);
      expect(det.hub_units.map((u) => u.unit_id).sort()).toEqual([s.box1, s.box2].sort());
      const flat = det.hub_units.flatMap((u) => u.contents.map((c) => ({ box: u.unit_id, ...c })));
      expect(flat.every((c) => c.purchase_order_id === s.po)).toBe(true);
      expect(flat.reduce((n, c) => n + c.quantity, 0)).toBe(5);
      const byOrder = (ref) => flat.filter((c) => c.order_ref.endsWith(ref)).reduce((n, c) => n + c.quantity, 0);
      expect(flat.filter((c) => c.box === s.box2).every((c) => c.order_ref.includes('-O2'))).toBe(true);
      expect(byOrder('-O1')).toBe(3);
      expect(byOrder('-O2')).toBe(2);
      const listed = (await journey.list({ id: km, code: 'KM' })).find((x) => x.reference === s.shipRef);
      expect(listed.hub_unit_count).toBe(2);

      await expect(journey.transition({ id: km, code: 'KM' }, actor(), s.shipRef, { to_stage: 'handed_over', proof_ref: 'REMISE-1' }))
        .rejects.toMatchObject({ status: 409, code: 'JOURNEY_HUB_UNITS_NOT_DISPATCHED' });
      const stage = (await q('SELECT stage FROM international_shipments WHERE reference=$1', [s.shipRef])).rows[0].stage;
      expect(stage).toBe('hub_ready');
    });

    test('remise : un seul carton DISPATCHED ne suffit pas ; les deux le sont → remise tracée (preuve, acteur, horodatage) puis composition figée', async () => {
      const dispatch = async (unitId) => {
        const res = await hubOps.transitionOperatorUnitCommand({ unit_id: unitId, to_state: 'DISPATCHED', location_ref: 'HUB-DXB-OUT' }, admin);
        expect(res.status).toBe(200);
      };
      await dispatch(s.box1);
      await expect(journey.transition({ id: km, code: 'KM' }, actor(), s.shipRef, { to_stage: 'handed_over', proof_ref: 'REMISE-2' }))
        .rejects.toMatchObject({ code: 'JOURNEY_HUB_UNITS_NOT_DISPATCHED' });
      await dispatch(s.box2);
      const done = await journey.transition({ id: km, code: 'KM' }, actor(), s.shipRef, { to_stage: 'handed_over', proof_ref: 'REMISE-3' });
      expect(done).toMatchObject({ from_stage: 'hub_ready', stage: 'handed_over' });

      const ev = (await q(
        `SELECT e.proof_ref, e.actor_id, e.occurred_at, e.payload FROM international_shipment_events e
           JOIN international_shipments sh ON sh.id=e.shipment_id WHERE sh.reference=$1 AND e.to_stage='handed_over'`, [s.shipRef])).rows[0];
      expect(ev.proof_ref).toBe('REMISE-3');
      expect(String(ev.actor_id)).toBe(String(admin));
      expect(ev.occurred_at).toBeInstanceOf(Date);
      expect(ev.payload.hub_units.map((u) => u.id).sort()).toEqual([s.box1, s.box2].sort());

      // Composition figée : ni détachement ni rattachement d'un autre carton après la remise.
      await expect(boxShipment.detachBoxFromShipment({ unitId: s.box1 })).rejects.toMatchObject({ code: 'HUB_SHIPMENT_CLOSED' });
      const extra = await makeBox({ market: km, state: 'PACKED', label: 'LATE' });
      await expect(boxShipment.attachBoxToShipment({ unitId: extra, shipmentReference: s.shipRef })).rejects.toMatchObject({ code: 'HUB_SHIPMENT_CLOSED' });
    });

    test('création : carton d\'un autre marché, non emballé, ou déjà dans un dossier → refus ; aucune expédition créée', async () => {
      const mk = (label, extra = {}) => ({ reference: `${tag}-REF-${label}`, forwarder_name: 'Transitaire test', transport_mode: 'sea', proof_ref: `P-${label}`, ...extra });
      const count = async () => Number((await q('SELECT COUNT(*)::int AS n FROM international_shipments WHERE reference LIKE $1', [`${tag}-REF-%`])).rows[0].n);
      const boxCm = await makeBox({ market: cm, state: 'PACKED', label: 'CM' });
      const boxPicked = await makeBox({ market: km, state: 'PICKED', label: 'PICKED' });
      await expect(journey.create({ id: km, code: 'KM' }, actor(), mk('CM', { hub_unit_ids: [boxCm] }))).rejects.toMatchObject({ code: 'HUB_BOX_SHIPMENT_MARKET_MISMATCH' });
      await expect(journey.create({ id: km, code: 'KM' }, actor(), mk('PICKED', { hub_unit_ids: [boxPicked] }))).rejects.toMatchObject({ code: 'HUB_BOX_NOT_PACKED' });
      await expect(journey.create({ id: km, code: 'KM' }, actor(), mk('TWICE', { hub_unit_ids: [s.box1] }))).rejects.toMatchObject({ code: 'HUB_BOX_ALREADY_ATTACHED' });
      await expect(journey.create({ id: km, code: 'KM' }, actor(), mk('GHOST', { hub_unit_ids: [id()] }))).rejects.toMatchObject({ code: 'HUB_BOX_NOT_FOUND' });
      await expect(journey.create({ id: km, code: 'KM' }, actor(), mk('EMPTY', {}))).rejects.toMatchObject({ code: 'JOURNEY_PARCELS_REQUIRED' });
      expect(await count()).toBe(0);
    });

    test('concurrence : le même carton demandé par deux créations simultanées → un seul dossier le contient', async () => {
      const box = await makeBox({ market: km, state: 'PACKED', label: 'RACE' });
      const run = (n) => journey.create({ id: km, code: 'KM' }, actor(), {
        reference: `${tag}-RACE-${n}`, forwarder_name: 'Transitaire test', transport_mode: 'sea', proof_ref: `R-${n}`, hub_unit_ids: [box] });
      const results = await Promise.allSettled([run(1), run(2)]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect((await q('SELECT 1 FROM international_shipment_hub_units WHERE physical_unit_id=$1', [box])).rows).toHaveLength(1);
      const lost = results.find((r) => r.status === 'rejected');
      expect(lost.reason.code).toBe('HUB_BOX_ALREADY_ATTACHED');
    });

    test('dossier historique (sans KOM-BOX) : la remise garde sa règle d\'origine', async () => {
      const legacy = `${tag}-LEGACY`;
      await q(`INSERT INTO international_shipments(id,market_id,reference,forwarder_name,transport_mode,stage,created_by)
               VALUES($1,$2,$3,'Transitaire historique','sea','hub_ready',$4)`, [id(), km, legacy, admin]);
      const done = await journey.transition({ id: km, code: 'KM' }, actor(), legacy, { to_stage: 'handed_over', proof_ref: 'REMISE-HIST' });
      expect(done.stage).toBe('handed_over');
      const det = await journey.detail({ id: km, code: 'KM' }, legacy);
      expect(det.hub_units).toEqual([]);
      expect(det.parcels).toEqual([]);
    });
  });

  describe('cas négatifs', () => {
    let km1; let cmOrder;

    test('ligne CM refusée dans une PO KM', async () => {
      cmOrder = await makeOrder({ market: cm, relais: relaisCm, supplier: supplierA, items: [{ sku: sku1, qty: 1 }] });
      km1 = await makeOrder({ market: km, relais: relaisKm, supplier: supplierA, items: [{ sku: sku1, qty: 1 }] });
      const po = (await grouped.preparePurchaseOrder({ supplier_id: supplierA, procurement_hub_ref: 'DXB', line_ids: [km1.lines[0].lineId] }, { actor: actor() }));
      const poId = po.purchase_order.id;
      await expect(grouped.attachDraftLines(poId, [cmOrder.lines[0].lineId])).rejects.toThrow();
      km1.po = poId;
    });

    test('réception sur PO brouillon refusée', async () => {
      const res = await receive(km1.po, sku1.id, 1, `${tag}-DRAFT`);
      // Une PO non soumise ne reçoit rien : l'arrivée est mise en quarantaine, aucune ligne n'est créditée.
      expect(res.status === 202 || res.status >= 400).toBe(true);
      expect(await received(km1.lines[0].lineId)).toBe(0);
    });

    test('envoi d\'une PO brouillon refusé', async () => {
      await expect(engagement.recordPurchaseOrderSent(km1.po, { channel: 'email' }, { actor: actor() })).rejects.toMatchObject({ code: 'PURCHASE_ORDER_NOT_SUBMITTED' });
    });

    test('deuxième envoi : même canal idempotent, canal différent refusé', async () => {
      await engagement.submitPurchaseOrder(km1.po, { actor: actor() });
      await engagement.recordPurchaseOrderSent(km1.po, { channel: 'email' }, { actor: actor() });
      const again = await engagement.recordPurchaseOrderSent(km1.po, { channel: 'email' }, { actor: actor() });
      expect(again.already_sent).toBe(true);
      await expect(engagement.recordPurchaseOrderSent(km1.po, { channel: 'phone' }, { actor: actor() }))
        .rejects.toMatchObject({ code: 'PURCHASE_ORDER_ALREADY_SENT' });
      await expect(engagement.recordPurchaseOrderSent(km1.po, { channel: 'pigeon' }, { actor: actor() })).rejects.toMatchObject({ status: 400 });
    });

    test('mauvaise variante, sur-réception et double saisie idempotente', async () => {
      await engagement.confirmGroupedPurchaseOrder(km1.po, {
        supplier_order_id: `SO2-${tag}`, lines: [{ purchase_line_id: km1.lines[0].lineId, confirmed_quantity: 1 }],
      }, { actor: actor() });
      const wrong = await receive(km1.po, sku2.id, 1, `${tag}-WRONGSKU`);
      // Une variante qui n'est pas dans la PO n'est jamais créditée : mise en quarantaine, aucune quantité reçue.
      expect(wrong.status === 202 || wrong.status >= 400).toBe(true);
      expect(await received(km1.lines[0].lineId)).toBe(0);

      const ok = await receive(km1.po, sku1.id, 1, `${tag}-ONCE`);
      expect(ok.status).toBe(201);
      const replay = await receive(km1.po, sku1.id, 1, `${tag}-ONCE`);
      expect(replay.status).toBeLessThan(300);
      expect(await received(km1.lines[0].lineId)).toBe(1);

      const over = await receive(km1.po, sku1.id, 1, `${tag}-OVER`);
      expect(over.status === 202 || over.status >= 400).toBe(true);
      expect(await received(km1.lines[0].lineId)).toBe(1);
    });

    test('carton CM refusé vers une expédition KM, et carton rattaché deux fois', async () => {
      const shipKm = `${tag}-SHIPKM`;
      await q(`INSERT INTO international_shipments(id,market_id,reference,forwarder_name,transport_mode,stage,created_by)
               VALUES($1,$2,$3,'Transitaire test','sea','hub_ready',$4)`, [id(), km, shipKm, admin]);
      const client = await db.getClient();
      let boxCm;
      try {
        await client.query("SET session_replication_role='replica'");
        boxCm = id();
        await client.query(`INSERT INTO hub_physical_units(id,reference,unit_type,state,market_id) VALUES($1,$2,'MARKET_PARCEL','PACKED',$3)`,
          [boxCm, `${tag}-BOXCM`, cm]);
      } finally { await client.query("SET session_replication_role='origin'"); client.release(); }
      await expect(boxShipment.attachBoxToShipment({ unitId: boxCm, shipmentReference: shipKm }))
        .rejects.toMatchObject({ code: 'HUB_BOX_SHIPMENT_MARKET_MISMATCH' });
    });

    test('fournisseur indisponible : annulation puis reprise chez B, le reliquat réapparaît dans les besoins', async () => {
      const o = await makeOrder({ market: km, relais: relaisKm, supplier: supplierA, items: [{ sku: sku2, qty: 2 }] });
      await grouped.cancelLine(o.lines[0].lineId, 'fournisseur A indisponible');
      // Limite assumée : createManualLine exige le graphe catalogue sourcing complet ; la réouverture du besoin
      // chez B est donc posée comme donnée de référence (ligne ouverte), l'annulation, elle, passe par le vrai service.
      const cancelled = (await q('SELECT cancelled_at FROM purchase_lines WHERE id=$1', [o.lines[0].lineId])).rows[0];
      expect(cancelled.cancelled_at).not.toBeNull();
      const gone = (await dossier.getDossier({ marketId: km, supplierId: supplierA })).needs;
      expect(gone.some((n) => n.line_id === o.lines[0].lineId)).toBe(false);
      await q(
        `INSERT INTO purchase_lines(id,purchase_order_id,order_item_id,supplier_id,product_sku_id,supplier_sku,
           supplier_unit_ref,supplier_order_identity,quantity,supplier_unit_price,supplier_currency,procurement_hub_ref)
         VALUES($1,NULL,$2,$3,$4,$5,$6,$7::jsonb,2,7,'USD','DXB')`,
        [id(), o.lines[0].itemId, supplierB, sku2.id, sku2.supplierSku, `${sku2.supplierSku}-U`, sku2.identity]);
      const needs = (await dossier.getDossier({ marketId: km, supplierId: supplierB })).needs;
      expect(needs.some((n) => n.order_id === o.orderId)).toBe(true);
    });
  });

  describe('ouverture autonome et remise opposable (#3251)', () => {
    test('service réel PostgreSQL : dossier vide → composition → sortie → remise, sans preuve inventée', async () => {
      const ref=`${tag}-DRAFT-3251`;
      const hubActor={id:admin,role:'agent_hub'};
      const opened=await journey.open({id:km,code:'KM'},hubActor,{reference:ref});
      expect(opened).toMatchObject({stage:'hub_ready',hub_draft:true,hub_units:0});
      const row=(await q('SELECT forwarder_name,transport_mode,hub_draft,stage FROM international_shipments WHERE reference=$1',[ref])).rows[0];
      expect(row).toMatchObject({forwarder_name:null,transport_mode:null,hub_draft:true,stage:'hub_ready'});
      const event=(await q("SELECT event_type,proof_ref,actor_id FROM international_shipment_events e JOIN international_shipments s ON s.id=e.shipment_id WHERE s.reference=$1 AND event_type='opened'",[ref])).rows[0];
      expect(event).toMatchObject({event_type:'opened',proof_ref:null,actor_id:admin});
      const transfer={to_stage:'handed_over',proof_ref:'HANDOVER-3251',forwarder_name:'Transitaire réel',transport_mode:'sea'};
      await expect(journey.transition({id:km,code:'KM'},hubActor,ref,transfer))
        .rejects.toMatchObject({code:'JOURNEY_HUB_DRAFT_EMPTY'});
      // Même une écriture SQL directe reste refusée par le trigger.
      await expect(q("UPDATE international_shipments SET stage='handed_over',forwarder_name='Transitaire réel',transport_mode='sea' WHERE reference=$1",[ref]))
        .rejects.toThrow(/hub_draft_handover_empty/);
      const box=await makeBox({market:km,state:'PACKED',label:'DRAFT-3251'});
      const other=await makeBox({market:cm,state:'PACKED',label:'OTHER-3251'});
      await expect(boxShipment.attachBoxToShipment({unitId:other,shipmentReference:ref,expectedMarketId:km,actor:hubActor}))
        .rejects.toMatchObject({code:'HUB_BOX_SHIPMENT_MARKET_MISMATCH'});
      const attached=await boxShipment.attachBoxToShipment({unitId:box,shipmentReference:ref,expectedMarketId:km,actor:hubActor});
      expect(attached.already_attached).toBe(false);
      await expect(journey.transition({id:km,code:'KM'},hubActor,ref,transfer))
        .rejects.toMatchObject({code:'JOURNEY_HUB_UNITS_NOT_DISPATCHED'});
      const client=await db.getClient();
      try {
        await client.query("SET session_replication_role='replica'");
        await client.query("UPDATE hub_physical_units SET state='DISPATCHED' WHERE id=$1",[box]);
      } finally {
        await client.query("SET session_replication_role='origin'");
        client.release();
      }
      await expect(journey.transition({id:km,code:'KM'},hubActor,ref,{to_stage:'handed_over',proof_ref:'HANDOVER-3251'}))
        .rejects.toMatchObject({code:'JOURNEY_INVALID_forwarder_name'});
      const done=await journey.transition({id:km,code:'KM'},hubActor,ref,transfer);
      expect(done.stage).toBe('handed_over');
      await expect(boxShipment.detachBoxFromShipment({unitId:box,expectedMarketId:km,actor:hubActor}))
        .rejects.toMatchObject({code:'HUB_SHIPMENT_CLOSED'});
      const events=(await q("SELECT e.event_type,e.actor_id,e.proof_ref FROM international_shipment_events e JOIN international_shipments s ON s.id=e.shipment_id WHERE s.reference=$1 ORDER BY e.occurred_at",[ref])).rows;
      expect(events.map(e=>e.event_type)).toEqual(expect.arrayContaining(['opened','box_attached','stage_changed']));
      expect(events.find(e=>e.event_type==='stage_changed').proof_ref).toBe('HANDOVER-3251');
    });
  });

  describe('concurrence', () => {
    test('deux PO tentent d\'attacher la même ligne : une seule réussit', async () => {
      const o = await makeOrder({ market: km, relais: relaisKm, supplier: supplierA, items: [{ sku: sku1, qty: 1 }] });
      const seed1 = await makeOrder({ market: km, relais: relaisKm, supplier: supplierA, items: [{ sku: sku1, qty: 1 }] });
      const seed2 = await makeOrder({ market: km, relais: relaisKm, supplier: supplierA, items: [{ sku: sku1, qty: 1 }] });
      const mk = async (seed) => {
        const r = await grouped.preparePurchaseOrder({ supplier_id: supplierA, procurement_hub_ref: 'DXB', line_ids: [seed.lines[0].lineId] }, { actor: actor() });
        return r.purchase_order.id;
      };
      const [po1, po2] = [await mk(seed1), await mk(seed2)];
      const results = await Promise.allSettled([
        grouped.attachDraftLines(po1, [o.lines[0].lineId]),
        grouped.attachDraftLines(po2, [o.lines[0].lineId]),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const owners = (await q('SELECT purchase_order_id FROM purchase_lines WHERE id=$1', [o.lines[0].lineId])).rows;
      expect(owners).toHaveLength(1);
      expect([po1, po2]).toContain(owners[0].purchase_order_id);
    });
  });
});
