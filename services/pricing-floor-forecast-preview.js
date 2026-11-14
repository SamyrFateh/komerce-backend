/**
 * @komerce-arch
 * @role          economic-engine-forecast-preview-contract
 * @domain        economic-engine
 * @layer         service
 * @criticality   high
 * @inputs        server_product_market_and_untrusted_simulation
 * @outputs       never_persisted_provisional_floor_preview
 * @depends       services/pricing-floor-forecast-shadow.js, utils/currency.js
 * @used-by       routes/admin-pricing-workspace.js
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      docs/doctrine/PRICING_FLOOR_FORECAST_SHADOW.md
 * @impact-areas  economic-engine
 * @version       2026-11
 */
'use strict';

const floor = require('./pricing-floor-forecast-shadow');
const { projectAmount } = require('../utils/currency');

const SCENARIOS = floor.CASES;
const IMPORT_FIELDS = Object.freeze([
  'supplier_delivery', 'bank_pct', 'hub_packaging', 'freight',
  'lot_volume_m3', 'minimum_billable_m3', 'lot_fee', 'insurance_pct',
  'customs_duties', 'last_mile', 'relay_commission', 'payment',
  'payment_pct', 'risk_damage_pct', 'risk_pickup_pct',
]);
const LOCAL_FIELDS = Object.freeze([
  'local_delivery', 'relay_commission', 'payment',
  'payment_pct', 'risk_damage_pct', 'risk_pickup_pct',
]);
// Only monetary amounts are projected. Physical quantities and percentages
// must remain exactly as supplied, never treated as currencies.
const MONEY_FIELDS = Object.freeze([
  'supplier_delivery', 'hub_packaging', 'freight', 'lot_fee',
  'last_mile', 'local_delivery', 'relay_commission', 'payment',
]);

function safePositive(value) {
  const n = Number(value);
  return value !== null && value !== undefined && value !== '' &&
    Number.isFinite(n) && n > 0 ? n : null;
}
function validAmount(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 10_000_000_000;
}

class ForecastPreviewError extends Error {
  constructor(message, fields = []) {
    super(message);
    this.status = 422;
    this.code = 'pricing_forecast_preview_invalid';
    this.fields = fields;
  }
}

const evidence = date => ({
  status: 'ASSUMED',
  reference: 'Hypothèse saisie pour une simulation sans validation de devis ni contrat',
  as_of: date,
});

function makeComponent(code, stage, basis, value, market, circuit, date, props = {}) {
  return {
    code, stage, basis, value, market_code: market, circuit,
    evidence: evidence(date),
    ...props,
  };
}

function normalizedScenario(s, circuit, market, date, commissionBasis) {
  const l = (code, stage, basis, value, props) =>
    makeComponent(code, stage, basis, value, market, circuit, date, props);
  const relay = l('relay_commission', 'N2', commissionBasis, s.relay_commission);
  const payment = l('payment', 'N2', 'fixed_order', s.payment);
  const paymentPct = l('payment_pct', 'N2', 'pct_sale', s.payment_pct);
  if (circuit === 'local') {
    return [
      l('local_delivery', 'N1', 'fixed_order', s.local_delivery),
      relay, payment, paymentPct,
      l('risk_damage', 'N2', 'pct_n1', s.risk_damage_pct),
      l('risk_pickup', 'N2', 'pct_exposure', s.risk_pickup_pct,
        { base_codes: ['local_delivery', 'relay_commission'] }),
    ];
  }
  return [
    l('supplier_delivery', 'N1', 'fixed_unit', s.supplier_delivery, { cif_included: true }),
    l('bank_fee', 'N1', 'pct_purchase', s.bank_pct),
    l('hub_packaging', 'N1', 'fixed_unit', s.hub_packaging),
    l('freight', 'N1', 'fret_m3_minimum', s.freight,
      { lot_volume_m3: s.lot_volume_m3, minimum_billable_m3: s.minimum_billable_m3, cif_included: true }),
    l('lot_fee', 'N1', 'lot_fixed_m3', s.lot_fee, { lot_volume_m3: s.lot_volume_m3 }),
    l('insurance', 'N1', 'pct_cif', s.insurance_pct),
    l('customs_duties', 'N1', 'pct_cif', s.customs_duties),
    l('last_mile', 'N1', 'fixed_order', s.last_mile),
    relay, payment, paymentPct,
    l('risk_damage', 'N2', 'pct_n1', s.risk_damage_pct),
    l('risk_pickup', 'N2', 'pct_exposure', s.risk_pickup_pct,
      { base_codes: ['last_mile', 'relay_commission'] }),
  ];
}

/**
 * This explicitly distrusts the browser's evidence: all user-entered costs
 * are ASSUMED. Not a path for ingesting contracts, invoices or tariffs.
 * Product purchase/physical characteristics and market are server resolved.
 */
