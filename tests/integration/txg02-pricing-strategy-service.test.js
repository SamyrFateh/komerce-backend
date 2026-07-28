'use strict';
/**
 * TXG-02 — preuve de régression SAVEPOINT (REAL_DB_INTEGRATION)
 * Cible: services/pricing-strategy-service.js — applyStrategy() (~l.386-395)
 *
 * Mécanisme: l'INSERT price_history best-effort échoue (table absente,
 * simulée par rename) => sans SAVEPOINT le client devient "aborted", le
 * prochain INSERT (pricing_strategy_history) échoue à son tour et
 * l'exception remonte au catch global qui fait ROLLBACK => l'UPDATE
 * products.price_kmf pourtant légitime est perdu et l'appel entier échoue
 * pour une cause non liée (table optionnelle manquante).
 *
 * GREEN : applyStrategy() résout ok:true, products.price_kmf EST
 *         mis à jour, pricing_strategy_history reçoit l'entrée,
 *         price_history est simplement sauté (loggué best-effort).
 *
 * 2026-07 : le volet RED-avant (comparaison contre un BASELINE pré-fix)
 * a été retiré — dépendait de fichiers sandbox /home/claude/baseline/ et
 * /home/claude/fixed/ jamais commités, et réécrivait le fichier service réel
 * sur disque pendant les tests. Le fix SAVEPOINT (sp_price_history) est
 * permanent dans services/pricing-strategy-service.js ; ce test vérifie
 * désormais le comportement GREEN contre le fichier tel que commité, sans
 * jamais l'écrire.
 */
const path = require('path');
const { Pool } = require('pg');

const TARGET = path.join(__dirname, '../../services/pricing-strategy-service.js');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const PRODUCT_ID = '00000000-0000-0000-0000-0000000002b1';
const USER_ID = '00000000-0000-0000-0000-000000000201';

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

async function seedStrategyFixtures() {
  // Le snapshot CI ne contient aucune donnée. La preuve doit donc créer le
  // produit et l'utilisateur référencé par les FK applied_by avant d'appeler
  // le vrai service.
  await pool.query(`
    INSERT INTO users (id, full_name, email, role)
    VALUES ($1, 'Admin TXG-02', 'txg02-admin@komerce.test', 'admin')
    ON CONFLICT (id) DO UPDATE
      SET full_name = EXCLUDED.full_name,
          email = EXCLUDED.email,
          role = EXCLUDED.role
  `, [USER_ID]);
  await pool.query(`
    INSERT INTO products (id, name, price_kmf)
    VALUES ($1, 'Produit Test TXG-02', 10000)
    ON CONFLICT (id) DO UPDATE
      SET name = EXCLUDED.name,
          price_kmf = EXCLUDED.price_kmf
  `, [PRODUCT_ID]);
  await pool.query(
    "DELETE FROM pricing_strategy_history WHERE product_id = $1 AND reason = 'green proof'",
    [PRODUCT_ID]
  );
  await pool.query(
    "DELETE FROM pricing_strategies WHERE product_id = $1 AND notes = 'green proof'",
    [PRODUCT_ID]
  );
  // is_active strategy cleanup so unique partial indexes don't collide across runs
  await pool.query('UPDATE pricing_strategies SET is_active = FALSE WHERE product_id = $1', [PRODUCT_ID]);
}

async function cleanupStrategyFixtures() {
  await pool.query(
    "DELETE FROM pricing_strategy_history WHERE product_id = $1 AND reason = 'green proof'",
    [PRODUCT_ID]
  );
  await pool.query(
    "DELETE FROM pricing_strategies WHERE product_id = $1 AND notes = 'green proof'",
    [PRODUCT_ID]
  );
  await pool.query('DELETE FROM products WHERE id = $1', [PRODUCT_ID]);
  await pool.query('DELETE FROM users WHERE id = $1', [USER_ID]);
}

beforeAll(seedStrategyFixtures);

afterAll(async () => {
  await cleanupStrategyFixtures();
  await pool.end();
});

describe('TXG-02 — applyStrategy price_history SAVEPOINT', () => {
  test('GREEN: UPDATE prix persiste malgré price_history indisponible', async () => {
    await seedStrategyFixtures();
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
    }
  });
});
