'use strict';


/**
 * @test-kind e2e
 * @test-runner jest
 * @test-requires postgres
 */
/**
 * E2E-P0-STOCK — inventory · le stock ne descend jamais sous zéro
 *
 * Feature propriétaire : inventory
 * Features traversées  : orders (création + machine de statut), payments
 *                        (webhook Stripe réel), catalog (produit/stock),
 *                        logistics (relais)
 *
 * Invariant prouvé (features/inventory.feature.js) :
 *   « le stock ne descend jamais sous zéro sans flag explicite de survente
 *     assumée »
 *
 * Doctrine du code sous test — services/order-payment-confirmation.js est le
 * point d'entrée UNIQUE paiement → stock, et décrémente sous `FOR UPDATE`.
 * Quand le stock est insuffisant il renvoie `stockBlocked`, et l'appelant
 * décide : cash → ROLLBACK + 409 ; Stripe → l'encaissement est acquis, donc
 * COMMIT + incident `paid_but_stock_blocked`. Cette suite prouve les deux
 * branches ET l'absence de stock négatif dans les deux cas.
 *
 * Ce qui est simulé : uniquement la frontière réseau Stripe (le corps du
 * webhook est signé par le vrai SDK et vérifié par la vraie
 * `stripe.webhooks.constructEvent`). Base, transactions, contraintes CHECK,
 * machine de statut et décrément de stock sont réels.
 *
 * Scénarios :
 *   1. NOMINAL         stock 5, commande 2, payée → stock 3, commande ordered
 *   2. CONTRE-PREUVE   stock 1, commande 3, payée → encaissée MAIS stock
 *                      inchangé, incident tracé, stock jamais négatif
 *   3. CONCURRENCE     deux commandes de 1 sur stock 1, webhooks joués en
 *                      parallèle → une seule décrémente, stock final 0
 *   4. EFFET INTERDIT  la contrainte CHECK refuse tout stock négatif écrit
 *                      directement — le garde de dernier recours existe
 */

const request = require('supertest');
const express = require('express');
const jwt = require('jsonwebtoken');
const Stripe = require('stripe');

const { describeE2E, createCleanup, RUN_TAG, tag, uuid } = require('../helpers/e2eDbKit');

jest.setTimeout(60000);

