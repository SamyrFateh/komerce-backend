/**
 * KOMERCE — Pricing Engine Service
 * ═════════════════════════════════
 *
 * Coeur du moteur de pricing aligné sur la doctrine économique Komerce.
 * Voir : docs/DOCTRINE_ECONOMIQUE_KOMERCE.md
 *
 * Phrase de vérité :
 *   Komerce ne cherche pas le prix parfait au lancement.
 *   Komerce cherche un prix protégé qui permet d'apprendre le marché
 *   sans vendre à perte, puis utilise les signaux réels pour décider
 *   quoi sourcer, renforcer, corriger ou arrêter.
 *
 * Responsabilité :
 *   - Calculer les 4 prix : survival, minimum_safe, recommended, test
 *   - Calculer health_status (loss / danger / fragile / healthy / strong / unknown)
 *   - Calculer market_confidence (unknown / testing / validated / scaling / rejected)
 *   - Recommander une sourcing_decision (PRIORITY / TEST / WATCH / AVOID / LOSS)
 *   - Produire une explication lisible humainement
 *
 * Ce service est consommé par :
 *   - routes/pricing.js → /recommend, /recommend-batch, /dashboard
 *
 * Sources de vérité (cf. ADR-009 à ADR-011) :
 *   - finance_config            : config singleton (cible marge, taux change, objectifs)
 *   - customs_categories        : douane/TVA/marge cible par catégorie
 *   - pricing_components        : Niveau 1 (variables par commande)
 *   - risk_provisions           : Niveau 3 (provisions risques)
 *   - charges                   : Niveau 2 (charges fixes mensuelles)
 *   - products                  : produits avec cost_kmf, weight_kg, price_kmf
 *   - orders / order_items      : pour calculer market_confidence (ventes payées)
 */

'use strict';

const db = require('../db');

// ═══════════════════════════════════════════════════════════════════
// CONSTANTES — Seuils doctrinaux (§6 et §7 de la doctrine)
// ═══════════════════════════════════════════════════════════════════

const HEALTH_THRESHOLDS = {
  DANGER_PCT:   15,   // marge < 15 %  → danger
  FRAGILE_PCT:  25,   // marge < 25 %  → fragile
  HEALTHY_PCT:  40,   // marge ≤ 40 %  → healthy, sinon strong
};

const MARKET_THRESHOLDS = {
  TESTING_MIN_SALES:    1,    // 1+ ventes → testing
  VALIDATED_MIN_SALES:  6,    // 6+ ventes → validated
  SCALING_MIN_SALES:    20,   // 20+ ventes → scaling
  REJECTED_DAYS_NOSALE: 60,   // 60j sans vente avec produit actif → rejected
};

// Volume cible par défaut (si finance_config.objectif_commandes_mois absent)
const DEFAULT_TARGET_ORDERS_PER_MONTH = 100;

// ═══════════════════════════════════════════════════════════════════
// HELPERS UTILITAIRES
// ═══════════════════════════════════════════════════════════════════

/** Arrondi psychologique : 990, 490, 90, etc. */
function arrondiPsycho(x) {
  if (!x || x <= 0) return 0;
  if (x < 500)  return Math.ceil(x / 10) * 10;
  if (x < 1000) return Math.ceil(x / 100) * 100 - 10;
  const k = Math.ceil(x / 1000) * 1000;
  return k - 10;  // ex 13990
}

/** Round à l'entier (jamais de NaN) */
function r(n) {
  return Math.round(Number(n) || 0);
}

// ═══════════════════════════════════════════════════════════════════
// CHARGEMENT DES CONFIGURATIONS GLOBALES
// ═══════════════════════════════════════════════════════════════════

/**
 * Charge toutes les configs nécessaires pour le calcul.
 * Cache éventuellement à ajouter plus tard si performance critique.
 *
 * @returns {Object} { finance, categories, components, provisions, charges }
 */
