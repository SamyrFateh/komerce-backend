/**
 * @komerce-arch
 * @role          economic-engine-pricing-output
 * @domain        economic-engine
 * @layer         service
 * @criticality   high
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       economic_price_reference, contribution_scenarios, diagnostics
 * @depends       none
 * @used-by       services/pricing-engine.js
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      market_bounds_possible_human_decides, fixed_structure_never_fabricates_sku_price, contribution_covers_structure_collectively
 * @impact-areas  economic-engine, pricing
 * @version       2026-09
 */

'use strict';

const HEALTH_THRESHOLDS = {
  DANGER_PCT: 15,
  FRAGILE_PCT: 25,
  HEALTHY_PCT: 40,
};

const MARKET_THRESHOLDS = {
  TESTING_MIN_SALES: 1,
  VALIDATED_MIN_SALES: 6,
  SCALING_MIN_SALES: 20,
  REJECTED_DAYS_NOSALE: 60,
};

function r(n) {
  return Math.round(Number(n) || 0);
}

function arrondiPsycho(x) {
  if (!x || x <= 0) return 0;
  if (x < 500) return Math.ceil(x / 10) * 10;
  if (x < 1000) return Math.ceil(x / 100) * 100 - 10;
  return Math.ceil(x / 1000) * 1000 - 10;
}

/**
 * Produit des frontières économiques UNITAIRES, jamais un prix de marché.
 * Les charges fixes ne sont volontairement pas réinjectées dans ces prix.
 */
function computePrices(cdr, cat, finance) {
  const targetMarginPct = cat?.default_margin_pct
    ? Number(cat.default_margin_pct)
    : Number(finance?.target_marge_brute_pct) || 40;
  const targetRatio = targetMarginPct / 100;
  const variableComplete = Number(cdr?.variable_cost_estimated_kmf) || 0;
  const riskProvision = Number(cdr?.risk_provision_estimated_kmf) || 0;
  const safetyPct = Number(finance?.minimum_safety_margin_pct) || 10;

  const survivalPrice = Math.max(0, variableComplete - riskProvision);
  const minimumSafePrice = arrondiPsycho(variableComplete * (1 + safetyPct / 100));

  let contributionReferencePrice = variableComplete;
  if (targetRatio > 0 && targetRatio < 1) {
    contributionReferencePrice = variableComplete / (1 - targetRatio);
  }
  contributionReferencePrice = arrondiPsycho(contributionReferencePrice);
  const testPrice = Math.max(contributionReferencePrice, minimumSafePrice);

  return {
    survival_price_kmf: r(survivalPrice),
    minimum_safe_price_kmf: r(minimumSafePrice),
    recommended_price_kmf: r(contributionReferencePrice),
    economic_reference_price_kmf: r(contributionReferencePrice),
    test_price_kmf: r(testPrice),
    target_margin_pct: Number(targetMarginPct),
    safety_margin_pct: Number(safetyPct),
    price_authority: 'ECONOMIC_REFERENCE_NOT_MARKET_DECISION',
    fixed_structure_in_price: false,
  };
}

