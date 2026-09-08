/**
 * @komerce-arch
 * @role          economic-engine-pricing-engine
 * @domain        economic-engine
 * @layer         service
 * @criticality   high
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       economic_reference_and_market_decision_inputs
 * @depends       db, services/pricing-cdr.js, services/pricing-output.js
 * @used-by       routes/modules.js, routes/pricing.js, routes/sourcing-scanner.js, services/apply-pricing-updates.js, services/order-cost-snapshot.js, services/pricing-dashboard.js, services/pricing-recommend.js, services/supplier-catalog-scanner.js, services/suppliers/catalog-import-orchestrator.js
 * @db-read       order_items, orders, products
 * @db-write      none
 * @db-txn        none
 * @doctrine      fixed_structure_never_fabricates_sku_price, market_bounds_possible_human_decides, contribution_covers_structure_collectively
 * @impact-areas  economic-engine, pricing
 * @version       2026-09
 */

'use strict';

const db = require('../db');
const { loadGlobalConfig, computeCDR } = require('./pricing-cdr');
const {
  computePrices,
  computeScenarios,
  computeStrategies,
  buildProportions,
  computeHealthStatus,
  computeSourcingDecision,
  buildAlerts,
  buildRecommendationText,
  buildCostBreakdown,
  buildDataQuality,
  inferSubjectType,
  HEALTH_THRESHOLDS,
  MARKET_THRESHOLDS,
} = require('./pricing-output');

function r(n) { return Math.round(Number(n) || 0); }

async function computeMarketConfidence(productId) {
  const warnings = [];
  const signals = {
    paid_orders_count: 0,
    days_to_first_sale: null,
    repeat_purchase_signal: null,
    days_since_publication: null,
    product_views: null,
    add_to_cart_count: null,
    checkout_started_count: null,
    cart_abandon_rate: null,
    conversion_rate: null,
    questions_whatsapp_count: null,
  };

  if (!productId) {
    warnings.push('Données marché insuffisantes. Recommandation basée sur coûts et hypothèses.');
    return { market_confidence: 'unknown', market_signals: signals, warnings };
  }

  try {
    const { rows } = await db.query(
      `SELECT
         COUNT(DISTINCT o.id)      FILTER (WHERE o.status NOT IN ('cancelled', 'refunded')) AS paid_orders,
         MIN(o.created_at)         FILTER (WHERE o.status NOT IN ('cancelled', 'refunded')) AS first_sale_at,
         COUNT(DISTINCT o.user_id) FILTER (WHERE o.status NOT IN ('cancelled', 'refunded')) AS unique_buyers
       FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
      WHERE oi.product_id = $1`,
      [productId]
    );

    const r0 = rows[0] || {};
    const paidOrders = Number(r0.paid_orders) || 0;
    const uniqueBuyers = Number(r0.unique_buyers) || 0;
    signals.paid_orders_count = paidOrders;

    const { rows: prodRows } = await db.query('SELECT created_at FROM products WHERE id = $1', [productId]);
    const productCreatedAt = prodRows[0]?.created_at;
    if (productCreatedAt) {
      signals.days_since_publication = Math.floor((Date.now() - new Date(productCreatedAt).getTime()) / 86400000);
      if (r0.first_sale_at) {
        signals.days_to_first_sale = Math.max(0,
          Math.floor((new Date(r0.first_sale_at).getTime() - new Date(productCreatedAt).getTime()) / 86400000)
        );
      }
    }

    if (paidOrders > uniqueBuyers && uniqueBuyers > 0) signals.repeat_purchase_signal = true;
    else if (paidOrders > 0) signals.repeat_purchase_signal = false;

    let confidence = 'unknown';
    if (paidOrders === 0) {
      confidence = signals.days_since_publication >= MARKET_THRESHOLDS.REJECTED_DAYS_NOSALE ? 'rejected' : 'unknown';
    } else if (paidOrders >= MARKET_THRESHOLDS.SCALING_MIN_SALES) confidence = 'scaling';
    else if (paidOrders >= MARKET_THRESHOLDS.VALIDATED_MIN_SALES) confidence = 'validated';
    else if (paidOrders >= MARKET_THRESHOLDS.TESTING_MIN_SALES) confidence = 'testing';

    if (confidence === 'unknown') warnings.push('Données marché insuffisantes. Recommandation basée sur coûts et hypothèses.');
    return { market_confidence: confidence, market_signals: signals, warnings };
  } catch (err) {
    warnings.push('Impossible de calculer market_confidence : ' + err.message);
    return { market_confidence: 'unknown', market_signals: signals, warnings };
  }
}