async function loadGlobalConfig() {
  const [fcRes, catsRes, compRes, provRes, chargesRes] = await Promise.all([
    db.query('SELECT * FROM finance_config WHERE id = 1'),
    db.query('SELECT * FROM customs_categories WHERE is_active = TRUE'),
    db.query('SELECT * FROM pricing_components WHERE is_active = TRUE'),
    db.query('SELECT * FROM risk_provisions WHERE is_active = TRUE'),
    db.query('SELECT * FROM charges WHERE is_active = TRUE'),
  ]);

  const categories = {};
  catsRes.rows.forEach(c => { categories[c.key] = c; });

  return {
    finance: fcRes.rows[0] || {},
    categories,
    components: compRes.rows,
    provisions: provRes.rows,
    charges: chargesRes.rows,
  };
}

// ═══════════════════════════════════════════════════════════════════
// FIXED COST ALLOCATION (Niveau 2)
// ═══════════════════════════════════════════════════════════════════

/**
 * Calcule la part de charges fixes par commande.
 * Doctrine §4 : fixed_cost_allocation_kmf = monthly_fixed_costs / target_orders/mois
 *
 * Si target_orders_per_month absent → défaut configurable + warning.
 *
 * @returns { fixed_cost_allocation_kmf, monthly_fixed_costs_kmf, target_orders_per_month, warnings }
 */
function computeFixedCostAllocation(charges, finance) {
  const warnings = [];

  // Total charges mensuelles (monthly + weekly amorti + per_order)
  const totalMonthly = charges
    .filter(c => c.recurrence_period === 'monthly')
    .reduce((s, c) => s + Number(c.amount_kmf || 0), 0);
  const totalWeekly = charges
    .filter(c => c.recurrence_period === 'weekly')
    .reduce((s, c) => s + Number(c.amount_kmf || 0), 0);
  const totalYearly = charges
    .filter(c => c.recurrence_period === 'yearly')
    .reduce((s, c) => s + Number(c.amount_kmf || 0), 0);
  const totalPerOrder = charges
    .filter(c => c.recurrence_period === 'per_order')
    .reduce((s, c) => s + Number(c.amount_kmf || 0), 0);

  const monthlyFixedCosts = totalMonthly + (totalWeekly * 4.33) + (totalYearly / 12);

  let targetOrdersPerMonth = Number(finance.objectif_commandes_mois) || 0;
  if (!targetOrdersPerMonth) {
    targetOrdersPerMonth = DEFAULT_TARGET_ORDERS_PER_MONTH;
    warnings.push(
      `objectif_commandes_mois absent dans finance_config — utilisation valeur par défaut ${DEFAULT_TARGET_ORDERS_PER_MONTH}.`
    );
  }

  const fixedAllocPerOrder = (monthlyFixedCosts / targetOrdersPerMonth) + totalPerOrder;

  return {
    fixed_cost_allocation_kmf: r(fixedAllocPerOrder),
    monthly_fixed_costs_kmf: r(monthlyFixedCosts),
    target_orders_per_month: targetOrdersPerMonth,
    warnings,
  };
}

// ═══════════════════════════════════════════════════════════════════
// CDR — COÛT DE REVIENT COMPLET ESTIMÉ
// ═══════════════════════════════════════════════════════════════════

/**
 * Calcule le CDR (cost_complete_estimated) d'un produit.
 *
 * Doctrine §4 :
 *   cost_complete_estimated_kmf =
 *       product_cost
 *     + sourcing
 *     + hub_variable
 *     + freight_estimated
 *     + customs_estimated
 *     + port_transitaire_estimated
 *     + local_distribution_estimated
 *     + payment_cost_estimated
 *     + risk_provision_estimated
 *     + fixed_cost_allocation
 *
 * @param {Object} product   { id, category, cost_kmf, weight_kg }
 * @param {Object} ctx       contexte { config, prixAed?, volume_m3?, channel? }
 * @returns {Object} { variable, fixed, risks, total, details, warnings }
 */
