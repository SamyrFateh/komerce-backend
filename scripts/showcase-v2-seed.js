#!/usr/bin/env node
/**
 * @komerce-arch
 * @role          staging-showcase-v2-refinery-seed
 * @domain        catalog
 * @layer         script
 * @criticality   high
 * @inputs        canonical_hosted_manifest_v2, railway_staging
 * @outputs       500 cumulative products, sourcing candidates, canonical media, axes, SKU, French editorial preparation, approvals
 * @depends       db.js, scripts/showcase-v2-plan.js, scripts/showcase-media-provider.js, services/suppliers/connectors/manual-connector.js, services/suppliers/catalog-import-orchestrator.js, services/catalog-promotion.js, services/product-admin-service.js, services/catalog-enrichment.js, services/catalog-approval.js
 * @used-by       showcase v2 staging deploy
 * @db-read       products, product_skus, product_variants, sourcing_candidates
 * @db-write      products, catalog_media, product_variants, product_skus, product_sku_media, product_content_profile, product_content_sections, product_attributes, sourcing_candidates, sourcing_candidate_events, supplier_catalog_imports, catalog_enrichment_runs
 * @db-txn        yes (ingestion orchestrator + preparation/approval transactions per product)
 * @doctrine      docs/doctrine/DOCTRINE_CATALOGUE.md, docs/doctrine/DOCTRINE_INGESTION_CATALOGUE.md, docs/doctrine/DOCTRINE_PRODUCT_DETAIL_CONTRACT.md
 * @version       2026-09-v6
 */
'use strict';

const fs = require('fs');
const path = require('path');
const db = require('../db');
const { buildSlots, buildV2Contract, TAXONOMY_TARGETS } = require('./showcase-v2-plan');
const { roundKmf, stableInt, normalizeImages } = require('./showcase-catalog');
const { resolveMediaProvider, isCanonicalMediaUrl } = require('./showcase-media-provider');
const manualConnector = require('../services/suppliers/connectors/manual-connector');
const catalogImportOrchestrator = require('../services/suppliers/catalog-import-orchestrator');
const { validateForPromotion, promoteCatalog } = require('../services/catalog-promotion');
const { upsertProductSku, auditProductSkuReadiness } = require('../services/product-admin-service');
const catalogEnrichment = require('../services/catalog-enrichment');
const catalogEnrichmentPrompt = require('../services/prompts/catalog-enrichment.prompt');
const { approveProduct } = require('../services/catalog-approval');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_MANIFEST = path.join(ROOT, 'data', 'catalogue-test-raw', 'showcase-catalog-v2.json');
const TARGET = 500;
const SUPPLIER_NAME = 'Komerce Showcase V2';
const RUN_MODES = Object.freeze(['fresh', 'resume']);

function parseArgs(argv) {
  const out = { target: TARGET, manifest: DEFAULT_MANIFEST, mode: 'fresh' };
  for (let i = 0; i < argv.length; i += 1) {
    const [key, inline] = argv[i].split('=', 2);
    const next = () => inline ?? argv[++i];
    if (key === '--target') out.target = Number.parseInt(next(), 10);
    else if (key === '--manifest') out.manifest = path.resolve(next());
    else if (key === '--mode') out.mode = String(next() || '').trim().toLowerCase();
    else throw new Error(`Argument inconnu: ${argv[i]}`);
  }
  if (out.target !== TARGET) throw new Error('--target doit être exactement 500 pour Showcase V2');
  if (!RUN_MODES.includes(out.mode)) throw new Error(`--mode doit être fresh ou resume (reçu: ${out.mode || '(vide)'})`);
  return out;
}

function isFrenchLocale(locale) {
  const value = String(locale || '').trim().toLowerCase().replace('_', '-');
  return value === 'fr' || value.startsWith('fr-');
}

function resolveEnrichmentProvider() {
  const configured = String(process.env.CATALOG_ENRICH_PROVIDER || '').trim().toLowerCase();
  if (configured) {
    if (!['anthropic', 'openai'].includes(configured)) {
      throw new Error(`CATALOG_ENRICH_PROVIDER invalide: ${configured}`);
    }
    return configured;
  }
  if (process.env.ANTHROPIC_API_KEY) return 'anthropic';
  if (process.env.OPENAI_API_KEY) return 'openai';
  return null;
}

