/**
 * @komerce-arch
 * @role          economic-engine-market-product-price-decisions
 * @domain        economic-engine
 * @layer         service
 * @criticality   high
 * @inputs        resolved_market, product_ref, local_price, rationale, optional_valid_until, actor_id
 * @outputs       effective_market_product_prices, append_only_price_decisions
 * @depends       db, services/pricing-engine.js, services/pricing-market-decision-policy.js, utils/currency.js
 * @used-by       routes/admin-pricing-workspace.js
 * @db-read       products, product_market_price_decision_events, markets, currency_parities, cost_components, finance_config
 * @db-write      product_market_price_decision_events
 * @db-txn        append_only_price_decision_recording
 * @doctrine      global_product_market_price_overlay, never_below_variable_cost, under_cdr_requires_server_gate, reset_restores_global_inheritance
 * @impact-areas  pricing, economic-engine, catalog, admin-dashboard, market-authorization
 * @version       2026-09
 */

'use strict';

const db = require('../db');
const pricingEngine = require('./pricing-engine');
const marketDecisionPolicy = require('./pricing-market-decision-policy');
const {
  getMarketCurrency,
  projectAmount,
  roundToMinorUnit,
} = require('../utils/currency');

class MarketProductPriceError extends Error {
  constructor(status, message, code) {
    super(message);
    this.name = 'MarketProductPriceError';
    this.status = status;
    this.code = code;
  }
}

function requiredText(value, field, min = 10, max = 2000) {
  const text = String(value || '').trim();
  if (text.length < min || text.length > max) {
    throw new MarketProductPriceError(400, `${field} doit contenir entre ${min} et ${max} caractères`, 'pricing_market_price_invalid');
  }
  return text;
}

function finitePositive(value, field) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    throw new MarketProductPriceError(400, `${field} doit être un nombre strictement positif`, 'pricing_market_price_invalid');
  }
  return number;
}

function parseFutureInstant(value, field, now = new Date(), required = false) {
  if (value == null || value === '') {
    if (required) {
      throw new MarketProductPriceError(400, `${field} est requis pour une position sous CDR`, 'pricing_market_under_cdr_valid_until_required');
    }
    return null;
  }
  const instant = new Date(value);
  if (!Number.isFinite(instant.getTime())) {
    throw new MarketProductPriceError(400, `${field} est invalide`, 'pricing_market_price_invalid');
  }
  if (instant.getTime() <= now.getTime()) {
    throw new MarketProductPriceError(400, `${field} doit être dans le futur`, 'pricing_market_price_invalid');
  }
  return instant;
}

function assertResolvedMarket(market) {
  if (!market || !market.id || !market.code) {
    throw new MarketProductPriceError(400, 'Marché Pricing requis', 'pricing_market_required');
  }
}

function rejectCurrencyAuthority(input = {}) {
  if (Object.prototype.hasOwnProperty.call(input, 'currency') ||
      Object.prototype.hasOwnProperty.call(input, 'local_currency') ||
      Object.prototype.hasOwnProperty.call(input, 'price_kmf') ||
      Object.prototype.hasOwnProperty.call(input, 'market_id')) {
    throw new MarketProductPriceError(
      400,
      'La devise, le market_id et la projection KMF sont résolus exclusivement côté serveur',
      'pricing_market_price_authority_forbidden'
    );
  }
}

async function resolveProduct(productRef, { activeOnly = true, q = db } = {}) {
  const ref = String(productRef || '').trim();
  if (!ref) {
    throw new MarketProductPriceError(400, 'product_ref requis', 'pricing_product_ref_required');
  }
  const { rows } = await q.query(
    `SELECT id, product_ref, name, category, price_kmf, cost_kmf,
            weight_kg, volume_m3, is_active
       FROM products
      WHERE product_ref = $1
        ${activeOnly ? 'AND is_active = TRUE' : ''}
      LIMIT 1`,
    [ref]
  );
  if (!rows.length) {
    throw new MarketProductPriceError(404, 'Produit introuvable ou inactif', 'pricing_product_not_found');
  }
  return rows[0];
}

function computeEconomicBoundaries(product, config) {
  const cdr = pricingEngine.computeCDR(product, {
    config,
    volume_m3: Number(product.volume_m3) || 0.005,
    channel: 'cash_relais',
  });
  const variableCostKmf = Math.round(Number(cdr.variable_cost_estimated_kmf));
  const cdrKmf = Math.round(Number(cdr.cost_complete_estimated_kmf));
  if (!Number.isFinite(variableCostKmf) || !Number.isFinite(cdrKmf) || variableCostKmf < 0 || cdrKmf < variableCostKmf) {
    throw new MarketProductPriceError(
      409,
      'Les frontières économiques du produit ne sont pas décisionnelles',
      'pricing_market_price_cost_truth_unavailable'
    );
  }
  return { variable_cost_kmf: variableCostKmf, cdr_kmf: cdrKmf };
}