function computeCDR(product, ctx = {}) {
  const cfg = ctx.config;
  const fc = cfg.finance;
  const warnings = [];

  // ── Taux ──
  const taxAED  = Number(fc.taux_aed_kmf) || 138;
  const taxEUR  = Number(fc.taux_change_eur_kmf) || 492;
  const fretEUR = Number(fc.fret_eur_per_m3) || 180;

  // ── Catégorie ──
  const categoryKey = product.category || 'phones';
  const cat = cfg.categories[categoryKey];
  if (!cat) warnings.push(`Catégorie "${categoryKey}" inconnue — taux douane par défaut utilisés.`);

  // ── Inputs produit ──
  const productCostKmf = Number(product.cost_kmf) || 0;
  const weightKg = Number(product.weight_kg) || 1;
  const volM3 = Number(ctx.volume_m3) || 0.005;  // défaut 5L
  const channel = ctx.channel || 'cash_relais';

  if (productCostKmf <= 0) {
    warnings.push('cost_kmf absent ou nul sur le produit — CDR non significatif.');
  }

  // ── Détails par poste (cf. doctrine §9 details) ──
  const details = {
    product_cost: r(productCostKmf),
    sourcing: 0,
    hub: 0,
    freight: 0,
    customs: 0,
    port_transitaire: 0,
    distribution: 0,
    payment: 0,
    risks: 0,
    fixed_costs: 0,
  };

  // Fret estimé (volume × tarif EUR/m³ × taux EUR)
  const freightEstimated = volM3 * fretEUR * taxEUR;
  details.freight = r(freightEstimated);

  // Composants Niveau 1 — répartis dans les bons buckets selon leur catégorie
  let runningSubtotal = productCostKmf + freightEstimated;
  for (const c of cfg.components) {
    const v = Number(c.default_value || 0);
    const a = c.applies_to || 'all';
    // Ne pas appliquer si la composante est restreinte à une autre catégorie
    if (a !== 'all' && !a.startsWith('category:' + categoryKey)) continue;
    // Filtrage canal (paiement diaspora vs cash_relais)
    if (c.category === 'paiement') {
      if (channel === 'cash_relais' && c.key.startsWith('stripe_')) continue;
      if (channel === 'diaspora' && !c.key.startsWith('stripe_') && c.key.includes('cash')) continue;
    }

    let amount = 0;
    switch (c.unit) {
      case 'pct':         amount = runningSubtotal * (v / 100); break;
      case 'kmf':         amount = v; break;
      case 'kmf_per_kg':  amount = v * weightKg; break;
      case 'kmf_per_m3':  amount = v * volM3; break;
      case 'aed':         amount = v * taxAED; break;
      case 'eur':         amount = v * taxEUR; break;
    }

    // Bucketing par category de pricing_components
    switch (c.category) {
      case 'sourcing':     details.sourcing += amount; break;
      case 'hub':          details.hub += amount; break;
      case 'transit':      details.freight += amount; break;
      case 'douane':       details.port_transitaire += amount; break;
      case 'distribution': details.distribution += amount; break;
      case 'paiement':     details.payment += amount; break;
      default:             details.sourcing += amount;
    }

    runningSubtotal += amount;
  }

  // Douane / TVA / Taxes additionnelles depuis customs_categories
  if (cat) {
    const baseDouane = productCostKmf + freightEstimated;
    const customsAmt = baseDouane * (Number(cat.douane_pct) || 0) / 100;
    const tvaAmt     = baseDouane * (Number(cat.tva_pct) || 0) / 100;
    const taxAddAmt  = baseDouane * (Number(cat.taxe_add_pct) || 0) / 100;
    details.customs = r(customsAmt + tvaAmt + taxAddAmt);
    runningSubtotal += customsAmt + tvaAmt + taxAddAmt;
  }

  // Coût variable estimé (avant risques et avant fixe)
  const variableCostEstimated = runningSubtotal;

  // Niveau 3 — Provisions de risque (% sur (variable + fixed))
  // On les calcule sur (variable + fixed) selon la doctrine
  let risksAmount = 0;

  // Niveau 2 — Part fixe par commande
  const fixedAlloc = computeFixedCostAllocation(cfg.charges, fc);
  if (fixedAlloc.warnings.length) warnings.push(...fixedAlloc.warnings);
  details.fixed_costs = fixedAlloc.fixed_cost_allocation_kmf;

  // Provisions risques — on les calcule sur (variable + fixed)
  const baseRisks = variableCostEstimated + fixedAlloc.fixed_cost_allocation_kmf;
  for (const p of cfg.provisions) {
    risksAmount += baseRisks * (Number(p.rate_pct) / 100);
  }
  details.risks = r(risksAmount);

  // Arrondi final des détails
  for (const k of Object.keys(details)) details[k] = r(details[k]);

  const variableTotal = r(variableCostEstimated + risksAmount);
  const fixedTotal = fixedAlloc.fixed_cost_allocation_kmf;
  const completeTotal = variableTotal + fixedTotal;

  return {
    variable_cost_estimated_kmf: variableTotal,
    fixed_cost_allocation_kmf: fixedTotal,
    risk_provision_estimated_kmf: r(risksAmount),
    cost_complete_estimated_kmf: completeTotal,
    monthly_fixed_costs_kmf: fixedAlloc.monthly_fixed_costs_kmf,
    target_orders_per_month: fixedAlloc.target_orders_per_month,
    details,
    warnings,
    _meta: { taxAED, taxEUR, fretEUR, category: categoryKey, channel },
  };
}

