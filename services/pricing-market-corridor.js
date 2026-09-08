/**
 * @komerce-arch
 * @role          pricing-market-corridor-owner
 * @domain        economic-engine
 * @layer         service
 * @criticality   high
 * @inputs        server_resolved_market, product_ref, local_market_price_observations
 * @outputs       market_price_corridor, selected_price_economics, audited_observation_mutations
 * @depends       db.js, services/pricing-engine.js, services/pricing-cdr.js, services/market-local-price-resolution-service.js, utils/currency.js
 * @used-by       routes/admin-pricing-workspace.js
 * @db-read       products, market_price_observations, competitor_prices, product_market_price_drafts
 * @db-write      market_price_observations, market_price_observation_events
 * @db-txn        observation_mutations_atomic
 * @doctrine      market_bounds_possible_human_decides, local_evidence_never_falls_back_silently, browser_never_supplies_market_id, corridor_is_observation_not_gate
 * @impact-areas  pricing, economic-engine, market-autonomy, admin-dashboard
 * @version       2026-09
 */

'use strict';

const crypto = require('crypto');
const db = require('../db');
const pricingEngine = require('./pricing-engine');
const pricingCdr = require('./pricing-cdr');
const { projectAmount } = require('../utils/currency');
const { resolveActiveProductMarketPricing } = require('./market-local-price-resolution-service');

class PricingMarketCorridorError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = 'PricingMarketCorridorError';
    this.status = status;
    this.code = code;
  }
}

function requireMarket(market) {
  if (!market || !market.id || !market.code || !market.currency) {
    throw new PricingMarketCorridorError(400, 'pricing_market_corridor_market_required', 'Marché résolu côté serveur requis.');
  }
  return market;
}

function normalizeText(value, fallback = null, max = 500) {
  const text = String(value == null ? '' : value).trim();
  if (!text) return fallback;
  return text.slice(0, max);
}

