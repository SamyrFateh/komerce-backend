'use strict';


/**
 * @test-kind e2e
 * @test-runner jest
 * @test-requires postgres
 */
/**
 * E2E-P0-ORDERS — orders · doctrine d'annulation, référence, snapshot de coût
 *
 * Feature propriétaire : orders
 * Features traversées  : auth (identité), catalog (produit et prix),
 *                        logistics (relais), business-rules (règles de
 *                        fenêtre et de taux), economic-engine (snapshot)
 *
 * Invariants visés (features/orders.feature.js) :
 *   « reference de commande lisible et unique »
 *   « snapshot de cout figure a la creation, jamais recalcule retroactivement »
 *   « transition de statut uniquement via order-status-machine.js »
 *   « annulation libre et 100% avant ordered (plancher 24h) […] »
 *
 * Doctrine mesurée dans routes/orders/cancel.js :
 *   - `CANCEL_CUTOFF_STATUS` (défaut `shipped`) — annulation possible jusqu'à
 *     ce statut EXCLU ;
 *   - `CANCEL_FREE_WINDOW_HOURS` (défaut 24) — remboursement 100 % dedans,
 *     partiel au-delà ;
 *   - 403 si la commande appartient à un autre client ;
 *   - 422 si déjà `cancelled`/`refunded`, si `collected`, ou au-delà du cutoff.
 *
 * FRONTIÈRE RÉSEAU CONTRÔLÉE : aucune. Aucun paiement n'est nécessaire pour
 * les scénarios d'annulation avant `ordered`.
 *
 * DOCTRINE RED — les assertions expriment le contrat métier attendu.
 */

const request = require('supertest');
const express = require('express');
const jwt = require('jsonwebtoken');

const { describeE2E, createCleanup, RUN_TAG, tag, uuid } = require('../helpers/e2eDbKit');

jest.setTimeout(60000);

