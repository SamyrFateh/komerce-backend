/**
 * @komerce-arch
 * @role          market-delegation-performance-service
 * @domain        market-delegation
 * @layer         service
 * @criticality   high
 * @inputs        authenticated market operator, market code, optional calendar period
 * @outputs       projection lisible de la performance économique du marché
 * @depends       services/market-delegation-team-service.js, services/pricing-market-decision-policy.js
 * @used-by       routes/market-delegation-performance.js
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      performance_is_a_projection_never_a_new_truth, no_invented_revenue_share, client_market_id_never_authority
 * @impact-areas  market, delegation, economic-engine
 * @version       2026-09
 */
'use strict';

const { resolveActiveAssignmentByMarketCode, resolveAuthorization } = require('./market-delegation-team-service');
const { evaluateMarketDecision } = require('./pricing-market-decision-policy');

function requireExecutor(executor) {
  if (!executor || typeof executor.query !== 'function') {
    throw new TypeError('market-delegation-performance-service: executor.query requis');
  }
  return executor;
}

function delegationError(code, message, status = 403) {
  const error = new Error(message || code);
  error.code = code;
  error.status = status;
  return error;
}

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Projette la décision économique canonique en une vue lisible par un
 * responsable pays.
 *
 * Ce service ne calcule RIEN et n'invente aucune règle de partage : il
 * reformate ce que le moteur économique a déjà tranché
 * (evaluateMarketDecision -> computeMarketCoverage). Il n'existe à ce jour
 * aucune règle de commission/revenue-share dans le système ; « ce que le
 * partenaire touche » reste donc une attestation centrale explicite
 * (market_settlements.source = CENTRAL_ATTESTATION). Ce que cette vue apporte,
 * c'est la capacité pour le partenaire de VÉRIFIER ce que son marché produit,
 * au lieu de prendre le montant attesté sur parole.
 *
 * Quand le moteur refuse de conclure (données insuffisantes), on transmet ce
 * refus tel quel. Afficher un chiffre approximatif serait pire que de ne rien
 * afficher : c'est de l'argent.
 */
async function getMarketPerformance(executor, { marketCode, actorUserId, period = null }) {
  const db = requireExecutor(executor);
  const authz = await resolveAuthorization(db, {
    userId: actorUserId,
    marketCode,
    requiredCapability: 'finance.read',
  });

  let decision;
  try {
    decision = await evaluateMarketDecision(authz.market_id, period ? { period } : {});
  } catch (error) {
    if (/period|calendar/i.test(String(error && error.message))) {
      throw delegationError('PERFORMANCE_PERIOD_INVALID', String(error.message), 400);
    }
    throw error;
  }

  const coverage = decision.coverage || null;
  const contribution = (coverage && coverage.contribution) || null;
  const structure = (coverage && coverage.structure) || null;

  // Statut lisible : soit le moteur a conclu, soit il explique pourquoi il
  // s'y refuse. Jamais d'estimation de remplacement.
  const decisional = Boolean(coverage && coverage.threshold_applied);

  return {
    market: {
      code: authz.market_code,
      name: authz.market_name,
      currency: authz.currency,
    },
    assignment_id: authz.assignment_id,
    period: decision.canonical_period || (coverage && coverage.period) || null,
    status: decisional ? 'AVAILABLE' : 'NOT_DECISIONAL',
    // Motif serveur repris mot pour mot : le partenaire doit pouvoir
    // comprendre POURQUOI un chiffre manque, pas seulement constater qu'il
    // manque.
    reason: decisional ? null : (decision.reason || (coverage && coverage.reason) || 'MARKET_DECISION_POLICY_REQUIRED'),

    activity: contribution
      ? {
        mature_order_count: num(contribution.mature_order_count),
        revenue_kmf: num(contribution.revenue_kmf),
        transaction_variable_cost_kmf: num(contribution.transaction_variable_cost_kmf),
      }
      : null,

    // Ce que le marché a réellement dégagé, après coûts variables puis après
    // risque réel constaté (impayés, litiges) — pas une provision estimée.
    contribution: contribution
      ? {
        before_risk_kmf: num(contribution.contribution_before_risk_kmf),
        reconciled_kmf: num(contribution.reconciled_contribution_kmf),
        actual_risk_cost_kmf: num(contribution.reconciled_risk_cost_kmf),
      }
      : null,

    // Charges de structure de la période — celles que l'opérateur enregistre
    // lui-même via structure.event.record.
    structure_costs: structure
      ? {
        market_n3_total_kmf: num(structure.market_n3_total_kmf),
        decisional: Boolean(structure.market_n3_decisional),
      }
      : null,

    coverage: decisional
      ? {
        ratio: num(coverage.coverage_ratio),
        status: coverage.coverage_status,
        numerator_contribution_kmf: num(coverage.numerator_contribution_kmf),
        denominator_n3_kmf: num(coverage.denominator_n3_kmf),
      }
      : null,

    // Rappel explicite dans la charge utile elle-même : cette vue dit ce que
    // le marché produit, pas ce que le partenaire touche. Tant qu'aucune règle
    // de partage n'existe, le règlement reste une attestation centrale.
    settlement_basis: {
      source: 'CENTRAL_ATTESTATION',
      note: 'Aucune règle de partage automatique n\'existe à ce jour : le montant réglé au partenaire est attesté par le central. Cette vue permet de le vérifier contre la performance réelle du marché.',
    },

    evaluated_at: decision.evaluated_at || null,
  };
}

module.exports = {
  resolveActiveAssignmentByMarketCode,
  resolveAuthorization,
  getMarketPerformance,
};
