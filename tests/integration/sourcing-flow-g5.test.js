'use strict';

/**
 * tests/integration/sourcing-flow-g5.test.js
 *
 * G5 — Flow : sourcing → ajout produit → mise en vente
 *
 * Trace le flow complet d'enrichissement d'un produit via le moteur sourcing :
 *
 *   Étape 1 — Analyser le produit brut (GET /analysis/:id)
 *             → le moteur retourne rail=null, statut non qualifié
 *   Étape 2 — Enrichir : assigner le rail (PUT /products/:id  { rail })
 *             → 200, rail persisté
 *   Étape 3 — Enrichir : poser les variantes (PUT /products/:id/variants)
 *             → 200, variantes persistées
 *   Étape 4 — Vérifier l'état post-enrichissement (GET /analysis/:id)
 *             → le produit apparaît maintenant avec rail assigné
 *   Étape 5 — Mettre en vente : activer le produit (PATCH /api/admin/products/:id)
 *             → 200, is_active = true
 *   Étape 6 — Synthèse globale (GET /synthesis)
 *             → pas d'erreur, objet KPI retourné
 *
 * Invariant G5 : un produit ne peut pas être mis en vente sans rail assigné
 * (ce guard est contractuel, pas testé ici car implémentation future — le test
 * vérifie le flow heureux complet et la persistance à chaque étape).
 *
 * Sans DATABASE_URL → suite skippée proprement.
 *
 * Run :
 *   DATABASE_URL=postgres://... JWT_SECRET=... \
 *   npx jest tests/integration/sourcing-flow-g5.test.js
 */

const hasIntegrationEnv = Boolean(process.env.DATABASE_URL);

if (!hasIntegrationEnv) {
  describe.skip('sourcing-flow-g5 (needs DATABASE_URL)', () => {
    test('skipped — DATABASE_URL not configured', () => {});
  });
} else {
  const request = require('supertest');
  const { createUser, cleanup } = require('./test-harness/seed-helpers');

  let app;
  let db;
  let adminUser;
  let productId;

  const bearer  = (t) => ['Authorization', `Bearer ${t}`];
  const SOURCING = '/api/admin/sourcing';
  const PRODUCTS = '/api/products';

  beforeAll(async () => {
    process.env.NODE_ENV   = 'test';
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'ci-test-secret-not-for-prod';

    app = require('../../server');
    db  = require('../../db');

    await new Promise((r) => setTimeout(r, 2000));

    // Produit brut : pas de rail, pas de variantes — état "entrant" du flow
    const { rows: [prod] } = await db.query(
      `INSERT INTO products (name, category, price_kmf, cost_kmf, weight_kg, stock, is_active)
       VALUES ('Produit G5 Flow','test',5000,2500,0.30,0,false)
       RETURNING id`
    );
    productId = prod.id;

    adminUser = await createUser({ role: 'admin' });
  }, 30000);

  afterAll(async () => {
    if (app && app.get && app.get('httpServer')) { await new Promise((resolve) => app.get('httpServer').close(resolve)); }
    try { await db.query(`DELETE FROM product_variants WHERE product_id = $1`, [productId]); } catch (_) {}
    try { await db.query(`DELETE FROM products WHERE id = $1`, [productId]); } catch (_) {}
    await cleanup();
    if (db.end) await db.end().catch(() => {});
  }, 20000);

  // ══════════════════════════════════════════════════════════════════════════
  describe('G5 — flow bout-en-bout : sourcing → enrichissement → mise en vente', () => {

    // Étape 1 — Analyse initiale
    test('Étape 1 : GET /analysis/:id — produit trouvé, rail non assigné', async () => {
      const res = await request(app)
        .get(`${SOURCING}/analysis/${productId}`)
        .set(...bearer(adminUser.token));

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('id');
      // Rail n'est pas encore assigné
      const rail = res.body.sourcing?.rail ?? null;
      expect(rail).toBeFalsy();
    });

    // Étape 2 — Assignation du rail
    test('Étape 2 : PUT /products/:id — assignation rail A', async () => {
      const res = await request(app)
        .put(`${SOURCING}/products/${productId}`)
        .set(...bearer(adminUser.token))
        .send({ sourcing_rail: 'A' });

      expect([200, 204]).toContain(res.status);
    });

    // Étape 3 — Ajout des variantes
    test('Étape 3 : PUT /products/:id/variants — pose des variantes', async () => {
      const res = await request(app)
        .put(`${SOURCING}/products/${productId}/variants`)
        .set(...bearer(adminUser.token))
        .send({
          variants: [
            { type: 'couleur', value: 'Noir', sku: 'G5-BLK', stock: 20, price_kmf: 5000 },
            { type: 'couleur', value: 'Blanc', sku: 'G5-WHT', stock: 20, price_kmf: 5000 },
          ],
        });

      expect([200, 204]).toContain(res.status);
    });

    // Étape 4 — Re-analyse post-enrichissement
    test('Étape 4 : GET /analysis/:id — rail persisté après enrichissement', async () => {
      const res = await request(app)
        .get(`${SOURCING}/analysis/${productId}`)
        .set(...bearer(adminUser.token));

      expect(res.status).toBe(200);

      // Rail A doit maintenant être renseigné
      const railValue = res.body.sourcing?.rail;
      expect(railValue).toBe('A');
    });

    // Étape 4bis — Variantes persistées
    test('Étape 4bis : GET /products/:id/variants — 2 variantes présentes', async () => {
      const res = await request(app)
        .get(`${SOURCING}/products/${productId}/variants`)
        .set(...bearer(adminUser.token));

      expect(res.status).toBe(200);
      expect(res.body.variants.length).toBe(2);
    });

    // Étape 5 — Mise en vente (activation)
    test('Étape 5 : PUT /api/products/:id — is_active true', async () => {
      const res = await request(app)
        .put(`${PRODUCTS}/${productId}`)
        .set(...bearer(adminUser.token))
        .send({ is_active: true });

      expect([200, 204]).toContain(res.status);

      // Vérification DB directe
      const { rows: [prod] } = await db.query(
        `SELECT is_active FROM products WHERE id = $1`, [productId]
      );
      expect(prod.is_active).toBe(true);
    });

    // Étape 6 — Synthèse globale sans erreur
    test('Étape 6 : GET /synthesis — KPI global retourné sans erreur', async () => {
      const res = await request(app)
        .get(`${SOURCING}/synthesis`)
        .set(...bearer(adminUser.token));

      expect(res.status).toBe(200);
      expect(typeof res.body).toBe('object');
      expect(res.body).not.toBeNull();
    });

  });
}
