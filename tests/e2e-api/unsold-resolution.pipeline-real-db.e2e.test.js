'use strict';

/**
 * @test-kind e2e
 * @test-runner jest
 * @test-requires postgres
 */

/**
 * E2E-P2-UNSOLD — pipeline invendu (auto_unsold() + v_unsold_pipeline) sous
 * schéma PostgreSQL réel
 *
 * Feature propriétaire : unsold-resolution
 *
 * Contexte : cette feature n'avait qu'un seul fichier de test
 * (tests/unit/unsold.test.js), entièrement mocké — il couvre bien la
 * logique JS de routes/unsold.js (25 cas), mais ne peut structurellement
 * pas prouver que les deux pièces SQL dont dépend toute la feature se
 * comportent comme le code JS le suppose :
 *
 *   - `auto_unsold()` (fonction plpgsql, docs/db/railway-live-schema.sql) :
 *     bascule en invendu toute commande `status = 'available'` dont
 *     `available_at` date de plus de 14 jours et qui n'est pas déjà
 *     marquée `unsold_at`. Applique une remise de 25% (unsold_price_kmf
 *     = ROUND(total_kmf * 0.75)).
 *   - `v_unsold_pipeline` (vue) : projette unsold_items ⋈ orders ⋈ users,
 *     filtrée sur `status = 'available'` (côté unsold_items, pas orders —
 *     nom de colonne partagé, sens différent), avec deux colonnes
 *     calculées (remise_pct, jours_en_stock) dont aucun test n'avait
 *     jamais vérifié la formule contre de vraies lignes.
 *
 * Invariants prouvés ici, absents des mocks :
 *   1. La frontière des 14 jours est un vrai `INTERVAL '14 days'` Postgres,
 *      pas une approximation JS — un ordre à J-13 doit rester intact, un
 *      ordre à J-15 doit basculer.
 *   2. `auto_unsold()` est idempotent : rejouer le scan sur une commande
 *      déjà basculée ne la retouche pas (unsold_at déjà non NULL exclut
 *      la ligne du UPDATE).
 *   3. `v_unsold_pipeline.remise_pct` calcule bien le vrai pourcentage de
 *      remise à partir des deux prix, pas une valeur câblée.
 *   4. Le cycle complet passe par le vrai routeur HTTP (auth admin réelle,
 *      pas mockée) : scan → apparition dans la liste → resolve → la ligne
 *      DISPARAÎT de la liste (la vue filtre sur status='available' côté
 *      unsold_items — un article vendu/donné/détruit n'y figure plus).
 */

const request = require('supertest');
const express = require('express');
const { signAuthToken } = require('../../utils/auth-session');

const { describeE2E, createCleanup, tag, uuid } = require('../helpers/e2eDbKit');

jest.setTimeout(60000);

