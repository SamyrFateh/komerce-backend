'use strict';

/**
 * tests/integration/catalog-approval-queue-contract.test.js
 *
 * D-06 — Contrat HTTP réel pour les 4 routes K-4 approval queue UNKNOWN :
 *   GET  /api/admin/catalog/approval-queue
 *   POST /api/admin/catalog/approval-queue/:id/approve
 *   POST /api/admin/catalog/approval-queue/:id/reject
 *   POST /api/admin/catalog/approval-queue/:id/override
 *
 * Verrouille le flux pipeline → file admin → décision humaine : approbation,
 * rejet tracé, override whitelisté puis publication.
 *
 * Run :
 *   DATABASE_URL=postgres://... JWT_SECRET=ci-test-secret-not-for-prod \
 *   npx jest tests/integration/catalog-approval-queue-contract.test.js --runInBand
 */

const hasIntegrationEnv = Boolean(process.env.DATABASE_URL);

if (!hasIntegrationEnv) {
  describe.skip('catalog-approval-queue-contract D-06 (needs DATABASE_URL)', () => {
    test('skipped — DATABASE_URL not configured', () => {});
  });
} else {
  const request = require('supertest');
  const { createUser, cleanup } = require('./test-harness/seed-helpers');

  let app;
  let db;
  let adminUser;
  let clientUser;
  const productIds = new Set();

  const BASE = '/api/admin/catalog/approval-queue';
  const nilUuid = '00000000-0000-0000-0000-000000000000';
  const bearer = (token) => ['Authorization', `Bearer ${token}`];
  const suffix = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  async function insertCandidate(overrides = {}) {
    const name = overrides.name === undefined ? `IT Candidate ${suffix()}` : overrides.name;
    const category = overrides.category === undefined ? 'test' : overrides.category;
    const description = overrides.description === undefined ? 'Produit candidat intégration' : overrides.description;
    const price = overrides.price_kmf === undefined ? 7000 : overrides.price_kmf;
    const stock = overrides.stock === undefined ? 5 : overrides.stock;
    const contentSource = overrides.content_source || 'ai_enriched';
    const needsReview = overrides.needs_review === undefined ? true : overrides.needs_review;
    const confidence = overrides.enrichment_confidence === undefined ? 0.420 : overrides.enrichment_confidence;

    const { rows: [product] } = await db.query(
      `INSERT INTO products
         (name, description, category, price_kmf, stock, is_active,
          lifecycle_status, content_source, needs_review, enrichment_confidence,
          quality_validated)
       VALUES ($1, $2, $3, $4, $5, FALSE,
               'candidate', $6, $7, $8, FALSE)
       RETURNING *`,
      [name, description, category, price, stock, contentSource, needsReview, confidence]
    );
    productIds.add(product.id);
    return product;
  }

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'ci-test-secret-not-for-prod';

    app = require('../../server');
    db = require('../../db');

    await new Promise((resolve) => setTimeout(resolve, 2000));

    adminUser = await createUser({ role: 'admin' });
    clientUser = await createUser({ role: 'client' });
  }, 30000);

  afterAll(async () => {
    const ids = Array.from(productIds);
    try {
      if (ids.length) {
        await db.query(`DELETE FROM catalog_field_overrides WHERE product_id = ANY($1::uuid[])`, [ids]);
        await db.query(`DELETE FROM alerts WHERE type = 'catalog_approval_reject' AND entity_id = ANY($1::uuid[])`, [ids]);
        await db.query(`DELETE FROM products WHERE id = ANY($1::uuid[])`, [ids]);
      }
    } catch (_) {}
    await cleanup();
    if (db.end) await db.end().catch(() => {});
  }, 20000);

  describe('GET /approval-queue', () => {
    test('401 sans token', async () => {
      const res = await request(app).get(BASE);
      expect(res.status).toBe(401);
    });

    test('403 token client', async () => {
      const res = await request(app).get(BASE).set(...bearer(clientUser.token));
      expect([401, 403]).toContain(res.status);
    });

    test('200 admin — items/total/limit/offset', async () => {
      const candidate = await insertCandidate({ name: `IT Queue ${suffix()}` });
      const res = await request(app)
        .get(`${BASE}?limit=10&offset=0`)
        .set(...bearer(adminUser.token));

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('items');
      expect(res.body).toHaveProperty('total');
      expect(res.body).toHaveProperty('limit', 10);
      expect(res.body).toHaveProperty('offset', 0);
      expect(Array.isArray(res.body.items)).toBe(true);
      expect(res.body.items.some((p) => p.id === candidate.id)).toBe(true);
    });

    test('200 admin — limit plafonné à 200', async () => {
      const res = await request(app)
        .get(`${BASE}?limit=999`)
        .set(...bearer(adminUser.token));
      expect(res.status).toBe(200);
      expect(res.body.limit).toBe(200);
    });
  });

  describe('POST /:id/approve', () => {
    test('404 produit introuvable', async () => {
      const res = await request(app)
        .post(`${BASE}/${nilUuid}/approve`)
        .set(...bearer(adminUser.token));
      expect(res.status).toBe(404);
      expect(res.body).toHaveProperty('error');
    });

    test('422 candidat non publiable — catégorie manquante', async () => {
      const bad = await insertCandidate({ category: null, name: `IT Bad ${suffix()}` });
      const res = await request(app)
        .post(`${BASE}/${bad.id}/approve`)
        .set(...bearer(adminUser.token));

      expect(res.status).toBe(422);
      expect(res.body).toHaveProperty('error');
      expect(res.body).toHaveProperty('code', 'missing_category');
    });

    test('200 admin — publie un candidat conforme', async () => {
      const candidate = await insertCandidate({ name: `IT Approve ${suffix()}` });
      const res = await request(app)
        .post(`${BASE}/${candidate.id}/approve`)
        .set(...bearer(adminUser.token));

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        id: candidate.id,
        is_active: true,
        quality_validated: true,
        needs_review: false,
        lifecycle_status: 'active',
      });
    });

    test('409 candidat déjà décidé', async () => {
      const candidate = await insertCandidate({ name: `IT Already ${suffix()}` });
      await request(app).post(`${BASE}/${candidate.id}/approve`).set(...bearer(adminUser.token));
      const res = await request(app)
        .post(`${BASE}/${candidate.id}/approve`)
        .set(...bearer(adminUser.token));

      expect(res.status).toBe(409);
      expect(res.body).toHaveProperty('code', 'not_pending');
    });
  });

  describe('POST /:id/reject', () => {
    test('400 reason absent', async () => {
      const candidate = await insertCandidate({ name: `IT Reject Bad ${suffix()}` });
      const res = await request(app)
        .post(`${BASE}/${candidate.id}/reject`)
        .set(...bearer(adminUser.token))
        .send({});

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('error');
    });

    test('200 admin — rejette et trace une alerte', async () => {
      const candidate = await insertCandidate({ name: `IT Reject ${suffix()}` });
      const reason = 'photo fournisseur insuffisante D-06';
      const res = await request(app)
        .post(`${BASE}/${candidate.id}/reject`)
        .set(...bearer(adminUser.token))
        .send({ reason });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        id: candidate.id,
        is_active: false,
        lifecycle_status: 'rejected',
        needs_review: false,
      });

      const { rows } = await db.query(
        `SELECT type, entity_type, entity_id, severity, title, description
           FROM alerts
          WHERE type = 'catalog_approval_reject'
            AND entity_id = $1
          ORDER BY created_at DESC
          LIMIT 1`,
        [candidate.id]
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].entity_type).toBe('product');
      expect(rows[0].description).toContain(reason);
    });
  });

  describe('POST /:id/override', () => {
    test('400 fields absent', async () => {
      const candidate = await insertCandidate({ name: `IT Override Bad ${suffix()}` });
      const res = await request(app)
        .post(`${BASE}/${candidate.id}/override`)
        .set(...bearer(adminUser.token))
        .send({ reason: 'missing fields' });

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('error');
    });

    test('422 champ non whitelisté', async () => {
      const candidate = await insertCandidate({ name: `IT Override Forbidden ${suffix()}` });
      const res = await request(app)
        .post(`${BASE}/${candidate.id}/override`)
        .set(...bearer(adminUser.token))
        .send({ fields: { price_kmf: 9999 }, reason: 'not allowed' });

      expect(res.status).toBe(422);
      expect(res.body).toHaveProperty('code', 'OVERRIDE_FIELD_NOT_ALLOWED');
    });

    test('200 admin — override whitelisté puis publication', async () => {
      const candidate = await insertCandidate({ category: null, name: `IT Override ${suffix()}` });
      const res = await request(app)
        .post(`${BASE}/${candidate.id}/override`)
        .set(...bearer(adminUser.token))
        .send({
          fields: {
            name: 'Produit corrigé D-06',
            category: 'maison',
          },
          reason: 'correction avant publication',
        });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        id: candidate.id,
        name: 'Produit corrigé D-06',
        category: 'maison',
        is_active: true,
        quality_validated: true,
        needs_review: false,
        lifecycle_status: 'active',
      });
      expect(res.body.overridden).toEqual(expect.arrayContaining(['name', 'category']));

      const { rows } = await db.query(
        `SELECT field_name, field_value, reason, set_by
           FROM catalog_field_overrides
          WHERE product_id = $1
          ORDER BY field_name`,
        [candidate.id]
      );
      expect(rows.map((r) => r.field_name)).toEqual(expect.arrayContaining(['category', 'name']));
      expect(rows.every((r) => r.reason === 'correction avant publication')).toBe(true);
      expect(rows.every((r) => r.set_by === adminUser.id)).toBe(true);
    });
  });
}
