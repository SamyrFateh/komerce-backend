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

async function projectNode(node, market, failClosed = false) {
  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i += 1) node[i] = await projectNode(node[i], market, failClosed);
    return node;
  }
  if (node === null || typeof node !== 'object') return node;

  if (isKmfKpiWithoutValue(node)) {
    // KPI indisponible (valeur nulle) : l'unité affichée suit tout de même le marché,
    // sinon un libellé KMF fuit sur un marché XAF.
    node.unit = market.currency;
    node.base_currency = BASE_CURRENCY;
  } else if (isKmfKpi(node)) {
    try {
      const projected = await projectAmount(Number(node.value), BASE_CURRENCY, market.currency);
      node.value = roundToMinorUnit(projected, market.minor_unit);
    } catch (error) {
      if (!failClosed) throw error;
      node.value = null;
      node.data_quality = {...node.data_quality,completeness:'provisional',fx_status:'UNAVAILABLE',warning:'Conversion en devise d’affichage indisponible'};
    }
    node.unit = market.currency;
    node.base_currency = BASE_CURRENCY;
    if (failClosed) node.minor_unit = market.minor_unit;
  }
  for (const key of Object.keys(node)) {
    if (node[key] !== null && typeof node[key] === 'object') node[key] = await projectNode(node[key], market, failClosed);
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
  const target=market || {currency:'EUR',minor_unit:2};
  if (!target.currency || target.currency === BASE_CURRENCY || !payload || typeof payload!=='object') return payload;
  const minorUnit = Number.isInteger(target.minor_unit) ? target.minor_unit : 0;
  const projected=await projectNode(structuredClone(payload),{currency:target.currency,minor_unit:minorUnit},true);
  // Only named visible commercial amounts cross the display boundary.
  // Source KMF, relative shares and chart geometry stay unchanged.
  const groups={top_products:['revenue_kmf','revenue_display'],categories:['revenue_kmf','revenue_display'],
    sales_series:['sales_kmf','sales_display'],sales_by_market:['sales_kmf','sales_display'],
    decision_signals:['value_kmf','value_display']};
  let fxUnavailable=false;
  for (const [group,[sourceKey,displayKey]] of Object.entries(groups)) {
    if (!Array.isArray(projected[group])) continue;
    await Promise.all(projected[group].map(async row=>{
      if (row[sourceKey]==null) return;
      let value=null;
      try { value=roundToMinorUnit(await projectAmount(Number(row[sourceKey]),BASE_CURRENCY,target.currency),minorUnit); }
      catch (_) { fxUnavailable=true; }
      row[displayKey]={value,unit:target.currency,base_currency:BASE_CURRENCY,minor_unit:minorUnit};
    }));
  }
  if(fxUnavailable || projected.kpis?.some(k=>k.data_quality?.fx_status==='UNAVAILABLE')) {
    projected.data_quality={...projected.data_quality,warnings:[...(projected.data_quality?.warnings||[]),
      {code:'commerce_display_fx_unavailable',message:'Conversion en devise d’affichage indisponible.'}]};
  }
  return projected;
}

module.exports = { BASE_CURRENCY, isKmfKpi, projectMarketPayload, projectCommerceMarketPayload };