function computeScenarios(cdr, prices, cat, finance = {}) {
  const scenarios = [];
  const variableComplete = Number(cdr?.variable_cost_estimated_kmf) || 0;
  const referencePrice = Number(prices?.economic_reference_price_kmf ?? prices?.recommended_price_kmf) || 0;
  const minSafe = Number(prices?.minimum_safe_price_kmf) || variableComplete;
  const targetMarginPct = Number(prices?.target_margin_pct) || 0;
  const allocations = (cdr?.details?._allocations || []).filter(a =>
    String(a?.economic_nature || '').toLowerCase() !== 'fixed' && a?.cost_type !== 'fixed_overhead'
  );

  function marginPct(price, cost) {
    if (!(price > 0)) return 0;
    return Math.round(((price - cost) / price) * 1000) / 10;
  }
  function selectable(price) {
    return price >= variableComplete;
  }

  scenarios.push({
    id: 'honest_baseline',
    label: 'Référence de contribution',
    short_description: `Repère économique sur coût variable · cible ${targetMarginPct}%`,
    explanation: 'Ce repère part uniquement du coût variable complet. Les charges fixes restent au niveau portefeuille et ne fabriquent pas le prix du SKU.',
    levier: null,
    price_kmf: r(referencePrice),
    cost_imputed_kmf: r(variableComplete),
    contribution_kmf: r(referencePrice - variableComplete),
    margin_kmf: r(referencePrice - variableComplete),
    margin_pct: marginPct(referencePrice, variableComplete),
    selectable: selectable(referencePrice),
    is_recommended: true,
    authority: 'REFERENCE_ONLY',
  });

  const conquestPct = Number(finance.acceptable_undercoverage_pct) || 15;
  const conquestPrice = Math.max(minSafe, arrondiPsycho(referencePrice * (1 - conquestPct / 100)));
  scenarios.push({
    id: 'undercoverage_accepted',
    label: `Conquête · contribution réduite -${conquestPct}%`,
    short_description: 'Baisse du repère de contribution, jamais du coût variable réel.',
    explanation: 'Le produit reste contributif. La structure continue d’être suivie au niveau portefeuille ; cette simulation ne lui attribue aucune dette fixe.',
    levier: 'contribution_target',
    levier_params: { reduction_pct: conquestPct },
    price_kmf: r(conquestPrice),
    cost_imputed_kmf: r(variableComplete),
    contribution_kmf: r(conquestPrice - variableComplete),
    margin_kmf: r(conquestPrice - variableComplete),
    margin_pct: marginPct(conquestPrice, variableComplete),
    selectable: selectable(conquestPrice),
    is_recommended: false,
    authority: 'REFERENCE_ONLY',
  });

  const avgArtPerOrder = Number(finance.avg_articles_per_order) || 2.5;
  const promoVolumeTarget = 5;
  let perOrderVariable = 0;
  for (const a of allocations) {
    if (a.engaged_level === 'order') perOrderVariable += Number(a.engaged_amount_kmf || 0);
  }
  const currentPerArticle = perOrderVariable / avgArtPerOrder;
  const promoPerArticle = perOrderVariable / promoVolumeTarget;
  const dilutionGain = Math.max(0, currentPerArticle - promoPerArticle);
  const promoVariable = Math.max(0, variableComplete - dilutionGain);
  const promoPrice = Math.max(promoVariable, referencePrice - r(dilutionGain));
  scenarios.push({
    id: 'promo_volume_5',
    label: 'Panier 5 articles',
    short_description: `Économie variable estimée : ${r(dilutionGain)} KMF/article`,
    explanation: 'Seules les charges réellement variables par commande peuvent être diluées. Une charge fixe n’est jamais divisée ici pour fabriquer un prix SKU.',
    levier: 'variable_cost_dilution',
    levier_params: { panier_threshold: promoVolumeTarget },
    price_kmf: r(promoPrice),
    cost_imputed_kmf: r(promoVariable),
    economy_vs_baseline_kmf: r(dilutionGain),
    contribution_kmf: r(promoPrice - promoVariable),
    margin_kmf: r(promoPrice - promoVariable),
    margin_pct: marginPct(promoPrice, promoVariable),
    selectable: selectable(promoPrice),
    is_recommended: false,
    authority: 'REFERENCE_ONLY',
  });

  scenarios.push({
    id: 'loading_07',
    label: 'Ancien loading fixe · désactivé',
    short_description: 'La structure ne se charge plus artificiellement sur un SKU.',
    explanation: 'Ce levier est conservé uniquement pour compatibilité de lecture. La redistribution de charges fixes se pilote au niveau portefeuille et ne modifie plus automatiquement le prix unitaire.',
    levier: 'legacy_fixed_loading_disabled',
    price_kmf: r(referencePrice),
    cost_imputed_kmf: r(variableComplete),
    contribution_kmf: r(referencePrice - variableComplete),
    margin_kmf: r(referencePrice - variableComplete),
    margin_pct: marginPct(referencePrice, variableComplete),
    selectable: false,
    is_recommended: false,
    deprecated: true,
    authority: 'NO_PRICE_AUTHORITY',
  });

  const targetMultiplier = 1.5;
  let order = 0, parcel = 0, shipment = 0;
  for (const a of allocations) {
    if (a.engaged_level === 'order') order += Number(a.engaged_amount_kmf || 0);
    if (a.engaged_level === 'parcel') parcel += Number(a.engaged_amount_kmf || 0);
    if (a.engaged_level === 'shipment') shipment += Number(a.engaged_amount_kmf || 0);
  }
  const avgArtPerParcel = Number(finance.avg_articles_per_parcel) || 4;
  const avgArtPerShipment = Number(finance.avg_articles_per_shipment) || 200;
  const totalEconomy =
    order * (1 / avgArtPerOrder - 1 / (avgArtPerOrder * targetMultiplier)) +
    parcel * (1 / avgArtPerParcel - 1 / (avgArtPerParcel * targetMultiplier)) +
    shipment * (1 / avgArtPerShipment - 1 / (avgArtPerShipment * targetMultiplier));
  const targetVariable = Math.max(0, variableComplete - totalEconomy);
  const targetPrice = Math.max(targetVariable, referencePrice - r(totalEconomy));
  scenarios.push({
    id: 'volume_target_reached',
    label: `Flux variable cible ×${targetMultiplier}`,
    short_description: `Économie variable projetée : ${r(totalEconomy)} KMF/article`,
    explanation: 'Projection de dilution des seules charges variables agrégées. Les charges fixes restent dans le besoin de couverture collectif du portefeuille.',
    levier: 'variable_flow_projection',
    levier_params: { target_multiplier: targetMultiplier },
    price_kmf: r(targetPrice),
    cost_imputed_kmf: r(targetVariable),
    economy_vs_baseline_kmf: r(totalEconomy),
    contribution_kmf: r(targetPrice - targetVariable),
    margin_kmf: r(targetPrice - targetVariable),
    margin_pct: marginPct(targetPrice, targetVariable),
    is_projection: true,
    selectable: selectable(targetPrice),
    is_recommended: false,
    authority: 'REFERENCE_ONLY',
  });

  return scenarios;
}

