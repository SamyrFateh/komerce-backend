'use strict';
/**
 * TXG-05 — Preuve du fix bug préexistant (hors RC-TX, signalé pendant RC-TX) :
 * routes/hub-dashboard.js — 3 sites INSERT INTO parcel_items omettaient
 * product_id (colonne NOT NULL + FK products.id). Sans ce fix, tout INSERT
 * échouait avec une violation NOT NULL dès qu'on tapait le vrai schéma
 * (db/schema.sql), masqué en RC-TX par un workaround test-only.
 *
 * Ce test couvre les 3 sites-jumeaux (même fichier, même défaut) :
 *   1. POST /parcels (item_ids fournis manuellement)      — l.166-172
 *   2. POST /orders/:id/auto-prepare (boucle "unassigned") — l.269-274
 *   3. POST /parcels/:id/items (ajout manuel d'un article)  — l.346-352
 */
const request = require('supertest');
const express = require('express');
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const ORDER_ID = '00000000-0000-0000-0000-0000000000c1';
const PRODUCT_ID = '00000000-0000-0000-0000-0000000000b1';
const RELAIS_ID = '00000000-0000-0000-0000-0000000000a1';
const HUB_USER_ID = '00000000-0000-0000-0000-000000000002';

jest.setTimeout(30000);

function loadRouter() {
  jest.resetModules();
  jest.doMock('../../middleware/auth', () => ({
    authenticate: (req, _res, next) => { req.user = { id: HUB_USER_ID, role: 'agent_hub' }; next(); },
    requireRole: () => (_req, _res, next) => next(),
  }));
  return require('../../routes/hub-dashboard.js');
}

function buildApp() {
  const router = loadRouter();
  const app = express();
  app.use(express.json());
  app.use('/api/hub', router);
  app.use((err, _req, res, _next) => res.status(500).json({ error: err.message }));
  return app;
}

async function resetOrderState() {
  await pool.query(`
    INSERT INTO users (id, full_name, email, role)
    VALUES ('${HUB_USER_ID}', 'Hub Agent Test', 'hub-test@komerce.test', 'agent_hub')
    ON CONFLICT (id) DO NOTHING;
  `);
  await pool.query(`
    INSERT INTO products (id, name, price_kmf)
    VALUES ('${PRODUCT_ID}', 'Produit Test TXG', 10000)
    ON CONFLICT (id) DO NOTHING;
  `);
  await pool.query(`
    INSERT INTO relais (id, name, agent_name, phone, address)
    VALUES ('${RELAIS_ID}', 'Relais Test Moroni', 'Agent Relais Test', '+269000000', 'Adresse Test Moroni')
    ON CONFLICT (id) DO NOTHING;
  `);
  await pool.query(`
    INSERT INTO orders (id, reference, relais_id, total_kmf, payment_mode, status)
    VALUES ($1, 'KOM-TEST-TXG05', $2, 10000, 'cash_relais', 'preparation')
    ON CONFLICT (id) DO UPDATE SET status = 'preparation'
  `, [ORDER_ID, RELAIS_ID]);
  await pool.query(`
    INSERT INTO order_items (id, order_id, product_id, price_kmf, quantity)
    VALUES ('00000000-0000-0000-0000-0000000000d1', $1, $2, 10000, 1)
    ON CONFLICT (id) DO UPDATE SET quantity = 1
  `, [ORDER_ID, PRODUCT_ID]);
  await pool.query(`DELETE FROM parcel_items WHERE order_item_id IN (SELECT id FROM order_items WHERE order_id = $1)`, [ORDER_ID]);
  // Trigger DB interdit le DELETE sur parcels (RAISE EXCEPTION, cf. db/schema.sql:458) —
  // on neutralise les colis des runs précédents via status=cancelled au lieu de les supprimer.
  await pool.query("UPDATE parcels SET status = 'cancelled' WHERE order_id = $1", [ORDER_ID]);
  await pool.query('DELETE FROM order_comments WHERE order_id = $1', [ORDER_ID]);
  await pool.query("UPDATE orders SET status = 'preparation' WHERE id = $1", [ORDER_ID]);
}

beforeAll(async () => { await resetOrderState(); });
afterAll(async () => { await pool.end(); });

describe('TXG-05 — parcel_items.product_id (bug préexistant, 3 sites jumeaux)', () => {
  test('Site 2 (auto-prepare) : product_id correctement persisté dans parcel_items', async () => {
    await resetOrderState();
    const app = buildApp();
    const res = await request(app)
      .post(`/api/hub/orders/${ORDER_ID}/auto-prepare`)
      .send({});

    expect(res.status).toBe(201);

    const { rows } = await pool.query(
      `SELECT pi.product_id FROM parcel_items pi
       JOIN parcels pa ON pa.id = pi.parcel_id
       WHERE pa.order_id = $1`,
      [ORDER_ID]
    );
    expect(rows.length).toBe(1);
    expect(rows[0].product_id).toBe(PRODUCT_ID); // <- avant fix: violation NOT NULL, INSERT échouait
  });

  test('Site 1 (POST /orders/:id/create-parcel avec item_ids) : product_id correctement persisté', async () => {
    await resetOrderState();
    const app = buildApp();
    const res = await request(app)
      .post(`/api/hub/orders/${ORDER_ID}/create-parcel`)
      .send({ type: 'standard', item_ids: ['00000000-0000-0000-0000-0000000000d1'] });

    expect(res.status).toBe(201);

    const { rows } = await pool.query(
      `SELECT product_id FROM parcel_items WHERE order_item_id = '00000000-0000-0000-0000-0000000000d1'`
    );
    expect(rows.length).toBe(1);
    expect(rows[0].product_id).toBe(PRODUCT_ID); // <- avant fix: violation NOT NULL (silencieuse via .catch(()=>{}))
  });

  test('Site 3 (POST /parcels/:id/add-item) : product_id correctement persisté', async () => {
    await resetOrderState();
    const app = buildApp();

    // Créer un colis vide d'abord (sans item_ids)
    const createRes = await request(app)
      .post(`/api/hub/orders/${ORDER_ID}/create-parcel`)
      .send({ type: 'standard' });
    expect(createRes.status).toBe(201);
    const parcelId = createRes.body.parcel.id;

    const res = await request(app)
      .post(`/api/hub/parcels/${parcelId}/add-item`)
      .send({ order_item_id: '00000000-0000-0000-0000-0000000000d1' });

    expect(res.status).toBe(200);
    expect(res.body.item.product_id).toBe(PRODUCT_ID); // <- avant fix: violation NOT NULL, route cassée
  });
});
