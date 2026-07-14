'use strict';
/**
 * TXG-04 — CURRENT REAL_DB REGRESSION
 * Cible: routes/admin/system.js — POST /api/admin/reset mode=factory
 *
 * Invariant courant: si le nettoyage partners best-effort échoue, le reset
 * factory doit tout de même committer les suppressions métier déjà effectuées.
 */
const path = require('path');
const request = require('supertest');
const express = require('express');
const { Pool } = require('pg');

const TARGET = path.join(__dirname, '../../routes/admin/system.js');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const ADMIN_ID = '00000000-0000-0000-0000-000000000001';

jest.setTimeout(30000);

function loadRouter() {
  jest.resetModules();
  jest.doMock('../../middleware/auth', () => ({
    authenticate: (req, _res, next) => { req.user = { id: ADMIN_ID, role: 'admin', email: 'admin-test@komerce.test' }; next(); },
    requireRole: () => (_req, _res, next) => next(),
  }));
  return require(TARGET);
}

function buildApp() {
  const router = loadRouter();
  const app = express();
  app.use(express.json());
  app.use('/api/admin', router);
  app.use((err, _req, res, _next) => res.status(500).json({ error: err.message }));
  return app;
}

async function hidePartners() {
  await pool.query('ALTER TABLE partners RENAME TO partners_hidden');
}

async function restorePartners() {
  await pool.query('ALTER TABLE partners_hidden RENAME TO partners');
}

async function seedFactoryFixtures() {
  await pool.query(`
    INSERT INTO products (id, name, price_kmf)
    VALUES ('00000000-0000-0000-0000-0000000000b1', 'Produit Test TXG', 10000)
    ON CONFLICT (id) DO NOTHING;
  `);
  await pool.query(`
    INSERT INTO relais (id, name, agent_name, phone, address)
    VALUES ('00000000-0000-0000-0000-0000000000a1', 'Relais Test Moroni', 'Agent Relais Test', '+269000000', 'Adresse Test Moroni')
    ON CONFLICT (id) DO NOTHING;
  `);
}

async function restoreSharedSeed() {
  await pool.query(`
    INSERT INTO users (id, full_name, email, role)
    VALUES
      ('00000000-0000-0000-0000-000000000001', 'Admin Test', 'admin-test@komerce.test', 'admin'),
      ('00000000-0000-0000-0000-000000000002', 'Hub Agent Test', 'hub-test@komerce.test', 'agent_hub')
    ON CONFLICT (id) DO NOTHING;
  `);
  await pool.query(`
    INSERT INTO products (id, name, price_kmf)
    VALUES ('00000000-0000-0000-0000-0000000000b1', 'Produit Test TXG', 10000)
    ON CONFLICT (id) DO NOTHING;
  `);
  await pool.query(`
    INSERT INTO relais (id, name, agent_name, phone, address)
    VALUES ('00000000-0000-0000-0000-0000000000a1', 'Relais Test Moroni', 'Agent Relais Test', '+269000000', 'Adresse Test Moroni')
    ON CONFLICT (id) DO NOTHING;
  `);
  await pool.query(`
    INSERT INTO pricing_category_dims (category, label_fr, length_cm, width_cm, height_cm)
    VALUES ('electronique', 'Électronique', 30, 20, 10)
    ON CONFLICT (category) DO UPDATE SET length_cm=30, width_cm=20, height_cm=10;
  `);
  await pool.query(`
    INSERT INTO pricing_category_taxes (category, label_fr, douane_pct, tva_pct, taxe_add_pct)
    VALUES ('electronique', 'Électronique', 0.10, 0.20, 0)
    ON CONFLICT (category) DO UPDATE SET douane_pct=0.10, tva_pct=0.20, taxe_add_pct=0;
  `);
  await pool.query(`
    INSERT INTO orders (id, reference, relais_id, total_kmf, payment_mode, status)
    VALUES ('00000000-0000-0000-0000-0000000000c1', 'KOM-TEST-TXG03', '00000000-0000-0000-0000-0000000000a1', 10000, 'cash_relais', 'preparation')
    ON CONFLICT (id) DO UPDATE SET status='preparation';
  `);
  await pool.query(`
    INSERT INTO order_items (id, order_id, product_id, price_kmf, quantity)
    VALUES ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000b1', 10000, 1)
    ON CONFLICT (id) DO UPDATE SET quantity=1;
  `);
}

beforeAll(async () => {
  await seedFactoryFixtures();
});

afterAll(async () => {
  await restoreSharedSeed();
  await pool.end();
});

describe('TXG-04 — factory reset partners SAVEPOINT', () => {
  test('products et relais sont supprimés malgré partners indisponible', async () => {
    await seedFactoryFixtures();
    const app = buildApp();
    await hidePartners();
    try {
      const res = await request(app)
        .post('/api/admin/reset')
        .send({ mode: 'factory', confirm: true });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const { rows: prodRows } = await pool.query(
        "SELECT id FROM products WHERE id = '00000000-0000-0000-0000-0000000000b1'"
      );
      expect(prodRows.length).toBe(0);

      const { rows: relaisRows } = await pool.query(
        "SELECT id FROM relais WHERE id = '00000000-0000-0000-0000-0000000000a1'"
      );
      expect(relaisRows.length).toBe(0);
    } finally {
      await restorePartners();
    }
  });
});
