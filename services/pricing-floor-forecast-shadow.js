/**
 * @komerce-arch
 * @role          economic-engine-pricing-floor-forecast-shadow
 * @domain        economic-engine
 * @layer         service
 * @criticality   high
 * @inputs        explicit_market_product_scenarios_and_evidence
 * @outputs       non_decisional_forecast_and_cost_trace
 * @depends       none
 * @used-by       scripts/recette/pricing-floor-forecast-demo.js
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      docs/doctrine/PRICING_FLOOR_FORECAST_SHADOW.md
 * @impact-areas  economic-engine
 * @version       2026-11
 */
'use strict';

/*
 * PREVISION SEULEMENT. Ne lit aucune table, ne fixe ni ne publie aucun prix.
 * Pas de moyenne implicite 200/4/2.5, pas de marge N3 cachée dans le plancher.
 * Les devis/tarifs sont fournis par le demandeur, pas inventés ici.
 */
const CASES = ['favorable', 'central', 'defavorable'];
const PROOF = ['CONTRACT', 'QUOTED', 'TARIFF', 'ESTIMATED_TECH', 'ASSUMED', 'UNKNOWN'];
const REQUIRED = Object.freeze({
  import: ['supplier_delivery', 'freight', 'customs_duties', 'last_mile', 'relay_commission', 'payment'],
  local: ['local_delivery', 'relay_commission', 'payment'],
});
const SIMPLE = new Set(['fixed_unit', 'fixed_order', 'fixed_po', 'per_m3', 'per_kg', 'fret_m3_minimum', 'lot_fixed_m3']);
const PERCENT = new Set(['pct_purchase', 'pct_cif', 'pct_n1', 'pct_exposure', 'pct_sale']);

const round = n => Math.round((n + Number.EPSILON) * 100) / 100;
const valid = n => typeof n === 'number' && Number.isFinite(n) && n >= 0;
const positive = n => valid(n) && n > 0;

function traceStatus(evidence, date, code, problems, notes) {
  if (!evidence || !PROOF.includes(evidence.status)) {
    problems.push(code + ': provenance ou niveau de preuve manquant');
    return 'UNKNOWN';
  }
  if (evidence.status === 'UNKNOWN') {
    problems.push(code + ': coût non borné (UNKNOWN)');
    return evidence.status;
  }
  if (typeof evidence.reference !== 'string' || !evidence.reference.trim() ||
      typeof evidence.as_of !== 'string' || !/^\d{4}-\d\d-\d\d$/.test(evidence.as_of)) {
    problems.push(code + ': source et date de référence requises');
    return 'UNKNOWN';
  }
  if (evidence.expires_on && evidence.expires_on < date) {
    notes.push(code + ': source expirée, réexamen nécessaire');
  }
  return evidence.status;
}

function componentAmount(component, product, units, baseAmounts, cif, n1, problems) {
  const v = component.value;
  if (!valid(v)) {
    problems.push(component.code + ': montant/taux absent ou invalide');
    return null;
  }
  switch (component.basis) {
    case 'fixed_unit': return v;
    case 'fixed_order': return v / units;
    case 'fixed_po':
      if (!positive(component.po_units)) break;
      return v / component.po_units;
    case 'per_m3':
      if (!positive(product.volume_m3)) break;
      return v * product.volume_m3;
    case 'per_kg':
      if (!positive(product.weight_kg)) break;
      return v * product.weight_kg;
    case 'fret_m3_minimum':
      if (!positive(product.volume_m3) || !positive(component.lot_volume_m3) ||
          !valid(component.minimum_billable_m3)) break;
      if (product.volume_m3 > component.lot_volume_m3) {
        problems.push(component.code + ': volume produit supérieur au volume du lot');
        return null;
      }
      return v * product.volume_m3 * Math.max(1, component.minimum_billable_m3 / component.lot_volume_m3);
    case 'lot_fixed_m3':
      if (!positive(product.volume_m3) || !positive(component.lot_volume_m3)) break;
      if (product.volume_m3 > component.lot_volume_m3) {
        problems.push(component.code + ': volume produit supérieur au volume du lot');
        return null;
      }
      return v * product.volume_m3 / component.lot_volume_m3;
    case 'pct_purchase': return product.purchase_kmf * v / 100;
    case 'pct_cif':
      if (cif == null) break;
      return cif * v / 100;
    case 'pct_n1':
      if (n1 == null) break;
      return n1 * v / 100;
    case 'pct_exposure': {
      if (!Array.isArray(component.base_codes) || component.base_codes.length === 0) break;
      if (component.base_codes.some(code => !Object.hasOwn(baseAmounts, code))) break;
      return component.base_codes.reduce((sum, code) => sum + baseAmounts[code], 0) * v / 100;
    }
    case 'pct_sale':
      if (v >= 100) break;
      return 0; // Pourcentage résolu sur le prix, jamais sur le coût.
    default:
      problems.push(component.code + ': clé inconnue ' + component.basis);
      return null;
  }
  problems.push(component.code + ': base physique / unités de répartition indisponibles');
  return null;
}

