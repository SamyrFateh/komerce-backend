/**
 * @komerce-arch
 * @role          pricing-floor-forecast-shadow-demonstration
 * @domain        economic-engine
 * @layer         script
 * @criticality   low
 * @inputs        hypothetical_documented_examples
 * @outputs       stdout_only_no_persistence
 * @depends       services/pricing-floor-forecast-shadow.js
 * @used-by       local_reproducible_analysis
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      docs/doctrine/PRICING_FLOOR_FORECAST_SHADOW.md
 * @impact-areas  economic-engine
 * @version       2026-11
 */
'use strict';
const { comparePrices } = require('../../services/pricing-floor-forecast-shadow');

// Tous les coûts, tarifs, volumes et bornes ci-dessous sont ILLUSTRATIFS.
// EUR/KMF fixe ; les taux dynamiques doivent venir de l'autorité FX canonique.
const EUR_KMF = 491.96;
const DATE = '2026-11-11';
const proof = { status: 'ASSUMED', reference: 'DEMONSTRATION uniquement — aucun devis ni facture',
  as_of: DATE, expires_on: '2026-12-11' };
const l = (code, stage, basis, value, options = {}) =>
  ({ code, stage, basis, value, evidence: proof, market_code: 'KM', ...options });

const corridors = {
  favorable:   { fret: 150, lot: 5, forfait: 80000, douane: 0, final: 400, bank: 1, casse: .5, nonpickup: 2 },
  central:     { fret: 180, lot: 3, forfait: 110000, douane: 20, final: 500, bank: 1.5, casse: 1, nonpickup: 5 },
  defavorable: { fret: 250, lot: 1.5, forfait: 150000, douane: 42, final: 700, bank: 2, casse: 3, nonpickup: 10 },
};
const products = [
  { name: 'Écouteurs IMPORT (hypothèse)', circuit: 'import', purchase: 8 * EUR_KMF, delivery: 1.5 * EUR_KMF,
    volume: .0008, weight: .15, packaging: 50, prices: [7500, 9000, 12000] },
  { name: 'Ventilateur IMPORT (hypothèse)', circuit: 'import', purchase: 25 * EUR_KMF, delivery: 4 * EUR_KMF,
    volume: .06, weight: 6, packaging: 600, prices: [22000, 27000, 32000] },
  { name: 'Smartphone IMPORT (hypothèse)', circuit: 'import', purchase: 120 * EUR_KMF, delivery: 3 * EUR_KMF,
    volume: .0015, weight: .5, packaging: 80, prices: [75000, 85000, 95000] },
  { name: 'Accessoire LOCAL (hypothèse)', circuit: 'local', purchase: 5000,
    volume: .0008, weight: .15, packaging: 0, prices: [7500, 9000, 12000] },
];
function components(p, c) {
  if (p.circuit === 'local') {
    return [
      l('local_delivery', 'N1', 'fixed_order', c.final, { circuit: 'local' }),
      l('relay_commission', 'N2', 'fixed_order', 600, { circuit: 'local' }),
      l('payment', 'N2', 'fixed_order', 200, { circuit: 'local' }),
    ];
  }
  return [
    l('supplier_delivery', 'N1', 'fixed_unit', p.delivery, { cif_included: true, circuit: 'import' }),
    l('bank_fee', 'N1', 'pct_purchase', c.bank),
    l('hub_consumables', 'N1', 'fixed_unit', 50),
    l('packaging', 'N1', 'fixed_unit', p.packaging),
    l('freight', 'N1', 'fret_m3_minimum', c.fret * EUR_KMF, {
      minimum_billable_m3: 1, lot_volume_m3: c.lot, cif_included: true, circuit: 'import' }),
    l('transitaire', 'N1', 'lot_fixed_m3', c.forfait, { lot_volume_m3: c.lot, circuit: 'import' }),
    l('insurance', 'N1', 'pct_cif', .5),
    l('customs_duties', 'N1', 'pct_cif', c.douane, { circuit: 'import' }),
    l('last_mile', 'N1', 'fixed_order', c.final),
    l('relay_commission', 'N2', 'fixed_order', 600),
    l('payment', 'N2', 'fixed_order', 200),
    l('risk_damage', 'N2', 'pct_n1', c.casse),
    l('risk_nonpickup', 'N2', 'pct_exposure', c.nonpickup, { base_codes: ['last_mile', 'relay_commission'] }),
  ];
}
for (const p of products) {
  const input = {
    market_code: 'KM', valuation_date: DATE,
    product: { circuit: p.circuit, purchase_kmf: p.purchase, volume_m3: p.volume,
      weight_kg: p.weight, purchase_evidence: proof },
    scenarios: Object.fromEntries(Object.entries(corridors).map(([name, cfg]) => [name, components(p, cfg)])),
    candidate_prices_kmf: p.prices,
    n3_monthly_kmf: 2138000, // Simulation uniquement, pas une N3 réellement payée.
  };
  const report = comparePrices(input);
  console.log('\n' + p.name + ' — ' + report.status);
  console.log('P0 central :', report.plancher_central_kmf, 'KMF ; scénario défavorable :',
    report.plancher_prudent_kmf, 'KMF');
  for (const price of report.prices)
    console.log(price.price_kmf, 'KMF ->', price.verdict || price.status, '/',
      price.decision_quality || '-', '/ contribution centrale', price.contribution_centrale_kmf);
}
console.log('\nAucun devis, aucun paiement, aucune écriture ni prix actif : DÉMONSTRATION EN SHADOW.');
