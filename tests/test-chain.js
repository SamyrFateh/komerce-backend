'use strict';
// Stub DB avant tout require de service (évite pg / connexion réelle)
const dbPath = require.resolve('./db');
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true,
  exports: { query: async () => ({ rows: [] }), pool: {} } };

const { computeCDR } = require('./services/pricing-cdr');
const { computePrices, buildCostBreakdown } = require('./services/pricing-output');

const config = {
  finance: {
    target_marge_brute_pct: 40, taux_aed_kmf: 138, taux_change_eur_kmf: 492,
    fret_eur_per_m3: 180, objectif_commandes_mois: 80,
    avg_articles_per_order: 2.5, avg_articles_per_parcel: 4, avg_articles_per_shipment: 200,
    minimum_safety_margin_pct: 10,
  },
  categories: { phones: { key: 'phones', douane_pct: 5, tva_pct: 0, taxe_add_pct: 0, default_margin_pct: 40 } },
  components: [
    { key: 'sourcing_fee',     category: 'sourcing',  unit: 'kmf',              default_value: 400  },
    { key: 'packaging_box',    category: 'packaging', unit: 'kmf_per_parcel',   default_value: 1200 }, // /4 = 300
    { key: 'freight_sea',      category: 'freight',   unit: 'kmf_per_shipment', default_value: 60000 }, // /200 = 300
    { key: 'relay_commission', category: 'relay',     unit: 'kmf',              default_value: 500  },
    { key: 'cash_fee',         category: 'payment',   unit: 'kmf_per_order',    default_value: 800  }, // /2.5 = 320
  ],
  provisions: [{ rate_pct: 2 }],
  charges: [{ recurrence_period: 'monthly', amount_kmf: 420000 }],
};

const product = { id: 'p1', category: 'phones', cost_kmf: 6000, weight_kg: 0.3 };
const ctx = { config, volume_m3: 0.005, channel: 'cash_relais' };

const cdr = computeCDR(product, ctx);
const prices = computePrices(cdr, config.categories.phones, config.finance);
const bk = buildCostBreakdown(cdr.details);

// Dérivation doctrinale (identique à pricing-engine.recommend)
const n1 = bk.landed_relay_cost_kmf;
const n2 = bk.business.payment + bk.business.risk_provision;
const variableComplete = n1 + n2;
const n3 = bk.business.fixed_overhead;
const cdrComplete = variableComplete + n3;

const price = 12990;
const contribution = price - variableComplete;
const marginComplete = price - cdrComplete;

const f = n => new Intl.NumberFormat('fr-FR').format(Math.round(n));
console.log('── Chaîne économique (config doctrine) ───────────────────────');
console.log('N1 coût rendu relais        :', f(n1), 'KMF');
console.log('  dont paiement (N2 part)   :', f(bk.business.payment), '| risque:', f(bk.business.risk_provision));
console.log('N2 business variable        :', f(n2), 'KMF');
console.log('Coût variable complet (N1+N2):', f(variableComplete), 'KMF   ← frontière rouge');
console.log('N3 charges fixes imputées   :', f(n3), 'KMF');
console.log('CDR complet (N1+N2+N3)      :', f(cdrComplete), 'KMF   ← frontière couverture');
console.log('Prix plancher (min_safe)    :', f(prices.minimum_safe_price_kmf), 'KMF   (variable + ' + prices.safety_margin_pct + '%)');
console.log('Prix conseillé              :', f(prices.recommended_price_kmf), 'KMF');
console.log('');
console.log('À prix', f(price), ': contribution =', f(contribution), '| marge complète =', f(marginComplete));
console.log('');

// Imputation pédagogique (doit refléter engagé/niveau/diviseur/imputé)
console.log('── Imputation (allocations) ──────────────────────────────────');
(cdr.details._allocations || []).forEach(a => {
  console.log('  ' + a.component_label + ' : ' + f(a.engaged_amount_kmf) +
    ' /' + a.engaged_level + ' / ' + a.allocation_divisor + ' = ' + f(a.imputed_amount_kmf) + ' imputés');
});
console.log('');

// ── Invariants du contrat ─────────────────────────────────────────────
let ok = true;
function check(label, cond) { console.log((cond ? '✓' : '✗ ÉCHEC') + ' ' + label); if (!cond) ok = false; }
console.log('── Invariants doctrine ───────────────────────────────────────');
check('coût variable complet = N1 + N2', variableComplete === n1 + n2);
check('CDR complet = N1 + N2 + N3', cdrComplete === variableComplete + n3);
check('coût variable complet == variable_cost_estimated_kmf (cohérence moteur)', variableComplete === cdr.variable_cost_estimated_kmf);
check('CDR complet == cost_complete_estimated_kmf (cohérence moteur)', cdrComplete === cdr.cost_complete_estimated_kmf);
check('minimum_safe_price ≠ CDR complet (doctrine §5)', prices.minimum_safe_price_kmf !== cdrComplete);
check('minimum_safe_price > coût variable complet (au-dessus de la frontière rouge)', prices.minimum_safe_price_kmf > variableComplete);
check('minimum_safe_price < prix conseillé', prices.minimum_safe_price_kmf < prices.recommended_price_kmf);
check('prix conseillé ≥ CDR complet', prices.recommended_price_kmf >= cdrComplete);

// ── Invariants doctrine ALLOCATION (MOTEUR_ECONOMIQUE_ALLOCATION §9) ──
check('N3 par article = charges / commandes / articles (= 2 100 attendu)', n3 === 2100);
check('N3 ≠ N3 par commande (5 250)', n3 !== 5250);
const allocSample = (cdr.details._allocations || []).find(a => a.allocation_level === 'order');
check('allocation expose allocation_level', !!allocSample && allocSample.allocation_level === 'order');
check('allocation expose allocation_basis', !!allocSample && allocSample.allocation_basis === 'quantity');
check('allocation expose engaged_cost_kmf + allocated_cost_kmf', !!allocSample && allocSample.engaged_cost_kmf != null && allocSample.allocated_cost_kmf != null);

// Test : prix sous coût variable = destructif
const pDestruct = variableComplete - 500;
check('prix < coût variable → contribution négative (destructif)', (pDestruct - variableComplete) < 0);
// Test : prix entre variable et CDR = contributif mais sous-couvert
const pUnder = Math.round((variableComplete + cdrComplete) / 2);
check('coût variable ≤ prix < CDR → contribution > 0 ET marge complète < 0', (pUnder - variableComplete) > 0 && (pUnder - cdrComplete) < 0);

console.log('');
console.log(ok ? '✅ TOUS LES INVARIANTS PASSENT' : '❌ INVARIANTS EN ÉCHEC');
process.exit(ok ? 0 : 1);
