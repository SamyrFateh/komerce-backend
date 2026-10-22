'use strict';

/**
 * @test-kind e2e
 * @test-runner jest
 * @test-requires postgres
 *
 * CERTIFICATION MULTI-MARCHÉ KM / CM / CG / DJ (stabilisation monétaire).
 *
 * Un même scénario canonique rejoué sur quatre marchés synthétiques ACTIVE (devises KMF, XAF, XAF, DJF),
 * sur PostgreSQL réel, via les routes réelles (POST /api/orders, webhook Stripe signé) et l'écrivain
 * canonique de statut :
 *   catalogue local actif → prix → panier/checkout → paiement contrôlé → achat fournisseur + réception
 *   → transport → remise → réconciliation monétaire (devise commerciale / EUR / base moteur).
 * Cas de refus : moyen d'encaissement non autorisé, transport hors tarif (fail-closed), DJ sans taux approuvé,
 * remboursement wallet hors KMF. Cas d'isolation : produit/tarif d'un marché invisible depuis un autre.
 *
 * ATTENTION : l'observation EUR/USD utilisée pour DJ est une FIXTURE DE TEST non réelle ; ce spec ne certifie
 * pas un taux de production (GO technique uniquement — ni GO staging, ni GO commercial).
 */
const request = require('supertest');
const express = require('express');
const Stripe = require('stripe');
const { signAuthToken } = require('../../utils/auth-session');
const {
  describeE2E, createCleanup, activateLocalPrice, authorizeCentralCollectionForTest,
  seedPhysicalReceiptForTest, seedApprovedEurUsdObservationForTest, tag, uuid,
} = require('../helpers/e2eDbKit');

jest.setTimeout(120000);

// Tarif de vente transport par marché (par kg) dans la devise commerciale ; KM utilise le tarif global KMF.
const MARKETS = [
  { label: 'KM', currency: 'KMF', price: 25000, tariff: null },
  { label: 'CM', currency: 'XAF', price: 38000, tariff: 90 },
  { label: 'CG', currency: 'XAF', price: 41000, tariff: 95 },
  { label: 'DJ', currency: 'DJF', price: 9000, tariff: 450 },
];
const CODES = ['GA', 'SN', 'BJ', 'TG', 'GH', 'KE', 'TZ', 'UG', 'RW', 'ML', 'NE', 'BF'];

