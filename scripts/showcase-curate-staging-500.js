#!/usr/bin/env node
/**
 * @komerce-arch
 * @role          staging-showcase-curator-500
 * @domain        catalog
 * @layer         script
 * @criticality   low
 * @inputs        curated seed nucleus, public showcase candidate pool
 * @outputs       deterministic curated staging fixture (default 500 products)
 * @depends       scripts/showcase-catalog.js
 * @used-by       staging boutique / E2E catalogue preparation
 * @db-read       none
 * @db-write      none
 * @db-txn        no
 * @doctrine      staging fixture only; never changes production catalogue doctrine or cap
 * @version       2026-09-v1
 */
'use strict';

const fs = require('fs');
const path = require('path');
const {
  DEFAULT_CURATED_INPUTS,
  readProductInputs,
  assertCuratedSource,
  collectSourceProducts,
  verifyImageUrl,
  localizeTitle,
  stableInt,
  roundKmf,
} = require('./showcase-catalog');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_TARGET = 500;
const DEFAULT_OUTPUT = path.join(ROOT, 'data', 'catalogue-test-raw', 'showcase-curated-staging-500.json');
const CATEGORY_ORDER = Object.freeze(['Mode', 'Maison', 'Tech', 'Beauté', 'Sport', 'Enfant']);
const MIN_STOCK = 8;
const MAX_STOCK = 90;

