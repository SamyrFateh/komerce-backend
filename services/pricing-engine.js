/**
 * KOMERCE — Pricing Engine (Orchestrateur)
 * ════════════════════════════════════════
 *
 * Point d'entrée unique du moteur de pricing.
 * Responsabilité : orchestrer les 3 couches de calcul.
 *
 * Architecture (après découpe) :
 *   pricing-cdr.js     → loadGlobalConfig + computeFixedCostAllocation + computeCDR
 *   pricing-output.js  → computePrices + computeScenarios + health + sourcing + alertes + textes
 *   pricing-engine.js  → recommend() + computeMarketConfidence() (accès DB) ← ICI
 *
 * Consommé par :
 *   - routes/pricing.js → /recommend, /recommend-batch, /dashboard
 *   - services/apply-pricing-updates.js
 *   - services/order-cost-snapshot.js
 *   - services/sourcing-engine.js
 *   - routes/sourcing-scanner.js
 *   - routes/supplier-catalog-scanner.js
 */

'use strict';

const db = require('../db');
const { loadGlobalConfig, computeCDR } = require('./pricing-cdr');
const {
  computePrices,
  computeScenarios,
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

// ═══════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════

function r(n) { return Math.round(Number(n) || 0); }

// ═══════════════════════════════════════════════════════════════════
// MARKET CONFIDENCE (Doctrine §7) — accès DB
// ═══════════════════════════════════════════════════════════════════

/**
 * Calcule market_confidence pour un produit.
 * Seule fonction de ce fichier qui touche la DB (hors loadGlobalConfig).
 *
 * @param {String} productId
 * @returns { market_confidence, market_signals, warnings }
 */
async function computeMarketConfidence(productId) {
  const warnings = [];
  const signals = {
    paid_orders_count: 0,
    days_to_first_sale: null,
    repeat_purchase_signal: null,
    days_since_publication: null,
    // Signaux non encore trackés
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
    const paidOrders  = Number(r0.paid_orders) || 0;
    const uniqueBuyers = Number(r0.unique_buyers) || 0;
    signals.paid_orders_count = paidOrders;

    const { rows: prodRows } = await db.query('SELECT created_at FROM products WHERE id = $1', [productId]);
    const productCreatedAt = prodRows[0]?.created_at;
    if (productCreatedAt) {
      const daysSincePub = Math.floor((Date.now() - new Date(productCreatedAt).getTime()) / 86400000);
      signals.days_since_publication = daysSincePub;
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
      confidence = (signals.days_since_publication >= MARKET_THRESHOLDS.REJECTED_DAYS_NOSALE) ? 'rejected' : 'unknown';
    } else if (paidOrders >= MARKET_THRESHOLDS.SCALING_MIN_SALES)   confidence = 'scaling';
    else if (paidOrders >= MARKET_THRESHOLDS.VALIDATED_MIN_SALES)   confidence = 'validated';
    else if (paidOrders >= MARKET_THRESHOLDS.TESTING_MIN_SALES)     confidence = 'testing';

    if (confidence === 'unknown') {
      warnings.push('Données marché insuffisantes. Recommandation basée sur coûts et hypothèses.');
    }

    return { market_confidence: confidence, market_signals: signals, warnings };
  } catch (err) {
    warnings.push('Impossible de calculer market_confidence : ' + err.message);
    return { market_confidence: 'unknown', market_signals: signals, warnings };
  }
}

// ═══════════════════════════════════════════════════════════════════
// API PRINCIPALE — recommend()
// ═══════════════════════════════════════════════════════════════════

/**
 * Calcule la recommandation pricing complète pour un produit ou un input libre.
 *
 * @param {Object} input   { product_id?, category, channel, cost_kmf, weight_kg, volume_m3, current_price_kmf }
 * @param {Object} options { config? } pour réutiliser une config déjà chargée (batch)
 */
async function recommend(input, options = {}) {
  const config = options.config || (await loadGlobalConfig());
  const fc = config.finance;

  // ── Résolution produit ────────────────────────────────────────────
  let product = null;
  if (input.product_id) {
    const r0 = await db.query('SELECT * FROM products WHERE id = $1', [input.product_id]);
    if (r0.rows.length) product = r0.rows[0];
  }

  const merged = {
    id:        input.product_id || product?.id || null,
    category:  input.category   || product?.category  || 'phones',
    cost_kmf:  input.cost_kmf   != null ? input.cost_kmf  : product?.cost_kmf,
    weight_kg: input.weight_kg  != null ? input.weight_kg : product?.weight_kg,
    price_kmf: input.current_price_kmf != null ? input.current_price_kmf : product?.price_kmf,
  };

  const ctx = {
    config,
    volume_m3: input.volume_m3 || 0.005,
    channel:   input.channel   || 'cash_relais',
  };

  // ── 1. CDR ────────────────────────────────────────────────────────
  const cdr = computeCDR(merged, ctx);
  const cat = config.categories[merged.category];

  // ── 2. Prix + scénarios ───────────────────────────────────────────
  const prices    = computePrices(cdr, cat, fc);
  const scenarios = computeScenarios(cdr, prices, cat, fc);

  // ── 3. Marge & contribution (sur prix actuel) ─────────────────────
  const currentPrice = Number(merged.price_kmf) || 0;
  let estimatedMarginPct    = null;
  let estimatedContribution = null;
  if (currentPrice > 0) {
    estimatedMarginPct    = ((currentPrice - cdr.cost_complete_estimated_kmf) / currentPrice) * 100;
    estimatedContribution = currentPrice - (cdr.variable_cost_estimated_kmf - cdr.risk_provision_estimated_kmf);
  }

  // ── 4. Seuil de rentabilité ───────────────────────────────────────
  const monthlyFixed     = cdr.monthly_fixed_costs_kmf;
  const avgContribution  = estimatedContribution || prices.recommended_price_kmf - cdr.variable_cost_estimated_kmf;
  const monthlyBreakEven = avgContribution > 0 ? Math.ceil(monthlyFixed / avgContribution) : 0;

  // ── 5–8. Health / Market / Sourcing / Alertes ─────────────────────
  const healthStatus    = computeHealthStatus(currentPrice, cdr.cost_complete_estimated_kmf, estimatedMarginPct);
  const market          = await computeMarketConfidence(merged.id);
  const sourcingDecision = computeSourcingDecision({ health_status: healthStatus, market_confidence: market.market_confidence, weight_kg: merged.weight_kg });
  const alerts          = buildAlerts({ current_price_kmf: currentPrice, cost_complete_estimated_kmf: cdr.cost_complete_estimated_kmf, estimated_margin_pct: estimatedMarginPct, estimated_contribution_kmf: estimatedContribution, fixed_cost_allocation_kmf: cdr.fixed_cost_allocation_kmf, monthly_break_even_orders: monthlyBreakEven, target_orders_per_month: cdr.target_orders_per_month });
  const reason          = buildRecommendationText({ health_status: healthStatus, market_confidence: market.market_confidence, sourcing_decision: sourcingDecision, recommended_price_kmf: prices.recommended_price_kmf, cost_complete_estimated_kmf: cdr.cost_complete_estimated_kmf, target_margin_pct: prices.target_margin_pct, current_price_kmf: currentPrice, estimated_margin_pct: estimatedMarginPct, weight_kg: merged.weight_kg });

  // ── 9. Lot G : breakdown + data quality + subject type ───────────
  const breakdown   = buildCostBreakdown(cdr.details);
  const warnings    = [...cdr.warnings, ...market.warnings];
  const dataQuality = buildDataQuality(input, { hasProduct: !!product, hasCustomsCategory: !!cat, hasFinanceConfig: !!fc && Object.keys(fc).length > 0, warnings });
  const subjectType = inferSubjectType(input, { hasProduct: !!product });

  return {
    // ── Subject ──────────────────────────────────────────────────────
    subject_type: subjectType,
    product_id:   merged.id,
    candidate_id: input.candidate_id || null,
    category:     merged.category,
    channel:      ctx.channel,

    // ── Coûts doctrinaux ─────────────────────────────────────────────
    landed_relay_cost_kmf:      breakdown.landed_relay_cost_kmf,
    business_complete_cost_kmf: breakdown.business_complete_cost_kmf,
    cost_breakdown: {
      landed_relay: breakdown.landed_relay,
      business:     breakdown.business,
      allocations:  cdr.details._allocations || [],
      allocation_averages: {
        articles_per_order:    Number(fc.avg_articles_per_order)    || 2.5,
        articles_per_parcel:   Number(fc.avg_articles_per_parcel)   || 4.0,
        articles_per_shipment: Number(fc.avg_articles_per_shipment) || 200.0,
        confidence:            fc.allocation_confidence || 'low',
      },
    },

    // ── Prix ─────────────────────────────────────────────────────────
    current_price_kmf:      r(currentPrice),
    survival_price_kmf:     prices.survival_price_kmf,
    minimum_safe_price_kmf: prices.minimum_safe_price_kmf,
    recommended_price_kmf:  prices.recommended_price_kmf,
    test_price_kmf:         prices.test_price_kmf,

    // ── Scénarios ────────────────────────────────────────────────────
    scenarios,
    recommended_scenario_id: 'honest_baseline',

    // ── Coûts legacy (rétro-compat) ──────────────────────────────────
    cost_complete_estimated_kmf:  cdr.cost_complete_estimated_kmf,
    variable_cost_estimated_kmf:  cdr.variable_cost_estimated_kmf,
    fixed_cost_allocation_kmf:    cdr.fixed_cost_allocation_kmf,
    risk_provision_estimated_kmf: cdr.risk_provision_estimated_kmf,

    // ── Marge ────────────────────────────────────────────────────────
    target_margin_pct:            prices.target_margin_pct,
    estimated_margin_pct:         estimatedMarginPct !== null ? Number(estimatedMarginPct.toFixed(1)) : null,
    estimated_contribution_kmf:   estimatedContribution !== null ? r(estimatedContribution) : null,

    // ── Pilotage ─────────────────────────────────────────────────────
    monthly_fixed_costs_kmf:    monthlyFixed,
    target_orders_per_month:    cdr.target_orders_per_month,
    monthly_break_even_orders:  monthlyBreakEven,

    // ── Santé + décision ─────────────────────────────────────────────
    health_status:      healthStatus,
    market_confidence:  market.market_confidence,
    sourcing_decision:  sourcingDecision,
    reason,
    recommended_action: ({
      PRIORITY:       'Sourcer plus. Augmenter le stock pour profiter de la demande.',
      TEST:           'Tester en faible quantité. Ne pas sourcer massivement avant signal marché.',
      WATCH:          'Surveiller. Compléter les données avant décision.',
      AVOID:          'Éviter. Renégocier le prix fournisseur ou changer de produit.',
      LOSS:           'Vendu sous coût. Corriger le prix ou retirer du catalogue.',
      RENEGOTIATE:    'Renégocier avec le fournisseur (prix d\'achat trop élevé).',
      INCREASE_PRICE: 'Augmenter le prix de vente actuel pour restaurer la marge.',
    })[sourcingDecision] || 'À examiner manuellement',

    // ── Data quality ─────────────────────────────────────────────────
    data_quality: dataQuality,

    // ── Détails / signaux / alerts ───────────────────────────────────
    market_signals: market.market_signals,
    details: cdr.details,
    alerts,
    warnings,

    generated_at: new Date().toISOString(),
  };
}

module.exports = {
  // API principale
  recommend,
  // Helpers exposés pour tests / batch
  loadGlobalConfig,
  computeCDR,
  computePrices,
  computeScenarios,
  computeFixedCostAllocation: require('./pricing-cdr').computeFixedCostAllocation,
  computeMarketConfidence,
  computeHealthStatus,
  computeSourcingDecision,
  buildAlerts,
  buildRecommendationText,
  buildCostBreakdown,
  buildDataQuality,
  inferSubjectType,
  // Constantes
  HEALTH_THRESHOLDS,
  MARKET_THRESHOLDS,
};
