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
    // Admin creation needs auth route — skip here
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

async function fixProductImages() {
  console.log('[seed] fixProductImages disabled — Cloudinary migration active');
}

module.exports = { seedAdmin, seedProducts, fixProductImages };