describeE2E('E2E-P0-ORDERS — orders · annulation, référence, snapshot', ({ db }) => {
  const clientId = uuid();
  const otherClientId = uuid();
  const relaisId = uuid();

  let cleanup;
  let app;
  let clientToken;
  let otherToken;

  async function seedProduct(label, priceKmf = 25000) {
    const id = uuid();
    await db.query(
      'INSERT INTO products (id, name, price_kmf, stock) VALUES ($1, $2, $3, 30)',
      [id, `E2E Orders ${tag(label)}`, priceKmf]
    );
    return id;
  }

  async function createOrder(productId, { quantity = 1, token = null } = {}) {
    const res = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${token || clientToken}`)
      .send({
        items: [{ product_id: productId, quantity }],
        relais_id: relaisId,
        payment_mode: 'cash_relais',
        recipient_name: 'Destinataire E2E',
        recipient_phone: '+269000222',
        tracking_phone: '+269000222',
      });
    if (res.status !== 201) {
      throw new Error(`création commande: ${res.status} ${JSON.stringify(res.body)}`);
    }
    return res.body.order;
  }

  const orderRow = async (orderId) => {
    const { rows } = await db.query(
      `SELECT status, payment_status, reference, total_kmf
         FROM orders WHERE id = $1`,
      [orderId]
    );
    return rows[0];
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

    const ids = [clientId, otherClientId];
    const ordersOfRun = `SELECT id FROM orders WHERE user_id IN ('${clientId}','${otherClientId}')`;
    cleanup.trackSql('DELETE FROM users WHERE id = ANY($1::uuid[])', [ids]);
    cleanup.trackSql('DELETE FROM products WHERE name LIKE $1', [`E2E Orders ${RUN_TAG}%`]);
    cleanup.trackSql('DELETE FROM relais WHERE id = $1', [relaisId]);
    cleanup.trackSql('DELETE FROM recipients WHERE relais_id = $1', [relaisId]);
    cleanup.trackSql(`DELETE FROM orders WHERE user_id IN ('${clientId}','${otherClientId}')`);
    cleanup.trackSql(`DELETE FROM refunds WHERE order_id IN (${ordersOfRun})`);
    cleanup.trackSql(`DELETE FROM order_status_history WHERE order_id IN (${ordersOfRun})`);
    cleanup.trackSql(`DELETE FROM invoices WHERE order_id IN (${ordersOfRun})`);
    cleanup.trackSql(`DELETE FROM order_items WHERE order_id IN (${ordersOfRun})`);

    await db.query(
      `INSERT INTO users (id, full_name, email, phone, role) VALUES
         ($1, 'E2E Orders Client', $2, $3, 'client'),
         ($4, 'E2E Orders Autre',  $5, $6, 'client')`,
      [
        clientId, `${tag('oclient')}@komerce.test`, `+2693${Math.floor(Math.random() * 9e6 + 1e6)}`,
        otherClientId, `${tag('oautre')}@komerce.test`, `+2693${Math.floor(Math.random() * 9e6 + 1e6)}`,
      ]
    );
    await db.query(
      `INSERT INTO relais (id, name, agent_name, phone, address, market_id)
       VALUES ($1, 'E2E Relais Orders', 'E2E Agent', '+269000111', 'Moroni Test', (SELECT id FROM markets WHERE code = 'KM'))`,
      [relaisId]
    );

    const sign = (id) =>
      jwt.sign({ id, role: 'client' }, process.env.JWT_SECRET, { algorithm: 'HS256', expiresIn: '1h' });
    clientToken = sign(clientId);
    otherToken = sign(otherClientId);

    app = express();
    app.use(require('cookie-parser')());
    app.use(express.json());
    app.use('/api/orders', require('../../routes/orders'));
    app.use((err, _req, res, _next) => res.status(err.status || 500).json({ error: err.message }));
  });

  afterAll(async () => {
    if (cleanup) await cleanup.run();
  });

  // ── 1. RÉFÉRENCE LISIBLE ET UNIQUE ───────────────────────────────────────
  it('1 — la référence est lisible, et la base refuse physiquement un doublon', async () => {
    const productId = await seedProduct('ref');
    const a = await createOrder(productId);
    const b = await createOrder(productId);

    expect(a.reference).toEqual(expect.any(String));
    expect(a.reference).not.toBe(b.reference);
    // « lisible » : pas un UUID brut jeté à la figure du client.
    expect(a.reference).not.toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    );

    // Garde de dernier recours : 23505 = unique_violation. Assertion sur le
    // SQLSTATE et non sur le message, que PostgreSQL localise.
    await expect(
      db.query('UPDATE orders SET reference = $1 WHERE id = $2', [a.reference, b.id])
    ).rejects.toMatchObject({ code: '23505' });

    expect((await orderRow(b.id)).reference).toBe(b.reference);
  });

  // ── 2. SNAPSHOT DE COÛT ──────────────────────────────────────────────────
  it("2 — le total est figé à la création : changer le prix du produit ne le recalcule pas", async () => {
    const productId = await seedProduct('snapshot', 25000);
    const order = await createOrder(productId, { quantity: 2 });

    const before = await orderRow(order.id);
    expect(Number(before.total_kmf)).toBeGreaterThan(0);

    // Le catalogue augmente après la commande.
    await db.query('UPDATE products SET price_kmf = 99000 WHERE id = $1', [productId]);

    // Relecture par la route publique de détail : le client doit voir le prix
    // qu'il a accepté, pas le nouveau. Recalculer rétroactivement changerait
    // le montant dû après coup.
    const res = await request(app)
      .get(`/api/orders/${order.id}`)
      .set('Authorization', `Bearer ${clientToken}`);
    expect(res.status).toBe(200);

    // C'est le montant EXPOSÉ au client qui compte, pas seulement la colonne :
    // 2 x 25 000 = 50 000 KMF, et non 2 x 99 000. Se contenter de relire la
    // base laisserait passer une route qui recalcule à l'affichage.
    expect(Number(res.body.total_kmf)).toBe(50000);
    expect(Number(res.body.total_kmf)).toBe(Number(before.total_kmf));
    expect(res.body.reference).toBe(order.reference);

    const after = await orderRow(order.id);
    expect(Number(after.total_kmf)).toBe(Number(before.total_kmf));
  });

  // ── 3. ANNULATION AVANT ordered ──────────────────────────────────────────
  it('3 — annulation avant ordered : acceptée, statut cancelled, trace de transition', async () => {
    const productId = await seedProduct('cancelok');
    const order = await createOrder(productId);

    expect((await orderRow(order.id)).status).toBe('pending');

    const res = await request(app)
      .post(`/api/orders/${order.id}/cancel`)
      .set('Authorization', `Bearer ${clientToken}`)
      .send({ reason: 'e2e — changement d’avis' });

    expect(res.status).toBe(200);

    const row = await orderRow(order.id);
    expect(row.status).toBe('cancelled');

    // Invariant « transition uniquement via order-status-machine.js » : la
    // machine est le seul chemin qui écrit dans order_status_history.
    expect(await historyOf(order.id)).toContain('cancelled');
  });

  // ── 4. GARDE DE PROPRIÉTÉ ────────────────────────────────────────────────
  it("4 — un autre client ne peut pas annuler la commande d'autrui", async () => {
    const productId = await seedProduct('idor');
    const order = await createOrder(productId);

    const res = await request(app)
      .post(`/api/orders/${order.id}/cancel`)
      .set('Authorization', `Bearer ${otherToken}`)
      .send({ reason: 'tentative' });

    expect(res.status).toBe(403);
    expect((await orderRow(order.id)).status).toBe('pending');
    expect(await historyOf(order.id)).not.toContain('cancelled');
  });

  // ── 5. DOUBLE ANNULATION ─────────────────────────────────────────────────
  it('5 — annuler deux fois : le second appel est refusé sans second effet', async () => {
    const productId = await seedProduct('twice');
    const order = await createOrder(productId);

    const first = await request(app)
      .post(`/api/orders/${order.id}/cancel`)
      .set('Authorization', `Bearer ${clientToken}`)
      .send({ reason: 'e2e' });
    expect(first.status).toBe(200);
    const historyAfterFirst = await historyOf(order.id);

    const second = await request(app)
      .post(`/api/orders/${order.id}/cancel`)
      .set('Authorization', `Bearer ${clientToken}`)
      .send({ reason: 'e2e-rejeu' });

    expect(second.status).toBe(422);
    expect((await orderRow(order.id)).status).toBe('cancelled');
    expect(await historyOf(order.id)).toEqual(historyAfterFirst);
  });

  // ── 6. AU-DELÀ DU CUTOFF ─────────────────────────────────────────────────
  it("6 — au-delà du cutoff d'annulation : refusée, aucun effet", async () => {
    const productId = await seedProduct('cutoff');
    const order = await createOrder(productId);

    // On amène la commande au-delà du cutoff par la machine de statut réelle.
    const { transitionOrderStatus } = require('../../services/order-status-machine');
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      for (const s of ['confirmed', 'ordered', 'purchasing', 'preparation', 'shipped']) {
        await transitionOrderStatus({
          client, orderId: order.id, newStatus: s, actorRole: 'admin', source: 'e2e_cutoff_setup',
        });
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }

    expect((await orderRow(order.id)).status).toBe('shipped');
    const historyBefore = await historyOf(order.id);

    const res = await request(app)
      .post(`/api/orders/${order.id}/cancel`)
      .set('Authorization', `Bearer ${clientToken}`)
      .send({ reason: 'trop tard' });

    // Une commande expédiée ne s'annule pas côté client : c'est un retour SAV.
    expect(res.status).toBe(422);
    expect((await orderRow(order.id)).status).toBe('shipped');
    expect(await historyOf(order.id)).toEqual(historyBefore);
  });
});