function enrichmentKeyName(provider) {
  if (provider === 'openai') return 'OPENAI_API_KEY';
  if (provider === 'anthropic') return 'ANTHROPIC_API_KEY';
  return null;
}

function hasEnrichmentCredentials(provider = resolveEnrichmentProvider()) {
  const keyName = enrichmentKeyName(provider);
  return Boolean(keyName && process.env[keyName]);
}

function assertStaging() {
  if (process.env.NODE_ENV === 'production' || process.env.KOMERCE_ENV === 'production') {
    throw new Error('REFUS: Showcase V2 interdit en production');
  }
  if (process.env.KOMERCE_ALLOW_SHOWCASE_SEED !== '1') {
    throw new Error('KOMERCE_ALLOW_SHOWCASE_SEED=1 requis');
  }
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL requis');
  resolveEnrichmentProvider(); // valide une configuration explicite éventuelle, sans l'imposer
  resolveMediaProvider();
}

function validateManifestIdentity(products) {
  if (!Array.isArray(products) || products.length !== TARGET) {
    throw new Error(`Manifest V2 invalide: ${Array.isArray(products) ? products.length : 'non-array'}/${TARGET}`);
  }
  const refs = new Set();
  for (const product of products) {
    if (!/^SHOWCASE-V2-\d{4}$/.test(product.product_ref || '')) throw new Error(`Référence V2 invalide: ${product.product_ref}`);
    if (refs.has(product.product_ref)) throw new Error(`Référence V2 dupliquée: ${product.product_ref}`);
    refs.add(product.product_ref);
    if (!product.source_title) throw new Error(`Titre source brut absent: ${product.product_ref}`);
  }
}

