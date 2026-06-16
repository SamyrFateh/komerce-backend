'use strict';
// Vérifie que la calibration par benchmark change le diagnostic et la confiance.
const dbPath = require.resolve('./db');

let BENCH = []; // injecté par le test
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: {
  query: async (sql) => {
    if (/FROM cost_benchmarks/.test(sql)) return { rows: BENCH };
    return { rows: [] };
  },
} };

const engine = require('./services/pricing-engine');

const config = {
  finance: { target_marge_brute_pct: 40, taux_change_eur_kmf: 492, fret_eur_per_m3: 180, taux_aed_kmf: 138,
    objectif_commandes_mois: 80, avg_articles_per_order: 2.5, avg_articles_per_parcel: 4, avg_articles_per_shipment: 200,
    minimum_safety_margin_pct: 10, allocation_confidence: 'low' },
  categories: { phones: { key: 'phones', douane_pct: 5, tva_pct: 0, taxe_add_pct: 0, default_margin_pct: 40 } },
  components: [
    { key: 'hub_fee', category: 'hub', unit: 'kmf', default_value: 2500 }, // ~20% du CDR → gros
    { key: 'cash_fee', category: 'payment', unit: 'kmf_per_order', default_value: 800 },
  ],
  provisions: [{ rate_pct: 2 }],
  charges: [{ recurrence_period: 'monthly', amount_kmf: 420000 }],
};
const input = { category: 'phones', cost_kmf: 6000, weight_kg: 0.3, current_price_kmf: 12990 };

function hub(reco) { return reco.proportions.lines.find(l => l.cost_key === 'hub'); }

(async () => {
  let ok = true;
  const check = (l, c) => { console.log((c ? '✓' : '✗ ÉCHEC') + ' ' + l); if (!c) ok = false; };

  // 1. Sans benchmark → heuristique
  config.cost_benchmarks = [];
  let r = await engine.recommend(input, { config });
  let h = hub(r);
  console.log(`Hub : ${h.share_of_cdr_pct}% du CDR → ${h.diagnostic} (${h.basis})`);
  check('sans benchmark : Hub en surcharge heuristique', h.diagnostic === 'surcharge' && h.basis === 'heuristic');
  check('confiance globale basse', r.proportions.confidence === 'low');

  // 2. Benchmark Hub attendu 8% → reste surcharge mais CALIBRÉ
  config.cost_benchmarks = [{ category: 'all', cost_family: 'hub', expected_share_pct: 8, warn_ratio: 1.3, alert_ratio: 1.6 }];
  r = await engine.recommend(input, { config });
  h = hub(r);
  console.log(`Hub vs attendu 8% : ${h.share_of_cdr_pct}% → ${h.diagnostic} (${h.basis}, attendu ${h.expected_share_pct}%)`);
  check('benchmark 8% : Hub surcharge calibrée', h.diagnostic === 'surcharge' && h.basis === 'benchmark');
  check('confiance Hub haute', h.confidence === 'high');

  // 3. Benchmark Hub attendu 30% → devient normal (le Hub est dans la norme calibrée)
  config.cost_benchmarks = [{ category: 'all', cost_family: 'hub', expected_share_pct: 30, warn_ratio: 1.3, alert_ratio: 1.6 }];
  r = await engine.recommend(input, { config });
  h = hub(r);
  console.log(`Hub vs attendu 30% : ${h.share_of_cdr_pct}% → ${h.diagnostic} (${h.basis})`);
  check('benchmark 30% : Hub redevient normal', h.diagnostic === 'normal' && h.basis === 'benchmark');

  // 4. Précédence catégorie : phones override 'all'
  config.cost_benchmarks = [
    { category: 'all',    cost_family: 'hub', expected_share_pct: 30 },
    { category: 'phones', cost_family: 'hub', expected_share_pct: 8 },
  ];
  r = await engine.recommend(input, { config });
  h = hub(r);
  check('précédence catégorie : phones (8%) l\'emporte → surcharge', h.diagnostic === 'surcharge' && h.expected_share_pct === 8);

  console.log('\n' + (ok ? '✅ CALIBRATION PAR BENCHMARK OPÉRATIONNELLE' : '❌ ÉCHEC'));
  process.exit(ok ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
