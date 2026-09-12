/**
 * @komerce-arch
 * @role          market-local-price-activation-orchestrator
 * @domain        market-autonomy
 * @layer         service
 * @criticality   critical
 * @inputs        server_resolved_market, product_ref, actor_id
 * @outputs       activation_preview, authorized_and_active_local_price
 * @depends       services/market-commercial-price-service.js, services/market-local-price-resolution-service.js, services/market-local-price-state-transition.js, services/pricing-engine.js, services/pricing-cdr.js, services/pricing-market-decision-policy.js
 * @used-by       routes/admin-pricing-workspace.js
 * @db-read       product_market_price_drafts, product_skus, product_variants
 * @db-write      none
 * @db-txn        writes_delegated_to_market_autonomy_state_owners
 * @doctrine      local_human_decides_system_checks_no_central_approval, under_cdr_requires_market_coverage, destructive_price_never_activates
 * @impact-areas  market, pricing, catalog, checkout, shared-cart
 * @version       2026-09
 */

'use strict';

const pricingEngine = require('./pricing-engine');
const pricingCdr = require('./pricing-cdr');
const pricingMarketDecisionPolicy = require('./pricing-market-decision-policy');
const marketCommercialPrice = require('./market-commercial-price-service');
const { activateMarketPriceDecision } = require('./market-local-price-state-transition');
const {
  assertProductPriceShapeCompatible,
  projectLocalToKmf,
} = require('./market-local-price-resolution-service');

function compactMarketGate(evaluation) {
  const coverage = evaluation?.coverage || null;
  return {
    decision_status: evaluation?.decision_status || null,
    authorization: evaluation?.authorization || null,
    reason: evaluation?.reason || null,
    policy_version: evaluation?.policy?.version || null,
    canonical_period: evaluation?.canonical_period || null,
    coverage_ratio: coverage?.coverage_ratio ?? null,
    evaluated_at: evaluation?.evaluated_at || null,
  };
}

function activationVerdict(pricing, marketEvaluation) {
  if (!pricing || !pricing.strategy_risk) {
    return { allowed: false, reason: 'CDR_POSITION_UNAVAILABLE' };
  }
  if (pricing.strategy_risk === 'destructive') {
    return { allowed: false, reason: 'PRICE_BELOW_VARIABLE_COST' };
  }

  // pricing-engine a canonisé la frontière en 2026-09 :
  // - contributive_low_buffer = au-dessus du coût variable, sous le plancher sûr ;
  // - contributive = au-dessus du plancher sûr.
  // Les anciens libellés restent compris pendant la transition afin de ne pas
  // casser un snapshot historique, mais ils ne sont plus produits par le moteur.
  const requiresMarketCoverage = pricing.strategy_risk === 'contributive_low_buffer'
    || pricing.strategy_risk === 'undercovered';
  if (requiresMarketCoverage) {
    if (marketEvaluation?.authorization !== 'ALLOW_NEW_UNDER_CDR_POSITION') {
      return {
        allowed: false,
        reason: marketEvaluation?.reason || 'MARKET_COVERAGE_REQUIRED_FOR_UNDER_CDR_POSITION',
      };
    }
    return { allowed: true, reason: 'MARKET_GATE_AUTHORIZES_UNDER_CDR_POSITION' };
  }

  if (pricing.strategy_risk === 'contributive') {
    return { allowed: true, reason: 'PRICE_MEETS_MINIMUM_SAFE_CONTRIBUTION_BOUNDARY' };
  }
  if (pricing.strategy_risk === 'covered') {
    return { allowed: true, reason: 'PRICE_COVERS_CDR' };
  }

  // Un état économique inconnu ne doit jamais devenir une autorisation par
  // défaut. Cela protège le gate contre un futur renommage non propagé.
  return { allowed: false, reason: 'CDR_POSITION_UNKNOWN' };
}

async function evaluateMarketDecisionFailClosed(marketId, at) {
  try {
    return await pricingMarketDecisionPolicy.evaluateMarketDecision(marketId, { at });
  } catch (error) {
    if (String(error && error.message || '') !== 'coverage policy does not cover canonical period') throw error;

    // Une politique nouvellement décidée ne peut pas gouverner rétroactivement
    // une fenêtre qui commence avant effective_from. C'est un état métier
    // NOT_DECISIONAL, pas une panne serveur. Il reste DENY pour toute position
    // qui exige explicitement la couverture marché.
    return {
      market_id: marketId,
      decision_status: 'NOT_DECISIONAL',
      authorization: 'DENY_NEW_UNDER_CDR_POSITION',
      reason: 'POLICY_DOES_NOT_COVER_CANONICAL_PERIOD',
      policy: null,
      canonical_period: null,
      coverage: null,
      flow_break_even: null,
      evaluated_at: new Date(at).toISOString(),
    };
  }
}

