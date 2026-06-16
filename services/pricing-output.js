/**
 * @komerce-arch
 * @role          economic-engine-pricing-output
 * @domain        economic-engine
 * @layer         service
 * @criticality   high
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       @unknown
 * @used-by       @unknown
 * @db-read       @unknown
 * @db-write      @unknown
 * @db-txn        resolve_before_behavior_change
 * @doctrine      resolve_before_behavior_change
 * @impact-areas  economic-engine
 * @version       2026-06
 */

/**
 * KOMERCE — Pricing Output
 * ════════════════════════
 *
 * Fonctions de sortie extraites de pricing-engine.js.
 * Responsabilité :
 *   - Calculer les 4 prix doctrinaux (computePrices)
 *   - Générer les scénarios d'imputation (computeScenarios)
 *   - Calculer health_status (computeHealthStatus)
 *   - Calculer sourcing_decision (computeSourcingDecision)
 *   - Construire les alertes (buildAlerts)
 *   - Construire le texte de recommandation (buildRecommendationText)
 *   - Produire la décomposition landed cost (buildCostBreakdown)
 *   - Évaluer la qualité des données (buildDataQuality)
 *   - Inférer le type de sujet (inferSubjectType)
 *
 * Toutes ces fonctions sont pures (pas d'accès DB).
 * Consommé uniquement par services/pricing-engine.js.
 */

'use strict';

// ═══════════════════════════════════════════════════════════════════
// CONSTANTES — Seuils doctrinaux (§6 et §7 de la doctrine)
// ═══════════════════════════════════════════════════════════════════

const HEALTH_THRESHOLDS = {
  DANGER_PCT:  15,   // marge < 15 %  → danger
  FRAGILE_PCT: 25,   // marge < 25 %  → fragile
  HEALTHY_PCT: 40,   // marge ≤ 40 %  → healthy, sinon strong
};

const MARKET_THRESHOLDS = {
  TESTING_MIN_SALES:    1,    // 1+ ventes → testing
  VALIDATED_MIN_SALES:  6,    // 6+ ventes → validated
  SCALING_MIN_SALES:    20,   // 20+ ventes → scaling
  REJECTED_DAYS_NOSALE: 60,   // 60j sans vente avec produit actif → rejected
};

// ═══════════════════════════════════════════════════════════════════
// HELPERS UTILITAIRES
// ═══════════════════════════════════════════════════════════════════

/** Round à l'entier (jamais de NaN) */
function r(n) {
  return Math.round(Number(n) || 0);
}

/** Arrondi psychologique : 990, 490, 90, etc. */
function arrondiPsycho(x) {
  if (!x || x <= 0) return 0;
  if (x < 500)  return Math.ceil(x / 10) * 10;
  if (x < 1000) return Math.ceil(x / 100) * 100 - 10;
  const k = Math.ceil(x / 1000) * 1000;
  return k - 10;
}

// ═══════════════════════════════════════════════════════════════════
// PRIX DOCTRINAUX
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
  const targetMarginPct = cat?.default_margin_pct
    ? Number(cat.default_margin_pct)
    : Number(finance?.target_marge_brute_pct) || 40;
  const margeDecimal = targetMarginPct / 100;

  // 1. Prix de survie : coûts variables sans risques
  const survivalPrice = cdr.variable_cost_estimated_kmf - cdr.risk_provision_estimated_kmf;

  // 2. Prix plancher (doctrine §5) : coût variable complet (N1 + N2) + marge de sécurité.
  //    INTERDIT : minimum_safe_price == CDR complet. Le plancher protège contre la vente
  //    DESTRUCTRICE (sous le coût variable). La couverture du CDR, elle, est portée par
  //    recommended_price. Deux frontières distinctes, jamais confondues.
  const variableComplete = cdr.variable_cost_estimated_kmf;
  const safetyPct  = Number(finance?.minimum_safety_margin_pct) || 10;
  const minSafePrice = arrondiPsycho(variableComplete * (1 + safetyPct / 100));

  // 3. Prix conseillé : CDR / (1 - marge_cible)
  let recommendedPrice = 0;
  if (margeDecimal > 0 && margeDecimal < 1) {
    recommendedPrice = cdr.cost_complete_estimated_kmf / (1 - margeDecimal);
  }
  recommendedPrice = arrondiPsycho(recommendedPrice);

  // 4. Prix test : au moins égal au recommandé
  const testPrice = Math.max(recommendedPrice, minSafePrice);

  return {
    survival_price_kmf: r(survivalPrice),
    minimum_safe_price_kmf: r(minSafePrice),
    recommended_price_kmf: r(recommendedPrice),
    test_price_kmf: r(testPrice),
    target_margin_pct: Number(targetMarginPct),
    safety_margin_pct: Number(safetyPct),
  };
}

