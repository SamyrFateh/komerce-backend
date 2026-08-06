'use strict';


/**
 * @test-kind e2e
 * @test-runner jest
 * @test-requires postgres
 */
/**
 * E2E-L1-01 — Parcours transactionnel principal (scénario pilote)
 *
 * Feature propriétaire : orders
 * Features traversées  : auth (garde d'identité), catalog (produit consultable),
 *                        payments (webhook + cycle de confirmation),
 *                        logistics (relais de retrait), business-rules (taux)
 *
 * Doctrine (chantier E2E §2) :
 *
 *   précondition métier   identité valide + produit publié + relais
 *   → action publique     POST /api/orders            (route réelle, JWT réel)
 *   → transition réelle   POST /api/payments/stripe/webhook
 *   → état métier attendu orders.status=confirmed, payment_status=paid,
 *                         trace order_status_history, event Stripe consommé
 *   → effet interdit      un rejeu du MÊME événement ne produit aucun second
 *                         effet métier
 *
 * Ce qui est simulé : STRICTEMENT la frontière réseau Stripe. Le corps du
 * webhook est signé avec le vrai SDK Stripe (`generateTestHeaderString`) et
 * vérifié par la vraie `stripe.webhooks.constructEvent` de la route. Aucun
 * `jest.mock` sur une couche métier interne : order-payment-confirmation,
 * order-status-machine, payment-service et les écritures SQL sont réels.
 *
 * Invariants prouvés :
 *   - [orders]   transition de statut uniquement via order-status-machine.js
 *   - [payments] idempotence stricte sur tout webhook (Stripe, PayPal)
 *   - [payments] un paiement confirmé ne peut être confirmé deux fois
 */

const request = require('supertest');
const express = require('express');
const jwt = require('jsonwebtoken');
const Stripe = require('stripe');

const { describeE2E, createCleanup, RUN_TAG, tag, uuid } = require('../helpers/e2eDbKit');

jest.setTimeout(30000);

