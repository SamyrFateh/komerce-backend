'use strict';

/**
 * tests/integration/e2e-critical-flows.test.js
 *
 * GOV-06 (B1) — 5 parcours critiques E2E
 *
 * Chaque test couvre un flux HTTP bout-en-bout contre une vraie base Postgres.
 * On suit le pattern de relais-idor-probe.test.js : supertest + vraie DB,
 * seed SQL en beforeAll, cleanup en afterAll.
 *
 * Parcours couverts (DoD : ≥ 5 verts en CI) :
 *   1. checkout_cash     — création commande + confirmation paiement cash v2
 *   2. stripe_webhook    — paiement Stripe simulé via webhook signé HMAC local
 *   3. remboursement     — annulation commande (→ wallet_credit, pas Stripe)
 *   4. panier_shared_v4  — création panier partagé → fermeture → contribution cash → confirmation
 *   5. admin_order_e2e   — transitions statut admin (confirmed → ordered → preparation)
 *
 * Pré-requis :
 *   DATABASE_URL=postgres://... JWT_SECRET=... npx jest tests/integration/e2e-critical-flows.test.js
 *
 * Sans DATABASE_URL → suite skippée proprement.
 */

const crypto = require('crypto');

const hasIntegrationEnv = Boolean(process.env.DATABASE_URL);

