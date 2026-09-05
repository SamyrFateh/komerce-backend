#!/usr/bin/env node
/**
 * @komerce-arch
 * @role          cj-real-showcase-seed
 * @domain        catalog
 * @layer         script
 * @criticality   high
 * @inputs        CJ_API_KEY, DATABASE_URL, KOMERCE_ALLOW_CJ_SHOWCASE_SEED
 * @outputs       63 approved CJ-backed products with real supplier media
 * @depends       db.js, services/suppliers/catalog-import-orchestrator.js, services/sourcing-import-dispatch.js, services/sourcing-candidate-actions.js, services/catalog-approval.js, services/product-admin-service.js
 * @used-by       one-shot Railway operator run
 * @db-read       products, sourcing_candidates, supplier_catalog_imports
 * @db-write      supplier_catalog_imports, sourcing_candidates, sourcing_candidate_events, products, catalog_media, catalog_field_overrides, catalog_enrichment_runs
 * @db-txn        canonical services own their transactions
 * @doctrine      docs/doctrine/DOCTRINE_CATALOGUE.md, docs/doctrine/DOCTRINE_INGESTION_CATALOGUE.md
 * @impact-areas  catalog, product-discovery, sourcing
 * @version       2026-09-v1
 */
'use strict';

const db = require('../db');
const catalogImportOrchestrator = require('../services/suppliers/catalog-import-orchestrator');
const { dispatchToConnector } = require('../services/sourcing-import-dispatch');
const candidateActions = require('../services/sourcing-candidate-actions');
const { overrideAndApprove } = require('../services/catalog-approval');
const productAdmin = require('../services/product-admin-service');

const SUPPLIER_NAME = 'CJdropshipping';
const TARGET_PER_FAMILY = 3;
const TARGET = 63;
const SORT_BASE = -1063;
// Sourcing audit columns store actor identifiers as UUIDs. This operator run
// is not attached to a persisted admin user, so keep the actor nullable
// instead of writing a synthetic non-UUID label into updated_by/triggered_by.
const ACTOR = Object.freeze({ id: null });
const RUN_NOTE = 'CJ real showcase 63 v1 — real supplier media, manual FR preparation';

const FAMILIES = Object.freeze([
  { key: 'women', keyword: 'women dress', fr: 'Robe femme' },
  { key: 'men', keyword: 'men shirt', fr: 'Chemise homme' },
  { key: 'kids', keyword: 'kids clothing', fr: 'Tenue enfant' },
  { key: 'beauty', keyword: 'face skincare', fr: 'Soin visage' },
  { key: 'comfort', keyword: 'home slippers', fr: 'Chaussons confort' },
  { key: 'kitchen', keyword: 'kitchen blender', fr: 'Blender de cuisine' },
  { key: 'decor', keyword: 'wall decor', fr: 'Décoration murale' },
  { key: 'kids-home', keyword: 'kids room decor', fr: 'Décoration chambre enfant' },
  { key: 'phones', keyword: 'phone accessory', fr: 'Accessoire smartphone' },
  { key: 'audio', keyword: 'wireless earbuds', fr: 'Écouteurs sans fil' },
  { key: 'watches', keyword: 'smart watch', fr: 'Montre connectée' },
  { key: 'tools', keyword: 'cordless drill', fr: 'Perceuse sans fil' },
  { key: 'electric', keyword: 'led light strip', fr: 'Éclairage LED' },
  { key: 'security', keyword: 'security camera', fr: 'Caméra de sécurité' },
  { key: 'ceremony', keyword: 'wedding decoration', fr: 'Décoration de cérémonie' },
  { key: 'gift', keyword: 'gift box', fr: 'Coffret cadeau' },
  { key: 'printing', keyword: 'sublimation mug', fr: 'Mug personnalisable' },
  { key: 'filters', keyword: 'water filter', fr: 'Filtre à eau' },
  { key: 'brakes', keyword: 'brake pads', fr: 'Plaquettes de frein' },
  { key: 'car-light', keyword: 'car led bulb', fr: 'Ampoule LED automobile' },
  { key: 'moto', keyword: 'motorcycle gloves', fr: 'Gants moto' },
]);

function assertRuntime() {
  if (process.env.KOMERCE_ALLOW_CJ_SHOWCASE_SEED !== '1') {
    throw new Error('KOMERCE_ALLOW_CJ_SHOWCASE_SEED=1 requis');
  }
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL requis');
  if (!process.env.CJ_API_KEY && !process.env.CJ_ACCESS_TOKEN) {
    throw new Error('CJ_API_KEY ou CJ_ACCESS_TOKEN requis');
  }
  if (FAMILIES.length * TARGET_PER_FAMILY !== TARGET) {
    throw new Error(`Plan CJ invalide: ${FAMILIES.length} familles x ${TARGET_PER_FAMILY} != ${TARGET}`);
  }
}

