#!/usr/bin/env node
/**
 * @komerce-arch
 * @role          staging-showcase-v2-refinery-seed
 * @domain        catalog
 * @layer         script
 * @criticality   high
 * @inputs        canonical_cloudinary_manifest_v2, railway_staging
 * @outputs       500 cumulative products, canonical media, axes, SKU, approvals
 * @depends       db.js, scripts/showcase-v2-plan.js, services/catalog-promotion.js, services/product-admin-service.js, services/catalog-approval.js
 * @used-by       showcase v2 staging deploy
 * @db-read       products, product_skus, product_variants
 * @db-write      products, catalog_media, product_variants, product_skus, product_sku_media, product_content_profile, product_content_sections, product_attributes
 * @db-txn        yes (one product per transaction, idempotent resume)
 * @doctrine      docs/doctrine/DOCTRINE_CATALOGUE.md, docs/doctrine/DOCTRINE_PRODUCT_DETAIL_CONTRACT.md
 * @version       2026-08-v1
 */
'use strict';

const fs = require('fs');
const path = require('path');
const db = require('../db');
const { buildSlots, buildV2Contract, TAXONOMY_TARGETS } = require('./showcase-v2-plan');
const { roundKmf, stableInt, normalizeImages, isCanonicalCloudinaryUpload } = require('./showcase-catalog');
const { validateForPromotion, promoteCatalog } = require('../services/catalog-promotion');
const { upsertProductSku, auditProductSkuReadiness } = require('../services/product-admin-service');
const { approveProduct } = require('../services/catalog-approval');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_MANIFEST = path.join(ROOT, 'data', 'catalogue-test-raw', 'showcase-catalog-v2.json');
const TARGET = 500;

function parseArgs(argv) {
  const out = { target: TARGET, manifest: DEFAULT_MANIFEST };
  for (let i = 0; i < argv.length; i += 1) {
    const [key, inline] = argv[i].split('=', 2);
    const next = () => inline ?? argv[++i];
    if (key === '--target') out.target = Number.parseInt(next(), 10);
    else if (key === '--manifest') out.manifest = path.resolve(next());
    else throw new Error(`Argument inconnu: ${argv[i]}`);
  }
  if (out.target !== TARGET) throw new Error('--target doit être exactement 500 pour Showcase V2');
  return out;
}

function assertStaging() {
  if (process.env.NODE_ENV === 'production' || process.env.KOMERCE_ENV === 'production') {
    throw new Error('REFUS: Showcase V2 interdit en production');
  }
  if (process.env.KOMERCE_ALLOW_SHOWCASE_SEED !== '1') {
    throw new Error('KOMERCE_ALLOW_SHOWCASE_SEED=1 requis');
  }
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL requis');
}

function validateManifest(products) {
  if (!Array.isArray(products) || products.length !== TARGET) {
    throw new Error(`Manifest V2 invalide: ${Array.isArray(products) ? products.length : 'non-array'}/${TARGET}`);
  }
  const refs = new Set();
  const heroes = new Set();
  for (const product of products) {
    if (!/^SHOWCASE-V2-\d{4}$/.test(product.product_ref || '')) throw new Error(`Référence V2 invalide: ${product.product_ref}`);
    if (refs.has(product.product_ref)) throw new Error(`Référence V2 dupliquée: ${product.product_ref}`);
    refs.add(product.product_ref);
    const images = normalizeImages(product);
    if (!images.length || images.some((url) => !isCanonicalCloudinaryUpload(url))) {
      throw new Error(`Média non canonique Cloudinary: ${product.product_ref}`);
    }
    if (heroes.has(product.image_url)) throw new Error(`Hero dupliqué: ${product.image_url}`);
    heroes.add(product.image_url);
  }
}

async function assertV1Foundation() {
  const { rows: [row] } = await db.query(
    `SELECT COUNT(*)::int AS count
       FROM products
      WHERE is_active=TRUE AND product_ref LIKE 'SHOWCASE-V1-%'`
  );
  if (row.count !== 500) {
    throw new Error(`Précondition V2 refusée: attendu 500 SHOWCASE-V1 actifs, obtenu ${row.count}`);
  }
}

