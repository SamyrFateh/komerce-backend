'use strict';

/**
 * @test-kind integration
 * @test-runner jest
 * @test-requires postgres
 */
/**
 * TXG-01 — LOT 1A / retrait des éditeurs pricing fantômes
 *
 * Les anciennes routes PUT restent adressables pour compatibilité mais sont
 * désormais fail-closed (410 Gone). Cette preuve REAL_DB_INTEGRATION verrouille
 * l'invariant essentiel : aucun appel legacy ne modifie
 * pricing_category_taxes/pricing_category_dims.
 */
const hasIntegrationEnv = Boolean(process.env.DATABASE_URL);

if (!hasIntegrationEnv) {
  describe.skip('TXG-01 pricing matrices (needs DATABASE_URL)', () => {
    test('skipped — DATABASE_URL not configured', () => {});
  });
} else {

const path = require('path');
const request = require('supertest');
const express = require('express');
const { Pool } = require('pg');

const TARGET = path.join(__dirname, '../../routes/admin-pricing-matrices.js');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const ADMIN_ID = '00000000-0000-0000-0000-000000000101';

jest.setTimeout(30000);

function loadRouter() {
  jest.resetModules();
  jest.doMock('../../middleware/auth', () => ({
    authenticate: (req, _res, next) => { req.user = { id: ADMIN_ID, role: 'admin' }; next(); },
    requireAdmin: (_req, _res, next) => next(),
  }));
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

async function seedPricingFixtures() {
  await pool.query(`
    INSERT INTO users (id, full_name, email, role)
    VALUES ('${ADMIN_ID}', 'Admin TXG-01', 'txg01-admin@komerce.test', 'admin')
    ON CONFLICT (id) DO UPDATE
      SET full_name = EXCLUDED.full_name,
          email = EXCLUDED.email,
          role = EXCLUDED.role;
  `);
  await pool.query(`
    INSERT INTO pricing_category_dims (category, label_fr, length_cm, width_cm, height_cm, updated_by)
    VALUES ('electronique', 'Électronique', 30, 20, 10, NULL)
    ON CONFLICT (category) DO UPDATE
      SET label_fr = EXCLUDED.label_fr,
          length_cm = EXCLUDED.length_cm,
          width_cm = EXCLUDED.width_cm,
          height_cm = EXCLUDED.height_cm,
          updated_by = NULL;
  `);
  await pool.query(`
    INSERT INTO pricing_category_taxes (category, label_fr, douane_pct, tva_pct, taxe_add_pct, updated_by)
    VALUES ('electronique', 'Électronique', 0.10, 0.20, 0, NULL)
    ON CONFLICT (category) DO UPDATE
      SET label_fr = EXCLUDED.label_fr,
          douane_pct = EXCLUDED.douane_pct,
          tva_pct = EXCLUDED.tva_pct,
          taxe_add_pct = EXCLUDED.taxe_add_pct,
          updated_by = NULL;
  `);
}

beforeAll(seedPricingFixtures);

afterAll(async () => {
  await seedPricingFixtures();
  await pool.query('DELETE FROM users WHERE id = $1', [ADMIN_ID]);
  await pool.end();
});

describe('TXG-01 — matrices legacy en lecture seule', () => {
  test('PUT dims répond 410 et laisse la ligne DB strictement inchangée', async () => {
    const { rows: [before] } = await pool.query(
      "SELECT length_cm, width_cm, height_cm, updated_by FROM pricing_category_dims WHERE category='electronique'"
    );

    const res = await request(buildApp())
      .put('/api/admin/pricing-matrices/dims/electronique')
      .send({ length_cm: 55, width_cm: 44, height_cm: 33, reason: 'tentative legacy lot 1a' });

    expect(res.status).toBe(410);
    expect(res.body.error).toBe('pricing_matrix_editor_retired');

    const { rows: [after] } = await pool.query(
      "SELECT length_cm, width_cm, height_cm, updated_by FROM pricing_category_dims WHERE category='electronique'"
    );
    expect(after).toEqual(before);
  });

  test('PUT taxes répond 410 et laisse la ligne DB strictement inchangée', async () => {
    const { rows: [before] } = await pool.query(
      "SELECT douane_pct, tva_pct, taxe_add_pct, updated_by FROM pricing_category_taxes WHERE category='electronique'"
    );

    const res = await request(buildApp())
      .put('/api/admin/pricing-matrices/taxes/electronique')
      .send({ douane_pct: 0.33, tva_pct: 0.22, taxe_add_pct: 0.01, reason: 'tentative legacy lot 1a' });

    expect(res.status).toBe(410);
    expect(res.body.error).toBe('pricing_matrix_editor_retired');

    const { rows: [after] } = await pool.query(
      "SELECT douane_pct, tva_pct, taxe_add_pct, updated_by FROM pricing_category_taxes WHERE category='electronique'"
    );
    expect(after).toEqual(before);
  });
});

} // end hasIntegrationEnv guard
