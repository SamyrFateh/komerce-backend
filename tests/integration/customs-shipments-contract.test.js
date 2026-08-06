'use strict';


/**
 * @test-kind integration
 * @test-runner jest
 * @test-requires postgres
 */
/**
 * tests/integration/customs-shipments-contract.test.js
 *
 * D-06 — Contrat HTTP réel pour les 5 routes customs restées UNKNOWN :
 *   POST /api/admin/customs-shipments/:id/declare
 *   GET  /api/admin/customs-shipments/status/pending
 *   GET  /api/admin/customs-shipments/analytics
 *   GET  /api/admin/customs-shipments/analytics/trends
 *   GET  /api/admin/customs-shipments/:id/analytics
 *
 * Point volontairement figé : GET /analytics est actuellement shadowed par
 * GET /:id dans routes/admin-customs-shipments.js. Le comportement réel est
 * donc 400 invalid_input avec id='analytics'. D-06 documente ce contrat réel ;
 * le correctif de routing doit rester un lot séparé.
 *
 * Run :
 *   DATABASE_URL=postgres://... JWT_SECRET=ci-test-secret-not-for-prod \
 *   npx jest tests/integration/customs-shipments-contract.test.js --runInBand
 */

const hasIntegrationEnv = Boolean(process.env.DATABASE_URL);

