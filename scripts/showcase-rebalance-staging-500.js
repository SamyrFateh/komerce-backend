#!/usr/bin/env node
/**
 * @komerce-arch
 * @role staging-showcase-category-rebalancer
 * @domain catalog
 * @layer script
 * @criticality low
 * @inputs curated 500-product fixture, targeted Wikimedia Commons candidates
 * @outputs same-size fixture with minimum category coverage
 * @db-read none
 * @db-write none
 * @doctrine staging fixture only; preserves curated nucleus and total product count
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { assertCuratedSource } = require('./showcase-catalog');
const { CATEGORY_ORDER, curateCandidate, summarize } = require('./showcase-curate-staging-500');
const { fetchCommonsQuery } = require('./showcase-curate-staging-500-hybrid');

const INPUT = path.resolve(__dirname, '../data/catalogue-test-raw/showcase-curated-staging-500.json');
const FLOOR = 24;
const NUCLEUS = 40;
const QUERIES = Object.freeze({
  Enfant: [
    ['toy product photograph', 'Jouets', /\b(toy|doll|blocks|puzzle|plush|teddy|rattle|game)\b/i],
    ['toy car product photograph', 'Jouets', /\b(toy|car|vehicle|truck|train)\b/i],
    ['doll toy product photograph', 'Jouets', /\b(doll|toy|figure)\b/i],
    ['building blocks toy photograph', 'Jouets', /\b(blocks|building|lego|brick|toy)\b/i],
    ['plush toy product photograph', 'Jouets', /\b(plush|teddy|stuffed|toy)\b/i],
  ],
  Sport: [
    ['sports ball product photograph', 'Sports collectifs', /\b(ball|football|basketball|volleyball|handball)\b/i],
    ['dumbbell fitness product photograph', 'Fitness', /\b(dumbbell|weight|barbell|kettlebell|fitness)\b/i],
    ['yoga mat product photograph', 'Fitness', /\b(yoga|mat|fitness|exercise)\b/i],
    ['sports racket product photograph', 'Fitness', /\b(racket|racquet|tennis|badminton|padel)\b/i],
  ],
});

function counts(products) {
  const out = Object.fromEntries(CATEGORY_ORDER.map((category) => [category, 0]));
  for (const product of products) if (product && out[product.category] !== undefined) out[product.category] += 1;
  return out;
}

function donorIndex(products, totals, floor = FLOOR) {
  let donor = null;
  for (const category of CATEGORY_ORDER) {
    if (totals[category] <= floor) continue;
    if (!donor || totals[category] > totals[donor]) donor = category;
  }
  if (!donor) return -1;
  for (let i = products.length - 1; i >= NUCLEUS; i -= 1) if (products[i]?.category === donor) return i;
  return -1;
}

function applyFloor(products, candidateMap, floor = FLOOR) {
  const out = products.map((product) => ({ ...product }));
  const before = counts(out);
  const totals = { ...before };
  const sources = new Set(out.map((product) => product.source));
  const heroes = new Set(out.map((product) => product.image_url));
  let replacements = 0;

  for (const category of Object.keys(candidateMap)) {
    for (const candidate of candidateMap[category]) {
      if (totals[category] >= floor) break;
      if (!candidate?.source || !candidate?.image_url || sources.has(candidate.source) || heroes.has(candidate.image_url)) continue;
      const index = donorIndex(out, totals, floor);
      if (index < 0) break;
      const removed = out[index];
      sources.delete(removed.source);
      heroes.delete(removed.image_url);
      totals[removed.category] -= 1;
      out[index] = curateCandidate(candidate, index);
      sources.add(out[index].source);
      heroes.add(out[index].image_url);
      totals[category] += 1;
      replacements += 1;
    }
  }
  return { products: out, before, after: counts(out), replacements };
}

async function collect(products, floor = FLOOR) {
  const current = counts(products);
  const existingSources = new Set(products.map((product) => product.source));
  const existingHeroes = new Set(products.map((product) => product.image_url));
  const result = {};
  for (const [category, queries] of Object.entries(QUERIES)) {
    const missing = Math.max(0, floor - current[category]);
    if (!missing) continue;
    const rows = [];
    const seen = new Set();
    for (const [query, subcategory, signal] of queries) {
      const batch = await fetchCommonsQuery(query, category, subcategory, 50, fetch, signal); // eslint-disable-line no-await-in-loop
      for (const row of batch) {
        const key = `${row.source}|${row.image_url}`;
        if (existingSources.has(row.source) || existingHeroes.has(row.image_url) || seen.has(key)) continue;
        seen.add(key);
        rows.push(row);
      }
      if (rows.length >= missing + 8) break;
    }
    result[category] = rows;
    console.log(`[showcase:rebalance] ${category}: missing=${missing}, candidates=${rows.length}`);
  }
  return result;
}

async function main() {
  const input = process.argv[2] ? path.resolve(process.argv[2]) : INPUT;
  const products = JSON.parse(fs.readFileSync(input, 'utf8'));
  if (!Array.isArray(products) || products.length !== 500) throw new Error('Le rééquilibrage exige exactement 500 produits');
  assertCuratedSource(products);
  const candidateMap = await collect(products);
  const result = applyFloor(products, candidateMap);
  const deficient = Object.entries(result.after).filter(([, value]) => value < FLOOR);
  if (deficient.length) throw new Error(`Couverture insuffisante: ${deficient.map(([k, v]) => `${k}=${v}/${FLOOR}`).join(', ')}`);
  assertCuratedSource(result.products);
  const summary = summarize(result.products);
  if (summary.products !== 500 || summary.out_of_stock !== 0 || summary.unique_heroes !== 500 || summary.unique_sources !== 500) throw new Error('Invariant catalogue cassé après rééquilibrage');
  fs.writeFileSync(input, `${JSON.stringify(result.products, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ replacements: result.replacements, before: result.before, after: result.after, ...summary }, null, 2));
}

if (require.main === module) main().catch((error) => { console.error('[showcase:rebalance:500] échec:', error.message); process.exitCode = 1; });

module.exports = { FLOOR, NUCLEUS, QUERIES, counts, donorIndex, applyFloor, collect };