// ═══════════════════════════════════════════════════════════════════
// SIMULATEUR DE SCÉNARIOS (Doctrine V3)
// ═══════════════════════════════════════════════════════════════════

/**
 * Génère les scénarios de prix possibles à partir du baseline imputation.
 *
 * Scénarios :
 *   1. Honnête baseline (recommandé)
 *   2. Sous-couverture acceptée -15% (Levier 1)
 *   3. Promo volume — panier 5 articles (Levier 3)
 *   4. Loading 0.7× — subvention croisée (Levier 2)
 *   5. Volume cible atteint (projection)
 *
 * Garde-fou : aucun scénario sous survival_price_kmf n'est selectable.
 */
function computeScenarios(cdr, prices, cat, finance) {
  const scenarios = [];
  const survival = prices.survival_price_kmf;
  const baseCostImputed = cdr.cost_complete_estimated_kmf;
  const baselinePrice = prices.recommended_price_kmf;
  const targetMarginPct = prices.target_margin_pct;
  const margeDecimal = targetMarginPct / 100;
  const allocations = (cdr.details && cdr.details._allocations) || [];

  function marginPct(price, cost) {
    if (price <= 0) return 0;
    return r((price - cost) / price * 100 * 10) / 10;
  }
  function checkSelectable(price) { return price >= survival; }

  // ── Scénario 1 : Honnête baseline ────────────────────────────────
  scenarios.push({
    id: 'honest_baseline',
    label: 'Honnête baseline',
    short_description: `Couverture 100% au volume actuel (marge cible ${targetMarginPct}%)`,
    explanation: 'Ce prix couvre tous les coûts imputés à l\'article (achat + landed + business + part fixe + risques) avec la marge cible de la catégorie. C\'est le prix recommandé par défaut.',
    levier: null,
    price_kmf: baselinePrice,
    cost_imputed_kmf: r(baseCostImputed),
    margin_kmf: r(baselinePrice - baseCostImputed),
    margin_pct: marginPct(baselinePrice, baseCostImputed),
    selectable: checkSelectable(baselinePrice),
    is_recommended: true,
  });

  // ── Scénario 2 : Sous-couverture acceptée (Levier 1) ─────────────
  const undercoveragePct = Number(finance.acceptable_undercoverage_pct) || 15;
  const underCost = baseCostImputed * (1 - undercoveragePct / 100);
  let underPrice = 0;
  if (margeDecimal > 0 && margeDecimal < 1) {
    underPrice = arrondiPsycho(underCost / (1 - margeDecimal));
  }
  scenarios.push({
    id: 'undercoverage_accepted',
    label: `Sous-couverture acceptée -${undercoveragePct}%`,
    short_description: `Tu sous-collectes ${undercoveragePct}% en attendant le volume cible`,
    explanation: `Stratégie de conquête : tu acceptes de ne pas couvrir 100% des coûts maintenant, en pariant que le volume va monter. À mesurer en continu dans Santé Éco. À borner dans le temps (typiquement 6 mois).`,
    levier: 'undercoverage',
    levier_params: { undercoverage_pct: undercoveragePct },
    price_kmf: underPrice,
    cost_imputed_kmf: r(baseCostImputed),
    sous_couverture_kmf: r(baseCostImputed - underCost),
    margin_kmf: r(underPrice - baseCostImputed),
    margin_pct: marginPct(underPrice, baseCostImputed),
    selectable: checkSelectable(underPrice),
    is_recommended: false,
  });

  // ── Scénario 3 : Promo volume 5 articles (Levier 3) ──────────────
  const avgArtPerOrder = Number(finance.avg_articles_per_order) || 2.5;
  const promoVolumeTarget = 5;
  let perOrderEngaged = 0;
  for (const a of allocations) {
    if (a.engaged_level === 'order') perOrderEngaged += Number(a.engaged_amount_kmf || 0);
  }
  const currentImputed = perOrderEngaged / avgArtPerOrder;
  const promoImputed = perOrderEngaged / promoVolumeTarget;
  const dilutionGain = currentImputed - promoImputed;
  const promoPrice = baselinePrice - r(dilutionGain);
  scenarios.push({
    id: 'promo_volume_5',
    label: `Promo volume — 5 articles dans le panier`,
    short_description: `Si client commande 5+ articles : -${r(dilutionGain)} KMF/article`,
    explanation: `Quand le client commande 5 articles, les coûts par commande (commission relais, Stripe) sont divisés par 5 au lieu de ${avgArtPerOrder}. Tu gagnes ${r(dilutionGain)} KMF d'imputation par article. Tu peux le redonner au client.`,
    levier: 'volume_discount',
    levier_params: { panier_threshold: promoVolumeTarget, share_back_pct: 100 },
    price_kmf: promoPrice,
    cost_imputed_kmf: r(baseCostImputed - dilutionGain),
    margin_kmf: r(promoPrice - (baseCostImputed - dilutionGain)),
    margin_pct: marginPct(promoPrice, baseCostImputed - dilutionGain),
    selectable: checkSelectable(promoPrice),
    is_recommended: false,
  });

  // ── Scénario 4 : Loading 0.7× (Levier 2) ─────────────────────────
  const loadingFactor = 0.7;
  const loadedCost = baseCostImputed * loadingFactor;
  let loadedPrice = 0;
  if (margeDecimal > 0 && margeDecimal < 1) {
    loadedPrice = arrondiPsycho(loadedCost / (1 - margeDecimal));
  }
  scenarios.push({
    id: 'loading_07',
    label: `Subventionné par autres articles (loading 0.7×)`,
    short_description: `Ce produit porte 70% de sa part normale, 30% sont absorbés ailleurs`,
    explanation: `Stratégie de redistribution : tu décides que ce produit est un "produit d'appel" et porte moins que sa juste part. Les 30% manquants doivent être compensés par des produits "vache à lait" qui portent plus de 1.0×. À utiliser avec parcimonie pour ne pas dériver la marge globale.`,
    levier: 'cost_loading',
    levier_params: { loading_factor: loadingFactor },
    price_kmf: loadedPrice,
    cost_imputed_kmf: r(loadedCost),
    margin_kmf: r(loadedPrice - loadedCost),
    margin_pct: marginPct(loadedPrice, loadedCost),
    requires_compensation: true,
    selectable: checkSelectable(loadedPrice),
    is_recommended: false,
  });

  // ── Scénario 5 : Volume cible ×1.5 (projection) ──────────────────
  const targetMultiplier = 1.5;
  let perOrderImpacted = 0, perParcelImpacted = 0, perShipmentImpacted = 0;
  for (const a of allocations) {
    if (a.engaged_level === 'order')    perOrderImpacted    += Number(a.engaged_amount_kmf);
    if (a.engaged_level === 'parcel')   perParcelImpacted   += Number(a.engaged_amount_kmf);
    if (a.engaged_level === 'shipment') perShipmentImpacted += Number(a.engaged_amount_kmf);
  }
  const avgArtPerParcel   = Number(finance.avg_articles_per_parcel) || 4.0;
  const avgArtPerShipment = Number(finance.avg_articles_per_shipment) || 200.0;
  const econOrder    = perOrderImpacted    * (1/avgArtPerOrder    - 1/(avgArtPerOrder    * targetMultiplier));
  const econParcel   = perParcelImpacted   * (1/avgArtPerParcel   - 1/(avgArtPerParcel   * targetMultiplier));
  const econShipment = perShipmentImpacted * (1/avgArtPerShipment - 1/(avgArtPerShipment * targetMultiplier));
  const totalEconomy = econOrder + econParcel + econShipment;
  const targetCost = baseCostImputed - totalEconomy;
  let targetPrice = 0;
  if (margeDecimal > 0 && margeDecimal < 1) {
    targetPrice = arrondiPsycho(targetCost / (1 - margeDecimal));
  }
  scenarios.push({
    id: 'volume_target_reached',
    label: `Au volume cible (×${targetMultiplier})`,
    short_description: `Si on atteint ${r(avgArtPerShipment * targetMultiplier)} articles/shipment et ${r(avgArtPerOrder * targetMultiplier).toFixed(1)} articles/cmd`,
    explanation: `Projection : si le volume monte de ${targetMultiplier}× (objectif moyen terme), les coûts agrégés se diluent mieux. Tu pourrais alors baisser le prix de ${r(totalEconomy)} KMF par article tout en gardant la même marge. Sert de cible commerciale.`,
    levier: 'projection',
    levier_params: { target_multiplier: targetMultiplier },
    price_kmf: targetPrice,
    cost_imputed_kmf: r(targetCost),
    economy_vs_baseline_kmf: r(totalEconomy),
    margin_kmf: r(targetPrice - targetCost),
    margin_pct: marginPct(targetPrice, targetCost),
    is_projection: true,
    selectable: checkSelectable(targetPrice),
    is_recommended: false,
  });

  return scenarios;
}