function calculateCase(forecast, scenario, units = 1) {
  const problems = [];
  const notes = [];
  const { product, valuation_date: date, market_code: market } = forecast;
  const costs = forecast.scenarios && forecast.scenarios[scenario];
  if (!Array.isArray(costs)) return { status: 'NON_DECISIONNEL', problems: ['Scénario ' + scenario + ' absent'] };
  if (!positive(product.purchase_kmf) || !['import', 'local'].includes(product.circuit) ||
      !market || !/^\d{4}-\d\d-\d\d$/.test(date || '') || !positive(units)) {
    return { status: 'NON_DECISIONNEL', problems: ['Produit / marché / date / quantité invalides'] };
  }

  const purchaseProof = traceStatus(product.purchase_evidence, date, 'purchase', problems, notes);
  const lines = [{ code: 'purchase', stage: 'N1', basis: 'fixed_unit', amount_kmf: product.purchase_kmf,
    evidence: purchaseProof, source: product.purchase_evidence?.reference || null }];
  const codes = new Set();
  const baseAmounts = { purchase: product.purchase_kmf };
  const stages = [
    costs.filter(c => SIMPLE.has(c.basis)),
    costs.filter(c => c.basis === 'pct_purchase' || c.basis === 'pct_cif'),
    costs.filter(c => c.basis === 'pct_n1' || c.basis === 'pct_exposure'),
    costs.filter(c => c.basis === 'pct_sale'),
  ];
  for (const c of costs) {
    if (!c || !c.code || codes.has(c.code) || !['N1', 'N2'].includes(c.stage) ||
        !(SIMPLE.has(c.basis) || PERCENT.has(c.basis))) {
      problems.push('Composant en doublon ou invalide : ' + (c?.code || '?'));
      continue;
    }
    codes.add(c.code);
    if (c.market_code !== market) problems.push(c.code + ': marché non renseigné ou incorrect');
    if (c.circuit !== product.circuit && c.circuit !== 'both')
      problems.push(c.code + ': circuit non renseigné ou incorrect');
    if (c.cif_included && c.stage !== 'N1') problems.push(c.code + ': CIF limité aux frais N1');
    if ((c.basis === 'pct_n1' || c.basis === 'pct_exposure' || c.basis === 'pct_sale') && c.stage !== 'N2')
      problems.push(c.code + ': pourcentage commercial classé hors N2');
    if (c.basis === 'pct_sale' && c.value >= 100) problems.push(c.code + ': taux >= 100 %');
  }
  for (const code of REQUIRED[product.circuit]) {
    if (!codes.has(code)) problems.push('Coût obligatoire sans information : ' + code);
  }
  let cif = null;
  let n1 = null;
  let pctPrice = 0;
  // Les risques calculés sur d'autres frais ne dépendent jamais de l'ordre des risques.
  let exposureBaseAmounts = null;
  for (let phase = 0; phase < stages.length; phase++) {
    if (phase === 1) cif = product.purchase_kmf +
      lines.filter(line => line.stage === 'N1' && line.cif_included).reduce((a, x) => a + x.amount_kmf, 0);
    if (phase === 2) {
      n1 = lines.filter(line => line.stage === 'N1').reduce((a, x) => a + x.amount_kmf, 0);
      exposureBaseAmounts = { ...baseAmounts };
    }
    for (const c of stages[phase]) {
      const evidence = traceStatus(c.evidence, date, c.code, problems, notes);
      const amount = componentAmount(c, product, units,
        c.basis === 'pct_exposure' ? exposureBaseAmounts : baseAmounts, cif, n1, problems);
      if (amount == null) continue;
      if (c.basis === 'pct_sale') pctPrice += c.value / 100;
      const entry = { code: c.code, stage: c.stage, basis: c.basis,
        amount_kmf: round(amount), evidence, source: c.evidence?.reference || null,
        cif_included: Boolean(c.cif_included), charged_value: c.value };
      lines.push(entry);
      baseAmounts[c.code] = amount;
    }
  }
  if (pctPrice >= 1) problems.push('Frais sur prix >= 100 %');
  const totalN1 = lines.filter(l => l.stage === 'N1').reduce((a, x) => a + x.amount_kmf, 0);
  const totalN2Fixed = lines.filter(l => l.stage === 'N2').reduce((a, x) => a + x.amount_kmf, 0);
  const fixedTotal = round(totalN1 + totalN2Fixed);
  const floor = pctPrice < 1 ? round(fixedTotal / (1 - pctPrice)) : null;
  const hasWeak = lines.some(l => ['ESTIMATED_TECH', 'ASSUMED', 'UNKNOWN'].includes(l.evidence)) || notes.length > 0;
  const status = problems.length ? 'NON_DECISIONNEL' : hasWeak ? 'PROVISOIRE' : 'EXPLOITABLE';
  return {
    status, scenario, market_code: market, circuit: product.circuit, units_per_order: units,
    n1_kmf: round(totalN1), n2_fixed_kmf: round(totalN2Fixed),
    sale_pct: round(pctPrice * 100), sale_fraction: pctPrice,
    p0_kmf: problems.length ? null : floor, cif_kmf: cif == null ? null : round(cif),
    lines, problems, notes,
  };
}