async function upsertParent(client, product, slot, contract) {
  const images = normalizeImages(product);
  const stock = Math.max(1, Number(contract.stock_available || product.stock || 1));
  const { rows: [row] } = await client.query(
    `INSERT INTO products (
       product_ref, name, description, category, subcategory,
       price_kmf, promo_pct, is_promo, image_url, images, stock,
       inventory_model, has_variants, is_active, is_available,
       lifecycle_status, quality_validated,
       name_source, description_source, source_locale, content_source, sort_order
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,
       'LEGACY_VARIANTS',$12,FALSE,FALSE,
       'candidate',FALSE,
       $13,$14,$15,'connector_raw',$16
     )
     ON CONFLICT (product_ref) DO UPDATE SET
       name=EXCLUDED.name,
       description=EXCLUDED.description,
       category=EXCLUDED.category,
       subcategory=EXCLUDED.subcategory,
       price_kmf=EXCLUDED.price_kmf,
       promo_pct=EXCLUDED.promo_pct,
       is_promo=EXCLUDED.is_promo,
       image_url=EXCLUDED.image_url,
       images=EXCLUDED.images,
       stock=EXCLUDED.stock,
       has_variants=EXCLUDED.has_variants,
       name_source=EXCLUDED.name_source,
       description_source=EXCLUDED.description_source,
       source_locale=EXCLUDED.source_locale,
       sort_order=EXCLUDED.sort_order,
       updated_at=NOW()
     RETURNING *`,
    [
      product.product_ref,
      product.name,
      product.description || product.name,
      slot.category,
      slot.subcategory,
      product.price_kmf,
      product.promo_pct || null,
      Number(product.promo_pct || 0) > 0,
      product.image_url,
      JSON.stringify(images),
      stock,
      slot.rich,
      product.name,
      product.description || product.name,
      product.source_locale || 'en',
      product.sort_order || slot.globalIndex + 500,
    ],
  );
  return row;
}

async function applyCommercialSkus(client, product, contract) {
  for (let index = 0; index < contract.sellable_units.length; index += 1) {
    const unit = contract.sellable_units[index];
    const deltaPct = stableInt(`${unit.supplier_sku}:sale-delta`, -5, 8);
    const price = roundKmf(Number(product.price_kmf) * (1 + deltaPct / 100));
    await upsertProductSku(client, product.id, {
      variant_combo: unit.option_values,
      sku: `${product.product_ref}-SKU-${String(index + 1).padStart(2, '0')}`,
      stock: Number(unit.stock_available || 0),
      price_kmf: price,
      is_active: unit.is_active !== false,
    });
  }

  const audit = await auditProductSkuReadiness(client, product.id);
  if (!audit.ready && !audit.already_sku) {
    throw new Error(`SKU readiness ${product.product_ref}: ${audit.reasons.join(' ; ')}`);
  }
  await client.query(
    `UPDATE products SET inventory_model='SKU', updated_at=NOW() WHERE id=$1`,
    [product.id],
  );
}

