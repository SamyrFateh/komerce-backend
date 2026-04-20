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
  
  await db.query(
    "INSERT INTO products (name, price_kmf, category, is_active) VALUES ('migration_039_done', 0, 'system', FALSE)"
  );
  console.log('[Migration 039] ' + updated + ' descriptions updated to French');
};