function finitePositive(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function confidenceForCount(count) {
  if (count >= 8) return 'high';
  if (count >= 3) return 'medium';
  if (count >= 1) return 'low';
  return 'none';
}

function quantileObserved(sortedRows, ratio) {
  if (!sortedRows.length) return null;
  const index = Math.round((sortedRows.length - 1) * ratio);
  return sortedRows[Math.max(0, Math.min(sortedRows.length - 1, index))] || null;
}

function publicObservation(row = {}, fallbackCurrency = 'KMF') {
  return {
    observation_ref: row.observation_ref || row.competitor_ref || null,
    competitor_name: row.competitor_name || null,
    observed_amount: finitePositive(row.observed_amount) ?? finitePositive(row.price_kmf),
    currency: row.currency || fallbackCurrency,
    price_kmf: finitePositive(row.price_kmf),
    observed_at: row.observed_at || null,
    source: row.source || null,
    notes: row.notes || null,
  };
}

function projectObservedCorridor(rows = [], { currency = 'KMF', scope = 'market' } = {}) {
  const normalized = rows
    .map(row => publicObservation(row, currency))
    .filter(row => row.price_kmf != null)
    .sort((a, b) => a.price_kmf - b.price_kmf);

  if (!normalized.length) {
    return {
      status: scope === 'market' ? 'LOCAL_EVIDENCE_MISSING' : 'NO_REFERENCE',
      scope,
      sample_count: 0,
      confidence: 'none',
      authority: 'OBSERVED_REFERENCE_NOT_GATE',
      low: null,
      target: null,
      high: null,
      observations: [],
    };
  }

  return {
    status: normalized.length >= 3 ? 'READY' : 'EMERGING',
    scope,
    sample_count: normalized.length,
    confidence: confidenceForCount(normalized.length),
    authority: 'OBSERVED_REFERENCE_NOT_GATE',
    low: quantileObserved(normalized, 0.25),
    target: quantileObserved(normalized, 0.50),
    high: quantileObserved(normalized, 0.75),
    observations: [...normalized].sort((a, b) => new Date(b.observed_at || 0) - new Date(a.observed_at || 0)),
  };
}

async function resolveProduct(productRef, q = db) {
  const ref = normalizeText(productRef, null, 120);
  if (!ref) throw new PricingMarketCorridorError(400, 'pricing_market_corridor_product_ref_required', 'product_ref requis.');
  const { rows } = await q.query(
    `SELECT id, product_ref, name, category, price_kmf, cost_kmf, weight_kg,
            (COALESCE(volume_cm3, 0) / 1000000.0) AS volume_m3,
            promo_pct, is_promo, promo_until, is_active
       FROM products
      WHERE product_ref = $1
      LIMIT 1`,
    [ref]
  );
  const product = rows[0];
  if (!product || !product.is_active) {
    throw new PricingMarketCorridorError(404, 'pricing_market_corridor_product_not_found', 'Produit actif introuvable.');
  }
  return product;
}

async function loadLocalObservations(marketId, product, q = db) {
  const { rows } = await q.query(
    `SELECT observation_ref, competitor_name, observed_amount, currency, price_kmf,
            observed_at, source, notes
       FROM market_price_observations
      WHERE market_id = $1::uuid
        AND product_id = $2::uuid
        AND is_active = TRUE
      ORDER BY observed_at DESC
      LIMIT 100`,
    [marketId, product.id]
  );
  return rows;
}

async function loadGlobalReference(product, q = db) {
  const { rows } = await q.query(
    `SELECT competitor_ref, competitor_name, price_kmf, observed_at, source, notes
       FROM competitor_prices
      WHERE is_active = TRUE
        AND (
          product_id = $1::uuid
          OR (product_id IS NULL AND category = $2)
        )
      ORDER BY CASE WHEN product_id = $1::uuid THEN 0 ELSE 1 END, observed_at DESC
      LIMIT 100`,
    [product.id, product.category]
  );
  return rows;
}

async function loadLocalDecision(marketId, productId, q = db) {
  const { rows } = await q.query(
    `SELECT amount, currency, status, reason, source, updated_at, authorized_at, active_at
       FROM product_market_price_drafts
      WHERE market_id = $1::uuid
        AND product_id = $2::uuid
      LIMIT 1`,
    [marketId, productId]
  );
  return rows[0] || null;
}

async function projectToKmf(amount, currency) {
  const projected = await projectAmount(Number(amount), String(currency), 'KMF');
  const kmf = Math.round(Number(projected));
  if (!Number.isFinite(kmf) || kmf <= 0) {
    throw new PricingMarketCorridorError(409, 'pricing_market_corridor_fx_invalid', 'Projection vers KMF invalide.');
  }
  return kmf;
}

function projectUnitEconomics(pricing = {}, selectedPriceKmf = null) {
  return {
    selected_price_kmf: selectedPriceKmf,
    purchase_cost_kmf: pricing.purchase_cost_kmf ?? null,
    variable_cost_outside_purchase_kmf: pricing.variable_cost_outside_purchase_kmf ?? null,
    variable_cost_complete_kmf: pricing.variable_cost_complete_kmf ?? null,
    cdr_reference_kmf: pricing.cdr_complete_kmf ?? null,
    contribution_unit_kmf: pricing.contribution_kmf ?? null,
    minimum_safe_price_kmf: pricing.minimum_safe_price_kmf ?? null,
    coverage_reference_price_kmf: pricing.recommended_price_kmf ?? null,
    strategy_risk: pricing.strategy_risk || null,
    data_quality: pricing.data_quality || null,
  };
}

async function computeEconomics(product, market, selectedPriceKmf) {
  const config = await pricingCdr.loadGlobalConfig({ marketId: market.id });
  const pricing = await pricingEngine.recommend({
    product_id: product.id,
    current_price_kmf: selectedPriceKmf,
    final_price_kmf: selectedPriceKmf,
    pricing_strategy: 'market_observed_chain',
  }, { config });
  return projectUnitEconomics(pricing, selectedPriceKmf);
}

function projectSensitivityPoint(point, economics = {}) {
  if (!point) return null;
  const price = finitePositive(point.price_kmf);
  const variableCost = finitePositive(economics.variable_cost_complete_kmf);
  if (price == null || variableCost == null) return { ...point, economics: null };
  return {
    ...point,
    economics: {
      contribution_unit_kmf: Math.round(price - variableCost),
      variable_cost_complete_kmf: variableCost,
      authority: 'SERVER_DERIVED_FROM_CANONICAL_VARIABLE_COST',
    },
  };
}

function projectCorridorEconomics(corridor = {}, economics = {}) {
  return {
    ...corridor,
    low: projectSensitivityPoint(corridor.low, economics),
    target: projectSensitivityPoint(corridor.target, economics),
    high: projectSensitivityPoint(corridor.high, economics),
  };
}

async function buildMarketCorridor({ market, productRef }) {
  requireMarket(market);
  const product = await resolveProduct(productRef);
  const [localRows, globalRows, localDecision, activePricing] = await Promise.all([
    loadLocalObservations(market.id, product),
    loadGlobalReference(product),
    loadLocalDecision(market.id, product.id),
    resolveActiveProductMarketPricing(db, { marketId: market.id, product }),
  ]);

  const effectivePriceKmf = activePricing?.effective_unit_price_kmf || finitePositive(product.price_kmf);
  if (!effectivePriceKmf) {
    throw new PricingMarketCorridorError(409, 'pricing_market_corridor_effective_price_missing', 'Prix acheteur effectif indisponible.');
  }

  const localCorridor = projectObservedCorridor(localRows, { currency: market.currency, scope: 'market' });
  const globalReference = projectObservedCorridor(globalRows, { currency: 'KMF', scope: 'global_reference' });
  const economics = await computeEconomics(product, market, effectivePriceKmf);
  const localCorridorWithEconomics = projectCorridorEconomics(localCorridor, economics);

  let candidate = null;
  if (localDecision && localDecision.amount != null) {
    const candidateKmf = await projectToKmf(localDecision.amount, localDecision.currency || market.currency);
    const sameAsEffective = candidateKmf === effectivePriceKmf;
    candidate = {
      amount: Number(localDecision.amount),
      currency: localDecision.currency || market.currency,
      price_kmf: candidateKmf,
      status: localDecision.status || null,
      reason: localDecision.reason || null,
      source: localDecision.source || null,
      updated_at: localDecision.updated_at || null,
      buyer_effective: localDecision.status === 'LOCAL_ACTIVE',
      economics: sameAsEffective ? economics : await computeEconomics(product, market, candidateKmf),
    };
  }

  return {
    market: {
      code: market.code,
      name: market.name,
      currency: market.currency,
    },
    product: {
      product_ref: product.product_ref,
      name: product.name,
      category: product.category,
      purchase_cost_kmf: finitePositive(product.cost_kmf) || 0,
      global_price_kmf: finitePositive(product.price_kmf),
    },
    corridor: {
      local: localCorridorWithEconomics,
      global_reference: globalReference,
      rule: localCorridor.sample_count > 0
        ? 'Le corridor pays est lu uniquement depuis les observations de ce marché.'
        : 'Aucune donnée locale : la référence globale reste informative et n’est jamais promue silencieusement en corridor pays.',
    },
    selected: {
      source: activePricing ? 'LOCAL_ACTIVE' : 'GLOBAL_BASE',
      buyer_effective: true,
      local_amount: activePricing?.local_amount ?? null,
      local_currency: activePricing?.local_currency ?? null,
      price_kmf: effectivePriceKmf,
      economics,
    },
    candidate,
    generated_at: new Date().toISOString(),
  };
}

function normalizeObservationInput(body = {}) {
  const competitorName = normalizeText(body.competitor_name, null, 200);
  if (!competitorName || competitorName.length < 2) {
    throw new PricingMarketCorridorError(400, 'pricing_market_observation_competitor_required', 'Nom du concurrent requis.');
  }
  const amount = finitePositive(body.amount);
  if (!amount) throw new PricingMarketCorridorError(400, 'pricing_market_observation_amount_invalid', 'Montant observé invalide.');
  const source = normalizeText(body.source, 'market_manager', 80);
  const notes = normalizeText(body.notes, null, 1000);
  let observedAt = new Date();
  if (body.observed_at) {
    observedAt = new Date(body.observed_at);
    if (Number.isNaN(observedAt.getTime())) {
      throw new PricingMarketCorridorError(400, 'pricing_market_observation_date_invalid', 'Date d’observation invalide.');
    }
  }
  return { competitorName, amount, source, notes, observedAt };
}

async function withTransaction(work) {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch (_) { /* preserve original */ }
    throw error;
  } finally {
    if (client && typeof client.release === 'function') client.release();
  }
}

