'use strict';
/**
 * TXG-01 / TXG-01b — preuve de régression SAVEPOINT (REAL_DB_INTEGRATION)
 * Cible: routes/admin-pricing-matrices.js — PUT /dims/:category (TXG-01,
 * scope officiel) et PUT /taxes/:category (TXG-01b, twin trouvé dans le
 * meme fichier lors de la passe instances jumelles).
 *
 * Mécanisme: l'INSERT pricing_matrices_audit best-effort échoue (table
 * absente, simulée par rename) => sans SAVEPOINT le client est "aborted",
 * le COMMIT suivant devient un ROLLBACK silencieux mais renvoie succès.
 *
 * 2026-07 : le volet RED-avant (comparaison contre un BASELINE pré-fix)
 * a été retiré. Il dépendait de fichiers sandbox /home/claude/baseline/
 * et /home/claude/fixed/ jamais commités dans le repo — non reproductible
 * hors de la session d'origine, et le mécanisme réécrivait le fichier
 * route réel sur disque pendant les tests. Le fix SAVEPOINT est
 * permanent dans routes/admin-pricing-matrices.js (voir sp_pricing_matrices_audit*
 * / sp_pricing_matrices_audit_taxes) ; ce test vérifie désormais
 * uniquement le comportement GREEN contre le fichier tel que commité,
 * sans jamais l'écrire.
 */
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

async function seedPricingFixtures() {
  // Le dump CI est schema-only : cette suite doit créer ses propres lignes et
  // l'utilisateur référencé par updated_by, sans dépendre d'un seed de prod ou
  // de l'ordre d'exécution des autres suites.
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

describe('TXG-01 — dims route', () => {
  test('GREEN: UPDATE dims persiste, audit best-effort loggué malgré table absente', async () => {
    const app = buildApp();
    await hideAuditTable();
    try {
      const res = await request(app)
        .put('/api/admin/pricing-matrices/dims/electronique')
        .send({ length_cm: 55, width_cm: 44, height_cm: 33, reason: 'green proof dims fixed' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const { rows: [row] } = await pool.query(
        "SELECT length_cm, width_cm, height_cm FROM pricing_category_dims WHERE category='electronique'"
      );
      expect(row.length_cm).toBe(55); // <- persisté malgré audit indisponible
      expect(row.width_cm).toBe(44);
      expect(row.height_cm).toBe(33);
    } finally {
      await restoreAuditTable();
    }
  });
});

describe('TXG-01b — taxes route (twin instance, meme fichier)', () => {
  test('GREEN: UPDATE taxes persiste malgre audit KO', async () => {
    const app = buildApp();
    await hideAuditTable();
    try {
      const res = await request(app)
        .put('/api/admin/pricing-matrices/taxes/electronique')
        .send({ douane_pct: 0.33, tva_pct: 0.22, taxe_add_pct: 0.01, reason: 'green proof taxes fixed' });

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