function compactDecisionSnapshot(decision) {
  if (!decision) return {};
  return {
    decision_status: decision.decision_status || null,
    authorization: decision.authorization || null,
    reason: decision.reason || null,
    policy_version: decision.policy?.version || null,
    policy_coverage_threshold: decision.policy?.coverage_threshold == null
      ? null
      : Number(decision.policy.coverage_threshold),
    coverage_ratio: decision.coverage?.coverage_ratio == null
      ? null
      : Number(decision.coverage.coverage_ratio),
    canonical_period: decision.canonical_period
      ? { from: decision.canonical_period.from, to: decision.canonical_period.to }
      : null,
    evaluated_at: decision.evaluated_at || null,
  };
}

function latestEventIsActive(event, marketCurrency, now = new Date()) {
  if (!event || event.decision_type !== 'SET') return false;
  if (event.local_currency !== marketCurrency) return false;
  if (event.valid_until && new Date(event.valid_until).getTime() <= now.getTime()) return false;
  return true;
}

function currentPosition(priceKmf, boundaries) {
  const price = Number(priceKmf);
  if (!Number.isFinite(price) || price <= 0) return 'NOT_PRICED';
  if (price <= Number(boundaries.variable_cost_kmf)) return 'DESTRUCTIVE';
  if (price < Number(boundaries.cdr_kmf)) return 'UNDER_CDR';
  return 'COVERED';
}

async function projectKmfToMarket(amountKmf, marketCurrency) {
  const projected = await projectAmount(Number(amountKmf) || 0, 'KMF', marketCurrency.currency);
  return roundToMinorUnit(projected, marketCurrency.minor_unit);
}

function publicEvent(row) {
  if (!row) return null;
  return {
    decision_type: row.decision_type,
    local_price: row.local_price == null ? null : Number(row.local_price),
    local_currency: row.local_currency || null,
    price_kmf_snapshot: row.price_kmf_snapshot == null ? null : Number(row.price_kmf_snapshot),
    variable_cost_kmf_snapshot: row.variable_cost_kmf_snapshot == null ? null : Number(row.variable_cost_kmf_snapshot),
    cdr_kmf_snapshot: row.cdr_kmf_snapshot == null ? null : Number(row.cdr_kmf_snapshot),
    strategy_position: row.strategy_position || null,
    valid_until: row.valid_until || null,
    rationale: row.rationale,
    decision_snapshot: row.decision_snapshot || {},
    recorded_at: row.recorded_at,
  };
}

async function listProductRowsWithLatestEvent(marketId) {
  const { rows } = await db.query(`
    SELECT p.id, p.product_ref, p.name, p.category, p.price_kmf, p.cost_kmf,
           p.weight_kg, p.volume_m3, p.is_active,
           e.decision_type, e.local_price, e.local_currency, e.price_kmf_snapshot,
           e.variable_cost_kmf_snapshot, e.cdr_kmf_snapshot, e.strategy_position,
           e.valid_until, e.rationale, e.decision_snapshot, e.recorded_at
      FROM products p
      LEFT JOIN LATERAL (
        SELECT decision_type, local_price, local_currency, price_kmf_snapshot,
               variable_cost_kmf_snapshot, cdr_kmf_snapshot, strategy_position,
               valid_until, rationale, decision_snapshot, recorded_at
          FROM product_market_price_decision_events
         WHERE market_id = $1 AND product_id = p.id
         ORDER BY recorded_at DESC, id DESC
         LIMIT 1
      ) e ON TRUE
     WHERE p.is_active = TRUE
     ORDER BY p.name, p.product_ref
  `, [marketId]);
  return rows;
}

