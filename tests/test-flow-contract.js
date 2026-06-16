'use strict';
const dbPath = require.resolve('./db');
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true,
  exports: { query: async () => ({ rows: [] }) } };

const engine = require('./services/pricing-engine');

const config = {
  finance: { target_marge_brute_pct: 40, taux_aed_kmf: 138, taux_change_eur_kmf: 492,
    fret_eur_per_m3: 180, objectif_commandes_mois: 80, avg_articles_per_order: 2.5,
    avg_articles_per_parcel: 4, avg_articles_per_shipment: 200, minimum_safety_margin_pct: 10,
    allocation_confidence: 'low' },
  categories: { phones: { key: 'phones', douane_pct: 5, tva_pct: 0, taxe_add_pct: 0, default_margin_pct: 40 } },
  components: [
    { key: 'packaging_box', category: 'packaging', unit: 'kmf_per_parcel', default_value: 1200 },
    { key: 'freight_sea', category: 'freight', unit: 'kmf_per_shipment', default_value: 60000 },
    { key: 'relay_commission', category: 'relay', unit: 'kmf', default_value: 500 },
    { key: 'cash_fee', category: 'payment', unit: 'kmf_per_order', default_value: 800 },
  ],
  provisions: [{ rate_pct: 2 }],
  charges: [{ recurrence_period: 'monthly', amount_kmf: 420000 }],
};

(async () => {
  const reco = await engine.recommend(
    { category: 'phones', cost_kmf: 6000, weight_kg: 0.3, current_price_kmf: 12990,
      pricing_strategy: 'loss_leader', final_price_kmf: 9000 },
    { config }
  );

  const required = [
    'category','channel','current_price_kmf',
    'n1_landed_relay_cost_kmf','n2_business_variable_cost_kmf','variable_cost_complete_kmf',
    'contribution_kmf','n3_fixed_overhead_allocation_kmf','cdr_complete_kmf',
    'minimum_safe_price_kmf','recommended_price_kmf','final_price_kmf',
    'pricing_strategy','strategy_risk','safety_margin_pct',
    'sourcing_decision','data_quality','allocations','allocation_averages',
    'scenarios','cost_breakdown','monthly_fixed_costs_kmf','target_orders_per_month','warnings',
  ];

  let ok = true;
  console.log('── Présence des champs du contrat (vue flux) ─────────────────');
  required.forEach(k => {
    const present = reco[k] !== undefined;
    if (!present) ok = false;
    console.log((present ? '✓' : '✗ MANQUANT') + ' ' + k + (present && typeof reco[k] !== 'object' ? ' = ' + reco[k] : ''));
  });

  console.log('\n── Cohérence loss_leader (prix final 9000 < CDR) ─────────────');
  console.log('strategy_risk :', reco.strategy_risk, '| cost_breakdown.business :', JSON.stringify(reco.cost_breakdown.business));
  const f = reco;
  const checks = [
    ['final_price_kmf reflète l\'override', f.final_price_kmf === 9000],
    ['strategy_risk = undercovered (9000 entre variable et CDR) OU destructive', ['undercovered','destructive'].includes(f.strategy_risk)],
    ['variable_cost_complete = N1 + N2', f.variable_cost_complete_kmf === f.n1_landed_relay_cost_kmf + f.n2_business_variable_cost_kmf],
    ['cdr_complete = variable + N3', f.cdr_complete_kmf === f.variable_cost_complete_kmf + f.n3_fixed_overhead_allocation_kmf],
    ['allocations non vide', Array.isArray(f.allocations) && f.allocations.length > 0],
    ['scenarios non vide', Array.isArray(f.scenarios) && f.scenarios.length > 0],
  ];
  checks.forEach(([l, c]) => { if (!c) ok = false; console.log((c ? '✓' : '✗') + ' ' + l); });

  console.log('\n' + (ok ? '✅ CONTRAT VUE FLUX COMPLET' : '❌ CONTRAT INCOMPLET'));
  process.exit(ok ? 0 : 1);
})();
