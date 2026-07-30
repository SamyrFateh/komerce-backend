'use strict';

/**
 * E2E-P0-SHAREDCART — shared-cart · idempotence webhook et fenêtre de règlement
 *
 * Feature propriétaire : shared-cart
 * Features traversées  : payments (webhook Stripe réel), auth-identity
 *                        (bénéficiaire), catalog, logistics
 *
 * Invariants visés (features/shared-cart.feature.js) :
 *   « idempotence webhook Stripe sur shared_cart_contributions »
 *   « fenêtre paiement 48h — aucune extension sans machine de statut »
 *
 * Contrat mesuré de `confirmContributionFromStripeSafely`
 * (services/shared-cart-financial-guard.js) :
 *   - contribution retrouvée par `stripe_session_id` sous `FOR UPDATE` ;
 *   - `status === 'paid'`      → sortie immédiate, rien n'est recompté ;
 *   - `status !== 'pending'`   → événement tracé, sortie ;
 *   - `session.payment_status !== 'paid'` → sortie ;
 *   - panier verrouillé `FOR UPDATE` ; s'il n'est ni `closed_for_settlement`
 *     ni `settlement_in_progress` → `markPaidButNotCounted` ;
 *   - montant > reste dû        → `markPaidButNotCounted` ;
 *   - sinon                     → contribution `paid`, compteurs du panier mis
 *     à jour, statut recalculé.
 *
 * La fenêtre de 48 h n'est PAS un test de date dans ce garde : elle est portée
 * par le statut du panier. Un panier `expired` refuse donc la contribution même
 * si le webhook arrive avec une signature valide — c'est exactement ce que dit
 * « aucune extension sans machine de statut », et c'est ce que le scénario 5
 * vérifie.
 *
 * FRONTIÈRE RÉSEAU CONTRÔLÉE : aucune. Le corps du webhook est signé par le
 * vrai SDK Stripe et vérifié par la vraie `stripe.webhooks.constructEvent` du
 * handler. Base, garde financier, transactions et compteurs sont réels.
 *
 * DOCTRINE RED — les assertions expriment le contrat métier attendu.
 */

const request = require('supertest');
const express = require('express');
const Stripe = require('stripe');

const { describeE2E, createCleanup, RUN_TAG, tag, uuid } = require('../helpers/e2eDbKit');

jest.setTimeout(60000);

