#!/usr/bin/env node
/**
 * @komerce-arch
 * @role          free-french-e2e-preparation
 * @domain        catalog
 * @layer         tooling
 * @criticality   medium
 * @inputs        inactive supplier drafts with immutable source lineage
 * @outputs       traced manual FR overrides for staging E2E + optional JSON workpack
 * @depends       db.js, services/catalog-overrides.js, scripts/showcase-curate-staging-500.js
 * @used-by       staging real-supplier stress workflows
 * @db-read       sourcing_candidates, products
 * @db-write-via  services/catalog-overrides.js
 * @db-txn        canonical override writes
 * @doctrine      no_paid_ai_api, source_preserved, staging_e2e_fixture_only
 * @impact-areas  catalog, staging, e2e
 * @version       2026-09-v1
 */
'use strict';

const fs = require('fs');
const path = require('path');
const db = require('../db');
const catalogOverrides = require('../services/catalog-overrides');
const { polishName } = require('./showcase-curate-staging-500');

const SUPPLIERS = Object.freeze(['AliExpress', 'CJdropshipping']);
const MAX_LIMIT = 1000;
const PREPARATION_VERSION = 'free-fr-e2e-v1';

const CATEGORY_DESCRIPTIONS = Object.freeze({
  vetements: 'Article de mode préparé pour les parcours de test Komerce à partir de la référence fournisseur conservée.',
  mariage: 'Article mariage préparé pour les parcours de test Komerce à partir de la référence fournisseur conservée.',
  ceremonie: 'Article de cérémonie préparé pour les parcours de test Komerce à partir de la référence fournisseur conservée.',
  enfants: 'Article enfant préparé pour les parcours de test Komerce à partir de la référence fournisseur conservée.',
  phones: 'Produit ou accessoire mobile préparé pour les parcours de test Komerce à partir de la référence fournisseur conservée.',
  electro: 'Produit électronique préparé pour les parcours de test Komerce à partir de la référence fournisseur conservée.',
  materiels: 'Matériel ou équipement préparé pour les parcours de test Komerce à partir de la référence fournisseur conservée.',
  cosmetiques: 'Produit beauté ou soin préparé pour les parcours de test Komerce à partir de la référence fournisseur conservée.',
});

function parseArgs(argv = process.argv.slice(2)) {
  let limit = MAX_LIMIT;
  let output = null;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--limit') limit = Number.parseInt(argv[++i], 10);
    else if (arg.startsWith('--limit=')) limit = Number.parseInt(arg.split('=', 2)[1], 10);
    else if (arg === '--output') output = String(argv[++i] || '').trim();
    else if (arg.startsWith('--output=')) output = String(arg.split('=', 2)[1] || '').trim();
    else throw new Error(`Argument inconnu: ${arg}`);
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    throw new Error(`--limit doit être 1..${MAX_LIMIT}`);
  }
  return { limit, output: output ? path.resolve(output) : null };
}

function assertRuntime(env = process.env) {
  if (String(env.KOMERCE_ENV || '').trim().toLowerCase() !== 'staging' || env.NODE_ENV !== 'test') {
    throw new Error('REFUS: préparation FR gratuite réservée à staging/test');
  }
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL requis');
}

function compactTitle(value) {
  let title = polishName(value);
  title = title
    .replace(/\b(?:new|hot sale|best seller|bestseller|high quality|premium|latest|popular)\b/gi, ' ')
    .replace(/\b(?:2024|2025|2026)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;:])/g, '$1')
    .replace(/^[\s,.;:—-]+|[\s,.;:—-]+$/g, '')
    .trim();
  if (!title) return 'Sélection Komerce';
  if (title.length <= 80) return title;
  const sliced = title.slice(0, 80);
  const lastSpace = sliced.lastIndexOf(' ');
  return (lastSpace >= 45 ? sliced.slice(0, lastSpace) : sliced).trim();
}

