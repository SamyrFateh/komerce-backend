/**
 * @komerce-arch
 * @role          market-local-price-activation-orchestrator
 * @domain        market-autonomy
 * @layer         service
 * @criticality   critical
 * @inputs        server_resolved_market, product_ref, actor_id
 * @outputs       activation_preview, authorized_and_active_local_price
 * @depends       db.js, services/market-commercial-price-service.js, services/market-local-price-resolution-service.js, services/pricing-engine.js, services/pricing-cdr.js, services/pricing-market-decision-policy.js
 * @used-by       routes/admin-pricing-workspace.js
 * @db-read       product_market_price_drafts, product_skus, product_variants
 * @db-write      none
 * @db-txn        writes_delegated_to_market_commercial_price_owner
 * @doctrine      local_human_decides_system_checks_no_central_approval, under_cdr_requires_market_coverage, destructive_price_never_activates
 * @impact-areas  market, pricing, catalog, checkout, shared-cart
 * @version       2026-09
 */

'use strict';

const pricingEngine = require('./pricing-engine');
const pricingCdr = require('./pricing-cdr');
const pricingMarketDecisionPolicy = require('./pricing-market-decision-policy');
const marketCommercialPrice = require('./market-commercial-price-service');
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
  if (pricing.strategy_risk === 'undercovered') {
    if (marketEvaluation?.authorization !== 'ALLOW_NEW_UNDER_CDR_POSITION') {
      return {
        allowed: false,
        reason: marketEvaluation?.reason || 'MARKET_COVERAGE_REQUIRED_FOR_UNDER_CDR_POSITION',
      };
    }
  }
  return { allowed: true, reason: pricing.strategy_risk === 'covered' ? 'PRICE_COVERS_CDR' : 'MARKET_GATE_AUTHORIZES_UNDER_CDR_POSITION' };
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
  const marketEvaluation = await pricingMarketDecisionPolicy.evaluateMarketDecision(market.id, { at });
  const verdict = activationVerdict(pricing, marketEvaluation);

  const snapshot = {
    product_ref: product.product_ref,
    market_code: market.code,
    local_price: decision.local_price,
    currency: decision.currency,
    projected_price_kmf: projectedPriceKmf,
    variable_cost_complete_kmf: pricing.variable_cost_complete_kmf,
    cdr_complete_kmf: pricing.cdr_complete_kmf,
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
      cdr_complete_kmf: pricing.cdr_complete_kmf,
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
    throw new marketCommercialPrice.MarketCommercialPriceError(400, 'market_price_actor_required', 'Acteur requis pour l’activation.');
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

  const decision = await marketCommercialPrice.activateMarketPriceDecision({
    market,
    productRef,
    activationSnapshot: preview.authorization_snapshot,
    reason: reason || 'Activation acheteur après gate économique',
    source,
    actorId,
  });

  return { preview, decision, already_active: false };
}

module.exports = {
  activationVerdict,
  previewLocalPriceActivation,
  activateLocalPrice,
};
