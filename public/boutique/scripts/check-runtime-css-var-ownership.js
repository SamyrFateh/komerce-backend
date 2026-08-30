#!/usr/bin/env node
'use strict';

const { JS_OWNED_VARS, jsVarOwners } = require('./gen-boutique-arch-live.js');
const { evaluateRuntimeCssVarOwnership } = require('./runtime-css-var-ownership.js');

const result = evaluateRuntimeCssVarOwnership(jsVarOwners(), JS_OWNED_VARS);

console.log('\nRuntime CSS variable ownership guard');
console.log(`${JS_OWNED_VARS.length} variable(s) runtime vérifiée(s).`);

if (!result.ok) {
  for (const error of result.errors) console.error(`✖ ${error.message}`);
  process.exit(1);
}

const multiProducer = result.rows.filter(row => row.observed.length > 1).length;
console.log(`✔ Contrat respecté — 0 producteur non autorisé, ${multiProducer} variable(s) multi-producteur explicitement contractée(s).`);
