'use strict';

//
// E2E-P0-PAYPAL-RED — payments · montant et devise de capture PayPal
//
// SUITE EN QUARANTAINE — 2 KO reproductibles, volontairement hors du runner
// bloquant. L'extension `.red.js` fait qu'aucun ramasseur ne la prend :
//   - jest.config.js  → testMatch '**/tests/ ** /*.test.js'
//   - scripts/run-e2e-feature-tests.js → lecture NON récursive de tests/e2e-api
//
// Reproduction exacte :
//   npx jest --runInBand --testMatch "**/tests/e2e-api/red/*.red.js"
//
// Les assertions expriment le CONTRAT MÉTIER ATTENDU et ne doivent pas être
// affaiblies pour passer au vert. Le comportement actuel marque la commande
// payée quels que soient le montant et la devise capturés.
//
// Feature propriétaire pressentie : payments
// Fichiers produit probablement concernés :
//   services/payment-paypal.js  (_handleCaptureCompleted / handlePaypalWebhookEvent)
//   services/order-payment-confirmation.js  (confirmPaymentCycle, point d'entrée unique)
//
// Classification proposée — à arbitrer, présentée sans certitude :
//   SPEC_AMBIGUITY en premier lieu. Le contrat de `_handleCaptureCompleted`
//   n'énonce nulle part qu'il doit rapprocher montant et devise ; il retrouve
//   la commande par identifiant puis délègue l'encaissement. Il est possible
//   que le rapprochement soit assumé côté endpoint `capture` synchrone et que
//   le webhook soit conçu comme un filet de rattrapage — son propre log dit
//   « capture endpoint avait probablement échoué ».
//   PRODUCT_BUG en second lieu, si la doctrine veut que TOUTE porte
//   d'encaissement rapproche le montant : la porte webhook produit exactement
//   les mêmes effets métier que la porte synchrone (paid, ordered, stock
//   décrémenté, secret de retrait émis) sans le même contrôle.
//
// Portée : non exploitable par un tiers anonyme, une signature PayPal valide
// reste nécessaire. Le risque réel est celui d'une capture partielle légitime,
// d'une erreur de devise côté PayPal, ou d'un compte marchand compromis.
//
// FRONTIÈRE RÉSEAU CONTRÔLÉE — et seulement elle : `verifyWebhookSignature()`
// appelle l'API PayPal. Base, route Express, `handlePaypalWebhookEvent`,
// `confirmPaymentCycle`, machine de statut et écritures restent réels.
//

const request = require('supertest');
const express = require('express');

jest.mock('../../../services/paypal-client', () => {
  const actual = jest.requireActual('../../../services/paypal-client');
  return Object.assign({}, actual, { verifyWebhookSignature: jest.fn() });
});

const paypal = require('../../../services/paypal-client');
const { describeE2E, createCleanup, RUN_TAG, tag, uuid } = require('../../helpers/e2eDbKit');

jest.setTimeout(60000);

