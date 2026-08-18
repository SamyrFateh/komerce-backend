/**
 * @komerce-arch
 * @role          economic-engine-pricing-cdr
 * @domain        economic-engine
 * @layer         service
 * @criticality   high
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       db, utils/rates.js
 * @used-by       services/pricing-engine.js
 * @db-read       charges, cost_benchmarks, cost_components, customs_categories, finance_config, pricing_components, risk_provisions
 * @db-write      none
 * @db-txn        resolve_before_behavior_change
 * @doctrine      resolve_before_behavior_change
 * @impact-areas  economic-engine
 * @version       2026-06
 */

/**
 * KOMERCE — Pricing CDR (Coût De Revient)
 * ════════════════════════════════════════
 *
 * Calculs de coût de revient extraits de pricing-engine.js.
 * Responsabilité :
 *   - Charger la config globale depuis la DB (loadGlobalConfig)
 *   - Calculer l'allocation des charges fixes (computeFixedCostAllocation)
 *   - Calculer le CDR complet d'un produit (computeCDR)
 *   - Helpers legacy de mapping catégories
 *
 * Consommé uniquement par services/pricing-engine.js.
 */

'use strict';

const db = require('../db');
const { resolveFxRates } = require('../utils/rates');

const DEFAULT_TARGET_ORDERS_PER_MONTH = 100;

function r(n) { return Math.round(Number(n) || 0); }

// ── Helpers legacy ────────────────────────────────────────────────
function _legacyFamilyFromCategory(oldCat) {
  if (oldCat === 'paiement') return 'business';
  return 'landed_relay';
}

function _legacyCategoryToNew(oldCat, key) {
  const k = (key || '').toLowerCase();
  if (oldCat === 'sourcing') return 'sourcing';
  if (oldCat === 'transit') return 'freight';
  if (oldCat === 'douane') {
    if (k.includes('transitaire') || k.includes('portuaire')) return 'port_transitary';
    return 'customs';
  }
  if (oldCat === 'hub') {
    if (k.includes('packaging') || k.includes('emballage')) return 'packaging';
    return 'hub';
  }
  if (oldCat === 'distribution') {
    if (k.includes('commission') || (k.includes('relais') && !k.includes('transport'))) return 'relay';
    return 'local_distribution';
  }
  if (oldCat === 'paiement') return 'payment';
  return 'sourcing';
}

// ── Config globale ────────────────────────────────────────────────
async function loadGlobalConfig() {
  let components = [];
  let componentsSource = 'cost_components';
  try {
    const ccRes = await db.query(`
      SELECT id, key, label, emoji, description, family, category,
             default_value, unit, currency, scope, scope_value, allocation_method,
             source, confidence, channel, island, is_active, is_exceptional,
             active_from, active_until, display_order
      FROM cost_components
      WHERE is_active = TRUE AND is_exceptional = FALSE
        AND (active_from IS NULL OR active_from <= CURRENT_DATE)
        AND (active_until IS NULL OR active_until >= CURRENT_DATE)
      ORDER BY display_order, key
    `);
    components = ccRes.rows;
  } catch (err) {
    components = [];
  }

  if (!components.length) {
    try {
      const pcRes = await db.query('SELECT * FROM pricing_components WHERE is_active = TRUE');
      components = pcRes.rows.map(c => ({
        ...c,
        family: _legacyFamilyFromCategory(c.category),
        category: _legacyCategoryToNew(c.category, c.key),
        scope: 'global',
        is_exceptional: false,
      }));
      componentsSource = 'pricing_components_legacy';
    } catch (errFallback) {
      components = [];
    }
  }

  const [fcRes, catsRes, provRes, chargesRes] = await Promise.all([
    db.query('SELECT * FROM finance_config WHERE id = 1'),
    db.query('SELECT * FROM customs_categories WHERE is_active = TRUE'),
    db.query('SELECT * FROM risk_provisions WHERE is_active = TRUE'),
    db.query('SELECT * FROM charges WHERE is_active = TRUE'),
  ]);

  const categories = {};
  catsRes.rows.forEach(c => { categories[c.key] = c; });

  // Benchmarks de surcharge par famille (optionnel — calibration). Table absente → [].
  let costBenchmarks = [];
  try {
    const bmRes = await db.query('SELECT category, cost_family, expected_share_pct, warn_ratio, alert_ratio FROM cost_benchmarks WHERE is_active = TRUE');
    costBenchmarks = bmRes.rows;
  } catch (err) {
    costBenchmarks = [];
  }

  return {
    finance: fcRes.rows[0] || {},
    categories,
    components,
    components_source: componentsSource,
    provisions: provRes.rows,
    charges: chargesRes.rows,
    cost_benchmarks: costBenchmarks,
  };
}