describeE2E('E2E-P0-STOCK — inventory · stock jamais négatif', ({ db }) => {
  const stripe = Stripe(process.env.STRIPE_SECRET_KEY || 'sk_test_dummy');
  const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || 'whsec_dummy';

  const userId = uuid();
  const relaisId = uuid();

  let cleanup;
  let app;
  let token;

  // ── outillage local ───────────────────────────────────────────────────────
  function signedEvent(payload) {
    const raw = JSON.stringify(payload);
    return {
      raw,
      signature: stripe.webhooks.generateTestHeaderString({ payload: raw, secret: WEBHOOK_SECRET }),
    };
  }

  function intentSucceeded({ eventId, intentId, orderId }) {
    return {
      id: eventId,
      object: 'event',
      type: 'payment_intent.succeeded',
      created: Math.floor(Date.now() / 1000),
      data: {
        object: {
          id: intentId,
          object: 'payment_intent',
          amount: 10000,
          currency: 'eur',
          status: 'succeeded',
          metadata: { order_id: orderId },
        },
      },
    };
  }

  function payOrder(orderId, label) {
    const eventId = `evt_${tag(label)}`;
    const { raw, signature } = signedEvent(
      intentSucceeded({ eventId, intentId: `pi_${tag(label)}`, orderId })
    );
    return request(app)
      .post('/api/payments/stripe/webhook')
      .set('stripe-signature', signature)
      .set('Content-Type', 'application/json')
      .send(raw);
  }

  /** Crée un produit dédié au scénario, avec un stock maîtrisé. */
  async function seedProduct(stock, label) {
    const id = uuid();
    await db.query(
      `INSERT INTO products (id, name, price_kmf, stock) VALUES ($1, $2, 25000, $3)`,
      [id, `E2E Stock ${tag(label)}`, stock]
    );
    return id;
  }

  /** Passe une commande via la route publique réelle. */
  async function createOrder(productId, quantity) {
    const res = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${token}`)
      .send({
        items: [{ product_id: productId, quantity }],
        relais_id: relaisId,
        payment_mode: 'stripe_eur',
        recipient_name: 'Destinataire E2E',
        recipient_phone: '+269000222',
        tracking_phone: '+269000222',
      });
    if (res.status !== 201) {
      throw new Error(`création commande: ${res.status} ${JSON.stringify(res.body)}`);
    }
    const orderId = res.body.order.id;
    return orderId;
  }

  const stockOf = async (productId) => {
    const { rows } = await db.query('SELECT stock FROM products WHERE id = $1', [productId]);
    return Number(rows[0].stock);
  };

  beforeAll(async () => {
    cleanup = createCleanup(db);

    // Balayage de secours : la route webhook déclenche `triggerPurchasing` en
    // fire-and-forget, dont les écritures peuvent atterrir après la
    // suppression ciblée.
    // Nettoyage déterministe. La pile est LIFO : on empile du parent vers
    // l'enfant pour dépiler de l'enfant vers le parent, ce qui respecte les
    // clés étrangères sans dépendre de l'ordre de création des scénarios.
    // (invoices et order_items n'ont pas de ON DELETE CASCADE.)
    const ordersOfRun = `SELECT id FROM orders WHERE user_id = '${userId}'`;
    cleanup.trackSql(`DELETE FROM users WHERE id = $1`, [userId]);
    cleanup.trackSql(`DELETE FROM products WHERE name LIKE $1`, [`E2E Stock ${RUN_TAG}%`]);
    cleanup.trackSql(`DELETE FROM relais WHERE id = $1`, [relaisId]);
    cleanup.trackSql(`DELETE FROM recipients WHERE relais_id = $1`, [relaisId]);
    cleanup.trackSql(`DELETE FROM orders WHERE user_id = $1`, [userId]);
    cleanup.trackSql(`DELETE FROM order_status_history WHERE order_id IN (${ordersOfRun})`);
    cleanup.trackSql(`DELETE FROM invoices WHERE order_id IN (${ordersOfRun})`);
    cleanup.trackSql(`DELETE FROM order_items WHERE order_id IN (${ordersOfRun})`);
    cleanup.trackSql(
      'DELETE FROM stripe_events_processed WHERE stripe_event_id LIKE $1',
      [`evt_${RUN_TAG}%`]
    );

    await db.query(
      `INSERT INTO users (id, full_name, email, phone, role)
       VALUES ($1, 'E2E Stock Client', $2, $3, 'client')`,
      [userId, `${tag('stock')}@komerce.test`, `+2693${Math.floor(Math.random() * 9e6 + 1e6)}`]
    );

    await db.query(
      `INSERT INTO relais (id, name, agent_name, phone, address)
       VALUES ($1, 'E2E Relais Stock', 'E2E Agent', '+269000111', 'Moroni Test')`,
      [relaisId]
    );

    token = jwt.sign({ id: userId, role: 'client' }, process.env.JWT_SECRET, {
      algorithm: 'HS256',
      expiresIn: '1h',
    });

    app = express();
    app.use(require('cookie-parser')());
    // Le routeur payments pose son propre express.raw() sur /stripe/webhook :
    // il doit être monté AVANT tout express.json() global (invariant I-07).
    app.use('/api/payments', require('../../routes/payments'));
    app.use(express.json());
    app.use('/api/orders', require('../../routes/orders'));
    app.use((err, _req, res, _next) => res.status(err.status || 500).json({ error: err.message }));
  });

  afterAll(async () => {
    if (cleanup) await cleanup.run();
  });

  // ─────────────────────────────────────────────────────────────────────────
  it('1 — NOMINAL : une commande payée décrémente exactement la quantité commandée', async () => {
    const productId = await seedProduct(5, 'nominal');
    const orderId = await createOrder(productId, 2);

    expect(await stockOf(productId)).toBe(5); // pas de décrément avant paiement

    const res = await payOrder(orderId, 'nominal');
    expect(res.status).toBe(200);

    expect(await stockOf(productId)).toBe(3);

    const { rows } = await db.query(
      'SELECT status, payment_status FROM orders WHERE id = $1',
      [orderId]
    );
    expect(rows[0].payment_status).toBe('paid');
    expect(rows[0].status).toBe('ordered');
  });

  it('2 — CONTRE-PREUVE : stock insuffisant → encaissement acquis, stock jamais négatif, incident tracé', async () => {
    // La route de création VALIDE le stock (409 « Stock insuffisant ») : une
    // sur-commande directe est impossible. La branche stockBlocked protège la
    // vraie course — le stock baisse ENTRE la commande et son paiement, parce
    // qu'un autre client a été encaissé entre-temps.
    const productId = await seedProduct(3, 'blocked');
    const orderId = await createOrder(productId, 3);

    // Un autre acheteur consomme 2 unités avant que ce paiement n'arrive.
    await db.query('UPDATE products SET stock = 1 WHERE id = $1', [productId]);

    const res = await payOrder(orderId, 'blocked');
    expect(res.status).toBe(200);

    // ── L'invariant : quoi qu'il arrive, jamais de stock négatif.
    const remaining = await stockOf(productId);
    expect(remaining).toBeGreaterThanOrEqual(0);
    // Le décrément n'a pas eu lieu : 3 demandés pour 1 disponible.
    expect(remaining).toBe(1);

    // ── L'argent est encaissé : c'est la doctrine Stripe (on ne rembourse pas
    // silencieusement, on signale). Perdre cette assertion reviendrait à
    // accepter un encaissement sans trace.
    const { rows } = await db.query(
      'SELECT payment_status, notes FROM orders WHERE id = $1',
      [orderId]
    );
    expect(rows[0].payment_status).toBe('paid');

    // ── L'effet interdit serait le silence : la survente doit être visible,
    // soit dans les notes de la commande, soit dans le journal d'alertes.
    const { rows: alerts } = await db.query(
      `SELECT 1 FROM alerts WHERE type = 'paid_but_stock_blocked'
         AND (order_id = $1 OR entity_id = $1::text) LIMIT 1`,
      [orderId]
    ).catch(() => ({ rows: [] }));

    const notedInOrder = String(rows[0].notes || '').includes('paid_but_stock_blocked');
    expect(notedInOrder || alerts.length > 0).toBe(true);
  });

  it('3 — CONCURRENCE : deux paiements simultanés sur la dernière unité → un seul décrément', async () => {
    // Deux clients commandent chacun 1 unité alors que le stock le permet ;
    // le stock tombe à 1 avant que les deux paiements n'arrivent.
    const productId = await seedProduct(2, 'race');
    const orderA = await createOrder(productId, 1);
    const orderB = await createOrder(productId, 1);

    await db.query('UPDATE products SET stock = 1 WHERE id = $1', [productId]);

    // Les deux webhooks partent réellement en parallèle : c'est le FOR UPDATE
    // de confirmPaymentCycle qui doit sérialiser, pas le test.
    const [resA, resB] = await Promise.all([
      payOrder(orderA, 'raceA'),
      payOrder(orderB, 'raceB'),
    ]);
    expect(resA.status).toBe(200);
    expect(resB.status).toBe(200);

    // ── Invariant central : le stock atterrit à 0, jamais à -1.
    const remaining = await stockOf(productId);
    expect(remaining).toBe(0);

    // Les deux commandes sont encaissées (doctrine Stripe), mais une seule a
    // obtenu la marchandise. Exactement une doit porter la trace de survente.
    const { rows } = await db.query(
      `SELECT id, payment_status, COALESCE(notes,'') AS notes
         FROM orders WHERE id = ANY($1::uuid[]) ORDER BY id`,
      [[orderA, orderB]]
    );
    expect(rows).toHaveLength(2);
    for (const r of rows) expect(r.payment_status).toBe('paid');

    const blocked = rows.filter((r) => r.notes.includes('paid_but_stock_blocked'));
    expect(blocked).toHaveLength(1);
  });

  it("4 — GARDE DE DERNIER RECOURS : la base refuse physiquement un stock négatif", async () => {
    const productId = await seedProduct(0, 'guard');

    // 23514 = check_violation. Assertion sur le SQLSTATE et non sur le message :
    // PostgreSQL localise ses textes d'erreur, pas ses codes.
    await expect(
      db.query('UPDATE products SET stock = -1 WHERE id = $1', [productId])
    ).rejects.toMatchObject({ code: '23514' });

    expect(await stockOf(productId)).toBe(0);
  });
});
