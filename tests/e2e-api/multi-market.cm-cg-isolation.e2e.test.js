'use strict';

/**
 * @test-kind e2e
 * @test-runner jest
 * @test-requires postgres
 *
 * ISOLATION CM / CG (deux marchés XAF) sur PostgreSQL réel : catalogue/prix, tarifs de transport,
 * encaissement, commandes, remboursements, relais, indicateurs de dashboards. Un tarif ou une autorisation
 * posé(e) sur l'un ne doit jamais débloquer ni modifier l'autre.
 */
const request = require('supertest');
const express = require('express');
const { signAuthToken } = require('../../utils/auth-session');
const {
  describeE2E, createCleanup, activateLocalPrice, authorizeCentralCollectionForTest, tag, uuid,
} = require('../helpers/e2eDbKit');

jest.setTimeout(60000);
const EXPECTED_CROSS_CODE_STATUS = 409;
const EXPECTED_CROSS_CODE = 'market_product_not_exposed';

describeE2E('ISOLATION CM/CG — deux marchés XAF indépendants', ({ db }) => {
  const hub = require('../../services/hub-dashboard-queries');
  const relayDash = require('../../services/relay-dashboard-queries');
  const buyerId = uuid();
  const M = { CM: {}, CG: {} };
  let cleanup; let app; let token;

  const post = (c) => request(app).post('/api/orders').set('Authorization', `Bearer ${token}`).send({
    items: [{ product_id: c.productId, quantity: 1 }], relais_id: c.relaisId,
    payment_mode: 'stripe_eur', tracking_phone: '+269000999',
  });
  const track = (orderId) => cleanup.trackSql(`SET session_replication_role = replica;
    DELETE FROM refunds WHERE order_id='${orderId}';
    DELETE FROM invoices WHERE order_id='${orderId}';
    DELETE FROM order_item_cost_imputations WHERE order_id='${orderId}';
    DELETE FROM order_items WHERE order_id='${orderId}';
    DELETE FROM order_status_history WHERE order_id='${orderId}';
    DELETE FROM orders WHERE id='${orderId}';
    SET session_replication_role = origin;`);
  const setRate = async (c, rate, ev) => {
    await db.query('DELETE FROM market_transport_sale_rates WHERE market_id=$1', [c.marketId]);
    await db.query(`INSERT INTO market_transport_sale_rates (market_id,rate_key,rate_per_kg,currency,evidence_ref)
                    VALUES ($1,'SEA_KMF_PER_KG_COMMERCIAL',$2,'XAF',$3)`, [c.marketId, rate, ev]);
  };
  const snap = async (orderId) => (await db.query(
    'SELECT transport_pricing_snapshot AS t, fx_snapshot AS f, total_kmf FROM orders WHERE id=$1', [orderId])).rows[0];

  beforeAll(async () => {
    cleanup = createCleanup(db);
    const { rows: used } = await db.query('SELECT code FROM markets');
    const occ = new Set(used.map((r) => r.code));
    const free = ['GA', 'SN', 'BJ', 'TG', 'GH', 'KE', 'TZ', 'UG', 'RW', 'ML'].filter((c) => !occ.has(c));
    await db.query(`INSERT INTO users (id,full_name,email,phone,role) VALUES ($1,'E2E Iso Buyer',$2,$3,'client')`,
      [buyerId, `${tag('iso')}@komerce.test`, `+2693${Math.floor(Math.random() * 9e6 + 1e6)}`]);
    cleanup.trackSql(`DELETE FROM users WHERE id='${buyerId}'`);
    token = signAuthToken({ id: buyerId, role: 'client' }, { method: 'e2e' });
    for (const [i, k] of ['CM', 'CG'].entries()) {
      const c = Object.assign(M[k], { marketId: uuid(), relaisId: uuid(), productId: uuid(), price: 30000 + i * 7000 });
      await db.query(`INSERT INTO markets (id,code,name,currency,minor_unit,is_active,lifecycle_status) VALUES ($1,$2,$3,'XAF',0,true,'ACTIVE')`,
        [c.marketId, free[i], `E2E Iso ${k}`]);
      cleanup.trackSql(`SET session_replication_role = replica;
        DELETE FROM market_transport_sale_rates WHERE market_id='${c.marketId}';
        DELETE FROM market_central_collection_modes WHERE market_id='${c.marketId}';
        DELETE FROM market_delivery_attestations WHERE market_id='${c.marketId}';
        DELETE FROM product_market_exposure WHERE market_id='${c.marketId}';
        DELETE FROM product_market_price_drafts WHERE market_id='${c.marketId}';
        DELETE FROM recipients WHERE relais_id='${c.relaisId}';
        DELETE FROM relais WHERE id='${c.relaisId}';
        DELETE FROM markets WHERE id='${c.marketId}';
        SET session_replication_role = origin;`);
      await db.query(`INSERT INTO relais (id,name,agent_name,phone,address,island,market_id) VALUES ($1,$2,'E2E','+269000556','E2E','Ngazidja',$3)`,
        [c.relaisId, `E2E Iso Relais ${k} ${tag('r')}`, c.marketId]);
      await db.query('INSERT INTO products (id,name,price_kmf,stock) VALUES ($1,$2,25000,50)', [c.productId, `E2E Iso ${k} ${tag('p')}`]);
      cleanup.trackSql(`DELETE FROM products WHERE id='${c.productId}'`);
      await activateLocalPrice(db, cleanup, { marketId: c.marketId, productId: c.productId, amount: c.price, currency: 'XAF' });
    }
    app = express();
    app.use(require('cookie-parser')());
    app.use(express.json());
    app.use('/api/orders', require('../../routes/orders'));
    app.use((err, _req, res, _next) => res.status(err.status || 500).json({ error: err.message, code: err.code }));
  });

  afterAll(async () => { if (cleanup) await cleanup.run(); });

  it('autorisation d’encaissement : CM autorisé ne débloque pas CG ; révoquer CM ne touche pas CG', async () => {
    await authorizeCentralCollectionForTest(db, cleanup, M.CM.marketId, 'stripe_eur');
    await setRate(M.CM, 90, 'e2e-iso-cm'); await setRate(M.CG, 95, 'e2e-iso-cg');
    const cg = await post(M.CG);
    expect(cg.status).toBe(409);
    expect(cg.body.code).toBe('PAYMENT_MODE_NOT_ALLOWED_FOR_MARKET');
    await authorizeCentralCollectionForTest(db, cleanup, M.CG.marketId, 'stripe_eur');
    const a = await post(M.CM); const b = await post(M.CG);
    expect([a.status, b.status]).toEqual([201, 201]);
    M.CM.orderId = a.body.order.id; M.CG.orderId = b.body.order.id;
    track(M.CM.orderId); track(M.CG.orderId);
    await db.query(`UPDATE market_central_collection_modes SET revoked_at=NOW() WHERE market_id=$1`, [M.CM.marketId]);
    expect((await post(M.CM)).status).toBe(409);
    const still = await post(M.CG);
    expect(still.status).toBe(201);
    track(still.body.order.id);
  });

  it('commandes : chacune rattachée à son marché, relais et devise ; snapshots FX distincts et immuables', async () => {
    const o = await db.query('SELECT id,market_id,relais_id FROM orders WHERE id = ANY($1::uuid[])', [[M.CM.orderId, M.CG.orderId]]);
    const by = Object.fromEntries(o.rows.map((r) => [r.id, r]));
    expect(by[M.CM.orderId]).toMatchObject({ market_id: M.CM.marketId, relais_id: M.CM.relaisId });
    expect(by[M.CG.orderId]).toMatchObject({ market_id: M.CG.marketId, relais_id: M.CG.relaisId });
    const [s1, s2] = [await snap(M.CM.orderId), await snap(M.CG.orderId)];
    expect(s1.f.market.market_id).toBe(M.CM.marketId);
    expect(s2.f.market.market_id).toBe(M.CG.marketId);
    expect(s1.f.market.currency).toBe('XAF');
    expect(s1.t.tariff_lines[0].evidence_ref).toBe('e2e-iso-cm');
    expect(s2.t.tariff_lines[0].evidence_ref).toBe('e2e-iso-cg');
  });

  it('tarifs : changer le tarif CM modifie les futures commandes CM seulement ; l’existant et CG sont inchangés', async () => {
    const before = { cm: await snap(M.CM.orderId), cg: await snap(M.CG.orderId) };
    await setRate(M.CM, 130, 'e2e-iso-cm-v2');
    await authorizeCentralCollectionForTest(db, cleanup, M.CM.marketId, 'stripe_eur');
    const n = await post(M.CM); expect(n.status).toBe(201); track(n.body.order.id);
    const nCg = await post(M.CG); expect(nCg.status).toBe(201); track(nCg.body.order.id);
    const sN = await snap(n.body.order.id); const sCg = await snap(nCg.body.order.id);
    expect(sN.t.tariff_lines[0]).toMatchObject({ rate_per_kg_local: 130, evidence_ref: 'e2e-iso-cm-v2' });
    expect(sCg.t.tariff_lines[0]).toMatchObject({ rate_per_kg_local: 95, evidence_ref: 'e2e-iso-cg' });
    expect(await snap(M.CM.orderId)).toEqual(before.cm);
    expect(await snap(M.CG.orderId)).toEqual(before.cg);
  });

  it('prix locaux : modifier le prix CM ne change pas le montant des commandes CG', async () => {
    const g0 = await post(M.CG); expect(g0.status).toBe(201); track(g0.body.order.id);
    const cgTotalBefore = Number((await snap(g0.body.order.id)).total_kmf);
    await activateLocalPrice(db, cleanup, { marketId: M.CM.marketId, productId: M.CM.productId, amount: 99000, currency: 'XAF' });
    const g = await post(M.CG); expect(g.status).toBe(201); track(g.body.order.id);
    const c = await post(M.CM); expect(c.status).toBe(201); track(c.body.order.id);
    const [tg, tc] = [await snap(g.body.order.id), await snap(c.body.order.id)];
    expect(Number(tc.total_kmf)).toBeGreaterThan(Number(tg.total_kmf));
    expect(Number(tg.total_kmf)).toBe(cgTotalBefore);
    // Produit/relais croisés : refus, jamais de repli sur l'autre marché.
    const cross = await post({ ...M.CG, productId: M.CM.productId });
    expect(cross.status).toBe(EXPECTED_CROSS_CODE_STATUS);
    expect(cross.body.code).toBe(EXPECTED_CROSS_CODE);
  });

  it('dashboards : KPI Hub et Relais filtrés par marché, valeurs non nulles et sans fuite CM↔CG', async () => {
    const { transitionOrderStatus } = require('../../services/order-status-machine');
    const ADMIN = { id: null, role: 'admin' };
    // CM : 1 commande « ordered » ; CG : 2 commandes (« ordered » et « confirmed »).
    const extra = await post(M.CG); expect(extra.status).toBe(201); track(extra.body.order.id);
    for (const [id, steps] of [[M.CM.orderId, ['confirmed', 'ordered']], [M.CG.orderId, ['confirmed', 'ordered']], [extra.body.order.id, ['confirmed']]]) {
      for (const st of steps) expect((await transitionOrderStatus({ orderId: id, newStatus: st, actor: ADMIN, source: 'patch' })).success).toBe(true);
    }
    const scope = (...ks) => ({ authorizedMarkets: new Set(ks.map((k) => M[k].marketId)) });
    const cm = (await hub.getDashboardKPIs(scope('CM'))).orders;
    const cg = (await hub.getDashboardKPIs(scope('CG'))).orders;
    const both = (await hub.getDashboardKPIs(scope('CM', 'CG'))).orders;
    expect(cm.total_active).toBe(1);
    expect(cg.total_active).toBe(2);
    expect(both.total_active).toBe(3);
    const op = { role: 'market_operator' };
    const r = async (...ks) => (await relayDash.getDashboardKPIs(op, scope(...ks))).kpi.total_actives;
    expect(await r('CM')).toBeGreaterThanOrEqual(1);
    expect(await r('CG')).toBeGreaterThan(await r('CM'));
    expect(await r('CM', 'CG')).toBe((await r('CM')) + (await r('CG')));
  });

  it('cycle de vie : un marché SUSPENDED ou non ouvert refuse le checkout sans toucher aux autres', async () => {
    const setLife = (st, active) => db.query('UPDATE markets SET lifecycle_status=$2, is_active=$3 WHERE id=$1', [M.CM.marketId, st, active]);
    try {
      await setLife('SUSPENDED', true);
      const s = await post(M.CM);
      expect(s.status).toBe(409); expect(s.body.code).toBe('MARKET_SUSPENDED');
      await setLife('PROVISIONING', false);
      const p = await post(M.CM);
      expect(p.status).toBe(409); expect(p.body.code).toBe('MARKET_NOT_ACTIVE');
      await authorizeCentralCollectionForTest(db, cleanup, M.CG.marketId, 'stripe_eur');
      const other = await post(M.CG);
      expect(other.status).toBe(201); track(other.body.order.id);
    } finally { await setLife('ACTIVE', true); }
  });

  it('remboursement : un remboursement refusé/appliqué sur CM n’écrit rien sur CG', async () => {
    const { processRefund } = require('../../services/refund-service');
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const { rows: [order] } = await client.query('SELECT * FROM orders WHERE id=$1', [M.CM.orderId]);
      await expect(processRefund(client, { ...order, payment_mode: 'cash_relais', stripe_payment_id: null }, 100, 0.15, 'cancel', 'e2e-iso', null))
        .rejects.toMatchObject({ code: 'REFUND_WALLET_CURRENCY_UNSUPPORTED' });
    } finally { await client.query('ROLLBACK'); client.release(); }
    const r = await db.query('SELECT order_id FROM refunds WHERE order_id = ANY($1::uuid[])', [[M.CM.orderId, M.CG.orderId]]);
    expect(r.rows).toHaveLength(0);
  });
});