function slotSortOrder(familyIndex, slotIndex) {
  return SORT_BASE + familyIndex * TARGET_PER_FAMILY + slotIndex;
}

function frenchName(family, slotIndex) {
  return `${family.fr} — modèle ${String.fromCharCode(65 + slotIndex)}`;
}

function frenchDescription(family) {
  return `${family.fr} sélectionné auprès d’un fournisseur partenaire. Visuel réel fournisseur et référence source conservés pour la traçabilité Komerce.`;
}

async function loadExistingSlot(sortOrder) {
  const { rows: [row] } = await db.query(
    `SELECT p.id, p.product_ref, p.name, p.image_url, p.is_active, p.is_available,
            sc.supplier_product_id
       FROM products p
       LEFT JOIN sourcing_candidates sc ON sc.product_id = p.id AND sc.supplier_name = $1
      WHERE p.sourcing_source = $1 AND p.sort_order = $2
      LIMIT 1`,
    [SUPPLIER_NAME, sortOrder]
  );
  return row || null;
}

async function usedSupplierIds() {
  const { rows } = await db.query(
    `SELECT DISTINCT sc.supplier_product_id
       FROM products p
       JOIN sourcing_candidates sc ON sc.product_id = p.id
      WHERE p.sourcing_source = $1
        AND p.sort_order BETWEEN $2 AND $3`,
    [SUPPLIER_NAME, SORT_BASE, SORT_BASE + TARGET - 1]
  );
  return new Set(rows.map((r) => r.supplier_product_id).filter(Boolean));
}

async function importPage(family, page) {
  const body = {
    supplier_name: SUPPLIER_NAME,
    supplier_id: 'cj',
    source_type: 'api',
    keyword: family.keyword,
    page,
    size: 5,
    notes: `${RUN_NOTE} — family=${family.key} page=${page}`,
  };
  const result = await catalogImportOrchestrator.importCatalog(body, null, dispatchToConnector);
  if (result.status !== 200) {
    throw new Error(`CJ import ${family.key}/p${page} refusé (${result.status}): ${JSON.stringify(result.body).slice(0, 800)}`);
  }
  return result.body.import_id;
}

async function loadImportCandidates(importId) {
  const { rows } = await db.query(
    `SELECT id, supplier_product_id, product_name, image_url, state, product_id,
            scan_result, normalized_source_contract
       FROM sourcing_candidates
      WHERE import_id = $1
      ORDER BY created_at ASC, supplier_product_id ASC`,
    [importId]
  );
  return rows;
}