// ═══════════════════════════════════════════════════════════════════
// PROPORTIONS & SURCHARGE (Doctrine ALLOCATION §6)
// ═══════════════════════════════════════════════════════════════════

/**
 * Pour chaque ligne de coût : son poids DANS SA FAMILLE (N1/N2/N3), sa part du
 * CDR et du prix, et un diagnostic de surcharge.
 *   Montant -> famille -> proportion -> diagnostic (normal | à surveiller | surcharge)
 *
 * Seuils sur la part du CDR (configurables) ; l'achat fournisseur est exclu de
 * l'alerte (c'est la valeur, pas une charge à optimiser). Sans benchmark calibré,
 * le diagnostic est heuristique → confiance basse, jamais alarmiste à tort.
 */
function buildProportions(breakdown, totals, finance = {}, benchmarks = {}) {
  const lr = (breakdown && breakdown.landed_relay) || {};
  const bz = (breakdown && breakdown.business) || {};
  const n1 = Number(totals.n1) || 0, n2 = Number(totals.n2) || 0;
  const n3 = Number(totals.n3) || 0, cdr = Number(totals.cdr) || 0;
  const price = Number(totals.price) || 0;

  const warnPct  = Number(finance.surcharge_warn_pct)  || 12;
  const alertPct = Number(finance.surcharge_alert_pct) || 20;

  // [costKey, label, level, isReference?]
  const LINES = [
    ['product_purchase', 'Achat fournisseur', 'N1', true],
    ['sourcing', 'Sourcing', 'N1'], ['hub', 'Hub Dubai', 'N1'], ['packaging', 'Emballage', 'N1'],
    ['freight', 'Fret', 'N1'], ['customs', 'Douane', 'N1'], ['port_transitary', 'Port / transitaire', 'N1'],
    ['local_distribution', 'Distribution locale', 'N1'], ['relay', 'Relais', 'N1'],
    ['payment', 'Frais de paiement', 'N2'], ['risk_provision', 'Provision risque', 'N2'],
    ['fixed_overhead', 'Charges fixes imputées', 'N3'],
  ];
  const srcOf = key => (key === 'payment' || key === 'risk_provision') ? bz[key]
                     : (key === 'fixed_overhead') ? n3 : lr[key];
  const familyTotal = lvl => (lvl === 'N1' ? n1 : lvl === 'N2' ? n2 : n3);
  const pct = (part, whole) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0);

  let nBench = 0, nEval = 0;
  const lines = LINES.map(([key, label, level, isRef]) => {
    const amount = Number(srcOf(key)) || 0;
    if (!(amount > 0)) return null;
    const shareCdr = pct(amount, cdr);
    const bm = benchmarks[key];
    let diagnostic, basis, confidence;
    if (bm && bm.expected_share_pct != null) {
      // calibré : comparaison à la part attendue × tolérance
      nEval++; nBench++;
      const exp = Number(bm.expected_share_pct);
      const warn  = exp * (Number(bm.warn_ratio)  || 1.3);
      const alert = exp * (Number(bm.alert_ratio) || 1.6);
      if (shareCdr > alert)      diagnostic = 'surcharge';
      else if (shareCdr > warn)  diagnostic = 'à surveiller';
      else                       diagnostic = 'normal';
      basis = 'benchmark'; confidence = 'high';
    } else if (isRef) {
      diagnostic = 'référence'; basis = 'reference'; confidence = 'high';
    } else {
      // heuristique : seuils globaux sur la part du CDR
      nEval++;
      if (shareCdr >= alertPct)     diagnostic = 'surcharge';
      else if (shareCdr >= warnPct) diagnostic = 'à surveiller';
      else                          diagnostic = 'normal';
      basis = 'heuristic'; confidence = 'low';
    }
    return {
      cost_key: key, label, family: level,
      amount_kmf: r(amount),
      share_of_family_pct: pct(amount, familyTotal(level)),
      share_of_cdr_pct: shareCdr,
      share_of_price_pct: pct(amount, price),
      expected_share_pct: bm ? Number(bm.expected_share_pct) : null,
      diagnostic, basis, confidence,
    };
  }).filter(Boolean);

  const families = [
    { family: 'N1', label: 'Coût rendu relais', amount_kmf: r(n1), share_of_cdr_pct: pct(n1, cdr), share_of_price_pct: pct(n1, price) },
    { family: 'N2', label: 'Business variable', amount_kmf: r(n2), share_of_cdr_pct: pct(n2, cdr), share_of_price_pct: pct(n2, price) },
    { family: 'N3', label: 'Charges fixes imputées', amount_kmf: r(n3), share_of_cdr_pct: pct(n3, cdr), share_of_price_pct: pct(n3, price) },
  ];

  const overallConfidence = !nEval ? 'low' : (nBench === nEval ? 'high' : (nBench > 0 ? 'partial' : 'low'));
  return {
    lines, families,
    diagnostic_basis: nBench === 0 ? 'heuristic' : (nBench === nEval ? 'benchmark' : 'mixed'),
    confidence: overallConfidence,
    benchmarks_calibrated: nBench, lines_evaluated: nEval,
    thresholds: { warn_pct: warnPct, alert_pct: alertPct, basis: 'share_of_cdr' },
  };
}