function prepareFrenchFields(row) {
  const sourceTitle = String(row.name_source || row.name || row.product_ref || '').trim();
  const name = compactTitle(sourceTitle);
  const category = String(row.category || '').trim().toLowerCase();
  const categoryText = CATEGORY_DESCRIPTIONS[category]
    || 'Produit préparé pour les parcours de test Komerce à partir de la référence fournisseur conservée.';
  return {
    name,
    description: `${name}. ${categoryText}`,
    preparation_version: PREPARATION_VERSION,
  };
}

async function loadDrafts(limit) {
  const { rows } = await db.query(
    `SELECT p.id, p.product_ref, p.name, p.name_source, p.description_source,
            p.source_locale, p.category, p.subcategory, p.content_source,
            p.lifecycle_status, p.is_active,
            sc.supplier_name, sc.supplier_product_id
       FROM sourcing_candidates sc
       JOIN products p ON p.id=sc.product_id
      WHERE sc.supplier_name = ANY($1::text[])
        AND sc.state='imported_to_catalog'
        AND p.lifecycle_status='candidate'
        AND p.is_active=FALSE
        AND p.content_source='connector_raw'
        AND p.source_locale IS NOT NULL
        AND lower(p.source_locale) NOT LIKE 'fr%'
      ORDER BY p.product_ref
      LIMIT $2`,
    [SUPPLIERS, limit]
  );
  return rows;
}

async function applyPreparedDraft(row) {
  const fields = prepareFrenchFields(row);
  const result = await catalogOverrides.upsertOverrides(
    db,
    row.id,
    { name: fields.name, description: fields.description },
    {
      reason: 'Préparation FR gratuite pour E2E staging — sans API IA payante',
      setBy: null,
    }
  );
  if (result.product?.content_source !== 'manual') {
    throw new Error(`FR_PREP_NOT_MANUAL:${row.product_ref}`);
  }
  return {
    product_ref: row.product_ref,
    supplier_name: row.supplier_name,
    supplier_product_id: row.supplier_product_id,
    name_source: row.name_source,
    description_source: row.description_source,
    source_locale: row.source_locale,
    name_fr: fields.name,
    description_fr: fields.description,
    content_source: result.product.content_source,
    needs_review: result.product.needs_review,
  };
}

async function run(options = parseArgs()) {
  assertRuntime();
  const drafts = await loadDrafts(options.limit);
  const prepared = [];
  const errors = [];

  for (const row of drafts) {
    try {
      // eslint-disable-next-line no-await-in-loop
      prepared.push(await applyPreparedDraft(row));
    } catch (error) {
      errors.push({
        product_ref: row.product_ref,
        supplier_name: row.supplier_name,
        error: String(error.message || error).slice(0, 240),
      });
    }
  }

  const summary = {
    selected: drafts.length,
    prepared: prepared.length,
    failed: errors.length,
    api_calls: 0,
    paid_ai_dependency: false,
    preparation_version: PREPARATION_VERSION,
    authority: 'STAGING_E2E_FIXTURE_NOT_PRODUCTION_EDITORIAL_VALIDATION',
  };

  if (options.output) {
    fs.mkdirSync(path.dirname(options.output), { recursive: true });
    fs.writeFileSync(options.output, JSON.stringify({
      schema_version: 1,
      generated_at: new Date().toISOString(),
      summary,
      products: prepared,
      errors,
    }, null, 2) + '\n', 'utf8');
  }

  console.log(`[catalog-fr-free] ${JSON.stringify(summary)}`);
  if (errors.length) throw new Error(`FR_FREE_PREPARATION_INCOMPLETE:${errors.length}/${drafts.length}`);
  return { summary, products: prepared };
}

if (require.main === module) {
  run()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(`[catalog-fr-free] FAILED: ${error.stack || error.message || error}`);
      process.exit(1);
    })
    .finally(() => db.pool.end());
}

module.exports = {
  PREPARATION_VERSION,
  CATEGORY_DESCRIPTIONS,
  parseArgs,
  assertRuntime,
  compactTitle,
  prepareFrenchFields,
  run,
};