// ═══════════════════════════════════════════════════════════════════
// CALCUL DES 4 PRIX (Doctrine §3)
// ═══════════════════════════════════════════════════════════════════

/**
 * Produit les 4 prix doctrinaux à partir d'un CDR.
 *
 * @param {Object} cdr        résultat de computeCDR()
 * @param {Object} cat        customs_category de la cible (peut être null)
 * @param {Object} finance    finance_config
 * @returns { survival, minimum_safe, recommended, test, target_margin_pct }
 */
function computePrices(cdr, cat, finance) {
  // Marge cible : par catégorie sinon globale finance_config sinon 40 %
  const targetMarginPct = cat?.default_margin_pct
    ? Number(cat.default_margin_pct)
    : Number(finance?.target_marge_brute_pct) || 40;
  const margeDecimal = targetMarginPct / 100;

  // 1. Prix de survie : variables uniquement (sans risques, sans fixe)
  //    On veut juste couvrir les coûts directs.
  //    Note : variable_cost_estimated_kmf inclut déjà les risques selon notre
  //    implémentation. Pour respecter la doctrine §3.A "coûts variables uniquement",
  //    on prend la version SANS risque.
  const survivalPrice = cdr.variable_cost_estimated_kmf - cdr.risk_provision_estimated_kmf;

  // 2. Prix minimum sûr : variables + risques + fixed
  //    = cost_complete_estimated_kmf
  const minSafePrice = cdr.cost_complete_estimated_kmf;

  // 3. Prix conseillé : CDR / (1 - marge_cible)
  let recommendedPrice = 0;
  if (margeDecimal > 0 && margeDecimal < 1) {
    recommendedPrice = cdr.cost_complete_estimated_kmf / (1 - margeDecimal);
  }
  recommendedPrice = arrondiPsycho(recommendedPrice);

  // 4. Prix test marché : par défaut = recommandé.
  //    Doctrine §3.D : "ne doit jamais être inférieur au minimum_safe sauf décision admin"
  //    Ici on retient recommended car c'est le prix d'apprentissage non agressif.
  //    Si admin veut tester moins cher, il appliquera manuellement.
  const testPrice = Math.max(recommendedPrice, minSafePrice);

  return {
    survival_price_kmf: r(survivalPrice),
    minimum_safe_price_kmf: r(minSafePrice),
    recommended_price_kmf: r(recommendedPrice),
    test_price_kmf: r(testPrice),
    target_margin_pct: Number(targetMarginPct),
  };
}

// ═══════════════════════════════════════════════════════════════════
// MARKET CONFIDENCE (Doctrine §7)
// ═══════════════════════════════════════════════════════════════════

