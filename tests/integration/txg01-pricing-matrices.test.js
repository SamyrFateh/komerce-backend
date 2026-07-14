'use strict';
/**
 * TXG-01 / TXG-01b — CURRENT REAL_DB REGRESSION
 * Cible: routes/admin-pricing-matrices.js
 *
 * Invariant courant: si l'audit best-effort est indisponible, la transaction
 * métier doit rester valide grâce au SAVEPOINT et le COMMIT doit persister
 * les dimensions/taxes. Le RED historique est conservé dans l'historique Git,
 * pas rejoué en écrasant le code runtime pendant la CI.
 */
const path = require('path');
const request = require('supertest');
const express = require('express');
const { Pool } = require('pg');

const TARGET = path.join(__dirname, '../../routes/admin-pricing-matrices.js');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

jest.setTimeout(30000);

function loadRouter() {
  jest.resetModules();
  jest.doMock('../../middleware/auth', () => ({
    authenticate: (req, _res, next) => { req.user = { id: '00000000-0000-0000-0000-000000000001', role: 'admin' }; next(); },
    requireAdmin: (_req, _res, next) => next(),
  }));
  jest.doMock('../../utils/pricing-cache', () => ({ invalidatePricingMatricesCache: jest.fn() }));
  return require(TARGET);
}

function buildApp() {
  const router = loadRouter();
  const app = express();
  app.use(express.json());
  app.use('/api/admin/pricing-matrices', router);
  app.use((err, _req, res, _next) => res.status(500).json({ error: err.message }));
  return app;
}

async function hideAuditTable() {
  await pool.query('ALTER TABLE pricing_matrices_audit RENAME TO pricing_matrices_audit_hidden');
}

async function restoreAuditTable() {
  await pool.query('ALTER TABLE pricing_matrices_audit_hidden RENAME TO pricing_matrices_audit');
}

beforeAll(async () => {
  await pool.query(`
    UPDATE pricing_category_dims SET length_cm=30, width_cm=20, height_cm=10 WHERE category='electronique';
    UPDATE pricing_category_taxes SET douane_pct=0.10, tva_pct=0.20, taxe_add_pct=0 WHERE category='electronique';
  `);
});

afterAll(async () => {
  await pool.end();
});

describe('TXG-01 — pricing matrices audit SAVEPOINT', () => {
  test('dims: UPDATE persiste malgré audit best-effort indisponible', async () => {
    const app = buildApp();
    await hideAuditTable();
    try {
      const res = await request(app)
        .put('/api/admin/pricing-matrices/dims/electronique')
        .send({ length_cm: 55, width_cm: 44, height_cm: 33, reason: 'real-db regression dims' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const { rows: [row] } = await pool.query(
        "SELECT length_cm, width_cm, height_cm FROM pricing_category_dims WHERE category='electronique'"
      );
      expect(row.length_cm).toBe(55);
      expect(row.width_cm).toBe(44);
      expect(row.height_cm).toBe(33);
    } finally {
      await restoreAuditTable();
    }
  });

  test('taxes: UPDATE persiste malgré audit best-effort indisponible', async () => {
    const app = buildApp();
    await hideAuditTable();
    try {
      const res = await request(app)
        .put('/api/admin/pricing-matrices/taxes/electronique')
        .send({ douane_pct: 0.33, tva_pct: 0.22, taxe_add_pct: 0.01, reason: 'real-db regression taxes' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const { rows: [row] } = await pool.query(
        "SELECT douane_pct, tva_pct, taxe_add_pct FROM pricing_category_taxes WHERE category='electronique'"
      );
      expect(Number(row.douane_pct)).toBe(0.33);
      expect(Number(row.tva_pct)).toBe(0.22);
      expect(Number(row.taxe_add_pct)).toBe(0.01);
    } finally {
      await restoreAuditTable();
    }
  });
});