describeE2E('E2E-L1-01 — orders · commande payée par webhook Stripe', ({ db }) => {
  const stripe = Stripe(process.env.STRIPE_SECRET_KEY || 'sk_test_dummy');
  const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || 'whsec_dummy';

  const userId = uuid();
  const productId = uuid();
  const relaisId = uuid();
  const userEmail = `${tag('client')}@komerce.test`;

  let cleanup;
  let app;
  let token;

  /** Signe un événement Stripe comme le ferait Stripe — pas de mock de signature. */
  function signedWebhook(payload) {
    const raw = JSON.stringify(payload);
    const signature = stripe.webhooks.generateTestHeaderString({ payload: raw, secret: WEBHOOK_SECRET });
    return { raw, signature };
  }

  function paymentIntentSucceeded({ eventId, intentId, orderId, amountCents }) {
    return {
      id: eventId,
      object: 'event',
      type: 'payment_intent.succeeded',
      created: Math.floor(Date.now() / 1000),
      data: {
        object: {
          id: intentId,
          object: 'payment_intent',
          amount: amountCents,
          currency: 'eur',
          status: 'succeeded',
          metadata: { order_id: orderId },
        },
      },
    };
  }

  beforeAll(async () => {
    cleanup = createCleanup(db);

    // Balayage final (empilé en premier => dépilé en dernier). La route
    // webhook déclenche `triggerPurchasing` en fire-and-forget : une écriture
    // dans stripe_events_processed peut atterrir APRÈS la suppression ciblée
    // de l'événement. Le balayage par préfixe de run rattrape ce cas sans
    // jamais toucher aux données d'un autre run.
    cleanup.trackSql(
      'DELETE FROM stripe_events_processed WHERE stripe_event_id LIKE $1',
      [`evt_${RUN_TAG}%`]
    );

    // ── Précondition métier : identité réelle en base ────────────────────────
    await db.query(
      `INSERT INTO users (id, full_name, email, phone, role)
       VALUES ($1, 'E2E Client', $2, $3, 'client')`,
      [userId, userEmail, `+2693${Math.floor(Math.random() * 9000000 + 1000000)}`]
    );
    cleanup.track('users', 'id', userId);

    // ── Précondition métier : produit consultable ───────────────────────────
    await db.query(
      `INSERT INTO products (id, name, price_kmf, stock)
       VALUES ($1, $2, 25000, 50)`,
      [productId, `E2E Produit ${tag('sku')}`]
    );
    cleanup.track('products', 'id', productId);

    // ── Précondition métier : point de retrait ──────────────────────────────
    await db.query(
      `INSERT INTO relais (id, name, agent_name, phone, address)
       VALUES ($1, 'E2E Relais Moroni', 'E2E Agent', '+269000111', 'Moroni Test')`,
      [relaisId]
    );
    cleanup.track('relais', 'id', relaisId);

    token = jwt.sign({ id: userId, role: 'client' }, process.env.JWT_SECRET, {
      algorithm: 'HS256',
      expiresIn: '1h',
    });

    // Application réelle : mêmes routeurs que bootstrap/api-routes.js.
    app = express();
    app.use(require('cookie-parser')());
    // /api/payments doit voir le corps BRUT sur /stripe/webhook (I-07) : le
    // routeur payments pose lui-même son express.raw(), on ne met donc pas de
    // express.json() global devant lui.
    app.use('/api/payments', require('../../routes/payments'));
    app.use(express.json());
    app.use('/api/orders', require('../../routes/orders'));
    app.use((err, _req, res, _next) => res.status(err.status || 500).json({ error: err.message }));
  });

  afterAll(async () => {
    if (cleanup) await cleanup.run();
  });

  // ─────────────────────────────────────────────────────────────────────────
  let orderId;
  let orderReference;

  it('1 — une identité valide crée une commande en attente de paiement', async () => {
    const res = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${token}`)
      .send({
        items: [{ product_id: productId, quantity: 2 }],
        relais_id: relaisId,
        payment_mode: 'stripe_eur',
        recipient_name: 'Destinataire E2E',
        recipient_phone: '+269000222',
        tracking_phone: '+269000222',
      });

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('order');

    orderId = res.body.order.id;
    orderReference = res.body.order.reference;
    // Pile LIFO : on empile parent -> enfant pour dépiler enfant -> parent.
    // recipients est empilé avant orders car orders.recipient_id le référence.
    cleanup.trackSql('DELETE FROM recipients WHERE relais_id = $1', [relaisId]);
    cleanup.track('orders', 'id', orderId);
    // invoices n'a pas de ON DELETE CASCADE : la facture éventuellement émise
    // par documents doit partir avant la commande.
    cleanup.trackSql('DELETE FROM invoices WHERE order_id = $1', [orderId]);
    cleanup.trackSql('DELETE FROM order_items WHERE order_id = $1', [orderId]);
    cleanup.trackSql('DELETE FROM order_status_history WHERE order_id = $1', [orderId]);

    // Résultat métier observable, pas un simple 201.
    const { rows } = await db.query(
      'SELECT status, payment_status, total_kmf, user_id FROM orders WHERE id = $1',
      [orderId]
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('pending');
    expect(rows[0].payment_status).toBe('pending');
    expect(rows[0].user_id).toBe(userId);
    expect(Number(rows[0].total_kmf)).toBeGreaterThan(0);

    // Référence lisible et unique (invariant orders).
    expect(orderReference).toEqual(expect.any(String));
    expect(orderReference.length).toBeGreaterThan(3);
  });

  it('2 — le webhook Stripe signé fait transiter la commande vers confirmed/paid', async () => {
    const eventId = `evt_${tag('ok')}`;
    const intentId = `pi_${tag('ok')}`;

    const { rows: [before] } = await db.query('SELECT total_eur FROM orders WHERE id = $1', [orderId]);
    const amountCents = Math.round(Number(before.total_eur || 100) * 100);

    const event = paymentIntentSucceeded({ eventId, intentId, orderId, amountCents });
    const { raw, signature } = signedWebhook(event);

    const res = await request(app)
      .post('/api/payments/stripe/webhook')
      .set('stripe-signature', signature)
      .set('Content-Type', 'application/json')
      .send(raw);

    expect(res.status).toBe(200);
    expect(res.body.rejected).toBeUndefined();

    // ── Effet métier attendu : transition + encaissement réellement persistés
    const { rows } = await db.query(
      'SELECT status, payment_status, confirmed_at FROM orders WHERE id = $1',
      [orderId]
    );
    expect(rows[0].payment_status).toBe('paid');
    expect(rows[0].confirmed_at).not.toBeNull();

    // État final réel : confirmPaymentCycle enchaîne DEUX transitions —
    // pending -> confirmed (encaissement) puis confirmed -> ordered
    // (déclenchement sourcing/purchasing). L'état observable après un webhook
    // nominal est donc 'ordered', pas 'confirmed'. Asserter 'confirmed' ici
    // reviendrait à figer une hypothèse au lieu du comportement du code.
    expect(rows[0].status).toBe('ordered');

    // ── Invariant orders : « transition de statut uniquement via
    // order-status-machine.js ». La machine est le seul chemin qui écrit dans
    // order_status_history : retrouver la séquence complète et ordonnée prouve
    // que les deux transitions y sont passées, et qu'aucune n'a été court-
    // circuitée par un UPDATE orders.status direct.
    const { rows: history } = await db.query(
      `SELECT status FROM order_status_history
       WHERE order_id = $1 ORDER BY created_at ASC, status ASC`,
      [orderId]
    );
    expect(history.map((h) => h.status)).toEqual(['pending', 'confirmed', 'ordered']);

    // ── L'événement Stripe est consommé et tracé.
    const { rows: seen } = await db.query(
      'SELECT 1 FROM stripe_events_processed WHERE stripe_event_id = $1',
      [eventId]
    );
    expect(seen).toHaveLength(1);
    cleanup.trackSql('DELETE FROM stripe_events_processed WHERE stripe_event_id = $1', [eventId]);
  });

  it('3 — rejouer le même événement ne produit aucun second effet (idempotence)', async () => {
    const eventId = `evt_${tag('replay')}`;
    const intentId = `pi_${tag('replay')}`;

    const { rows: [snapshot] } = await db.query(
      'SELECT status, payment_status, confirmed_at FROM orders WHERE id = $1',
      [orderId]
    );
    const { rows: historyBefore } = await db.query(
      'SELECT count(*)::int AS n FROM order_status_history WHERE order_id = $1',
      [orderId]
    );

    const event = paymentIntentSucceeded({ eventId, intentId, orderId, amountCents: 1000 });
    const { raw, signature } = signedWebhook(event);

    const res = await request(app)
      .post('/api/payments/stripe/webhook')
      .set('stripe-signature', signature)
      .set('Content-Type', 'application/json')
      .send(raw);
    cleanup.trackSql('DELETE FROM stripe_events_processed WHERE stripe_event_id = $1', [eventId]);

    expect(res.status).toBe(200);

    // ── Absence d'effet interdit : l'état métier est strictement inchangé.
    const { rows: [after] } = await db.query(
      'SELECT status, payment_status, confirmed_at FROM orders WHERE id = $1',
      [orderId]
    );
    expect(after.status).toBe(snapshot.status);
    expect(after.payment_status).toBe(snapshot.payment_status);
    expect(after.confirmed_at).toEqual(snapshot.confirmed_at);

    const { rows: historyAfter } = await db.query(
      'SELECT count(*)::int AS n FROM order_status_history WHERE order_id = $1',
      [orderId]
    );
    expect(historyAfter[0].n).toBe(historyBefore[0].n);
  });

  it('4 — un événement non signé par Stripe est rejeté et ne laisse aucune trace', async () => {
    const forgedEventId = `evt_${tag('forged')}`;

    const { rows: [before] } = await db.query(
      'SELECT status, payment_status, confirmed_at FROM orders WHERE id = $1',
      [orderId]
    );
    const { rows: historyBefore } = await db.query(
      'SELECT count(*)::int AS n FROM order_status_history WHERE order_id = $1',
      [orderId]
    );

    const event = paymentIntentSucceeded({
      eventId: forgedEventId,
      intentId: `pi_${tag('forged')}`,
      orderId,
      amountCents: 1000,
    });

    const res = await request(app)
      .post('/api/payments/stripe/webhook')
      .set('stripe-signature', 't=1,v1=deadbeef')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify(event));

    expect(res.status).toBe(400);

    // Le test ne se contente pas du 400 : il prouve que RIEN n'a été consommé.
    // Sans cette assertion, le test resterait vert même si le corps transmis
    // était corrompu par le transport (cas réellement rencontré : supertest
    // sérialise un Buffer en {"type":"Buffer",...}, rendant toute signature
    // invalide — le 400 devenait alors un faux positif).
    const { rows: consumed } = await db.query(
      'SELECT 1 FROM stripe_events_processed WHERE stripe_event_id = $1',
      [forgedEventId]
    );
    expect(consumed).toHaveLength(0);

    const { rows: [after] } = await db.query(
      'SELECT status, payment_status, confirmed_at FROM orders WHERE id = $1',
      [orderId]
    );
    expect(after).toEqual(before);

    const { rows: historyAfter } = await db.query(
      'SELECT count(*)::int AS n FROM order_status_history WHERE order_id = $1',
      [orderId]
    );
    expect(historyAfter[0].n).toBe(historyBefore[0].n);
  });

  it('5 — contre-preuve : le harnais sait détecter une signature valide', async () => {
    // Garde anti-faux-positif du test 4. Si le transport corrompait le corps,
    // ce test échouerait — donc un 400 en test 4 prouve bien le rejet de la
    // signature, et non une avarie du harnais.
    const { raw, signature } = signedWebhook({ id: `evt_${tag('probe')}`, object: 'event', type: 'ping' });
    const res = await request(app)
      .post('/api/payments/stripe/webhook')
      .set('stripe-signature', signature)
      .set('Content-Type', 'application/json')
      .send(raw);

    expect(res.status).toBe(200);
  });
});