async function recordMarketObservation({ market, productRef, body = {}, actorId = null }) {
  requireMarket(market);
  const input = normalizeObservationInput(body);
  const product = await resolveProduct(productRef);
  const priceKmf = await projectToKmf(input.amount, market.currency);
  const observationRef = `KMO-${crypto.randomUUID().replace(/-/g, '').slice(0, 16).toUpperCase()}`;

  return withTransaction(async client => {
    const { rows } = await client.query(
      `INSERT INTO market_price_observations (
         observation_ref, market_id, product_id, category, competitor_name,
         observed_amount, currency, price_kmf, observed_at, source, notes, created_by
       ) VALUES ($1, $2::uuid, $3::uuid, $4, $5, $6, $7, $8, $9, $10, $11, $12::uuid)
       RETURNING *`,
      [
        observationRef,
        market.id,
        product.id,
        product.category,
        input.competitorName,
        input.amount,
        market.currency,
        priceKmf,
        input.observedAt.toISOString(),
        input.source,
        input.notes,
        actorId || null,
      ]
    );
    const saved = rows[0];
    await client.query(
      `INSERT INTO market_price_observation_events (
         observation_id, observation_ref, market_id, product_id, action, snapshot, reason, actor_id
       ) VALUES ($1::uuid, $2, $3::uuid, $4::uuid, 'RECORDED', $5::jsonb, $6, $7::uuid)`,
      [saved.id, saved.observation_ref, market.id, product.id, JSON.stringify(saved), input.notes, actorId || null]
    );
    return publicObservation(saved, market.currency);
  });
}

