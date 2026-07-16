/**
 * @komerce-arch
 * @role          golden-product-seed
 * @domain        catalog
 * @layer         script
 * @criticality   low
 * @inputs        none
 * @outputs       products, product_variants, product_skus rows (Golden Product)
 * @depends       db.js, tests/fixtures/catalog/golden-elite-pro.js
 * @used-by       chantier GPM (modal mobile enrichie), futur chantier Raffinerie E2E
 * @db-read       products, product_variants, product_skus
 * @db-write      products, product_variants, product_skus
 * @db-txn        yes (BEGIN/COMMIT)
 * @doctrine      docs/chantier/PDC4_MOBILE_MODAL.md, migrations/104_product_skus.sql,
 *                migrations/101_variant_images.sql, migrations/081_product_ref.sql
 * @version       2026-07
 *
 * NON EXÉCUTÉ dans l'environnement où ce script a été écrit (pas de
 * PostgreSQL disponible). Écrit pour être lancé avec :
 *
 *   node scripts/seed-golden-product.js
 *
 * contre une base réelle (DATABASE_URL). Idempotent : peut être rejoué sans
 * dupliquer de lignes — s'appuie sur les mêmes contraintes d'unicité que le
 * reste du schéma (products.product_ref UNIQUE, product_variants
 * (product_id, variant_type, variant_value) UNIQUE, product_skus
 * (product_id, variant_combo) UNIQUE partiel — cf. migrations 081, patch_variants,
 * 104_product_skus).
 *
 * N'utilise aucune table, route ou service inventé : uniquement les mêmes
 * tables que tests/integration/test-harness/seed-helpers.EXTENDED.js
 * (createSkuProduct) et que services/catalog-product-detail.js lit.
 */

'use strict';

const db = require('../db');
const fixture = require('../tests/fixtures/catalog/golden-elite-pro');

async function upsertProduct(client) {
  const p = fixture.productRow();
  const { rows: [product] } = await client.query(
    `INSERT INTO products
       (id, product_ref, name, description, category, subcategory,
        price_kmf, price_eur, promo_pct, image_url, images,
        stock, inventory_model, has_variants, is_active)
     VALUES
       ($1, $2, $3, $4, $5, $6,
        $7, $8, $9, $10, $11::jsonb,
        0, 'SKU', true, true)
     ON CONFLICT (product_ref) DO UPDATE SET
       name         = EXCLUDED.name,
       description  = EXCLUDED.description,
       category     = EXCLUDED.category,
       subcategory  = EXCLUDED.subcategory,
       price_kmf    = EXCLUDED.price_kmf,
       promo_pct    = EXCLUDED.promo_pct,
       image_url    = EXCLUDED.image_url,
       images       = EXCLUDED.images,
       inventory_model = 'SKU',
       has_variants = true,
       is_active    = true,
       updated_at   = now()
     RETURNING *`,
    [
      p.id,
      p.product_ref,
      p.name,
      p.description,
      p.category,
      p.subcategory,
      p.price_kmf,
      // price_eur : pas de taux officiel porté par ce fixture, laissé à 0
      // plutôt que de fabriquer un taux de change fictif.
      0,
      p.promo_pct,
      p.image_url,
      JSON.stringify(p.images),
    ]
  );
  return product;
}

async function upsertVariants(client, productId) {
  const rows = [];
  for (const v of fixture.variantRows()) {
    const { rows: [row] } = await client.query(
      `INSERT INTO product_variants
         (product_id, variant_type, variant_value, image_url, images, display_order, stock)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, 0)
       ON CONFLICT (product_id, variant_type, variant_value) DO UPDATE SET
         image_url     = EXCLUDED.image_url,
         images        = EXCLUDED.images,
         display_order = EXCLUDED.display_order,
         updated_at    = now()
       RETURNING *`,
      [productId, v.variant_type, v.variant_value, v.image_url, JSON.stringify(v.images), v.display_order]
    );
    rows.push(row);
  }
  return rows;
}

async function upsertSkus(client, productId) {
  const rows = [];
  for (const s of fixture.skuRows()) {
    const { rows: [row] } = await client.query(
      `INSERT INTO product_skus
         (id, product_id, sku, variant_combo, stock, price_kmf, is_active)
       VALUES ($1, $2, $3, $4::jsonb, $5, $6, true)
       ON CONFLICT (product_id, variant_combo) DO UPDATE SET
         sku        = EXCLUDED.sku,
         stock      = EXCLUDED.stock,
         price_kmf  = EXCLUDED.price_kmf,
         is_active  = true,
         updated_at = now()
       RETURNING *`,
      [s.id, productId, s.sku, JSON.stringify(s.variant_combo), s.stock, s.price_kmf]
    );
    rows.push(row);
  }
  return rows;
}

async function seedGoldenProduct() {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    const product = await upsertProduct(client);
    const variants = await upsertVariants(client, product.id);
    const skus = await upsertSkus(client, product.id);
    await client.query('COMMIT');
    return { product, variants, skus };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function main() {
  const result = await seedGoldenProduct();
  // eslint-disable-next-line no-console
  console.log(JSON.stringify({
    product_id: result.product.id,
    product_ref: result.product.product_ref,
    variants: result.variants.length,
    skus: result.skus.length,
  }, null, 2));
  process.exit(0);
}

if (require.main === module) {
  main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error('[seed-golden-product] échec :', err);
    process.exit(1);
  });
}

module.exports = { seedGoldenProduct };
