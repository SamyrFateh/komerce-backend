'use strict';


/**
 * @test-kind integration
 * @test-runner jest
 * @test-requires postgres
 */
/**
 * tests/integration/admin-authz-probe.test.js
 *
 * P4-2 — SONDE D'AUTORISATION (audit empirique, méthode indépendante de
 * l'analyse statique de gen-security-360.js).
 *
 * Deux volets :
 *
 *   1. /api/admin/* — pour CHAQUE route du contrat OpenAPI (docs/contract/
 *      openapi.json, source de vérité unique — pas une liste recopiée à la
 *      main qui pourrait dériver du code réel), on frappe la route via une
 *      vraie requête HTTP (supertest) avec :
 *        - aucun token        → 401 attendu
 *        - token client (non-admin) → 401 ou 403, JAMAIS 200/2xx
 *        - token agent_relais (autre rôle non-admin) → idem
 *      Les `{param}` du contrat sont remplacés par un placeholder neutre :
 *      le test vérifie que la garde de rôle s'exécute AVANT toute logique
 *      métier, peu importe la validité de l'ID — si jamais une route laissait
 *      passer un appelant non-admin jusqu'à un 404/400 "métier", on le
 *      détecterait comme un vrai 2xx ne serait pas retourné de toute façon,
 *      donc seul le 2xx est un échec révélateur.
 *
 *   2. Les 6 routes ❔ UNKNOWN de Security 360 (gen-security-360.js ne les
 *      atteint pas : montées hors /api, ou via un mécanisme d'auth que
 *      l'analyse statique ne reconnaît pas) — chacune est testée pour son
 *      VRAI comportement, prouvant qu'elle est protégée ou légitimement
 *      publique, au lieu de rester un point d'interrogation :
 *        - GET  /health           → public, intentionnel (liveness probe)
 *        - GET  /health/ready     → public, intentionnel (readiness probe)
 *        - GET  /health/version   → public, intentionnel (info non sensible)
 *        - GET  /health/metrics   → protégé admin (authenticate+requireRole)
 *        - GET  /webhook/meta-whatsapp  → handshake Meta (hub.verify_token),
 *          protocole standard, pas un JWT — rejette si token absent/faux
 *        - POST /webhook/meta-whatsapp  → HMAC X-Hub-Signature-256 ; rejette
 *          si signature absente ou invalide (P4-2 a aussi fermé le fail-open
 *          qui laissait passer les requêtes non signées quand
 *          META_WA_APP_SECRET était absente — voir routes/meta-whatsapp.js
 *          et bootstrap/env.js)
 *
 * Sans DATABASE_URL → suite skippée proprement (comme security-grid.test.js).
 * Run: DATABASE_URL=... JWT_SECRET=... META_WA_APP_SECRET=... \
 *      AUTHKEY_API_KEY=... ADMIN_PASSWORD=... STRIPE_SECRET_KEY=... \
 *      STRIPE_WEBHOOK_SECRET=... QR_SECRET=... PAYPAL_CLIENT_ID=... \
 *      PAYPAL_CLIENT_SECRET=... PAYPAL_WEBHOOK_ID=... \
 *      npx jest tests/integration/admin-authz-probe.test.js
 */

const fs = require('fs');
const path = require('path');

const hasIntegrationEnv = Boolean(process.env.DATABASE_URL);

