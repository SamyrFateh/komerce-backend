'use strict';

/**
 * @test-kind e2e
 * @test-runner jest
 * @test-requires postgres
 */
/**
 * E2E-HUB-COCKPIT — Hub Live concept C : parcours HTTP avec rôles
 *
 * Feature propriétaire : logistics
 * Features traversées  : purchasing, market-delegation
 *
 * Prouve (vraie base PostgreSQL de test, vraies routes, jetons par rôle) :
 * - l'agent Hub prépare/exécute mais ne peut autoriser ni l'engagement ni le paiement ;
 * - l'admin central ne gagne aucun pouvoir artificiel (pas de grant → 403) ;
 * - la responsable Hub (grants attribués par l'admin) autorise l'engagement PUIS, séparément, le paiement ;
 * - réception partielle 2/3 : FIFO sur la commande la plus ancienne, reliquat conservé, rejeu idempotent ;
 * - une commande partiellement reçue n'est jamais emballée sans préparation partielle EXPLICITE ;
 * - une commande locale ne passe pas par le Hub (aucun sac, absente du dossier).
 */

const request = require('supertest');
const { describeE2E } = require('../helpers/e2eDbKit');
const { createMarketDelegationFixture, makeApp, bearer, uuid, tag } = require('../helpers/marketDelegationE2EKit');

jest.setTimeout(90000);

