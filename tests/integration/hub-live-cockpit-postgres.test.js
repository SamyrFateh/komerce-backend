'use strict';

/**
 * @test-kind integration
 * @test-runner jest
 * @test-requires postgres
 * @integration hub-live-cockpit-postgres.test.js
 * @brief Hub Live concept C — scénario de référence KOM-101/102/103 sur PostgreSQL réel, via les services canoniques :
 *        une PO mono-fournisseur/mono-marché regroupe deux commandes, la réception partielle est allouée FIFO
 *        (commande la plus ancienne), le reliquat reste visible, aucune réception ni stock fictif, une commande
 *        partiellement reçue n'est jamais prête à emballer, les commandes locales ne passent pas par le Hub.
 */

jest.setTimeout(120000);

if (!process.env.DATABASE_URL) {
  describe.skip('hub-live-cockpit (needs DATABASE_URL)', () => { test('skipped', () => {}); });
} else {
  const crypto = require('crypto');
  const db = require('../../db');
  const grouped = require('../../services/purchasing-grouped-service');
  const engagement = require('../../services/purchasing-engagement-service');
  const auth = require('../../services/hub-authorization-service');
  const hubOps = require('../../services/hub-operations');
  const dossierService = require('../../services/hub-procurement-dossier');

  const id = () => crypto.randomUUID();
  const q = (sql, params) => db.query(sql, params);
  const tag = `HLC-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`;
  let km; let relais; let admin; let agent; let directrice; let supplierA; let supplierB; let skuA; let skuB; let skuC;
  const s = {};

  async function user(role, label) {
    const uid = id();
    await q('INSERT INTO users(id,full_name,email,phone,role) VALUES($1,$2,$3,$4,$5)',
      [uid, `${label} ${tag}`, `${label}-${tag}@komerce.test`.toLowerCase(), `+2693${String(Math.floor(Math.random() * 1e7)).padStart(7, '0')}`, role]);
    return { id: uid, role };
  }

  async function makeSku(label) {
    const skuId = id(); const productId = id();
    await q(`INSERT INTO products(id,name,price_kmf,cost_kmf,volume_cm3,stock,price_aed,inventory_model)
             VALUES($1,$2,10000,3000,1000,0,100,'SKU')`, [productId, `Produit ${label} ${tag}`]);
    const supplierSku = `${tag}-${label}`;
    const identity = { provider: 'whatsapp', version: 1, payload: { supplier_sku: supplierSku } };
    await q(`INSERT INTO product_skus(id,product_id,sku,stock,is_active,source,supplier_sku,supplier_unit_ref,supplier_order_identity)
             VALUES($1,$2,$3,0,true,'SUPPLIER',$4,$5,$6::jsonb)`,
    [skuId, productId, `${tag}-SKU-${label}`, supplierSku, `${supplierSku}-U`, JSON.stringify(identity)]);
    return { id: skuId, productId, supplierSku, identity: JSON.stringify(identity) };
  }

  // items : { sku, qty, supplier?, source? } ; supplier absent => aucune ligne d'achat (besoin sans fournisseur).
  async function makeOrder({ reference, minutesAgo, items }) {
    const orderId = id();
    await q(`INSERT INTO orders(id,user_id,relais_id,market_id,reference,status,payment_status,payment_mode,total_kmf,total_eur,created_at)
             VALUES($1,$2,$3,$4,$5,'ordered','paid','stripe_eur',10000,20, NOW() - ($6 || ' minutes')::interval)`,
    [orderId, admin.id, relais, km, reference, String(minutesAgo)]);
    const out = [];
    for (const it of items) {
      const itemId = id();
      await q(`INSERT INTO order_items(id,order_id,product_id,quantity,price_kmf,sku_id,fulfillment_source)
               VALUES($1,$2,$3,$4,10000,$5,$6)`, [itemId, orderId, it.sku.productId, it.qty, it.sku.id, it.source || 'IMPORT']);
      let lineId = null;
      if (it.supplier) {
        lineId = id();
        await q(`INSERT INTO purchase_lines(id,purchase_order_id,order_item_id,supplier_id,product_sku_id,supplier_sku,
                   supplier_unit_ref,supplier_order_identity,quantity,supplier_unit_price,supplier_currency,procurement_hub_ref)
                 VALUES($1,NULL,$2,$3,$4,$5,$6,$7::jsonb,$8,7,'USD','DXB')`,
        [lineId, itemId, it.supplier, it.sku.id, it.sku.supplierSku, `${it.sku.supplierSku}-U`, it.sku.identity, it.qty]);
      }
      out.push({ itemId, lineId, qty: it.qty });
    }
    return { orderId, reference, items: out };
  }

  const dossier = (viewer = null) => dossierService.getDossier({ marketId: km, viewer });
  const orderOf = (d, o) => d.orders.find((x) => x.id === o.orderId);
  const itemOf = (d, o, index) => orderOf(d, o).items.find((i) => i.id === o.items[index].itemId);
  const receive = (poId, skuId, quantity, reference) => hubOps.receiveSupplierPackageCommand({
    reference, location_ref: 'HUB-DXB-RECEIVE',
    contents: [{ purchase_order_id: poId, product_sku_id: skuId, quantity }],
  }, agent.id);
  const lineReceived = async (lineId) => Number((await q('SELECT received_quantity FROM v_purchase_line_progress WHERE line_id=$1', [lineId])).rows[0].received_quantity);
  const approveAndSubmit = async (poId) => {
    await auth.decide({ purchaseOrderId: poId, authorizationType: 'purchase_commitment', actor: directrice, body: { proof_ref: `BC-${poId.slice(0, 6)}` } });
    await engagement.submitPurchaseOrder(poId, { actor: agent });
  };

  beforeAll(async () => {
    await q(require('fs').readFileSync(require('path').join(__dirname, '../../migrations/369_single_purchase_model.sql'), 'utf8'));
    km = (await q("SELECT id FROM markets WHERE code='KM'")).rows[0].id;
    admin = await user('admin', 'admin');
    agent = await user('agent_hub', 'agent');
    directrice = await user('agent_hub', 'directrice');
    relais = id();
    await q("INSERT INTO relais(id,name,agent_name,phone,address,market_id) VALUES($1,$2,'A','+2693000031','R',$3)", [relais, `R-${tag}`, km]);
    supplierA = id(); supplierB = id();
    await q("INSERT INTO suppliers(id,name,platform,is_active) VALUES($1,$2,'whatsapp',true)", [supplierA, `Fournisseur A ${tag}`]);
    await q("INSERT INTO suppliers(id,name,platform,is_active) VALUES($1,$2,'whatsapp',true)", [supplierB, `Fournisseur B ${tag}`]);
    skuA = await makeSku('A'); skuB = await makeSku('B'); skuC = await makeSku('C');
    await auth.grant({ userId: directrice.id, authorizationType: 'purchase_commitment', actor: admin });
    await auth.grant({ userId: directrice.id, authorizationType: 'supplier_payment', actor: admin });
    s.k101 = await makeOrder({ reference: `${tag}-KOM-101`, minutesAgo: 30, items: [{ sku: skuA, qty: 2, supplier: supplierA }, { sku: skuB, qty: 1, supplier: supplierB }] });
    s.k102 = await makeOrder({ reference: `${tag}-KOM-102`, minutesAgo: 20, items: [{ sku: skuA, qty: 1, supplier: supplierA }] });
    s.k103 = await makeOrder({ reference: `${tag}-KOM-103`, minutesAgo: 10, items: [{ sku: skuC, qty: 2 }] });
    s.local = await makeOrder({ reference: `${tag}-LOCAL`, minutesAgo: 5, items: [{ sku: skuC, qty: 1, source: 'LOCAL_STOCK' }] });
    s.stockBefore = Number((await q('SELECT SUM(stock)::int AS n FROM product_skus WHERE id = ANY($1)', [[skuA.id, skuB.id, skuC.id]])).rows[0].n);
  });
  afterAll(async () => { await db.pool.end().catch(() => {}); });

  test('1. besoins : couverts / non couverts par ligne, regroupement fournisseur × marché × SKU, sourcing requis pour KOM-103', async () => {
    const d = await dossier(agent);
    const i101A = itemOf(d, s.k101, 0);
    expect(i101A).toMatchObject({ requested: 2, covered: 0, to_group: 2, uncovered: 0, received: 0, remaining_to_deliver: 2 });
    const i103 = itemOf(d, s.k103, 0);
    expect(i103).toMatchObject({ requested: 2, covered: 0, to_group: 0, uncovered: 2, sourcing_required: true });
    // Pavés par unité : un état par unité demandée, issu du serveur.
    expect(i101A.units.map((u) => u.state)).toEqual(['none', 'none']);
    expect(i103.units.map((u) => u.state)).toEqual(['sourcing', 'sourcing']);
    expect(i103.where).toBe('sans fournisseur');
    expect(orderOf(d, s.k103).status).toMatchObject({ label: 'Anomalie fournisseur', tone: 'bad' });
    expect(d.cockpit.physical.map((p) => p.key)).toEqual(['received', 'bags', 'boxes', 'shipped', 'reliquats']);
    const batchA = d.cockpit.need_batches.find((b) => b.supplier_id === supplierA);
    expect(batchA.market_id).toBe(km);
    expect(batchA.procurement_hub_ref).toBe('DXB');
    const groupA = batchA.groups.find((g) => g.product_sku_id === skuA.id);
    expect(groupA.quantity).toBe(3);
    expect(groupA.lines.map((l) => l.order_id).sort()).toEqual([s.k101.orderId, s.k102.orderId].sort());
    // À faire maintenant : ce qui manque, pourquoi, qui agit, quelle action.
    const sourcing = d.cockpit.todo.find((t) => t.kind === 'SOURCING_REQUIRED' && t.subject.order_id === s.k103.orderId);
    expect(sourcing).toMatchObject({ owner: 'agent_hub', viewer_can_act: true });
    expect(sourcing).toMatchObject({ severity: 'anomaly' });
    expect(sourcing.missing).toContain('Sourcing requis — aucun fournisseur admissible');
    expect(d.cockpit.unit_legend.map((g) => g.state)).not.toContain('sourcing');
    expect(sourcing.why).toBeTruthy();
    expect(d.cockpit.todo.find((t) => t.kind === 'PREPARE_PO' && t.subject.batch_key === batchA.key).action.type).toBe('prepare_po');
    expect(d.cockpit.allocation_rule).toMatch(/FIFO/);
  });

  test('2. commandes locales : absentes du Hub (circuit direct relais inchangé), aucune ligne d\'achat créée', async () => {
    const d = await dossier(agent);
    expect(d.orders.find((o) => o.id === s.local.orderId)).toBeUndefined();
    expect(d.needs.find((n) => n.order_id === s.local.orderId)).toBeUndefined();
    expect(d.to_handle.find((t) => t.order_ref === `${tag}-LOCAL`)).toBeUndefined();
    expect((await q('SELECT count(*)::int AS n FROM purchase_lines WHERE order_item_id=$1', [s.local.items[0].itemId])).rows[0].n).toBe(0);
  });

  test('3. PO-1 = A (KOM-101 + KOM-102), mono-fournisseur/mono-marché ; prepare idempotent (rejeu = refus, aucune PO en double)', async () => {
    const lineIds = [s.k101.items[0].lineId, s.k102.items[0].lineId];
    const prepared = await grouped.preparePurchaseOrder({ supplier_id: supplierA, procurement_hub_ref: 'DXB', line_ids: lineIds }, { actor: agent });
    s.po1 = prepared.purchase_order.id;
    expect(prepared.purchase_order).toMatchObject({ status: 'draft', market_id: km, supplier_id: supplierA });
    const before = (await q('SELECT count(*)::int AS n FROM purchase_orders WHERE supplier_id=$1', [supplierA])).rows[0].n;
    await expect(grouped.preparePurchaseOrder({ supplier_id: supplierA, procurement_hub_ref: 'DXB', line_ids: lineIds }, { actor: agent }))
      .rejects.toMatchObject({ status: 409, code: 'PURCHASE_LINES_ALREADY_ATTACHED' });
    expect((await q('SELECT count(*)::int AS n FROM purchase_orders WHERE supplier_id=$1', [supplierA])).rows[0].n).toBe(before);
    const prepB = await grouped.preparePurchaseOrder({ supplier_id: supplierB, procurement_hub_ref: 'DXB', line_ids: [s.k101.items[1].lineId] }, { actor: agent });
    s.poB = prepB.purchase_order.id;
    const d = await dossier(agent);
    const po1 = d.purchase_orders.find((p) => p.id === s.po1);
    expect(po1.step).toMatchObject({ key: 'draft', index: 1 });
    expect(po1.order_ids.sort()).toEqual([s.k101.orderId, s.k102.orderId].sort());
    // Une commande dépend de plusieurs PO / fournisseurs.
    expect(orderOf(d, s.k101).po_ids.sort()).toEqual([s.po1, s.poB].sort());
    expect(orderOf(d, s.k101).supplier_count).toBe(2);
    // Même définition des deux côtés : une fois en PO, plus rien « à regrouper » ni « sans ligne d'achat ».
    expect(itemOf(d, s.k101, 0)).toMatchObject({ covered: 2, to_group: 0, uncovered: 0 });
    expect(orderOf(d, s.k101).totals).toMatchObject({ covered: 3, to_group: 0, uncovered: 0 });
    // Besoin A consommé : plus de lot ouvert pour A.
    expect(d.cockpit.need_batches.find((b) => b.supplier_id === supplierA)).toBeUndefined();
  });

  test('4. approbation : ni l\'agent ni l\'admin n\'ont de pouvoir implicite ; seule la responsable Hub (grants) décide ; paiement distinct', async () => {
    await expect(auth.decide({ purchaseOrderId: s.po1, authorizationType: 'purchase_commitment', actor: agent, body: { proof_ref: 'X' } })).rejects.toMatchObject({ code: 'AUTHORIZATION_GRANT_REQUIRED' });
    await expect(auth.decide({ purchaseOrderId: s.po1, authorizationType: 'purchase_commitment', actor: admin, body: { proof_ref: 'X' } })).rejects.toMatchObject({ code: 'AUTHORIZATION_GRANT_REQUIRED' });
    await expect(auth.decide({ purchaseOrderId: s.po1, authorizationType: 'supplier_payment', actor: admin, body: { proof_ref: 'X', amount: 1, currency: 'USD' } })).rejects.toMatchObject({ code: 'AUTHORIZATION_GRANT_REQUIRED' });
    // Rights visibles par rôle dans le dossier.
    expect((await dossier(agent)).cockpit.viewer).toMatchObject({ role: 'agent_hub', can_authorize_commitment: false, can_authorize_payment: false });
    expect((await dossier(admin)).cockpit.viewer).toMatchObject({ role: 'admin', can_authorize_commitment: false, can_authorize_payment: false });
    expect((await dossier(directrice)).cockpit.viewer).toMatchObject({ can_authorize_commitment: true, can_authorize_payment: true });
    const todoForAgent = (await dossier(agent)).cockpit.todo.find((t) => t.kind === 'AUTHORIZE_COMMITMENT' && t.subject.po_id === s.po1);
    expect(todoForAgent).toMatchObject({ owner: 'responsable_hub', viewer_can_act: false });
    expect(todoForAgent.blocked_reason).toMatch(/responsable Hub/);

    const decision = await auth.decide({ purchaseOrderId: s.po1, authorizationType: 'purchase_commitment', actor: directrice, body: { proof_ref: 'BC-PO1' } });
    expect(Number(decision.amount)).toBe(21);
    // Contenu figé une fois l'engagement validé (le montant autorisé ne change pas silencieusement).
    await expect(grouped.detachLines(s.po1, [s.k102.items[0].lineId])).rejects.toMatchObject({ status: 409, code: 'PURCHASE_ORDER_COMMITMENT_FROZEN' });
    const mid = (await dossier(agent)).purchase_orders.find((p) => p.id === s.po1);
    expect(mid.step.key).toBe('validation');
    expect(mid.authorizations.commitment).toMatchObject({ currency: 'USD', proof_ref: 'BC-PO1', pdf_available: true });
    expect(mid.authorizations.commitment).not.toHaveProperty('commitment_pdf');
    expect(mid.authorizations.payment).toBeNull();

    await engagement.submitPurchaseOrder(s.po1, { actor: agent });
    await engagement.recordPurchaseOrderSent(s.po1, { channel: 'whatsapp', supplier_order_id: `SO-${tag}` }, { actor: agent });
    const sent = (await dossier(agent)).purchase_orders.find((p) => p.id === s.po1);
    expect(sent.step.key).toBe('sent');
    // PO approuvée ≠ PO payée.
    expect(sent.authorizations.payment).toBeNull();
    const pay = await auth.decide({ purchaseOrderId: s.po1, authorizationType: 'supplier_payment', actor: directrice, body: { proof_ref: 'VIR-PO1', amount: 21, currency: 'USD' } });
    expect(pay.authorization_type).toBe('supplier_payment');
    await approveAndSubmit(s.poB);
  });

  test('5. réception partielle 2/3 : allocation FIFO sur KOM-101, reliquat 1 conservé sur KOM-102, aucune réception/stock fictif', async () => {
    const r = await receive(s.po1, skuA.id, 2, `SUPPLIER_PACKAGE-${tag}-1`);
    expect(r.status).toBe(201);
    expect(r.body.quarantined).toBe(false);
    expect(await lineReceived(s.k101.items[0].lineId)).toBe(2);
    expect(await lineReceived(s.k102.items[0].lineId)).toBe(0);
    const d = await dossier(agent);
    expect(itemOf(d, s.k101, 0)).toMatchObject({ received: 2, remaining_to_deliver: 0, complete: true, to_control: 2 });
    expect(itemOf(d, s.k102, 0)).toMatchObject({ received: 0, remaining_to_deliver: 1, complete: false });
    const po1 = d.purchase_orders.find((p) => p.id === s.po1);
    expect(po1.totals).toMatchObject({ effective: 3, received: 2, missing: 1 });
    expect(po1.step).toMatchObject({ key: 'received', partial: true });
    expect(po1.status_view).toMatchObject({ label: 'Reçue 2/3 · reliquat 1', tone: 'warn' });
    expect(itemOf(d, s.k101, 0).units.map((u) => u.state)).toEqual(['received', 'received']);
    expect(itemOf(d, s.k102, 0).units.map((u) => u.state)).toEqual(['shipped']);
    expect(itemOf(d, s.k102, 0).where).toMatch(/^reliquat PO-/);
    expect(d.cockpit.physical.find((p) => p.key === 'received').items.map((i) => i.ref)).toContain(orderOf(d, s.k101).reference);
    expect(d.cockpit.physical.find((p) => p.key === 'reliquats').items.map((i) => i.order_id)).toContain(s.k102.orderId);
    const lines = Object.fromEntries(po1.lines.map((l) => [l.order_id, l]));
    expect(lines[s.k101.orderId]).toMatchObject({ fifo_rank: 1, received: 2, missing: 0, fifo_next: false });
    expect(lines[s.k102.orderId]).toMatchObject({ fifo_rank: 2, received: 0, missing: 1, fifo_next: true });
    // Aucune création de stock ni de réception fictive.
    expect((await q("SELECT count(*)::int AS n FROM hub_physical_units WHERE reference=$1", [`SUPPLIER_PACKAGE-${tag}-1`])).rows[0].n).toBe(1);
    const placed = await q(`SELECT COALESCE(SUM(p.quantity),0)::int AS n FROM hub_physical_unit_placements p JOIN hub_purchase_allocations a ON a.id=p.allocation_id WHERE a.purchase_order_id=$1`, [s.po1]);
    expect(placed.rows[0].n).toBe(2);
    expect(Number((await q('SELECT SUM(stock)::int AS n FROM product_skus WHERE id = ANY($1)', [[skuA.id, skuB.id, skuC.id]])).rows[0].n)).toBe(s.stockBefore);
  });

  test('6. KOM-101 n\'est PAS prête à emballer tant que B n\'est pas reçu ; ligne complète ≠ commande complète', async () => {
    const d = await dossier(agent);
    const o101 = orderOf(d, s.k101);
    expect(itemOf(d, s.k101, 0).complete).toBe(true);
    expect(itemOf(d, s.k101, 1)).toMatchObject({ received: 0, remaining_to_deliver: 1, complete: false });
    expect(o101.readiness).toMatchObject({ complete: false, partial: true, ready_to_pack: false });
    // B est sur une PO non livrée : le reliquat est réel (2/3), distinct d'un besoin « à regrouper ».
    expect(o101.status).toMatchObject({ label: 'Reliquat 2/3', tone: 'warn' });
    expect(orderOf(d, s.k102).status.label).toBe('Attente fournisseur');
    expect(o101.readiness.pending_items).toEqual([expect.objectContaining({ missing: 1 })]);
    expect(d.cockpit.todo.find((t) => t.kind === 'PREPARE_BAG' && t.subject.order_id === s.k101.orderId)).toBeUndefined();
    expect(await dossierService.getOrderCompleteness(s.k101.orderId)).toMatchObject({ complete: false });
  });

  test('7. rejeu de la même saisie de réception = idempotent (aucune seconde réception) ; sur-réception jamais comptée comme reçue', async () => {
    const replay = await receive(s.po1, skuA.id, 2, `SUPPLIER_PACKAGE-${tag}-1`);
    expect(replay.body.idempotent_replay).toBe(true);
    expect((await q("SELECT count(*)::int AS n FROM hub_physical_units WHERE reference=$1", [`SUPPLIER_PACKAGE-${tag}-1`])).rows[0].n).toBe(1);
    expect(await lineReceived(s.k101.items[0].lineId)).toBe(2);
    // 2 unités alors qu'il n'en reste qu'1 : quarantaine, la matière n'est pas comptée.
    const over = await receive(s.po1, skuA.id, 2, `SUPPLIER_PACKAGE-${tag}-OVER`);
    expect(over.body.quarantined).toBe(true);
    expect(await lineReceived(s.k102.items[0].lineId)).toBe(0);
    expect((await dossier(agent)).purchase_orders.find((p) => p.id === s.po1).totals.received).toBe(2);
  });

  test('8. reliquat reçu → KOM-102 complète et prête à emballer ; KOM-101 attend toujours B ; B reçu → KOM-101 prête', async () => {
    expect((await receive(s.po1, skuA.id, 1, `SUPPLIER_PACKAGE-${tag}-2`)).status).toBe(201);
    let d = await dossier(agent);
    expect(orderOf(d, s.k102).readiness).toMatchObject({ complete: true, ready_to_pack: true });
    expect(orderOf(d, s.k101).readiness.ready_to_pack).toBe(false);
    expect(d.purchase_orders.find((p) => p.id === s.po1).step).toMatchObject({ key: 'received' });
    expect(d.purchase_orders.find((p) => p.id === s.po1).step.partial).toBeUndefined();
    expect(d.cockpit.todo.find((t) => t.kind === 'PREPARE_BAG' && t.subject.order_id === s.k102.orderId).action.type).toBe('create_bag');

    expect((await receive(s.poB, skuB.id, 1, `SUPPLIER_PACKAGE-${tag}-B`)).status).toBe(201);
    d = await dossier(agent);
    expect(orderOf(d, s.k101).readiness).toMatchObject({ complete: true, ready_to_pack: true });
    expect(orderOf(d, s.k101).totals).toMatchObject({ requested: 3, received: 3, remaining: 0 });
  });

  test('8b. sac ouvert ≠ sac fermé ≠ en KOM-BOX : états d\'unité distincts, jamais « boxed » pour un sac ouvert', async () => {
    const unitId = (await q('SELECT id FROM hub_physical_units WHERE reference=$1', [`SUPPLIER_PACKAGE-${tag}-2`])).rows[0].id;
    const move = async (id, states) => { for (const st of states) expect((await hubOps.transitionOperatorUnitCommand({ unit_id: id, to_state: st, location_ref: 'HUB-DXB-A1' }, admin.id)).status).toBe(200); };
    await move(unitId, ['IDENTIFIED', 'QUALITY_CHECKED', 'LOCATED', 'ALLOCATED', 'PICKED']);
    const bag = await hubOps.createOperatorUnitCommand({ unit_type: 'HANDLING_UNIT', order_id: s.k102.orderId, bag_plan: [{ order_item_id: s.k102.items[0].itemId, quantity: 1 }] }, admin.id);
    expect(bag.status).toBe(201);
    const bagId = bag.body.physical_unit.id;
    const code = `0088${Date.now()}`;
    await q("INSERT INTO product_sku_physical_codes (product_sku_id,supplier_id,code,code_type,trust,printed_on_pack,confirmed_by,confirmed_at,confirmation_proof_ref) VALUES($1,$2,$3,'SUPPLIER_BARCODE','CONFIRMED',true,$4,now(),'observation-emballage')", [skuA.id, supplierA, code, admin.id]);
    const alloc = (await q('SELECT id FROM hub_purchase_allocations WHERE purchase_line_id=$1', [s.k102.items[0].lineId])).rows[0].id;
    const moved = await hubOps.moveAllocationCommand({ from_unit_id: unitId, to_unit_id: bagId, allocation_id: alloc, quantity: 1, operation_type: 'REPACK', evidence_method: 'SCAN', evidence_code: code }, admin.id);
    expect(JSON.stringify(moved)).toContain('"status":200');
    let d = await dossier(agent);
    expect(itemOf(d, s.k102, 0).units.map((u) => u.state)).toEqual(['bag_open']);
    expect(d.cockpit.unit_legend.map((g) => g.state)).toEqual(expect.arrayContaining(['bag_open', 'bag_closed', 'boxed']));
    expect(d.cockpit.unit_legend.find((g) => g.state === 'bag_open').label).toBe('En sac (ouvert)');
    await move(bagId, ['IDENTIFIED', 'QUALITY_CHECKED', 'LOCATED', 'ALLOCATED', 'PICKED', 'PACKED']);
    d = await dossier(agent);
    expect(itemOf(d, s.k102, 0).units.map((u) => u.state)).toEqual(['bag_closed']);
    expect(itemOf(d, s.k102, 0).units.map((u) => u.state)).not.toContain('boxed');
  });

  test('9. KOM-103 (sans fournisseur) reste un besoin sans ligne ni PO ; cohérence après rechargement (lecture déterministe)', async () => {
    const d1 = await dossier(agent);
    const d2 = await dossier(agent);
    const strip = (d) => JSON.parse(JSON.stringify({ ...d, generated_at: null }));
    expect(strip(d2)).toEqual(strip(d1));
    expect(orderOf(d1, s.k103).po_ids).toEqual([]);
    expect(orderOf(d1, s.k103).items[0]).toMatchObject({ sourcing_required: true, received: 0 });
    expect((await q('SELECT count(*)::int AS n FROM purchase_lines WHERE order_item_id=$1', [s.k103.items[0].itemId])).rows[0].n).toBe(0);
  });

  test('10. trace commande ↔ PO ↔ réception cohérente avec le dossier', async () => {
    const trace = await dossierService.getTrace({ purchaseOrderId: s.po1, allowedMarketIds: [km] });
    const byOrder = Object.fromEntries(trace.chain.map((c) => [c.order_id, c]));
    expect(byOrder[s.k101.orderId].placements.filter((p) => p.active).reduce((t, p) => t + p.quantity, 0)).toBe(2);
    expect(byOrder[s.k102.orderId].placements.filter((p) => p.active).reduce((t, p) => t + p.quantity, 0)).toBe(1);
  });

  test('T10/HB-12 PG16 : trois colis locaux sans capacité -> tâche datée de la file', async () => {
    // Donnees strictement isolees dans la base PostgreSQL ephemere du job.
    // Chaque colis a un article local deja affecte ; la commande entrante
    // a 30 unites, donc aucun des trois colis (capacite 30) ne peut l'absorber.
    const refs = [];
    for (let n = 0; n < 3; n++) {
      const carrier = await makeOrder({
        reference: `${tag}-T10-CARRIER-${n}`, minutesAgo: 15 + n,
        items: [{ sku: skuC, qty: 1, source: 'LOCAL_STOCK' }],
      });
      const parcelId = id();
      await q(
        "INSERT INTO parcels(id,order_id,relais_id,reference,status,type) " +
        "VALUES($1,$2,$3,$4,'preparation','standard')",
        [parcelId, carrier.orderId, relais, `${tag}-T10-PARCEL-${n}`]
      );
      await q(
        'INSERT INTO parcel_items(id,parcel_id,order_item_id,product_id,quantity) VALUES($1,$2,$3,$4,1)',
        [id(), parcelId, carrier.items[0].itemId, skuC.productId]
      );
      refs.push(parcelId);
    }
    const pending = await makeOrder({
      reference: `${tag}-T10-WAITING`, minutesAgo: 5,
      items: [{ sku: skuC, qty: 30, source: 'LOCAL_STOCK' }],
    });
    const before = await q(
      'SELECT COUNT(*)::int AS n FROM parcel_items pi JOIN order_items oi ON oi.id=pi.order_item_id WHERE oi.order_id=$1',
      [pending.orderId]
    );
    expect(before.rows[0].n).toBe(0);
    const live = await dossier(agent);
    const task = live.cockpit.todo.find(t => t.id === 'PARCEL_CAPACITY_WAIT:' + pending.orderId);
    expect(task).toBeDefined();
    expect(task).toMatchObject({
      kind: 'PARCEL_CAPACITY_WAIT',
      owner: 'agent_hub',
      severity: 'anomaly',
      subject: { order_id: pending.orderId },
      overdue: false,
    });
    expect(task.missing).toContain('(3 ouverts)');
    expect(task.since).toBeTruthy();
    const director = await dossierService.getDirectorTodo();
    expect(director.tasks.some(t => t.id === task.id)).toBe(true);
    const after = await q(
      'SELECT COUNT(*)::int AS n FROM parcel_items pi JOIN order_items oi ON oi.id=pi.order_item_id WHERE oi.order_id=$1',
      [pending.orderId]
    );
    expect(after.rows[0].n).toBe(0);
    const open = await q(
      "SELECT COUNT(*)::int AS n FROM parcels WHERE id = ANY($1::uuid[]) AND status IN ('draft','preparation')",
      [refs]
    );
    expect(open.rows[0].n).toBe(3);
  });
}
