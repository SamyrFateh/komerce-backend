'use strict';


/**
 * @test-kind integration
 * @test-runner jest
 * @test-requires postgres
 */
/**
 * tests/integration/admin-documents-contract.test.js
 *
 * D-06 — Contrat HTTP réel pour les 3 routes documents restées UNKNOWN :
 *   GET /api/admin/documents
 *   GET /api/admin/documents/summary
 *   GET /api/admin/documents/:id
 *
 * Verrouille la forme admin des transaction_documents : filtres, pagination,
 * metadata_summary allégé, diagnostic summary et détail complet.
 *
 * Run :
 *   DATABASE_URL=postgres://... JWT_SECRET=ci-test-secret-not-for-prod \
 *   npx jest tests/integration/admin-documents-contract.test.js --runInBand
 */

const hasIntegrationEnv = Boolean(process.env.DATABASE_URL);

if (!hasIntegrationEnv) {
  describe.skip('admin-documents-contract D-06 (needs DATABASE_URL)', () => {
    test('skipped — DATABASE_URL not configured', () => {});
  });
} else {
  const request = require('supertest');
  const { createUser, cleanup } = require('./test-harness/seed-helpers');

  let app;
  let db;
  let adminUser;
  let clientUser;
  let walletDoc;
  let refundDoc;

  const BASE = '/api/admin';
  const nilUuid = '00000000-0000-0000-0000-000000000000';
  const bearer = (token) => ['Authorization', `Bearer ${token}`];
  const suffix = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  async function insertDocument({ document_type, subject_type, reference, status = 'generated', metadata = {} }) {
    const { rows: [doc] } = await db.query(
      `INSERT INTO transaction_documents
         (document_type, subject_type, subject_id, reference, status, issued_by, metadata)
       VALUES ($1, $2, gen_random_uuid(), $3, $4, $5, $6::jsonb)
       RETURNING *`,
      [document_type, subject_type, reference, status, adminUser.id, JSON.stringify(metadata)]
    );
    return doc;
  }

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'ci-test-secret-not-for-prod';

    app = require('../../server');
    db = require('../../db');

    await new Promise((resolve) => setTimeout(resolve, 2000));

    adminUser = await createUser({ role: 'admin' });
    clientUser = await createUser({ role: 'client' });

    walletDoc = await insertDocument({
      document_type: 'wallet_receipt',
      subject_type: 'wallet_transaction',
      reference: `IT-DOC-WALLET-${suffix()}`,
      status: 'generated',
      metadata: { amount_kmf: 12000, lines: [{ label: 'hidden in summary' }], source: 'D06' },
    });
    refundDoc = await insertDocument({
      document_type: 'refund_receipt',
      subject_type: 'refund',
      reference: `IT-DOC-REFUND-${suffix()}`,
      status: 'delivered',
      metadata: { amount_kmf: 8000, lines: [{ label: 'hidden in summary' }], source: 'D06' },
    });
  }, 30000);

  afterAll(async () => {
    if (app && app.get && app.get('httpServer')) { await new Promise((resolve) => app.get('httpServer').close(resolve)); }
    try { await db.query(`DELETE FROM transaction_documents WHERE id = ANY($1::uuid[])`, [[walletDoc?.id, refundDoc?.id].filter(Boolean)]); } catch (_) {}
    await cleanup();
    if (db.end) await db.end().catch(() => {});
  }, 20000);

  describe('GET /documents', () => {
    test('401 sans token', async () => {
      const res = await request(app).get(`${BASE}/documents`);
      expect(res.status).toBe(401);
    });

    test('403 token client', async () => {
      const res = await request(app)
        .get(`${BASE}/documents`)
        .set(...bearer(clientUser.token));
      expect([401, 403]).toContain(res.status);
    });

    test('200 admin — liste paginée', async () => {
      const res = await request(app)
        .get(`${BASE}/documents?limit=10&offset=0`)
        .set(...bearer(adminUser.token));

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('documents');
      expect(res.body).toHaveProperty('total');
      expect(res.body).toHaveProperty('limit', 10);
      expect(res.body).toHaveProperty('offset', 0);
      expect(Array.isArray(res.body.documents)).toBe(true);
      expect(res.body.documents.some((d) => d.id === walletDoc.id)).toBe(true);
    });

    test('200 admin — filtre document_type + metadata_summary sans lines', async () => {
      const res = await request(app)
        .get(`${BASE}/documents?document_type=wallet_receipt`)
        .set(...bearer(adminUser.token));

      expect(res.status).toBe(200);
      const doc = res.body.documents.find((d) => d.id === walletDoc.id);
      expect(doc).toBeTruthy();
      expect(doc.document_type).toBe('wallet_receipt');
      expect(doc.metadata_summary).toHaveProperty('amount_kmf');
      expect(doc.metadata_summary).not.toHaveProperty('lines');
    });

    test('200 admin — filtre status + limit plafonné à 200', async () => {
      const res = await request(app)
        .get(`${BASE}/documents?status=delivered&limit=999`)
        .set(...bearer(adminUser.token));

      expect(res.status).toBe(200);
      expect(res.body.limit).toBe(200);
      expect(res.body.documents.some((d) => d.id === refundDoc.id)).toBe(true);
    });
  });

  describe('GET /documents/summary', () => {
    test('200 admin — diagnostic table/séquences/types', async () => {
      const res = await request(app)
        .get(`${BASE}/documents/summary`)
        .set(...bearer(adminUser.token));

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('table_exists');
      expect(res.body).toHaveProperty('by_type');
      expect(res.body).toHaveProperty('sequences');
      expect(res.body).toHaveProperty('type_constraint');
      expect(res.body).toHaveProperty('diagnosis');
      expect(Array.isArray(res.body.by_type)).toBe(true);
      expect(Array.isArray(res.body.sequences)).toBe(true);
    });
  });

  describe('GET /documents/:id', () => {
    test('200 admin — détail complet avec metadata', async () => {
      const res = await request(app)
        .get(`${BASE}/documents/${walletDoc.id}`)
        .set(...bearer(adminUser.token));

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('document');
      expect(res.body.document).toMatchObject({
        id: walletDoc.id,
        document_type: 'wallet_receipt',
        reference: walletDoc.reference,
      });
      expect(res.body.document.metadata).toHaveProperty('lines');
      expect(res.body.document).toHaveProperty('issued_by_name');
    });

    test('404 document introuvable', async () => {
      const res = await request(app)
        .get(`${BASE}/documents/${nilUuid}`)
        .set(...bearer(adminUser.token));

      expect(res.status).toBe(404);
      expect(res.body).toHaveProperty('error');
    });
  });
}
