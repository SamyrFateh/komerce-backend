#!/usr/bin/env node
/**
 * @komerce-arch
 * @role          cj-real-showcase-taxonomy-repair
 * @domain        catalog
 * @layer         script
 * @criticality   high
 * @inputs        DATABASE_URL, KOMERCE_ALLOW_CJ_SHOWCASE_SEED
 * @outputs       canonical category/subcategory for the deterministic 63-product CJ showcase
 * @depends       db.js, services/product-admin-service.js, scripts/cj-real-showcase-seed.js
 * @used-by       one-shot Railway operator run
 * @db-read       products, boutique_categories, boutique_subcategories
 * @db-write-via:product-admin-service products, catalog_field_overrides
 * @db-txn        product-admin-service owns mutations
 * @doctrine      docs/doctrine/DOCTRINE_CATALOGUE.md
 * @impact-areas  catalog, product-discovery, category-navigation
 * @version       2026-09-v1
 */
'use strict';

const db = require('../db');
const productAdmin = require('../services/product-admin-service');
const {
  FAMILIES,
  TARGET,
  TARGET_PER_FAMILY,
  SORT_BASE,
  slotSortOrder,
} = require('./cj-real-showcase-seed');

const SUPPLIER_NAME = 'CJdropshipping';
const ACTOR = Object.freeze({ id: null });

const TAXONOMY_BY_FAMILY = Object.freeze({
  women:      Object.freeze({ category: 'Mode & Beauté', subcategory: 'Femme' }),
  men:        Object.freeze({ category: 'Mode & Beauté', subcategory: 'Homme' }),
  kids:       Object.freeze({ category: 'Mode & Beauté', subcategory: 'Enfant' }),
  beauty:     Object.freeze({ category: 'Mode & Beauté', subcategory: 'Beauté' }),
  comfort:    Object.freeze({ category: 'Maison', subcategory: 'Confort' }),
  kitchen:    Object.freeze({ category: 'Maison', subcategory: 'Cuisine' }),
  decor:      Object.freeze({ category: 'Maison', subcategory: 'Déco' }),
  'kids-home': Object.freeze({ category: 'Maison', subcategory: 'Enfants' }),
  phones:     Object.freeze({ category: 'Tech', subcategory: 'Phones' }),
  audio:      Object.freeze({ category: 'Tech', subcategory: 'Audio' }),
  watches:    Object.freeze({ category: 'Tech', subcategory: 'Montres' }),
  tools:      Object.freeze({ category: 'Bricolage', subcategory: 'Outillage' }),
  electric:   Object.freeze({ category: 'Bricolage', subcategory: 'Electricité' }),
  security:   Object.freeze({ category: 'Bricolage', subcategory: 'Sécurité' }),
  ceremony:   Object.freeze({ category: 'Créations personnelles', subcategory: 'Cérémonie' }),
  gift:       Object.freeze({ category: 'Créations personnelles', subcategory: 'Cadeau' }),
  printing:   Object.freeze({ category: 'Créations personnelles', subcategory: 'Impression' }),
  filters:    Object.freeze({ category: 'Auto', subcategory: 'Filtres' }),
  brakes:     Object.freeze({ category: 'Auto', subcategory: 'Freinage' }),
  'car-light': Object.freeze({ category: 'Auto', subcategory: 'Éclairage' }),
  moto:       Object.freeze({ category: 'Auto', subcategory: 'Moto' }),
});

function taxonomyForFamily(family) {
  const key = typeof family === 'string' ? family : family?.key;
  return TAXONOMY_BY_FAMILY[key] || null;
}

function assertPlan() {
  if (process.env.KOMERCE_ALLOW_CJ_SHOWCASE_SEED !== '1') {
    throw new Error('KOMERCE_ALLOW_CJ_SHOWCASE_SEED=1 requis');
  }
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL requis');
  if (FAMILIES.length * TARGET_PER_FAMILY !== TARGET) {
    throw new Error(`Plan CJ invalide: ${FAMILIES.length} x ${TARGET_PER_FAMILY} != ${TARGET}`);
  }
  for (const family of FAMILIES) {
    if (!taxonomyForFamily(family)) throw new Error(`Taxonomie CJ manquante: ${family.key}`);
  }
}

async function loadSlot(sortOrder) {
  const { rows: [row] } = await db.query(
    `SELECT id, product_ref, name, category, subcategory, is_active, is_available
       FROM products
      WHERE sourcing_source = $1
        AND sort_order = $2
      LIMIT 1`,
    [SUPPLIER_NAME, sortOrder]
  );
  return row || null;
}

async function repairSlot(family, familyIndex, slotIndex) {
  const sortOrder = slotSortOrder(familyIndex, slotIndex);
  const product = await loadSlot(sortOrder);
  if (!product) throw new Error(`Slot CJ introuvable: ${family.key}/${slotIndex} sort_order=${sortOrder}`);

  const taxonomy = taxonomyForFamily(family);
  if (product.category === taxonomy.category && product.subcategory === taxonomy.subcategory) {
    return { product_id: product.id, changed: false, ...taxonomy };
  }

  const result = await productAdmin.updateProduct(db, product.id, taxonomy, ACTOR);
  if (result.status !== 200) {
    throw new Error(`Taxonomie refusée ${family.key}/${slotIndex}: ${JSON.stringify(result.body).slice(0, 600)}`);
  }

  return { product_id: product.id, changed: true, ...taxonomy };
}

async function postAudit() {
  const { rows: [row] } = await db.query(
    `SELECT COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE category IS NOT NULL AND category <> 'autre')::int AS categorized,
            COUNT(*) FILTER (WHERE subcategory IS NOT NULL AND subcategory <> '')::int AS subcategorized,
            COUNT(*) FILTER (WHERE is_active = TRUE AND is_available = TRUE)::int AS exposed
       FROM products
      WHERE sourcing_source = $1
        AND sort_order BETWEEN $2 AND $3`,
    [SUPPLIER_NAME, SORT_BASE, SORT_BASE + TARGET - 1]
  );

  if (row.total !== TARGET || row.categorized !== TARGET || row.subcategorized !== TARGET || row.exposed !== TARGET) {
    throw new Error(`Audit taxonomie CJ refusé: ${JSON.stringify(row)}`);
  }
  return row;
}

async function main() {
  assertPlan();
  let changed = 0;
  for (let familyIndex = 0; familyIndex < FAMILIES.length; familyIndex += 1) {
    const family = FAMILIES[familyIndex];
    for (let slotIndex = 0; slotIndex < TARGET_PER_FAMILY; slotIndex += 1) {
      const result = await repairSlot(family, familyIndex, slotIndex);
      if (result.changed) changed += 1;
    }
  }
  const audit = await postAudit();
  console.log(`[cj-taxonomy-repair] SUCCESS changed=${changed}/${TARGET} audit=${JSON.stringify(audit)}`);
}

if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(`[cj-taxonomy-repair] FAILED: ${err.stack || err.message || err}`);
      process.exit(1);
    });
}

module.exports = {
  ACTOR,
  TAXONOMY_BY_FAMILY,
  taxonomyForFamily,
  assertPlan,
  loadSlot,
  repairSlot,
  postAudit,
};
