/**
 * @komerce-arch
 * @role          economic-engine-cost-expectation
 * @domain        economic-engine
 * @layer         service
 * @criticality   high
 * @inputs        order_status, payment_mode, real_cost_allocations
 * @outputs       response_or_domain_result
 * @depends       ../finance-metrics/customs-unknown
 * @used-by       services/dashboard-metrics/costing.js, services/dashboard-metrics/control-tower.js
 * @db-read       order_item_real_cost_allocations, order_items, parcel_items, customs_shipment_parcels, customs_shipments, parcels, orders
 * @doctrine      resolve_before_behavior_change
 * @impact-areas  economic-engine, dashboard
 * @version       2026-10
 */

'use strict';

/**
 * D1 — coûts APPLICABLES et ATTENDUS d'une commande, selon son stade et les
 * événements canoniques (douane : expédition douane déclarée ; relais : remise).
 *
 * États d'un coût pour une commande :
 *   inconnu | estimé | réel justifié | non applicable (motif) | zéro confirmé
 * Cette couche décide « applicable / attendu / non encore attendu ». « Présent » =
 * allocation is_actual=TRUE hors lignes héritées suspectes ; un réel à 0 est un zéro
 * confirmé (valeur connue), jamais un inconnu. Un coût inconnu reste VISIBLE : son
 * caractère anormal dépend du stade (non encore attendu ≠ absent).
 *
 * Deux notions séparées : complétude des coûts attendus AU STADE, et marge réelle FINALE
 * calculable (remise au client, aucun attendu manquant, douane connue).
 * Relais : la remise rend la commission attendue ; elle n'en fait un coût RÉEL que si le
 * tarif est validé (garde is_actual de l'allocation) et le bénéficiaire identifié (relais).
 * Cash au relais : pas de frais de prestataire de paiement ; commission relais et frais de
 * collecte/transfert restent distincts.
 *
 * Règles de stade/applicabilité = PROPOSITION TECHNIQUE à valider par le métier.
 * Les charges de structure (fixed_overhead, forfait Hub) ne sont jamais exigées par commande.
 * Une absence de mécanisme de collecte (`collector:false`) ne rend PAS un coût non
 * applicable : il reste inconnu, signalé « mécanisme de collecte absent ».
 */

const { customsExpectedSql, customsUnknownForLinesSql } = require('../finance-metrics/customs-unknown');

const STATUS_RANK = Object.freeze({
  pending: 0, pending_group_payment: 0,
  confirmed: 1, ordered: 2, preparation: 3, shipped: 4, in_transit: 5, available: 6, collected: 7,
});

const rank = (status) => (Object.prototype.hasOwnProperty.call(STATUS_RANK, status) ? STATUS_RANK[status] : 0);

// Drapeaux de contexte (même définition en SQL et en JS) :
//   imported          : au moins une ligne importée (fulfillment_source ≠ LOCAL_STOCK) → douane applicable
//   customs_event     : une expédition douane ACTIVE et DÉCLARÉE contient une ligne de la commande
//                       (événement canonique : customs_shipments.status = 'declared') → coûts de
//                       l'expédition (douane, fret, port) attendus
//   relay_beneficiary : la commande a un relais identifié (orders.relais_id) → commission relais applicable
//   hub_route         : L2 — le flux de la commande passe par le Hub, déduit du parcours et des opérations
//                       canoniques : une ligne IMPORT, OU une ligne de provenance inconnue (NULL = donnée
//                       manquante, jamais preuve de non-applicabilité), OU une opération Hub enregistrée
//                       (orders.hub_preparation_at). Non applicable seulement si toutes les lignes sont
//                       LOCAL_STOCK et qu'aucune opération Hub n'existe.
//   hub_route_unknown : applicabilité seulement PRÉSUMÉE (aucune ligne IMPORT, au moins une provenance
//                       inconnue, aucune opération Hub) → signalé comme donnée manquante.
// `hub` = Hub VARIABLE causé par le flux (cost-types.js). La structure Hub (`hub_structure`) est une
// charge de période, jamais attendue par commande.
const HUB_OPERATION_SQL = (a) => `EXISTS (
        SELECT 1 FROM orders hub_o
         WHERE hub_o.id = ${a}.id AND hub_o.hub_preparation_at IS NOT NULL)`;