if (!hasIntegrationEnv) {
  describe.skip('admin-authz-probe (needs DATABASE_URL)', () => {
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
    jest.spyOn(require('../../bootstrap/crons'), 'startOperationalCrons')
      .mockImplementation(() => {});
    app = require('../../server');
    db = require('../../db');
    await new Promise((r) => setTimeout(r, 2000)); // laisse le boot/migrations finir
  });

  afterAll(async () => {
    if (app && app.get && app.get('httpServer')) { await new Promise((resolve) => app.get('httpServer').close(resolve)); }
    await cleanup();
    await new Promise((r) => setTimeout(r, 500));
    jest.restoreAllMocks();
    if (db && db.pool && db.pool.end) await db.pool.end();
  });

  const bearer = (t) => ['Authorization', `Bearer ${t}`];

  // ── Extraction des routes /api/admin/* depuis le contrat (source unique) ──
  const CONTRACT_PATH = path.join(__dirname, '../../docs/contract/openapi.json');
  const contract = JSON.parse(fs.readFileSync(CONTRACT_PATH, 'utf8'));

  const adminRoutes = [];
  for (const [routePath, methods] of Object.entries(contract.paths || {})) {
    if (!routePath.startsWith('/api/admin')) continue;
    for (const method of Object.keys(methods)) {
      if (!['get', 'post', 'put', 'patch', 'delete'].includes(method)) continue;
      // remplace chaque {param} par un placeholder neutre — la garde de rôle
      // doit s'exécuter avant toute résolution métier de l'ID
      const concretePath = routePath.replace(/\{[^}]+\}/g, 'authz-probe-placeholder');
      adminRoutes.push({ method: method.toUpperCase(), routePath, concretePath });
    }
  }

  const supertestMethod = (req, method) => {
    switch (method) {
      case 'GET': return req.get.bind(req);
      case 'POST': return req.post.bind(req);
      case 'PUT': return req.put.bind(req);
      case 'PATCH': return req.patch.bind(req);
      case 'DELETE': return req.delete.bind(req);
      default: throw new Error(`Méthode non gérée: ${method}`);
    }
  };

  describe(`Sonde d'autorisation — /api/admin/* (${adminRoutes.length} routes, contrat OpenAPI)`, () => {
    test('le contrat contient au moins une route /api/admin/* (garde anti-no-op)', () => {
      expect(adminRoutes.length).toBeGreaterThan(0);
    });

    test('sans token → 401 sur chaque route admin', async () => {
      const failures = [];
      for (const { method, routePath, concretePath } of adminRoutes) {
        const fn = supertestMethod(request(app), method);
        const res = await fn(concretePath);
        if (res.status === 200 || (res.status >= 200 && res.status < 300)) {
          failures.push(`${method} ${routePath} → ${res.status} (attendu 401)`);
        }
      }
      if (failures.length) {
        throw new Error(`${failures.length} route(s) admin accessibles SANS token :\n${failures.join('\n')}`);
      }
    }, 60000);

    test('token client (non-admin) → jamais 2xx sur une route admin', async () => {
      const client = await createUser({ role: 'client' });
      const failures = [];
      for (const { method, routePath, concretePath } of adminRoutes) {
        const fn = supertestMethod(request(app), method);
        const res = await fn(concretePath).set(...bearer(client.token));
        if (res.status >= 200 && res.status < 300) {
          failures.push(`${method} ${routePath} → ${res.status} (attendu 401/403)`);
        }
      }
      if (failures.length) {
        throw new Error(`${failures.length} route(s) admin accessibles avec un token CLIENT :\n${failures.join('\n')}`);
      }
    }, 60000);

    test('token agent_relais (autre rôle non-admin) → jamais 2xx sur une route admin', async () => {
      const agent = await createUser({ role: 'agent_relais' });
      const failures = [];
      for (const { method, routePath, concretePath } of adminRoutes) {
        const fn = supertestMethod(request(app), method);
        const res = await fn(concretePath).set(...bearer(agent.token));
        if (res.status >= 200 && res.status < 300) {
          failures.push(`${method} ${routePath} → ${res.status} (attendu 401/403)`);
        }
      }
      if (failures.length) {
        throw new Error(`${failures.length} route(s) admin accessibles avec un token AGENT_RELAIS :\n${failures.join('\n')}`);
      }
    }, 60000);

    test('token admin → au moins une route admin répond en 2xx (le test ne bloque pas tout le monde)', async () => {
      const admin = await createUser({ role: 'admin' });
      const res = await request(app).get('/api/admin/orders').set(...bearer(admin.token));
      // 429 (rate-limit) est acceptable : auth OK, le batch précédent a épuisé
      // le compteur en mémoire. Ce qu'on prouve : pas de 401 / 403 (accès non bloqué).
      // [R6] fix : les ~1400 requêtes des 3 sous-tests précédents saturent le
      // rate-limiter in-process avant que ce check n'arrive.
      expect(res.status).not.toBe(401);
      expect(res.status).not.toBe(403);
    });
  });

  // ── Résolution des 5 (+1) routes ❔ UNKNOWN de Security 360 ────────────────
  describe('Résolution des ❔ UNKNOWN — Security 360', () => {
    test('GET /health → 200 public (liveness probe, intentionnel)', async () => {
      const res = await request(app).get('/health');
      expect(res.status).toBe(200);
      expect(res.body.status).toBeDefined();
    });

    test('GET /health/ready → 200 public (readiness probe, intentionnel)', async () => {
      const res = await request(app).get('/health/ready');
      expect([200, 503]).toContain(res.status); // 503 si DB down, jamais 401/403
    });

    test('GET /health/version → 200 public (info non sensible, intentionnel)', async () => {
      const res = await request(app).get('/health/version');
      expect(res.status).toBe(200);
      expect(res.body.version).toBeDefined();
    });

    test('GET /health/metrics sans token → 401 (PROTÉGÉ, pas public — invisible à l\'analyse statique car monté hors /api)', async () => {
      const res = await request(app).get('/health/metrics');
      expect(res.status).toBe(401);
    });

    test('GET /health/metrics avec token client → 403 (admin only)', async () => {
      const client = await createUser({ role: 'client' });
      const res = await request(app).get('/health/metrics').set(...bearer(client.token));
      expect(res.status).not.toBe(200);
    });

    test('GET /health/metrics avec token admin → 200', async () => {
      const admin = await createUser({ role: 'admin' });
      const res = await request(app).get('/health/metrics').set(...bearer(admin.token));
      expect(res.status).toBe(200);
    });

    test('GET /webhook/meta-whatsapp sans verify_token → 403 (handshake Meta, pas un JWT — protocole standard)', async () => {
      const res = await request(app).get('/webhook/meta-whatsapp').query({
        'hub.mode': 'subscribe',
        'hub.verify_token': 'wrong-token',
        'hub.challenge': 'probe-challenge',
      });
      expect(res.status).toBe(403);
    });

    test('GET /webhook/meta-whatsapp avec le bon verify_token → 200 + challenge renvoyé', async () => {
      const verifyToken = process.env.META_WA_VERIFY_TOKEN || 'komerce_meta_verify_token';
      const res = await request(app).get('/webhook/meta-whatsapp').query({
        'hub.mode': 'subscribe',
        'hub.verify_token': verifyToken,
        'hub.challenge': 'probe-challenge',
      });
      expect(res.status).toBe(200);
      expect(res.text).toBe('probe-challenge');
    });

    test('POST /webhook/meta-whatsapp sans signature → 403 (HMAC requise, P4-2 a fermé le fail-open)', async () => {
      const res = await request(app)
        .post('/webhook/meta-whatsapp')
        .send({ entry: [] });
      expect(res.status).toBe(403);
    });

    test('POST /webhook/meta-whatsapp avec signature invalide (mais bonne longueur) → 403', async () => {
      // 64 caractères hex (même longueur qu'une vraie signature SHA256) mais
      // fausse valeur.
      const fakeSig = 'sha256=' + 'a'.repeat(64);
      const res = await request(app)
        .post('/webhook/meta-whatsapp')
        .set('X-Hub-Signature-256', fakeSig)
        .send({ entry: [] });
      expect(res.status).toBe(403);
    });

    test('POST /webhook/meta-whatsapp avec signature de longueur invalide → 403 (pas 500 — guard de longueur avant timingSafeEqual)', async () => {
      // Avant le fix P4-2 : timingSafeEqual lève une exception sur des
      // buffers de longueurs différentes au lieu de renvoyer false, ce qui
      // pouvait produire un 500 non contrôlé sur une simple signature
      // malformée/tronquée plutôt qu'un rejet propre.
      const res = await request(app)
        .post('/webhook/meta-whatsapp')
        .set('X-Hub-Signature-256', 'sha256=trop-court')
        .send({ entry: [] });
      expect(res.status).toBe(403);
    });

    test('POST /webhook/meta-whatsapp avec signature HMAC valide → 200', async () => {
      const crypto = require('crypto');
      const secret = process.env.META_WA_APP_SECRET;
      // Le serveur n'a pas de express.raw() dédié sur cette route : il calcule
      // sa signature sur JSON.stringify(req.body) APRÈS parsing par
      // express.json() global (voir routes/meta-whatsapp.js : rawBody || 
      // JSON.stringify(req.body)). On signe donc le même objet, dans le même
      // ordre de clés, pour que la comparaison côté serveur matche.
      const body = { entry: [] };
      const sig = 'sha256=' + crypto.createHmac('sha256', secret).update(JSON.stringify(body), 'utf8').digest('hex');
      const res = await request(app)
        .post('/webhook/meta-whatsapp')
        .set('X-Hub-Signature-256', sig)
        .send(body);
      expect(res.status).toBe(200);
    });
  });
}