/**
 * Calcule market_confidence pour un produit.
 *
 * Sources de vérité :
 *   - orders + order_items pour compter les ventes payées
 *   - products.created_at pour days_since_publication
 *
 * Les autres signaux (views, paniers, WhatsApp) ne sont pas encore trackés
 * → market_signals = null pour ces champs et warning émis.
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
    // Compter ventes payées + date première vente + repeat purchase
    const { rows } = await db.query(
      `SELECT
         COUNT(DISTINCT o.id) FILTER (
           WHERE o.status NOT IN ('cancelled', 'refunded')
         ) AS paid_orders,
         MIN(o.created_at) FILTER (
           WHERE o.status NOT IN ('cancelled', 'refunded')
         ) AS first_sale_at,
         COUNT(DISTINCT o.user_id) FILTER (
           WHERE o.status NOT IN ('cancelled', 'refunded')
         ) AS unique_buyers
         FROM order_items oi
         JOIN orders o ON o.id = oi.order_id
        WHERE oi.product_id = $1`,
      [productId]
    );

    const r0 = rows[0] || {};
    const paidOrders = Number(r0.paid_orders) || 0;
    const uniqueBuyers = Number(r0.unique_buyers) || 0;
    signals.paid_orders_count = paidOrders;

    // Days to first sale (depuis création produit)
    const { rows: prodRows } = await db.query(
      `SELECT created_at FROM products WHERE id = $1`,
      [productId]
    );
    const productCreatedAt = prodRows[0]?.created_at;
    if (productCreatedAt) {
      const daysSincePub = Math.floor(
        (Date.now() - new Date(productCreatedAt).getTime()) / (1000 * 60 * 60 * 24)
      );
      signals.days_since_publication = daysSincePub;

      if (r0.first_sale_at) {
        const daysToFirst = Math.floor(
          (new Date(r0.first_sale_at).getTime() - new Date(productCreatedAt).getTime())
          / (1000 * 60 * 60 * 24)
        );
        signals.days_to_first_sale = Math.max(0, daysToFirst);
      }
    }

    // Repeat purchase = au moins un acheteur a commandé plusieurs fois ?
    if (paidOrders > uniqueBuyers && uniqueBuyers > 0) {
      signals.repeat_purchase_signal = true;
    } else if (paidOrders > 0) {
      signals.repeat_purchase_signal = false;
    }

    // Calcul confidence
    let confidence = 'unknown';
    if (paidOrders === 0) {
      // Si publié depuis longtemps sans aucune vente → rejected
      if (signals.days_since_publication >= MARKET_THRESHOLDS.REJECTED_DAYS_NOSALE) {
        confidence = 'rejected';
      } else {
        confidence = 'unknown';
      }
    } else if (paidOrders >= MARKET_THRESHOLDS.SCALING_MIN_SALES) {
      confidence = 'scaling';
    } else if (paidOrders >= MARKET_THRESHOLDS.VALIDATED_MIN_SALES) {
      confidence = 'validated';
    } else if (paidOrders >= MARKET_THRESHOLDS.TESTING_MIN_SALES) {
      confidence = 'testing';
    }

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
// HEALTH STATUS (Doctrine §6)
// ═══════════════════════════════════════════════════════════════════

/**
 * Calcule health_status à partir du prix actuel et du CDR.
 *
 * @param {Number} currentPrice
 * @param {Number} cdrComplete
 * @param {Number} estimatedMarginPct
 * @returns 'loss' | 'danger' | 'fragile' | 'healthy' | 'strong' | 'unknown'
 */
function computeHealthStatus(currentPrice, cdrComplete, estimatedMarginPct) {
  if (!currentPrice || currentPrice <= 0) return 'unknown';
  if (!cdrComplete || cdrComplete <= 0)   return 'unknown';
  if (currentPrice < cdrComplete)         return 'loss';
  if (estimatedMarginPct < HEALTH_THRESHOLDS.DANGER_PCT)   return 'danger';
  if (estimatedMarginPct < HEALTH_THRESHOLDS.FRAGILE_PCT)  return 'fragile';
  if (estimatedMarginPct <= HEALTH_THRESHOLDS.HEALTHY_PCT) return 'healthy';
  return 'strong';
}

// ═══════════════════════════════════════════════════════════════════
// SOURCING DECISION (Doctrine §8)
// ═══════════════════════════════════════════════════════════════════

/**
 * Recommande une décision sourcing.
 *
 * Règles doctrinales §8 :
 *   - LOSS : current_price < CDR
 *   - bonne marge + demande inconnue → TEST
 *   - bonne marge + demande positive → PRIORITY
 *   - marge faible + demande positive → WATCH (à RENEGOTIATE/INCREASE_PRICE)
 *   - marge faible + demande faible → AVOID
 *   - marge forte + demande faible → WATCH (à améliorer photo/offre)
 *   - lourd/volumineux → AVOID sauf demande spécifique
 *
 * @param {Object} args { health_status, market_confidence, weight_kg }
 * @returns 'PRIORITY' | 'TEST' | 'WATCH' | 'AVOID' | 'LOSS'
 */
