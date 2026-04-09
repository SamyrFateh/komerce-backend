/**
 * KOMERCE — Seeds & fix data
 */

'use strict';

const db = require('../db');
const bcrypt = require('bcrypt');

async function seedAdmin() {
  try {
    const existing = await db.query("SELECT id FROM users WHERE email = 'admin@komerce.km'");
    if (existing.rows.length > 0) {
      console.log('[seed] Admin already exists, skipping');
      return;
    }
    const hash = await bcrypt.hash('admin123', 10);
    await db.query(
      "INSERT INTO users (email, password, role) VALUES ('admin@komerce.km', $1, 'admin')",
      [hash]
    );
    console.log('[seed] Admin created');
  } catch (err) {
    if (err.code === '23505') console.log('[seed] Admin already exists');
    else console.error('[seed] Admin error:', err.message);
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
