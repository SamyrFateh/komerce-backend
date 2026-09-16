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
const { signAuthToken } = require('../../utils/auth-session');
const { generateAndStoreSecret } = require('../../services/pickup-secret-service');

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
         (id, reference, relais_id, market_id, total_kmf, payment_mode, payment_status, status)
       VALUES ($1, $2, $3, (SELECT market_id FROM relais WHERE id = $3), 25000, 'cash_relais', 'paid', 'available')`,
      [orderId, `E2E-COLLECT-${tag(label)}`, relaisId]
    );
    // Une commande AVAILABLE exige désormais le code de retrait courant pour
    // être remise (voir services/pickup-collection-service.js::collectOrder,
    // garde PICKUP_CODE_REQUIRED) : un appel orderId-seul est intentionnellement
    // refusé pour empêcher la réutilisation du même appel sur plusieurs colis.
    const generated = await generateAndStoreSecret({
      orderId,
      relaisId,
      channel: 'cash_relais',
    });
    return { orderId, code: generated.code };
  }

  function collect(orderId, name, code) {
    return request(app)
      .post(`/api/pickup/collect/${orderId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ collected_by_name: name, pickup_code: code });
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
    // collectByPickupCode trace toute tentative en échec (anti-fraude) dans
    // alerts ; le scénario de concurrence en génère volontairement (N-1
    // échecs one-shot). À nettoyer avant orders (référence order_id/entity_id).
    cleanup.trackSql(`DELETE FROM alerts WHERE entity_type = 'order' AND entity_id IN (SELECT id FROM orders WHERE relais_id = $1)`, [relaisId]);

    await db.query(
      `INSERT INTO relais (id, name, agent_name, phone, address, market_id)
       VALUES ($1, 'E2E Relais Collect', 'E2E Agent', '+269000333', 'Moroni Test', (SELECT id FROM markets WHERE code = 'KM'))`,
      [relaisId]
    );

    await db.query(
      `INSERT INTO users (id, full_name, email, phone, role, relais_id)
       VALUES ($1, 'E2E Agent Collect', $2, $3, 'agent_relais', $4)`,
      [agentId, `${tag('collect')}@komerce.test`, `+2693${Math.floor(Math.random() * 9e6 + 1e6)}`, relaisId]
    );

    token = signAuthToken(
      { id: agentId, role: 'agent_relais' },
      { method: 'e2e' }
    );

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
    const { orderId, code } = await seedOrder('nominal');

    const res = await collect(orderId, 'Client Nominal', code);
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
    const { orderId, code } = await seedOrder('race');
    const N = 5;

    // Réellement concurrents : Promise.all, jamais en série.
    const results = await Promise.all(
      Array.from({ length: N }, (_, i) => collect(orderId, `Concurrent ${i}`, code))
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
    // intelligible (404 après consommation one-shot, sans fuite d'état).
    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(N - 1);
    for (const f of failures) {
      expect(f.status).toBe(404);
      expect(typeof f.body.error).toBe('string');
      expect(f.body.error.length).toBeGreaterThan(0);
    }
  });
});