describeE2E('E2E-HUB-COCKPIT — rôles et parcours HTTP', ({ db }) => {
  let fx; let app; let agent; let directrice; let relais; let supplier; let skuA; let skuB; let o101; let o102; let local;
  const q = (sql, params) => db.query(sql, params);
  const WS = () => `/api/admin/workspaces/operations/market/${fx.marketA.code}`;
  const auth = (user) => ({ Authorization: user.token });

  async function hubUser(label, caps) {
    const id = uuid();
    const email = `${tag(label)}@komerce.test`.toLowerCase();
    await q("INSERT INTO users(id,full_name,email,phone,role) VALUES($1,$2,$3,$4,'agent_hub')", [id, `${label} e2e`, email, `+2693${String(Math.floor(Math.random() * 1e7)).padStart(7, '0')}`]);
    fx.cleanup.trackSql('DELETE FROM users WHERE id=$1', [id]);
    const membership = uuid();
    await q("INSERT INTO assignment_memberships(id,assignment_id,user_id,status,granted_by) VALUES($1,$2,$3,'ACTIVE',$4)", [membership, fx.assignmentA.id, id, fx.central.id]);
    fx.cleanup.track('assignment_memberships', 'id', membership);
    for (const capability of caps) {
      const grant = uuid();
      await q('INSERT INTO membership_capabilities(id,membership_id,capability,granted_by) VALUES($1,$2,$3,$4)', [grant, membership, capability, fx.central.id]);
      fx.cleanup.track('membership_capabilities', 'id', grant);
    }
    return { id, role: 'agent_hub', token: bearer(id, 'agent_hub') };
  }

  async function sku(label) {
    const skuId = uuid(); const productId = uuid();
    await q(`INSERT INTO products(id,name,price_kmf,cost_kmf,volume_cm3,stock,price_aed,inventory_model) VALUES($1,$2,10000,3000,1000,0,100,'SKU')`, [productId, `Prod ${label} ${tag('p')}`]);
    const supplierSku = `${tag('s')}-${label}`;
    const identity = { provider: 'whatsapp', version: 1, payload: { supplier_sku: supplierSku } };
    await q(`INSERT INTO product_skus(id,product_id,sku,stock,is_active,source,supplier_sku,supplier_unit_ref,supplier_order_identity)
             VALUES($1,$2,$3,0,true,'SUPPLIER',$4,$5,$6::jsonb)`, [skuId, productId, `${tag('k')}-${label}`, supplierSku, `${supplierSku}-U`, JSON.stringify(identity)]);
    return { id: skuId, productId, supplierSku, identity: JSON.stringify(identity) };
  }

  async function order(reference, minutesAgo, items) {
    const orderId = uuid();
    await q(`INSERT INTO orders(id,user_id,relais_id,market_id,reference,status,payment_status,payment_mode,total_kmf,total_eur,created_at)
             VALUES($1,$2,$3,$4,$5,'ordered','paid','stripe_eur',10000,20, NOW() - ($6 || ' minutes')::interval)`, [orderId, fx.central.id, relais, fx.marketA.id, reference, String(minutesAgo)]);
    const out = [];
    for (const it of items) {
      const itemId = uuid(); const lineId = it.source === 'LOCAL_STOCK' ? null : uuid();
      await q(`INSERT INTO order_items(id,order_id,product_id,quantity,price_kmf,sku_id,fulfillment_source) VALUES($1,$2,$3,$4,10000,$5,$6)`,
        [itemId, orderId, it.sku.productId, it.qty, it.sku.id, it.source || 'IMPORT']);
      if (lineId) {
        await q(`INSERT INTO purchase_lines(id,purchase_order_id,order_item_id,supplier_id,product_sku_id,supplier_sku,supplier_unit_ref,supplier_order_identity,quantity,supplier_unit_price,supplier_currency,procurement_hub_ref)
                 VALUES($1,NULL,$2,$3,$4,$5,$6,$7::jsonb,$8,7,'USD','DXB')`, [lineId, itemId, supplier, it.sku.id, it.sku.supplierSku, `${it.sku.supplierSku}-U`, it.sku.identity, it.qty]);
      }
      out.push({ itemId, lineId });
    }
    return { orderId, items: out, reference };
  }

  beforeAll(async () => {
    fx = await createMarketDelegationFixture(db);
    await q(require('fs').readFileSync(require('path').join(__dirname, '../../migrations/369_single_purchase_model.sql'), 'utf8'));
    // Les capacités execution.* ne sont jamais auto-accordées : on rejoue la migration qui ouvre le plafond (idempotente),
    // puis on les accorde explicitement aux deux comptes Hub du marché de test.
    await q(require('fs').readFileSync(require('path').join(__dirname, '../../migrations/212_market_delegation_execution_ceiling.sql'), 'utf8'));
    app = makeApp([
      { mount: '/api/admin/workspaces/operations', modulePath: '../../routes/admin-operations-workspace' },
      { mount: '/api/purchasing', modulePath: '../../routes/purchasing' },
      { mount: '/api/scans', modulePath: '../../routes/scans' },
    ]);
    const caps = ['operations.read', 'execution.parcel.ship', 'execution.parcel.receive'];
    agent = await hubUser('agent', caps);
    directrice = await hubUser('directrice', caps);
    for (const type of ['purchase_commitment', 'supplier_payment']) {
      await q('INSERT INTO hub_authorization_grants(user_id,authorization_type,granted_by) VALUES($1,$2,$3)', [directrice.id, type, fx.central.id]);
    }
    fx.cleanup.trackSql('DELETE FROM hub_authorization_grants WHERE user_id=$1', [directrice.id]);
    relais = uuid();
    await q("INSERT INTO relais(id,name,agent_name,phone,address,market_id) VALUES($1,$2,'A','+2693000041','R',$3)", [relais, tag('relais'), fx.marketA.id]);
    supplier = uuid();
    await q("INSERT INTO suppliers(id,name,platform,is_active) VALUES($1,$2,'whatsapp',true)", [supplier, tag('fournisseur')]);
    skuA = await sku('A'); skuB = await sku('B');
    o101 = await order(tag('KOM-101'), 30, [{ sku: skuA, qty: 2 }, { sku: skuB, qty: 1 }]);
    o102 = await order(tag('KOM-102'), 20, [{ sku: skuA, qty: 1 }]);
    local = await order(tag('KOM-LOCAL'), 5, [{ sku: skuB, qty: 1, source: 'LOCAL_STOCK' }]);
  });

  // Le journal de garde Hub est append-only (trigger) : la purge de test passe par session_replication_role=replica,
  // uniquement sur des données créées par ce fichier, dans une base de test (garde anti-production du kit).
  async function purge() {
    const orderIds = [o101, o102, local].filter(Boolean).map((o) => o.orderId);
    const client = await db.getClient();
    try {
      await client.query("SET session_replication_role='replica'");
      const { rows: units } = await client.query(
        `SELECT DISTINCT u.id FROM hub_physical_units u
           LEFT JOIN hub_physical_unit_placements p ON p.physical_unit_id = u.id
           LEFT JOIN hub_purchase_allocations a ON a.id = p.allocation_id
          WHERE a.order_id = ANY($1::uuid[]) OR u.order_id = ANY($1::uuid[]) OR u.market_id = $2`, [orderIds, fx.marketA.id]);
      const unitIds = units.map((r) => r.id);
      await client.query('DELETE FROM hub_custody_events WHERE physical_unit_id = ANY($1::uuid[])', [unitIds]);
      await client.query('DELETE FROM hub_box_bags WHERE bag_unit_id = ANY($1::uuid[]) OR box_unit_id = ANY($1::uuid[])', [unitIds]);
      await client.query('DELETE FROM hub_physical_unit_placements WHERE physical_unit_id = ANY($1::uuid[])', [unitIds]);
      await client.query('DELETE FROM hub_physical_units WHERE id = ANY($1::uuid[])', [unitIds]);
      await client.query('DELETE FROM hub_purchase_allocations WHERE market_id = $1', [fx.marketA.id]);
      await client.query('DELETE FROM purchase_order_authorizations WHERE purchase_order_id IN (SELECT id FROM purchase_orders WHERE market_id = $1)', [fx.marketA.id]);
      await client.query('DELETE FROM purchase_lines WHERE order_item_id IN (SELECT id FROM order_items WHERE order_id = ANY($1::uuid[]))', [orderIds]);
      await client.query('DELETE FROM purchase_orders WHERE market_id = $1', [fx.marketA.id]);
      const { rows: tables } = await client.query(
        `SELECT c.table_name FROM information_schema.columns c JOIN information_schema.tables t
           ON t.table_name = c.table_name AND t.table_schema = c.table_schema AND t.table_type = 'BASE TABLE'
          WHERE c.column_name = 'order_id' AND c.table_schema = 'public' AND c.table_name <> 'order_items'`);
      for (const { table_name: table } of tables) {
        await client.query(`DELETE FROM ${table} WHERE order_id = ANY($1::uuid[])`, [orderIds]);
      }
      await client.query('DELETE FROM order_items WHERE order_id = ANY($1::uuid[])', [orderIds]);
      await client.query('DELETE FROM orders WHERE id = ANY($1::uuid[])', [orderIds]);
      await client.query('DELETE FROM market_delegation_audit WHERE actor_user_id = ANY($1::uuid[])', [[agent.id, directrice.id]]);
      await client.query('DELETE FROM relais WHERE id = $1', [relais]);
      await client.query('DELETE FROM suppliers WHERE id = $1', [supplier]);
    } finally {
      await client.query("SET session_replication_role='origin'").catch(() => {});
      client.release();
    }
  }
  afterAll(async () => { if (fx) { await purge().catch((error) => { console.error('purge e2e', error.message); }); await fx.cleanup.run(); } });

  const supply = (user) => request(app).get(`${WS()}/supply`).set(auth(user));
  let poA;

  test('1 — l\'agent Hub lit le cockpit : droits d\'autorisation faux, actions « à faire maintenant » serveur, commande locale absente', async () => {
    const res = await supply(agent);
    expect(res.status).toBe(200);
    expect(res.body.cockpit.viewer).toMatchObject({ role: 'agent_hub', can_authorize_commitment: false, can_authorize_payment: false });
    expect(res.body.cockpit.todo.some((t) => t.kind === 'PREPARE_PO')).toBe(true);
    expect(res.body.orders.map((o) => o.id)).toEqual(expect.arrayContaining([o101.orderId, o102.orderId]));
    expect(res.body.orders.find((o) => o.id === local.orderId)).toBeUndefined();
    const dir = await supply(directrice);
    expect(dir.body.cockpit.viewer).toMatchObject({ can_authorize_commitment: true, can_authorize_payment: true });
  });

  test('2 — l\'agent prépare la PO (A: KOM-101 + KOM-102) ; le rejeu est refusé, aucune PO en double', async () => {
    const lineIds = [o101.items[0].lineId, o102.items[0].lineId];
    const body = { supplier_id: supplier, procurement_hub_ref: 'DXB', line_ids: lineIds };
    const first = await request(app).post('/api/purchasing/po/prepare').set(auth(agent)).send(body);
    expect(first.status).toBe(201);
    poA = first.body.purchase_order.id;
    const replay = await request(app).post('/api/purchasing/po/prepare').set(auth(agent)).send(body);
    expect(replay.status).toBe(409);
    expect(replay.body.code).toBe('PURCHASE_LINES_ALREADY_ATTACHED');
    const count = await q('SELECT count(*)::int AS n FROM purchase_orders WHERE market_id=$1 AND supplier_id=$2', [fx.marketA.id, supplier]);
    expect(count.rows[0].n).toBe(1);
  });

  test('3 — ni l\'agent ni l\'admin n\'autorisent l\'engagement ou le paiement ; la responsable les décide séparément', async () => {
    for (const user of [agent, fx.central]) {
      const c = await request(app).post(`/api/purchasing/po/${poA}/authorize-commitment`).set(auth(user)).send({ proof_ref: 'X' });
      expect(c.status).toBe(403);
      expect(c.body.code).toBe('AUTHORIZATION_GRANT_REQUIRED');
      const p = await request(app).post(`/api/purchasing/po/${poA}/authorize-payment`).set(auth(user)).send({ proof_ref: 'X', amount: 1, currency: 'USD' });
      expect(p.status).toBe(403);
    }
    const ok = await request(app).post(`/api/purchasing/po/${poA}/authorize-commitment`).set(auth(directrice)).send({ proof_ref: 'BC-E2E' });
    expect(ok.status).toBe(201);
    expect(Number(ok.body.amount)).toBe(21);
    const replay = await request(app).post(`/api/purchasing/po/${poA}/authorize-commitment`).set(auth(directrice)).send({ proof_ref: 'BC-E2E-2' });
    expect(replay.status).toBe(200);
    expect(replay.body.idempotent_replay).toBe(true);
    // Contenu figé après validation.
    const detach = await request(app).post(`/api/purchasing/po/${poA}/detach`).set(auth(agent)).send({ line_ids: [o102.items[0].lineId] });
    expect(detach.status).toBe(409);
    expect(detach.body.code).toBe('PURCHASE_ORDER_COMMITMENT_FROZEN');
    // Paiement : refusé avant soumission, même pour la responsable.
    const early = await request(app).post(`/api/purchasing/po/${poA}/authorize-payment`).set(auth(directrice)).send({ proof_ref: 'VIR', amount: 21, currency: 'USD' });
    expect(early.status).toBe(409);
    expect(early.body.code).toBe('PURCHASE_ORDER_NOT_SUBMITTED');
  });

  test('4 — l\'agent soumet et enregistre l\'envoi ; PO approuvée ≠ payée ; paiement autorisé séparément par la responsable', async () => {
    expect((await request(app).post(`/api/purchasing/po/${poA}/submit`).set(auth(agent)).send({})).status).toBe(200);
    expect((await request(app).post(`/api/purchasing/po/${poA}/sent`).set(auth(agent)).send({ channel: 'whatsapp' })).status).toBe(200);
    let po = (await supply(agent)).body.purchase_orders.find((p) => p.id === poA);
    expect(po.step.key).toBe('sent');
    expect(po.authorizations.commitment).toBeTruthy();
    expect(po.authorizations.payment).toBeNull();
    const todo = (await supply(agent)).body.cockpit.todo.find((t) => t.kind === 'AUTHORIZE_PAYMENT' && t.subject.po_id === poA);
    expect(todo).toMatchObject({ owner: 'responsable_hub', viewer_can_act: false });
    const pay = await request(app).post(`/api/purchasing/po/${poA}/authorize-payment`).set(auth(directrice)).send({ proof_ref: 'VIR-E2E', amount: 21, currency: 'USD' });
    expect(pay.status).toBe(201);
    po = (await supply(directrice)).body.purchase_orders.find((p) => p.id === poA);
    expect(po.authorizations.payment).toMatchObject({ currency: 'USD', proof_ref: 'VIR-E2E' });
  });

  test('5 — réception partielle 2/3 (route canonique) : FIFO sur KOM-101, reliquat sur KOM-102, rejeu idempotent', async () => {
    const reference = `SUPPLIER_PACKAGE-${tag('rcv')}`;
    const payload = { reference, contents: [{ purchase_order_id: poA, product_sku_id: skuA.id, quantity: 2 }] };
    const first = await request(app).post('/api/scans/hub/receive').set(auth(agent)).send(payload);
    expect(first.status).toBe(201);
    const replay = await request(app).post('/api/scans/hub/receive').set(auth(agent)).send(payload);
    expect(replay.body.idempotent_replay).toBe(true);
    const units = await q('SELECT count(*)::int AS n FROM hub_physical_units WHERE reference=$1', [reference]);
    expect(units.rows[0].n).toBe(1);
    const res = await supply(agent);
    const item = (o, i) => res.body.orders.find((x) => x.id === o.orderId).items.find((x) => x.id === o.items[i].itemId);
    expect(item(o101, 0)).toMatchObject({ received: 2, remaining_to_deliver: 0 });
    expect(item(o102, 0)).toMatchObject({ received: 0, remaining_to_deliver: 1 });
    expect(res.body.purchase_orders.find((p) => p.id === poA).totals).toMatchObject({ received: 2, missing: 1 });
  });

  test('6 — KOM-101 incomplète : pas de sac sans préparation partielle EXPLICITE ; la commande locale n\'entre jamais au Hub', async () => {
    const plan = [{ order_item_id: o101.items[0].itemId, quantity: 2 }];
    const refused = await request(app).post(`${WS()}/bags`).set(auth(agent)).send({ order_id: o101.orderId, bag_plan: plan });
    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe('HUB_BAG_PARTIAL_NOT_ACKNOWLEDGED');
    expect(refused.body.pending_items.length).toBe(1);
    const explicit = await request(app).post(`${WS()}/bags`).set(auth(agent)).send({ order_id: o101.orderId, bag_plan: plan, partial_preparation: true });
    expect(explicit.status).toBe(201);
    // Le reliquat reste suivi : B toujours non reçu, la commande n'est pas « prête ».
    const o = (await supply(agent)).body.orders.find((x) => x.id === o101.orderId);
    expect(o.readiness).toMatchObject({ complete: false, ready_to_pack: false });
    const localBag = await request(app).post(`${WS()}/bags`).set(auth(agent)).send({ order_id: local.orderId, bag_plan: [{ order_item_id: local.items[0].itemId, quantity: 1 }], partial_preparation: true });
    expect(localBag.status).toBe(409);
    expect(localBag.body.code).toBe('HUB_BAG_ORDER_NOT_IMPORT');
  });

  test('7 — le navigateur ne fournit jamais le marché ; un compte sans délégation ne lit pas le cockpit', async () => {
    const withMarket = await request(app).get(`${WS()}/supply?market_id=${fx.marketB.id}`).set(auth(agent));
    expect(withMarket.status).toBe(400);
    expect(withMarket.body.code).toBe('client_market_id_forbidden');
    const outsider = await request(app).get(`${WS()}/supply`).set(auth(fx.outsider));
    expect(outsider.status).toBe(403);
  });
});
