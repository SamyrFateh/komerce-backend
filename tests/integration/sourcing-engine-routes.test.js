'use strict';

/**
 * tests/integration/sourcing-engine-routes.test.js
 *
 * E6 — Tests d'intégration : 8 routes /api/admin/sourcing/*
 *
 * Couverture (DoD E6 : tests d'intégration pour les 8 endpoints sourcing-engine) :
 *
 *   GET  /api/admin/sourcing/analysis           → liste, filtre rail/status
 *   GET  /api/admin/sourcing/analysis/:id       → trouvé / 404 introuvable
 *   GET  /api/admin/sourcing/synthesis          → KPIs globaux
 *   PUT  /api/admin/sourcing/products/:id       → enrichissement champ produit
 *   POST /api/admin/sourcing/bulk-rail          → assignation rail en masse
 *   GET  /api/admin/sourcing/config             → config + explanation
 *   GET  /api/admin/sourcing/products/:id/variants   → liste variantes / 404
 *   PUT  /api/admin/sourcing/products/:id/variants   → remplacement variantes
 *
 * Garde auth (toutes routes → 401 sans token) couverte pour chaque endpoint.
 *
 * Pattern : supertest + vraie DB (même harness que e2e-critical-flows.test.js).
 * Sans DATABASE_URL → suite skippée proprement.
 *
 * Run :
 *   DATABASE_URL=postgres://... JWT_SECRET=... \
 *   npx jest tests/integration/sourcing-engine-routes.test.js
 */

const hasIntegrationEnv = Boolean(process.env.DATABASE_URL);