function validateManifest(products) {
  validateManifestIdentity(products);
  const mediaProvider = resolveMediaProvider();
  const heroes = new Set();
  for (const product of products) {
    const images = normalizeImages(product);
    if (!images.length || images.some((url) => !isCanonicalMediaUrl(url, mediaProvider, 'showcase-v2'))) {
      throw new Error(`Média non canonique ${mediaProvider}: ${product.product_ref}`);
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

function candidateRowsToMap(rows, slots) {
  const expectedRefs = new Set(slots.map((slot) => slot.product_ref));
  const byRef = new Map();
  const badStates = [];
  for (const row of rows) {
    if (!expectedRefs.has(row.supplier_product_id)) continue;
    if (byRef.has(row.supplier_product_id)) throw new Error(`Candidat V2 dupliqué: ${row.supplier_product_id}`);
    if (!row.normalized_source_contract) throw new Error(`normalized_source_contract absent: ${row.supplier_product_id}`);
    if (!row.raw_payload?.source_title) throw new Error(`raw_payload.source_title absent: ${row.supplier_product_id}`);
    if (!['scanned', 'imported_to_catalog'].includes(row.state)) {
      badStates.push({ ref: row.supplier_product_id, state: row.state, decision: row.scan_result?.sourcing_decision || null });
    }
    validateForPromotion(row.normalized_source_contract);
    byRef.set(row.supplier_product_id, row);
  }
  if (byRef.size !== TARGET) throw new Error(`Snapshots candidats V2 incomplets: ${byRef.size}/${TARGET}`);
  if (badStates.length) {
    throw new Error(`Candidats non promouvables (${badStates.length}): ${JSON.stringify(badStates.slice(0, 20))}`);
  }
  return byRef;
}

async function loadExistingCandidates(slots) {
  const refs = slots.map((slot) => slot.product_ref);
  const { rows } = await db.query(
    `SELECT id, supplier_product_id, product_name, description,
            purchase_price_kmf, estimated_weight_kg, scan_result, state,
            product_id, raw_payload, normalized_source_contract
       FROM sourcing_candidates
      WHERE supplier_name=$1 AND supplier_product_id = ANY($2::text[])`,
    [SUPPLIER_NAME, refs],
  );
  return candidateRowsToMap(rows, slots);
}

async function ingestThroughRefinery(products, slots) {
  const items = buildImportContracts(products, slots);
  const body = {
    supplier_name: SUPPLIER_NAME,
    source_type: 'manual',
    notes: 'Showcase V2 — campagne staging contractuelle, rejouable et préparée FR',
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
  const byRef = await loadExistingCandidates(slots);
  console.log(`[showcase-v2-seed] ingestion vraie: import=${result.body.import_id}, candidats=${byRef.size}, erreurs=0`);
  return byRef;
}

function candidatePrice(candidate, fallback) {
  const sr = candidate.scan_result || {};
  return roundKmf(sr.test_price_kmf || sr.recommended_price_kmf || sr.minimum_safe_price_kmf || fallback || 500);
}

function hydrateResumeProduct(sourceProduct, slot, candidate) {
  const raw = candidate.raw_payload || {};
  const contract = candidate.normalized_source_contract || {};
  const sourceDescription = sourceProduct.source_description ?? null;
  const rawDescription = raw.source_description ?? null;
  const sourceLocale = sourceProduct.source_locale || 'en';
  const rawLocale = raw.source_locale || 'en';

  if (raw.source_title !== sourceProduct.source_title || rawDescription !== sourceDescription || rawLocale !== sourceLocale) {
    throw new Error(`Resume refusé — source modifiée depuis l'ingestion: ${slot.product_ref}`);
  }
  const showcaseMeta = contract.raw_payload?.showcase_v2 || contract.raw_payload?.raw_payload?.showcase_v2 || null;
  if (showcaseMeta && (showcaseMeta.product_ref !== slot.product_ref || showcaseMeta.category !== slot.category || showcaseMeta.subcategory !== slot.subcategory || Boolean(showcaseMeta.rich) !== Boolean(slot.rich))) {
    throw new Error(`Resume refusé — taxonomie/contrat divergent: ${slot.product_ref}`);
  }

  const media = Array.isArray(contract.media)
    ? [...contract.media].sort((a, b) => Number(a.display_order || 0) - Number(b.display_order || 0)).map((row) => row.url).filter(Boolean)
    : [];
  const imageUrl = contract.image_url || media[0] || null;
  const images = media.length ? media : (imageUrl ? [imageUrl] : []);
  return { ...sourceProduct, image_url: imageUrl, images };
}

function editorialStateProblems(row, promptVersion = catalogEnrichmentPrompt.PROMPT_VERSION) {
  const problems = [];
  if (row.needs_review === true) problems.push('contenu éditorial à revoir');

  if (row.content_source === 'ai_enriched') {
    if (Number(row.enrichment_version) !== Number(promptVersion)) problems.push('version enrichissement obsolète');
    if (!Number.isFinite(Number(row.enrichment_confidence))) problems.push('enrichissement non certifié');
  } else if (row.content_source === 'manual') {
    // Contenu client préparé humainement : aucune métadonnée IA exigée.
  } else if (row.content_source === 'connector_raw') {
    if (!isFrenchLocale(row.source_locale)) problems.push('préparation FR absente');
  } else {
    problems.push('source éditoriale invalide');
  }
  return problems;
}

function resumeProductProblems(row, slot, candidate, { promptVersion = catalogEnrichmentPrompt.PROMPT_VERSION, mediaProvider = resolveMediaProvider() } = {}) {
  const problems = [];
  if (!row) return ['produit absent'];
  const raw = candidate.raw_payload || {};
  const contract = candidate.normalized_source_contract || {};
  const expectedSkus = slot.rich
    ? (Array.isArray(contract.sellable_units) ? contract.sellable_units.filter((unit) => unit.is_active !== false).length : 0)
    : 0;

  if (!row.is_active || !row.is_available || !row.quality_validated || row.lifecycle_status !== 'active') problems.push('publication incomplète');
  problems.push(...editorialStateProblems(row, promptVersion));
  if (row.category !== slot.category || row.subcategory !== slot.subcategory) problems.push('taxonomie divergente');
  if (row.name_source !== raw.source_title || (row.description_source ?? null) !== (raw.source_description ?? null) || (row.source_locale || 'en') !== (raw.source_locale || 'en')) problems.push('lignage source divergent');
  if (!isCanonicalMediaUrl(row.image_url, mediaProvider, 'showcase-v2')) problems.push('média non canonique');
  if (candidate.state !== 'imported_to_catalog' || String(candidate.product_id || '') !== String(row.id)) problems.push('candidat non rattaché');
  if (slot.rich) {
    if (row.inventory_model !== 'SKU' || Number(row.active_skus) !== expectedSkus || expectedSkus < 1) problems.push('SKU incomplets');
  } else if (Number(row.active_skus) !== 0) {
    problems.push('SKU inattendus');
  }
  return problems;
}

function isResumeProductComplete(row, slot, candidate, options) {
  return resumeProductProblems(row, slot, candidate, options).length === 0;
}

async function loadResumeCompletedRefs(slots, candidates) {
  const refs = slots.map((slot) => slot.product_ref);
  const { rows } = await db.query(
    `SELECT p.id, p.product_ref, p.category, p.subcategory,
            p.is_active, p.is_available, p.quality_validated, p.lifecycle_status,
            p.content_source, p.enrichment_version, p.enrichment_confidence, p.needs_review,
            p.inventory_model, p.name_source, p.description_source, p.source_locale, p.image_url,
            (SELECT COUNT(*)::int FROM product_skus ps WHERE ps.product_id=p.id AND ps.is_active=TRUE) AS active_skus
       FROM products p
      WHERE p.product_ref = ANY($1::text[])`,
    [refs],
  );
  const byRef = new Map(rows.map((row) => [row.product_ref, row]));
  const completed = new Set();
  const pending = [];
  for (const slot of slots) {
    const candidate = candidates.get(slot.product_ref);
    const row = byRef.get(slot.product_ref) || null;
    const problems = resumeProductProblems(row, slot, candidate);
    if (problems.length === 0) completed.add(slot.product_ref);
    else pending.push({ ref: slot.product_ref, problems });
  }
  console.log(`[showcase-v2-seed] resume checkpoint DB: ${completed.size}/${TARGET} complets, ${pending.length} à rejouer${pending.length ? `, premier=${pending[0].ref} (${pending[0].problems.join(', ')})` : ''}`);
  return completed;
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
  if (!row || row.content_source !== 'ai_enriched' || Number(row.enrichment_version) !== Number(catalogEnrichmentPrompt.PROMPT_VERSION) || row.needs_review) {
    throw new Error(`Invariant enrichissement FR cassé ${productRef}: ${JSON.stringify(row || null)}`);
  }
  return row;
}

async function prepareEditorialContent(productId, product) {
  if (isFrenchLocale(product.source_locale)) {
    return { mode: 'source_fr', provider: null };
  }
  const provider = resolveEnrichmentProvider();
  if (!provider || !hasEnrichmentCredentials(provider)) {
    throw new Error(`Préparation FR requise ${product.product_ref}: source=${product.source_locale || 'inconnue'}, aucune assistance IA configurée. Traduire/corriger manuellement ou configurer un provider IA.`);
  }
  await enrichProductInFrench(productId, product.product_ref);
  return { mode: 'ai_enriched', provider };
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
  await prepareEditorialContent(productId, product);
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
       COUNT(*) FILTER (WHERE is_active AND product_ref LIKE 'SHOWCASE-V2-%' AND content_source='manual')::int AS manual_products,
       COUNT(*) FILTER (WHERE is_active AND product_ref LIKE 'SHOWCASE-V2-%' AND content_source='connector_raw'
         AND (REPLACE(LOWER(COALESCE(source_locale,'')),'_','-')='fr' OR REPLACE(LOWER(COALESCE(source_locale,'')),'_','-') LIKE 'fr-%'))::int AS french_raw_products,
       COUNT(*) FILTER (WHERE is_active AND product_ref LIKE 'SHOWCASE-V2-%' AND content_source='connector_raw'
         AND NOT (REPLACE(LOWER(COALESCE(source_locale,'')),'_','-')='fr' OR REPLACE(LOWER(COALESCE(source_locale,'')),'_','-') LIKE 'fr-%'))::int AS foreign_raw_products,
       COUNT(*) FILTER (WHERE is_active AND product_ref LIKE 'SHOWCASE-V2-%' AND content_source NOT IN ('connector_raw','manual','ai_enriched'))::int AS unsupported_content_source,
       COUNT(*) FILTER (WHERE is_active AND product_ref LIKE 'SHOWCASE-V2-%' AND char_length(name)>80)::int AS overlong_titles,
       COUNT(*) FILTER (WHERE is_active AND product_ref LIKE 'SHOWCASE-V2-%' AND content_source='ai_enriched' AND enrichment_version IS NULL)::int AS ai_missing_enrichment_version,
       COUNT(*) FILTER (WHERE is_active AND product_ref LIKE 'SHOWCASE-V2-%' AND content_source='ai_enriched' AND enrichment_version IS DISTINCT FROM $1)::int AS ai_wrong_enrichment_version,
       COUNT(*) FILTER (WHERE is_active AND product_ref LIKE 'SHOWCASE-V2-%' AND needs_review=TRUE)::int AS active_needs_review
     FROM products`,
    [catalogEnrichmentPrompt.PROMPT_VERSION],
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
  const preparedTotal = totals.ai_enriched_products + totals.manual_products + totals.french_raw_products;
  if (preparedTotal !== 500 || totals.foreign_raw_products !== 0 || totals.unsupported_content_source !== 0 || totals.overlong_titles !== 0 || totals.ai_missing_enrichment_version !== 0 || totals.ai_wrong_enrichment_version !== 0 || totals.active_needs_review !== 0) {
    throw new Error(`Audit éditorial FR refusé: ${JSON.stringify({ ...totals, preparedTotal })}`);
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
      prepared_total: preparedTotal,
      native_fr_products: totals.french_raw_products,
      manual_products: totals.manual_products,
      ai_enriched_products: totals.ai_enriched_products,
      foreign_raw_products: totals.foreign_raw_products,
      overlong_titles: totals.overlong_titles,
      ai_missing_enrichment_version: totals.ai_missing_enrichment_version,
      ai_wrong_enrichment_version: totals.ai_wrong_enrichment_version,
      active_needs_review: totals.active_needs_review,
    },
    source_lineage: lineage,
    sourcing_decisions: decisions,
  }, null, 2));
}

async function seed(options) {
  assertStaging();
  if (!fs.existsSync(options.manifest)) throw new Error(`Manifest absent: ${options.manifest}`);
  const manifestProducts = JSON.parse(fs.readFileSync(options.manifest, 'utf8'));
  validateManifestIdentity(manifestProducts);
  await assertV1Foundation();

  const slots = buildSlots();
  for (let index = 0; index < manifestProducts.length; index += 1) {
    const product = manifestProducts[index];
    const slot = slots[index];
    if (product.product_ref !== slot.product_ref || product.category !== slot.category || product.subcategory !== slot.subcategory) {
      throw new Error(`Manifest/plan divergent à ${index}: ${product.product_ref}`);
    }
  }

  let products;
  let candidates;
  let completed = new Set();
  if (options.mode === 'fresh') {
    validateManifest(manifestProducts);
    products = manifestProducts;
    candidates = await ingestThroughRefinery(products, slots);
  } else {
    candidates = await loadExistingCandidates(slots);
    products = manifestProducts.map((product, index) => hydrateResumeProduct(product, slots[index], candidates.get(slots[index].product_ref)));
    validateManifest(products);
    completed = await loadResumeCompletedRefs(slots, candidates);
  }

  const pendingTotal = TARGET - completed.size;
  let replayed = 0;
  for (let index = 0; index < products.length; index += 1) {
    const product = products[index];
    const slot = slots[index];
    const candidate = candidates.get(slot.product_ref);
    if (!candidate) throw new Error(`Candidat V2 introuvable: ${slot.product_ref}`);
    if (completed.has(slot.product_ref)) continue;

    await processProduct(product, slot, candidate);
    replayed += 1;
    if (options.mode === 'fresh') {
      if ((index + 1) % 25 === 0) console.log(`[showcase-v2-seed] ${index + 1}/${TARGET} préparés FR + approuvés`);
    } else if (replayed % 25 === 0 || replayed === pendingTotal) {
      console.log(`[showcase-v2-seed] resume ${replayed}/${pendingTotal} rejoués — ${completed.size + replayed}/${TARGET} complets`);
    }
  }

  await postSeedAudit();
  console.log(`[showcase-v2-seed] ✅ campagne V2 ${options.mode} committée, préparée FR et auditée`);
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
  validateManifestIdentity,
  buildImportContracts,
  candidatePrice,
  hydrateResumeProduct,
  editorialStateProblems,
  resumeProductProblems,
  isResumeProductComplete,
  isFrenchLocale,
  resolveEnrichmentProvider,
  hasEnrichmentCredentials,
};