function computeSourcingDecision({ health_status, market_confidence, weight_kg }) {
  // 1. Vendu à perte → toujours LOSS
  if (health_status === 'loss') return 'LOSS';

  // 2. Override : produit lourd → AVOID sauf demande prouvée
  const isHeavy = (weight_kg || 0) > 5;  // > 5 kg = lourd
  if (isHeavy && market_confidence !== 'validated' && market_confidence !== 'scaling') {
    return 'AVOID';
  }

  // 3. Demande forte (validated/scaling) → décide selon marge
  if (market_confidence === 'validated' || market_confidence === 'scaling') {
    if (health_status === 'strong' || health_status === 'healthy') return 'PRIORITY';
    if (health_status === 'fragile')                                return 'WATCH';
    if (health_status === 'danger')                                 return 'WATCH';
    return 'WATCH';
  }

  // 4. Demande inconnue (unknown/testing) → décide selon marge
  if (market_confidence === 'unknown' || market_confidence === 'testing') {
    if (health_status === 'strong' || health_status === 'healthy') return 'TEST';
    if (health_status === 'fragile')                                return 'WATCH';
    if (health_status === 'danger')                                 return 'AVOID';
    return 'TEST';
  }

  // 5. Rejected → AVOID (sauf si marge forte, alors WATCH pour décision admin)
  if (market_confidence === 'rejected') {
    if (health_status === 'strong') return 'WATCH';
    return 'AVOID';
  }

  return 'WATCH';
}

// ═══════════════════════════════════════════════════════════════════
// ALERTES (Doctrine §6)
// ═══════════════════════════════════════════════════════════════════

/**
 * Construit la liste d'alertes pour ce produit.
 */
function buildAlerts({
  current_price_kmf,
  cost_complete_estimated_kmf,
  estimated_margin_pct,
  estimated_contribution_kmf,
  fixed_cost_allocation_kmf,
  monthly_break_even_orders,
  target_orders_per_month,
}) {
  const alerts = [];

  if (current_price_kmf > 0 && current_price_kmf < cost_complete_estimated_kmf) {
    alerts.push({
      severity: 'critical',
      code: 'price_below_cost',
      message: 'Prix actuel inférieur au coût de revient complet estimé.',
    });
  }
  if (estimated_margin_pct !== null && estimated_margin_pct < HEALTH_THRESHOLDS.DANGER_PCT) {
    alerts.push({
      severity: 'critical',
      code: 'margin_dangerous',
      message: 'Marge estimée dangereusement faible.',
    });
  } else if (estimated_margin_pct !== null && estimated_margin_pct < HEALTH_THRESHOLDS.FRAGILE_PCT) {
    alerts.push({
      severity: 'warning',
      code: 'margin_fragile',
      message: 'Marge fragile, surveiller les coûts terrain.',
    });
  }

  if (
    estimated_contribution_kmf !== null
    && fixed_cost_allocation_kmf > 0
    && estimated_contribution_kmf < fixed_cost_allocation_kmf
  ) {
    alerts.push({
      severity: 'warning',
      code: 'contribution_insufficient',
      message: 'La commande ne couvre pas sa part de charges fixes.',
    });
  }

  if (monthly_break_even_orders > target_orders_per_month) {
    alerts.push({
      severity: 'warning',
      code: 'volume_target_too_low',
      message: 'Volume cible insuffisant pour couvrir les charges fixes.',
    });
  }

  return alerts;
}

// ═══════════════════════════════════════════════════════════════════
// RECOMMENDATION TEXT (langage humain)
// ═══════════════════════════════════════════════════════════════════

/**
 * Produit une phrase d'explication lisible humainement.
 *
 * Exemples doctrine :
 *   - "Produit rentable mais demande inconnue. TEST en faible quantité à 14 990 KMF."
 *   - "Produit demandé mais marge fragile. Renégocier ou augmenter prix."
 *   - "Produit léger, forte marge et premières ventes positives. Sourcing prioritaire."
 */