function buildProportions(breakdown, totals = {}, finance = {}, benchmarks = {}) {
  const lr = breakdown?.landed_relay || {};
  const bz = breakdown?.business || {};
  const variableFlow = Number(totals.variable_flow ?? totals.n1) || 0;
  const businessVariable = Number(totals.business_variable ?? totals.n2) || 0;
  const structure = Number(totals.structure_reference ?? totals.n3) || 0;
  const variableTotal = Number(totals.variable_total) || variableFlow + businessVariable;
  const analyticalTotal = Number(totals.analytical_total ?? totals.cdr) || variableTotal + structure;
  const price = Number(totals.price) || 0;
  const warnPct = Number(finance.surcharge_warn_pct) || 12;
  const alertPct = Number(finance.surcharge_alert_pct) || 20;
  const pct = (part, whole) => whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0;

  const defs = [
    ['product_purchase', 'Achat fournisseur', 'VARIABLE_FLOW', lr.product_purchase, true],
    ['sourcing', 'Sourcing', 'VARIABLE_FLOW', lr.sourcing],
    ['hub', 'Hub variable', 'VARIABLE_FLOW', lr.hub],
    ['packaging', 'Emballage', 'VARIABLE_FLOW', lr.packaging],
    ['freight', 'Fret', 'VARIABLE_FLOW', lr.freight],
    ['customs', 'Douane', 'VARIABLE_FLOW', lr.customs],
    ['port_transitary', 'Port / transitaire', 'VARIABLE_FLOW', lr.port_transitary],
    ['local_distribution', 'Distribution locale', 'VARIABLE_FLOW', lr.local_distribution],
    ['relay', 'Relais', 'VARIABLE_FLOW', lr.relay],
    ['payment', 'Frais de paiement', 'BUSINESS_VARIABLE', bz.payment],
    ['risk_provision', 'Provision risque', 'BUSINESS_VARIABLE', bz.risk_provision],
    ['fixed_overhead', 'Structure de période · référence analytique', 'STRUCTURE_REFERENCE', structure],
  ];
  const familyTotal = family => family === 'VARIABLE_FLOW'
    ? variableFlow
    : family === 'BUSINESS_VARIABLE' ? businessVariable : structure;

  let nBench = 0, nEval = 0;
  const lines = defs.map(([key, label, family, rawAmount, isRef]) => {
    const amount = Number(rawAmount) || 0;
    if (!(amount > 0)) return null;
    const denominator = family === 'STRUCTURE_REFERENCE' ? analyticalTotal : variableTotal;
    const share = pct(amount, denominator);
    const bm = benchmarks[key];
    let diagnostic = 'normal', basis = 'heuristic', confidence = 'low';
    if (family === 'STRUCTURE_REFERENCE') {
      diagnostic = 'référence'; basis = 'portfolio_structure'; confidence = 'high';
    } else if (bm && bm.expected_share_pct != null) {
      nEval++; nBench++;
      const exp = Number(bm.expected_share_pct);
      const warn = exp * (Number(bm.warn_ratio) || 1.3);
      const alert = exp * (Number(bm.alert_ratio) || 1.6);
      diagnostic = share > alert ? 'surcharge' : share > warn ? 'à surveiller' : 'normal';
      basis = 'benchmark'; confidence = 'high';
    } else if (isRef) {
      diagnostic = 'référence'; basis = 'reference'; confidence = 'high';
    } else {
      nEval++;
      diagnostic = share >= alertPct ? 'surcharge' : share >= warnPct ? 'à surveiller' : 'normal';
    }
    return {
      cost_key: key,
      label,
      family,
      amount_kmf: r(amount),
      share_of_family_pct: pct(amount, familyTotal(family)),
      share_of_variable_cost_pct: family === 'STRUCTURE_REFERENCE' ? null : pct(amount, variableTotal),
      share_of_price_pct: pct(amount, price),
      expected_share_pct: bm ? Number(bm.expected_share_pct) : null,
      diagnostic,
      basis,
      confidence,
      pricing_authority: family === 'STRUCTURE_REFERENCE' ? 'NONE' : 'VARIABLE_COST_INPUT',
    };
  }).filter(Boolean);

  const families = [
    { family: 'VARIABLE_FLOW', label: 'Coûts variables de flux', amount_kmf: r(variableFlow), share_of_variable_cost_pct: pct(variableFlow, variableTotal) },
    { family: 'BUSINESS_VARIABLE', label: 'Coûts variables business', amount_kmf: r(businessVariable), share_of_variable_cost_pct: pct(businessVariable, variableTotal) },
    { family: 'STRUCTURE_REFERENCE', label: 'Charges de structure à couvrir collectivement', amount_kmf: r(structure), pricing_authority: 'NONE' },
  ];

  return {
    lines,
    families,
    diagnostic_basis: nBench === 0 ? 'heuristic' : nBench === nEval ? 'benchmark' : 'mixed',
    confidence: !nEval ? 'low' : nBench === nEval ? 'high' : nBench > 0 ? 'partial' : 'low',
    benchmarks_calibrated: nBench,
    lines_evaluated: nEval,
    thresholds: { warn_pct: warnPct, alert_pct: alertPct, basis: 'share_of_variable_cost' },
  };
}

