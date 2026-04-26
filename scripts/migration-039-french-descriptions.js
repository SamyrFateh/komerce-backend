/**
 * Migration 039 — Update product descriptions to French
 *
 * - Reads description_fr from seed-products-v2.json
 * - Updates description column for matching active products
 * - Idempotent: checks marker before running
 *
 * 🔧 FIX 2026-04-26 : marker price_kmf 0 → 1
 *   Contrainte CHECK chk_products_price (price_kmf > 0) ajoutée en prod
 *   refusait l'insertion du marker. Le marker reste invisible côté front
 *   (is_active=FALSE) donc le prix n'a aucun impact métier.
 *
 * Note : signature inchangée (pas d'argument db) car server.js appelle
 * `await migration039()` sans argument. On garde le `require` interne.
 */

const db = require('../db');
const fs = require('fs');
const path = require('path');

module.exports = async function migration039() {
  const done = await db.query("SELECT 1 FROM products WHERE name = 'migration_039_done' LIMIT 1");
  if (done.rows.length) { console.log('[Migration 039] already applied'); return; }

  console.log('[Migration 039] Updating descriptions to French...');
  const seed = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'db', 'seed-products-v2.json'), 'utf8'));

  let updated = 0;
  for (const p of seed) {
    if (!p.description_fr) continue;
    const res = await db.query(
      "UPDATE products SET description = $1 WHERE name = $2 AND is_active = TRUE",
      [p.description_fr, p.name]
    );
    if (res.rowCount > 0) updated++;
  }

  // 🔧 FIX 2026-04-26 : price_kmf=1 (et non 0) pour respecter chk_products_price.
  // is_active=FALSE pour que le marker n'apparaisse jamais dans le catalogue.
  await db.query(
    "INSERT INTO products (name, price_kmf, category, is_active) VALUES ('migration_039_done', 1, 'system', FALSE)"
  );
  console.log('[Migration 039] ' + updated + ' descriptions updated to French');
};