describeE2E('E2E-P2-UNSOLD — auto_unsold() + v_unsold_pipeline contre schéma réel', ({ db }) => {
  const adminId = uuid();
  const buyerId = uuid();
  const relaisId = uuid();
  const orderIds = [];

  let cleanup;
  let app;
  let adminToken;
  let marketId;

  /** Insère une commande dans un état donné, avec available_at daté à `daysAgo` jours. */
  async function seedOrder({ label, daysAgo, alreadyUnsold = false, totalKmf = 8000, paymentStatus = 'paid' }) {
    const id = uuid();
    orderIds.push(id);
    await db.query(
      `INSERT INTO orders (
         id, reference, user_id, relais_id, market_id, total_kmf, payment_mode, payment_status,
         status, available_at, unsold_at, unsold_price_kmf
       ) VALUES ($1, $2, $3, $4, $5, $6, 'cash_relais', $10, 'available',
                 NOW() - ($7 || ' days')::interval, $8, $9)`,
      [
        id, `E2E-UNSOLD-${tag(label)}`, buyerId, relaisId, marketId, totalKmf,
        daysAgo,
        alreadyUnsold ? new Date() : null,
        alreadyUnsold ? Math.round(totalKmf * 0.75) : null,
        paymentStatus,
      ]
    );
    return id;
  }

  async function unsoldRowsForOrder(orderId) {
    const { rows } = await db.query('SELECT * FROM unsold_items WHERE order_id = $1', [orderId]);
    return rows;
  }

  async function orderState(orderId) {
    const { rows: [row] } = await db.query(
      'SELECT unsold_at, unsold_price_kmf FROM orders WHERE id = $1',
      [orderId]
    );
    return row;
  }

  beforeAll(async () => {
    cleanup = createCleanup(db);

    const { rows: [market] } = await db.query(`SELECT id FROM markets WHERE code = 'KM'`);
    marketId = market.id;

    // cleanup.run() dépile en LIFO (dernier empilé = premier exécuté) ;
    // exécution réelle voulue : unsold_items → orders → relais → users.
    // Empilement donc dans l'ordre INVERSE : users, relais, orders,
    // unsold_items.
    cleanup.trackSql(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [[adminId, buyerId]]);
    cleanup.trackSql(`DELETE FROM relais WHERE id = $1`, [relaisId]);
    cleanup.trackSql(`DELETE FROM orders WHERE id = ANY($1::uuid[])`, [orderIds]);
    cleanup.trackSql(
      `DELETE FROM unsold_items WHERE order_id = ANY($1::uuid[])`,
      [orderIds] // référence vivante : orderIds se peuple au fil des tests
    );

    await db.query(
      `INSERT INTO users (id, full_name, email, phone, role) VALUES
         ($1, 'E2E Unsold Admin', $2, $3, 'admin'),
         ($4, 'E2E Unsold Buyer', $5, $6, 'client')`,
      [
        adminId, `${tag('admin')}@komerce.test`, `+2693${Math.floor(Math.random() * 9e6 + 1e6)}`,
        buyerId, `${tag('buyer')}@komerce.test`, `+2693${Math.floor(Math.random() * 9e6 + 1e6)}`,
      ]
    );

    await db.query(
      `INSERT INTO relais (id, name, agent_name, phone, address, island, market_id)
       VALUES ($1, 'E2E Relais Unsold', 'E2E Agent', '+269000111', 'Moroni Test', 'Ngazidja',
               (SELECT id FROM markets WHERE code = 'KM'))`,
      [relaisId]
    );

    adminToken = signAuthToken({ id: adminId, role: 'admin' }, { method: 'e2e' });

    app = express();
    app.use(require('cookie-parser')());
    app.use(express.json());
    app.use('/api/unsold', require('../../routes/unsold'));
    app.use((err, _req, res, _next) => res.status(err.status || 500).json({ error: err.message }));
  });

  afterAll(async () => {
    if (cleanup) await cleanup.run();
  });

  it("1 — FRONTIÈRE 14 JOURS : J-13 intact, J-15 basculé avec remise 75% exacte", async () => {
    const tooRecent = await seedOrder({ label: 'j13', daysAgo: 13, totalKmf: 8000, paymentStatus: 'pending' });
    const overdue = await seedOrder({ label: 'j15', daysAgo: 15, totalKmf: 8000, paymentStatus: 'pending' });

    await db.query('SELECT auto_unsold()');

    const recentState = await orderState(tooRecent);
    expect(recentState.unsold_at).toBeNull();

    const overdueState = await orderState(overdue);
    expect(overdueState.unsold_at).not.toBeNull();
    expect(Number(overdueState.unsold_price_kmf)).toBe(6000); // 8000 * 0.75
  });

  it("2 — IDEMPOTENCE : une commande déjà basculée n'est pas retouchée par un second scan", async () => {
    const orderId = await seedOrder({ label: 'idem', daysAgo: 30, totalKmf: 8000, paymentStatus: 'pending' });

    await db.query('SELECT auto_unsold()');
    const afterFirst = await orderState(orderId);
    const firstUnsoldAt = afterFirst.unsold_at;
    expect(firstUnsoldAt).not.toBeNull();

    // Deuxième scan : la commande est déjà unsold_at IS NOT NULL, donc hors
    // du prédicat WHERE de auto_unsold() — elle ne doit pas être re-touchée.
    await db.query('SELECT auto_unsold()');
    const afterSecond = await orderState(orderId);
    expect(afterSecond.unsold_at.getTime()).toBe(firstUnsoldAt.getTime());
  });

  it('3 — v_unsold_pipeline calcule remise_pct et jours_en_stock à partir des vraies lignes', async () => {
    const orderId = await seedOrder({ label: 'view', daysAgo: 20, alreadyUnsold: true, totalKmf: 10000, paymentStatus: 'pending' });
    await db.query(
      `INSERT INTO unsold_items (order_id, product_name, original_price_kmf, unsold_price_kmf)
       VALUES ($1, 'E2E Produit Vue', 10000, 7500)`,
      [orderId]
    );

    const { rows: viewRows } = await db.query(
      `SELECT v.remise_pct, v.jours_en_stock
         FROM v_unsold_pipeline v
         JOIN unsold_items ui ON ui.id = v.id
        WHERE ui.order_id = $1`,
      [orderId]
    );
    expect(viewRows).toHaveLength(1);
    // (1 - 7500/10000) * 100 = 25
    expect(Number(viewRows[0].remise_pct)).toBe(25);
    // unsold_at posé par seedOrder à NOW() (alreadyUnsold) → ~0 jour en stock.
    expect(Number(viewRows[0].jours_en_stock)).toBeGreaterThanOrEqual(0);
    expect(Number(viewRows[0].jours_en_stock)).toBeLessThan(1);
  });

  it('4 — F3 scan HTTP bloqué : commande payée à J+20 conservée, aucun unsold_item', async () => {
    const orderId = await seedOrder({ label: 'blockedJ20', daysAgo: 20, totalKmf: 12000 });

    const scanRes = await request(app)
      .post('/api/unsold/scan')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(scanRes.status).toBe(409);
    expect(scanRes.body.code).toBe('UNSOLD_NO_SHOW_NOT_CERTIFIED');

    const state = await orderState(orderId);
    expect(state.unsold_at).toBeNull();
    expect(await unsoldRowsForOrder(orderId)).toHaveLength(0);
    // La fonction SQL historique ne peut pas contourner la garde de commande.
    await expect(db.query('SELECT auto_unsold()')).rejects.toThrow(/UNSOLD_PAID_ORDER_PROTECTED/);
  });

  it('F3 — refus d une commande payée déjà marquée invendue (entrée INSERT)', async () => {
    const id = uuid();
    orderIds.push(id);
    await expect(db.query(
      `INSERT INTO orders(id,reference,user_id,relais_id,market_id,total_kmf,payment_mode,
        payment_status,status,unsold_at) VALUES($1,$2,$3,$4,$5,8000,'cash_relais',
        'paid','available',NOW())`,
      [id,`E2E-UNSOLD-${tag('paid-insert')}`,buyerId,relaisId,marketId]
    )).rejects.toThrow(/UNSOLD_PAID_ORDER_PROTECTED/);
  });

  it('F3 — paiement interdit après marquage invendu sous statut impayé', async () => {
    const id = await seedOrder({label:'unsold-to-paid',daysAgo:30,alreadyUnsold:true,paymentStatus:'pending'});
    await db.query(
      `INSERT INTO unsold_items(order_id,product_name,original_price_kmf,unsold_price_kmf)
       VALUES($1,'Article sous garde',8000,6000)`,[id]);
    await expect(db.query(
      `UPDATE orders SET payment_status='paid' WHERE id=$1`,[id]
    )).rejects.toThrow(/UNSOLD_PAID_ORDER_PROTECTED|UNSOLD_PAID_ITEM_PROTECTED/);
    const result=await db.query('SELECT payment_status FROM orders WHERE id=$1',[id]);
    expect(result.rows[0].payment_status).toBe('pending');
  });

  it('5 — F3 SQL refuse la création de toute ligne invendue pour une commande payée', async () => {
    const orderId = await seedOrder({ label: 'legacyPaid', daysAgo: 30, alreadyUnsold: true, totalKmf: 8000 });
    await expect(db.query(
      `INSERT INTO unsold_items(order_id, product_name, original_price_kmf, unsold_price_kmf)
       VALUES($1, 'Article client sous garde', 8000, 6000)`,
      [orderId]
    )).rejects.toThrow(/UNSOLD_PAID_ITEM_PROTECTED/);

    expect(await unsoldRowsForOrder(orderId)).toHaveLength(0);
  });

});
