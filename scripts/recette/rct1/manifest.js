/**
 * @komerce-arch-lite
 * @role          rct1-manifest
 * @domain        economic-engine
 * @layer         script
 * @owner         backend-core
 * @purpose       Manifeste declaratif des etapes RCT1 (assemble les modules d'etapes).
 * @impact-areas  staging-only, economic-engine, recette
 */
'use strict';
const foundation = require('./steps-foundation');
const orders = require('./steps-orders');

const steps = [...foundation.steps, ...orders.steps];
module.exports = { steps };