if (!hasIntegrationEnv) {
  describe.skip('customs-shipments-contract D-06 (needs DATABASE_URL)', () => {
    test('skipped — DATABASE_URL not configured', () => {});
  });
} else {
  const request = require('supertest');
  const { createUser, cleanup } = require('./test-harness/seed-helpers');

  let app;
  let db;
  let adminUser;
  let clientUser;
  let pendingForList;
  let pendingForDeclare;
  let confirmedShipment;

  const BASE = '/api/admin/customs-shipments';
  const nilUuid = '00000000-0000-0000-0000-000000000000';
  const createdShipmentIds = new Set();
  const bearer = (token) => ['Authorization', `Bearer ${token}`];
  const suffix = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  async function insertShipment(overrides = {}) {
    const tag = suffix();
    const payload = {
      reference: `IT-D06-CUST-${tag}`,
      shipment_date: '2026-07-08',
      transitaire_name: 'ITest Transitaire',
      transport_mode: 'air',
      cif_value_kmf: 250000,
      customs_paid_kmf: null,
      freight_kmf: null,
      total_weight_kg: null,
      nb_parcels: 0,
      allocation_method: 'by_cif_value',
      notes: 'D-06 contract seed',
      status: 'pending',
      declared_at: null,
      declared_by: null,
      ...overrides,
    };

    const { rows: [shipment] } = await db.query(
      `INSERT INTO customs_shipments
         (reference, shipment_date, transitaire_name, transport_mode,
          cif_value_kmf, customs_paid_kmf, freight_kmf, total_weight_kg,
          nb_parcels, allocation_method, notes, created_by,
          status, declared_at, declared_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       RETURNING *`,
      [
        payload.reference, payload.shipment_date, payload.transitaire_name,
        payload.transport_mode, payload.cif_value_kmf, payload.customs_paid_kmf,
        payload.freight_kmf, payload.total_weight_kg, payload.nb_parcels,
        payload.allocation_method, payload.notes, adminUser?.id || null,
        payload.status, payload.declared_at, payload.declared_by,
      ]
    );
    createdShipmentIds.add(shipment.id);
    return shipment;
  }

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'ci-test-secret-not-for-prod';

    app = require('../../server');
    db = require('../../db');

    await new Promise((resolve) => setTimeout(resolve, 2000));

    adminUser = await createUser({ role: 'admin' });
    clientUser = await createUser({ role: 'client' });

    pendingForList = await insertShipment({ reference: `IT-D06-PENDING-${suffix()}` });
    pendingForDeclare = await insertShipment({ reference: `IT-D06-DECLARE-${suffix()}` });
    confirmedShipment = await insertShipment({
      reference: `IT-D06-CONFIRMED-${suffix()}`,
      status: 'confirmed',
      customs_paid_kmf: 33000,
      declared_at: new Date(),
      declared_by: adminUser.id,
    });
  }, 30000);

  afterAll(async () => {
    if (app && app.get && app.get('httpServer')) { await new Promise((resolve) => app.get('httpServer').close(resolve)); }
    const ids = Array.from(createdShipmentIds);
    try {
      if (ids.length) {
        await db.query(`DELETE FROM customs_shipment_parcels WHERE shipment_id = ANY($1::uuid[])`, [ids]);
        await db.query(`DELETE FROM transaction_documents WHERE subject_id = ANY($1::uuid[])`, [ids]);
        await db.query(`DELETE FROM customs_shipments WHERE id = ANY($1::uuid[])`, [ids]);
      }
    } catch (_) {}
    await cleanup();
    if (db.end) await db.end().catch(() => {});
  }, 20000);

  describe('POST /:id/declare', () => {
    test('401 sans token', async () => {
      const res = await request(app).post(`${BASE}/${pendingForDeclare.id}/declare`).send({ customs_paid_kmf: 12000 });
      expect(res.status).toBe(401);
    });

    test('403 token client', async () => {
      const res = await request(app)
        .post(`${BASE}/${pendingForDeclare.id}/declare`)
        .set(...bearer(clientUser.token))
        .send({ customs_paid_kmf: 12000 });
      expect([401, 403]).toContain(res.status);
    });

    test('400 customs_paid_kmf absent ou invalide', async () => {
      const res = await request(app)
        .post(`${BASE}/${pendingForDeclare.id}/declare`)
        .set(...bearer(adminUser.token))
        .send({ notes: 'missing amount' });
      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('error');
    });

    test('404 expédition introuvable', async () => {
      const res = await request(app)
        .post(`${BASE}/${nilUuid}/declare`)
        .set(...bearer(adminUser.token))
        .send({ customs_paid_kmf: 12000 });
      expect(res.status).toBe(404);
      expect(res.body).toHaveProperty('error');
    });

    test('409 expédition confirmée non modifiable', async () => {
      const res = await request(app)
        .post(`${BASE}/${confirmedShipment.id}/declare`)
        .set(...bearer(adminUser.token))
        .send({ customs_paid_kmf: 15000 });
      expect(res.status).toBe(409);
      expect(res.body).toHaveProperty('error');
    });

    test('200 admin — déclare le montant réel payé', async () => {
      const res = await request(app)
        .post(`${BASE}/${pendingForDeclare.id}/declare`)
        .set(...bearer(adminUser.token))
        .send({ customs_paid_kmf: 18000, freight_kmf: 5000, notes: 'déclaration D-06' });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        shipment_id: pendingForDeclare.id,
        status: 'declared',
        parcels_updated: 0,
      });
      expect(Number(res.body.customs_paid_kmf)).toBe(18000);
    });
  });

  describe('GET /status/pending', () => {
    test('401 sans token', async () => {
      const res = await request(app).get(`${BASE}/status/pending`);
      expect(res.status).toBe(401);
    });

    test('200 admin — liste + count', async () => {
      const res = await request(app)
        .get(`${BASE}/status/pending`)
        .set(...bearer(adminUser.token));

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('shipments');
      expect(res.body).toHaveProperty('count');
      expect(Array.isArray(res.body.shipments)).toBe(true);
      expect(res.body.shipments.some((s) => s.id === pendingForList.id)).toBe(true);
    });
  });

  describe('GET /analytics — comportement réel shadowed', () => {
    test('400 admin — /analytics est capturé par /:id et rejeté comme UUID invalide', async () => {
      const res = await request(app)
        .get(`${BASE}/analytics`)
        .set(...bearer(adminUser.token));

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('error');
      expect(res.body).toHaveProperty('code', 'invalid_input');
    });
  });

  describe('GET /analytics/trends', () => {
    test('401 sans token', async () => {
      const res = await request(app).get(`${BASE}/analytics/trends?months=6`);
      expect(res.status).toBe(401);
    });

    test('200 admin — retourne trends + months', async () => {
      const res = await request(app)
        .get(`${BASE}/analytics/trends?months=6`)
        .set(...bearer(adminUser.token));

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('trends');
      expect(res.body).toHaveProperty('months', 6);
      expect(Array.isArray(res.body.trends)).toBe(true);
    });
  });

  describe('GET /:id/analytics', () => {
    test('404 si expédition non déclarée / sans analytics disponible', async () => {
      const res = await request(app)
        .get(`${BASE}/${pendingForList.id}/analytics`)
        .set(...bearer(adminUser.token));

      expect(res.status).toBe(404);
      expect(res.body).toHaveProperty('error');
    });
  });
}
