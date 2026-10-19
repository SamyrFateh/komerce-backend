/**
 * @komerce-arch
 * @role          economic-engine-cost-expectation
 * @domain        economic-engine
 * @layer         service
 * @criticality   high
 * @inputs        order_status, payment_mode, real_cost_allocations
 * @outputs       response_or_domain_result
 * @depends       ./cost-types
 * @used-by       services/dashboard-metrics/costing.js, services/dashboard-metrics/control-tower.js
 * @db-read       order_item_real_cost_allocations
 * @doctrine      resolve_before_behavior_change
 * @impact-areas  economic-engine, dashboard
 * @version       2026-10
 */

'use strict';

/**
 * D1 — coûts APPLICABLES et ATTENDUS d'une commande selon son stade.
 *
 * États d'un coût pour une commande :
 *   inconnu | estimé | réel justifié | non applicable (motif) | zéro confirmé
 * Cette couche décide seulement « attendu / non encore attendu / non applicable » ;
 * « présent » = allocation is_actual=TRUE non héritée suspecte. Une ligne réelle de
 * montant 0 est un zéro confirmé (valeur connue), jamais un inconnu.
 *
 * Règles de stade et d'applicabilité = PROPOSITION TECHNIQUE à valider par le métier
 * (la correction technique ne vaut pas validation métier).
 * Les charges de structure (fixed_overhead, forfait Hub) ne sont jamais exigées par commande.
 * L'absence d'un mécanisme de collecte (`collector:false`) ne rend PAS un coût non
 * applicable : il reste inconnu et signalé « mécanisme de collecte absent ».
 */

const STATUS_RANK = Object.freeze({
  pending: 0, pending_group_payment: 0,
  confirmed: 1, ordered: 2, preparation: 3, shipped: 4, in_transit: 5, available: 6, collected: 7,
});

// from : premier statut à partir duquel le coût est attendu.
// collector : un écrivain de ce coût réel existe dans le code aujourd'hui.
const COST_RULES = Object.freeze([
  { type: 'payment', from: 'confirmed', collector: false, label: 'Frais de paiement',
    notApplicable: { payment_mode: { cash_relais: 'Paiement en espèces au relais : aucun frais de processeur' } } },
  { type: 'product_purchase', from: 'ordered', collector: true, label: 'Achat produit' },
  { type: 'sourcing', from: 'ordered', collector: false, label: 'Sourcing' },
  { type: 'packaging', from: 'preparation', collector: false, label: 'Emballage' },
  { type: 'hub', from: 'preparation', collector: false, label: 'Hub (variable)' },
  { type: 'freight', from: 'shipped', collector: true, label: 'Fret' },
  { type: 'customs', from: 'available', collector: true, label: 'Douane' },
  { type: 'port_transitaire', from: 'available', collector: true, label: 'Port / transitaire' },
  { type: 'local_distribution', from: 'available', collector: false, label: 'Distribution locale' },
  { type: 'relay', from: 'collected', collector: true, label: 'Commission relais (due à la remise au client)' },
]);

const rank = (status) => (Object.prototype.hasOwnProperty.call(STATUS_RANK, status) ? STATUS_RANK[status] : 0);

function notApplicableMotif(rule, ctx) {
  const map = rule.notApplicable && rule.notApplicable.payment_mode;
  return map && ctx.payment_mode && map[ctx.payment_mode] ? map[ctx.payment_mode] : null;
}

/** Types attendus maintenant pour (status, payment_mode). */
function expectedTypes({ status, payment_mode } = {}) {
  const r = rank(status);
  return COST_RULES.filter((rule) => r >= rank(rule.from) && !notApplicableMotif(rule, { payment_mode })).map((x) => x.type);
}

/**
 * Explication d'une commande : ce qui manque, ce qui n'est pas encore attendu,
 * ce qui n'est pas applicable (avec motif). `missing_cost_types` = types attendus
 * sans allocation réelle justifiée.
 */
function describeOrderCosts({ status, payment_mode, missing_cost_types = [] } = {}) {
  const r = rank(status);
  const missing = missing_cost_types.map((type) => {
    const rule = COST_RULES.find((x) => x.type === type);
    return {
      type,
      label: rule ? rule.label : type,
      state: 'unknown',
      collection_mechanism: rule ? rule.collector : null,
      note: rule && !rule.collector ? 'Mécanisme de collecte absent : manque fonctionnel à résoudre, pas un coût nul.' : 'Coût attendu, non encore enregistré.',
    };
  });
  const notYet = COST_RULES.filter((x) => r < rank(x.from) && !notApplicableMotif(x, { payment_mode }))
    .map((x) => ({ type: x.type, label: x.label, expected_from: x.from }));
  const notApplicable = COST_RULES.map((x) => ({ x, motif: notApplicableMotif(x, { payment_mode }) }))
    .filter((e) => e.motif).map((e) => ({ type: e.x.type, label: e.x.label, motif: e.motif }));
  return { missing, not_yet_expected: notYet, not_applicable: notApplicable, nothing_expected_yet: r < 1 };
}

// ── Fragments SQL (constantes internes uniquement : aucune entrée utilisateur) ──
function statusRankSql(alias) {
  const whens = Object.entries(STATUS_RANK).map(([s, n]) => `WHEN '${s}' THEN ${n}`).join(' ');
  return `(CASE ${alias}.status::text ${whens} ELSE 0 END)`;
}

/** Sous-requête : types attendus pour la commande `alias`. */
function expectedTypesSql(alias) {
  const values = COST_RULES.map((rule) => {
    const na = rule.notApplicable && rule.notApplicable.payment_mode ? Object.keys(rule.notApplicable.payment_mode) : [];
    const arr = na.length ? `ARRAY[${na.map((m) => `'${m}'`).join(',')}]::text[]` : 'ARRAY[]::text[]';
    return `('${rule.type}', ${rank(rule.from)}, ${arr})`;
  }).join(', ');
  return `(SELECT exp.t FROM (VALUES ${values}) AS exp(t, from_rank, na_modes)
            WHERE ${statusRankSql(alias)} >= exp.from_rank
              AND NOT (${alias}.payment_mode::text = ANY(exp.na_modes)))`;
}

/** Condition : le coût `typeExpr` a une allocation réelle justifiée pour `alias`. */
function realCostPresentSql(alias, typeExpr) {
  return `EXISTS (SELECT 1 FROM order_item_real_cost_allocations rca
                   WHERE rca.order_id = ${alias}.id
                     AND rca.cost_type::text = ${typeExpr}
                     AND rca.is_actual = TRUE
                     AND COALESCE(rca.source, '') <> 'monthly_recalc')`;
}

/** Condition : au moins un coût attendu manque pour `alias`. */
function hasMissingExpectedSql(alias) {
  return `EXISTS (SELECT 1 FROM ${expectedTypesSql(alias)} e WHERE NOT ${realCostPresentSql(alias, 'e.t')})`;
}

/** Tableau SQL des types manquants pour `alias`. */
function missingTypesArraySql(alias) {
  return `ARRAY(SELECT e.t FROM ${expectedTypesSql(alias)} e WHERE NOT ${realCostPresentSql(alias, 'e.t')} ORDER BY e.t)`;
}

/** Commande hors périmètre de complétude : rien n'est encore attendu. */
function nothingExpectedYetSql(alias) {
  return `${statusRankSql(alias)} < 1`;
}

module.exports = {
  STATUS_RANK,
  COST_RULES,
  expectedTypes,
  describeOrderCosts,
  expectedTypesSql,
  realCostPresentSql,
  hasMissingExpectedSql,
  missingTypesArraySql,
  nothingExpectedYetSql,
};
