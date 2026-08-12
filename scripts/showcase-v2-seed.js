#!/usr/bin/env node
/**
 * @komerce-arch
 * @role          staging-showcase-v2-refinery-seed
 * @domain        catalog
 * @layer         script
 * @criticality   high
 * @inputs        canonical_cloudinary_manifest_v2, railway_staging
 * @outputs       500 cumulative products, sourcing candidates, canonical media, axes, SKU, French enrichment, approvals
 * @depends       db.js, scripts/showcase-v2-plan.js, services/suppliers/connectors/manual-connector.js, services/suppliers/catalog-import-orchestrator.js, services/catalog-promotion.js, services/product-admin-service.js, services/catalog-enrichment.js, services/catalog-approval.js
 * @used-by       showcase v2 staging deploy
 * @db-read       products, product_skus, product_variants, sourcing_candidates
 * @db-write      products, catalog_media, product_variants, product_skus, product_sku_media, product_content_profile, product_content_sections, product_attributes, sourcing_candidates, sourcing_candidate_events, supplier_catalog_imports, catalog_enrichment_runs
 * @db-txn        yes (ingestion orchestrator + preparation/approval transactions per product)
 * @doctrine      docs/doctrine/DOCTRINE_CATALOGUE.md, docs/doctrine/DOCTRINE_INGESTION_CATALOGUE.md, docs/doctrine/DOCTRINE_PRODUCT_DETAIL_CONTRACT.md
 * @version       2026-08-v3
 */
'use strict';

const fs = require('fs');
const path = require('path');
const db = require('../db');
const { buildSlots, buildV2Contract, TAXONOMY_TARGETS } = require('./showcase-v2-plan');
const { roundKmf, stableInt, normalizeImages, isCanonicalCloudinaryUpload } = require('./showcase-catalog');
const manualConnector = require('../services/suppliers/connectors/manual-connector');
const catalogImportOrchestrator = require('../services/suppliers/catalog-import-orchestrator');
const { validateForPromotion, promoteCatalog } = require('../services/catalog-promotion');
const { upsertProductSku, auditProductSkuReadiness } = require('../services/product-admin-service');
const catalogEnrichment = require('../services/catalog-enrichment');
const { approveProduct } = require('../services/catalog-approval');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_MANIFEST = path.join(ROOT, 'data', 'catalogue-test-raw', 'showcase-catalog-v2.json');
const TARGET = 500;
const SUPPLIER_NAME = 'Komerce Showcase V2';

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
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY requis : la V2 ne peut plus contourner l’enrichissement français');
  }
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
    if (!product.source_title) throw new Error(`Titre source brut absent: ${product.product_ref}`);
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

function buildImportContracts(products, slots) {
  return products.map((product, index) => {
    const contract = buildV2Contract(product, slots[index]);
    // Le contrat normalisé peut porter une représentation de travail, mais le
    // raw_payload garde explicitement la vérité source originale à vie.
    return {
      ...contract,
      supplier_name: SUPPLIER_NAME,
      supplier_product_id: slots[index].product_ref,
      raw_payload: {
        ...(contract.raw_payload || {}),
        source_title: product.source_title || null,
        source_description: product.source_description ?? null,
        source_locale: product.source_locale || 'en',
      },
    };
  });
}

