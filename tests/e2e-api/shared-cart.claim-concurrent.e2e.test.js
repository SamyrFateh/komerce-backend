'use strict';

/**
 * @test-kind e2e
 * @test-runner jest
 * @test-requires postgres
 */

/**
 * E2E-P1-SHARED-CART — arbitrage de la réclamation d'une ligne de liste sous
 * concurrence réelle PostgreSQL
 *
 * Feature propriétaire : shared-cart
 * Features traversées  : orders (POST /api/orders, checkout canonique)
 *
 * Invariant prouvé (migrations/123_shared_cart_item_claim_bridge.sql,
 * services/order-checkout-item-resolution.js, services/order-checkout-
 * service.js) :
 *   « un article de liste partagée (shared_cart_items) n'est réclamable
 *     qu'une seule fois — D2. Deux acheteurs concurrents ne peuvent jamais
 *     tous les deux obtenir une commande valide sur la même ligne. »
 *
 * Double filet documenté par la migration 123 et par
 * tests/unit/orders-create-route.test.js (§6) :
 *   1. `SELECT ... FOR UPDATE OF sci` sur shared_cart_items sérialise les
 *      transactions visant la même ligne — le second arrivant voit
 *      `already_claimed = true` après avoir acquis le verrou et reçoit
 *      409 `shared_cart_item_mismatch`.
 *   2. Filet de secours : l'index UNIQUE `order_items_shared_cart_item_id_
 *      unique` fait échouer tout INSERT résiduel en double sur 23505,
 *      traduit en 409 `shared_cart_item_already_claimed`.
 *
 * Les tests unitaires existants couvrent la traduction du code erreur via
 * un client Postgres MOQUÉ — ils prouvent que le code JS réagit
 * correctement SI Postgres lève 23505, mais ne peuvent pas prouver que
 * Postgres le lève réellement sous charge concurrente, ni que le verrou
 * FOR UPDATE OF sci existe et sérialise effectivement deux connexions
 * indépendantes. C'est précisément ce que cette suite E2E vérifie contre
 * une vraie base.
 *
 * Scénarios :
 *   1. NOMINAL     un seul acheteur réclame une ligne libre → succès, ligne
 *                  marquée réclamée
 *   2. DÉJÀ PRIS    un second acheteur tente une ligne déjà réclamée sur une
 *                  liste encore ouverte (autre ligne libre) → 409
 *                  shared_cart_item_already_claimed, aucun second order_item
 *   2bis. FERMETURE  la dernière ligne d'une liste ferme automatiquement la
 *                  liste ; tout achat suivant sur cette ligne rencontre la
 *                  garde de statut → 409 shared_cart_closed
 *   3. CONCURRENCE  deux acheteurs distincts envoient leur commande sur la
 *                  MÊME ligne en parallèle → exactement un 201, un 409,
 *                  exactement un order_items rattaché à la ligne
 *   4. NON-MÉLANGE  un acheteur ne peut pas réclamer la ligne du produit A
 *                  en achetant en réalité le produit B (mismatch produit)
 */

const request = require('supertest');
const express = require('express');
const { signAuthToken } = require('../../utils/auth-session');

const { describeE2E, createCleanup, activateLocalPrice, RUN_TAG, tag, uuid } = require('../helpers/e2eDbKit');

jest.setTimeout(60000);