describeE2E('E2E-P0-SHAREDCART — shared-cart · idempotence et fenêtre', ({ db }) => {
  const stripe = Stripe(process.env.STRIPE_SECRET_KEY || 'sk_test_dummy');
  // Le handler lit STRIPE_SHARED_CART_WEBHOOK_SECRET puis retombe sur
  // STRIPE_WEBHOOK_SECRET : on signe avec la même cascade.
  const SECRET = process.env.STRIPE_SHARED_CART_WEBHOOK_SECRET
              || process.env.STRIPE_WEBHOOK_SECRET
              || 'whsec_dummy';

  const beneficiaryId = uuid();
  let cleanup;
  let app;

  // ── construction d'événements ────────────────────────────────────────────
  function checkoutSessionCompleted({ eventId, sessionId, paymentStatus = 'paid', isSharedCart = true }) {
    return {
      id: eventId,
      object: 'event',
      type: 'checkout.session.completed',
      created: Math.floor(Date.now() / 1000),
      data: {
        object: {
          id: sessionId,
          object: 'checkout.session',
          payment_status: paymentStatus,
          payment_intent: `pi_${sessionId}`,
          metadata: isSharedCart ? { komerce: 'shared_cart_contribution' } : { komerce: 'autre_chose' },
        },
      },
    };
  }

  function post(event, { badSignature = false } = {}) {
    const raw = JSON.stringify(event);
    const signature = badSignature
      ? 't=1,v1=deadbeef'
      : stripe.webhooks.generateTestHeaderString({ payload: raw, secret: SECRET });
    return request(app)
      .post('/api/shared-carts/stripe/webhook')
      .set('stripe-signature', signature)
      .set('Content-Type', 'application/json')
      .send(raw);
  }

  /**
   * Sème un panier partagé et une contribution `pending` rattachée à une
   * session Stripe. `cartStatus` et `remaining` sont paramétrables pour
   * exercer les branches du garde.
   */
  async function seedCart(label, { cartStatus = 'closed_for_settlement', total = 25000, remaining = 25000, amount = 25000 } = {}) {
    const cartId = uuid();
    const contributionId = uuid();
    const sessionId = `cs_${tag(label)}`;
    const token = `E2ESC-${tag(label)}`;

    await db.query(
      `INSERT INTO shared_carts
         (id, token, beneficiary_user_id, currency_snapshot, total_kmf_snapshot,
          contributed_kmf, remaining_kmf, status, expires_at, title)
       VALUES ($1, $2, $3, 'KMF', $4, $5, $6, $7::shared_cart_status,
               now() + interval '48 hours', $8)`,
      [cartId, token, beneficiaryId, total, total - remaining, remaining, cartStatus,
       `E2E SharedCart ${tag(label)}`]
    );

    await db.query(
      `INSERT INTO shared_cart_contributions
         (id, shared_cart_id, contributor_name, contributor_email, amount_kmf,
          amount_paid, currency_paid, stripe_session_id, status, payment_method)
       VALUES ($1, $2, 'E2E Contributeur', $3, $4, $5, 'EUR', $6, 'pending', 'stripe')`,
      [contributionId, cartId, `${tag('contrib')}@komerce.test`, amount, amount / 500, sessionId]
    );

    return { cartId, contributionId, sessionId, token };
  }

  const cartState = async (cartId) => {
    const { rows } = await db.query(
      'SELECT status, contributed_kmf, remaining_kmf FROM shared_carts WHERE id = $1',
      [cartId]
    );
    return rows[0];
  };

  const contributionState = async (contributionId) => {
    const { rows } = await db.query(
      'SELECT status, paid_at FROM shared_cart_contributions WHERE id = $1',
      [contributionId]
    );
    return rows[0];
  };

  const eventConsumed = async (eventId) => {
    const { rows } = await db.query(
      'SELECT 1 FROM stripe_events_processed WHERE stripe_event_id = $1',
      [eventId]
    );
    return rows;
  };

  beforeAll(async () => {
    cleanup = createCleanup(db);

    const cartsOfRun = `SELECT id FROM shared_carts WHERE beneficiary_user_id = '${beneficiaryId}'`;
    cleanup.trackSql('DELETE FROM users WHERE id = $1', [beneficiaryId]);
    cleanup.trackSql(`DELETE FROM shared_carts WHERE beneficiary_user_id = $1`, [beneficiaryId]);
    cleanup.trackSql(`DELETE FROM shared_cart_events WHERE shared_cart_id IN (${cartsOfRun})`);
    cleanup.trackSql(`DELETE FROM shared_cart_items WHERE shared_cart_id IN (${cartsOfRun})`);
    cleanup.trackSql(`DELETE FROM shared_cart_contributions WHERE shared_cart_id IN (${cartsOfRun})`);
    cleanup.trackSql(
      'DELETE FROM stripe_events_processed WHERE stripe_event_id LIKE $1',
      [`evt_${RUN_TAG}%`]
    );

    await db.query(
      `INSERT INTO users (id, full_name, email, phone, role)
       VALUES ($1, 'E2E SharedCart Beneficiaire', $2, $3, 'client')`,
      [beneficiaryId, `${tag('scbene')}@komerce.test`,
       `+2693${Math.floor(Math.random() * 9e6 + 1e6)}`]
    );

    // Reproduit server.js:87 + server.js:176 — corps BRUT obligatoire pour la
    // vérification de signature Stripe.
    const sharedCart = require('../../routes/shared-cart');
    app = express();
    app.use(require('cookie-parser')());
    app.use('/api/shared-carts/stripe/webhook', express.raw({ type: 'application/json' }));
    app.post('/api/shared-carts/stripe/webhook', sharedCart.stripeWebhookHandler);
    app.use((err, _req, res, _next) => res.status(err.status || 500).json({ error: err.message }));
  });

  afterAll(async () => {
    if (cleanup) await cleanup.run();
  });

  // ── 1. NOMINAL ───────────────────────────────────────────────────────────
  it('1 — NOMINAL : une contribution payée est comptée une fois et solde le panier', async () => {
    const c = await seedCart('nominal');
    const eventId = `evt_${tag('nominal')}`;

    const res = await post(checkoutSessionCompleted({ eventId, sessionId: c.sessionId }));
    expect(res.status).toBe(200);

    const contribution = await contributionState(c.contributionId);
    expect(contribution.status).toBe('paid');
    expect(contribution.paid_at).not.toBeNull();

    const cart = await cartState(c.cartId);
    expect(Number(cart.contributed_kmf)).toBe(25000);
    expect(Number(cart.remaining_kmf)).toBe(0);
    // reste nul → le panier devient finalisable, il ne reste pas en règlement.
    expect(cart.status).toBe('ready_to_finalize');

    expect(await eventConsumed(eventId)).toHaveLength(1);
  });

  // ── 2. IDEMPOTENCE — même event_id ───────────────────────────────────────
  it('2 — rejeu du MÊME event_id : court-circuit idempotent, aucun recomptage', async () => {
    const c = await seedCart('sameevent');
    const eventId = `evt_${tag('sameevent')}`;
    const event = checkoutSessionCompleted({ eventId, sessionId: c.sessionId });

    const first = await post(event);
    expect(first.status).toBe(200);
    const cartAfterFirst = await cartState(c.cartId);
    const contribAfterFirst = await contributionState(c.contributionId);

    const second = await post(event);
    expect(second.status).toBe(200);
    expect(second.body).toMatchObject({ idempotent: true });

    expect(await cartState(c.cartId)).toEqual(cartAfterFirst);
    expect(await contributionState(c.contributionId)).toEqual(contribAfterFirst);
  });

  // ── 3. IDEMPOTENCE — event_id différent, MÊME session ────────────────────
  it('3 — event_id différent sur la MÊME session : la contribution n’est pas comptée deux fois', async () => {
    const c = await seedCart('samesession');
    const session = c.sessionId;

    const first = await post(checkoutSessionCompleted({ eventId: `evt_${tag('ss1')}`, sessionId: session }));
    expect(first.status).toBe(200);
    const cartAfterFirst = await cartState(c.cartId);
    expect(Number(cartAfterFirst.contributed_kmf)).toBe(25000);

    // Cas réel : Stripe réémet un événement sous un nouvel identifiant. Le
    // garde d'idempotence par event_id ne protège plus — c'est le verrou
    // `FOR UPDATE` + le test `status === 'paid'` qui doit tenir.
    const second = await post(checkoutSessionCompleted({ eventId: `evt_${tag('ss2')}`, sessionId: session }));
    expect(second.status).toBe(200);

    const cartAfterSecond = await cartState(c.cartId);
    expect(Number(cartAfterSecond.contributed_kmf)).toBe(25000);
    expect(Number(cartAfterSecond.remaining_kmf)).toBe(0);
    expect(cartAfterSecond).toEqual(cartAfterFirst);

    // Une seule contribution `paid` pour ce panier — jamais un doublon de ligne.
    const { rows } = await db.query(
      `SELECT count(*)::int AS n FROM shared_cart_contributions
        WHERE shared_cart_id = $1 AND status = 'paid'`,
      [c.cartId]
    );
    expect(rows[0].n).toBe(1);
  });

  // ── 4. SURFINANCEMENT ────────────────────────────────────────────────────
  it('4 — montant supérieur au reste dû : encaissé mais non compté, panier intact', async () => {
    const c = await seedCart('overfund', { total: 25000, remaining: 5000, amount: 25000 });
    const eventId = `evt_${tag('overfund')}`;

    const before = await cartState(c.cartId);
    const res = await post(checkoutSessionCompleted({ eventId, sessionId: c.sessionId }));
    expect(res.status).toBe(200);

    // Le garde refuse de compter une contribution qui dépasse le reste dû :
    // compter 25 000 sur 5 000 restants ferait mentir les compteurs du panier.
    const cart = await cartState(c.cartId);
    expect(Number(cart.contributed_kmf)).toBe(Number(before.contributed_kmf));
    expect(Number(cart.remaining_kmf)).toBe(Number(before.remaining_kmf));

    // Statut exact mesuré, pas une simple négation : `markPaidButNotCounted`
    // bascule la contribution en `failed`. L'argent est encaissé chez Stripe
    // mais n'entre pas dans les compteurs — c'est une anomalie à traiter
    // manuellement, et elle doit rester visible sous ce statut.
    const contribution = await contributionState(c.contributionId);
    expect(contribution.status).toBe('failed');
  });

  // ── 5. FENÊTRE DE RÈGLEMENT ──────────────────────────────────────────────
  it('5 — panier expiré : un webhook valide ne rouvre pas la fenêtre de règlement', async () => {
    const c = await seedCart('expired', { cartStatus: 'expired' });
    const eventId = `evt_${tag('expired')}`;

    const before = await cartState(c.cartId);
    const res = await post(checkoutSessionCompleted({ eventId, sessionId: c.sessionId }));
    expect(res.status).toBe(200);

    // « aucune extension sans machine de statut » : la fenêtre est portée par
    // le statut du panier, pas par la bonne volonté du webhook. Un panier
    // expiré ne doit pas encaisser une part supplémentaire.
    const cart = await cartState(c.cartId);
    expect(cart.status).toBe('expired');
    expect(Number(cart.contributed_kmf)).toBe(Number(before.contributed_kmf));
    expect(Number(cart.remaining_kmf)).toBe(Number(before.remaining_kmf));

    const contribution = await contributionState(c.contributionId);
    expect(contribution.status).toBe('failed');
  });

  // ── 6. SESSION NON PAYÉE ─────────────────────────────────────────────────
  it('6 — session non payée (payment_status=unpaid) : aucun comptage', async () => {
    const c = await seedCart('unpaid');
    const eventId = `evt_${tag('unpaid')}`;

    const before = await cartState(c.cartId);
    const res = await post(checkoutSessionCompleted({
      eventId, sessionId: c.sessionId, paymentStatus: 'unpaid',
    }));
    expect(res.status).toBe(200);

    expect(await cartState(c.cartId)).toEqual(before);
    expect((await contributionState(c.contributionId)).status).toBe('pending');
  });

  // ── 7. SIGNATURE INVALIDE ────────────────────────────────────────────────
  it('7 — signature invalide : 400, aucun effet, événement non consommé', async () => {
    const c = await seedCart('badsig');
    const eventId = `evt_${tag('badsig')}`;

    const before = await cartState(c.cartId);
    const res = await post(
      checkoutSessionCompleted({ eventId, sessionId: c.sessionId }),
      { badSignature: true }
    );

    expect(res.status).toBe(400);
    expect(await cartState(c.cartId)).toEqual(before);
    expect((await contributionState(c.contributionId)).status).toBe('pending');
    // Un événement rejeté doit rester rejouable.
    expect(await eventConsumed(eventId)).toHaveLength(0);
  });

  // ── 8. SESSION ÉTRANGÈRE ─────────────────────────────────────────────────
  it("8 — session Stripe étrangère au panier partagé : ignorée sans effet", async () => {
    const c = await seedCart('foreign');
    const eventId = `evt_${tag('foreign')}`;

    const before = await cartState(c.cartId);
    const res = await post(checkoutSessionCompleted({
      eventId, sessionId: c.sessionId, isSharedCart: false,
    }));

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ignored: 'not_a_shared_cart_session' });
    expect(await cartState(c.cartId)).toEqual(before);
    expect((await contributionState(c.contributionId)).status).toBe('pending');
  });
});
