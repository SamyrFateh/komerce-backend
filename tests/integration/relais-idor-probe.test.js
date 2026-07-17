'use strict';

/**
 * tests/integration/relais-idor-probe.test.js
 *
 * GOV-02 (volet 2) — Sonde multi-rôles + audit IDOR (B1/A2)
 *
 * Deux volets, complémentaires à tests/integration/admin-authz-probe.test.js
 * (qui ne couvre que /api/admin/*) :
 *
 *   1. MATRICE RÔLE×ROUTE — pour chaque route PROTECTED de docs/SECURITY_360.json
 *      portant un rôle non-admin (agent_hub / agent_relais / agent_transitaire,
 *      141 occurrences de rôle sur 100 routes), on frappe la route via une vraie
 *      requête HTTP (supertest) avec un token d'un rôle EXCLU de la liste :
 *        - aucun token              → 401 attendu
 *        - rôle non listé (client)  → 401 ou 403, jamais 2xx
 *      Les `{param}` sont remplacés par un UUID neutre — on vérifie que la garde
 *      de rôle s'exécute avant toute logique métier (un 404 derrière la garde
 *      n'est pas testé ici, seul un 2xx serait révélateur d'une fuite).
 *
 *   2. IDOR CROSS-RELAIS — `agent_relais` est un rôle MULTI-TENANT (plusieurs
 *      points relais physiques, chacun avec son `relais_id`). `requireRole`
 *      vérifie le RÔLE mais pas l'OWNERSHIP : seul routes/relay-dashboard.js
 *      faisait initialement la vérification explicite `order.relais_id !==
 *      req.user.relais_id`. CORRIGÉ le 2026-06-23 — le même garde-fou est
 *      désormais posé sur :
 *        - PATCH /api/orders/{id}/status         (routes/orders/status.js)
 *        - POST  /api/orders/{id}/qr-token       (routes/orders/qr.js)
 *        - PATCH /api/orders/parcels/{id}/status (services/parcel-operations.js)
 *      Ces tests sont des PROBES DE RÉGRESSION : ils doivent rester VERTS.
 *      S'ils repassent au rouge, c'est qu'un correctif a réintroduit la faille.
 *
 * Sans DATABASE_URL → suite skippée proprement (comme security-grid.test.js).
 * Run: DATABASE_URL=... JWT_SECRET=... npx jest tests/integration/relais-idor-probe.test.js
 */

const fs = require('fs');
const path = require('path');

const hasIntegrationEnv = Boolean(process.env.DATABASE_URL);