describeE2E('CERTIFICATION multi-marché KM/CM/CG/DJ', ({ db }) => {
  const stripe = Stripe(process.env.STRIPE_SECRET_KEY || 'sk_test_dummy');
  const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || 'whsec_dummy';
  const { transitionOrderStatus } = require('../../services/order-status-machine');
  const fx = require('../../services/fx-authority');
  const ADMIN = { id: null, role: 'admin' };

  let cleanup; let app; let token; const buyerId = uuid(); const ctx = {};

  const signed = (payload) => {
    const raw = JSON.stringify(payload);
    return { raw, signature: stripe.webhooks.generateTestHeaderString({ payload: raw, secret: WEBHOOK_SECRET }) };
  };
  const stripeEvent = ({ eventId, intentId, orderId, reference, cents }) => ({
    id: eventId, object: 'event', type: 'payment_intent.succeeded', created: Math.floor(Date.now() / 1000),
    data: { object: { id: intentId, object: 'payment_intent', amount: cents, currency: 'eur', status: 'succeeded',
      metadata: { order_id: orderId, order_reference: reference, komerce: 'true' } } },
  });
  const body = (c, extra = {}) => ({
    items: [{ product_id: c.productId, quantity: 1 }], relais_id: c.relaisId,
    payment_mode: 'stripe_eur', tracking_phone: '+269000999', ...extra,
  });
  const post = (c, extra) => request(app).post('/api/orders').set('Authorization', `Bearer ${token}`).send(body(c, extra));
  const trackOrder = (orderId) => {
    cleanup.trackSql(`SET session_replication_role = replica;
      DELETE FROM refunds WHERE order_id='${orderId}';
      DELETE FROM invoices WHERE order_id='${orderId}';
      DELETE FROM order_item_cost_imputations WHERE order_id='${orderId}';
      DELETE FROM order_item_real_cost_allocations WHERE order_id='${orderId}';
      DELETE FROM order_cost_entry_events WHERE order_id='${orderId}';
      DELETE FROM pickup_reveal_codes WHERE order_id='${orderId}';
      DELETE FROM pickup_print_tokens WHERE order_id='${orderId}';
      DELETE FROM transaction_documents WHERE order_id='${orderId}';
      DELETE FROM sms_log WHERE order_id='${orderId}';
      DELETE FROM scans WHERE order_id='${orderId}';
      DELETE FROM parcels WHERE order_id='${orderId}';
      DELETE FROM mobile_money_transactions WHERE order_id='${orderId}';
      DELETE FROM cash_collections WHERE order_id='${orderId}';
      DELETE FROM order_items WHERE order_id='${orderId}';
      DELETE FROM order_status_history WHERE order_id='${orderId}';
      DELETE FROM orders WHERE id='${orderId}';
      SET session_replication_role = origin;`);
  };

  beforeAll(async () => {
    cleanup = createCleanup(db);
    const { rows: used } = await db.query('SELECT code FROM markets');
    const occupied = new Set(used.map((r) => r.code));
    const free = CODES.filter((c) => !occupied.has(c));
    if (free.length < MARKETS.length) throw new Error('Pas assez de codes marché E2E libres');

    await db.query(`INSERT INTO users (id, full_name, email, phone, role) VALUES ($1,'E2E Certif Buyer',$2,$3,'client')`,
      [buyerId, `${tag('certif')}@komerce.test`, `+2693${Math.floor(Math.random() * 9e6 + 1e6)}`]);
    cleanup.trackSql(`DELETE FROM users WHERE id='${buyerId}'`);
    token = signAuthToken({ id: buyerId, role: 'client' }, { method: 'e2e' });

    for (const [i, m] of MARKETS.entries()) {
      const c = { ...m, marketId: uuid(), relaisId: uuid(), productId: uuid(), code: free[i] };
      await db.query(`INSERT INTO markets (id,code,name,currency,minor_unit,is_active,lifecycle_status)
                      VALUES ($1,$2,$3,$4,0,true,'ACTIVE')`, [c.marketId, c.code, `E2E Certif ${m.label}`, m.currency]);
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
      await db.query(`INSERT INTO relais (id,name,agent_name,phone,address,island,market_id)
                      VALUES ($1,$2,'E2E Agent','+269000555','E2E Certif','Ngazidja',$3)`,
      [c.relaisId, `E2E Relais ${m.label} ${tag('r')}`, c.marketId]);
      await db.query('INSERT INTO products (id,name,price_kmf,stock) VALUES ($1,$2,25000,50)', [c.productId, `E2E Certif ${m.label} ${tag('p')}`]);
      cleanup.trackSql(`DELETE FROM products WHERE id='${c.productId}'`);
      await activateLocalPrice(db, cleanup, { marketId: c.marketId, productId: c.productId, amount: m.price, currency: m.currency });
      ctx[m.label] = c;
    }

    app = express();
    app.use(require('cookie-parser')());
    app.use('/api/payments', require('../../routes/payments'));
    app.use(express.json());
    app.use('/api/orders', require('../../routes/orders'));
    app.use((err, _req, res, _next) => res.status(err.status || 500).json({ error: err.message, code: err.code }));
  });

  afterAll(async () => { if (cleanup) await cleanup.run(); });

  // ── Refus communs : fail-closed avant toute autorisation explicite ────────────────────────────────────────
  describe.each(MARKETS.map((m) => [m.label]))('%s — refus fail-closed', (label) => {
    it('moyen d’encaissement central non autorisé → 409 PAYMENT_MODE_NOT_ALLOWED_FOR_MARKET', async () => {
      const res = await post(ctx[label]);
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('PAYMENT_MODE_NOT_ALLOWED_FOR_MARKET');
    });
  });

  it('DJ — sans observation EUR/USD approuvée valable à la date, la conversion est refusée (jamais de taux inventé)', async () => {
    await expect(fx.convert({ amount: '1000', from: 'KMF', to: 'DJF', at: '2000-01-01T00:00:00Z' }))
      .rejects.toMatchObject({ code: 'fx_rate_unavailable' });
  });

  it('devise hors périmètre de l’autorité (PLN) → refus typé, pas de repli', async () => {
    await expect(fx.convert({ amount: '1000', from: 'KMF', to: 'PLN' }))
      .rejects.toMatchObject({ code: 'fx_currency_unsupported' });
  });

  // ── Transport hors tarif : fail-closed pour les marchés non-KMF sans tarif de vente propre ────────────────
  it.each(['CM', 'CG', 'DJ'])('%s — transport hors tarif de vente du marché → 409 MARKET_TRANSPORT_TARIFF_MISSING', async (label) => {
    const c = ctx[label];
    await authorizeCentralCollectionForTest(db, cleanup, c.marketId, 'stripe_eur');
    if (label === 'DJ') await seedApprovedEurUsdObservationForTest(db);
    const res = await post(c);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('MARKET_TRANSPORT_TARIFF_MISSING');
  });

  it('isolation — le tarif d’un marché ne débloque pas un autre marché', async () => {
    await db.query(`INSERT INTO market_transport_sale_rates (market_id,rate_key,rate_per_kg,currency,evidence_ref)
                    VALUES ($1,'SEA_KMF_PER_KG_COMMERCIAL',90,'XAF','e2e-certif-isolation')`, [ctx.CM.marketId]);
    const res = await post(ctx.CG);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('MARKET_TRANSPORT_TARIFF_MISSING');
    await db.query("DELETE FROM market_transport_sale_rates WHERE evidence_ref='e2e-certif-isolation'");
  });

  it('isolation — un produit actif sur un marché n’est pas achetable sur un autre', async () => {
    const res = await post({ ...ctx.KM, productId: ctx.CM.productId });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });

  // ── Parcours nominal complet par marché ─────────────────────────────────────────────────────────────────────
  describe.each(MARKETS.map((m) => [m.label]))('%s — parcours nominal', (label) => {
    let c; let order;

    it('checkout : prix local → commande, transport tarifé, snapshot monétaire figé', async () => {
      c = ctx[label];
      await authorizeCentralCollectionForTest(db, cleanup, c.marketId, 'stripe_eur');
      if (c.tariff != null) {
        await db.query(`INSERT INTO market_transport_sale_rates (market_id,rate_key,rate_per_kg,currency,evidence_ref)
                        VALUES ($1,'SEA_KMF_PER_KG_COMMERCIAL',$2,$3,$4)
                        ON CONFLICT DO NOTHING`, [c.marketId, c.tariff, c.currency, `e2e-certif-${label}`]);
      }
      if (label === 'DJ') await seedApprovedEurUsdObservationForTest(db);
      const res = await post(c);
      expect(res.status).toBe(201);
      c.orderId = res.body.order.id; trackOrder(c.orderId);
      const { rows: [o] } = await db.query(
        `SELECT market_id,status,payment_status,total_kmf,total_eur::text AS total_eur,fx_snapshot,transport_pricing_snapshot
           FROM orders WHERE id=$1`, [c.orderId]);
      order = o;
      expect(order).toMatchObject({ market_id: c.marketId, status: 'pending', payment_status: 'pending' });
      const s = order.fx_snapshot;
      expect(s).toMatchObject({ pivot_currency: 'EUR', origin: { currency: 'KMF' }, market: { currency: c.currency, market_id: c.marketId } });
      expect(Number(s.eur.amount_text)).toBe(Number(order.total_eur));
      if (c.currency !== 'KMF') expect(s.market.legs.length).toBeGreaterThan(0);
      if (c.tariff != null) {
        expect(order.transport_pricing_snapshot).toMatchObject({ market_currency: c.currency, pivot_currency: 'EUR', source: 'market_transport_sale_rates' });
      }
      if (c.currency === 'DJF') {
        // La chaîne EUR→USD→DJF porte l'observation et le peg ; la fixture est explicitement non réelle.
        expect(JSON.stringify(s.market.legs)).toMatch(/observation/);
        expect(JSON.stringify(s.market.legs)).toMatch(/peg/);
      }
    });

    it('paiement contrôlé : un montant ≠ montant EUR figé ne confirme pas ; le montant exact confirme une seule fois', async () => {
      const { rows: [o] } = await db.query('SELECT reference,total_eur::text AS t FROM orders WHERE id=$1', [c.orderId]);
      const exact = Math.round(Number(o.t) * 100);
      const bad = signed(stripeEvent({ eventId: `evt_${tag('bad' + label)}`, intentId: `pi_${tag('bad' + label)}`, orderId: c.orderId, reference: o.reference, cents: exact + 500 }));
      const refused = await request(app).post('/api/payments/stripe/webhook').set('stripe-signature', bad.signature)
        .set('Content-Type', 'application/json').send(bad.raw);
      const { rows: [after] } = await db.query('SELECT payment_status FROM orders WHERE id=$1', [c.orderId]);
      expect(after.payment_status).not.toBe('paid');
      expect([200, 400, 409, 422]).toContain(refused.status);

      const evtId = `evt_${tag('ok' + label)}`;
      const ok = signed(stripeEvent({ eventId: evtId, intentId: `pi_${tag('ok' + label)}`, orderId: c.orderId, reference: o.reference, cents: exact }));
      const res = await request(app).post('/api/payments/stripe/webhook').set('stripe-signature', ok.signature)
        .set('Content-Type', 'application/json').send(ok.raw);
      expect(res.status).toBe(200);
      cleanup.trackSql('DELETE FROM stripe_events_processed WHERE stripe_event_id LIKE $1', [`evt_%${label}%`]);
      const { rows: [paid] } = await db.query('SELECT status,payment_status FROM orders WHERE id=$1', [c.orderId]);
      expect(paid.payment_status).toBe('paid');
      expect(paid.status).toBe('ordered');
      // Rejeu : aucun second effet.
      const replay = await request(app).post('/api/payments/stripe/webhook').set('stripe-signature', ok.signature)
        .set('Content-Type', 'application/json').send(ok.raw);
      expect(replay.status).toBe(200);
      const { rows: hist } = await db.query('SELECT status FROM order_status_history WHERE order_id=$1', [c.orderId]);
      expect(hist.filter((h) => h.status === 'ordered')).toHaveLength(1);
    });

    it('achat fournisseur → réception → transport → remise via l’écrivain canonique', async () => {
      const { rows: [item] } = await db.query('SELECT id FROM order_items WHERE order_id=$1', [c.orderId]);
      await seedPhysicalReceiptForTest(db, cleanup, { orderId: c.orderId, itemId: item.id, productId: c.productId, marketId: c.marketId, relaisId: c.relaisId, quantity: 1 });
      for (const target of ['preparation', 'shipped', 'in_transit', 'available', 'collected']) {
        const r = await transitionOrderStatus({ orderId: c.orderId, newStatus: target, actor: ADMIN, source: 'patch' });
        expect({ target, ok: r.success }).toEqual({ target, ok: true });
      }
      const { rows: [end] } = await db.query('SELECT status FROM orders WHERE id=$1', [c.orderId]);
      expect(end.status).toBe('collected');
    });

    it('réconciliation : devise commerciale, montant confirmé EUR, base moteur et encaissement effectif concordent', async () => {
      const { rows: [o] } = await db.query(
        'SELECT total_kmf,total_eur::text AS eur,fx_snapshot AS s,payment_status FROM orders WHERE id=$1', [c.orderId]);
      expect(o.payment_status).toBe('paid');
      // 1) EUR figé = conversion de la base moteur par l'autorité unique (pas de taux du jour recalculé).
      const eur = await fx.convert({ amount: String(o.total_kmf), from: 'KMF', to: 'EUR' });
      expect(Number(o.eur)).toBe(eur.amount);
      // 2) Le montant commercial figé est exactement celui de l'autorité pour la devise du marché.
      const market = await fx.convert({ amount: String(o.total_kmf), from: 'KMF', to: c.currency });
      expect(o.s.market.amount_text).toBe(market.amount_text);
      // 3) Immuabilité : le snapshot ne peut pas être réécrit.
      await expect(db.query(`UPDATE orders SET fx_snapshot = jsonb_set(fx_snapshot,'{eur,amount_text}','"0.01"') WHERE id=$1`, [c.orderId]))
        .rejects.toThrow();
      // 4) Marge : l'économie reste calculable dans la base moteur (KMF) ; une absence de coût est NULL, jamais 0 inventé.
      const { rows: [m] } = await db.query('SELECT cost_estimated_kmf, margin_estimated_pct FROM orders WHERE id=$1', [c.orderId]);
      if (m.margin_estimated_pct != null) expect(Number.isFinite(Number(m.margin_estimated_pct))).toBe(true);
    });
  });

  // ── Wallet : KMF uniquement, refus explicite hors KMF ─────────────────────────────────────────────────────
  it('wallet — le remboursement sur wallet (KMF) d’une commande d’un marché non-KMF est refusé (409), jamais converti', async () => {
    const { processRefund } = require('../../services/refund-service');
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const { rows: [order] } = await client.query('SELECT * FROM orders WHERE id=$1', [ctx.CM.orderId]);
      const walletOrder = { ...order, payment_mode: 'cash_relais', stripe_payment_id: null };
      await expect(processRefund(client, walletOrder, 100, 0.15, 'cancel', 'e2e-certif', null))
        .rejects.toMatchObject({ code: 'REFUND_WALLET_CURRENCY_UNSUPPORTED', statusCode: 409 });
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });
});