const NAME_REPLACEMENTS = Object.freeze([
  [/\bwomen'?s\b/gi, 'femme'],
  [/\bmen'?s\b/gi, 'homme'],
  [/\bwireless\b/gi, 'sans fil'],
  [/\bbluetooth\b/gi, 'Bluetooth'],
  [/\bheadphones?\b/gi, 'casque audio'],
  [/\bearbuds?\b/gi, 'écouteurs'],
  [/\bsmart ?watch\b/gi, 'montre connectée'],
  [/\bbackpack\b/gi, 'sac à dos'],
  [/\bhandbag\b/gi, 'sac à main'],
  [/\bsneakers?\b/gi, 'baskets'],
  [/\bsandals?\b/gi, 'sandales'],
  [/\bboots?\b/gi, 'bottines'],
  [/\bt-?shirt\b/gi, 't-shirt'],
  [/\btrousers?\b/gi, 'pantalon'],
  [/\bpants\b/gi, 'pantalon'],
  [/\bjeans?\b/gi, 'jean'],
  [/\bjacket\b/gi, 'veste'],
  [/\bskirt\b/gi, 'jupe'],
  [/\bmascara\b/gi, 'mascara'],
  [/\bserum\b/gi, 'sérum'],
  [/\bmoisturi[sz]er\b/gi, 'soin hydratant'],
  [/\bsofa\b/gi, 'canapé'],
  [/\btable\b/gi, 'table'],
  [/\blamp\b/gi, 'lampe'],
  [/\bbottle\b/gi, 'bouteille'],
  [/\btoy\b/gi, 'jouet'],
  [/\bball\b/gi, 'ballon'],
  [/\bspeaker\b/gi, 'enceinte'],
  [/\bcharger\b/gi, 'chargeur'],
  [/\bcamera\b/gi, 'appareil photo'],
  [/\bkitchen\b/gi, 'cuisine'],
  [/\bwooden\b/gi, 'en bois'],
  [/\bleather\b/gi, 'en cuir'],
  [/\bblack\b/gi, 'noir'],
  [/\bwhite\b/gi, 'blanc'],
  [/\bblue\b/gi, 'bleu'],
  [/\bred\b/gi, 'rouge'],
  [/\bgreen\b/gi, 'vert'],
  [/\bpink\b/gi, 'rose'],
  [/\bgold\b/gi, 'doré'],
  [/\bsilver\b/gi, 'argenté'],
]);

const DESCRIPTION_TEMPLATES = Object.freeze({
  Mode: 'Sélection mode pensée pour un usage quotidien, avec une présentation simple et lisible pour les tests de navigation, panier et commande.',
  Maison: 'Article maison sélectionné pour tester une boutique réaliste, les catégories, le panier, les quantités et les parcours de commande.',
  Tech: 'Produit tech destiné aux scénarios de boutique et de commande, avec une fiche concise, un prix exploitable et un stock de test disponible.',
  Beauté: 'Produit beauté présenté avec une fiche courte et claire afin de tester correctement recherche, navigation, panier et affichage mobile.',
  Sport: 'Article sport sélectionné pour enrichir le catalogue de test avec une offre variée et un stock disponible pour les parcours E2E.',
  Enfant: 'Article enfant intégré au catalogue de test avec une fiche lisible, un stock positif et une catégorisation exploitable dans la boutique.',
});

function parseArgs(argv) {
  const out = { target: DEFAULT_TARGET, output: DEFAULT_OUTPUT, network: false, concurrency: 12 };
  const args = [...argv];
  for (let i = 0; i < args.length; i += 1) {
    const [key, inline] = args[i].split('=', 2);
    const next = () => inline ?? args[++i];
    if (key === '--target') out.target = Number.parseInt(next(), 10);
    else if (key === '--output') out.output = path.resolve(next());
    else if (key === '--concurrency') out.concurrency = Number.parseInt(next(), 10);
    else if (args[i] === '--network') out.network = true;
    else throw new Error(`Argument inconnu: ${args[i]}`);
  }
  if (!Number.isInteger(out.target) || out.target < 40 || out.target > 750) {
    throw new Error('--target doit être un entier entre 40 et 750');
  }
  if (!Number.isInteger(out.concurrency) || out.concurrency < 1 || out.concurrency > 25) {
    throw new Error('--concurrency doit être un entier entre 1 et 25');
  }
  return out;
}

function polishName(value) {
  let name = localizeTitle(value);
  for (const [pattern, replacement] of NAME_REPLACEMENTS) name = name.replace(pattern, replacement);
  name = name.replace(/\s+/g, ' ').replace(/\s+([,.;:])/g, '$1').trim();
  if (!name) return 'Sélection Komerce';
  return name.charAt(0).toUpperCase() + name.slice(1);
}

function curatedDescription(product, name) {
  const original = String(product.description || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const looksFrench = /\b(avec|pour|dans|une|des|du|de la|sans|sur|et)\b/i.test(original);
  if (looksFrench && original.length >= 40 && original.length <= 320) return original;
  return `${name}. ${DESCRIPTION_TEMPLATES[product.category] || DESCRIPTION_TEMPLATES.Maison}`;
}

function curateCandidate(product, finalIndex) {
  const name = polishName(product.name);
  const sourceImages = Array.isArray(product.images) ? product.images : [];
  const hero = String(product.image_url || sourceImages[0] || '').trim();
  return {
    product_ref: `KPR-${String(990001 + finalIndex).padStart(6, '0')}`,
    name,
    description: curatedDescription(product, name),
    category: product.category,
    subcategory: product.subcategory,
    price_kmf: roundKmf(product.price_kmf),
    promo_pct: product.promo_pct == null ? null : Number(product.promo_pct),
    stock: stableInt(`${product.source}:staging-stock-v1`, MIN_STOCK, MAX_STOCK),
    image_url: hero,
    images: [hero],
    source: product.source,
    source_url: product.source_url || null,
    source_title: String(product.name || '').trim() || null,
    sort_order: finalIndex,
    curated: true,
  };
}

function balancedSelection(candidates, count) {
  const buckets = new Map(CATEGORY_ORDER.map((category) => [category, []]));
  for (const product of candidates) {
    if (!buckets.has(product.category)) continue;
    buckets.get(product.category).push(product);
  }
  for (const bucket of buckets.values()) bucket.sort((a, b) => String(a.source).localeCompare(String(b.source)));

  const selected = [];
  while (selected.length < count) {
    let progressed = false;
    for (const category of CATEGORY_ORDER) {
      const next = buckets.get(category).shift();
      if (!next) continue;
      selected.push(next);
      progressed = true;
      if (selected.length === count) break;
    }
    if (!progressed) break;
  }
  return selected;
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

function summarize(products) {
  const categories = {};
  let stockUnits = 0;
  let minStock = Infinity;
  let maxStock = 0;
  for (const product of products) {
    categories[product.category] = (categories[product.category] || 0) + 1;
    const stock = Number(product.stock) || 0;
    stockUnits += stock;
    minStock = Math.min(minStock, stock);
    maxStock = Math.max(maxStock, stock);
  }
  return {
    products: products.length,
    categories,
    stock_units: stockUnits,
    min_stock: Number.isFinite(minStock) ? minStock : 0,
    max_stock: maxStock,
    out_of_stock: products.filter((product) => Number(product.stock) <= 0).length,
    unique_heroes: new Set(products.map((product) => product.image_url)).size,
    unique_sources: new Set(products.map((product) => product.source)).size,
  };
}

async function build(options) {
  const nucleus = readProductInputs(DEFAULT_CURATED_INPUTS);
  assertCuratedSource(nucleus);
  if (nucleus.length > options.target) throw new Error(`Noyau curaté trop grand: ${nucleus.length}/${options.target}`);
  if (nucleus.some((product) => Number(product.stock) <= 0)) throw new Error('Le noyau curaté contient au moins un produit sans stock');

  const needed = options.target - nucleus.length;
  const existingSources = new Set(nucleus.map((product) => product.source));
  const existingHeroes = new Set(nucleus.map((product) => product.image_url));
  const poolTarget = Math.max(options.target + 250, 750);
  const rawPool = await collectSourceProducts(poolTarget);
  const deduped = rawPool.filter((product) => (
    product.image_url
    && product.source
    && !existingSources.has(product.source)
    && !existingHeroes.has(product.image_url)
    && CATEGORY_ORDER.includes(product.category)
  ));
  const valid = options.network ? await verifyCandidates(deduped, options.concurrency) : deduped;
  const selected = balancedSelection(valid, needed);
  if (selected.length !== needed) {
    throw new Error(`Pool curatable insuffisant: ${selected.length}/${needed} après contrôle${options.network ? ' réseau' : ''}`);
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

  fs.mkdirSync(path.dirname(options.output), { recursive: true });
  fs.writeFileSync(options.output, `${JSON.stringify(curated, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ output: options.output, ...summary }, null, 2));
  return { products: curated, summary };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  await build(options);
}

if (require.main === module) {
  main().catch((error) => {
    console.error('[showcase:curate:500] échec:', error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  DEFAULT_TARGET,
  DEFAULT_OUTPUT,
  CATEGORY_ORDER,
  MIN_STOCK,
  MAX_STOCK,
  parseArgs,
  polishName,
  curatedDescription,
  curateCandidate,
  balancedSelection,
  summarize,
  build,
};