function candidateUsable(candidate, used) {
  if (!candidate?.supplier_product_id || used.has(candidate.supplier_product_id)) return false;
  if (!candidate.image_url || !/^https:\/\//i.test(candidate.image_url)) return false;
  if (['rejected', 'quarantined', 'archived'].includes(candidate.state)) return false;
  if (candidate.scan_result?.sourcing_decision === 'EXCLUDED') return false;
  return ['scanned', 'imported_to_catalog'].includes(candidate.state);
}

async function prepareAndPublish(candidate, family, familyIndex, slotIndex) {
  let productId = candidate.product_id || null;
  if (!productId) {
    const promoted = await candidateActions.promoteCandidate(candidate.id, {}, ACTOR.id);
    productId = promoted.product_id;
  }

  const { rows: [before] } = await db.query(
    `SELECT id, lifecycle_status, is_active
       FROM products WHERE id = $1`,
    [productId]
  );
  if (!before) throw new Error(`Produit promu introuvable: ${productId}`);

  const fields = {
    name: frenchName(family, slotIndex),
    description: frenchDescription(family),
  };

  if (before.lifecycle_status === 'candidate' && before.is_active !== true) {
    const approval = await overrideAndApprove(
      db,
      productId,
      {
        fields,
        reason: `Préparation FR manuelle rapide — ${family.key}`,
      },
      ACTOR
    );
    if (approval.status !== 200) {
      throw new Error(`Approbation refusée ${candidate.supplier_product_id}: ${JSON.stringify(approval.body).slice(0, 600)}`);
    }
  } else {
    const editorial = await productAdmin.updateProduct(db, productId, fields, ACTOR);
    if (editorial.status !== 200) {
      throw new Error(`Retouche FR refusée ${candidate.supplier_product_id}: ${JSON.stringify(editorial.body).slice(0, 600)}`);
    }
  }

  // PDC public list still projects products.image_url. catalog-promotion owns
  // catalog_media, but does not rewrite the legacy public hero column. Once
  // the product is active through canonical approval, project the supplier
  // hero through product-admin-service (single product mutation authority).
  const mediaProjection = await productAdmin.setMainImage(db, productId, candidate.image_url);
  if (mediaProjection.status !== 200) {
    throw new Error(`Projection hero refusée ${candidate.supplier_product_id}: ${JSON.stringify(mediaProjection.body).slice(0, 600)}`);
  }

  const finalUpdate = await productAdmin.updateProduct(
    db,
    productId,
    {
      is_available: true,
      sort_order: slotSortOrder(familyIndex, slotIndex),
      badge: 'Nouveau',
      sourcing_source: SUPPLIER_NAME,
    },
    ACTOR
  );
  if (finalUpdate.status !== 200) {
    throw new Error(`Exposition refusée ${candidate.supplier_product_id}: ${JSON.stringify(finalUpdate.body).slice(0, 600)}`);
  }

  return {
    product_id: productId,
    product_ref: finalUpdate.body.product_ref,
    name: finalUpdate.body.name,
    image_url: finalUpdate.body.image_url,
    supplier_product_id: candidate.supplier_product_id,
  };
}

async function fillFamily(family, familyIndex, used) {
  const completed = [];
  const missingSlots = [];
  for (let slotIndex = 0; slotIndex < TARGET_PER_FAMILY; slotIndex += 1) {
    const existing = await loadExistingSlot(slotSortOrder(familyIndex, slotIndex));
    if (existing?.is_active && existing?.image_url) {
      completed.push(existing);
      if (existing.supplier_product_id) used.add(existing.supplier_product_id);
    } else {
      missingSlots.push(slotIndex);
    }
  }
  if (!missingSlots.length) return completed;

  let page = 1;
  let cursor = 0;
  while (cursor < missingSlots.length && page <= 5) {
    const importId = await importPage(family, page);
    const candidates = await loadImportCandidates(importId);
    for (const candidate of candidates) {
      if (cursor >= missingSlots.length) break;
      if (!candidateUsable(candidate, used)) continue;
      const slotIndex = missingSlots[cursor];
      const published = await prepareAndPublish(candidate, family, familyIndex, slotIndex);
      used.add(candidate.supplier_product_id);
      completed.push(published);
      cursor += 1;
    }
    page += 1;
  }

  if (cursor !== missingSlots.length) {
    throw new Error(`Famille ${family.key} incomplète: ${completed.length}/${TARGET_PER_FAMILY}`);
  }
  return completed;
}

async function postAudit() {
  const { rows: [row] } = await db.query(
    `SELECT
       COUNT(*)::int AS total,
       COUNT(*) FILTER (WHERE is_active=TRUE)::int AS active,
       COUNT(*) FILTER (WHERE is_available=TRUE)::int AS available,
       COUNT(*) FILTER (WHERE image_url ~ '^https://')::int AS real_images,
       COUNT(*) FILTER (WHERE content_source='manual')::int AS manual_fr,
       COUNT(*) FILTER (WHERE needs_review=TRUE)::int AS needs_review
     FROM products
    WHERE sourcing_source=$1
      AND sort_order BETWEEN $2 AND $3`,
    [SUPPLIER_NAME, SORT_BASE, SORT_BASE + TARGET - 1]
  );
  if (row.total !== TARGET || row.active !== TARGET || row.available !== TARGET || row.real_images !== TARGET || row.needs_review !== 0) {
    throw new Error(`Audit CJ 63 refusé: ${JSON.stringify(row)}`);
  }
  console.log(`[cj-real-showcase] audit=${JSON.stringify(row)}`);
  return row;
}

async function main() {
  assertRuntime();
  const used = await usedSupplierIds();
  let total = 0;
  for (let familyIndex = 0; familyIndex < FAMILIES.length; familyIndex += 1) {
    const family = FAMILIES[familyIndex];
    const rows = await fillFamily(family, familyIndex, used);
    total += rows.length;
    console.log(`[cj-real-showcase] ${family.key}: ${rows.length}/${TARGET_PER_FAMILY}`);
  }
  if (total !== TARGET) throw new Error(`Population CJ incomplète: ${total}/${TARGET}`);
  await postAudit();
  console.log(`[cj-real-showcase] SUCCESS ${TARGET}/${TARGET}`);
}

if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(`[cj-real-showcase] FAILED: ${err.stack || err.message || err}`);
      process.exit(1);
    });
}

module.exports = { ACTOR, FAMILIES, TARGET, TARGET_PER_FAMILY, SORT_BASE, slotSortOrder, frenchName, frenchDescription };