function buildRecommendationText({
  health_status,
  market_confidence,
  sourcing_decision,
  recommended_price_kmf,
  cost_complete_estimated_kmf,
  target_margin_pct,
  current_price_kmf,
  estimated_margin_pct,
  weight_kg,
}) {
  const fmt = (n) => new Intl.NumberFormat('fr-FR').format(r(n)) + ' KMF';
  const sentences = [];

  // 1ère phrase : situation actuelle
  if (cost_complete_estimated_kmf > 0) {
    sentences.push(`Ce produit coûte ${fmt(cost_complete_estimated_kmf)} tout compris.`);
  }
  if (target_margin_pct && recommended_price_kmf > 0) {
    sentences.push(
      `Pour viser ${target_margin_pct}% de marge, il faut le vendre au moins ${fmt(recommended_price_kmf)}.`
    );
  }

  // 2ème phrase : situation prix actuel
  if (current_price_kmf > 0) {
    if (health_status === 'loss') {
      sentences.push(
        `Au prix actuel de ${fmt(current_price_kmf)}, le produit est vendu à perte.`
      );
    } else if (health_status === 'danger') {
      sentences.push(
        `Au prix actuel de ${fmt(current_price_kmf)}, la marge (${estimated_margin_pct.toFixed(1)}%) est dangereuse.`
      );
    } else if (health_status === 'fragile') {
      sentences.push(
        `Au prix actuel de ${fmt(current_price_kmf)}, la marge (${estimated_margin_pct.toFixed(1)}%) est fragile.`
      );
    } else if (health_status === 'healthy' || health_status === 'strong') {
      sentences.push(
        `Au prix actuel de ${fmt(current_price_kmf)}, la marge (${estimated_margin_pct.toFixed(1)}%) est ${health_status === 'strong' ? 'forte' : 'saine'}.`
      );
    }
  }

  // 3ème phrase : décision sourcing
  switch (sourcing_decision) {
    case 'PRIORITY':
      sentences.push('Recommandation : sourcing prioritaire, augmenter les volumes.');
      break;
    case 'TEST':
      sentences.push('Recommandation : TEST en faible quantité, ne pas sourcer massivement avant signal marché.');
      break;
    case 'WATCH':
      if (health_status === 'fragile' || health_status === 'danger') {
        sentences.push('Recommandation : renégocier le fournisseur ou augmenter le prix avant tout sourcing.');
      } else {
        sentences.push('Recommandation : surveiller les coûts terrain ou les signaux marché avant décision.');
      }
      break;
    case 'AVOID':
      if ((weight_kg || 0) > 5) {
        sentences.push('Recommandation : éviter, produit trop lourd pour rentabiliser le fret.');
      } else {
        sentences.push('Recommandation : éviter, marge trop faible et signaux insuffisants.');
      }
      break;
    case 'LOSS':
      sentences.push('Recommandation : URGENCE, corriger le prix ou retirer le produit.');
      break;
  }

  // 4ème phrase : confiance marché
  if (market_confidence === 'unknown') {
    sentences.push('Données marché insuffisantes : décision basée sur coûts et hypothèses.');
  } else if (market_confidence === 'rejected') {
    sentences.push('Aucune vente depuis 60+ jours malgré la mise en ligne — repositionner ou retirer.');
  }

  return sentences.join(' ');
}

// ═══════════════════════════════════════════════════════════════════
// API PRINCIPALE — recommend(productOrInputs, options)
// ═══════════════════════════════════════════════════════════════════

/**
 * Calcule la recommandation pricing complète pour un produit ou un input libre.
 *
 * Format de retour aligné sur la doctrine §9.
 *
 * @param {Object} input  Soit un produit complet, soit un objet d'inputs :
 *                        { product_id?, category, channel, cost_kmf, weight_kg, volume_m3, current_price_kmf }
 * @param {Object} options { config? } pour réutiliser une config déjà chargée (batch).
 */