const FLAG_SQL = Object.freeze({
  imported: (a) => customsExpectedSql(a),
  customs_event: (a) => `EXISTS (
        SELECT 1 FROM order_items ce_oi
          JOIN parcel_items ce_pi ON ce_pi.order_item_id = ce_oi.id
          JOIN customs_shipment_parcels ce_csp ON ce_csp.parcel_id = ce_pi.parcel_id
          JOIN customs_shipments ce_cs ON ce_cs.id = ce_csp.shipment_id
         WHERE ce_oi.order_id = ${a}.id AND ce_cs.is_active AND ce_cs.status = 'declared')`,
  relay_beneficiary: (a) => `${a}.relais_id IS NOT NULL`,
  hub_route: (a) => `(EXISTS (SELECT 1 FROM order_items hub_oi
                               WHERE hub_oi.order_id = ${a}.id
                                 AND hub_oi.fulfillment_source IS DISTINCT FROM 'LOCAL_STOCK')
                      OR ${HUB_OPERATION_SQL(a)})`,
  hub_route_unknown: (a) => `(NOT EXISTS (SELECT 1 FROM order_items hub_oi
                                   WHERE hub_oi.order_id = ${a}.id AND hub_oi.fulfillment_source = 'IMPORT')
                      AND EXISTS (SELECT 1 FROM order_items hub_oi
                                   WHERE hub_oi.order_id = ${a}.id AND hub_oi.fulfillment_source IS NULL)
                      AND NOT ${HUB_OPERATION_SQL(a)})`,
});

// applicable : conditions cumulatives. expected : stage (statut mini) OU flag événement.
// collector : un écrivain de ce coût réel existe aujourd'hui.
const COST_RULES = Object.freeze([
  { type: 'payment', label: 'Frais du prestataire de paiement', collector: false,
    applicable: { paymentModeNot: { cash_relais: 'Paiement en espèces au relais : aucun prestataire de paiement n’intervient (commission relais et frais de collecte ou de transfert restent des coûts distincts)' } },
    expected: { stage: 'confirmed' } },
  { type: 'product_purchase', label: 'Achat produit', collector: true, expected: { stage: 'ordered' } },
  { type: 'sourcing', label: 'Sourcing', collector: false, expected: { stage: 'ordered' } },
  { type: 'packaging', label: 'Emballage', collector: false, expected: { stage: 'preparation' } },
  { type: 'hub', label: 'Hub (variable)', collector: false,
    applicable: { flag: 'hub_route', unknownIsApplicable: true, motif: 'Toutes les lignes sont servies depuis le stock local du marché et aucune opération Hub n’est enregistrée : pas de coût Hub variable (la structure Hub est une charge de période, hors commande)' },
    expected: { stage: 'preparation' } },
  { type: 'freight', label: 'Fret', collector: true,
    applicable: { flag: 'imported', motif: 'Aucune ligne importée : pas d’expédition internationale' }, expected: { flag: 'customs_event' } },
  { type: 'customs', label: 'Douane', collector: true,
    applicable: { flag: 'imported', motif: 'Aucune ligne importée : pas de dédouanement' }, expected: { flag: 'customs_event' } },
  { type: 'port_transitaire', label: 'Port / transitaire', collector: true,
    applicable: { flag: 'imported', motif: 'Aucune ligne importée : pas de transitaire' }, expected: { flag: 'customs_event' } },
  { type: 'local_distribution', label: 'Distribution locale', collector: false, expected: { stage: 'available' } },
  { type: 'relay', label: 'Commission relais (due à la remise au client)', collector: true,
    applicable: { flag: 'relay_beneficiary', motif: 'Aucun relais identifié sur la commande : pas de bénéficiaire' }, expected: { stage: 'collected' } },
]);

function applicability(rule, ctx) {
  const a = rule.applicable || {};
  if (a.paymentModeNot && ctx.payment_mode && a.paymentModeNot[ctx.payment_mode]) {
    return { applicable: false, motif: a.paymentModeNot[ctx.payment_mode] };
  }
  // Donnée de parcours absente (drapeau non fourni) : jamais une preuve de non-applicabilité.
  if (a.flag && a.unknownIsApplicable && (ctx[a.flag] === undefined || ctx[a.flag] === null)) {
    return { applicable: true, motif: null, presumed: true };
  }
  if (a.flag && !ctx[a.flag]) return { applicable: false, motif: a.motif };
  return { applicable: true, motif: null };
}

