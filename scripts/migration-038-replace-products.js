/**
 * Migration 038 — Replace all products with curated catalog
 *
 * - Soft-deletes ALL existing products (is_active = FALSE)
 * - Inserts 467 new products with real images (AliExpress + DummyJSON)
 * - Idempotent: checks marker before running
 *
 * 🔧 FIX 2026-04-26 : marker price_kmf 0 → 1 (contrainte CHECK chk_products_price > 0)
 */

const path = require('path');
const fs = require('fs');

module.exports = async function migration038(db) {
  // ── Idempotency check ──
  const { rows: [marker] } = await db.query(
    `SELECT 1 FROM products WHERE name = '__M038_CATALOG_V2__' LIMIT 1`
  );
  if (marker) {
    console.log('  Migration 038: already applied — skipping');
    return;
  }

  console.log('  Migration 038: replacing product catalog...');

  // ── Load seed data ──
  const seedPath = path.join(__dirname, '..', 'db', 'seed-products-v2.json');
  const products = JSON.parse(fs.readFileSync(seedPath, 'utf8'));

  // ── Step 1: Soft-delete ALL existing active products ──
  const { rowCount: deactivated } = await db.query(
    `UPDATE products SET is_active = FALSE, is_available = FALSE, updated_at = NOW()
     WHERE is_active = TRUE`
  );
  console.log(`  Migration 038: deactivated ${deactivated} old products`);

  // ── Step 2: Insert new products in batches of 50 ──
  const BATCH = 50;
  let inserted = 0;

  for (let i = 0; i < products.length; i += BATCH) {
    const batch = products.slice(i, i + BATCH);
    const values = [];
    const placeholders = [];
    let pi = 1;

    for (const p of batch) {
      placeholders.push(
        `($${pi++}, $${pi++}, $${pi++}, $${pi++}, $${pi++}, $${pi++}, $${pi++}, TRUE, TRUE, $${pi++})`
      );
      values.push(
        p.name,
        p.description || p.name,
        p.category,
        p.subcategory || null,
        p.price_kmf,
        p.promo_pct || null,
        p.image_url,
        p.sort_order || 0
      );
    }

    await db.query(
      `INSERT INTO products (name, description, category, subcategory, price_kmf, promo_pct, image_url, is_active, is_available, sort_order)
       VALUES ${placeholders.join(', ')}`,
      values
    );
    inserted += batch.length;
  }

  // ── Step 3: Insert idempotency marker ──
  // 🔧 FIX 2026-04-26 : price_kmf = 1 (et non 0) pour respecter la contrainte
  // CHECK chk_products_price (price_kmf > 0). Le marker n'est jamais visible
  // côté front (is_active=FALSE, is_available=FALSE) donc le prix n'a aucun
  // impact métier — c'est juste un drapeau interne.
  await db.query(
    `INSERT INTO products (name, description, category, price_kmf, is_active, is_available)
     VALUES ('__M038_CATALOG_V2__', 'Migration 038 marker', 'system', 1, FALSE, FALSE)`
  );

  console.log(`  Migration 038: inserted ${inserted} new products ✅`);
};
