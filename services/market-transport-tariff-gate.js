/**
 * @komerce-arch
 * @role          market-transport-tariff-gate
 * @domain        logistics
 * @layer         service
 * @criticality   critical
 * @inputs        market_currency, import_item_count, market_rates
 * @outputs       allowed_boolean, MARKET_TRANSPORT_TARIFF_MISSING
 * @depends       none
 * @used-by       services/order-checkout-service.js
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      fail_closed, no_country_branch, attested_cost_is_not_a_sale_price
 * @impact-areas  checkout, transport, market
 * @version       2026-10
 */
'use strict';

// Les règles business_rules SEA_KMF_PER_KG_COMMERCIAL / AIR_KMF_PER_KG_TAXABLE sont des tarifs de VENTE
// exprimés en KMF. Elles ne valent que pour un marché dont la devise est cette devise. Pour tout autre marché
// (XAF, DJF…), tant qu'aucun tarif de vente propre n'est configuré, le checkout refuse : on n'invente ni
// conversion implicite, ni tarif dérivé du coût de fret attesté (freight_rate = coût, jamais un prix).
const GLOBAL_TRANSPORT_TARIFF_CURRENCY = 'KMF';

const RATE_KEYS = ['SEA_KMF_PER_KG_COMMERCIAL', 'AIR_KMF_PER_KG_TAXABLE'];

function hasMarketRates(marketRates) {
  return !!marketRates && RATE_KEYS.some(k => Number(marketRates[k]) > 0);
}

// Un Market KMF hérite des tarifs globaux ; tout autre Market exige ses propres tarifs de vente
// (market_transport_sale_rates). Jamais de repli sur le tarif KMF global ni sur le coût attesté.
function isTransportTariffApplicable({ marketCurrency, importItemCount, marketRates = null }) {
  if (!(Number(importItemCount) > 0)) return true; // LOCAL_STOCK seul : aucun transport international
  if (hasMarketRates(marketRates)) return true;
  return String(marketCurrency || '').trim().toUpperCase() === GLOBAL_TRANSPORT_TARIFF_CURRENCY;
}

// Tarifs effectifs d'un Market : KMF = globaux surchargés par le Market ; non-KMF = tarifs du Market seuls
// (+ diviseur volumétrique, constante physique). Une clé absente reste absente → TRANSPORT_PRICING_RATE_MISSING.
function resolveEffectiveTransportRates({ marketCurrency, globalRates, marketRates }) {
  const isGlobalCurrency = String(marketCurrency || '').trim().toUpperCase() === GLOBAL_TRANSPORT_TARIFF_CURRENCY;
  const out = { AIR_VOLUMETRIC_DIVISOR: globalRates.AIR_VOLUMETRIC_DIVISOR };
  for (const k of RATE_KEYS) {
    const local = Number(marketRates?.[k]);
    if (local > 0) out[k] = local;
    else if (isGlobalCurrency) out[k] = globalRates[k];
  }
  return out;
}

function assertTransportTariffApplicable(args) {
  if (isTransportTariffApplicable(args)) return;
  const err = new Error(
    'Aucun tarif de transport de vente n’est configuré pour ce marché : la commande ne peut pas être créée.'
  );
  err.code = 'MARKET_TRANSPORT_TARIFF_MISSING';
  err.statusCode = 409;
  throw err;
}

module.exports = {
  GLOBAL_TRANSPORT_TARIFF_CURRENCY,
  isTransportTariffApplicable,
  assertTransportTariffApplicable,
  resolveEffectiveTransportRates,
};
