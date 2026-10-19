/**
 * @komerce-arch-lite
 * @role          rct1-install-plan
 * @domain        economic-engine
 * @layer         script
 * @owner         backend-core
 * @purpose       Verifier les attendus independants de RCT1 avant orchestration canonique.
 * @impact-areas  staging-only, economic-engine, recette
 */
'use strict';

// Ce module n'installe rien. Le mode apply est refuse tant que chaque
// transition metier n'est pas reliee a son service canonique et testee.
const SCENARIOS = Object.freeze({
  E1: Object.freeze({
    ref: 'RCT1-E1', market: 'KM', payment: 'cash', product: 'P1',
    revenue_kmf: 15000,
    costs_kmf: Object.freeze({
      product_purchase: 6000, sourcing: 300, packaging: 200,
      hub: 400, shipping: 2000, port_transitaire: 500,
      customs: 0, local_distribution: 300, relay: 600,
    }),
    expected_margin_kmf: 4700,
  }),
  G: Object.freeze({
    ref: 'RCT1-G', market: 'KM', payment: 'cash', product: 'P3',
    revenue_kmf: 6000,
    costs_kmf: Object.freeze({
      product_purchase: 3000, sourcing: 150, packaging: 100,
      local_distribution: 300, relay: 600,
    }),
    not_applicable: Object.freeze(['hub', 'shipping', 'port_transitaire', 'customs', 'payment']),
    expected_margin_kmf: 1850,
  }),
});
const PRODUCTS = Object.freeze({
  P1: { ref: 'RCT1-P1', origin: 'IMPORT', local_price_kmf: 15000 },
  P2: { ref: 'RCT1-P2', origin: 'IMPORT', local_price_kmf: 25000, classification: 'UNVALIDATED' },
  P3: { ref: 'RCT1-P3', origin: 'LOCAL_STOCK', local_price_kmf: 6000 },
  P4: { ref: 'RCT1-P4', origin: 'IMPORT', km_price: null, cm_price_xaf: 20000 },
  P5: { ref: 'RCT1-P5', origin: 'IMPORT', source_price_eur: 100, expected_kmf: 49197, expected_xaf: 65596 },
});
function plan() {
  const calculated = Object.values(SCENARIOS).map(x => {
    const sum = Object.values(x.costs_kmf).reduce((a, b) => a + b, 0);
    const margin = x.revenue_kmf - sum;
    if (margin !== x.expected_margin_kmf) throw new Error('RCT1_EXPECTED_MARGIN_INVALID: ' + x.ref);
    return { reference: x.ref, expected_cost_kmf: sum, expected_margin_kmf: margin, simulation_scope: 'RCT1' };
  });
  const expected = calculated.reduce((a, v) => a + v.expected_margin_kmf, 0);
  if (expected !== 6550) throw new Error('RCT1_CONSOLIDATED_EXPECTATION_INVALID');
  return {
    mode: 'PLAN_ONLY', installation_confirmed: false, writes: 0,
    simulation_scope: 'RCT1', scenario_refs: Object.keys(SCENARIOS),
    product_refs: Object.values(PRODUCTS).map(p => p.ref),
    scenarios: calculated, consolidated_margin_kmf: expected,
    expected_p5_conversion: { km_kmf: PRODUCTS.P5.expected_kmf, cm_xaf: PRODUCTS.P5.expected_xaf },
    guards: ['target-guard before staging actions', 'scope before fictive costs',
      'no SQL seed', 'no RESET', 'idempotent replay required',
      'Stripe requires verified test mode', 'G1 disabled'],
    blocker: 'APPLY_NOT_IMPLEMENTED: canonical creation flows and replay proofs required',
  };
}
if (require.main === module) {
  if (process.argv.includes('--apply')) {
    process.stderr.write('REFUS: APPLY_NOT_IMPLEMENTED - aucun acces staging ni ecriture.\n');
    process.exitCode = 2;
  } else {
    process.stdout.write(JSON.stringify(plan(), null, 2) + '\n');
  }
}
module.exports = { SCENARIOS, PRODUCTS, plan };
