/**
 * KOMERCE — Seeds & fix data
 */

'use strict';

const db = require('../db');

async function seedAdmin() {
  try {
    const existing = await db.query("SELECT id FROM users WHERE email = 'admin@komerce.km'");
    if (existing.rows.length > 0) {
      console.log('[seed] Admin already exists, skipping');
      return;
    }
    console.log('[seed] Admin not found — use /api/auth/register or admin-reset');
  } catch (err) {
    console.error('[seed] Admin check error:', err.message);
  }
}

async function seedProducts() {
  try {
    const count = await db.query("SELECT COUNT(*)::int AS c FROM products");
    if (count.rows[0].c >= 250) {
      console.log('[seed] Products already seeded (' + count.rows[0].c + '), skipping');
      return;
    }
    if (count.rows[0].c > 0) {
      console.log('[seed] Products partial (' + count.rows[0].c + '), skipping (fix manually)');
      return;
    }
    console.log('[seed] No products found — run manual seed if needed');
  } catch (err) {
    console.error('[seed] Products check error:', err.message);
  }
}

/**
 * runAllSeeds — appelé par server.js au démarrage (background)
 * Exécute toutes les vérifications seed dans l'ordre.
 */
async function runAllSeeds() {
  await seedAdmin();
  await seedProducts();
  console.log('[seed] ✅ All seeds completed');
}

module.exports = { seedAdmin, seedProducts, runAllSeeds };
