#!/usr/bin/env node
/**
 * @komerce-arch
 * @role          deterministic-french-e2e-fixture-preparation
 * @domain        catalog
 * @layer         tooling
 * @criticality   medium
 * @inputs        inactive supplier drafts with immutable source lineage
 * @outputs       deterministic French E2E fixture JSON, no DB mutation
 * @depends       db.js, scripts/showcase-curate-staging-500.js
 * @used-by       isolated-real-cj-1000-catalog-stress.yml, staging-real-supplier-1000-stress.yml
 * @db-read       sourcing_candidates, products
 * @db-write      none
 * @db-txn        read-only
 * @doctrine      source_preserved, no_ai_required, staging_fixture_not_editorial_authority
 * @impact-areas  catalog, staging, e2e
 * @version       2026-09-v1
 */
'use strict';

const fs = require('fs');
const path = require('path');
const db = require('../db');
const { polishName } = require('./showcase-curate-staging-500');

const SUPPLIERS = Object.freeze(['AliExpress', 'CJdropshipping']);
const DEFAULT_LIMIT = 1000;
const MAX_LIMIT = 1000;
const PREPARATION_VERSION = 'deterministic-fr-e2e-v1';

const CATEGORY_DESCRIPTIONS = Object.freeze({
  vetements: 'Article de mode préparé pour les parcours de test Komerce à partir de la référence fournisseur conservée.',
  mariage: 'Article destiné aux univers mariage et cérémonie, préparé pour les parcours de test Komerce à partir de la référence fournisseur conservée.',
  ceremonie: 'Article de cérémonie préparé pour les parcours de test Komerce à partir de la référence fournisseur conservée.',
  enfants: 'Article enfant préparé pour les parcours de test Komerce à partir de la référence fournisseur conservée.',
  phones: 'Accessoire ou produit mobile préparé pour les parcours de test Komerce à partir de la référence fournisseur conservée.',
  electro: 'Produit électronique préparé pour les parcours de test Komerce à partir de la référence fournisseur conservée.',
  materiels: 'Matériel ou équipement préparé pour les parcours de test Komerce à partir de la référence fournisseur conservée.',
  cosmetiques: 'Produit beauté ou soin préparé pour les parcours de test Komerce à partir de la référence fournisseur conservée.',
});

const MARKETING_NOISE = [
  /(?:new|hot sale|best seller|bestseller|high quality|premium|fashion|latest|popular)/gi,
  /(?:2024|2025|2026)/g,
  /s{2,}/g,
];

function parseArgs(argv = process.argv.slice(2)) {
  let limit = DEFAULT_LIMIT;
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
    throw new Error('REFUS: préparation fixture FR réservée à KOMERCE_ENV=staging + NODE_ENV=test');
  }
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL requis');
}

function compactTitle(value) {
  let title = polishName(value);
  for (const pattern of MARKETING_NOISE) title = title.replace(pattern, ' ');
  title = title
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
  const categoryKey = String(row.category || '').trim().toLowerCase();
  const categoryDescription = CATEGORY_DESCRIPTIONS[categoryKey]
    || 'Produit préparé pour les parcours de test Komerce à partir de la référence fournisseur conservée.';
  const description = `${name}. ${categoryDescription}`;
  return {
    name_fr: name,
    description_fr: description,
    method: PREPARATION_VERSION,
    source_preserved: true,
    semantic_editorial_review_proven: false,
    requires_human_semantic_review_before_production_publication: true,
  };
}

async function loadRows(limit) {
  const { rows } = await db.query(
    `SELECT p.id AS product_id, p.product_ref, p.name, p.name_source,
            p.description_source, p.source_locale, p.category, p.subcategory,
            p.image_url, p.images, p.price_kmf, p.lifecycle_status, p.is_active,
            p.content_source, p.needs_review,
            sc.supplier_name, sc.supplier_product_id,
            sc.scan_result->>'sourcing_decision' AS sourcing_decision
       FROM sourcing_candidates sc
       JOIN products p ON p.id=sc.product_id
      WHERE sc.supplier_name = ANY($1::text[])
        AND sc.state='imported_to_catalog'
        AND p.lifecycle_status='candidate'
        AND p.is_active=FALSE
      ORDER BY p.product_ref
      LIMIT $2`,
    [SUPPLIERS, limit]
  );
  return rows;
}

function summarize(products) {
  const bySupplier = {};
  const byCategory = {};
  let sourceDescriptions = 0;
  let overlongTitles = 0;
  let unchangedTitles = 0;
  for (const row of products) {
    bySupplier[row.supplier_name] = (bySupplier[row.supplier_name] || 0) + 1;
    const category = row.category || '<missing>';
    byCategory[category] = (byCategory[category] || 0) + 1;
    if (String(row.description_source || '').trim()) sourceDescriptions += 1;
    if (String(row.prepared?.name_fr || '').length > 80) overlongTitles += 1;
    if (String(row.prepared?.name_fr || '').trim().toLowerCase() === String(row.name_source || '').trim().toLowerCase()) {
      unchangedTitles += 1;
    }
  }
  return {
    selected: products.length,
    by_supplier: bySupplier,
    by_category: byCategory,
    source_descriptions_present: sourceDescriptions,
    overlong_titles: overlongTitles,
    unchanged_titles_after_rules: unchangedTitles,
    api_calls: 0,
    db_writes: 0,
    preparation_version: PREPARATION_VERSION,
  };
}

async function run(options = parseArgs()) {
  assertRuntime();
  const rows = await loadRows(options.limit);
  const products = rows.map((row) => ({
    ...row,
    prepared: prepareFrenchFields(row),
  }));
  const summary = summarize(products);
  const artifact = {
    schema_version: 1,
    authority: 'DETERMINISTIC_STAGING_E2E_FIXTURE_NOT_PRODUCTION_EDITORIAL_VALIDATION',
    generated_at: new Date().toISOString(),
    ...summary,
    products,
  };
  if (options.output) {
    fs.mkdirSync(path.dirname(options.output), { recursive: true });
    fs.writeFileSync(options.output, JSON.stringify(artifact, null, 2) + '\n', 'utf8');
  }
  console.log(`[catalog-fr-fixture] ${JSON.stringify(summary)}`);
  return artifact;
}

if (require.main === module) {
  run()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(`[catalog-fr-fixture] FAILED: ${error.stack || error.message || error}`);
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
  summarize,
  run,
};
