'use strict';
/**
 * TXG-03 — CURRENT REAL_DB REGRESSION
 * Cible: routes/hub-dashboard.js — POST /orders/:id/auto-prepare
 *
 * Invariant courant: si l'INSERT scans best-effort échoue, le colis,
 * parcel_items et order_comments doivent tout de même être committés.
 */
const path = require('path');
const request = require('supertest');
const express = require('express');
const { Pool } = require('pg');

const TARGET = path.join(__dirname, '../../routes/hub-dashboard.js');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const ORDER_ID = '00000000-0000-0000-0000-0000000000c1';
const HUB_USER_ID = '00000000-0000-0000-0000-000000000002';

jest.setTimeout(30000);

function loadRouter() {
  jest.resetModules();
  jest.doMock('../../middleware/auth', () => ({
    authenticate: (req, _res, next) => { req.user = { id: HUB_USER_ID, role: 'agent_hub' }; next(); },
    requireRole: () => (_req, _res, next) => next(),
  }));
  return require(TARGET);
}

function buildApp() {
  const router = loadRouter();
  const app = express();
  app.use(express.json());
  app.use('/api/hub', router);
  app.use((err, _req, res, _next) => res.status(500).json({ error: err.message }));
  return app;
}

async function hideScans() {
  await pool.query('ALTER TABLE scans RENAME TO scans_hidden');
}

async function restoreScans() {
  await pool.query('ALTER TABLE scans_hidden RENAME TO scans');
}

async function resetOrderState() {
  await pool.query(`
    INSERT INTO users (id, full_name, email, role)
    VALUES ('${HUB_USER_ID}', 'Hub Agent Test', 'hub-test@komerce.test', 'agent_hub')
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
    INSERT INTO orders (id, reference, relais_id, total_kmf, payment_mode, status)
    VALUES ($1, 'KOM-TEST-TXG03', '00000000-0000-0000-0000-0000000000a1', 10000, 'cash_relais', 'preparation')
    ON CONFLICT (id) DO UPDATE SET status = 'preparation'
  `, [ORDER_ID]);
  await pool.query(`
    INSERT INTO order_items (id, order_id, product_id, price_kmf, quantity)
    VALUES ('00000000-0000-0000-0000-0000000000d1', $1, '00000000-0000-0000-0000-0000000000b1', 10000, 1)
    ON CONFLICT (id) DO UPDATE SET quantity = 1
  `, [ORDER_ID]);

  await pool.query(`
    DELETE FROM parcel_items WHERE order_item_id IN (
      SELECT id FROM order_items WHERE order_id = $1
    )
  `, [ORDER_ID]);
  await pool.query("UPDATE parcels SET status = 'cancelled' WHERE order_id = $1", [ORDER_ID]);
  await pool.query('DELETE FROM order_comments WHERE order_id = $1', [ORDER_ID]);
  await pool.query("UPDATE orders SET status = 'preparation' WHERE id = $1", [ORDER_ID]);
}

beforeAll(async () => {
  await resetOrderState();
});

afterAll(async () => {
  await pool.end();
});

describe('TXG-03 — auto-prepare scans SAVEPOINT', () => {
  test('colis et commentaire sont committés malgré scans indisponible', async () => {
    await resetOrderState();
    const app = buildApp();
    await hideScans();
    try {
      const res = await request(app)
        .post(`/api/hub/orders/${ORDER_ID}/auto-prepare`)
        .send({});

      expect(res.status).toBe(201);
      expect(res.body.items_assigned).toBe(1);

      const { rows: parcelRows } = await pool.query('SELECT id FROM parcels WHERE order_id = $1 AND status <> $2', [ORDER_ID, 'cancelled']);
      expect(parcelRows.length).toBe(1);

      const { rows: commentRows } = await pool.query('SELECT id FROM order_comments WHERE order_id = $1', [ORDER_ID]);
      expect(commentRows.length).toBe(1);
    } finally {
      await restoreScans();
    }
  });
});