async function projectProductRow(row, marketCurrency, config, now = new Date()) {
  const boundaries = computeEconomicBoundaries(row, config);
  const latest = row.decision_type ? publicEvent(row) : null;
  const active = latestEventIsActive(latest, marketCurrency.currency, now);
  const globalPriceKmf = Math.round(Number(row.price_kmf) || 0);
  const effectivePriceKmf = active ? Number(latest.price_kmf_snapshot) : globalPriceKmf;
  const [globalLocal, variableLocal, cdrLocal] = await Promise.all([
    projectKmfToMarket(globalPriceKmf, marketCurrency),
    projectKmfToMarket(boundaries.variable_cost_kmf, marketCurrency),
    projectKmfToMarket(boundaries.cdr_kmf, marketCurrency),
  ]);

  return {
    product_ref: row.product_ref,
    name: row.name,
    category: row.category,
    currency: marketCurrency.currency,
    minor_unit: marketCurrency.minor_unit,
    global_price_kmf: globalPriceKmf,
    global_price_local: globalLocal,
    market_price_local: active ? Number(latest.local_price) : null,
    market_price_kmf_snapshot: active ? Number(latest.price_kmf_snapshot) : null,
    effective_price_local: active ? Number(latest.local_price) : globalLocal,
    effective_price_kmf: effectivePriceKmf,
    effective_source: active ? 'market_decision' : 'global_inherited',
    decision_state: active
      ? 'ACTIVE'
      : (latest?.decision_type === 'SET' && latest?.valid_until && new Date(latest.valid_until).getTime() <= now.getTime()
          ? 'EXPIRED'
          : (latest?.decision_type === 'SET' && latest?.local_currency !== marketCurrency.currency ? 'CURRENCY_CHANGED' : 'INHERITED')),
    variable_cost_kmf: boundaries.variable_cost_kmf,
    variable_cost_local: variableLocal,
    cdr_kmf: boundaries.cdr_kmf,
    cdr_local: cdrLocal,
    current_position: currentPosition(effectivePriceKmf, boundaries),
    latest_decision: latest,
  };
}

async function listMarketProductPrices(market, options = {}) {
  assertResolvedMarket(market);
  const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
  const [marketCurrency, config, rows] = await Promise.all([
    getMarketCurrency(market.id),
    pricingEngine.loadGlobalConfig({ marketId: market.id }),
    listProductRowsWithLatestEvent(market.id),
  ]);
  const products = [];
  for (const row of rows) {
    products.push(await projectProductRow(row, marketCurrency, config, now));
  }
  return {
    market_code: market.code,
    currency: marketCurrency.currency,
    minor_unit: marketCurrency.minor_unit,
    products,
  };
}

async function listMarketProductPriceHistory(market, productRef, options = {}) {
  assertResolvedMarket(market);
  const product = await resolveProduct(productRef, { activeOnly: false });
  const limit = Math.min(Math.max(Number(options.limit) || 50, 1), 100);
  const { rows } = await db.query(`
    SELECT decision_type, local_price, local_currency, price_kmf_snapshot,
           variable_cost_kmf_snapshot, cdr_kmf_snapshot, strategy_position,
           valid_until, rationale, decision_snapshot, recorded_at
      FROM product_market_price_decision_events
     WHERE market_id = $1 AND product_id = $2
     ORDER BY recorded_at DESC, id DESC
     LIMIT $3
  `, [market.id, product.id, limit]);
  return {
    market_code: market.code,
    product_ref: product.product_ref,
    decisions: rows.map(publicEvent),
  };
}

async function latestProductDecision(marketId, productId, q = db) {
  const { rows } = await q.query(`
    SELECT decision_type, local_price, local_currency, price_kmf_snapshot,
           variable_cost_kmf_snapshot, cdr_kmf_snapshot, strategy_position,
           valid_until, rationale, decision_snapshot, recorded_at
      FROM product_market_price_decision_events
     WHERE market_id = $1 AND product_id = $2
     ORDER BY recorded_at DESC, id DESC
     LIMIT 1
  `, [marketId, productId]);
  return rows[0] || null;
}

