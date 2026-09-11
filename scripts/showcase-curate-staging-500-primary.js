#!/usr/bin/env node
/**
 * @komerce-arch
 * @role          staging-showcase-primary-curator-500
 * @domain        catalog
 * @layer         script
 * @criticality   low
 * @inputs        current curated nucleus, DummyJSON, Platzi
 * @outputs       deterministic curated staging fixture (default 500 products)
 * @depends       scripts/showcase-catalog.js, scripts/showcase-curate-staging-500.js
 * @used-by       one-shot staging boutique / E2E catalogue preparation
 * @db-read       none
 * @db-write      none
 * @db-txn        no
 * @doctrine      staging fixture only; Wikimedia is optional enrichment, never a critical dependency
 * @version       2026-09-v1
 */
'use strict';

const fs = require('fs');
const {
  DEFAULT_CURATED_INPUTS,
  readProductInputs,
  assertCuratedSource,
  mapDummyProduct,
  mapPlatziProduct,
  verifyImageUrl,
} = require('./showcase-catalog');
const {
  DEFAULT_TARGET,
  DEFAULT_OUTPUT,
  CATEGORY_ORDER,
  parseArgs,
  curateCandidate,
  balancedSelection,
  summarize,
} = require('./showcase-curate-staging-500');

const DUMMY_URL = 'https://dummyjson.com/products?limit=0';
const PLATZI_URL = 'https://api.escuelajs.co/api/v1/products?offset=0&limit=500';

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: { 'User-Agent': 'KomerceShowcaseBuilder/3.1' },
    redirect: 'follow',
  });
  if (!response.ok) throw new Error(`${url} -> HTTP ${response.status}`);
  return response.json();
}

async function collectPrimaryPool() {
  const [dummyBody, platziBody] = await Promise.all([
    fetchJson(DUMMY_URL),
    fetchJson(PLATZI_URL),
  ]);
  const pool = [];
  for (const product of dummyBody.products || []) {
    const mapped = mapDummyProduct(product, pool.length);
    if (mapped?.image_url) pool.push(mapped);
  }
  for (const product of Array.isArray(platziBody) ? platziBody : []) {
    const mapped = mapPlatziProduct(product);
    if (mapped?.image_url) pool.push(mapped);
  }

  const seenSources = new Set();
  const seenHeroes = new Set();
  return pool.filter((product) => {
    if (!product.image_url || seenSources.has(product.source) || seenHeroes.has(product.image_url)) return false;
    seenSources.add(product.source);
    seenHeroes.add(product.image_url);
    return true;
  });
}

async function verifyCandidates(products, concurrency) {
  const results = new Array(products.length);
  let cursor = 0;
  async function worker() {
    while (true) {
      const index = cursor++;
      if (index >= products.length) return;
      const product = products[index];
      results[index] = { product, check: await verifyImageUrl(product.image_url) };
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, products.length || 1) }, worker));
  return results.filter((row) => row.check.ok).map((row) => row.product);
}

async function build(options) {
  const nucleus = readProductInputs(DEFAULT_CURATED_INPUTS);
  assertCuratedSource(nucleus);
  if (nucleus.length > options.target) throw new Error(`Noyau curaté trop grand: ${nucleus.length}/${options.target}`);
  if (nucleus.some((product) => Number(product.stock) <= 0)) throw new Error('Le noyau curaté contient au moins un produit sans stock');

  const needed = options.target - nucleus.length;
  const existingSources = new Set(nucleus.map((product) => product.source));
  const existingHeroes = new Set(nucleus.map((product) => product.image_url));
  const primary = await collectPrimaryPool();
  const candidates = primary.filter((product) => (
    product.image_url
    && product.source
    && !existingSources.has(product.source)
    && !existingHeroes.has(product.image_url)
    && CATEGORY_ORDER.includes(product.category)
  ));
  const valid = options.network ? await verifyCandidates(candidates, options.concurrency) : candidates;
  const selected = balancedSelection(valid, needed);

  console.log(JSON.stringify({
    primary_pool: primary.length,
    eligible_before_network: candidates.length,
    eligible_after_network: valid.length,
    needed,
  }, null, 2));

  if (selected.length !== needed) {
    throw new Error(`Pool primaire curatable insuffisant: ${selected.length}/${needed} après contrôle${options.network ? ' réseau' : ''}`);
  }

  const curated = [
    ...nucleus.map((product, index) => ({ ...product, sort_order: index, curated: true })),
    ...selected.map((product, index) => curateCandidate(product, nucleus.length + index)),
  ];
  assertCuratedSource(curated);
  const summary = summarize(curated);
  if (summary.products !== options.target) throw new Error(`Cible non atteinte: ${summary.products}/${options.target}`);
  if (summary.out_of_stock !== 0) throw new Error(`${summary.out_of_stock} produits sans stock`);
  if (summary.unique_heroes !== curated.length) throw new Error('Images hero non uniques dans le fixture curaté');

  fs.mkdirSync(require('path').dirname(options.output), { recursive: true });
  fs.writeFileSync(options.output, `${JSON.stringify(curated, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ output: options.output, source_mode: 'primary-only', ...summary }, null, 2));
  return { products: curated, summary };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  await build(options);
}

if (require.main === module) {
  main().catch((error) => {
    console.error('[showcase:curate:500:primary] échec:', error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  DEFAULT_TARGET,
  DEFAULT_OUTPUT,
  DUMMY_URL,
  PLATZI_URL,
  collectPrimaryPool,
  verifyCandidates,
  build,
};