async function processProduct(product, slot) {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    const contract = buildV2Contract(product, slot);
    validateForPromotion(contract);

    const parent = await upsertParent(client, product, slot, contract);
    await promoteCatalog(client, {
      productId: parent.id,
      normalizedSourceContract: contract,
    });

    if (slot.rich) await applyCommercialSkus(client, parent, contract);

    if (!parent.is_active || parent.lifecycle_status === 'candidate') {
      const approval = await approveProduct(client, parent.id, { id: 'showcase-v2' });
      if (approval.status !== 200 && approval.status !== 409) {
        throw new Error(`Approbation ${product.product_ref}: HTTP ${approval.status} ${approval.body?.error || ''}`);
      }
    }

    await client.query(
      `UPDATE products
          SET is_available=TRUE,
              quality_validated=TRUE,
              lifecycle_status='active',
              updated_at=NOW()
        WHERE id=$1 AND is_active=TRUE`,
      [parent.id],
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function postSeedAudit() {
  const { rows: [totals] } = await db.query(
    `SELECT
       COUNT(*) FILTER (WHERE is_active AND product_ref LIKE 'SHOWCASE-V1-%')::int AS v1,
       COUNT(*) FILTER (WHERE is_active AND product_ref LIKE 'SHOWCASE-V2-%')::int AS v2,
       COUNT(*) FILTER (WHERE is_active AND product_ref LIKE 'SHOWCASE-V2-%' AND inventory_model='SKU')::int AS sku_products,
       COUNT(*) FILTER (WHERE is_active AND product_ref LIKE 'SHOWCASE-V2-%' AND COALESCE(promo_pct,0)>0)::int AS promo_products
     FROM products`
  );

  const { rows: distribution } = await db.query(
    `SELECT category, subcategory, COUNT(*)::int AS count
       FROM products
      WHERE is_active=TRUE AND product_ref LIKE 'SHOWCASE-V2-%'
      GROUP BY category, subcategory
      ORDER BY category, subcategory`
  );
  const actual = new Map(distribution.map((row) => [`${row.category}/${row.subcategory}`, row.count]));
  for (const target of TAXONOMY_TARGETS) {
    const key = `${target.category}/${target.subcategory}`;
    if (actual.get(key) !== target.count) {
      throw new Error(`Couverture taxonomie ${key}: attendu ${target.count}, obtenu ${actual.get(key) || 0}`);
    }
  }

  const { rows: [skuStats] } = await db.query(
    `SELECT COUNT(*)::int AS active_skus,
            COUNT(*) FILTER (WHERE ps.stock=0)::int AS out_of_stock_skus
       FROM product_skus ps
       JOIN products p ON p.id=ps.product_id
      WHERE p.is_active=TRUE AND p.product_ref LIKE 'SHOWCASE-V2-%' AND ps.is_active=TRUE`
  );

  if (totals.v1 !== 500 || totals.v2 !== 500 || totals.sku_products !== 350) {
    throw new Error(`Post-seed mismatch: ${JSON.stringify({ ...totals, ...skuStats })}`);
  }
  if (skuStats.active_skus < 900 || skuStats.out_of_stock_skus < 25) {
    throw new Error(`Population SKU insuffisante: ${JSON.stringify(skuStats)}`);
  }

  console.log(JSON.stringify({
    active_showcase: totals.v1 + totals.v2,
    v1: totals.v1,
    v2: totals.v2,
    sku_products: totals.sku_products,
    active_skus: skuStats.active_skus,
    out_of_stock_skus: skuStats.out_of_stock_skus,
    promo_products: totals.promo_products,
    taxonomy_rows: distribution.length,
  }, null, 2));
}

async function seed(options) {
  assertStaging();
  if (!fs.existsSync(options.manifest)) throw new Error(`Manifest absent: ${options.manifest}`);
  const products = JSON.parse(fs.readFileSync(options.manifest, 'utf8'));
  validateManifest(products);
  await assertV1Foundation();

  const slots = buildSlots();
  for (let index = 0; index < products.length; index += 1) {
    const product = products[index];
    const slot = slots[index];
    if (product.product_ref !== slot.product_ref || product.category !== slot.category || product.subcategory !== slot.subcategory) {
      throw new Error(`Manifest/plan divergent à ${index}: ${product.product_ref}`);
    }
    await processProduct(product, slot);
    if ((index + 1) % 25 === 0) console.log(`[showcase-v2-seed] ${index + 1}/${TARGET}`);
  }
  await postSeedAudit();
  console.log('[showcase-v2-seed] ✅ campagne V2 committée et auditée');
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  await seed(options);
  await db.pool.end();
}

if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch(async (error) => {
      console.error('[showcase-v2-seed] échec:', error.message);
      await db.pool.end().catch(() => {});
      process.exit(1);
    });
}

module.exports = {
  parseArgs,
  validateManifest,
};