async function ingestThroughRefinery(products, slots) {
  const items = buildImportContracts(products, slots);
  const body = {
    supplier_name: SUPPLIER_NAME,
    source_type: 'manual',
    notes: 'Showcase V2 — campagne staging contractuelle, rejouable et enrichie FR',
    items,
  };

  const dispatch = () => manualConnector.fetchProducts({ supplier_name: SUPPLIER_NAME, items });
  const result = await catalogImportOrchestrator.importCatalog(body, null, dispatch);
  if (result.status !== 200) {
    throw new Error(`Ingestion raffinerie refusée (${result.status}): ${JSON.stringify(result.body).slice(0, 1200)}`);
  }
  if (result.body.accepted !== TARGET || result.body.rejected !== 0) {
    throw new Error(`Ingestion raffinerie incomplète: accepted=${result.body.accepted}, rejected=${result.body.rejected}`);
  }

  const refs = slots.map((slot) => slot.product_ref);
  const { rows } = await db.query(
    `SELECT id, supplier_product_id, product_name, description,
            purchase_price_kmf, estimated_weight_kg, scan_result, state,
            product_id, raw_payload, normalized_source_contract
       FROM sourcing_candidates
      WHERE supplier_name=$1 AND supplier_product_id = ANY($2::text[])`,
    [SUPPLIER_NAME, refs],
  );
  if (rows.length !== TARGET) throw new Error(`Snapshots candidats V2 incomplets: ${rows.length}/${TARGET}`);

  const byRef = new Map();
  const badStates = [];
  for (const row of rows) {
    if (!row.normalized_source_contract) throw new Error(`normalized_source_contract absent: ${row.supplier_product_id}`);
    if (!row.raw_payload?.source_title) throw new Error(`raw_payload.source_title absent: ${row.supplier_product_id}`);
    if (!['scanned', 'imported_to_catalog'].includes(row.state)) {
      badStates.push({ ref: row.supplier_product_id, state: row.state, decision: row.scan_result?.sourcing_decision || null });
    }
    validateForPromotion(row.normalized_source_contract);
    byRef.set(row.supplier_product_id, row);
  }
  if (badStates.length) {
    throw new Error(`Candidats non promouvables (${badStates.length}): ${JSON.stringify(badStates.slice(0, 20))}`);
  }

  console.log(`[showcase-v2-seed] ingestion vraie: import=${result.body.import_id}, candidats=${rows.length}, erreurs=0`);
  return byRef;
}

function candidatePrice(candidate, fallback) {
  const sr = candidate.scan_result || {};
  return roundKmf(sr.test_price_kmf || sr.recommended_price_kmf || sr.minimum_safe_price_kmf || fallback || 500);
}