async function recommend(input, options = {}) {
  let config = options.config || (await loadGlobalConfig());

  // Les overrides de structure servent à la simulation de couverture portefeuille,
  // jamais à fabriquer un prix unitaire.
  if (input.finance_overrides || input.monthly_fixed_costs_kmf != null) {
    config = {
      ...config,
      finance: { ...config.finance, ...(input.finance_overrides || {}) },
      ...(input.monthly_fixed_costs_kmf != null
        ? { charges: [{ recurrence_period: 'monthly', amount_kmf: Number(input.monthly_fixed_costs_kmf), is_active: true }] }
        : {}),
    };
  }
  const fc = config.finance || {};

  let product = null;
  if (input.product_id) {
    const result = await db.query('SELECT * FROM products WHERE id = $1', [input.product_id]);
    if (result.rows.length) product = result.rows[0];
  }

  const merged = {
    id: input.product_id || product?.id || null,
    category: input.category || product?.category || 'phones',
    cost_kmf: input.cost_kmf != null ? input.cost_kmf : product?.cost_kmf,
    weight_kg: input.weight_kg != null ? input.weight_kg : product?.weight_kg,
    price_kmf: input.current_price_kmf != null ? input.current_price_kmf : product?.price_kmf,
  };
  const ctx = {
    config,
    volume_m3: input.volume_m3 || 0.005,
    channel: input.channel || 'cash_relais',
  };

  const cdr = computeCDR(merged, ctx);
  const cat = config.categories?.[merged.category] || null;
  const prices = computePrices(cdr, cat, fc);
  const scenarios = computeScenarios(cdr, prices, cat, fc);
  const breakdown = buildCostBreakdown(cdr.details || {});

  const flowVariableCost = breakdown.landed_relay_cost_kmf;
  const businessVariableCost = r((breakdown.business?.payment || 0) + (breakdown.business?.risk_provision || 0));
  const variableComplete = r(flowVariableCost + businessVariableCost);
  const structureAllocationReference = r(breakdown.business?.fixed_overhead || 0);
  const fullyLoadedAnalyticalReference = r(variableComplete + structureAllocationReference);

  const currentPrice = Number(merged.price_kmf) || 0;
  const estimatedContribution = currentPrice > 0 ? currentPrice - variableComplete : null;
  const estimatedContributionRate = currentPrice > 0
    ? ((currentPrice - variableComplete) / currentPrice) * 100
    : null;

  const market = await computeMarketConfidence(merged.id);
  const healthStatus = computeHealthStatus(currentPrice, variableComplete, estimatedContributionRate);
  const sourcingDecision = computeSourcingDecision({
    health_status: healthStatus,
    market_confidence: market.market_confidence,
    weight_kg: merged.weight_kg,
  });

  const monthlyStructure = Number(cdr.monthly_fixed_costs_kmf) || 0;
  const analyticalContribution = estimatedContribution != null && estimatedContribution > 0
    ? estimatedContribution
    : (Number(prices.economic_reference_price_kmf ?? prices.recommended_price_kmf) || 0) - variableComplete;
  const equivalentArticlesToCoverStructure = analyticalContribution > 0 && monthlyStructure > 0
    ? Math.ceil(monthlyStructure / analyticalContribution)
    : null;
  const avgArticlesPerOrder = Number(fc.avg_articles_per_order) || 2.5;
  const equivalentOrdersToCoverStructure = equivalentArticlesToCoverStructure == null
    ? null
    : Math.ceil(equivalentArticlesToCoverStructure / avgArticlesPerOrder);

  const alerts = buildAlerts({
    current_price_kmf: currentPrice,
    variable_cost_complete_kmf: variableComplete,
    estimated_margin_pct: estimatedContributionRate,
    estimated_contribution_kmf: estimatedContribution,
    monthly_break_even_orders: equivalentOrdersToCoverStructure,
    target_orders_per_month: Number(cdr.target_orders_per_month) || 0,
  });

  const reason = buildRecommendationText({
    health_status: healthStatus,
    market_confidence: market.market_confidence,
    sourcing_decision: sourcingDecision,
    recommended_price_kmf: prices.recommended_price_kmf,
    economic_reference_price_kmf: prices.economic_reference_price_kmf,
    variable_cost_complete_kmf: variableComplete,
    target_margin_pct: prices.target_margin_pct,
    current_price_kmf: currentPrice,
    estimated_margin_pct: estimatedContributionRate,
    weight_kg: merged.weight_kg,
  });

  const warnings = [...(cdr.warnings || []), ...market.warnings];
  const dataQuality = buildDataQuality(input, {
    hasProduct: !!product,
    hasCustomsCategory: !!cat,
    hasFinanceConfig: Object.keys(fc).length > 0,
    warnings,
  });
  const subjectType = inferSubjectType(input, { hasProduct: !!product });

  // La décision finale n'est plus mécanique. Sans prix humain / marché explicite,
  // le moteur ne fabrique pas de final_price_kmf.
  const pricingStrategy = input.pricing_strategy || 'market_bounded';
  const finalPrice = input.final_price_kmf != null ? r(input.final_price_kmf) : null;
  let strategyRisk = null;
  if (finalPrice != null && finalPrice > 0) {
    if (finalPrice < variableComplete) strategyRisk = 'destructive';
    else if (finalPrice < prices.minimum_safe_price_kmf) strategyRisk = 'contributive_low_buffer';
    else strategyRisk = 'contributive';
  }

  const allocationAverages = {
    articles_per_order: avgArticlesPerOrder,
    articles_per_parcel: Number(fc.avg_articles_per_parcel) || 4,
    articles_per_shipment: Number(fc.avg_articles_per_shipment) || 200,
    confidence: fc.allocation_confidence || 'low',
  };

  const strategies = computeStrategies({
    variable_complete: variableComplete,
    minimum_safe: prices.minimum_safe_price_kmf,
    recommended: prices.economic_reference_price_kmf ?? prices.recommended_price_kmf,
    target_margin_pct: prices.target_margin_pct,
    monthly_fixed_costs: monthlyStructure,
  }, fc, input);

  const benchmarks = {};
  (config.cost_benchmarks || []).forEach(b => {
    const isSpecific = b.category === merged.category;
    const isAll = b.category === 'all' || b.category == null;
    if (!isSpecific && !isAll) return;
    if (!benchmarks[b.cost_family] || isSpecific) {
      benchmarks[b.cost_family] = {
        expected_share_pct: Number(b.expected_share_pct),
        warn_ratio: Number(b.warn_ratio) || 1.3,
        alert_ratio: Number(b.alert_ratio) || 1.6,
        _specific: isSpecific,
      };
    }
  });

  const proportions = buildProportions(
    breakdown,
    {
      variable_flow: flowVariableCost,
      business_variable: businessVariableCost,
      variable_total: variableComplete,
      structure_reference: structureAllocationReference,
      analytical_total: fullyLoadedAnalyticalReference,
      price: currentPrice,
    },
    fc,
    benchmarks
  );

  return {
    subject_type: subjectType,
    product_id: merged.id,
    candidate_id: input.candidate_id || null,
    category: merged.category,
    channel: ctx.channel,

    // Contrat économique canonique.
    flow_variable_cost_kmf: flowVariableCost,
    business_variable_cost_kmf: businessVariableCost,
    variable_cost_complete_kmf: variableComplete,
    contribution_kmf: estimatedContribution !== null ? r(estimatedContribution) : null,
    contribution_rate_pct: estimatedContributionRate !== null ? Number(estimatedContributionRate.toFixed(1)) : null,

    structure_allocation_reference_kmf: structureAllocationReference,
    structure_allocation_authority: 'ANALYTICAL_ONLY_NOT_SKU_DEBT',
    fully_loaded_cost_reference_kmf: fullyLoadedAnalyticalReference,
    fully_loaded_reference_authority: 'ANALYTICAL_ONLY_NOT_PRICE_FLOOR',

    minimum_safe_price_kmf: prices.minimum_safe_price_kmf,
    economic_reference_price_kmf: prices.economic_reference_price_kmf ?? prices.recommended_price_kmf,
    recommended_price_kmf: prices.recommended_price_kmf,
    recommended_price_authority: prices.price_authority || 'ECONOMIC_REFERENCE_NOT_MARKET_DECISION',
    final_price_kmf: finalPrice,
    price_decision_status: finalPrice == null ? 'MARKET_OR_HUMAN_DECISION_REQUIRED' : 'EXPLICIT_DECISION_PROVIDED',
    pricing_strategy: pricingStrategy,
    strategy_risk: strategyRisk,
    strategies,
    safety_margin_pct: prices.safety_margin_pct,

    allocations: cdr.details?._allocations || [],
    allocation_averages: allocationAverages,
    proportions,

    landed_relay_cost_kmf: breakdown.landed_relay_cost_kmf,
    business_complete_cost_kmf: breakdown.business_complete_cost_kmf,
    cost_breakdown: {
      landed_relay: breakdown.landed_relay,
      business: breakdown.business,
      allocations: cdr.details?._allocations || [],
      allocation_averages: allocationAverages,
    },

    current_price_kmf: r(currentPrice),
    survival_price_kmf: prices.survival_price_kmf,
    test_price_kmf: prices.test_price_kmf,
    scenarios,
    recommended_scenario_id: 'honest_baseline',

    // Compatibilité technique : visibles pour les anciens consommateurs, jamais autorité pricing.
    cost_complete_estimated_kmf: cdr.cost_complete_estimated_kmf,
    variable_cost_estimated_kmf: cdr.variable_cost_estimated_kmf,
    fixed_cost_allocation_kmf: cdr.fixed_cost_allocation_kmf,
    risk_provision_estimated_kmf: cdr.risk_provision_estimated_kmf,

    target_margin_pct: prices.target_margin_pct,
    estimated_margin_pct: estimatedContributionRate !== null ? Number(estimatedContributionRate.toFixed(1)) : null,
    estimated_contribution_kmf: estimatedContribution !== null ? r(estimatedContribution) : null,

    monthly_fixed_costs_kmf: monthlyStructure,
    target_orders_per_month: cdr.target_orders_per_month,
    equivalent_articles_to_cover_structure_at_current_sku_contribution: equivalentArticlesToCoverStructure,
    equivalent_orders_to_cover_structure_at_current_sku_contribution: equivalentOrdersToCoverStructure,
    monthly_break_even_orders: equivalentOrdersToCoverStructure,
    break_even_authority: 'ANALYTICAL_EQUIVALENT_NOT_PORTFOLIO_FORECAST',

    health_status: healthStatus,
    market_confidence: market.market_confidence,
    sourcing_decision: sourcingDecision,
    reason,
    recommended_action: ({
      PRIORITY: 'Sourcer plus si la preuve marché le confirme ; le prix reste une décision pays.',
      TEST: 'Tester en faible quantité et enrichir la preuve marché.',
      WATCH: 'Surveiller coûts variables et preuve marché avant décision.',
      AVOID: 'Éviter tant que l’économie unitaire ou le marché restent insuffisants.',
      LOSS: 'Prix sous coût variable : corriger ou retirer.',
      RENEGOTIATE: 'Renégocier le coût fournisseur ou les charges variables.',
      INCREASE_PRICE: 'Revoir le prix dans la borne marché pour restaurer la contribution.',
    })[sourcingDecision] || 'À examiner manuellement',

    data_quality: dataQuality,
    market_signals: market.market_signals,
    details: cdr.details,
    alerts,
    warnings,
    generated_at: new Date().toISOString(),
  };
}

module.exports = {
  recommend,
  loadGlobalConfig,
  computeCDR,
  computePrices,
  computeScenarios,
  computeStrategies: require('./pricing-output').computeStrategies,
  computeFixedCostAllocation: require('./pricing-cdr').computeFixedCostAllocation,
  computeMarketConfidence,
  computeHealthStatus,
  computeSourcingDecision,
  buildAlerts,
  buildRecommendationText,
  buildCostBreakdown,
  buildDataQuality,
  inferSubjectType,
  HEALTH_THRESHOLDS,
  MARKET_THRESHOLDS,
};