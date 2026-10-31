/**
 * @komerce-arch
 * @role          market-ready-to-sell-projection
 * @domain        market-delegation
 * @layer         service
 * @criticality   high
 * @inputs        server_resolved_market, catalog_review_queue, market_exposure, delegated_capabilities
 * @outputs       ready_to_sell_queue, observed_price_corridor, proposed_local_price, bulk_eligibility
 * @depends       db.js, services/pricing-market-corridor.js, services/market-local-price-resolution-service.js
 * @used-by       services/market-delegation-catalog-service.js
 * @db-read       products, product_market_price_drafts
 * @db-write      none
 * @db-txn        none
 * @doctrine      certified_catalog_readiness_before_market_decision, corridor_is_observation_not_gate, local_human_decides_price, bulk_only_for_green_rows, missing_market_price_never_becomes_buyer_effective
 * @impact-areas  market-delegation, catalog, pricing, admin-dashboard
 * @version       2026-09
 */

'use strict';

const db = require('../db');
const pricingMarketCorridor = require('./pricing-market-corridor');
const { projectAmount } = require('../utils/currency');
const { assertProductPriceShapeCompatible } = require('./market-local-price-resolution-service');

const ACTIVE_PRICE = 'LOCAL_ACTIVE';
const APPROVAL_CAPABILITIES = Object.freeze(['catalog.expose', 'pricing.decide', 'pricing.activate']);