async function deactivateMarketObservation({ market, observationRef, actorId = null, reason = null }) {
  requireMarket(market);
  const ref = normalizeText(observationRef, null, 120);
  if (!ref) throw new PricingMarketCorridorError(400, 'pricing_market_observation_ref_required', 'Référence d’observation requise.');
  const cleanReason = normalizeText(reason, 'Retirée du corridor par le manager pays.', 1000);

  return withTransaction(async client => {
    const { rows } = await client.query(
      `UPDATE market_price_observations
          SET is_active = FALSE, updated_at = NOW()
        WHERE observation_ref = $1
          AND market_id = $2::uuid
          AND is_active = TRUE
      RETURNING *`,
      [ref, market.id]
    );
    const saved = rows[0];
    if (!saved) {
      throw new PricingMarketCorridorError(404, 'pricing_market_observation_not_found', 'Observation active introuvable dans ce marché.');
    }
    await client.query(
      `INSERT INTO market_price_observation_events (
         observation_id, observation_ref, market_id, product_id, action, snapshot, reason, actor_id
       ) VALUES ($1::uuid, $2, $3::uuid, $4::uuid, 'DEACTIVATED', $5::jsonb, $6, $7::uuid)`,
      [saved.id, saved.observation_ref, market.id, saved.product_id, JSON.stringify(saved), cleanReason, actorId || null]
    );
    return {
      observation_ref: saved.observation_ref,
      market_code: market.code,
      is_active: false,
    };
  });
}

module.exports = {
  PricingMarketCorridorError,
  confidenceForCount,
  quantileObserved,
  projectObservedCorridor,
  projectCorridorEconomics,
  buildMarketCorridor,
  recordMarketObservation,
  deactivateMarketObservation,
};
