'use strict';

/**
 * @test-kind integration
 * @test-runner jest
 * @test-requires postgres
 * @integration hub-autonomous-purchasing-postgres.test.js
 * @brief HUB lot 1 — achats Hub autonomes : PO manuelle sans API (identité aliexpress, fournisseur local), réception directe sans confirmation fournisseur, reliquat automatique, changement de fournisseur avec filiation, mode API refusé hors provider, périmètre fournisseurs du Hub.
 */


jest.setTimeout(60000);

if (!process.env.DATABASE_URL) {
  describe.skip('hub-autonomous-purchasing (needs DATABASE_URL)', () => { test('skipped', () => {}); });
} else {
  const crypto = require('crypto');
  const { submitAuthorized } = require('../helpers/submit-authorized');
  const request = require('supertest');
  const db = require('../../db');
  const grouped = require('../../services/purchasing-grouped-service');
  const engagement = require('../../services/purchasing-engagement-service');
  const hubOps = require('../../services/hub-operations');
  const { createUser, cleanup } = require('./test-harness/seed-helpers');

  const id = () => crypto.randomUUID();
  const q = (sql, params) => db.query(sql, params);
  const tag = `HAP-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`;
  let app; let admin; let agentHub; let km; let relais; let sku; let seq = 0; let mappingPriority = 0;

  async function makeOrderItem(quantity) {
    const orderId = id(); const itemId = id();
    seq += 1;
    await q(`INSERT INTO orders(id,user_id,relais_id,market_id,reference,status,payment_status,payment_mode,total_kmf,total_eur)
             VALUES($1,$2,$3,$4,$5,'ordered','paid','stripe_eur',10000,20)`, [orderId, admin.id, relais, km, `${tag}-O${seq}`]);
    await q(`INSERT INTO order_items(id,order_id,product_id,quantity,price_kmf,sku_id,fulfillment_source)
             VALUES($1,$2,$3,$4,10000,$5,'IMPORT')`, [itemId, orderId, sku.productId, quantity, sku.id]);
    return itemId;
  }

  async function localSupplier(name) {
    const supplier = id(); const mapping = id();
    await q("INSERT INTO suppliers(id,name,platform,is_active) VALUES($1,$2,'local',true)", [supplier, `${name} ${tag}`]);
    // Priorité unique par produit parmi les associations actives (migration 395) : une priorité distincte par fournisseur.
    mappingPriority += 1;
    await q(`INSERT INTO product_suppliers(id,product_id,supplier_id,supplier_sku,supplier_price_aed,priority) VALUES($1,$2,$3,$4,42,$5)`,
      [mapping, sku.productId, supplier, `LOCAL-${name}`, mappingPriority]);
    return { supplier, mapping };
  }

  beforeAll(async () => {
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'ci-test-secret-not-for-prod';
    jest.spyOn(require('../../bootstrap/crons'), 'startOperationalCrons').mockImplementation(() => {});
    app = require('../../server');
    await new Promise((resolve) => setTimeout(resolve, 2000));
    admin = await createUser({ role: 'admin' });
    agentHub = await createUser({ role: 'agent_hub' });
    km = (await q("SELECT id FROM markets WHERE code='KM'")).rows[0].id;
    relais = id();
    await q("INSERT INTO relais(id,name,agent_name,phone,address,market_id) VALUES($1,$2,'A','+2693000009','R',$3)", [relais, `R-${tag}`, km]);
    // Identité produit = aliexpress : jamais une obligation d'exécution API.
    const productId = id(); const skuId = id();
    const identity = { provider: 'aliexpress', version: 1, payload: { supplier_sku: `${tag}-S` } };
    await q(`INSERT INTO products(id,name,price_kmf,cost_kmf,volume_cm3,stock,price_aed,inventory_model) VALUES($1,$2,10000,3000,1000,0,100,'SKU')`, [productId, `Produit ${tag}`]);
    await q(`INSERT INTO product_skus(id,product_id,sku,stock,is_active,source,supplier_sku,supplier_unit_ref,supplier_order_identity)
             VALUES($1,$2,$3,0,true,'SUPPLIER',$4,$5,$6::jsonb)`, [skuId, productId, `${tag}-SKU`, identity.payload.supplier_sku, `${tag}-U`, JSON.stringify(identity)]);
    sku = { id: skuId, productId };
  });
  afterAll(async () => { await cleanup(); await db.pool.end().catch(() => {}); });

  test('PO manuelle : article aliexpress acheté chez un fournisseur local, sans aucune préparation distante', async () => {
    const item = await makeOrderItem(5);
    const { supplier, mapping } = await localSupplier('Boutique');
    const created = await engagement.createManualLine({ order_item_id: item, product_supplier_id: mapping, quantity: 5 }, { actor: admin });
    expect(created.line.supplier_order_identity?.provider ?? created.line.supplier_sku).toBeTruthy();
    const lineId = created.line.line_id;
    const po = (await grouped.preparePurchaseOrder({ supplier_id: supplier, procurement_hub_ref: 'DXB', line_ids: [lineId] }, { actor: admin })).purchase_order;
    expect((await q('SELECT trigger_mode FROM purchase_orders WHERE id=$1', [po.id])).rows[0].trigger_mode).toBe('manual');

    const submitted = await submitAuthorized(engagement, po.id, { actor: admin });
    expect(submitted.preflights.every((p) => p.status === 'MANUAL' && p.provider === 'aliexpress')).toBe(true);
    expect(submitted.purchase_order.status).toBe('notified');

    // Réception directe, sans confirmation fournisseur : 3 sur 5.
    const rec = await hubOps.receiveSupplierPackageCommand({
      reference: `${tag}-COLIS`, location_ref: 'HUB-DXB-RECEIVE',
      contents: [{ purchase_order_id: po.id, product_sku_id: sku.id, quantity: 3 }],
    }, admin.id);
    expect(rec.status).toBe(201);

    // Réception partielle : clôture de la ligne à 3 → reliquat (2) conservé automatiquement, filiation parent_line_id.
    const settled = await engagement.settleLine(lineId, { settled_quantity: 3, reason: 'livraison partielle fournisseur local' }, { actor: admin });
    expect(settled.remnant).toMatchObject({ quantity: 2, parent_line_id: lineId, purchase_order_id: null });
    expect(settled.purchase_order.status).toBe('hub_received');
    const need = (await q(
      `SELECT COALESCE(SUM(public.purchase_line_effective_quantity(cancelled_at, settled_quantity, confirmed_quantity, quantity)),0)::int AS n
         FROM purchase_lines WHERE order_item_id=$1`, [item])).rows[0].n;
    expect(need).toBe(5); // 3 soldées + 2 reliquat : aucun double comptage
  });

  test('mode API refusé pour un fournisseur sans intégration distante ; mode invalide refusé', async () => {
    const item = await makeOrderItem(1);
    const { supplier, mapping } = await localSupplier('Local2');
    const { line } = await engagement.createManualLine({ order_item_id: item, product_supplier_id: mapping, quantity: 1 }, { actor: admin });
    await expect(grouped.preparePurchaseOrder({ supplier_id: supplier, procurement_hub_ref: 'DXB', line_ids: [line.line_id], execution_mode: 'api' }))
      .rejects.toMatchObject({ status: 409, code: 'PURCHASE_ORDER_API_UNAVAILABLE' });
    await expect(grouped.preparePurchaseOrder({ supplier_id: supplier, procurement_hub_ref: 'DXB', line_ids: [line.line_id], execution_mode: 'x' }))
      .rejects.toMatchObject({ status: 400 });
  });

  test('changement de fournisseur : ancienne ligne annulée conservée, nouvelle ligne filiée, besoin non doublé', async () => {
    const item = await makeOrderItem(4);
    const a = await localSupplier('ChangeA');
    const b = await localSupplier('ChangeB');
    const first = (await engagement.createManualLine({ order_item_id: item, product_supplier_id: a.mapping, quantity: 4 }, { actor: admin })).line.line_id;
    await grouped.preparePurchaseOrder({ supplier_id: a.supplier, procurement_hub_ref: 'DXB', line_ids: [first] }, { actor: admin });

    const out = await engagement.changeLineSupplier(first, { product_supplier_id: b.mapping, reason: 'A en rupture' }, { actor: admin });
    expect(out.line).toMatchObject({ quantity: 4, parent_line_id: first, purchase_order_id: null });
    const old = (await q('SELECT cancelled_at, purchase_order_id, cancel_reason FROM purchase_lines WHERE id=$1', [first])).rows[0];
    expect(old.cancelled_at).not.toBeNull();
    expect(old.purchase_order_id).toBeNull();
    expect(old.cancel_reason).toMatch(/A en rupture/);
    const need = (await q(
      `SELECT COALESCE(SUM(public.purchase_line_effective_quantity(cancelled_at, settled_quantity, confirmed_quantity, quantity)),0)::int AS n
         FROM purchase_lines WHERE order_item_id=$1`, [item])).rows[0].n;
    expect(need).toBe(4);
    await expect(engagement.changeLineSupplier(first, { product_supplier_id: b.mapping, reason: 'x' })).rejects.toMatchObject({ code: 'PURCHASE_LINE_ALREADY_CANCELLED' });
  });

  test('une ligne engagée (PO soumise) ne change pas de fournisseur directement', async () => {
    const item = await makeOrderItem(2);
    const a = await localSupplier('EngA');
    const b = await localSupplier('EngB');
    const line = (await engagement.createManualLine({ order_item_id: item, product_supplier_id: a.mapping, quantity: 2 }, { actor: admin })).line.line_id;
    const po = (await grouped.preparePurchaseOrder({ supplier_id: a.supplier, procurement_hub_ref: 'DXB', line_ids: [line] }, { actor: admin })).purchase_order;
    await submitAuthorized(engagement, po.id, { actor: admin });
    await expect(engagement.changeLineSupplier(line, { product_supplier_id: b.mapping, reason: 'x' }))
      .rejects.toMatchObject({ status: 409, code: 'PURCHASE_ORDER_NOT_DRAFT' });
  });

  test('périmètre HTTP : le Hub crée un fournisseur local mappé ; il ne crée pas d\'API ni ne touche au catalogue global', async () => {
    const auth = ['Authorization', `Bearer ${agentHub.token}`];
    const refused = await request(app).post('/api/purchasing/suppliers').set(...auth).send({ name: `Ali ${tag}`, platform: 'aliexpress' });
    expect(refused.status).toBe(403);
    const withKey = await request(app).post('/api/purchasing/suppliers').set(...auth).send({ name: `Loc ${tag}`, platform: 'local', api_key_enc: 'k' });
    expect(withKey.status).toBe(403);

    const created = await request(app).post('/api/purchasing/suppliers').set(...auth).send({ name: `Marché ${tag}`, platform: 'local', contact_phone: '+97150000' });
    expect(created.status).toBe(201);
    expect(created.body.owner_scope).toBe('hub');

    const noPrice = await request(app).post(`/api/purchasing/suppliers/${created.body.id}/map`).set(...auth).send({ product_id: sku.productId, supplier_sku: 'L1' });
    expect(noPrice.status).toBe(400);
    const mapped = await request(app).post(`/api/purchasing/suppliers/${created.body.id}/map`).set(...auth)
      .send({ product_id: sku.productId, supplier_sku: 'L1', supplier_price_aed: 30 });
    expect(mapped.status).toBe(201);
    // Produit déjà associé à d'autres fournisseurs : priorité automatique = première libre après la plus haute,
    // jamais un doublon (migration 395) ; un second appel (upsert) conserve la priorité attribuée.
    const others = (await q('SELECT MAX(priority)::int AS m FROM product_suppliers WHERE product_id=$1 AND supplier_id<>$2 AND is_active AND deleted_at IS NULL',
      [sku.productId, created.body.id])).rows[0].m;
    expect(mapped.body.priority).toBe(others + 1);
    const remapped = await request(app).post(`/api/purchasing/suppliers/${created.body.id}/map`).set(...auth)
      .send({ product_id: sku.productId, supplier_sku: 'L1', supplier_price_aed: 31 });
    expect(remapped.body.priority).toBe(others + 1);
    // Priorité explicite déjà prise par une autre association active : 409 clair, aucune écriture.
    const taken = await request(app).post(`/api/purchasing/suppliers/${created.body.id}/map`).set(...auth)
      .send({ product_id: sku.productId, supplier_sku: 'L1', supplier_price_aed: 31, priority: 1 });
    expect(taken.status).toBe(409);
    expect(taken.body.code).toBe('PRODUCT_SUPPLIER_PRIORITY_CONFLICT');
    const invalid = await request(app).post(`/api/purchasing/suppliers/${created.body.id}/map`).set(...auth)
      .send({ product_id: sku.productId, supplier_sku: 'L1', supplier_price_aed: 31, priority: 0 });
    expect(invalid.status).toBe(400);

    const globalSupplier = id();
    await q("INSERT INTO suppliers(id,name,platform,is_active) VALUES($1,$2,'local',true)", [globalSupplier, `Global ${tag}`]);
    const foreign = await request(app).post(`/api/purchasing/suppliers/${globalSupplier}/map`).set(...auth)
      .send({ product_id: sku.productId, supplier_sku: 'G1', supplier_price_aed: 30 });
    expect(foreign.status).toBe(403);
    expect((await q('SELECT count(*)::int AS n FROM product_suppliers WHERE supplier_id=$1', [globalSupplier])).rows[0].n).toBe(0);

    // L'admin garde le catalogue global, et le mapping Hub n'est jamais choisi par le déclencheur automatique.
    const list = await request(app).get('/api/purchasing/suppliers').set(...auth);
    expect(list.status).toBe(200);
    const adminCreated = await request(app).post('/api/purchasing/suppliers').set('Authorization', `Bearer ${admin.token}`).send({ name: `Adm ${tag}`, platform: 'aliexpress' });
    expect(adminCreated.status).toBe(201);
    expect(adminCreated.body.owner_scope).toBeNull();
  });
}
