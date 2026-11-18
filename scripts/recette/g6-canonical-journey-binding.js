/**
 * @komerce-arch-lite
 * @role g6-canonical-browser-journey-binding
 * @domain orders
 * @layer test
 * @owner backend-core
 * @purpose Bind existing Chromium gestures to one G6 scenario and the same order ref; never duplicate the business matrix.
 * @impact-areas checkout, payment, staging-only
 */
'use strict';

// Business truth lives only in the original G6 catalogue, NOT in a new matrix.
const business = require('../../docs/recette/G6_PRE_STRESS_BUSINESS_SCENARIOS.json');
const REPLAYABLE_IMPORT_CASH = new Set(['M01', 'M04', 'M05']);
const ORDER_REF = /^[A-Z0-9][A-Z0-9-]{5,63}$/;
const LEGACY_REFS = Object.freeze({KM:'K18SFYN', CM:'KW34OBY', CG:'KSJWLND'});

function canonicalScenario(id, market) {
  if (!/^(?:M0[1-6]|N(?:0[1-9]|[1-3][0-9]|40))$/.test(String(id || ''))) {
    throw new Error('G6_SCENARIO_ID_INVALID');
  }
  const scenario = business.scenarios.find(s => s.id === id);
  if (!scenario) throw new Error('G6_SCENARIO_NOT_IN_ORIGINAL_MATRIX');
  if (!scenario.markets.includes(market)) throw new Error('G6_MARKET_OUTSIDE_SCENARIO');
  return scenario;
}

function resolveCanonicalReplay(env = process.env) {
  const id = String(env.G6_CANONICAL_SCENARIO || '').trim().toUpperCase();
  const market = String(env.G6_TARGET_MARKET || '').trim().toUpperCase();
  const scenario = canonicalScenario(id, market);
  if (!REPLAYABLE_IMPORT_CASH.has(id) || scenario.kind !== 'nominal') {
    throw new Error('G6_EXISTING_BUYER_CASH_ADAPTER_NOT_BOUND_FOR_SCENARIO_' + id);
  }
  return { id: scenario.id, market, source_version: business.version, scenario_title: scenario.title };
}

// The legacy three-market proof remains unchanged when no canonical variables
// are passed. For a canonical replay, use exactly the ONE order created by its
// preceding Chromium checkout, with no fallback to historic hardcoded refs.
function resolveRelayCashRefs(env = process.env) {
  const id = env.G6_CANONICAL_SCENARIO, market = env.G6_CANONICAL_MARKET;
  const reference = env.G6_CANONICAL_ORDER_REFERENCE;
  const supplied = [id, market, reference].filter(v => v !== undefined && v !== '').length;
  if (supplied === 0) return { ...LEGACY_REFS };
  if (supplied !== 3) throw new Error('G6_CANONICAL_CASH_BINDING_INCOMPLETE');
  const checked = resolveCanonicalReplay({
    G6_CANONICAL_SCENARIO: id,
    G6_TARGET_MARKET: market
  });
  if (!ORDER_REF.test(String(reference))) throw new Error('G6_CANONICAL_ORDER_REFERENCE_INVALID');
  return { [checked.market]: String(reference) };
}

module.exports = { business, canonicalScenario, resolveCanonicalReplay, resolveRelayCashRefs };
