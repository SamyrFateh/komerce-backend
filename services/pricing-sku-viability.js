/**
 * @komerce-arch
 * @role          economic-engine-sku-viability
 * @domain        economic-engine
 * @layer         service
 * @criticality   high
 * @inputs        observed_market_corridor, canonical_unit_economics
 * @outputs       sku_viability_decision_support, purchase_cost_ceiling
 * @depends       none
 * @used-by       services/pricing-market-corridor.js
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      market_bounds_possible_human_decides, fixed_structure_never_fabricates_sku_price, viability_is_decision_support_not_price_gate
 * @impact-areas  economic-engine, pricing, sourcing
 * @version       2026-09
 */

'use strict';

function finite(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function round(value) {
  const n = finite(value);
  return n == null ? null : Math.round(n);
}

function nonNegative(value) {
  const n = finite(value);
  return n == null ? null : Math.max(0, n);
}

function contributionAt(point, variableCost) {
  const price = finite(point?.price_kmf);
  const cost = finite(variableCost);
  if (price == null || cost == null) return null;
  return round(price - cost);
}

function purchaseCeilings(priceKmf, economics = {}) {
  const price = finite(priceKmf);
  const outsidePurchase = finite(economics.variable_cost_outside_purchase_kmf);
  if (price == null || outsidePurchase == null) {
    return {
      break_even_kmf: null,
      safe_kmf: null,
      target_margin_kmf: null,
    };
  }

  const safetyPct = Math.max(0, finite(economics.safety_margin_pct) || 0);
  const targetMarginPct = Math.min(99, Math.max(0, finite(economics.target_margin_pct) || 0));

  const variableBreakEven = price;
  const variableSafe = safetyPct > 0 ? price / (1 + safetyPct / 100) : price;
  const variableTarget = price * (1 - targetMarginPct / 100);

  return {
    break_even_kmf: round(nonNegative(variableBreakEven - outsidePurchase)),
    safe_kmf: round(nonNegative(variableSafe - outsidePurchase)),
    target_margin_kmf: round(nonNegative(variableTarget - outsidePurchase)),
  };
}

function statusLabel(status) {
  return ({
    VIABLE: 'Viable',
    VIABLE_UNDER_CONDITIONS: 'Viable sous conditions',
    NON_VIABLE_STRUCTURAL: 'Non viable structurellement',
    MARKET_EVIDENCE_INSUFFICIENT: 'Preuve marché insuffisante',
  })[status] || status;
}

function projectSkuViability(corridor = {}, economics = {}) {
  const sampleCount = Number(corridor.sample_count) || 0;
  const variableCost = finite(economics.variable_cost_complete_kmf);
  const purchaseCost = finite(economics.purchase_cost_kmf);
  const minimumSafePrice = finite(economics.minimum_safe_price_kmf);

  const lowPrice = finite(corridor.low?.price_kmf);
  const targetPrice = finite(corridor.target?.price_kmf);
  const highPrice = finite(corridor.high?.price_kmf);

  const contributions = {
    low_kmf: contributionAt(corridor.low, variableCost),
    target_kmf: contributionAt(corridor.target, variableCost),
    high_kmf: contributionAt(corridor.high, variableCost),
  };

  if (!sampleCount || targetPrice == null || highPrice == null || variableCost == null) {
    const status = 'MARKET_EVIDENCE_INSUFFICIENT';
    return {
      status,
      label: statusLabel(status),
      authority: 'SERVER_DERIVED_DECISION_SUPPORT_NOT_GATE',
      market_confidence: corridor.confidence || 'none',
      strategic_exception_auto_assigned: false,
      reason: 'Le coût est connu mais le marché local ne fournit pas encore assez de preuve pour conclure sur la viabilité du SKU.',
      sourcing_action: 'COLLECT_MARKET_EVIDENCE',
      market_prices_kmf: { low: lowPrice, target: targetPrice, high: highPrice },
      contribution_scenarios_kmf: contributions,
      purchase_cost_ceiling_at_target_kmf: purchaseCeilings(targetPrice, economics),
      purchase_cost_kmf: purchaseCost,
    };
  }

  let status;
  let sourcingAction;
  let reason;

  if (contributions.high_kmf == null || contributions.high_kmf <= 0) {
    status = 'NON_VIABLE_STRUCTURAL';
    sourcingAction = 'AVOID_OR_RESOURCE';
    reason = 'Même la borne haute observée ne couvre pas le coût variable complet avec une contribution positive.';
  } else if (contributions.target_kmf == null || contributions.target_kmf <= 0) {
    status = 'VIABLE_UNDER_CONDITIONS';
    sourcingAction = 'RENEGOTIATE_OR_REPOSITION';
    reason = 'La cible marché observée ne couvre pas encore le coût variable complet ; seule une meilleure condition de sourcing ou un positionnement marché plus haut rend le SKU contributif.';
  } else if (minimumSafePrice != null && targetPrice < minimumSafePrice) {
    status = 'VIABLE_UNDER_CONDITIONS';
    sourcingAction = 'RENEGOTIATE_OR_REPOSITION';
    reason = 'Le SKU contribue au prix cible observé mais reste sous la frontière de sécurité économique définie par le moteur.';
  } else {
    status = 'VIABLE';
    sourcingAction = 'KEEP_AND_TEST_SCALE';
    reason = contributions.low_kmf != null && contributions.low_kmf > 0
      ? 'Le SKU reste contributif jusque dans la borne basse observée du marché.'
      : 'Le SKU est contributif à la cible observée ; la borne basse reste une zone de vigilance.';
  }

  const ceilings = purchaseCeilings(targetPrice, economics);
  const gapToSafe = purchaseCost == null || ceilings.safe_kmf == null
    ? null
    : round(ceilings.safe_kmf - purchaseCost);
  const gapToTarget = purchaseCost == null || ceilings.target_margin_kmf == null
    ? null
    : round(ceilings.target_margin_kmf - purchaseCost);

  return {
    status,
    label: statusLabel(status),
    authority: 'SERVER_DERIVED_DECISION_SUPPORT_NOT_GATE',
    market_confidence: corridor.confidence || 'none',
    strategic_exception_auto_assigned: false,
    reason,
    sourcing_action: sourcingAction,
    purchase_cost_kmf: purchaseCost,
    variable_cost_complete_kmf: variableCost,
    variable_cost_outside_purchase_kmf: finite(economics.variable_cost_outside_purchase_kmf),
    minimum_safe_price_kmf: minimumSafePrice,
    market_prices_kmf: {
      low: lowPrice,
      target: targetPrice,
      high: highPrice,
    },
    contribution_scenarios_kmf: contributions,
    purchase_cost_ceiling_at_target_kmf: ceilings,
    purchase_cost_gap_to_safe_ceiling_kmf: gapToSafe,
    purchase_cost_gap_to_target_margin_ceiling_kmf: gapToTarget,
    resilience: contributions.low_kmf != null && contributions.low_kmf > 0 ? 'ROBUST_AT_LOW_BOUND' : 'TARGET_DEPENDENT',
  };
}

module.exports = {
  contributionAt,
  purchaseCeilings,
  projectSkuViability,
};