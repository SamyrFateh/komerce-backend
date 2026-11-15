'use strict';

/**
 * @test-kind integration
 * @test-runner jest
 * @test-requires postgres
 * @integration hub-t3-sweep-postgres.test.js
 * @brief H1 / T3 — clôture sans reliquat fait avancer la commande immédiatement ; le balayage `ordered` ne meurt plus de faim derrière des commandes anciennes bloquées ; idempotence du balayage (PostgreSQL réel).
 */

const crypto = require('crypto');
const { submitAuthorized } = require('../helpers/submit-authorized');

jest.setTimeout(120000);

const db = require('../../db');
const grouped = require('../../services/purchasing-grouped-service');
const engagement = require('../../services/purchasing-engagement-service');
const hubOps = require('../../services/hub-operations');
const completion = require('../../services/purchasing-completion-service');

const hasDb = Boolean(process.env.DATABASE_URL);
const describeDb = hasDb ? describe : describe.skip;
const id = () => crypto.randomUUID();

describeDb('H1 / T3 — avancement à la clôture et balayage sans famine (REAL_DB)', () => {
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




  const status = async (orderId) => (await q('SELECT status::text AS status FROM orders WHERE id=$1', [orderId])).rows[0].status;
  const parcelQty = async (orderId) => (await q(
    'SELECT COALESCE(SUM(pi.quantity),0)::int AS qty FROM parcel_items pi JOIN order_items oi ON oi.id=pi.order_item_id ' +
    'JOIN parcels p ON p.id=pi.parcel_id AND p.cancelled_at IS NULL WHERE oi.order_id=$1', [orderId])).rows[0].qty;

  async function confirmedPo(o, qtyConfirmed, label) {
    const prepared = await grouped.preparePurchaseOrder(
      { supplier_id: supplierA, procurement_hub_ref: 'DXB', line_ids: o.lines.map((l) => l.lineId) }, { actor: actor() });
    const po = prepared.purchase_order.id;
    await submitAuthorized(engagement, po, { actor: actor() });
    await engagement.recordPurchaseOrderSent(po, { channel: 'whatsapp' }, { actor: actor() });
    await engagement.confirmGroupedPurchaseOrder(po, {
      purchase_proof_ref: `${label}-${tag}`, seller_label: 'Fournisseur test', supplier_order_id: `${label}-${tag}`,
      lines: o.lines.map((l) => ({ purchase_line_id: l.lineId, confirmed_quantity: qtyConfirmed })),
    }, { actor: actor() });
    return po;
  }

  // Commande IMPORT sans ligne d'achat, ancienne : éligible à la sélection du balayage, jamais complétable (fixture T3 staging).
  async function seedStalled(n) {
    const ids = [];
    for (let i = 0; i < n; i += 1) {
      const orderId = id();
      await q(`INSERT INTO orders(id,user_id,relais_id,market_id,reference,status,payment_status,payment_mode,total_kmf,total_eur,created_at)
               VALUES($1,$2,$3,$4,$5,'ordered','paid','stripe_eur',10000,20, NOW() - interval '30 days' + ($6 || ' seconds')::interval)`,
        [orderId, admin, relaisKm, km, `${tag}-OLD${i}`, String(i)]);
      await q(`INSERT INTO order_items(id,order_id,product_id,quantity,price_kmf,sku_id,fulfillment_source)
               VALUES($1,$2,$3,1,10000,$4,'IMPORT')`, [id(), orderId, sku1.productId, sku1.id]);
      ids.push(orderId);
    }
    return ids;
  }

  test('clôture d\'une ligne en rupture : la commande passe en preparation immédiatement, reçu réparti', async () => {
    const o = await makeOrder({ market: km, relais: relaisKm, supplier: supplierA, items: [{ sku: sku2, qty: 2 }] });
    const po = await confirmedPo(o, 2, 'T3FIX');
    expect((await receive(po, sku2.id, 1, `${tag}-T3FIX-RX`)).status).toBe(201);
    expect(await status(o.orderId)).toBe('ordered');

    const settled = await engagement.settleLine(o.lines[0].lineId, {
      settled_quantity: 1, reason: 'rupture fournisseur définitive', reopen_remainder: false }, { actor: actor() });

    expect(settled.order_completion).toMatchObject({ order_id: o.orderId, transition: 'preparation', complete: true });
    expect(await status(o.orderId)).toBe('preparation');
    expect(await parcelQty(o.orderId)).toBe(1);
    // Rejouer l'évaluation ne change rien (idempotence).
    await completion.evaluateOrderProcurementCompletion(o.orderId, { actor: actor() });
    expect(await parcelQty(o.orderId)).toBe(1);
  });

  test('clôture avec reliquat rouvert : la commande reste ordered (fail-closed)', async () => {
    const o = await makeOrder({ market: km, relais: relaisKm, supplier: supplierA, items: [{ sku: sku2, qty: 2 }] });
    const po = await confirmedPo(o, 2, 'T3KEEP');
    await receive(po, sku2.id, 1, `${tag}-T3KEEP-RX`);
    const settled = await engagement.settleLine(o.lines[0].lineId, {
      settled_quantity: 1, reason: 'écart, reliquat conservé', reopen_remainder: true }, { actor: actor() });
    expect(settled.order_completion).toMatchObject({ transition: 'skipped', complete: false });
    expect(await status(o.orderId)).toBe('ordered');
  });

  test('famine : plus de 50 commandes anciennes bloquées, une commande éligible récente est atteinte en passages bornés ; balayage idempotent', async () => {
    completion.resetSweepCursor();
    await seedStalled(120);
    // Commande éligible récente dont la complétude a été manquée (redémarrage entre réception et évaluation).
    const o = await makeOrder({ market: km, relais: relaisKm, supplier: supplierA, items: [{ sku: sku1, qty: 1 }] });
    const po = await confirmedPo(o, 1, 'T3SWEEP');
    await receive(po, sku1.id, 1, `${tag}-T3SWEEP-RX`);
    expect(await status(o.orderId)).toBe('preparation');
    await q("UPDATE orders SET status='ordered' WHERE id=$1", [o.orderId]);

    const maxEvaluations = 50;
    const { rows: [{ n }] } = await q(`SELECT COUNT(*)::int AS n FROM orders o WHERE o.status='ordered'
      AND EXISTS (SELECT 1 FROM order_items oi WHERE oi.order_id=o.id AND oi.fulfillment_source='IMPORT')
      AND NOT EXISTS (SELECT 1 FROM v_purchase_line_progress v WHERE v.order_id=o.id AND NOT v.cancelled AND v.received_quantity < v.effective_quantity)`);
    expect(n).toBeGreaterThan(120);
    const bound = Math.ceil(n / maxEvaluations);

    let passes = 0; let last;
    let aggregate = {};
    while (await status(o.orderId) !== 'preparation' && passes <= bound) {
      last = await completion.sweepStalledOrders({ limit: 50, maxEvaluations });
      passes += 1;
      for (const [k, v] of Object.entries(last.no_transition)) aggregate[k] = (aggregate[k] || 0) + v;
    }
    expect(await status(o.orderId)).toBe('preparation');
    expect(passes).toBeLessThanOrEqual(bound);
    expect(aggregate.NO_PURCHASE_LINE).toBeGreaterThanOrEqual(100);
    expect(await parcelQty(o.orderId)).toBeGreaterThanOrEqual(1);

    // Idempotence : un balayage complet de plus n'avance plus rien et ne duplique ni colis ni SCAN 3.
    const before = { parcels: await parcelQty(o.orderId), scans: (await q("SELECT COUNT(*)::int AS n FROM scans WHERE order_id=$1 AND step='preparation'", [o.orderId])).rows[0].n };
    completion.resetSweepCursor();
    let advanced = 0;
    for (let i = 0; i < bound + 1; i += 1) advanced += (await completion.sweepStalledOrders({ limit: 50, maxEvaluations })).ordered;
    expect(advanced).toBe(0);
    expect(await status(o.orderId)).toBe('preparation');
    expect({ parcels: await parcelQty(o.orderId), scans: (await q("SELECT COUNT(*)::int AS n FROM scans WHERE order_id=$1 AND step='preparation'", [o.orderId])).rows[0].n }).toEqual(before);
  });

  afterAll(async () => {
    // Ne laisse aucune commande `ordered` : les files du tableau de bord (L8, limitées à 25) partagent la même base.
    await q("UPDATE orders SET status='cancelled' WHERE reference LIKE $1 AND status IN ('ordered', 'preparation')", [`${tag}%`]).catch(() => {});
    await db.pool.end().catch(() => {});
  });
});
