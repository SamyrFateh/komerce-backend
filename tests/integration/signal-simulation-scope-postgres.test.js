'use strict';

/**
 * @test-kind integration
 * @test-runner jest
 * @test-requires postgres
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Pool } = require('pg');
const { EXCLUDE_SIMULATED_ORDER_SIGNALS_SQL } = require('../../services/signal-simulation-scope');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
afterAll(() => pool.end());

describe('signaux de Pilotage — commandes de simulation exclues (lot 7)', () => {
  test('prédicat réel/RCT1 : seul le signal d’une commande simulée est masqué', async () => {
    const client = await pool.connect();
    const realOrder = crypto.randomUUID();
    const simOrder = crypto.randomUUID();
    try {
      await client.query('BEGIN');
      // Tables TEMP : elles masquent orders/signals le temps de la transaction (aucune écriture durable).
      await client.query('CREATE TEMP TABLE orders (id uuid, simulation_scope text) ON COMMIT DROP');
      await client.query('CREATE TEMP TABLE signals (ref text, entity_type text, entity_id text) ON COMMIT DROP');
      await client.query('INSERT INTO orders VALUES ($1, NULL), ($2, \'RCT1\')', [realOrder, simOrder]);
      await client.query(
        `INSERT INTO signals VALUES
           ('order-real', 'order', $1), ('order-sim', 'order', $2),
           ('parcel', 'parcel', $2), ('no-entity', NULL, NULL), ('order-unknown', 'order', $3)`,
        [realOrder, simOrder, crypto.randomUUID()]
      );
      const { rows } = await client.query(
        `SELECT s.ref FROM signals s WHERE ${EXCLUDE_SIMULATED_ORDER_SIGNALS_SQL} ORDER BY s.ref`
      );
      expect(rows.map(r => r.ref)).toEqual(['no-entity', 'order-real', 'order-unknown', 'parcel']);
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });

  test.each([
    ['services/dashboard-pilotage-market.js'],
    ['services/dashboard-metrics/control-tower.js'],
    ['services/dashboard-operations.js'],
    ['services/action-center-agent-scope.js'],
    ['routes/admin-dashboard.js'],
  ])('%s filtre les signaux de commandes simulées', (file) => {
    const source = fs.readFileSync(path.join(__dirname, '..', '..', file), 'utf8');
    expect(source).toMatch(/EXCLUDE_SIMULATED_ORDER_SIGNALS_SQL/);
    expect(source).toMatch(/require\('[^']*signal-simulation-scope'\)/);
  });
});
