'use strict';
/**
 * TXG-01 / TXG-01b — preuve de régression SAVEPOINT (REAL_DB_INTEGRATION)
 *
 * La preuve provoque une vraie erreur PostgreSQL sur INSERT d'audit, mais ne
 * renomme plus jamais la table publique. Une table TEMPORARY de même nom,
 * visible uniquement par la connexion de test injectée dans la route, masque
 * la table canonique et porte une contrainte volontairement impossible.
 */

const path = require('path');
const request = require('supertest');
const express = require('express');
const { Pool } = require('pg');

const TARGET = path.join(__dirname, '../../routes/admin-pricing-matrices.js');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const ADMIN_ID = '00000000-0000-0000-0000-000000000101';

let testClient;
let app;

jest.setTimeout(30000);

function buildApp() {
  jest.resetModules();

  const routeClient = {
    query: (...args) => testClient.query(...args),
    release: () => {},
  };

  jest.doMock('../../db', () => ({
    query: (...args) => testClient.query(...args),
    getClient: async () => routeClient,
  }));
  jest.doMock('../../middleware/auth', () => ({
    authenticate: (req, _res, next) => {
      req.user = { id: ADMIN_ID, role: 'admin' };
      next();
    },
    requireAdmin: (_req, _res, next) => next(),
  }));
  jest.doMock('../../utils/pricing-cache', () => ({
    invalidatePricingMatricesCache: jest.fn(),
  }));

  const router = require(TARGET);
  const testApp = express();
  testApp.use(express.json());
  testApp.use('/api/admin/pricing-matrices', router);
  testApp.use((err, _req, res, _next) => res.status(500).json({ error: err.message }));
  return testApp;
}

async function seedPricingFixtures() {
  await testClient.query(`
    INSERT INTO users (id, full_name, email, role)
    VALUES ('${ADMIN_ID}', 'Admin TXG-01', 'txg01-admin@komerce.test', 'admin')
    ON CONFLICT (id) DO UPDATE
      SET full_name = EXCLUDED.full_name,
          email = EXCLUDED.email,
          role = EXCLUDED.role
  `);
  await testClient.query(`
    INSERT INTO pricing_category_dims (category, label_fr, length_cm, width_cm, height_cm, updated_by)
    VALUES ('electronique', 'Électronique', 30, 20, 10, NULL)
    ON CONFLICT (category) DO UPDATE
      SET label_fr = EXCLUDED.label_fr,
          length_cm = EXCLUDED.length_cm,
          width_cm = EXCLUDED.width_cm,
          height_cm = EXCLUDED.height_cm,
          updated_by = NULL
  `);
  await testClient.query(`
    INSERT INTO pricing_category_taxes (category, label_fr, douane_pct, tva_pct, taxe_add_pct, updated_by)
    VALUES ('electronique', 'Électronique', 0.10, 0.20, 0, NULL)
    ON CONFLICT (category) DO UPDATE
      SET label_fr = EXCLUDED.label_fr,
          douane_pct = EXCLUDED.douane_pct,
          tva_pct = EXCLUDED.tva_pct,
          taxe_add_pct = EXCLUDED.taxe_add_pct,
          updated_by = NULL
  `);
}

beforeAll(async () => {
  testClient = await pool.connect();

  await testClient.query(`
    CREATE TEMPORARY TABLE pricing_matrices_audit (
      id serial PRIMARY KEY,
      matrix_type varchar(20) NOT NULL,
      category varchar(50) NOT NULL,
      old_value jsonb NOT NULL,
      new_value jsonb NOT NULL,
      changed_by uuid,
      change_reason text,
      created_at timestamptz NOT NULL DEFAULT NOW(),
      CONSTRAINT txg01_force_audit_failure CHECK (false)
    ) ON COMMIT PRESERVE ROWS
  `);

  await seedPricingFixtures();
  app = buildApp();
});

beforeEach(async () => {
  await seedPricingFixtures();
});

afterAll(async () => {
  if (testClient) {
    await seedPricingFixtures();
    await testClient.query('DELETE FROM users WHERE id = $1', [ADMIN_ID]);
    testClient.release();
  }
  await pool.end();
});

describe('TXG-01 — dims route', () => {
  test('GREEN: UPDATE dims persiste, audit best-effort loggué malgré erreur PostgreSQL', async () => {
    const res = await request(app)
      .put('/api/admin/pricing-matrices/dims/electronique')
      .send({ length_cm: 55, width_cm: 44, height_cm: 33, reason: 'green proof dims fixed' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const { rows: [row] } = await testClient.query(
      "SELECT length_cm, width_cm, height_cm FROM pricing_category_dims WHERE category='electronique'"
    );
    expect(row.length_cm).toBe(55);
    expect(row.width_cm).toBe(44);
    expect(row.height_cm).toBe(33);
  });
});

describe('TXG-01b — taxes route', () => {
  test('GREEN: UPDATE taxes persiste malgré erreur PostgreSQL de l’audit', async () => {
    const res = await request(app)
      .put('/api/admin/pricing-matrices/taxes/electronique')
      .send({ douane_pct: 0.33, tva_pct: 0.22, taxe_add_pct: 0.01, reason: 'green proof taxes fixed' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const { rows: [row] } = await testClient.query(
      "SELECT douane_pct, tva_pct, taxe_add_pct FROM pricing_category_taxes WHERE category='electronique'"
    );
    expect(Number(row.douane_pct)).toBe(0.33);
    expect(Number(row.tva_pct)).toBe(0.22);
    expect(Number(row.taxe_add_pct)).toBe(0.01);
  });
});
