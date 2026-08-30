#!/usr/bin/env node
'use strict';

const { TRACKED_SELECTORS, selectorMap } = require('./gen-boutique-arch-live.js');
const { evaluateSelectorOwnership } = require('./critical-selector-ownership.js');

function run(map = selectorMap(), tracked = TRACKED_SELECTORS) {
  const result = evaluateSelectorOwnership(map, tracked);

  console.log('\nCritical selector ownership guard');
  console.log(`${result.rows.length} sélecteur(s) critique(s) vérifié(s).`);

  if (!result.ok) {
    console.error(`\n✖ ${result.errors.length} violation(s) d'ownership :`);
    for (const error of result.errors) console.error(`  - ${error.message}`);
    return 1;
  }

  const multiOwner = result.rows.filter(row => row.observed.length > 1).length;
  console.log(`✔ Contrat respecté — 0 owner non autorisé, ${multiOwner} sélecteur(s) avec adaptations explicites.`);
  return 0;
}

if (require.main === module) process.exitCode = run();

module.exports = { run };