function positive(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function decisionState({ priceActive, shapeCompatible, proposalAmount, corridorStatus, viability }) {
  if (priceActive) return { key: 'READY', label: 'Prix actif · prêt à exposer', tone: 'positive' };
  if (!shapeCompatible) return { key: 'BLOCKED', label: 'Bloqué · prix SKU/variante', tone: 'critical' };
  if (!proposalAmount) return { key: 'NEEDS_PRICE', label: 'Prix à décider', tone: 'warning' };
  if (corridorStatus !== 'READY') return { key: 'REVIEW', label: 'Corridor à confirmer', tone: 'warning' };
  if (viability === 'NON_VIABLE_STRUCTURAL') return { key: 'REVIEW', label: 'Coûts / marché à vérifier', tone: 'warning' };
  if (viability === 'VIABLE') return { key: 'READY', label: 'Prêt à vendre', tone: 'positive' };
  return { key: 'REVIEW', label: 'À arbitrer', tone: 'warning' };
}

async function buildReadyToSell({
  executor = db,
  market,
  capabilities = [],
  reviewQueue = { items: [] },
  exposure = [],
  limit = 100,
  offset = 0,
  search = '',
} = {}) {
  if (!market?.id || !market?.code || !market?.currency) {
    throw new TypeError('market-ready-to-sell-projection: market résolu requis');
  }

  const incoming = Array.isArray(reviewQueue?.items) ? reviewQueue.items : [];
  const published = Array.isArray(exposure) ? exposure : [];
  const ids = [...new Set([
    ...incoming.map(row => row?.product_id).filter(Boolean),
    // Every published product belongs in the country price catalogue,
    // including intentionally hidden products and products with an active price.
    ...published.map(row => row?.product_id).filter(Boolean),
  ])];

  if (!ids.length) {
    return {
      market: { code: market.code, currency: market.currency },
      summary: { total: 0, ready: 0, review: 0, blocked: 0, bulk_eligible: 0 },
      pagination: { offset: 0, limit: 100, total: 0, has_more: false },
      items: [],
    };
  }

  const { rows: priceRows } = await executor.query(
    `SELECT product_id::text AS product_id, amount, currency, status, updated_at, active_at
       FROM product_market_price_drafts
      WHERE market_id = $1::uuid
        AND product_id = ANY($2::uuid[])`,
    [market.id, ids]
  );
  const priceByProduct = new Map(priceRows.map(row => [String(row.product_id), row]));

  const sourceRows = [];
  const seen = new Set();
  for (const row of incoming) {
    const id = String(row?.product_id || '');
    if (!id || seen.has(id)) continue;
    seen.add(id);
    sourceRows.push({ ...row, catalog_state: 'candidate', decision_recorded: false, commercial_exposure: 'DISABLED' });
  }
  for (const row of published) {
    const id = String(row?.product_id || '');
    if (!id || seen.has(id)) continue;
    // Catalogue pays = toutes les références, y compris déjà tarifées et exposées.
    // Le prix actif est affiché sans provoquer une seconde activation.
    seen.add(id);
    sourceRows.push({ ...row, catalog_state: 'published' });
  }

  const safeLimit = Math.min(Math.max(Number(limit) || 100, 1), 200);
  const safeOffset = Math.max(0, Math.floor(Number(offset) || 0));
  const query = String(search || '').trim().toLocaleLowerCase('fr').slice(0, 120);
  const matches = query
    ? sourceRows.filter(row =>
      String(row.product_name || row.name || '').toLocaleLowerCase('fr').includes(query)
      || String(row.product_ref || '').toLocaleLowerCase('fr').includes(query))
    : sourceRows;
  const limited = matches.slice(safeOffset, safeOffset + safeLimit);
  const selectedIds = limited.map(row => row.product_id);
  const { rows: products } = await executor.query(
    `SELECT id, product_ref, name, description, sku, category, subcategory, image_url,
            stock, is_available, is_active, lifecycle_status, content_source, needs_review,
            price_kmf, cost_kmf, weight_kg, volume_cm3, promo_pct, is_promo, promo_until
       FROM products
      WHERE id = ANY($1::uuid[])`,
    [selectedIds]
  );
  const productById = new Map(products.map(row => [String(row.id), row]));
  const capSet = new Set((capabilities || []).map(String));

  const items = [];
  for (const source of limited) {
    const product = productById.get(String(source.product_id));
    if (!product) continue;

    let corridor = null;
    let corridorError = null;
    try {
      corridor = await pricingMarketCorridor.buildMarketCorridorForProduct({ market, product, executor });
    } catch (error) {
      corridorError = error?.code || error?.message || 'pricing_corridor_unavailable';
    }

    let shapeCompatible = true;
    let shapeReason = null;
    try {
      await assertProductPriceShapeCompatible(executor, product.id);
    } catch (error) {
      shapeCompatible = false;
      shapeReason = error?.code || error?.message || 'market_local_price_shape_conflict';
    }

    const costEconomics = corridor?.selected?.economics || null;
    async function localCost(value) {
      const number = positive(value);
      if (number == null) return null;
      if (market.currency === 'KMF') return Math.round(number);
      try {
        const local = Number(await projectAmount(number, 'KMF', market.currency));
        return Number.isFinite(local) && local > 0 ? Math.round(local * 100) / 100 : null;
      } catch (_) { return null; }
    }
    const [variableLocal, landedLocal, minimumSafeLocal] = await Promise.all([
      localCost(costEconomics?.variable_cost_complete_kmf),
      localCost(costEconomics?.landed_relay_cost_kmf),
      localCost(costEconomics?.minimum_safe_price_kmf),
    ]);
    const priceDecision = priceByProduct.get(String(product.id)) || null;
    const priceActive = priceDecision?.status === ACTIVE_PRICE;
    const local = corridor?.corridor?.local || null;
    const existingAmount = positive(priceDecision?.amount);
    const targetAmount = positive(local?.target?.observed_amount);
    const proposalAmount = priceActive ? existingAmount : (existingAmount || targetAmount);
    const proposalSource = priceActive
      ? 'LOCAL_ACTIVE'
      : existingAmount
        ? 'EXISTING_LOCAL_DECISION'
        : targetAmount
          ? 'MARKET_TARGET'
          : 'NONE';
    const viability = local?.viability?.status || null;
    const state = decisionState({
      priceActive,
      shapeCompatible,
      proposalAmount,
      corridorStatus: local?.status || null,
      viability,
    });

    const requiredCapabilities = priceActive ? ['catalog.expose'] : APPROVAL_CAPABILITIES;
    const canApprove = requiredCapabilities.every(cap => capSet.has(cap));
    const bulkEligible = canApprove
      && state.key === 'READY'
      && (priceActive || (
        proposalSource === 'MARKET_TARGET'
        && local?.status === 'READY'
        && viability === 'VIABLE'
      ));

    items.push({
      product_id: product.id,
      product_ref: product.product_ref,
      product_name: product.name,
      description: product.description || null,
      sku: product.sku || source.sku || null,
      category: product.category || null,
      subcategory: product.subcategory || null,
      image_url: product.image_url || source.image_url || null,
      stock: product.stock == null ? null : Number(product.stock),
      catalog_state: source.catalog_state,
      decision_recorded: source.decision_recorded === true,
      commercial_exposure: source.commercial_exposure || 'DISABLED',
      exposure_enabled: source.decision_recorded === true && source.commercial_exposure === 'ENABLED',
      local_price_active: priceActive,
      local_price_status: priceDecision?.status || null,
      variable_cost_kmf: positive(costEconomics?.variable_cost_complete_kmf),
      variable_cost_local: variableLocal,
      landed_relay_cost_kmf: positive(costEconomics?.landed_relay_cost_kmf),
      landed_relay_cost_local: landedLocal,
      minimum_safe_price_local: minimumSafeLocal,
      cost_quality: costEconomics?.data_quality || null,
      corridor: {
        status: local?.status || 'UNAVAILABLE',
        confidence: local?.confidence || 'none',
        sample_count: Number(local?.sample_count || 0),
        low: positive(local?.low?.observed_amount),
        target: targetAmount,
        high: positive(local?.high?.observed_amount),
        currency: market.currency,
        viability,
        viability_label: local?.viability?.label || null,
      },
      proposed_price: {
        amount: proposalAmount,
        currency: market.currency,
        source: proposalSource,
      },
      // Preview of the displayed proposal. The browser never computes business contribution.
      contribution_at_proposed_local: proposalAmount != null && variableLocal != null
        ? Math.round((proposalAmount - variableLocal) * 100) / 100 : null,
      decision_state: state,
      can_approve: canApprove,
      required_capabilities: requiredCapabilities,
      bulk_eligible: bulkEligible,
      blocker: !shapeCompatible ? shapeReason : corridorError,
    });
  }

  return {
    market: { code: market.code, currency: market.currency },
    summary: {
      total: items.length,
      ready: items.filter(item => item.decision_state.key === 'READY').length,
      review: items.filter(item => ['REVIEW', 'NEEDS_PRICE'].includes(item.decision_state.key)).length,
      blocked: items.filter(item => item.decision_state.key === 'BLOCKED').length,
      bulk_eligible: items.filter(item => item.bulk_eligible).length,
    },
    pagination: { offset: safeOffset, limit: safeLimit, total: matches.length, has_more: safeOffset + limited.length < matches.length },
    items,
  };
}

module.exports = { ACTIVE_PRICE, APPROVAL_CAPABILITIES, decisionState, buildReadyToSell };