// ═══════════════════════════════════════════════════════════════════
// STRATÉGIES PRIX CANONIQUES (Doctrine §6 / §7)
// ═══════════════════════════════════════════════════════════════════

/**
 * Produit les 6 stratégies canoniques avec, pour chacune, les lignes du §7 :
 * prix final, écart au plancher, écart au coût variable, contribution,
 * écart au CDR, charges fixes non couvertes, volume de compensation, verdict.
 *
 * @param {Object} m  { variable_complete, cdr_complete, minimum_safe, recommended,
 *                      target_margin_pct, monthly_fixed_costs }
 * @param {Object} finance  finance_config (premium_markup_pct, acceptable_undercoverage_pct)
 * @param {Object} input    { competitor_price_kmf?, final_price_kmf? }
 */
function computeStrategies(m, finance = {}, input = {}) {
  const variable    = Number(m.variable_complete) || 0;
  const cdr         = Number(m.cdr_complete) || 0;
  const minSafe     = Number(m.minimum_safe) || 0;
  const recommended = Number(m.recommended) || 0;
  const monthlyFixed = Number(m.monthly_fixed_costs) || 0;
  const margeDec    = (Number(m.target_margin_pct) || 40) / 100;

  const premiumPct      = Number(finance.premium_markup_pct)        || 15;
  const undercoveragePct = Number(finance.acceptable_undercoverage_pct) || 15;
  const competitor      = Number(input.competitor_price_kmf) || 0;
  const manualPrice     = Number(input.final_price_kmf) || 0;

  let conquestPrice = 0;
  if (margeDec > 0 && margeDec < 1) {
    conquestPrice = arrondiPsycho((cdr * (1 - undercoveragePct / 100)) / (1 - margeDec));
  }

  const defs = [
    { id: 'mechanical',         label: 'Mécanique (suivre le moteur)', price: recommended },
    { id: 'competition_aligned', label: 'Aligné concurrence',           price: competitor > 0 ? competitor : recommended, needs_input: competitor <= 0 ? 'prix concurrent' : null },
    { id: 'premium',            label: 'Premium',                       price: arrondiPsycho(recommended * (1 + premiumPct / 100)) },
    { id: 'loss_leader',        label: 'Produit d\'appel',              price: minSafe },
    { id: 'conquest',           label: 'Conquête (sous-couverture)',    price: conquestPrice },
    { id: 'manual',             label: 'Manuel',                        price: manualPrice > 0 ? manualPrice : recommended, needs_input: manualPrice <= 0 ? 'prix fixé à la main' : null },
  ];

  return defs.map(d => {
    const price        = r(d.price);
    const contribution = price - variable;          // = écart au coût variable
    const gapToFloor   = price - minSafe;
    const gapToCdr     = price - cdr;
    const uncoveredFixed = price < cdr ? r(cdr - price) : 0;
    const volumeToCompensate = contribution > 0 ? Math.ceil(monthlyFixed / contribution) : null;

    let verdict;
    if (price <= 0)              verdict = 'WATCH';
    else if (price < variable)   verdict = 'LOSS';     // destructif
    else if (price < cdr)        verdict = 'WATCH';     // contributif mais sous-couvert
    else if (price >= recommended) verdict = 'PRIORITY';
    else                         verdict = 'TEST';

    return {
      id: d.id, label: d.label, needs_input: d.needs_input || null,
      final_price_kmf: price,
      gap_to_floor_kmf: r(gapToFloor),
      gap_to_variable_kmf: r(contribution),
      contribution_kmf: r(contribution),
      gap_to_cdr_kmf: r(gapToCdr),
      uncovered_fixed_kmf: uncoveredFixed,
      volume_to_compensate: volumeToCompensate,
      verdict,
    };
  });
}