async function previewLocalPriceActivation({ market, productRef, at = new Date() }) {
  const current = await marketCommercialPrice.getMarketPriceDecision(market, productRef);
  const { product, decision } = current;

  await assertProductPriceShapeCompatible(undefined, product.id);

  const projectedPriceKmf = await projectLocalToKmf(decision.local_price, decision.currency);
  const config = await pricingCdr.loadGlobalConfig({ marketId: market.id });
  const pricing = await pricingEngine.recommend({
    product_id: product.id,
    current_price_kmf: projectedPriceKmf,
    final_price_kmf: projectedPriceKmf,
    pricing_strategy: 'market_local',
  }, { config });
  const marketEvaluation = await evaluateMarketDecisionFailClosed(market.id, at);
  const verdict = activationVerdict(pricing, marketEvaluation);

  const snapshot = {
    product_ref: product.product_ref,
    market_code: market.code,
    local_price: decision.local_price,
    currency: decision.currency,
    projected_price_kmf: projectedPriceKmf,
    variable_cost_complete_kmf: pricing.variable_cost_complete_kmf,
    // Contrat canonique (2026-09) : cdr_complete_kmf → fully_loaded_cost_reference_kmf
    cdr_complete_kmf: pricing.fully_loaded_cost_reference_kmf,
    strategy_risk: pricing.strategy_risk,
    estimated_margin_pct: pricing.estimated_margin_pct,
    market_gate: compactMarketGate(marketEvaluation),
    activation_allowed: verdict.allowed,
    activation_reason: verdict.reason,
    evaluated_at: new Date(at).toISOString(),
  };

  return {
    decision,
    economics: {
      projected_price_kmf: projectedPriceKmf,
      variable_cost_complete_kmf: pricing.variable_cost_complete_kmf,
      cdr_complete_kmf: pricing.fully_loaded_cost_reference_kmf,
      strategy_risk: pricing.strategy_risk,
      estimated_margin_pct: pricing.estimated_margin_pct,
    },
    market_gate: snapshot.market_gate,
    activation: verdict,
    authorization_snapshot: snapshot,
  };
}

async function activateLocalPrice({ market, productRef, actorId, reason, source = 'market_manager_activation' }) {
  if (!actorId) {
    throw new marketCommercialPrice.MarketCommercialPriceError(
      400,
      'market_price_actor_required',
      'Acteur requis pour l’activation.'
    );
  }

  const preview = await previewLocalPriceActivation({ market, productRef });
  if (!preview.activation.allowed) {
    throw new marketCommercialPrice.MarketCommercialPriceError(
      409,
      'market_local_price_activation_denied',
      `Activation refusée par le moteur : ${preview.activation.reason}`
    );
  }

  if (preview.decision.decision_status === marketCommercialPrice.PRICE_STATUSES.ACTIVE) {
    return { preview, decision: preview.decision, already_active: true };
  }

  if (preview.decision.decision_status === marketCommercialPrice.PRICE_STATUSES.DRAFT) {
    await marketCommercialPrice.authorizeMarketPriceDraft({
      market,
      productRef,
      authorizationSnapshot: preview.authorization_snapshot,
      reason: reason || 'Gate économique franchi',
      source: 'market_economic_gate',
      actorId,
    });
  } else if (preview.decision.decision_status !== marketCommercialPrice.PRICE_STATUSES.AUTHORIZED) {
    throw new marketCommercialPrice.MarketCommercialPriceError(
      409,
      'market_local_price_activation_state_invalid',
      'État de décision locale incompatible avec une activation.'
    );
  }

  const decision = await activateMarketPriceDecision({
    market,
    productRef,
    activationSnapshot: preview.authorization_snapshot,
    reason: reason || 'Activation acheteur après gate économique',
    source,
    actorId,
  });

  return { preview, decision, already_active: Boolean(decision.already_active) };
}

module.exports = {
  activationVerdict,
  evaluateMarketDecisionFailClosed,
  previewLocalPriceActivation,
  activateLocalPrice,
};