// ── Charges fixes par commande ─────────────────────────────────────
function computeFixedCostAllocation(charges, finance) {
  const warnings = [];
  const totalMonthly  = charges.filter(c => c.recurrence_period === 'monthly').reduce((s, c) => s + Number(c.amount_kmf || 0), 0);
  const totalWeekly   = charges.filter(c => c.recurrence_period === 'weekly').reduce((s, c) => s + Number(c.amount_kmf || 0), 0);
  const totalYearly   = charges.filter(c => c.recurrence_period === 'yearly').reduce((s, c) => s + Number(c.amount_kmf || 0), 0);
  const totalPerOrder = charges.filter(c => c.recurrence_period === 'per_order').reduce((s, c) => s + Number(c.amount_kmf || 0), 0);
  const monthlyFixedCosts = totalMonthly + (totalWeekly * 4.33) + (totalYearly / 12);

  let targetOrdersPerMonth = Number(finance.objectif_commandes_mois) || 0;
  if (!targetOrdersPerMonth) {
    targetOrdersPerMonth = DEFAULT_TARGET_ORDERS_PER_MONTH;
    warnings.push(`objectif_commandes_mois absent dans finance_config — utilisation valeur par défaut ${DEFAULT_TARGET_ORDERS_PER_MONTH}.`);
  }

  // Doctrine §9/§10 : N3 est imputé PAR ARTICLE, pas par commande. La chaîne entière
  // (N1, N2, contribution, prix) est par article — N3 doit l'être aussi, sinon le CDR
  // mélange deux unités et se retrouve gonflé.
  //   charges mensuelles / commandes cibles / articles par commande
  // Avant : (monthly / orders) + perOrder  → quote-part PAR COMMANDE (incohérent).
  const avgArticlesPerOrder = Number(finance.avg_articles_per_order) || 2.5;
  const fixedPerOrder   = (monthlyFixedCosts / targetOrdersPerMonth) + totalPerOrder;
  const fixedPerArticle = fixedPerOrder / avgArticlesPerOrder;

  return {
    fixed_cost_allocation_kmf: r(fixedPerArticle),
    monthly_fixed_costs_kmf: r(monthlyFixedCosts),
    target_orders_per_month: targetOrdersPerMonth,
    articles_per_order: avgArticlesPerOrder,
    warnings,
  };
}

