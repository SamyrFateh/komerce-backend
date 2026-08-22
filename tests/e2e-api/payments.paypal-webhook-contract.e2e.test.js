'use strict';


/**
 * @test-kind e2e
 * @test-runner jest
 * @test-requires postgres
 */
/**
 * E2E-P0-PAYPAL — payments · contrat de la frontière webhook PayPal
 *
 * Feature propriétaire : payments
 * Features traversées  : orders (machine de statut), inventory (stock),
 *                        catalog, logistics
 *
 * Invariant visé (features/payments.feature.js) :
 *   « idempotence stricte sur tout webhook (Stripe, PayPal) »
 * Couche C du chantier — contrat prestataire : signature valide, signature
 * invalide, rejeu, rejet/timeout du prestataire, incohérence de montant ou de
 * devise, et absence d'effet métier en cas de rejet.
 *
 * FRONTIÈRE RÉSEAU CONTRÔLÉE — et seulement elle.
 * `paypal.verifyWebhookSignature()` appelle l'API PayPal : c'est le seul point
 * simulé, exactement comme le fait déjà
 * tests/integration/post-o8-payments-seams.test.js. Tout le reste est réel :
 * la route Express, `handlePaypalWebhookEvent`, `confirmPaymentCycle`,
 * `order-status-machine`, la table `paypal_events_processed`, les écritures et
 * les contraintes.
 *
 * DOCTRINE RED — les assertions expriment le contrat métier attendu, pas le
 * comportement observé. Un KO est un résultat, pas un motif d'affaiblissement.
 */

const request = require('supertest');
const express = require('express');

// ── Frontière réseau PayPal : contrôlée, jamais la logique métier ───────────
jest.mock('../../services/paypal-client', () => {
  const actual = jest.requireActual('../../services/paypal-client');
  return {
    ...actual,
    verifyWebhookSignature: jest.fn(),
  };
});

const paypal = require('../../services/paypal-client');
const { describeE2E, createCleanup, RUN_TAG, tag, uuid } = require('../helpers/e2eDbKit');

jest.setTimeout(60000);

