#!/usr/bin/env node
'use strict';

/**
 * LOT 0C-eco — preflight avant capture du Golden CDR CURRENT.
 *
 * Refuse une capture si un témoin prétend être une catégorie normale alors
 * que cette catégorie n'existe pas dans la config DB réellement chargée.
 * Le seul inconnu intentionnel autorisé est ghost_category_xyz, qui couvre
 * explicitement le fallback douane.
 *
 * Usage :
 *   node tools/golden-cdr/preflight-capture.js
 *   node tools/golden-cdr/preflight-capture.js --json
 */

const path = require('path');
const { loadGlobalConfig } = require(path.resolve(__dirname, '../../services/pricing-cdr.js'));
const witnesses = require('./witnesses');

const INTENTIONAL_UNKNOWN = new Set(['ghost_category_xyz']);

function analyze(config, list = witnesses) {
  const known = new Set(Object.keys(config?.categories || {}));
  const rows = list.map(w => {
    const category = w?.product?.category || null;
    const intentional_unknown = INTENTIONAL_UNKNOWN.has(category);
    return {
      id: w.id,
      category,
      known: known.has(category),
      intentional_unknown,
    };
  });

  const unexpected = rows.filter(r => !r.known && !r.intentional_unknown);
  const intentional = rows.filter(r => !r.known && r.intentional_unknown);
  const coveredKnownCategories = [...new Set(rows.filter(r => r.known).map(r => r.category))].sort();
  const uncoveredKnownCategories = [...known].filter(k => !coveredKnownCategories.includes(k)).sort();

  return {
    config_categories: [...known].sort(),
    witness_count: rows.length,
    covered_known_categories: coveredKnownCategories,
    uncovered_known_categories: uncoveredKnownCategories,
    intentional_unknown: intentional,
    unexpected_unknown: unexpected,
    witnesses: rows,
  };
}

function printHuman(r) {
  console.log('Golden CDR — preflight catégories');
  console.log(`Catégories config : ${r.config_categories.join(', ') || '(aucune)'}`);
  console.log(`Témoins            : ${r.witness_count}`);
  console.log(`Couvertes           : ${r.covered_known_categories.join(', ') || '(aucune)'}`);
  console.log(`Non couvertes       : ${r.uncovered_known_categories.join(', ') || '(aucune)'}`);
  if (r.intentional_unknown.length) {
    console.log(`Inconnu volontaire  : ${r.intentional_unknown.map(x => `${x.id}:${x.category}`).join(', ')}`);
  }
  if (r.unexpected_unknown.length) {
    console.log('\n✗ Catégories témoins absentes de la config réelle :');
    for (const x of r.unexpected_unknown) console.log(`  - ${x.id}: ${x.category}`);
    console.log('Capture REFUSÉE : corriger les témoins avant de figer le Golden CURRENT.');
  } else {
    console.log('\n✓ Preflight OK — aucune catégorie témoin fantôme non intentionnelle.');
  }
}

async function main() {
  const config = await loadGlobalConfig();
  const result = analyze(config);
  if (process.argv.includes('--json')) console.log(JSON.stringify(result, null, 2));
  else printHuman(result);
  process.exit(result.unexpected_unknown.length ? 1 : 0);
}

if (require.main === module) {
  main().catch(err => {
    console.error(`✗ Preflight impossible : ${err.message}`);
    process.exit(2);
  });
}

module.exports = { analyze, INTENTIONAL_UNKNOWN };