// ── CDR complet ────────────────────────────────────────────────────
function computeCDR(product, ctx = {}) {
  const cfg = ctx.config;
  const fc = cfg.finance;
  const warnings = [];

  const fx = resolveFxRates(fc);
  const taxAED  = fx.aed_kmf;
  const taxEUR  = fx.eur_kmf;
  const taxUSD  = fx.usd_kmf;
  const fretEUR = Number(fc.fret_eur_per_m3) || 180;

  const categoryKey    = product.category || 'phones';
  const cat            = cfg.categories[categoryKey];
  if (!cat) warnings.push(`Catégorie "${categoryKey}" inconnue — taux douane par défaut utilisés.`);

  const productCostKmf = Number(product.cost_kmf) || 0;
  const weightKg       = Number(product.weight_kg) || 1;
  const volM3          = Number(ctx.volume_m3) || 0.005;
  const channel        = ctx.channel || 'cash_relais';

  if (productCostKmf <= 0) warnings.push('cost_kmf absent ou nul sur le produit — CDR non significatif.');

  const details = {
    product_cost: r(productCostKmf),
    sourcing: 0, hub: 0, packaging: 0,
    freight: 0, customs: 0, port_transitaire: 0,
    distribution: 0, local_distribution: 0, relay: 0,
    payment: 0, risks: 0, fixed_costs: 0,
  };

  const freightEstimated = volM3 * fretEUR * taxEUR;
  details.freight = r(freightEstimated);
  let runningSubtotal = productCostKmf + freightEstimated;

  for (const c of cfg.components) {
    const v = Number(c.default_value || 0);
    const a = c.applies_to || 'all';
    if (a !== 'all' && !a.startsWith('category:' + categoryKey) && !a.startsWith('channel:' + channel)) continue;
    if (c.scope === 'category' && c.scope_value && c.scope_value !== categoryKey) continue;
    if (c.channel && c.channel !== channel) continue;
    if ((c.category === 'paiement' || c.category === 'payment') && !c.channel) {
      if (channel === 'cash_relais' && (c.key || '').startsWith('stripe_')) continue;
      if (channel === 'diaspora' && !(c.key || '').startsWith('stripe_') && (c.key || '').includes('cash')) continue;
    }

    const avgArticlesPerOrder    = Number(fc.avg_articles_per_order)    || 2.5;
    const avgArticlesPerParcel   = Number(fc.avg_articles_per_parcel)   || 4.0;
    const avgArticlesPerShipment = Number(fc.avg_articles_per_shipment) || 200.0;
    let amount = 0, engagedAmount = 0, allocationLevel = 'article', allocationDivisor = 1;

    switch (c.unit) {
      case 'pct':           amount = runningSubtotal * (v / 100); engagedAmount = amount; break;
      case 'kmf':           amount = v; engagedAmount = amount; break;
      case 'kmf_per_kg':    amount = v * weightKg; engagedAmount = amount; break;
      case 'kmf_per_m3':    amount = v * volM3; engagedAmount = amount; break;
      case 'kmf_per_order':
        engagedAmount = v; allocationDivisor = avgArticlesPerOrder;
        amount = v / allocationDivisor; allocationLevel = 'order'; break;
      case 'kmf_per_parcel':
        engagedAmount = v; allocationDivisor = avgArticlesPerParcel;
        amount = v / allocationDivisor; allocationLevel = 'parcel'; break;
      case 'kmf_per_shipment':
        engagedAmount = v; allocationDivisor = avgArticlesPerShipment;
        amount = v / allocationDivisor; allocationLevel = 'shipment'; break;
      case 'aed': amount = v * taxAED; engagedAmount = amount; break;
      case 'eur': amount = v * taxEUR; engagedAmount = amount; break;
      case 'usd': amount = v * taxUSD; engagedAmount = amount; break;
    }

    if (!details._allocations) details._allocations = [];
    if (amount > 0) {
      // base de répartition (doctrine §5)
      const basis = ({ kmf_per_kg: 'weight', kmf_per_m3: 'volume', pct: 'value' })[c.unit] || 'quantity';
      const lineConfidence = allocationLevel === 'article' ? 'high' : (fc.allocation_confidence || 'low');
      details._allocations.push({
        component_key: c.key || null, component_label: c.label || c.key || '',
        category: c.category || null, unit: c.unit,
        // ── noms doctrinaux (contrat §8) ──
        allocation_level: allocationLevel,        // article | parcel | order | shipment | month
        allocation_basis: basis,                  // quantity | weight | volume | value | manual
        engaged_cost_kmf: r(engagedAmount),
        allocation_divisor: r(allocationDivisor * 100) / 100,
        allocated_cost_kmf: r(amount),
        confidence: lineConfidence,
        // ── alias historiques (compatibilité) ──
        engaged_amount_kmf: r(engagedAmount), engaged_level: allocationLevel,
        imputed_amount_kmf: r(amount),
      });
    }

    switch (c.category) {
      case 'product_purchase':   details.product_cost += amount; break;
      case 'sourcing':           details.sourcing += amount; break;
      case 'hub':                details.hub += amount; break;
      case 'packaging':          details.packaging += amount; break;
      case 'freight': case 'transit':      details.freight += amount; break;
      case 'customs': case 'douane':       details.customs += amount; break;
      case 'port_transitary':    details.port_transitaire += amount; break;
      case 'local_distribution': case 'distribution': details.local_distribution += amount; details.distribution += amount; break;
      case 'relay':              details.relay += amount; details.distribution += amount; break;
      case 'payment': case 'paiement':     details.payment += amount; break;
      case 'risk_provision':     details.risks += amount; break;
      case 'fixed_overhead':     details.fixed_costs += amount; break;
      default:                   details.sourcing += amount;
    }
    runningSubtotal += amount;
  }

  if (cat) {
    const baseDouane = productCostKmf + freightEstimated;
    const customsAmt = baseDouane * (Number(cat.douane_pct) || 0) / 100;
    const tvaAmt     = baseDouane * (Number(cat.tva_pct) || 0) / 100;
    const taxAddAmt  = baseDouane * (Number(cat.taxe_add_pct) || 0) / 100;
    // P2 fix : la matrice catégorie est la source de vérité douane (ADR-004).
    // Retirer la douane éventuellement déjà imputée par des cost_components
    // (details.customs = somme brute des composants douane à ce stade) afin
    // d'éviter un double-comptage dans runningSubtotal. No-op si aucun composant douane.
    runningSubtotal -= details.customs;
    details.customs = r(customsAmt + tvaAmt + taxAddAmt);
    runningSubtotal += customsAmt + tvaAmt + taxAddAmt;
  }

  const variableCostEstimated = runningSubtotal;
  const fixedAlloc = computeFixedCostAllocation(cfg.charges, fc);
  if (fixedAlloc.warnings.length) warnings.push(...fixedAlloc.warnings);
  details.fixed_costs = fixedAlloc.fixed_cost_allocation_kmf;

  if (!fc.allocation_calibrated_at && (fc.allocation_confidence || 'low') === 'low') {
    if ((details._allocations || []).some(a => a.engaged_level !== 'article')) {
      warnings.push('Moyennes d\'allocation non calibrées (hypothèses initiales). Les coûts par shipment/colis/commande sont divisés par des valeurs estimées. À recalibrer dans finance_config dès que vous aurez du volume réel.');
    }
  }

  // Doctrine §3 : la provision risque est un coût VARIABLE (N2). Elle se calcule sur
  // le coût variable engagé (N1 + paiement), jamais sur la quote-part de charges fixes (N3).
  // Avant : baseRisks = variable + fixe → gonflait N2 avec une part de N3.
  let risksAmount = 0;
  const baseRisks = variableCostEstimated;
  for (const p of cfg.provisions) risksAmount += baseRisks * (Number(p.rate_pct) / 100);
  details.risks = r(risksAmount);

  for (const k of Object.keys(details)) {
    if (k === '_allocations') continue;
    details[k] = r(details[k]);
  }

  const variableTotal  = r(variableCostEstimated + risksAmount);
  const fixedTotal     = fixedAlloc.fixed_cost_allocation_kmf;

  return {
    variable_cost_estimated_kmf:  variableTotal,
    fixed_cost_allocation_kmf:    fixedTotal,
    risk_provision_estimated_kmf: r(risksAmount),
    cost_complete_estimated_kmf:  variableTotal + fixedTotal,
    monthly_fixed_costs_kmf:      fixedAlloc.monthly_fixed_costs_kmf,
    target_orders_per_month:      fixedAlloc.target_orders_per_month,
    details,
    warnings,
    _meta: { taxAED, taxEUR, fretEUR, category: categoryKey, channel },
  };
}

module.exports = {
  loadGlobalConfig,
  computeFixedCostAllocation,
  computeCDR,
  _legacyFamilyFromCategory,
  _legacyCategoryToNew,
};