// ═══════════════════════════════════════════════════════════════════
// HEALTH STATUS (Doctrine §6)
// ═══════════════════════════════════════════════════════════════════

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

function computeSourcingDecision({ health_status, market_confidence, weight_kg }) {
  if (health_status === 'loss') return 'LOSS';

  const isHeavy = (weight_kg || 0) > 5;
  if (isHeavy && market_confidence !== 'validated' && market_confidence !== 'scaling') {
    return 'AVOID';
  }

  if (market_confidence === 'validated' || market_confidence === 'scaling') {
    if (health_status === 'strong' || health_status === 'healthy') return 'PRIORITY';
    if (health_status === 'fragile' || health_status === 'danger')  return 'WATCH';
    return 'WATCH';
  }

  if (market_confidence === 'unknown' || market_confidence === 'testing') {
    if (health_status === 'strong' || health_status === 'healthy') return 'TEST';
    if (health_status === 'fragile')  return 'WATCH';
    if (health_status === 'danger')   return 'AVOID';
    return 'TEST';
  }

  if (market_confidence === 'rejected') {
    if (health_status === 'strong') return 'WATCH';
    return 'AVOID';
  }

  return 'WATCH';
}

// ═══════════════════════════════════════════════════════════════════
// ALERTES (Doctrine §6)
// ═══════════════════════════════════════════════════════════════════

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
    alerts.push({ severity: 'critical', code: 'price_below_cost', message: 'Prix actuel inférieur au coût de revient complet estimé.' });
  }
  if (estimated_margin_pct !== null && estimated_margin_pct < HEALTH_THRESHOLDS.DANGER_PCT) {
    alerts.push({ severity: 'critical', code: 'margin_dangerous', message: 'Marge estimée dangereusement faible.' });
  } else if (estimated_margin_pct !== null && estimated_margin_pct < HEALTH_THRESHOLDS.FRAGILE_PCT) {
    alerts.push({ severity: 'warning', code: 'margin_fragile', message: 'Marge fragile, surveiller les coûts terrain.' });
  }
  if (estimated_contribution_kmf !== null && fixed_cost_allocation_kmf > 0 && estimated_contribution_kmf < fixed_cost_allocation_kmf) {
    alerts.push({ severity: 'warning', code: 'contribution_insufficient', message: 'La commande ne couvre pas sa part de charges fixes.' });
  }
  if (monthly_break_even_orders > target_orders_per_month) {
    alerts.push({ severity: 'warning', code: 'volume_target_too_low', message: 'Volume cible insuffisant pour couvrir les charges fixes.' });
  }

  return alerts;
}