function preview({ market, product, payload, date = new Date().toISOString().slice(0, 10) }) {
  const req = payload || {};
  const circuit = req.circuit;
  const commissionBasis = req.commission_basis;
  if (!market || !/^[A-Z]{2}$/.test(market.code || '') ||
      !product || !safePositive(product.cost_kmf) ||
      !['import','local'].includes(circuit) ||
      !['fixed_order','fixed_unit'].includes(commissionBasis)) {
    throw new ForecastPreviewError('Marché, achat, circuit ou unité de commission non disponible.');
  }
  if (circuit === 'import' && (!safePositive(product.volume_m3) || !safePositive(product.weight_kg)))
    throw new ForecastPreviewError('Le poids et le volume du produit importé sont nécessaires.');
  const expected = circuit === 'import' ? IMPORT_FIELDS : LOCAL_FIELDS;
  const problems = [];
  const scenarios = {};
  for (const scenario of SCENARIOS) {
    const data = req.scenarios?.[scenario];
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      problems.push(scenario + ': scénario absent');
      continue;
    }
    for (const field of expected) {
      if (!validAmount(data[field])) problems.push(scenario + '.' + field + ': montant ou taux requis');
    }
    if (circuit === 'import' && (!safePositive(data.lot_volume_m3) ||
        !safePositive(data.minimum_billable_m3)))
      problems.push(scenario + ': volumes de lot et minimum facturable requis');
    for (const percentField of ['bank_pct','insurance_pct','customs_duties','payment_pct','risk_damage_pct','risk_pickup_pct']) {
      if (expected.includes(percentField) && validAmount(data[percentField]) && data[percentField] >= 100)
        problems.push(scenario + '.' + percentField + ': taux inférieur à 100 % requis');
    }
    if (data && problems.length === 0) {
      scenarios[scenario] = normalizedScenario(data, circuit, market.code, date, commissionBasis);
    }
  }
  if (problems.length) throw new ForecastPreviewError('Hypothèses incomplètes ou invalides.', problems);
  const candidatePrices = Array.isArray(req.candidate_prices_kmf) ?
    req.candidate_prices_kmf.filter(safePositive).slice(0, 5).map(Number) : [];
  const forecast = {
    market_code: market.code, valuation_date: date,
    product: {
      circuit,
      purchase_kmf: Number(product.cost_kmf),
      volume_m3: safePositive(product.volume_m3),
      weight_kg: safePositive(product.weight_kg),
      purchase_evidence: {
        status: 'ASSUMED', as_of: date,
        reference: 'Coût d’achat enregistré au catalogue ; facture et actualité non vérifiées',
      },
    },
    scenarios, candidate_prices_kmf: candidatePrices,
  };
  const result = floor.comparePrices(forecast);
  return {
    product_ref: product.product_ref,
    simulation_only: true,
    writes: false,
    evidence_policy: 'ALL_BROWSER_AMOUNTS_ARE_UNVERIFIED_ASSUMPTIONS',
    proof_note: 'Ne prouve ni un tarif applicable, ni une marge réelle, ni la possibilité de publier.',
    forecast: result,
  };
}

/**
 * The Atelier accepts monetary hypotheses and candidate selling prices in
 * the market currency. Pricing calculations remain in their canonical KMF
 * base. Only the server-resolved market.currency selects the FX pair.
 * projectAmount delegates to fx-authority (EUR pivot, no invented rates).
 */
async function previewForMarket({ market, product, payload, date }) {
  const currency = String(market?.currency || '').trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) {
    throw new ForecastPreviewError('Devise du marché indisponible : conversion interdite.');
  }
  const original = payload || {};
  if (currency !== 'KMF' && Object.prototype.hasOwnProperty.call(original, 'candidate_prices_kmf')) {
    throw new ForecastPreviewError('Prix en KMF fourni pour un marché non-KMF : saisir le prix dans la devise du marché.');
  }
  const localPrices = original.candidate_prices_local ??
    (currency === 'KMF' ? (original.candidate_prices_kmf || []) : []);
  if (!Array.isArray(localPrices)) {
    throw new ForecastPreviewError('Prix candidats invalides : liste requise.');
  }
  const memo = new Map();
  async function convertAmount(amount, from, to) {
    if (amount == null || !Number.isFinite(amount) || from === to) return amount;
    const key = from + ':' + to + ':' + amount;
    if (!memo.has(key)) memo.set(key, projectAmount(amount, from, to));
    return Number(await memo.get(key));
  }
  const scenarios = {};
  for (const name of SCENARIOS) {
    const entry = original.scenarios?.[name];
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      scenarios[name] = entry;
      continue;
    }
    const normalized = { ...entry };
    for (const field of MONEY_FIELDS) {
      if (Object.prototype.hasOwnProperty.call(entry, field) && validAmount(entry[field])) {
        normalized[field] = await convertAmount(entry[field], currency, 'KMF');
      }
    }
    scenarios[name] = normalized;
  }
  const priceKmf = [];
  for (const amount of localPrices) {
    priceKmf.push(safePositive(amount) === null ? amount :
      await convertAmount(Number(amount), currency, 'KMF'));
  }
  const answer = preview({
    market, product, date,
    payload: { ...original, scenarios, candidate_prices_kmf: priceKmf },
  });
  const result = answer.forecast;
  const central = result.cases?.central;
  async function inLocal(amount) {
    return amount == null ? null : convertAmount(Number(amount), 'KMF', currency);
  }
  const displayPrices = [];
  for (const item of result.prices || []) {
    displayPrices.push({
      price: await inLocal(item.price_kmf),
      contribution: await inLocal(item.contribution_centrale_kmf),
    });
  }
  return {
    ...answer, market_currency: currency, internal_currency: 'KMF',
    fx_authority: 'fx-authority',
    local_display: {
      plancher_central: await inLocal(result.plancher_central_kmf),
      plancher_prudent: await inLocal(result.plancher_prudent_kmf),
      central_n1: await inLocal(central?.n1_kmf),
      central_n2: await inLocal(central?.n2_fixed_kmf),
      prices: displayPrices,
    },
  };
}

module.exports = { preview, previewForMarket, ForecastPreviewError, IMPORT_FIELDS, LOCAL_FIELDS, MONEY_FIELDS };
