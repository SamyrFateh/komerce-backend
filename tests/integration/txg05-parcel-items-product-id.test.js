/**
 * @test-kind integration
 * @test-runner jest
 * @test-requires postgres
 */
'use strict';

/**
 * #4013 / HB-09 — preuve contre PostgreSQL réel : aucun des anciens endpoints
 * ne peut écrire après la fermeture. Les anciennes preuves TXG de mutation
 * sont remplacées : le writer canonique est désormais Hub physique/auto-parcel.
 */
const express = require('express');
const request = require('supertest');
const { Pool } = require('pg');
const hasDb = Boolean(process.env.DATABASE_URL);
jest.mock('../../middleware/auth', () => ({
  authenticate: (req, _res, next) => {
    req.user = { id: '00000000-0000-4000-8000-000000000097', role: 'agent_hub' };
    next();
  },
  requireRole: () => (_req, _res, next) => next(),
}));

const routes = ["/orders/00000000-0000-4000-8000-000000000099/create-parcel","/parcels/00000000-0000-4000-8000-000000000098/add-item","/parcels/00000000-0000-4000-8000-000000000098/remove-item"];
const run = hasDb ? describe : describe.skip;

run('HB-09 — writer Hub historique ferme (preuve PG)', () => {
  const pool = hasDb ? new Pool({ connectionString: process.env.DATABASE_URL }) : null;
  const app = express();
  app.use(express.json());
  app.use('/api/hub-dash', require('../../routes/hub-dashboard'));
  afterAll(async () => { if (pool) await pool.end(); });

  test.each(routes)('POST %s — 410 et zéro mutation parcel_items', async (endpoint) => {
    // Identifiant inexistant mais stable : toute création illégitime serait visible.
    const orderItemId = '00000000-0000-4000-8000-000000000099';
    const before = await pool.query(
      'SELECT COUNT(*)::int AS n FROM parcel_items WHERE order_item_id = $1',
      [orderItemId]
    );
    const response = await request(app).post('/api/hub-dash' + endpoint)
      .send({ order_item_id: orderItemId, quantity: 1, item_ids: [orderItemId] });
    const after = await pool.query(
      'SELECT COUNT(*)::int AS n FROM parcel_items WHERE order_item_id = $1',
      [orderItemId]
    );
    expect(response.status).toBe(410);
    expect(response.body.code).toBe('HUB_LEGACY_WRITER_CLOSED');
    expect(after.rows[0].n).toBe(before.rows[0].n);
  });
});