describeE2E('E2E-P0-PAYPAL — payments · contrat webhook PayPal', ({ db }) => {
  const clientId = uuid();
  const relaisId = uuid();

  let cleanup;
  let app;

  // ── constructeurs d'événements ───────────────────────────────────────────
  function captureCompleted({ eventId, captureId, paypalOrderId, reference, value = '50.00', currency = 'EUR' }) {
    return {
      id: eventId,
      event_type: 'PAYMENT.CAPTURE.COMPLETED',
      create_time: new Date().toISOString(),
      resource: {
        id: captureId,
        status: 'COMPLETED',
        invoice_id: reference,
        custom_id: reference,
        amount: { value, currency_code: currency },
        supplementary_data: { related_ids: { order_id: paypalOrderId } },
      },
    };
  }

  function post(event) {
    return request(app)
      .post('/api/payments/paypal/webhook')
      .set('Content-Type', 'application/json')
      .set('paypal-transmission-id', `tx-${tag('t')}`)
      .set('paypal-transmission-time', new Date().toISOString())
      .set('paypal-transmission-sig', 'sig')
      .set('paypal-cert-url', 'https://api.paypal.com/cert')
      .set('paypal-auth-algo', 'SHA256withRSA')
      .send(JSON.stringify(event));
  }

  async function seedPaidableOrder(label, { stock = 10 } = {}) {
    const productId = uuid();
    const orderId = uuid();
    const paypalOrderId = `PPO-${tag(label)}`;
    const reference = `E2EPP-${tag(label)}`.toUpperCase();

    await db.query(
      `INSERT INTO products (id, name, price_kmf, stock) VALUES ($1, $2, 25000, $3)`,
      [productId, `E2E PayPal ${tag(label)}`, stock]
    );
    await db.query(
      `INSERT INTO orders (id, user_id, relais_id, market_id, reference, status, payment_status,
                           payment_mode, total_kmf, total_eur, paypal_order_id)
       VALUES ($1, $2, $3, (SELECT market_id FROM relais WHERE id = $3), $4, 'pending', 'pending', 'paypal_eur', 25000, 50, $5)`,
      [orderId, clientId, relaisId, reference, paypalOrderId]
    );
    await db.query(
      `INSERT INTO order_items (id, order_id, product_id, quantity, price_kmf)
       VALUES ($1, $2, $3, 1, 25000)`,
      [uuid(), orderId, productId]
    );
    return { orderId, productId, paypalOrderId, reference };
  }

  const orderState = async (orderId) => {
    const { rows } = await db.query(
      'SELECT status, payment_status, paypal_capture_id FROM orders WHERE id = $1',
      [orderId]
    );
    return rows[0];
  };

  const eventConsumed = async (eventId) => {
    const { rows } = await db.query(
      'SELECT status FROM paypal_events_processed WHERE event_id = $1',
      [eventId]
    );
    return rows;
  };

  const stockOf = async (productId) => {
    const { rows } = await db.query('SELECT stock FROM products WHERE id = $1', [productId]);
    return Number(rows[0].stock);
  };

  const historyOf = async (orderId) => {
    const { rows } = await db.query(
      'SELECT status FROM order_status_history WHERE order_id = $1 ORDER BY created_at ASC, status ASC',
      [orderId]
    );
    return rows.map((r) => r.status);
  };

  beforeAll(async () => {
    cleanup = createCleanup(db);

    const ordersOfRun = `SELECT id FROM orders WHERE user_id = '${clientId}'`;
    cleanup.trackSql(`DELETE FROM users WHERE id = $1`, [clientId]);
    cleanup.trackSql(`DELETE FROM products WHERE name LIKE $1`, [`E2E PayPal ${RUN_TAG}%`]);
    cleanup.trackSql(`DELETE FROM relais WHERE id = $1`, [relaisId]);
    cleanup.trackSql(`DELETE FROM recipients WHERE relais_id = $1`, [relaisId]);
    cleanup.trackSql(`DELETE FROM orders WHERE user_id = $1`, [clientId]);
    cleanup.trackSql(`DELETE FROM order_status_history WHERE order_id IN (${ordersOfRun})`);
    cleanup.trackSql(`DELETE FROM invoices WHERE order_id IN (${ordersOfRun})`);
    cleanup.trackSql(`DELETE FROM order_items WHERE order_id IN (${ordersOfRun})`);
    cleanup.trackSql(
      `DELETE FROM paypal_events_processed WHERE event_id LIKE $1`,
      [`evt-${RUN_TAG}%`]
    );

    await db.query(
      `INSERT INTO users (id, full_name, email, phone, role)
       VALUES ($1, 'E2E PayPal Client', $2, $3, 'client')`,
      [clientId, `${tag('ppclient')}@komerce.test`, `+2693${Math.floor(Math.random() * 9e6 + 1e6)}`]
    );
    await db.query(
      `INSERT INTO relais (id, name, agent_name, phone, address, market_id)
       VALUES ($1, 'E2E Relais PayPal', 'E2E Agent', '+269000111', 'Moroni Test', (SELECT id FROM markets WHERE code = 'KM'))`,
      [relaisId]
    );

    app = express();
    app.use(require('cookie-parser')());
    // Reproduit server.js:89 — le webhook PayPal reçoit le corps BRUT, requis
    // pour la vérification de signature. L'omettre laissait req.body undefined
    // et faisait répondre 400 à tout, y compris au scénario nominal.
    app.use('/api/payments/paypal/webhook', express.raw({ type: 'application/json' }));
    app.use('/api/payments/paypal', require('../../routes/payments-paypal'));
    app.use((err, _req, res, _next) => res.status(err.status || 500).json({ error: err.message }));
  });

  afterAll(async () => {
    if (cleanup) await cleanup.run();
  });

  beforeEach(() => {
    paypal.verifyWebhookSignature.mockReset();
  });

  // ── 1. NOMINAL ───────────────────────────────────────────────────────────
  it('1 — signature valide + CAPTURE.COMPLETED : la commande est encaissée et le stock décrémenté', async () => {
    paypal.verifyWebhookSignature.mockResolvedValue(true);
    const o = await seedPaidableOrder('nominal');
    const eventId = `evt-${tag('nominal')}`;

    const res = await post(captureCompleted({
      eventId, captureId: `CAP-${tag('n')}`, paypalOrderId: o.paypalOrderId, reference: o.reference,
    }));

    expect(res.status).toBe(200);

    const state = await orderState(o.orderId);
    expect(state.payment_status).toBe('paid');
    expect(state.status).toBe('ordered');
    expect(await stockOf(o.productId)).toBe(9);
    expect(await historyOf(o.orderId)).toEqual(['confirmed', 'ordered']);
    expect(await eventConsumed(eventId)).toHaveLength(1);
  });

  // ── 2. SIGNATURE INVALIDE ────────────────────────────────────────────────
  it('2 — signature invalide : 401, aucun effet métier, événement non consommé', async () => {
    paypal.verifyWebhookSignature.mockResolvedValue(false);
    const o = await seedPaidableOrder('badsig');
    const eventId = `evt-${tag('badsig')}`;

    const res = await post(captureCompleted({
      eventId, captureId: `CAP-${tag('b')}`, paypalOrderId: o.paypalOrderId, reference: o.reference,
    }));

    expect(res.status).toBe(401);

    const state = await orderState(o.orderId);
    expect(state.payment_status).toBe('pending');
    expect(state.status).toBe('pending');
    expect(await stockOf(o.productId)).toBe(10);
    expect(await historyOf(o.orderId)).toEqual([]);
    // Un événement rejeté ne doit pas être marqué consommé, sinon un rejeu
    // légitime (signature correcte) serait ignoré comme doublon.
    expect(await eventConsumed(eventId)).toHaveLength(0);
  });

  // ── 3. REJEU / IDEMPOTENCE ───────────────────────────────────────────────
  it('3 — rejeu du même event_id : aucun second effet métier', async () => {
    paypal.verifyWebhookSignature.mockResolvedValue(true);
    const o = await seedPaidableOrder('replay');
    const eventId = `evt-${tag('replay')}`;
    const event = captureCompleted({
      eventId, captureId: `CAP-${tag('r')}`, paypalOrderId: o.paypalOrderId, reference: o.reference,
    });

    const first = await post(event);
    expect(first.status).toBe(200);
    const afterFirst = await orderState(o.orderId);
    const stockAfterFirst = await stockOf(o.productId);
    const historyAfterFirst = await historyOf(o.orderId);
    expect(afterFirst.payment_status).toBe('paid');
    expect(stockAfterFirst).toBe(9);

    const second = await post(event);
    expect(second.status).toBe(200);
    expect(second.body).toMatchObject({ idempotent: true });

    expect(await orderState(o.orderId)).toEqual(afterFirst);
    expect(await stockOf(o.productId)).toBe(stockAfterFirst);
    expect(await historyOf(o.orderId)).toEqual(historyAfterFirst);
  });

  // ── 4. REJET / TIMEOUT DU PRESTATAIRE ────────────────────────────────────
  it('4 — la vérification prestataire échoue (timeout) : aucun effet, événement rejouable', async () => {
    paypal.verifyWebhookSignature.mockRejectedValue(new Error('ETIMEDOUT api.paypal.com'));
    const o = await seedPaidableOrder('timeout');
    const eventId = `evt-${tag('timeout')}`;

    const res = await post(captureCompleted({
      eventId, captureId: `CAP-${tag('t')}`, paypalOrderId: o.paypalOrderId, reference: o.reference,
    }));

    // La route répond 200 avec une erreur portée, volontairement, pour ne pas
    // déclencher la tempête de retry PayPal (commentaire de routes/payments-paypal.js).
    expect(res.status).toBe(200);

    const state = await orderState(o.orderId);
    expect(state.payment_status).toBe('pending');
    expect(await stockOf(o.productId)).toBe(10);
    // Le contrat exige que l'événement reste REJOUABLE : un timeout réseau ne
    // doit jamais consommer définitivement un encaissement.
    expect(await eventConsumed(eventId)).toHaveLength(0);
  });

  // ── 5. TYPE D'ÉVÉNEMENT NON GÉRÉ ─────────────────────────────────────────
  it("5 — event_type non géré : ignoré proprement, aucun effet métier", async () => {
    paypal.verifyWebhookSignature.mockResolvedValue(true);
    const o = await seedPaidableOrder('unknown');
    const eventId = `evt-${tag('unknown')}`;

    const res = await post({
      id: eventId,
      event_type: 'CHECKOUT.ORDER.APPROVED',
      resource: { id: `CAP-${tag('u')}`, invoice_id: o.reference },
    });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ignored: true });

    const state = await orderState(o.orderId);
    expect(state.payment_status).toBe('pending');
    expect(await stockOf(o.productId)).toBe(10);
  });

  // ── 6. CORPS MALFORMÉ ────────────────────────────────────────────────────
  it('6 — événement malformé : 400 sans appel au prestataire', async () => {
    paypal.verifyWebhookSignature.mockResolvedValue(true);

    const res = await request(app)
      .post('/api/payments/paypal/webhook')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ nope: true }));

    expect(res.status).toBe(400);
    // Un corps malformé ne doit pas consommer d'appel de vérification.
    expect(paypal.verifyWebhookSignature).not.toHaveBeenCalled();
  });
});