function comparePrices(forecast) {
  const scenarios = Object.fromEntries(CASES.map(name => [name, calculateCase(forecast, name)]));
  const diagnostics = [];
  const central = scenarios.central;
  const allCodes = Object.fromEntries(CASES.map(name =>
    [name, (forecast.scenarios?.[name] || []).map(c => [c.code, c.basis, c.stage]).sort((a,b) => a[0].localeCompare(b[0]))]));
  if (JSON.stringify(allCodes.favorable) !== JSON.stringify(allCodes.central) ||
      JSON.stringify(allCodes.defavorable) !== JSON.stringify(allCodes.central))
    diagnostics.push('Composants différents entre scénarios : comparaison impossible');
  if (CASES.some(name => scenarios[name].status === 'NON_DECISIONNEL'))
    diagnostics.push('Au moins un scénario non calculable');
  if (!diagnostics.length && !(scenarios.favorable.p0_kmf <= central.p0_kmf &&
       central.p0_kmf <= scenarios.defavorable.p0_kmf))
    diagnostics.push('Bornes non ordonnées : favorable <= central <= défavorable exigé');
  const nonDecisional = diagnostics.length > 0;
  const prices = (forecast.candidate_prices_kmf || []).map(price => {
    if (!positive(price)) return { price_kmf: price, status: 'PRIX_INVALIDE' };
    if (nonDecisional) return { price_kmf: price, status: 'NON_DECISIONNEL' };
    const pct = central.sale_fraction;
    const contribution = round(price * (1 - pct) - (central.n1_kmf + central.n2_fixed_kmf));
    const label = price >= scenarios.defavorable.p0_kmf ? 'ROBUSTE_DANS_LES_SCENARIOS' :
      price >= central.p0_kmf ? 'SENSIBLE' :
        price >= scenarios.favorable.p0_kmf ? 'DESTRUCTIF_AU_CENTRAL' : 'DESTRUCTIF';
    return { price_kmf: price, verdict: label, decision_quality: CASES.some(n => scenarios[n].status === 'PROVISOIRE')
      ? 'PROVISOIRE' : 'EXPLOITABLE', contribution_centrale_kmf: contribution,
      contribution_defavorable_kmf: round(price * (1 - scenarios.defavorable.sale_fraction)
        - scenarios.defavorable.n1_kmf - scenarios.defavorable.n2_fixed_kmf) };
  });
  const n3 = forecast.n3_monthly_kmf;
  const coverage = valid(n3) && !nonDecisional ? prices.map(p => ({
    price_kmf: p.price_kmf,
    equivalent_sales_to_cover_n3: p.contribution_centrale_kmf > 0
      ? Math.ceil(n3 / p.contribution_centrale_kmf) : null,
  })) : null;
  return {
    authority: 'SHADOW_REFERENCE_ONLY',
    decisions_automatiques: false,
    market_code: forecast.market_code,
    cases: scenarios,
    plancher_central_kmf: nonDecisional ? null : central.p0_kmf,
    plancher_prudent_kmf: nonDecisional ? null : scenarios.defavorable.p0_kmf,
    status: nonDecisional ? 'NON_DECISIONNEL' :
      CASES.some(name => scenarios[name].status === 'PROVISOIRE') ? 'PROVISOIRE' : 'EXPLOITABLE',
    diagnostics, prices, n3_coverage_reference_only: coverage,
  };
}

module.exports = { calculateCase, comparePrices, REQUIRED, CASES };