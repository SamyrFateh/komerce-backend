'use strict';
// Stub DB
const dbPath = require.resolve('./db');
const products = [
  { id: 'A', name: 'Produit perte',   category: 'phones', price_kmf: 8000,  cost_kmf: 6000, weight_kg: 0.3 },
  { id: 'B', name: 'Produit aligné',  category: 'phones', price_kmf: 23990, cost_kmf: 6000, weight_kg: 0.3 },
  { id: 'C', name: 'Produit sans prix',category:'phones', price_kmf: 0,     cost_kmf: 6000, weight_kg: 0.3 },
];
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: {
  query: async (sql) => {
    if (/FROM finance_config/.test(sql)) return { rows: [{ target_marge_brute_pct: 40, objectif_commandes_mois: 80 }] };
    if (/FROM products/.test(sql))       return { rows: products };
    if (/GREATEST/.test(sql))            return { rows: [{ last_change: '2026-06-10T00:00:00Z' }] };
    return { rows: [] };
  },
} };

// Stub moteur : recommend() = SEULE source. Le dashboard ne doit utiliser QUE ces champs.
const enginePath = require.resolve('./services/pricing-engine');
const CDR = 14007, RECO = 23990, N3 = 5250, VAR = 9000;
require.cache[enginePath] = { id: enginePath, filename: enginePath, loaded: true, exports: {
  loadGlobalConfig: async () => ({ finance: {}, categories: {}, components: [], provisions: [], charges: [] }),
  recommend: async (input) => {
    const price = Number(input.current_price_kmf) || 0;
    const margin = price > 0 ? Math.round((1 - CDR / price) * 1000) / 10 : null;
    return {
      cdr_complete_kmf: CDR, recommended_price_kmf: RECO, current_price_kmf: price,
      variable_cost_complete_kmf: VAR,
      n3_fixed_overhead_allocation_kmf: N3, estimated_margin_pct: margin,
      health_status: price > 0 && price < CDR ? 'loss' : (margin >= 40 ? 'healthy' : 'fragile'),
      sourcing_decision: price > 0 && price < CDR ? 'LOSS' : 'TEST',
      market_confidence: 'unknown',
    };
  },
} };

const { computeDashboard } = require('./services/pricing-dashboard');

(async () => {
  const out = await computeDashboard();
  let ok = true;
  function check(label, cond) { console.log((cond ? '✓' : '✗ ÉCHEC') + ' ' + label); if (!cond) ok = false; }

  console.log('── KPIs renvoyés ─────────────────────────────────────────────');
  console.log(JSON.stringify(out.kpis, null, 2));
  console.log('\n── doctrine ──────────────────────────────────────────────────');
  console.log(JSON.stringify(out.doctrine, null, 2));
  console.log('');

  console.log('── Invariants single-source ──────────────────────────────────');
  check('source_of_truth = pricing-engine', out.kpis.source_of_truth === 'pricing-engine');
  check('niveau2_kmf = N3 du moteur (5250)', out.kpis.niveau2_kmf === N3);
  check('alias n3_fixed_overhead_allocation_kmf présent', out.kpis.n3_fixed_overhead_allocation_kmf === N3);
  check('1 produit à perte (prix 8000 < CDR 14007)', out.kpis.nb_at_loss === 1);
  check('alerte sale_at_loss présente', out.alerts.some(a => a.code === 'sale_at_loss'));
  check('1 produit aligné (prix 23990 = conseillé)', out.kpis.nb_aligned === 1);
  check('1 produit sans prix', out.kpis.nb_unset === 1);
  check('distribution health alimentée (sample 3)', out.doctrine.sample_size === 3);
  check('1 verdict LOSS dans la distribution', out.doctrine.by_sourcing.LOSS === 1);
  check('frontières exposées (catalogue par article)', !!out.frontiers);
  check('produit prix 8000 < coût variable 9000 → destructif', out.frontiers.destructive === 1);
  check('produit prix 23990 ≥ CDR → couvert', out.frontiers.covered === 1);
  check('produit sans prix → unpriced', out.frontiers.unpriced === 1);

  console.log('');
  console.log(ok ? '✅ DASHBOARD BRANCHÉ SUR LE MOTEUR — VÉRITÉ UNIQUE' : '❌ ÉCHEC');
  process.exit(ok ? 0 : 1);
})();