describeE2E('E2E-P0-PAYPAL-RED — payments · montant/devise de capture', ({ db }) => {
  const clientId = uuid();
  const relaisId = uuid();

  let cleanup;
  let app;

  function captureCompleted(opts) {
    return {
      id: opts.eventId,
      event_type: 'PAYMENT.CAPTURE.COMPLETED',
      create_time: new Date().toISOString(),
      resource: {
        id: opts.captureId,
        status: 'COMPLETED',
        invoice_id: opts.reference,
        custom_id: opts.reference,
        amount: { value: opts.value, currency_code: opts.currency },
        supplementary_data: { related_ids: { order_id: opts.paypalOrderId } },
      },
    };
  }

  function post(event) {
    return request(app)
      .post('/api/payments/paypal/webhook')
      .set('Content-Type', 'application/json')
      .set('paypal-transmission-id', 'tx-' + tag('t'))
      .set('paypal-transmission-time', new Date().toISOString())
      .set('paypal-transmission-sig', 'sig')
      .set('paypal-cert-url', 'https://api.paypal.com/cert')
      .set('paypal-auth-algo', 'SHA256withRSA')
      .send(JSON.stringify(event));
  }

  // Commande de 50 EUR / 25 000 KMF, 1 article, stock 10.
  async function seedOrder(label) {
    const productId = uuid();
    const orderId = uuid();
    const paypalOrderId = 'PPO-' + tag(label);
    const reference = ('E2EPPR-' + tag(label)).toUpperCase();

    await db.query(
      'INSERT INTO products (id, name, price_kmf, stock) VALUES ($1, $2, 25000, 10)',
      [productId, 'E2E PayPalRed ' + tag(label)]
    );
    await db.query(
      `INSERT INTO orders (id, user_id, relais_id, reference, status, payment_status,
                           payment_mode, total_kmf, total_eur, paypal_order_id)
       VALUES ($1, $2, $3, $4, 'pending', 'pending', 'paypal_eur', 25000, 50, $5)`,
      [orderId, clientId, relaisId, reference, paypalOrderId]
    );
    await db.query(
      `INSERT INTO order_items (id, order_id, product_id, quantity, price_kmf)
       VALUES ($1, $2, $3, 1, 25000)`,
      [uuid(), orderId, productId]
    );
    return { orderId, productId, paypalOrderId, reference };
  }

  async function orderState(orderId) {
    const { rows } = await db.query(
      'SELECT status, payment_status FROM orders WHERE id = $1',
      [orderId]
    );
    return rows[0];
  }

  async function stockOf(productId) {
    const { rows } = await db.query('SELECT stock FROM products WHERE id = $1', [productId]);
    return Number(rows[0].stock);
  }

  beforeAll(async () => {
    cleanup = createCleanup(db);
    const ordersOfRun = "SELECT id FROM orders WHERE user_id = '" + clientId + "'";
    cleanup.trackSql('DELETE FROM users WHERE id = $1', [clientId]);
    cleanup.trackSql('DELETE FROM products WHERE name LIKE $1', ['E2E PayPalRed ' + RUN_TAG + '%']);
    cleanup.trackSql('DELETE FROM relais WHERE id = $1', [relaisId]);
    cleanup.trackSql('DELETE FROM recipients WHERE relais_id = $1', [relaisId]);
    cleanup.trackSql('DELETE FROM orders WHERE user_id = $1', [clientId]);
    cleanup.trackSql('DELETE FROM order_status_history WHERE order_id IN (' + ordersOfRun + ')');
    cleanup.trackSql('DELETE FROM invoices WHERE order_id IN (' + ordersOfRun + ')');
    cleanup.trackSql('DELETE FROM order_items WHERE order_id IN (' + ordersOfRun + ')');
    cleanup.trackSql('DELETE FROM paypal_events_processed WHERE event_id LIKE $1', ['evt-' + RUN_TAG + '%']);

    await db.query(
      `INSERT INTO users (id, full_name, email, phone, role)
       VALUES ($1, 'E2E PayPalRed Client', $2, $3, 'client')`,
      [clientId, tag('ppred') + '@komerce.test', '+2693' + Math.floor(Math.random() * 9e6 + 1e6)]
    );
    await db.query(
      `INSERT INTO relais (id, name, agent_name, phone, address)
       VALUES ($1, 'E2E Relais PayPalRed', 'E2E Agent', '+269000111', 'Moroni Test')`,
      [relaisId]
    );

    app = express();
    app.use(require('cookie-parser')());
    app.use('/api/payments/paypal/webhook', express.raw({ type: 'application/json' }));
    app.use('/api/payments/paypal', require('../../../routes/payments-paypal'));
    app.use(function (err, _req, res, _next) {
      res.status(err.status || 500).json({ error: err.message });
    });
  });

  afterAll(async () => {
    if (cleanup) await cleanup.run();
  });

  beforeEach(() => {
    paypal.verifyWebhookSignature.mockReset();
    paypal.verifyWebhookSignature.mockResolvedValue(true);
  });

  it('KO-1 — devise incohérente (50 USD sur une commande 50 EUR) : encaissement doit être refusé', async () => {
    const o = await seedOrder('currency');

    const res = await post(captureCompleted({
      eventId: 'evt-' + tag('currency'),
      captureId: 'CAP-' + tag('c'),
      paypalOrderId: o.paypalOrderId,
      reference: o.reference,
      value: '50.00',
      currency: 'USD',
    }));

    expect(res.status).toBe(200);

    // Un dollar n'est pas un euro. Accepter la capture revient à encaisser un
    // montant que nous n'avons jamais demandé, au taux de personne.
    const state = await orderState(o.orderId);
    expect(state.payment_status).toBe('pending');
    expect(state.status).toBe('pending');
    expect(await stockOf(o.productId)).toBe(10);
  });

  it('KO-2 — montant très inférieur au dû (1 EUR sur 50 EUR) : encaissement doit être refusé', async () => {
    const o = await seedOrder('amount');

    const res = await post(captureCompleted({
      eventId: 'evt-' + tag('amount'),
      captureId: 'CAP-' + tag('a'),
      paypalOrderId: o.paypalOrderId,
      reference: o.reference,
      value: '1.00',
      currency: 'EUR',
    }));

    expect(res.status).toBe(200);

    // 1 EUR capturé sur une commande de 50 EUR ne vaut pas paiement : marquer
    // `paid` ici expédie la marchandise contre 2 % du prix.
    const state = await orderState(o.orderId);
    expect(state.payment_status).toBe('pending');
    expect(state.status).toBe('pending');
    expect(await stockOf(o.productId)).toBe(10);
  });
});
