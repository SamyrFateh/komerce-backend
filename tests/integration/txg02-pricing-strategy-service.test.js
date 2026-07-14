'use strict';
/**
 * TXG-02 — CURRENT REAL_DB REGRESSION
 * Cible: services/pricing-strategy-service.js — applyStrategy()
 *
 * Invariant courant: une panne de price_history (best-effort) ne doit pas
 * invalider la transaction métier. Le prix produit et pricing_strategy_history
 * doivent être committés grâce au SAVEPOINT.
 */
const path = require('path');
const { Pool } = require('pg');

const TARGET = path.join(__dirname, '../../services/pricing-strategy-service.js');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const PRODUCT_ID = '00000000-0000-0000-0000-0000000000b1';
const USER_ID = '00000000-0000-0000-0000-000000000001';

jest.setTimeout(30000);

function loadService() {
  jest.resetModules();
  return require(TARGET);
}

async function hidePriceHistory() {
  await pool.query('ALTER TABLE price_history RENAME TO price_history_hidden');
}

async function restorePriceHistory() {
  await pool.query('ALTER TABLE price_history_hidden RENAME TO price_history');
}

async function resetFixtures() {
  await pool.query(`
    INSERT INTO users (id, full_name, email, role)
    VALUES ($1, 'Admin TXG02', 'admin-txg02@komerce.test', 'admin')
    ON CONFLICT (id) DO NOTHING
  `, [USER_ID]);
  await pool.query(`
    INSERT INTO products (id, name, price_kmf)
    VALUES ($1, 'Produit Test TXG02', 10000)
    ON CONFLICT (id) DO UPDATE SET price_kmf = 10000
  `, [PRODUCT_ID]);
  await pool.query('UPDATE pricing_strategies SET is_active = FALSE WHERE product_id = $1', [PRODUCT_ID]);
}

beforeAll(async () => {
  await resetFixtures();
});

afterAll(async () => {
  await pool.end();
});

describe('TXG-02 — applyStrategy price_history SAVEPOINT', () => {
  test('UPDATE prix et historique stratégie persistent malgré price_history indisponible', async () => {
    await resetFixtures();
    const svc = loadService();
    await hidePriceHistory();
    try {
      const result = await svc.applyStrategy(
        require('../../db'),
        { product_id: PRODUCT_ID, strategy_type: 'manual', final_price_kmf: 54321, reason: 'real-db regression' },
        USER_ID
      );

      expect(result.ok).toBe(true);

      const { rows: [row] } = await pool.query('SELECT price_kmf FROM products WHERE id = $1', [PRODUCT_ID]);
      expect(row.price_kmf).toBe(54321);

      const { rows: histRows } = await pool.query(
        'SELECT new_price_kmf FROM pricing_strategy_history WHERE product_id = $1 ORDER BY applied_at DESC LIMIT 1',
        [PRODUCT_ID]
      );
      expect(histRows[0].new_price_kmf).toBe(54321);
    } finally {
      await restorePriceHistory();
    }
  });
});