if (!hasIntegrationEnv) {
  describe.skip('sourcing-engine-routes (needs DATABASE_URL)', () => {
    test('skipped — DATABASE_URL not configured', () => {});
  });
} else {
  const request = require('supertest');
  const { createUser, cleanup } = require('./test-harness/seed-helpers');

  let app;
  let db;
  let adminUser;
  let clientUser;
  let productId;

  const bearer = (t) => ['Authorization', `Bearer ${t}`];
  const BASE    = '/api/admin/sourcing';

  // ── Bootstrap ──────────────────────────────────────────────────────────────
  beforeAll(async () => {
    process.env.NODE_ENV   = 'test';
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'ci-test-secret-not-for-prod';

    app = require('../../server');
    db  = require('../../db');

    await new Promise((r) => setTimeout(r, 2000)); // boot

    // Produit de test minimal (pas de stock requis pour le sourcing)
    const { rows: [prod] } = await db.query(
      `INSERT INTO products (name, category, price_kmf, stock, is_active)
       VALUES ('Sourcing E6 Test','test',3000,50,true)
       RETURNING id`
    );
    productId = prod.id;

    adminUser  = await createUser({ role: 'admin' });
    clientUser = await createUser({ role: 'client' });
  }, 30000);

  afterAll(async () => {
    if (app && app.get && app.get('httpServer')) { await new Promise((resolve) => app.get('httpServer').close(resolve)); }
    try { await db.query(`DELETE FROM product_variants WHERE product_id = $1`, [productId]); } catch (_) {}
    try { await db.query(`DELETE FROM products WHERE id = $1`, [productId]); } catch (_) {}
    await cleanup();
    if (db.end) await db.end().catch(() => {});
  }, 20000);

  // ════════════════════════════════════════════════════════════════════════════
  // 1. GET /analysis
  // ════════════════════════════════════════════════════════════════════════════
  describe('GET /analysis', () => {
    test('401 sans token', async () => {
      const res = await request(app).get(`${BASE}/analysis`);
      expect(res.status).toBe(401);
    });

    test('403 token client (non-admin)', async () => {
      const res = await request(app)
        .get(`${BASE}/analysis`)
        .set(...bearer(clientUser.token));
      expect([401, 403]).toContain(res.status);
    });

    test('200 admin — retourne un tableau', async () => {
      const res = await request(app)
        .get(`${BASE}/analysis`)
        .set(...bearer(adminUser.token));
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('products');
      expect(Array.isArray(res.body.products)).toBe(true);
    });

    test('200 admin — filtre rail accepté sans erreur', async () => {
      const res = await request(app)
        .get(`${BASE}/analysis?rail=A`)
        .set(...bearer(adminUser.token));
      expect(res.status).toBe(200);
    });

    test('200 admin — filtre status accepté sans erreur', async () => {
      const res = await request(app)
        .get(`${BASE}/analysis?status=ok`)
        .set(...bearer(adminUser.token));
      expect(res.status).toBe(200);
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // 2. GET /analysis/:id
  // ════════════════════════════════════════════════════════════════════════════
  describe('GET /analysis/:id', () => {
    test('401 sans token', async () => {
      const res = await request(app).get(`${BASE}/analysis/${productId}`);
      expect(res.status).toBe(401);
    });

    test('200 admin — produit trouvé', async () => {
      const res = await request(app)
        .get(`${BASE}/analysis/${productId}`)
        .set(...bearer(adminUser.token));
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('id');
    });

    test('404 produit inexistant', async () => {
      const res = await request(app)
        .get(`${BASE}/analysis/00000000-0000-0000-0000-000000000000`)
        .set(...bearer(adminUser.token));
      expect(res.status).toBe(404);
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // 3. GET /synthesis
  // ════════════════════════════════════════════════════════════════════════════
  describe('GET /synthesis', () => {
    test('401 sans token', async () => {
      const res = await request(app).get(`${BASE}/synthesis`);
      expect(res.status).toBe(401);
    });

    test('200 admin — retourne des KPIs', async () => {
      const res = await request(app)
        .get(`${BASE}/synthesis`)
        .set(...bearer(adminUser.token));
      expect(res.status).toBe(200);
      // Le service renvoie au minimum un objet avec kpis ou alerts
      expect(typeof res.body).toBe('object');
      expect(res.body).not.toBeNull();
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // 4. PUT /products/:id
  // ════════════════════════════════════════════════════════════════════════════
  describe('PUT /products/:id', () => {
    test('401 sans token', async () => {
      const res = await request(app)
        .put(`${BASE}/products/${productId}`)
        .send({ sourcing_rail: 'A' });
      expect(res.status).toBe(401);
    });

    test('403 token client', async () => {
      const res = await request(app)
        .put(`${BASE}/products/${productId}`)
        .set(...bearer(clientUser.token))
        .send({ sourcing_rail: 'A' });
      expect([401, 403]).toContain(res.status);
    });

    test('200 admin — mise à jour rail', async () => {
      const res = await request(app)
        .put(`${BASE}/products/${productId}`)
        .set(...bearer(adminUser.token))
        .send({ sourcing_rail: 'A' });
      expect([200, 204]).toContain(res.status);
    });

    test('404 produit inexistant', async () => {
      const res = await request(app)
        .put(`${BASE}/products/00000000-0000-0000-0000-000000000000`)
        .set(...bearer(adminUser.token))
        .send({ sourcing_rail: 'B' });
      expect(res.status).toBe(404);
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // 5. POST /bulk-rail
  // ════════════════════════════════════════════════════════════════════════════
  describe('POST /bulk-rail', () => {
    test('401 sans token', async () => {
      const res = await request(app)
        .post(`${BASE}/bulk-rail`)
        .send({ product_ids: [productId], rail: 'A' });
      expect(res.status).toBe(401);
    });

    test('200 admin — assigne rail sur produit connu', async () => {
      const res = await request(app)
        .post(`${BASE}/bulk-rail`)
        .set(...bearer(adminUser.token))
        .send({ product_ids: [productId], rail: 'B' });
      expect([200, 204]).toContain(res.status);
    });

    test('400 payload manquant (pas de product_ids)', async () => {
      const res = await request(app)
        .post(`${BASE}/bulk-rail`)
        .set(...bearer(adminUser.token))
        .send({ rail: 'A' }); // product_ids absent
      expect([400, 422]).toContain(res.status);
    });

    test('400 rail invalide', async () => {
      const res = await request(app)
        .post(`${BASE}/bulk-rail`)
        .set(...bearer(adminUser.token))
        .send({ product_ids: [productId], rail: 'Z_INCONNU' });
      expect([400, 422]).toContain(res.status);
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // 6. GET /config
  // ════════════════════════════════════════════════════════════════════════════
  describe('GET /config', () => {
    test('401 sans token', async () => {
      const res = await request(app).get(`${BASE}/config`);
      expect(res.status).toBe(401);
    });

    test('200 admin — retourne config + explanation', async () => {
      const res = await request(app)
        .get(`${BASE}/config`)
        .set(...bearer(adminUser.token));
      expect(res.status).toBe(200);
      expect(typeof res.body).toBe('object');
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // 7. GET /products/:id/variants
  // ════════════════════════════════════════════════════════════════════════════
  describe('GET /products/:id/variants', () => {
    test('401 sans token', async () => {
      const res = await request(app).get(`${BASE}/products/${productId}/variants`);
      expect(res.status).toBe(401);
    });

    test('200 admin — produit sans variantes (tableau vide)', async () => {
      const res = await request(app)
        .get(`${BASE}/products/${productId}/variants`)
        .set(...bearer(adminUser.token));
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('product_id');
      expect(res.body).toHaveProperty('variants');
      expect(Array.isArray(res.body.variants)).toBe(true);
    });

    test('404 produit inexistant', async () => {
      const res = await request(app)
        .get(`${BASE}/products/00000000-0000-0000-0000-000000000000/variants`)
        .set(...bearer(adminUser.token));
      expect(res.status).toBe(404);
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // 8. PUT /products/:id/variants
  // ════════════════════════════════════════════════════════════════════════════
  describe('PUT /products/:id/variants', () => {
    const sampleVariants = [
      { type: 'taille', value: 'S', sku: 'E6-SKU-S', stock: 10, price_kmf: 3000 },
      { type: 'taille', value: 'M', sku: 'E6-SKU-M', stock: 15, price_kmf: 3000 },
    ];

    test('401 sans token', async () => {
      const res = await request(app)
        .put(`${BASE}/products/${productId}/variants`)
        .send({ variants: sampleVariants });
      expect(res.status).toBe(401);
    });

    test('403 token client', async () => {
      const res = await request(app)
        .put(`${BASE}/products/${productId}/variants`)
        .set(...bearer(clientUser.token))
        .send({ variants: sampleVariants });
      expect([401, 403]).toContain(res.status);
    });

    test('200 admin — remplacement variantes (idempotent)', async () => {
      const res = await request(app)
        .put(`${BASE}/products/${productId}/variants`)
        .set(...bearer(adminUser.token))
        .send({ variants: sampleVariants });
      expect([200, 204]).toContain(res.status);
    });

    test('200 admin — reset variantes vides (tableau vide accepté)', async () => {
      const res = await request(app)
        .put(`${BASE}/products/${productId}/variants`)
        .set(...bearer(adminUser.token))
        .send({ variants: [] });
      expect([200, 204]).toContain(res.status);
    });

    test('GET variants après PUT reflète les données insérées', async () => {
      // PUT
      const put = await request(app)
        .put(`${BASE}/products/${productId}/variants`)
        .set(...bearer(adminUser.token))
        .send({ variants: sampleVariants });
      expect([200, 204]).toContain(put.status);

      // GET
      const get = await request(app)
        .get(`${BASE}/products/${productId}/variants`)
        .set(...bearer(adminUser.token));
      expect(get.status).toBe(200);
      expect(get.body.variants.length).toBe(sampleVariants.length);
      const values = get.body.variants.map((v) => v.variant_value).sort();
      expect(values).toEqual(['M', 'S']);
    });
  });
}