if (!hasIntegrationEnv) {
  describe.skip('relais-idor-probe (needs DATABASE_URL)', () => {
    test('skipped — DATABASE_URL not configured', () => {});
  });
} else {
  const request = require('supertest');
  const { createUser, cleanup } = require('./test-harness/seed-helpers');

  let app;
  let db;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'ci-test-secret-not-for-prod';
    app = require('../../server');
    db = require('../../db');
    await new Promise((r) => setTimeout(r, 2000)); // laisse le boot/migrations finir
  });

  afterAll(async () => {
    if (app && app.get && app.get('httpServer')) { await new Promise((resolve) => app.get('httpServer').close(resolve)); }
    await cleanup();
    await new Promise((r) => setTimeout(r, 500));
  });

  const bearer = (t) => ['Authorization', `Bearer ${t}`];
  const NEUTRAL_UUID = '00000000-0000-0000-0000-000000000001';

  // ───────────────────────────────────────────────────────────────────────
  // Volet 1 — Matrice rôle×route (toutes les routes PROTECTED non-admin-only)
  // ───────────────────────────────────────────────────────────────────────
  describe('Matrice rôle×route — routes agent_hub / agent_relais / agent_transitaire', () => {
    const securityPath = path.join(__dirname, '../../docs/SECURITY_360.json');
    const security360 = JSON.parse(fs.readFileSync(securityPath, 'utf8'));

    const ALL_ROLES = ['client', 'agent_hub', 'agent_relais', 'agent_transitaire', 'admin'];

    const targetRoutes = security360.routes.filter((r) => {
      if (r.level !== 'PROTECTED') return false;
      const roles = r.roles || [];
      // On ne garde que les routes restreintes à un sous-ensemble de rôles
      // (exclut les routes [] = authentifié simple, sans rôle dédié).
      return roles.length > 0 && !(roles.length === ALL_ROLES.length);
    });

    let userTokens = {};

    beforeAll(async () => {
      for (const role of ALL_ROLES) {
        const u = await createUser({ role });
        userTokens[role] = u.token;
      }
    });

    function buildPath(routeKey) {
      const [method, rawPath] = routeKey.split(/\s+(.+)/);
      const concretePath = rawPath.replace(/\{[^}]+\}/g, NEUTRAL_UUID);
      return { method: method.toLowerCase(), concretePath };
    }

    test.each(targetRoutes.map((r) => [r.key, r.roles]))(
      '%s — rejette un rôle non autorisé (jamais de 2xx)',
      async (routeKey, roles) => {
        const { method, concretePath } = buildPath(routeKey);

        // Choisit un rôle volontairement EXCLU de la liste autorisée.
        const forbiddenRole = ALL_ROLES.find((r) => !roles.includes(r));
        if (!forbiddenRole) return; // tous les rôles sont autorisés — rien à tester

        const res = await request(app)[method](concretePath).set(...bearer(userTokens[forbiddenRole]));

        // Seul un 2xx est révélateur d'une fuite : peu importe que la garde
        // de rôle réponde 401/403, ou qu'un 400/404/422/500 survienne après
        // (param neutre invalide) — ce n'est jamais un succès métier.
        expect(res.status < 200 || res.status >= 300).toBe(true);
      }
    );

    test('aucun token → 401 sur chaque route ciblée (échantillon)', async () => {
      // Échantillon (pas les 100 routes) pour garder le run rapide : 1 route / méthode.
      const sample = targetRoutes.filter((_, i) => i % 7 === 0);
      for (const r of sample) {
        const { method, concretePath } = buildPath(r.key);
        const res = await request(app)[method](concretePath);
        expect(res.status).toBe(401);
      }
    });
  });

  // ───────────────────────────────────────────────────────────────────────
  // Volet 2 — IDOR cross-relais (finding réel — voir docstring du fichier)
  // ───────────────────────────────────────────────────────────────────────
  describe('IDOR cross-relais — agent_relais A ne doit jamais agir sur une commande du relais B', () => {
    let relaisA, relaisB, agentA, agentB, orderOfRelaisA;

    beforeAll(async () => {
      const mk = (suffix) => db.query(
        `INSERT INTO relais (name, agent_name, phone, address, island)
         VALUES ($1,$2,$3,$4,'Anjouan') RETURNING id`,
        [`ITest Relais ${suffix}`, `Agent ${suffix}`, `+2693${Math.floor(1000000 + Math.random() * 8999999)}`, `Adresse test ${suffix}`]
      );
      relaisA = (await mk('A')).rows[0].id;
      relaisB = (await mk('B')).rows[0].id;

      agentA = await createUser({ role: 'agent_relais', relais_id: relaisA });
      agentB = await createUser({ role: 'agent_relais', relais_id: relaisB });

      const { rows: [order] } = await db.query(
        `INSERT INTO orders (reference, relais_id, total_kmf, payment_mode, status)
         VALUES ($1, $2, 1000, 'cash_relais', 'available')
         RETURNING id, reference`,
        [`ITEST-IDOR-${Date.now()}`, relaisA]
      );
      orderOfRelaisA = order;
    });

    afterAll(async () => {
      try {
        await db.query(`DELETE FROM orders WHERE id = $1`, [orderOfRelaisA.id]);
        await db.query(`DELETE FROM relais WHERE id IN ($1,$2)`, [relaisA, relaisB]);
      } catch (_) {}
    });

    test('agent_relais B ne peut pas changer le statut d\'une commande du relais A (403)', async () => {
      const res = await request(app)
        .patch(`/api/orders/${orderOfRelaisA.id}/status`)
        .set(...bearer(agentB.token))
        .send({ status: 'collected' });

      expect(res.status).toBe(403);
    });

    test('agent_relais B ne peut pas générer un QR de retrait pour une commande du relais A (403)', async () => {
      const res = await request(app)
        .post(`/api/orders/${orderOfRelaisA.id}/qr-token`)
        .set(...bearer(agentB.token));

      expect(res.status).toBe(403);
    });

    test('agent_relais B ne peut pas changer le statut d\'un colis d\'une commande du relais A (403)', async () => {
      const { rows: [parcel] } = await db.query(
        `INSERT INTO parcels (order_id, reference, status) VALUES ($1, $2, 'preparation') RETURNING id`,
        [orderOfRelaisA.id, `ITEST-PCL-${Date.now()}`]
      );
      try {
        const res = await request(app)
          .patch(`/api/orders/parcels/${parcel.id}/status`)
          .set(...bearer(agentB.token))
          .send({ status: 'shipped' });

        expect(res.status).toBe(403);
      } finally {
        await db.query(`UPDATE parcels SET status = 'cancelled' WHERE id = $1`, [parcel.id]);
      }
    });

    test('contrôle positif — agent_relais A (propriétaire) peut générer le QR de SA commande', async () => {
      const res = await request(app)
        .post(`/api/orders/${orderOfRelaisA.id}/qr-token`)
        .set(...bearer(agentA.token));

      expect(res.status).not.toBe(401);
      expect(res.status).not.toBe(403);
    });

    // ── RC-SEC / XREL-01, XREL-02 ──────────────────────────────────────
    describe('RC-SEC — routes/parcels.js weight & verify-seal', () => {
      let parcelOfRelaisA;

      beforeAll(async () => {
        const { rows: [parcel] } = await db.query(
          `INSERT INTO parcels (order_id, reference, status, seal_code)
           VALUES ($1, $2, 'preparation', 'SEAL-ITEST-01') RETURNING id`,
          [orderOfRelaisA.id, `ITEST-PCL-SEC-${Date.now()}`]
        );
        parcelOfRelaisA = parcel;
      });

      afterAll(async () => {
        try {
          await db.query(`DELETE FROM parcels WHERE id = $1`, [parcelOfRelaisA.id]);
          await db.query(`DELETE FROM pickup_verify_attempts WHERE token LIKE 'seal:%'`);
        } catch (_) {}
      });

      test('[XREL-01] agent_relais B ne peut pas peser un colis d\'une commande du relais A (403)', async () => {
        const res = await request(app)
          .post(`/api/parcels/${parcelOfRelaisA.id}/weight`)
          .set(...bearer(agentB.token))
          .send({ weight_kg: 3.5 });

        expect(res.status).toBe(403);
      });

      test('[XREL-02] agent_relais B ne peut pas vérifier le scellé d\'un colis d\'une commande du relais A (403)', async () => {
        const res = await request(app)
          .post(`/api/parcels/${parcelOfRelaisA.id}/verify-seal`)
          .set(...bearer(agentB.token))
          .send({ seal_code: 'SEAL-ITEST-01' });

        expect(res.status).toBe(403);
      });

      test('contrôle positif — agent_relais A (propriétaire) peut peser SON colis', async () => {
        const res = await request(app)
          .post(`/api/parcels/${parcelOfRelaisA.id}/weight`)
          .set(...bearer(agentA.token))
          .send({ weight_kg: 3.5 });

        expect(res.status).not.toBe(401);
        expect(res.status).not.toBe(403);
      });

      test('[XREL-02] rate-limit — N tentatives de vérification de scellé bloquent la N+1ème (429)', async () => {
        let lastStatus;
        for (let i = 0; i < 12; i++) {
          const res = await request(app)
            .post(`/api/parcels/${parcelOfRelaisA.id}/verify-seal`)
            .set(...bearer(agentA.token))
            .send({ seal_code: 'MAUVAIS-CODE' });
          lastStatus = res.status;
        }
        expect(lastStatus).toBe(429);
      });
    });
  });
}