if (!hasIntegrationEnv) {
  describe.skip('e2e-critical-flows (needs DATABASE_URL)', () => {
    test('skipped — DATABASE_URL not configured', () => {});
  });
} else {
  const request = require('supertest');
  const { createUser, tokenFor, cleanup } = require('./test-harness/seed-helpers');

  let app;
  let db;

  // ── Fixtures partagées ────────────────────────────────────────────────────
  let relaisId;
  let productId;
  let adminUser;
  let clientUser;

  // ── Helper : signer un événement Stripe webhook (HMAC local) ─────────────
  function stripeSign(payload) {
    const secret    = process.env.STRIPE_WEBHOOK_SECRET || 'whsec_dummy';
    const timestamp = Math.floor(Date.now() / 1000);
    const raw       = typeof payload === 'string' ? payload : JSON.stringify(payload);
    const signed    = `${timestamp}.${raw}`;
    const sig       = crypto.createHmac('sha256', secret).update(signed).digest('hex');
    return { raw, header: `t=${timestamp},v1=${sig}` };
  }

  // ── Helper : INSERT commande minimale directement en DB ───────────────────
  async function seedOrder(overrides = {}) {
    const ref = `TEST-${Date.now()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
    const { rows: [order] } = await db.query(
      `INSERT INTO orders (
         reference, user_id, relais_id,
         total_kmf, total_eur,
         payment_mode, payment_status, status
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING *`,
      [
        ref,
        overrides.userId || clientUser.id,
        overrides.relaisId || relaisId,
        overrides.total_kmf    || 5000,
        overrides.total_eur    || 10.00,
        overrides.payment_mode || 'cash_relais',
        overrides.payment_status || 'pending',
        overrides.status         || 'confirmed',
      ]
    );
    return order;
  }

  // ── Bootstrap ─────────────────────────────────────────────────────────────
  beforeAll(async () => {
    process.env.NODE_ENV  = 'test';
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'ci-test-secret-not-for-prod';
    process.env.STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || 'whsec_dummy';

    app = require('../../server');
    db  = require('../../db');

    await new Promise((r) => setTimeout(r, 2000)); // boot/migrations

    // ── Relais de test ──────────────────────────────────────────────────────
    const { rows: [relais] } = await db.query(
      `INSERT INTO relais (name, agent_name, phone, address, zone, island)
       VALUES ('Relais E2E Test','Agent E2E','+26933000001','Adresse Test','Mutsamudu','Anjouan')
       RETURNING id`
    );
    relaisId = relais.id;

    // ── Produit de test (stock=100 par défaut) ──────────────────────────────
    const { rows: [product] } = await db.query(
      `INSERT INTO products (name, category, price_kmf, stock, is_active)
       VALUES ('Produit E2E Test','test',5000,100,true)
       RETURNING id`
    );
    productId = product.id;

    // ── Utilisateurs ────────────────────────────────────────────────────────
    adminUser  = await createUser({ role: 'admin' });
    clientUser = await createUser({ role: 'client' });
  }, 30000);

  afterAll(async () => {
    // Nettoyage dans l'ordre des FK
    try {
      await db.query(`DELETE FROM shared_cart_contributions WHERE shared_cart_id IN
        (SELECT id FROM shared_carts WHERE title = 'E2E Panier Test')`);
      await db.query(`DELETE FROM shared_cart_items WHERE shared_cart_id IN
        (SELECT id FROM shared_carts WHERE title = 'E2E Panier Test')`);
      await db.query(`DELETE FROM shared_cart_events WHERE shared_cart_id IN
        (SELECT id FROM shared_carts WHERE title = 'E2E Panier Test')`);
      await db.query(`DELETE FROM shared_carts WHERE title = 'E2E Panier Test'`);
    } catch (_) {}
    try {
      await db.query(`DELETE FROM order_status_history WHERE order_id IN
        (SELECT id FROM orders WHERE reference LIKE 'TEST-%')`);
      await db.query(`DELETE FROM refunds WHERE order_id IN
        (SELECT id FROM orders WHERE reference LIKE 'TEST-%')`);
      await db.query(`UPDATE parcels SET status = 'cancelled' WHERE order_id IN
        (SELECT id FROM orders WHERE reference LIKE 'TEST-%')`);
      await db.query(`DELETE FROM order_items WHERE order_id IN
        (SELECT id FROM orders WHERE reference LIKE 'TEST-%')`);
      await db.query(`DELETE FROM orders WHERE reference LIKE 'TEST-%'`);
    } catch (_) {}
    try { await db.query(`DELETE FROM products WHERE name = 'Produit E2E Test'`); } catch (_) {}
    try { await db.query(`DELETE FROM relais  WHERE name = 'Relais E2E Test'`); }  catch (_) {}
    await cleanup(); // supprime les users itest+*
    if (db.end) await db.end().catch(() => {});
  }, 20000);

  // ════════════════════════════════════════════════════════════════════════════
  // Parcours 1 — Checkout cash
  // ════════════════════════════════════════════════════════════════════════════
  describe('1 — checkout cash (POST /api/orders → confirm-cash)', () => {
    test('création commande cash_relais → 201', async () => {
      const res = await request(app)
        .post('/api/orders')
        .set('Authorization', `Bearer ${clientUser.token}`)
        .send({
          items: [{ product_id: productId, quantity: 1 }],
          relais_id:      relaisId,
          payment_mode:   'cash_relais',
          recipient_name:  'Destinataire E2E',
          recipient_phone: '+26933000099',
        });

      expect([200, 201]).toContain(res.status);
      expect(res.body).toHaveProperty('reference');
      expect(res.body.payment_mode).toBe('cash_relais');
      expect(res.body.payment_status).toBe('pending');
    });

    test('confirmation cash admin → payment_status paid', async () => {
      // On crée une commande directement en DB pour s'affranchir des variantes
      // de réponse du checkout (wallet partial pay, etc.)
      const order = await seedOrder({ payment_status: 'pending', status: 'confirmed' });

      const res = await request(app)
        .post(`/api/v2/orders/${order.reference}/confirm-cash`)
        .set('Authorization', `Bearer ${adminUser.token}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.order.payment_status).toBe('paid');

      // Vérification DB
      const { rows: [updated] } = await db.query(
        `SELECT payment_status FROM orders WHERE id = $1`, [order.id]
      );
      expect(updated.payment_status).toBe('paid');
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // Parcours 2 — Checkout Stripe (webhook signé localement)
  // ════════════════════════════════════════════════════════════════════════════
  describe('2 — checkout Stripe (webhook payment_intent.succeeded)', () => {
    test('webhook signé → order passe payment_status=paid', async () => {
      const fakeIntentId = `pi_e2etest_${Date.now()}`;
      const fakeEventId  = `evt_e2etest_${Date.now()}`;

      // Commande stripe_eur en attente de paiement
      const order = await seedOrder({
        payment_mode:    'stripe_eur',
        payment_status:  'pending',
        status:          'confirmed',
        total_eur:       10.18,
      });

      // Stocker le stripe_payment_id sur la commande (normalement fait par /stripe/intent)
      await db.query(
        `UPDATE orders SET stripe_payment_id = $1 WHERE id = $2`,
        [fakeIntentId, order.id]
      );

      const event = {
        id:      fakeEventId,
        type:    'payment_intent.succeeded',
        created: Math.floor(Date.now() / 1000),
        data: {
          object: {
            id:              fakeIntentId,
            object:          'payment_intent',
            amount:          1018,
            currency:        'eur',
            status:          'succeeded',
            metadata: {
              order_id:        order.id,
              order_reference: order.reference,
            },
          },
        },
      };

      const { raw, header } = stripeSign(event);

      const res = await request(app)
        .post('/api/payments/stripe/webhook')
        .set('Content-Type', 'application/json')
        .set('stripe-signature', header)
        .send(Buffer.from(raw));

      // 200 = traité (ou idempotent) ; 400 = signature invalide
      expect(res.status).toBe(200);

      // Vérification DB : payment_status doit être passé à paid
      const { rows: [updated] } = await db.query(
        `SELECT payment_status FROM orders WHERE id = $1`, [order.id]
      );
      expect(updated.payment_status).toBe('paid');
    });

    test('webhook avec signature invalide → 400', async () => {
      const res = await request(app)
        .post('/api/payments/stripe/webhook')
        .set('Content-Type', 'application/json')
        .set('stripe-signature', 't=1234,v1=invalidsig')
        .send(Buffer.from('{"id":"evt_fake","type":"payment_intent.succeeded"}'));

      expect(res.status).toBe(400);
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // Parcours 3 — Remboursement (annulation → wallet_credit)
  // ════════════════════════════════════════════════════════════════════════════
  describe('3 — remboursement (POST /api/orders/:id/cancel)', () => {
    test('client annule sa commande non payée → 200 + status cancelled', async () => {
      const order = await seedOrder({
        payment_mode:   'cash_relais',
        payment_status: 'pending',    // non payée → pas de refund externe
        status:         'confirmed',
        userId:         clientUser.id,
      });

      const res = await request(app)
        .post(`/api/orders/${order.id}/cancel`)
        .set('Authorization', `Bearer ${clientUser.token}`)
        .send({ reason: 'Test annulation E2E' });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('cancelled_order');

      const { rows: [updated] } = await db.query(
        `SELECT status FROM orders WHERE id = $1`, [order.id]
      );
      expect(updated.status).toBe('cancelled');
    });

    test('admin ne peut pas annuler commande déjà annulée → 422', async () => {
      const order = await seedOrder({
        payment_mode:   'cash_relais',
        payment_status: 'pending',
        status:         'cancelled',
      });

      const res = await request(app)
        .post(`/api/orders/${order.id}/cancel`)
        .set('Authorization', `Bearer ${adminUser.token}`)
        .send({});

      expect(res.status).toBe(422);
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // Parcours 4 — Panier partagé V4 cycle complet (cash)
  // ════════════════════════════════════════════════════════════════════════════
  describe('4 — panier partagé V4 (création → fermeture → contribution cash → confirmation)', () => {
    let cartId;
    let cartToken;
    let contributionId;

    test('création panier partagé depuis items → 200, status open', async () => {
      const res = await request(app)
        .post('/api/shared-carts/from-cart-items')
        .set('Authorization', `Bearer ${clientUser.token}`)
        .send({
          cart_items:       [{ product_id: productId, quantity: 1 }],
          title:            'E2E Panier Test',
          delivery_relay_id: relaisId,
        });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('shared_cart_id');
      expect(res.body).toHaveProperty('token');
      expect(res.body.status).toBe('open');

      cartId    = res.body.shared_cart_id;
      cartToken = res.body.token;
    });

    test('fermeture panier → status closed', async () => {
      const res = await request(app)
        .post(`/api/shared-carts/${cartId}/close`)
        .set('Authorization', `Bearer ${clientUser.token}`);

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.cart.status).toBe('closed');
    });

    test('contribution cash publique → 201 + pending_cash', async () => {
      const res = await request(app)
        .post(`/api/shared-carts/public/${cartToken}/contributions/cash`)
        .send({
          contributor_name: 'Contributeur E2E',
          amount_kmf:       5000,
        });

      expect(res.status).toBe(201);
      expect(res.body.status).toBe('pending_cash');
      expect(res.body).toHaveProperty('cash_reference');

      contributionId = res.body.contribution_id;
    });

    test('confirmation cash contribution par admin → ok', async () => {
      const res = await request(app)
        .post(`/api/shared-carts/contributions/${contributionId}/confirm-cash`)
        .set('Authorization', `Bearer ${adminUser.token}`);

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);

      // Vérification DB : contribution confirmée
      const { rows: [contrib] } = await db.query(
        `SELECT status FROM shared_cart_contributions WHERE id = $1`,
        [contributionId]
      );
      expect(contrib.status).toBe('paid');
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // Parcours 5 — Admin order bout en bout (transitions statut)
  // ════════════════════════════════════════════════════════════════════════════
  describe('5 — admin commande bout en bout (transitions statut)', () => {
    let order;

    beforeAll(async () => {
      order = await seedOrder({
        payment_mode:   'cash_relais',
        payment_status: 'paid',
        status:         'confirmed',
      });
    });

    test('admin confirmed → ordered via PATCH /api/orders/:id/status', async () => {
      const res = await request(app)
        .patch(`/api/orders/${order.id}/status`)
        .set('Authorization', `Bearer ${adminUser.token}`)
        .send({ status: 'ordered' });

      expect(res.status).toBe(200);
      expect(res.body.status || res.body.new_status).toBe('ordered');
    });

    test('admin ordered → preparation', async () => {
      const res = await request(app)
        .patch(`/api/orders/${order.id}/status`)
        .set('Authorization', `Bearer ${adminUser.token}`)
        .send({ status: 'preparation' });

      expect(res.status).toBe(200);
      expect(res.body.status || res.body.new_status).toBe('preparation');
    });

    test('historique statuts contient les 2 transitions', async () => {
      const { rows } = await db.query(
        `SELECT status FROM order_status_history
         WHERE order_id = $1
         ORDER BY created_at ASC`,
        [order.id]
      );

      const statuses = rows.map((r) => r.status);
      expect(statuses).toContain('ordered');
      expect(statuses).toContain('preparation');
    });

    test('tentative de transition invalide → 4xx', async () => {
      // preparation → pending est une transition rétrograde invalide
      const res = await request(app)
        .patch(`/api/orders/${order.id}/status`)
        .set('Authorization', `Bearer ${adminUser.token}`)
        .send({ status: 'pending' });

      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.status).toBeLessThan(500);
    });
  });
}