// ═══════════════════════════════════════════════════════════════════
// RECOMMENDATION TEXT (langage humain)
// ═══════════════════════════════════════════════════════════════════

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

  if (cost_complete_estimated_kmf > 0) {
    sentences.push(`Ce produit coûte ${fmt(cost_complete_estimated_kmf)} tout compris.`);
  }
  if (target_margin_pct && recommended_price_kmf > 0) {
    sentences.push(`Pour viser ${target_margin_pct}% de marge, il faut le vendre au moins ${fmt(recommended_price_kmf)}.`);
  }

  if (current_price_kmf > 0) {
    if (health_status === 'loss') {
      sentences.push(`Au prix actuel de ${fmt(current_price_kmf)}, le produit est vendu à perte.`);
    } else if (health_status === 'danger') {
      sentences.push(`Au prix actuel de ${fmt(current_price_kmf)}, la marge (${estimated_margin_pct.toFixed(1)}%) est dangereuse.`);
    } else if (health_status === 'fragile') {
      sentences.push(`Au prix actuel de ${fmt(current_price_kmf)}, la marge (${estimated_margin_pct.toFixed(1)}%) est fragile.`);
    } else if (health_status === 'healthy' || health_status === 'strong') {
      sentences.push(`Au prix actuel de ${fmt(current_price_kmf)}, la marge (${estimated_margin_pct.toFixed(1)}%) est ${health_status === 'strong' ? 'forte' : 'saine'}.`);
    }
  }

  switch (sourcing_decision) {
    case 'PRIORITY': sentences.push('Recommandation : sourcing prioritaire, augmenter les volumes.'); break;
    case 'TEST':     sentences.push('Recommandation : TEST en faible quantité, ne pas sourcer massivement avant signal marché.'); break;
    case 'WATCH':
      sentences.push(
        (health_status === 'fragile' || health_status === 'danger')
          ? 'Recommandation : renégocier le fournisseur ou augmenter le prix avant tout sourcing.'
          : 'Recommandation : surveiller les coûts terrain ou les signaux marché avant décision.'
      );
      break;
    case 'AVOID': sentences.push((weight_kg || 0) > 5 ? 'Recommandation : éviter, produit trop lourd pour rentabiliser le fret.' : 'Recommandation : éviter, marge trop faible et signaux insuffisants.'); break;
    case 'LOSS':  sentences.push('Recommandation : URGENCE, corriger le prix ou retirer le produit.'); break;
  }

  if (market_confidence === 'unknown') {
    sentences.push('Données marché insuffisantes : décision basée sur coûts et hypothèses.');
  } else if (market_confidence === 'rejected') {
    sentences.push('Aucune vente depuis 60+ jours malgré la mise en ligne — repositionner ou retirer.');
  }

  return sentences.join(' ');
}

