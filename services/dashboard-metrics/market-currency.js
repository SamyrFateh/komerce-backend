/**
 * @komerce-arch
 * @role          dashboard-market-currency-projection
 * @domain        dashboard
 * @layer         service
 * @criticality   high
 * @inputs        market_dashboard_payload, server_resolved_market (code, currency, minor_unit)
 * @outputs       market_dashboard_payload_in_market_currency
 * @depends       utils/currency.js
 * @used-by       routes/admin-dashboard-market.js
 * @db-read       currency_parities, markets
 * @db-write      (none)
 * @db-txn        @none
 * @doctrine      economic_base_stays_kmf, projection_at_display_boundary_only, fail_closed_on_missing_parity, no_second_currency_formula
 * @impact-areas  dashboard, market-delegation
 * @version       2026-10
 */

'use strict';

const { projectAmount, roundToMinorUnit } = require('../../utils/currency');

const BASE_CURRENCY = 'KMF';

function isKmfKpi(node) {
  return node !== null
    && typeof node === 'object'
    && !Array.isArray(node)
    && node.unit === BASE_CURRENCY
    && node.value !== null
    && node.value !== undefined
    && node.value !== ''
    && Number.isFinite(Number(node.value));
}

function isKmfKpiWithoutValue(node) {
  return node !== null
    && typeof node === 'object'
    && !Array.isArray(node)
    && node.unit === BASE_CURRENCY
    && 'value' in node
    && (node.value === null || node.value === undefined);
}

async function projectNode(node, market) {
  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i += 1) node[i] = await projectNode(node[i], market);
    return node;
  }
  if (node === null || typeof node !== 'object') return node;

  if (isKmfKpiWithoutValue(node)) {
    // KPI indisponible (valeur nulle) : l'unité affichée suit tout de même le marché,
    // sinon un libellé KMF fuit sur un marché XAF.
    node.unit = market.currency;
    node.base_currency = BASE_CURRENCY;
  } else if (isKmfKpi(node)) {
    const projected = await projectAmount(Number(node.value), BASE_CURRENCY, market.currency);
    node.value = roundToMinorUnit(projected, market.minor_unit);
    node.unit = market.currency;
    node.base_currency = BASE_CURRENCY;
  }
  for (const key of Object.keys(node)) {
    if (node[key] !== null && typeof node[key] === 'object') node[key] = await projectNode(node[key], market);
  }
  return node;
}

/**
 * Projette les KPI libellés « KMF » vers la devise du marché scopé. Le calcul économique reste en KMF
 * (doctrine) : seule la frontière d'affichage change, via utils/currency.js (unique formule de parité).
 * Une parité manquante lève une erreur explicite : jamais de repli silencieux en KMF.
 */
async function projectMarketPayload(payload, market) {
  if (!market || !market.currency || market.currency === BASE_CURRENCY) return payload;
  if (payload === null || typeof payload !== 'object') return payload;
  // Copie profonde : le payload peut provenir d'un cache partagé (KMF) qui ne doit jamais être muté.
  return projectNode(structuredClone(payload), { currency: market.currency, minor_unit: Number.isInteger(market.minor_unit) ? market.minor_unit : 0 });
}

// Commerce-only display boundary: retain *_kmf facts in KMF; attach explicit
// market-currency amounts for the visible product/category rankings.
// Do not expand the generic recursive projection to arbitrary *_kmf fields.
async function projectCommerceMarketPayload(payload, market) {
  const projected = await projectMarketPayload(payload, market);
  if (!market || !market.currency || market.currency === BASE_CURRENCY) return projected;

  const minorUnit = Number.isInteger(market.minor_unit) ? market.minor_unit : 0;
  for (const group of ['top_products', 'categories']) {
    if (!Array.isArray(projected[group])) continue;
    await Promise.all(projected[group].map(async (row) => {
      if (row.revenue_kmf == null) return;
      const value = await projectAmount(Number(row.revenue_kmf), BASE_CURRENCY, market.currency);
      row.revenue_display = {
        value: roundToMinorUnit(value, minorUnit),
        unit: market.currency,
        base_currency: BASE_CURRENCY,
      };
    }));
  }
  return projected;
}

module.exports = { BASE_CURRENCY, isKmfKpi, projectMarketPayload, projectCommerceMarketPayload };