function computeStrategies(m, finance = {}, input = {}) {
  const variable = Number(m.variable_complete) || 0;
  const minSafe = Number(m.minimum_safe) || variable;
  const reference = Number(m.recommended) || minSafe;
  const monthlyFixed = Number(m.monthly_fixed_costs) || 0;
  const premiumPct = Number(finance.premium_markup_pct) || 15;
  const conquestPct = Number(finance.acceptable_undercoverage_pct) || 15;
  const competitor = Number(input.competitor_price_kmf) || 0;
  const manualPrice = Number(input.final_price_kmf) || 0;
  const conquestPrice = Math.max(minSafe, arrondiPsycho(reference * (1 - conquestPct / 100)));

  const defs = [
    { id: 'mechanical', label: 'Référence économique · non décisionnelle', price: reference, authority: 'REFERENCE_ONLY' },
    { id: 'competition_aligned', label: 'Aligné marché', price: competitor > 0 ? competitor : reference, needs_input: competitor <= 0 ? 'prix concurrent' : null, authority: competitor > 0 ? 'MARKET_INPUT' : 'REFERENCE_ONLY' },
    { id: 'premium', label: 'Premium', price: arrondiPsycho(reference * (1 + premiumPct / 100)), authority: 'HUMAN_SCENARIO' },
    { id: 'loss_leader', label: 'Produit d\'appel contributif', price: minSafe, authority: 'HUMAN_SCENARIO' },
    { id: 'conquest', label: 'Conquête', price: conquestPrice, authority: 'HUMAN_SCENARIO' },
    { id: 'manual', label: 'Manuel', price: manualPrice > 0 ? manualPrice : reference, needs_input: manualPrice <= 0 ? 'prix fixé à la main' : null, authority: manualPrice > 0 ? 'HUMAN_DECISION' : 'REFERENCE_ONLY' },
  ];

  return defs.map(d => {
    const price = r(d.price);
    const contribution = price - variable;
    const volumeToCoverStructure = contribution > 0 && monthlyFixed > 0 ? Math.ceil(monthlyFixed / contribution) : null;
    let verdict = 'TEST';
    if (!(price > 0)) verdict = 'WATCH';
    else if (price < variable) verdict = 'LOSS';
    else if (price < minSafe) verdict = 'WATCH';

    return {
      id: d.id,
      label: d.label,
      needs_input: d.needs_input || null,
      final_price_kmf: price,
      gap_to_floor_kmf: r(price - minSafe),
      gap_to_variable_kmf: r(contribution),
      contribution_kmf: r(contribution),
      gap_to_cdr_kmf: null,
      uncovered_fixed_kmf: null,
      volume_to_compensate: volumeToCoverStructure,
      equivalent_articles_to_cover_structure: volumeToCoverStructure,
      verdict,
      authority: d.authority,
      fixed_structure_in_price: false,
    };
  });
}