function isExpected(rule, ctx) {
  const e = rule.expected || {};
  if (e.stage) return rank(ctx.status) >= rank(e.stage);
  if (e.flag) return Boolean(ctx[e.flag]);
  return false;
}

/** Types attendus maintenant pour un contexte {status, payment_mode, imported, customs_event, relay_beneficiary, hub_route}. */
function expectedTypes(ctx = {}) {
  return COST_RULES.filter((r) => applicability(r, ctx).applicable && isExpected(r, ctx)).map((r) => r.type);
}

/**
 * Explication d'une commande. Deux notions SÉPARÉES :
 *  - complétude au stade : tous les coûts attendus maintenant sont-ils présents ?
 *  - marge réelle finale calculable : stade final (remise au client), aucun coût attendu manquant
 *    et aucune douane inconnue. Avoir tous les coûts attendus à son stade ne rend PAS la marge finale
 *    calculable.
 * Un coût inconnu reste visible (missing ou not_yet_expected) ; son caractère anormal dépend du stade.
 */
function describeOrderCosts(input = {}) {
  const ctx = input;
  const missingTypes = input.missing_cost_types || [];
  const missing = missingTypes.map((type) => {
    const rule = COST_RULES.find((x) => x.type === type);
    return {
      type,
      label: rule ? rule.label : type,
      state: 'unknown',
      collection_mechanism: rule ? rule.collector : null,
      note: rule && !rule.collector ? 'Mécanisme de collecte absent : manque fonctionnel à résoudre, pas un coût nul.' : 'Coût attendu, non encore enregistré.',
      ...(type === 'hub' && ctx.hub_route_unknown
        ? { applicability: 'presumed', applicability_note: 'Applicabilité présumée : provenance d’au moins une ligne inconnue (donnée manquante), aucune opération Hub enregistrée.' }
        : {}),
    };
  });
  const notYet = []; const notApplicable = [];
  for (const rule of COST_RULES) {
    const ap = applicability(rule, ctx);
    if (!ap.applicable) { notApplicable.push({ type: rule.type, label: rule.label, motif: ap.motif }); continue; }
    if (!isExpected(rule, ctx)) {
      notYet.push({ type: rule.type, label: rule.label, expected_when: rule.expected.stage ? `statut ${rule.expected.stage}` : 'expédition douane déclarée' });
    }
  }
  let margin;
  if (ctx.status !== 'collected') margin = { final_computable: false, reason: 'not_final_stage', label: 'Marge réelle finale non calculable : la commande n’est pas encore remise au client.' };
  else if (missing.length) margin = { final_computable: false, reason: 'costs_missing', label: 'Marge réelle finale non calculable : des coûts attendus manquent.' };
  else if (ctx.customs_unknown) margin = { final_computable: false, reason: 'customs_unknown', label: 'Marge réelle finale non calculable : coût de douane encore inconnu.' };
  else margin = { final_computable: true, reason: null, label: 'Marge réelle finale calculable.' };
  return { missing, not_yet_expected: notYet, not_applicable: notApplicable, nothing_expected_yet: rank(ctx.status) < 1, costs_complete_at_stage: missing.length === 0, margin };
}

// ── Fragments SQL (constantes internes uniquement : aucune entrée utilisateur) ──
function statusRankSql(alias) {
  const whens = Object.entries(STATUS_RANK).map(([st, n]) => `WHEN '${st}' THEN ${n}`).join(' ');
  return `(CASE ${alias}.status::text ${whens} ELSE 0 END)`;
}

function ruleConditionSql(rule, alias) {
  const conds = [];
  const a = rule.applicable || {};
  if (a.paymentModeNot) conds.push(`${alias}.payment_mode::text NOT IN (${Object.keys(a.paymentModeNot).map((m) => `'${m}'`).join(',')})`);
  if (a.flag) conds.push(FLAG_SQL[a.flag](alias));
  const e = rule.expected || {};
  if (e.stage) conds.push(`${statusRankSql(alias)} >= ${rank(e.stage)}`);
  if (e.flag) conds.push(FLAG_SQL[e.flag](alias));
  return conds.length ? conds.join(' AND ') : 'TRUE';
}

