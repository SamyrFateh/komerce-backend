'use strict';


/**
 * @test-kind e2e
 * @test-runner jest
 * @test-requires postgres
 */
/**
 * E2E-P0-COLLECT — orders · une commande ne peut être remise qu'une seule fois
 *
 * Lot 1 (PROMPT_SONNET_LOT1.md).
 *
 * Prouve — ou réfute — qu'une même commande peut être marquée « collected »
 * deux fois lors de deux appels concurrents à POST /api/pickup/collect/:orderId.
 *
 * `order_status_history` est le juge principal : la machine de statut
 * (services/order-status-machine.js) en est le seul écrivain, donc deux
 * lignes 'collected' prouveraient une double transition même si
 * `orders.status` a l'air correct à la fin.
 *
 * Périmètre : uniquement routes/pickup-secret.js POST /collect/:orderId, la
 * route HTTP réellement exposée. Ne touche pas à services/pickup-secret-service.js
 * (collectOrder, non câblé — voir restitution), ni au chemin pickup_code /
 * routes/tracking.js.
 */

const request = require('supertest');
const express = require('express');
const jwt = require('jsonwebtoken');

const { describeE2E, createCleanup, tag, uuid } = require('../helpers/e2eDbKit');

jest.setTimeout(60000);

describeE2E('E2E-P0-COLLECT — orders · remise unique', ({ db }) => {
  const agentId = uuid();
  const relaisId = uuid();

  let cleanup;
  let app;
  let token;

  async function seedOrder(label) {
    const orderId = uuid();
    await db.query(
      `INSERT INTO orders
         (id, reference, relais_id, total_kmf, payment_mode, payment_status, status)
       VALUES ($1, $2, $3, 25000, 'cash_relais', 'paid', 'available')`,
      [orderId, `E2E-COLLECT-${tag(label)}`, relaisId]
    );
    return orderId;
  }

  function collect(orderId, name) {
    return request(app)
      .post(`/api/pickup/collect/${orderId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ collected_by_name: name });
  }

  beforeAll(async () => {
    cleanup = createCleanup(db);

    // LIFO : le nettoyage dépile dans l'ordre inverse du push. users.relais_id
    // référence relais(id), donc relais doit être le DERNIER supprimé — il est
    // donc poussé en PREMIER ici, avant users. orders est poussé en dernier
    // pour être dépilé en premier (avant users et relais). order_status_history
    // a un ON DELETE CASCADE sur orders (§4.2 du prompt) : pas besoin de le
    // nettoyer séparément.
    cleanup.trackSql(`DELETE FROM relais WHERE id = $1`, [relaisId]);
    cleanup.trackSql(`DELETE FROM users WHERE id = $1`, [agentId]);
    cleanup.trackSql(`DELETE FROM orders WHERE relais_id = $1`, [relaisId]);

    await db.query(
      `INSERT INTO relais (id, name, agent_name, phone, address)
       VALUES ($1, 'E2E Relais Collect', 'E2E Agent', '+269000333', 'Moroni Test')`,
      [relaisId]
    );

    await db.query(
      `INSERT INTO users (id, full_name, email, phone, role, relais_id)
       VALUES ($1, 'E2E Agent Collect', $2, $3, 'agent_relais', $4)`,
      [agentId, `${tag('collect')}@komerce.test`, `+2693${Math.floor(Math.random() * 9e6 + 1e6)}`, relaisId]
    );

    token = jwt.sign({ id: agentId, role: 'agent_relais' }, process.env.JWT_SECRET, {
      algorithm: 'HS256',
      expiresIn: '1h',
    });

    app = express();
    app.use(require('cookie-parser')());
    app.use(express.json());
    app.use('/api/pickup', require('../../routes/pickup-secret'));
    app.use((err, _req, res, _next) => res.status(err.status || 500).json({ error: err.message }));
  });

  afterAll(async () => {
    if (cleanup) await cleanup.run();
  });

  // ─────────────────────────────────────────────────────────────────────────
  it('0 — TÉMOIN : un appel isolé marque la commande comme récupérée', async () => {
    const orderId = await seedOrder('nominal');

    const res = await collect(orderId, 'Client Nominal');
    expect(res.status).toBe(200);

    const { rows } = await db.query('SELECT status, collected_by_name FROM orders WHERE id = $1', [orderId]);
    expect(rows[0].status).toBe('collected');
    expect(rows[0].collected_by_name).toBe('Client Nominal');

    const { rows: hist } = await db.query(
      `SELECT count(*)::int AS n FROM order_status_history WHERE order_id = $1 AND status = 'collected'`,
      [orderId]
    );
    expect(hist[0].n).toBe(1);
  });

  it('1 — CONCURRENCE : N appels simultanés sur la même commande → une seule remise', async () => {
    const orderId = await seedOrder('race');
    const N = 5;

    // Réellement concurrents : Promise.all, jamais en série.
    const results = await Promise.all(
      Array.from({ length: N }, (_, i) => collect(orderId, `Concurrent ${i}`))
    );

    const successes = results.filter((r) => r.status === 200);
    const failures = results.filter((r) => r.status !== 200);

    // ── Juge principal : order_status_history. Deux lignes 'collected'
    // prouveraient une double transition même si orders.status semble correct.
    const { rows: hist } = await db.query(
      `SELECT count(*)::int AS n FROM order_status_history WHERE order_id = $1 AND status = 'collected'`,
      [orderId]
    );
    expect(hist[0].n).toBe(1);

    const { rows: orderRows } = await db.query(
      'SELECT status, collected_by_name FROM orders WHERE id = $1',
      [orderId]
    );
    expect(orderRows[0].status).toBe('collected');
    expect(orderRows[0].collected_by_name).not.toBeNull();

    // Exactement un appel a réussi ; les N-1 autres ont échoué de façon
    // intelligible (409, avec un message d'erreur exploitable).
    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(N - 1);
    for (const f of failures) {
      expect(f.status).toBe(409);
      expect(typeof f.body.error).toBe('string');
      expect(f.body.error.length).toBeGreaterThan(0);
    }
  });
});