function computeHealthStatus(currentPrice, variableCostComplete, estimatedMarginPct) {
  if (!currentPrice || currentPrice <= 0) return 'unknown';
  if (!variableCostComplete || variableCostComplete <= 0) return 'unknown';
  if (currentPrice < variableCostComplete) return 'loss';
  if (estimatedMarginPct < HEALTH_THRESHOLDS.DANGER_PCT) return 'danger';
  if (estimatedMarginPct < HEALTH_THRESHOLDS.FRAGILE_PCT) return 'fragile';
  if (estimatedMarginPct <= HEALTH_THRESHOLDS.HEALTHY_PCT) return 'healthy';
  return 'strong';
}

function computeSourcingDecision({ health_status, market_confidence, weight_kg }) {
  if (health_status === 'loss') return 'LOSS';
  const isHeavy = (weight_kg || 0) > 5;
  if (isHeavy && market_confidence !== 'validated' && market_confidence !== 'scaling') return 'AVOID';
  if (market_confidence === 'validated' || market_confidence === 'scaling') {
    if (health_status === 'strong' || health_status === 'healthy') return 'PRIORITY';
    return 'WATCH';
  }
  if (market_confidence === 'unknown' || market_confidence === 'testing') {
    if (health_status === 'strong' || health_status === 'healthy') return 'TEST';
    if (health_status === 'fragile') return 'WATCH';
    if (health_status === 'danger') return 'AVOID';
    return 'TEST';
  }
  if (market_confidence === 'rejected') return health_status === 'strong' ? 'WATCH' : 'AVOID';
  return 'WATCH';
}