/** Littéral de type de coût issu de la table COST_RULES (constante interne, jamais une entrée utilisateur). */
function typeSelectSql(type) {
  if (!/^[a-z_]+$/.test(type)) throw new Error('type de coût invalide');
  return "SELECT '" + type + "'::text AS t";
}

/** Sous-requête : types attendus pour la commande `alias` (colonnes requises : id, status, payment_mode, relais_id). */
function expectedTypesSql(alias) {
  const parts = COST_RULES.map((rule) => typeSelectSql(rule.type) + ' WHERE ' + ruleConditionSql(rule, alias));
  return `(${parts.join(' UNION ALL ')})`;
}

/** Indicateurs de contexte pour la liste (douane inconnue, drapeaux). */
function contextColumnsSql(alias) {
  return `${FLAG_SQL.imported(alias)} AS ctx_imported,
           ${FLAG_SQL.customs_event(alias)} AS ctx_customs_event,
           ${FLAG_SQL.relay_beneficiary(alias)} AS ctx_relay_beneficiary,
           ${FLAG_SQL.hub_route(alias)} AS ctx_hub_route,
           ${FLAG_SQL.hub_route_unknown(alias)} AS ctx_hub_route_unknown,
           ${customsUnknownForLinesSql(alias)} AS ctx_customs_unknown`;
}

/** Source des anciennes lignes hub/risque (écrites « réelles » sans justification) : non certifiées. */
const LEGACY_UNJUSTIFIED_SOURCE = 'monthly_recalc';

/** Prédicat canonique : la ligne d'allocation `alias` n'est pas une ligne historique non justifiée. */
function notLegacyUnjustifiedSql(alias) {
  return `COALESCE(${alias}.source, '') <> '${LEGACY_UNJUSTIFIED_SOURCE}'`;
}

/**
 * Prédicat canonique D2b : ligne de coût RÉEL justifiée (réelle ET non historique non justifiée).
 * Une ligne exclue n'est jamais comptée comme 0 : le type reste absent (donc « manquant »/NULL),
 * ce qui ne peut que baisser la complétude, jamais la rendre complète.
 */
function justifiedRealSql(alias) {
  return `${alias}.is_actual = TRUE AND ${notLegacyUnjustifiedSql(alias)}`;
}

/** Condition : le coût `typeExpr` a une allocation réelle justifiée pour `alias`. */
function realCostPresentSql(alias, typeExpr) {
  return `EXISTS (SELECT 1 FROM order_item_real_cost_allocations rca
                   WHERE rca.order_id = ${alias}.id
                     AND rca.cost_type::text = ${typeExpr}
                     AND ${justifiedRealSql('rca')})`;
}

/** Condition : au moins un coût attendu manque pour `alias`. */
function hasMissingExpectedSql(alias) {
  return `EXISTS (SELECT 1 FROM ${expectedTypesSql(alias)} e WHERE NOT ${realCostPresentSql(alias, 'e.t')})`;
}

/** Tableau SQL des types manquants pour `alias`. */
function missingTypesArraySql(alias) {
  return `ARRAY(SELECT e.t FROM ${expectedTypesSql(alias)} e WHERE NOT ${realCostPresentSql(alias, 'e.t')} ORDER BY e.t)`;
}

/** Marge réelle FINALE calculable : remise au client, aucun attendu manquant, douane connue. */
function finalMarginReadySql(alias) {
  return `(${alias}.status::text = 'collected'
        AND NOT ${hasMissingExpectedSql(alias)}
        AND NOT ${customsUnknownForLinesSql(alias)})`;
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
  contextColumnsSql,
  realCostPresentSql,
  justifiedRealSql,
  notLegacyUnjustifiedSql,
  LEGACY_UNJUSTIFIED_SOURCE,
  hasMissingExpectedSql,
  finalMarginReadySql,
  missingTypesArraySql,
  nothingExpectedYetSql,
};