// ═══════════════════════════════════════════════════════════════════
// COST BREAKDOWN DOCTRINAL (landed cost rendu relais)
// ═══════════════════════════════════════════════════════════════════

function buildCostBreakdown(details) {
  const rnd = (x) => Math.round(Number(x) || 0);
  const landed_relay = {
    product_purchase:   rnd(details.product_cost),
    sourcing:           rnd(details.sourcing),
    hub:                rnd(details.hub),
    packaging:          rnd(details.packaging || 0),
    freight:            rnd(details.freight),
    customs:            rnd(details.customs),
    port_transitary:    rnd(details.port_transitaire),
    local_distribution: rnd(details.local_distribution || 0),
    relay:              rnd(details.relay || 0),
  };
  // Fallback si split distribution non disponible
  if (landed_relay.local_distribution === 0 && landed_relay.relay === 0 && details.distribution > 0) {
    landed_relay.local_distribution = rnd(details.distribution);
  }

  const business = {
    payment:        rnd(details.payment),
    risk_provision: rnd(details.risks),
    fixed_overhead: rnd(details.fixed_costs),
  };

  const landed_relay_cost_kmf      = Object.values(landed_relay).reduce((s, v) => s + v, 0);
  const business_complete_cost_kmf = landed_relay_cost_kmf + Object.values(business).reduce((s, v) => s + v, 0);

  return { landed_relay, business, landed_relay_cost_kmf, business_complete_cost_kmf };
}

