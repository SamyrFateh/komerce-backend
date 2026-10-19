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
const pricing = require('./steps-pricing');
const orders = require('./steps-orders');
const ops = require('./steps-ops');
const costs = require('./steps-costs');
const split = require('./steps-split');
const markets = require('./steps-markets');
const checks = require('./steps-checks');

const steps = [...foundation.steps, ...pricing.steps, ...orders.steps, ...ops.steps, ...costs.steps, ...split.steps, ...markets.steps, ...checks.steps];
module.exports = { steps };