function buildAlerts({
  current_price_kmf,
  variable_cost_complete_kmf,
  cost_complete_estimated_kmf,
  estimated_margin_pct,
  estimated_contribution_kmf,
  monthly_break_even_orders,
  target_orders_per_month,
}) {
  const alerts = [];
  const variableBoundary = Number(variable_cost_complete_kmf ?? cost_complete_estimated_kmf) || 0;
  if (current_price_kmf > 0 && variableBoundary > 0 && current_price_kmf < variableBoundary) {
    alerts.push({ severity: 'critical', code: 'price_below_variable_cost', message: 'Prix actuel inférieur au coût variable complet : chaque vente détruit de la valeur.' });
  }
  if (estimated_margin_pct !== null && estimated_margin_pct < HEALTH_THRESHOLDS.DANGER_PCT) {
    alerts.push({ severity: 'critical', code: 'margin_dangerous', message: 'Taux de contribution dangereusement faible.' });
  } else if (estimated_margin_pct !== null && estimated_margin_pct < HEALTH_THRESHOLDS.FRAGILE_PCT) {
    alerts.push({ severity: 'warning', code: 'margin_fragile', message: 'Contribution unitaire fragile, surveiller les coûts variables terrain.' });
  }
  if (estimated_contribution_kmf !== null && estimated_contribution_kmf <= 0) {
    alerts.push({ severity: 'critical', code: 'non_positive_contribution', message: 'Contribution unitaire nulle ou négative.' });
  }
  if (monthly_break_even_orders > target_orders_per_month) {
    alerts.push({ severity: 'warning', code: 'portfolio_volume_target_too_low', message: 'Au mix analytique courant, le volume cible ne suffirait pas à absorber la structure. Ce signal ne fixe pas le prix du SKU.' });
  }
  return alerts;
}

function buildRecommendationText({
  health_status,
  market_confidence,
  sourcing_decision,
  recommended_price_kmf,
  economic_reference_price_kmf,
  variable_cost_complete_kmf,
  cost_complete_estimated_kmf,
  target_margin_pct,
  current_price_kmf,
  estimated_margin_pct,
  weight_kg,
}) {
  const fmt = n => new Intl.NumberFormat('fr-FR').format(r(n)) + ' KMF';
  const sentences = [];
  const variable = Number(variable_cost_complete_kmf ?? cost_complete_estimated_kmf) || 0;
  const reference = Number(economic_reference_price_kmf ?? recommended_price_kmf) || 0;

  if (variable > 0) sentences.push(`Coût variable complet : ${fmt(variable)}.`);
  if (target_margin_pct && reference > 0) {
    sentences.push(`Repère économique de contribution (${target_margin_pct}%) : ${fmt(reference)} ; ce n’est pas une vérité marché ni un prix imposé.`);
  }
  if (current_price_kmf > 0) {
    if (health_status === 'loss') sentences.push(`Au prix actuel de ${fmt(current_price_kmf)}, chaque vente détruit de la valeur car le prix est sous le coût variable.`);
    else if (health_status === 'danger') sentences.push(`Au prix actuel de ${fmt(current_price_kmf)}, le taux de contribution (${estimated_margin_pct.toFixed(1)}%) est dangereux.`);
    else if (health_status === 'fragile') sentences.push(`Au prix actuel de ${fmt(current_price_kmf)}, le taux de contribution (${estimated_margin_pct.toFixed(1)}%) est fragile.`);
    else if (health_status === 'healthy' || health_status === 'strong') sentences.push(`Au prix actuel de ${fmt(current_price_kmf)}, le taux de contribution (${estimated_margin_pct.toFixed(1)}%) est ${health_status === 'strong' ? 'fort' : 'sain'}.`);
  }

  switch (sourcing_decision) {
    case 'PRIORITY': sentences.push('Sourcing : prioritaire au vu des signaux disponibles.'); break;
    case 'TEST': sentences.push('Sourcing : tester en faible quantité avant montée en charge.'); break;
    case 'WATCH': sentences.push('Sourcing : surveiller coûts variables et signaux marché avant décision.'); break;
    case 'AVOID': sentences.push((weight_kg || 0) > 5 ? 'Sourcing : éviter tant que le poids et le fret ne sont pas mieux maîtrisés.' : 'Sourcing : éviter tant que l’économie unitaire ou le marché restent insuffisants.'); break;
    case 'LOSS': sentences.push('Sourcing : suspendre tant que le prix reste sous le coût variable complet.'); break;
  }

  if (market_confidence === 'unknown') sentences.push('Données marché insuffisantes : aucune recommandation économique ne doit être promue en prix marché.');
  else if (market_confidence === 'rejected') sentences.push('Aucune vente depuis 60+ jours malgré la mise en ligne — repositionner ou retirer.');
  return sentences.join(' ');
}

