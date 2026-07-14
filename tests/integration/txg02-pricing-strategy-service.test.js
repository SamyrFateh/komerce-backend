'use strict';
/**
 * TXG-02 — RED-avant / GREEN-après (REAL_DB_INTEGRATION)
 * Cible: services/pricing-strategy-service.js — applyStrategy() (~l.386-395)
 *
 * Mécanisme: l'INSERT price_history best-effort échoue (table absente,
 * simulée par rename) => sans SAVEPOINT le client devient "aborted", le
 * prochain INSERT (pricing_strategy_history) échoue à son tour et
 * l'exception remonte au catch global qui fait ROLLBACK => l'UPDATE
 * products.price_kmf pourtant légitime est perdu et l'appel entier échoue
 * pour une cause non liée (table optionnelle manquante).
 *
 * RED-avant : applyStrategy() rejette (Error) et products.price_kmf
 *             n'est PAS mis à jour, alors que la stratégie elle-même
 *             était valide.
 * GREEN-après : applyStrategy() résout ok:true, products.price_kmf EST
 *               mis à jour, pricing_strategy_history reçoit l'entrée,
 *               price_history est simplement sauté (loggué best-effort).
 */
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const TARGET = path.join(__dirname, '../../services/pricing-strategy-service.js');
const BASELINE = fs.readFileSync('/home/claude/baseline/pricing-strategy-service.js', 'utf8');
const FIXED = fs.readFileSync('/home/claude/fixed/pricing-strategy-service.js', 'utf8');

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

async function resetProductPrice() {
  await pool.query('UPDATE products SET price_kmf = 10000 WHERE id = $1', [PRODUCT_ID]);
  // is_active strategy cleanup so unique partial indexes don't collide across runs
  await pool.query('UPDATE pricing_strategies SET is_active = FALSE WHERE product_id = $1', [PRODUCT_ID]);
}

beforeAll(async () => {
  await resetProductPrice();
});

afterAll(async () => {
  await pool.end();
});

describe('TXG-02 — applyStrategy price_history SAVEPOINT', () => {
  test('RED-avant: fix absent -> price_history KO fait échouer applyStrategy et perd l\'UPDATE prix', async () => {
    fs.writeFileSync(TARGET, BASELINE);
    await resetProductPrice();
    const svc = loadService();
    await hidePriceHistory();
    try {
      await expect(svc.applyStrategy(
        require('../../db'),
        { product_id: PRODUCT_ID, strategy_type: 'manual', final_price_kmf: 12345, reason: 'red proof' },
        USER_ID
      )).rejects.toThrow();

      const { rows: [row] } = await pool.query('SELECT price_kmf FROM products WHERE id = $1', [PRODUCT_ID]);
      expect(row.price_kmf).not.toBe(12345); // <- update perdu, transaction totalement rollback
    } finally {
      await restorePriceHistory();
    }
  });

  test('GREEN-après: fix present -> UPDATE prix persiste malgré price_history indisponible', async () => {
    fs.writeFileSync(TARGET, FIXED);
    await resetProductPrice();
    const svc = loadService();
    await hidePriceHistory();
    try {
      const result = await svc.applyStrategy(
        require('../../db'),
        { product_id: PRODUCT_ID, strategy_type: 'manual', final_price_kmf: 54321, reason: 'green proof' },
        USER_ID
      );

      expect(result.ok).toBe(true);

      const { rows: [row] } = await pool.query('SELECT price_kmf FROM products WHERE id = $1', [PRODUCT_ID]);
      expect(row.price_kmf).toBe(54321); // <- persisté malgré price_history indisponible

      const { rows: histRows } = await pool.query(
        'SELECT new_price_kmf FROM pricing_strategy_history WHERE product_id = $1 ORDER BY applied_at DESC LIMIT 1',
        [PRODUCT_ID]
      );
      expect(histRows[0].new_price_kmf).toBe(54321); // <- historique stratégie toujours écrit
    } finally {
      await restorePriceHistory();
      fs.writeFileSync(TARGET, FIXED); // leave repo in fixed state
    }
  });
});