async function recommend(input, options = {}) {
  const config = options.config || (await loadGlobalConfig());

  // Normaliser : product (depuis BDD) ou inputs libres
  let product = null;
  if (input.product_id) {
    const r0 = await db.query('SELECT * FROM products WHERE id = $1', [input.product_id]);
    if (r0.rows.length) product = r0.rows[0];
  }
  // Fusionner inputs prioritaires sur le produit
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

  // 1. CDR
  const cdr = computeCDR(merged, ctx);

  // 2. Catégorie
  const cat = config.categories[merged.category];

  // 3. Prix
  const prices = computePrices(cdr, cat, config.finance);

  // 4. Marge & contribution estimées (sur le prix actuel)
  const currentPrice = Number(merged.price_kmf) || 0;
  let estimatedMarginPct = null;
  let estimatedContribution = null;
  if (currentPrice > 0) {
    estimatedMarginPct = ((currentPrice - cdr.cost_complete_estimated_kmf) / currentPrice) * 100;
    estimatedContribution = currentPrice - (cdr.variable_cost_estimated_kmf - cdr.risk_provision_estimated_kmf);
  }

  // 5. Seuil de rentabilité
  const monthlyFixed = cdr.monthly_fixed_costs_kmf;
  const avgContribution = estimatedContribution || prices.recommended_price_kmf - cdr.variable_cost_estimated_kmf;
  let monthlyBreakEven = 0;
  if (avgContribution > 0) {
    monthlyBreakEven = Math.ceil(monthlyFixed / avgContribution);
  }

  // 6. Health status
  const healthStatus = computeHealthStatus(currentPrice, cdr.cost_complete_estimated_kmf, estimatedMarginPct);

  // 7. Market confidence (depuis BDD)
  const market = await computeMarketConfidence(merged.id);

  // 8. Sourcing decision
  const sourcingDecision = computeSourcingDecision({
    health_status: healthStatus,
    market_confidence: market.market_confidence,
    weight_kg: merged.weight_kg,
  });

  // 9. Alertes
  const alerts = buildAlerts({
    current_price_kmf: currentPrice,
    cost_complete_estimated_kmf: cdr.cost_complete_estimated_kmf,
    estimated_margin_pct: estimatedMarginPct,
    estimated_contribution_kmf: estimatedContribution,
    fixed_cost_allocation_kmf: cdr.fixed_cost_allocation_kmf,
    monthly_break_even_orders: monthlyBreakEven,
    target_orders_per_month: cdr.target_orders_per_month,
  });

  // 10. Texte de recommandation humain
  const reason = buildRecommendationText({
    health_status: healthStatus,
    market_confidence: market.market_confidence,
    sourcing_decision: sourcingDecision,
    recommended_price_kmf: prices.recommended_price_kmf,
    cost_complete_estimated_kmf: cdr.cost_complete_estimated_kmf,
    target_margin_pct: prices.target_margin_pct,
    current_price_kmf: currentPrice,
    estimated_margin_pct: estimatedMarginPct,
    weight_kg: merged.weight_kg,
  });

  // 11. Warnings cumulés
  const warnings = [...cdr.warnings, ...market.warnings];

  return {
    product_id: merged.id,
    category: merged.category,
    channel: ctx.channel,

    // ── PRIX ──
    current_price_kmf: r(currentPrice),
    survival_price_kmf: prices.survival_price_kmf,
    minimum_safe_price_kmf: prices.minimum_safe_price_kmf,
    recommended_price_kmf: prices.recommended_price_kmf,
    test_price_kmf: prices.test_price_kmf,

    // ── COÛTS ──
    cost_complete_estimated_kmf: cdr.cost_complete_estimated_kmf,
    variable_cost_estimated_kmf: cdr.variable_cost_estimated_kmf,
    fixed_cost_allocation_kmf: cdr.fixed_cost_allocation_kmf,
    risk_provision_estimated_kmf: cdr.risk_provision_estimated_kmf,

    // ── MARGE ──
    target_margin_pct: prices.target_margin_pct,
    estimated_margin_pct: estimatedMarginPct !== null ? Number(estimatedMarginPct.toFixed(1)) : null,
    estimated_contribution_kmf: estimatedContribution !== null ? r(estimatedContribution) : null,

    // ── PILOTAGE ──
    monthly_fixed_costs_kmf: monthlyFixed,
    target_orders_per_month: cdr.target_orders_per_month,
    monthly_break_even_orders: monthlyBreakEven,

    // ── SANTÉ + DÉCISION ──
    health_status: healthStatus,
    market_confidence: market.market_confidence,
    sourcing_decision: sourcingDecision,
    reason,

    // ── DÉTAILS ──
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
  computeFixedCostAllocation,
  computeMarketConfidence,
  computeHealthStatus,
  computeSourcingDecision,
  buildAlerts,
  buildRecommendationText,
  // Constantes
  HEALTH_THRESHOLDS,
  MARKET_THRESHOLDS,
};