describeE2E('E2E-P1-SHARED-CART — réclamation d\'une ligne de liste sous concurrence', ({ db }) => {
  const buyerAId = uuid();
  const buyerBId = uuid();
  const relaisId = uuid();
  const organizerIds = [];

  let cleanup;
  let app;
  let tokenA;
  let tokenB;
  let marketId;

  /**
   * Un nouvel organisateur par scénario : CONFIG.MAX_OPEN_PER_ORGANIZER = 1
   * interdit une seconde liste ouverte pour le même organisateur, et le
   * scénario 2 (liste à 2 lignes) laisse volontairement sa liste ouverte
   * après le test — partager l'organisateur entre scénarios ferait
   * échouer la création de liste du scénario suivant sur open_list_exists.
   */
  async function createOrganizer(label) {
    const id = uuid();
    await db.query(
      `INSERT INTO users (id, full_name, email, phone, role)
       VALUES ($1, $2, $3, $4, 'client')`,
      [id, `E2E SharedCart Organizer ${tag(label)}`, `${tag('organizer-' + label)}@komerce.test`, `+2693${Math.floor(Math.random() * 9e6 + 1e6)}`]
    );
    organizerIds.push(id);
    return id;
  }

  /** Crée un produit dédié au scénario, avec prix local actif sur le marché KM. */
  async function seedProduct(label) {
    const id = uuid();
    await db.query(
      `INSERT INTO products (id, name, price_kmf, stock) VALUES ($1, $2, 15000, 100)`,
      [id, `E2E SharedCart ${tag(label)}`]
    );
    await activateLocalPrice(db, cleanup, { marketId, productId: id, amount: 15000, currency: 'KMF' });
    return id;
  }

  /** Crée une liste partagée ouverte avec une ligne par produit fourni, via le service canonique. */
  async function seedSharedCart(productIds, label) {
    const organizerId = await createOrganizer(label);
    const { createSharedCartFromCartItems } = require('../../services/shared-cart-creation');
    const { sharedCart, items } = await createSharedCartFromCartItems(
      organizerId,
      productIds.map(product_id => ({ product_id, quantity: 1 })),
      { deliveryRelayId: relaisId, title: `E2E liste ${tag(label)}` }
    );
    return { sharedCartId: sharedCart.id, itemIds: items.map(it => it.id) };
  }

  /** Variante à une seule ligne — pratique quand la fermeture auto de la liste fait partie du scénario testé. */
  async function seedSharedCartItem(productId, label) {
    const { sharedCartId, itemIds } = await seedSharedCart([productId], label);
    return { sharedCartId, sharedCartItemId: itemIds[0] };
  }

  /** Tente de réclamer une ligne de liste via la route publique réelle. */
  function claimItem(token, productId, sharedCartItemId) {
    return request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${token}`)
      .send({
        items: [{ product_id: productId, quantity: 1, shared_cart_item_id: sharedCartItemId }],
        relais_id: relaisId,
        payment_mode: 'cash_relais',
        recipient_name: 'Destinataire E2E',
        recipient_phone: '+269000333',
        tracking_phone: '+269000333',
      });
  }

  beforeAll(async () => {
    cleanup = createCleanup(db);

    const { rows: [market] } = await db.query(`SELECT id FROM markets WHERE code = 'KM'`);
    marketId = market.id;

    // organizerIds est peuplé au fil des tests par createOrganizer() ; ces
    // trackSql capturent la RÉFÉRENCE du tableau, pas une copie à cet
    // instant — au moment de cleanup.run() (afterAll), tous les
    // organisateurs créés entre-temps y figurent.
    //
    // cleanup.run() dépile en LIFO (dernier empilé = premier exécuté) :
    // l'ordre d'empilement ci-dessous est donc l'INVERSE de l'ordre
    // d'exécution voulu (parents d'abord empilés, enfants exécutés
    // d'abord) :
    //   exécution réelle : order_items → order_status_history → invoices
    //     → shared_cart_events → shared_cart_items → orders →
    //     shared_carts → recipients → relais → products → users
    const allUserIds = organizerIds; // référence vivante, complétée par createOrganizer() au fil des tests
    cleanup.trackSql(`DELETE FROM users WHERE id = ANY($1::uuid[]) OR id = ANY($2::uuid[])`, [allUserIds, [buyerAId, buyerBId]]);
    cleanup.trackSql(`DELETE FROM products WHERE name LIKE $1`, [`E2E SharedCart ${RUN_TAG}%`]);
    cleanup.trackSql(`DELETE FROM relais WHERE id = $1`, [relaisId]);
    cleanup.trackSql(`DELETE FROM recipients WHERE relais_id = $1`, [relaisId]);
    cleanup.trackSql(`DELETE FROM shared_carts WHERE organizer_user_id = ANY($1::uuid[])`, [organizerIds]);
    cleanup.trackSql(
      `DELETE FROM shared_cart_items WHERE shared_cart_id IN (SELECT id FROM shared_carts WHERE organizer_user_id = ANY($1::uuid[]))`,
      [organizerIds]
    );
    cleanup.trackSql(
      `DELETE FROM shared_cart_events WHERE shared_cart_id IN (SELECT id FROM shared_carts WHERE organizer_user_id = ANY($1::uuid[]))`,
      [organizerIds]
    );
    cleanup.trackSql(`DELETE FROM orders WHERE user_id = ANY($1::uuid[])`, [[buyerAId, buyerBId]]);
    cleanup.trackSql(`DELETE FROM invoices WHERE order_id IN (SELECT id FROM orders WHERE user_id = ANY($1::uuid[]))`, [[buyerAId, buyerBId]]);
    cleanup.trackSql(`DELETE FROM order_status_history WHERE order_id IN (SELECT id FROM orders WHERE user_id = ANY($1::uuid[]))`, [[buyerAId, buyerBId]]);
    cleanup.trackSql(
      `DELETE FROM order_items WHERE order_id IN (SELECT id FROM orders WHERE user_id = ANY($1::uuid[]))`,
      [[buyerAId, buyerBId]]
    );

    await db.query(
      `INSERT INTO users (id, full_name, email, phone, role) VALUES
         ($1, 'E2E SharedCart Buyer A', $2, $3, 'client'),
         ($4, 'E2E SharedCart Buyer B', $5, $6, 'client')`,
      [
        buyerAId, `${tag('buyerA')}@komerce.test`, `+2693${Math.floor(Math.random() * 9e6 + 1e6)}`,
        buyerBId, `${tag('buyerB')}@komerce.test`, `+2693${Math.floor(Math.random() * 9e6 + 1e6)}`,
      ]
    );

    await db.query(
      `INSERT INTO relais (id, name, agent_name, phone, address, island, market_id)
       VALUES ($1, 'E2E Relais SharedCart', 'E2E Agent', '+269000111', 'Moroni Test', 'Ngazidja', $2)`,
      [relaisId, marketId]
    );

    tokenA = signAuthToken({ id: buyerAId, role: 'client' }, { method: 'e2e' });
    tokenB = signAuthToken({ id: buyerBId, role: 'client' }, { method: 'e2e' });

    app = express();
    app.use(require('cookie-parser')());
    app.use(express.json());
    app.use('/api/orders', require('../../routes/orders'));
    app.use((err, _req, res, _next) => res.status(err.status || 500).json({ error: err.message }));
  });

  afterAll(async () => {
    if (cleanup) await cleanup.run();
  });

  it('1 — NOMINAL : un acheteur réclame une ligne libre → 201, ligne marquée réclamée', async () => {
    const productId = await seedProduct('nominal');
    const { sharedCartItemId } = await seedSharedCartItem(productId, 'nominal');

    const res = await claimItem(tokenA, productId, sharedCartItemId);

    expect(res.status).toBe(201);

    const { rows } = await db.query(
      `SELECT order_id FROM order_items WHERE shared_cart_item_id = $1`,
      [sharedCartItemId]
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].order_id).toBe(res.body.order.id);
  });

  it('2 — DÉJÀ PRIS : un second acheteur après coup sur une liste encore ouverte → 409 already_claimed', async () => {
    // Liste à DEUX lignes : après la réclamation de la première, la
    // fermeture automatique (cart-share-service.js) ne se déclenche que
    // lorsque TOUTES les lignes sont réclamées — la seconde ligne restant
    // libre, la liste reste ouverte, ce qui isole précisément le filet
    // already_claimed de celui de la fermeture testé au 2bis.
    const productId = await seedProduct('sequential');
    const otherProductId = await seedProduct('sequential-other');
    const { itemIds } = await seedSharedCart([productId, otherProductId], 'sequential');
    const [sharedCartItemId] = itemIds;

    const first = await claimItem(tokenA, productId, sharedCartItemId);
    expect(first.status).toBe(201);

    const second = await claimItem(tokenB, productId, sharedCartItemId);
    expect(second.status).toBe(409);
    expect(second.body).toMatchObject({ code: 'shared_cart_item_already_claimed' });

    const { rows } = await db.query(
      `SELECT COUNT(*)::int AS c FROM order_items WHERE shared_cart_item_id = $1`,
      [sharedCartItemId]
    );
    expect(rows[0].c).toBe(1);
  });

  it('2bis — LISTE FERMÉE : dernière ligne réclamée ferme la liste, tout achat suivant → 409 shared_cart_closed', async () => {
    // Liste à une seule ligne : sa réclamation ferme automatiquement la
    // liste (doctrine « panier_ouvert_ferme », services/cart-share-
    // service.js). Une tentative suivante sur cette même ligne doit
    // rencontrer la garde de statut AVANT le filet already_claimed —
    // l'ordre des vérifications dans order-checkout-item-resolution.js
    // place `cart_status !== 'open'` avant `already_claimed`.
    const productId = await seedProduct('autoclose');
    const { sharedCartId, sharedCartItemId } = await seedSharedCartItem(productId, 'autoclose');

    const first = await claimItem(tokenA, productId, sharedCartItemId);
    expect(first.status).toBe(201);

    const { rows: cartRows } = await db.query(
      `SELECT status FROM shared_carts WHERE id = $1`,
      [sharedCartId]
    );
    expect(cartRows[0].status).toBe('closed');

    const second = await claimItem(tokenB, productId, sharedCartItemId);
    expect(second.status).toBe(409);
    expect(second.body).toMatchObject({ code: 'shared_cart_closed' });
  });

  it('3 — CONCURRENCE : deux acheteurs sur la même ligne en parallèle → un seul gagnant', async () => {
    const productId = await seedProduct('race');
    const { sharedCartItemId } = await seedSharedCartItem(productId, 'race');

    // Les deux requêtes HTTP partent réellement en parallèle : c'est le
    // FOR UPDATE OF sci (et, en filet, la contrainte unique) qui doit
    // arbitrer — pas le test.
    const [resA, resB] = await Promise.all([
      claimItem(tokenA, productId, sharedCartItemId),
      claimItem(tokenB, productId, sharedCartItemId),
    ]);

    const statuses = [resA.status, resB.status].sort();
    expect(statuses).toEqual([201, 409]);

    const winner = resA.status === 201 ? resA : resB;
    const loser = resA.status === 201 ? resB : resA;

    expect(['shared_cart_item_mismatch', 'shared_cart_item_already_claimed', 'shared_cart_closed']).toContain(loser.body.code);

    const { rows } = await db.query(
      `SELECT order_id FROM order_items WHERE shared_cart_item_id = $1`,
      [sharedCartItemId]
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].order_id).toBe(winner.body.order.id);
  });

  it('4 — NON-MÉLANGE : impossible de réclamer la ligne du produit A en commandant le produit B', async () => {
    const productA = await seedProduct('mix-a');
    const productB = await seedProduct('mix-b');
    const { sharedCartItemId } = await seedSharedCartItem(productA, 'mix');

    const res = await claimItem(tokenA, productB, sharedCartItemId);

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ code: 'shared_cart_item_mismatch' });

    const { rows } = await db.query(
      `SELECT COUNT(*)::int AS c FROM order_items WHERE shared_cart_item_id = $1`,
      [sharedCartItemId]
    );
    expect(rows[0].c).toBe(0);
  });
});