async function setMarketProductPrice(market, productRef, input = {}, actorId, options = {}) {
  assertResolvedMarket(market);
  if (!actorId) throw new MarketProductPriceError(400, 'Auteur de décision requis', 'pricing_market_price_actor_required');
  rejectCurrencyAuthority(input);

  const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
  const rationale = requiredText(input.rationale, 'rationale');
  const requestedPrice = finitePositive(input.price, 'price');
  const [product, marketCurrency, config] = await Promise.all([
    resolveProduct(productRef),
    getMarketCurrency(market.id),
    pricingEngine.loadGlobalConfig({ marketId: market.id }),
  ]);
  const boundaries = computeEconomicBoundaries(product, config);
  const localPrice = roundToMinorUnit(requestedPrice, marketCurrency.minor_unit);
  if (!(localPrice > 0)) {
    throw new MarketProductPriceError(400, 'Le prix local arrondi doit rester positif', 'pricing_market_price_invalid');
  }
  const projectedKmf = await projectAmount(localPrice, marketCurrency.currency, 'KMF');
  const priceKmf = roundToMinorUnit(projectedKmf, 0);

  if (priceKmf <= boundaries.variable_cost_kmf) {
    throw new MarketProductPriceError(
      409,
      `Prix refusé : ${priceKmf} KMF ne dépasse pas le coût variable complet ${boundaries.variable_cost_kmf} KMF`,
      'pricing_market_price_below_variable_cost'
    );
  }

  const position = priceKmf < boundaries.cdr_kmf ? 'UNDER_CDR' : 'COVERED';
  let validUntil = parseFutureInstant(input.valid_until, 'valid_until', now, position === 'UNDER_CDR');
  let decisionSnapshot = {};

  if (position === 'UNDER_CDR') {
    const decision = await marketDecisionPolicy.evaluateMarketDecision(market.id, { at: now });
    if (!decision || decision.authorization !== 'ALLOW_NEW_UNDER_CDR_POSITION') {
      throw new MarketProductPriceError(
        409,
        'Position sous CDR refusée par le gate économique du marché',
        'pricing_market_under_cdr_not_authorized'
      );
    }
    if (decision.policy?.effective_to && validUntil.getTime() > new Date(decision.policy.effective_to).getTime()) {
      throw new MarketProductPriceError(
        409,
        'La validité du prix sous CDR dépasse la politique qui l’autorise',
        'pricing_market_under_cdr_policy_expiry'
      );
    }
    decisionSnapshot = compactDecisionSnapshot(decision);
  }

  const { rows } = await db.query(`
    INSERT INTO product_market_price_decision_events (
      market_id, product_id, decision_type,
      local_price, local_currency, price_kmf_snapshot,
      variable_cost_kmf_snapshot, cdr_kmf_snapshot, strategy_position,
      valid_until, rationale, decision_snapshot, recorded_by
    ) VALUES (
      $1, $2, 'SET',
      $3, $4, $5,
      $6, $7, $8,
      $9, $10, $11::jsonb, $12
    )
    RETURNING decision_type, local_price, local_currency, price_kmf_snapshot,
              variable_cost_kmf_snapshot, cdr_kmf_snapshot, strategy_position,
              valid_until, rationale, decision_snapshot, recorded_at
  `, [
    market.id,
    product.id,
    localPrice,
    marketCurrency.currency,
    priceKmf,
    boundaries.variable_cost_kmf,
    boundaries.cdr_kmf,
    position,
    validUntil ? validUntil.toISOString() : null,
    rationale,
    JSON.stringify(decisionSnapshot),
    actorId,
  ]);

  return {
    market_code: market.code,
    product_ref: product.product_ref,
    decision: publicEvent(rows[0]),
  };
}

async function resetMarketProductPrice(market, productRef, input = {}, actorId, options = {}) {
  assertResolvedMarket(market);
  if (!actorId) throw new MarketProductPriceError(400, 'Auteur de décision requis', 'pricing_market_price_actor_required');
  rejectCurrencyAuthority(input);
  const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
  const rationale = requiredText(input.rationale, 'rationale');
  const [product, marketCurrency] = await Promise.all([
    resolveProduct(productRef, { activeOnly: false }),
    getMarketCurrency(market.id),
  ]);
  const latest = await latestProductDecision(market.id, product.id);
  if (!latestEventIsActive(latest, marketCurrency.currency, now)) {
    return {
      market_code: market.code,
      product_ref: product.product_ref,
      changed: false,
      effective_source: 'global_inherited',
    };
  }

  const { rows } = await db.query(`
    INSERT INTO product_market_price_decision_events (
      market_id, product_id, decision_type, rationale, recorded_by
    ) VALUES ($1, $2, 'RESET', $3, $4)
    RETURNING decision_type, local_price, local_currency, price_kmf_snapshot,
              variable_cost_kmf_snapshot, cdr_kmf_snapshot, strategy_position,
              valid_until, rationale, decision_snapshot, recorded_at
  `, [market.id, product.id, rationale, actorId]);

  return {
    market_code: market.code,
    product_ref: product.product_ref,
    changed: true,
    effective_source: 'global_inherited',
    decision: publicEvent(rows[0]),
  };
}

async function resolveEffectiveMarketProductPrice(market, productRef, options = {}) {
  assertResolvedMarket(market);
  const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
  const [product, marketCurrency, config] = await Promise.all([
    resolveProduct(productRef, { activeOnly: false }),
    getMarketCurrency(market.id),
    pricingEngine.loadGlobalConfig({ marketId: market.id }),
  ]);
  const latest = await latestProductDecision(market.id, product.id);
  return projectProductRow({ ...product, ...(latest || {}) }, marketCurrency, config, now);
}

module.exports = {
  MarketProductPriceError,
  listMarketProductPrices,
  listMarketProductPriceHistory,
  setMarketProductPrice,
  resetMarketProductPrice,
  resolveEffectiveMarketProductPrice,
  _resolveProduct: resolveProduct,
  _computeEconomicBoundaries: computeEconomicBoundaries,
  _compactDecisionSnapshot: compactDecisionSnapshot,
  _latestEventIsActive: latestEventIsActive,
  _currentPosition: currentPosition,
};