// ═══════════════════════════════════════════════════════════════════
// DATA QUALITY (fiabilité données)
// ═══════════════════════════════════════════════════════════════════

function buildDataQuality(input, context) {
  const sources = {};
  const missing = [];

  if (input.product_id && context.hasProduct) {
    sources.purchase_price = 'real';
  } else if (input.cost_kmf || input.prix_aed) {
    sources.purchase_price = 'manual';
  } else {
    sources.purchase_price = 'missing';
    missing.push('purchase_price');
  }

  if (input.weight_kg || input.poids_kg) {
    sources.weight = input.product_id && context.hasProduct ? 'real' : 'manual';
  } else if (context.hasCustomsCategory) {
    sources.weight = 'category';
  } else {
    sources.weight = 'default';
    missing.push('weight');
  }

  if (input.volume_m3 && Number(input.volume_m3) > 0) {
    sources.volume = 'manual';
  } else if (context.hasCustomsCategory) {
    sources.volume = 'category';
  } else {
    sources.volume = 'default';
    missing.push('volume');
  }

  sources.customs_category = context.hasCustomsCategory ? 'category' : 'default';
  if (!context.hasCustomsCategory) missing.push('customs_category');

  sources.fixed_overhead = context.hasFinanceConfig ? 'real' : 'default';
  sources.freight  = 'category';
  sources.customs  = context.hasCustomsCategory ? 'category' : 'default';

  const total = Object.keys(sources).length;
  const realOrManual = Object.values(sources).filter(s => s === 'real' || s === 'manual').length;
  const ratio = realOrManual / total;
  let confidence = 'low';
  if (ratio >= 0.6) confidence = 'high';
  else if (ratio >= 0.3) confidence = 'medium';
  if ((context.warnings || []).length >= 3) confidence = 'low';

  return { confidence, missing_fields: missing, sources };
}

// ═══════════════════════════════════════════════════════════════════
// SUBJECT TYPE
// ═══════════════════════════════════════════════════════════════════

function inferSubjectType(input, context) {
  if (input.product_id && context.hasProduct) return 'catalog_product';
  if (input.candidate_id) return 'supplier_candidate';
  return 'manual_simulation';
}

module.exports = {
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
  // Constantes exposées
  HEALTH_THRESHOLDS,
  MARKET_THRESHOLDS,
};