async function upsertParent(client, product, slot, contract, candidate) {
  const images = normalizeImages(product);
  const stock = Math.max(1, Number(contract.stock_available || product.stock || 1));
  const priceKmf = candidatePrice(candidate, product.price_kmf);
  const raw = candidate.raw_payload || {};
  const sourceTitle = raw.source_title || product.source_title || candidate.product_name || product.name;
  const sourceDescription = raw.source_description ?? product.source_description ?? null;
  const sourceLocale = raw.source_locale || product.source_locale || contract.source_locale || 'en';
  const connectorDescription = sourceDescription || candidate.description || product.description || sourceTitle;

  const { rows: [row] } = await client.query(
    `INSERT INTO products (
       product_ref, name, description, category, subcategory,
       cost_kmf, price_kmf, promo_pct, is_promo, image_url, images, stock,
       weight_kg, inventory_model, has_variants, is_active, is_available,
       lifecycle_status, quality_validated,
       name_source, description_source, source_locale, content_source, sort_order,
       needs_review, enrichment_version, enrichment_confidence
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,
       $13,'LEGACY_VARIANTS',$14,FALSE,FALSE,
       'candidate',FALSE,
       $15,$16,$17,'connector_raw',$18,
       FALSE,NULL,NULL
     )
     ON CONFLICT (product_ref) DO UPDATE SET
       name=EXCLUDED.name,
       description=EXCLUDED.description,
       category=EXCLUDED.category,
       subcategory=EXCLUDED.subcategory,
       cost_kmf=EXCLUDED.cost_kmf,
       price_kmf=EXCLUDED.price_kmf,
       promo_pct=EXCLUDED.promo_pct,
       is_promo=EXCLUDED.is_promo,
       image_url=EXCLUDED.image_url,
       images=EXCLUDED.images,
       stock=EXCLUDED.stock,
       weight_kg=EXCLUDED.weight_kg,
       has_variants=EXCLUDED.has_variants,
       is_active=FALSE,
       is_available=FALSE,
       lifecycle_status='candidate',
       quality_validated=FALSE,
       name_source=EXCLUDED.name_source,
       description_source=EXCLUDED.description_source,
       source_locale=EXCLUDED.source_locale,
       content_source='connector_raw',
       needs_review=FALSE,
       enrichment_version=NULL,
       enrichment_confidence=NULL,
       sort_order=EXCLUDED.sort_order,
       updated_at=NOW()
     RETURNING *`,
    [
      product.product_ref,
      sourceTitle,
      connectorDescription,
      slot.category,
      slot.subcategory,
      Number(candidate.purchase_price_kmf || 0),
      priceKmf,
      product.promo_pct || null,
      Number(product.promo_pct || 0) > 0,
      product.image_url,
      JSON.stringify(images),
      stock,
      candidate.estimated_weight_kg || null,
      slot.rich,
      sourceTitle,
      sourceDescription,
      sourceLocale,
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
  await client.query(`UPDATE products SET inventory_model='SKU', updated_at=NOW() WHERE id=$1`, [product.id]);
}

async function markCandidateImported(client, candidate, productId, priceKmf) {
  if (candidate.state === 'imported_to_catalog' && String(candidate.product_id || '') === String(productId)) return;
  await client.query(
    `UPDATE sourcing_candidates SET state='imported_to_catalog', product_id=$1, updated_at=NOW() WHERE id=$2`,
    [productId, candidate.id],
  );
  await client.query(
    `INSERT INTO sourcing_candidate_events
       (candidate_id, event_type, old_state, new_state, changes, notes)
     VALUES ($1, 'imported', $2, 'imported_to_catalog', $3::jsonb, $4)`,
    [
      candidate.id,
      candidate.state,
      JSON.stringify({ product_id: productId, price_kmf: priceKmf, showcase_v2: true }),
      'Campagne staging Showcase V2 — promotion via raffinerie canonique',
    ],
  );
}

async function prepareProduct(product, slot, candidate) {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    const contract = candidate.normalized_source_contract;
    validateForPromotion(contract);
    const parent = await upsertParent(client, product, slot, contract, candidate);
    await promoteCatalog(client, { productId: parent.id, normalizedSourceContract: contract });
    if (slot.rich) await applyCommercialSkus(client, parent, contract);
    await markCandidateImported(client, candidate, parent.id, parent.price_kmf);
    await client.query('COMMIT');
    return parent.id;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function enrichProductInFrench(productId, productRef) {
  const result = await catalogEnrichment.enrichAndApply(productId);
  if (result.status !== 'ok' || result.needsReview === true) {
    throw new Error(`Enrichissement FR ${productRef} refusé: status=${result.status} ${result.error || ''}`.trim());
  }

  const { rows: [row] } = await db.query(
    `SELECT name, description, name_source, description_source, source_locale,
            content_source, enrichment_version, enrichment_confidence, needs_review
       FROM products WHERE id=$1`,
    [productId],
  );
  if (!row || row.content_source !== 'ai_enriched' || !row.enrichment_version || row.needs_review) {
    throw new Error(`Invariant enrichissement FR cassé ${productRef}: ${JSON.stringify(row || null)}`);
  }
  return row;
}

async function approvePreparedProduct(productId, productRef) {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    const approval = await approveProduct(client, productId, { id: 'showcase-v2' });
    if (approval.status !== 200) {
      throw new Error(`Approbation ${productRef}: HTTP ${approval.status} ${approval.body?.error || ''}`);
    }
    await client.query(
      `UPDATE products
          SET is_available=TRUE,
              quality_validated=TRUE,
              lifecycle_status='active',
              updated_at=NOW()
        WHERE id=$1 AND is_active=TRUE`,
      [productId],
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function processProduct(product, slot, candidate) {
  const productId = await prepareProduct(product, slot, candidate);
  await enrichProductInFrench(productId, product.product_ref);
  await approvePreparedProduct(productId, product.product_ref);
}

async function postSeedAudit() {
  const { rows: [totals] } = await db.query(
    `SELECT
       COUNT(*) FILTER (WHERE is_active AND product_ref LIKE 'SHOWCASE-V1-%')::int AS v1,
       COUNT(*) FILTER (WHERE is_active AND product_ref LIKE 'SHOWCASE-V2-%')::int AS v2,
       COUNT(*) FILTER (WHERE is_active AND product_ref LIKE 'SHOWCASE-V2-%' AND inventory_model='SKU')::int AS sku_products,
       COUNT(*) FILTER (WHERE is_active AND product_ref LIKE 'SHOWCASE-V2-%' AND COALESCE(promo_pct,0)>0)::int AS promo_products,
       COUNT(*) FILTER (WHERE is_active AND product_ref LIKE 'SHOWCASE-V2-%' AND content_source='ai_enriched')::int AS ai_enriched_products,
       COUNT(*) FILTER (WHERE is_active AND product_ref LIKE 'SHOWCASE-V2-%' AND content_source='connector_raw')::int AS raw_active_products,
       COUNT(*) FILTER (WHERE is_active AND product_ref LIKE 'SHOWCASE-V2-%' AND char_length(name)>80)::int AS overlong_titles,
       COUNT(*) FILTER (WHERE is_active AND product_ref LIKE 'SHOWCASE-V2-%' AND enrichment_version IS NULL)::int AS missing_enrichment_version,
       COUNT(*) FILTER (WHERE is_active AND product_ref LIKE 'SHOWCASE-V2-%' AND needs_review=TRUE)::int AS active_needs_review
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

  const { rows: [lineage] } = await db.query(
    `SELECT
       COUNT(*) FILTER (WHERE p.name_source IS DISTINCT FROM sc.raw_payload->>'source_title')::int AS name_source_mismatch,
       COUNT(*) FILTER (WHERE p.description_source IS DISTINCT FROM sc.raw_payload->>'source_description')::int AS description_source_mismatch,
       COUNT(*) FILTER (WHERE sc.raw_payload->>'source_title' IS NULL)::int AS missing_raw_source_title
     FROM products p
     JOIN sourcing_candidates sc
       ON sc.supplier_name=$1 AND sc.supplier_product_id=p.product_ref
    WHERE p.product_ref LIKE 'SHOWCASE-V2-%'`,
    [SUPPLIER_NAME],
  );

  const { rows: [skuStats] } = await db.query(
    `SELECT COUNT(*)::int AS active_skus,
            COUNT(*) FILTER (WHERE ps.stock=0)::int AS out_of_stock_skus
       FROM product_skus ps
       JOIN products p ON p.id=ps.product_id
      WHERE p.is_active=TRUE AND p.product_ref LIKE 'SHOWCASE-V2-%' AND ps.is_active=TRUE`
  );

  const { rows: decisions } = await db.query(
    `SELECT COALESCE(scan_result->>'sourcing_decision','UNKNOWN') AS decision,
            COUNT(*)::int AS count
       FROM sourcing_candidates
      WHERE supplier_name=$1 AND supplier_product_id LIKE 'SHOWCASE-V2-%'
      GROUP BY 1 ORDER BY 1`,
    [SUPPLIER_NAME],
  );

  if (totals.v1 !== 500 || totals.v2 !== 500 || totals.sku_products !== 350) {
    throw new Error(`Post-seed mismatch: ${JSON.stringify({ ...totals, ...skuStats })}`);
  }
  if (totals.ai_enriched_products !== 500 || totals.raw_active_products !== 0 || totals.overlong_titles !== 0 || totals.missing_enrichment_version !== 0 || totals.active_needs_review !== 0) {
    throw new Error(`Audit éditorial FR refusé: ${JSON.stringify(totals)}`);
  }
  if (lineage.name_source_mismatch !== 0 || lineage.description_source_mismatch !== 0 || lineage.missing_raw_source_title !== 0) {
    throw new Error(`Audit lignage source refusé: ${JSON.stringify(lineage)}`);
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
    french_editorial: {
      ai_enriched_products: totals.ai_enriched_products,
      raw_active_products: totals.raw_active_products,
      overlong_titles: totals.overlong_titles,
      missing_enrichment_version: totals.missing_enrichment_version,
      active_needs_review: totals.active_needs_review,
    },
    source_lineage: lineage,
    sourcing_decisions: decisions,
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
  }

  // Chaîne réellement éprouvée : connecteur → normalisation → éligibilité →
  // pricing → candidat inactif → promotion/SKU → enrichissement FR → approbation.
  const candidates = await ingestThroughRefinery(products, slots);

  for (let index = 0; index < products.length; index += 1) {
    const product = products[index];
    const slot = slots[index];
    const candidate = candidates.get(slot.product_ref);
    if (!candidate) throw new Error(`Candidat V2 introuvable: ${slot.product_ref}`);
    await processProduct(product, slot, candidate);
    if ((index + 1) % 25 === 0) console.log(`[showcase-v2-seed] ${index + 1}/${TARGET} enrichis FR + approuvés`);
  }

  await postSeedAudit();
  console.log('[showcase-v2-seed] ✅ campagne V2 committée, enrichie FR et auditée');
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
  buildImportContracts,
  candidatePrice,
};