function buildCostBreakdown(details = {}) {
  const rnd = x => Math.round(Number(x) || 0);
  const landed_relay = {
    product_purchase: rnd(details.product_cost),
    sourcing: rnd(details.sourcing),
    hub: rnd(details.hub),
    packaging: rnd(details.packaging || 0),
    freight: rnd(details.freight),
    customs: rnd(details.customs),
    port_transitary: rnd(details.port_transitaire),
    local_distribution: rnd(details.local_distribution || 0),
    relay: rnd(details.relay || 0),
  };
  if (landed_relay.local_distribution === 0 && landed_relay.relay === 0 && details.distribution > 0) {
    landed_relay.local_distribution = rnd(details.distribution);
  }
  const business = {
    payment: rnd(details.payment),
    risk_provision: rnd(details.risks),
    fixed_overhead: rnd(details.fixed_costs),
  };
  const landed_relay_cost_kmf = Object.values(landed_relay).reduce((s, v) => s + v, 0);
  const business_complete_cost_kmf = landed_relay_cost_kmf + Object.values(business).reduce((s, v) => s + v, 0);
  return { landed_relay, business, landed_relay_cost_kmf, business_complete_cost_kmf };
}

function buildDataQuality(input, context) {
  const sources = {};
  const missing = [];
  if (input.product_id && context.hasProduct) sources.purchase_price = 'real';
  else if (input.cost_kmf || input.prix_aed) sources.purchase_price = 'manual';
  else { sources.purchase_price = 'missing'; missing.push('purchase_price'); }

  if (input.weight_kg || input.poids_kg) sources.weight = input.product_id && context.hasProduct ? 'real' : 'manual';
  else if (context.hasCustomsCategory) sources.weight = 'category';
  else { sources.weight = 'default'; missing.push('weight'); }

  if (input.volume_m3 && Number(input.volume_m3) > 0) sources.volume = 'manual';
  else if (context.hasCustomsCategory) sources.volume = 'category';
  else { sources.volume = 'default'; missing.push('volume'); }

  sources.customs_category = context.hasCustomsCategory ? 'category' : 'default';
  if (!context.hasCustomsCategory) missing.push('customs_category');
  sources.fixed_overhead = context.hasFinanceConfig ? 'real' : 'default';
  sources.freight = 'category';
  sources.customs = context.hasCustomsCategory ? 'category' : 'default';

  const total = Object.keys(sources).length;
  const realOrManual = Object.values(sources).filter(s => s === 'real' || s === 'manual').length;
  const ratio = realOrManual / total;
  let confidence = 'low';
  if (ratio >= 0.6) confidence = 'high';
  else if (ratio >= 0.3) confidence = 'medium';
  if ((context.warnings || []).length >= 3) confidence = 'low';
  return { confidence, missing_fields: missing, sources };
}

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
  HEALTH_THRESHOLDS,
  MARKET_THRESHOLDS,
};