/**
 * @komerce-arch
 * @role          economic-engine-market-price-decision-service
 * @domain        economic-engine
 * @layer         service
 * @criticality   high
 * @inputs        resolved_market, product_ref, local_price_amount, rationale, optional_duration_days, actor_id
 * @outputs       effective_market_price_overlay, audited_market_price_decision
 * @depends       db.js, services/pricing-engine.js, services/pricing-market-decision-policy.js, utils/currency.js
 * @used-by       routes/admin-pricing-workspace.js
 * @db-read       products, product_market_price_decisions, markets, currency_parities, pricing_market_decision_policy_events
 * @db-write      product_market_price_decisions
 * @db-txn        replace_active_decision_atomically
 * @doctrine      single_master_catalog_market_price_is_overlay, server_market_currency_is_authority, economic_floor_before_market_decision, under_cdr_requires_market_coverage_authorization
 * @impact-areas  pricing, economic-engine, catalog-projection, market-authorization
 * @version       2026-09
 */

'use strict';

const db = require('../db');
const pricingEngine = require('./pricing-engine');
const marketDecisionPolicy = require('./pricing-market-decision-policy');
const currencyBoundary = require('../utils/currency');

class MarketPriceDecisionError extends Error {
  constructor(status, message, code, details = null) {
    super(message);
    this.name = 'MarketPriceDecisionError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function finitePositive(value, field) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    throw new MarketPriceDecisionError(400, `${field} doit être un montant positif`, 'pricing_market_price_invalid');
  }
  return number;
}

function normalizeRationale(value) {
  const text = String(value || '').trim();
  if (text.length < 3) {
    throw new MarketPriceDecisionError(400, 'Justification requise pour décider un prix marché', 'pricing_market_price_rationale_required');
  }
  if (text.length > 1000) {
    throw new MarketPriceDecisionError(400, 'Justification trop longue', 'pricing_market_price_rationale_too_long');
  }
  return text;
}

function normalizeDurationDays(value) {
  if (value == null || value === '') return null;
  const days = Number(value);
  if (!Number.isInteger(days) || days <= 0) {
    throw new MarketPriceDecisionError(400, 'duration_days doit être un entier positif', 'pricing_market_price_duration_invalid');
  }
  return days;
}

function roundKmf(value) {
  return Math.round(Number(value) * 100) / 100;
}

function projectDecisionRow(row, market) {
  if (!row) return null;
  return {
    product_ref: row.product_ref,
    name: row.name,
    category: row.category,
    global_price_kmf: Number(row.global_price_kmf) || 0,
    market_price: row.price_amount == null ? null : {
      amount: Number(row.price_amount),
      currency: row.currency,
      minor_unit: Number(market.minor_unit) || 0,
      price_kmf_snapshot: Number(row.price_kmf),
      variable_cost_kmf: Number(row.variable_cost_kmf),
      cdr_complete_kmf: Number(row.cdr_complete_kmf),
      pricing_zone: row.pricing_zone,
      rationale: row.rationale,
      decision_policy_version: row.decision_policy_version || null,
      coverage_status: row.coverage_status || null,
      coverage_authorization: row.coverage_authorization || null,
      coverage_ratio: row.coverage_ratio == null ? null : Number(row.coverage_ratio),
      coverage_evaluated_at: row.coverage_evaluated_at || null,
      decision_duration_days: row.decision_duration_days == null ? null : Number(row.decision_duration_days),
      effective_until: row.effective_until || null,
      decided_at: row.decided_at,
    },
    inherited_global: row.price_amount == null,
  };
}

async function resolveProduct(productRef, q = db) {
  const ref = String(productRef || '').trim();
  if (!ref) throw new MarketPriceDecisionError(400, 'product_ref requis', 'pricing_market_product_ref_required');
  const { rows } = await q.query(
    `SELECT id, product_ref, name, category, price_kmf, cost_kmf, weight_kg, volume_m3, is_active
       FROM products
      WHERE product_ref = $1
      LIMIT 1`,
    [ref]
  );
  if (!rows.length) throw new MarketPriceDecisionError(404, 'Produit introuvable', 'pricing_market_product_not_found');
  if (!rows[0].is_active) throw new MarketPriceDecisionError(409, 'Produit inactif', 'pricing_market_product_inactive');
  return rows[0];
}

async function listEffectivePrices(market, q = db) {
  if (!market || !market.id || !market.code || !market.currency) {
    throw new MarketPriceDecisionError(400, 'Marché pricing résolu requis', 'pricing_market_required');
  }
  const { rows } = await q.query(
    `SELECT p.product_ref, p.name, p.category, p.price_kmf AS global_price_kmf,
            d.price_amount, d.currency, d.price_kmf, d.variable_cost_kmf,
            d.cdr_complete_kmf, d.pricing_zone, d.rationale,
            d.decision_policy_version, d.coverage_status, d.coverage_authorization,
            d.coverage_ratio, d.coverage_evaluated_at, d.decision_duration_days,
            d.effective_until, d.decided_at
       FROM products p
       LEFT JOIN product_market_price_decisions d
         ON d.product_id = p.id
        AND d.market_id = $1
        AND d.revoked_at IS NULL
        AND (d.effective_until IS NULL OR d.effective_until > NOW())
      WHERE p.is_active = TRUE
      ORDER BY d.decided_at DESC NULLS LAST, p.updated_at DESC NULLS LAST, p.name
      LIMIT 250`,
    [market.id]
  );
  return rows.map(row => projectDecisionRow(row, market));
}

async function evaluateDecision(market, product, priceAmount, options = {}) {
  const localAmount = finitePositive(priceAmount, 'price_amount');
  const durationDays = normalizeDurationDays(options.durationDays);
  const projectedKmf = await currencyBoundary.projectAmount(localAmount, market.currency, 'KMF');
  const priceKmf = roundKmf(projectedKmf);
  const config = await pricingEngine.loadGlobalConfig({ marketId: market.id });
  const result = await pricingEngine.recommend({
    category: product.category || 'phones',
    channel: 'cash_relais',
    cost_kmf: Number(product.cost_kmf),
    weight_kg: product.weight_kg == null ? null : Number(product.weight_kg),
    volume_m3: product.volume_m3 == null ? null : Number(product.volume_m3),
    current_price_kmf: priceKmf,
    pricing_strategy: 'manual_market_decision',
  }, { config });

  const variableCost = Number(result.variable_cost_complete_kmf);
  const cdrComplete = Number(result.cdr_complete_kmf);
  if (!Number.isFinite(variableCost) || !Number.isFinite(cdrComplete)) {
    throw new MarketPriceDecisionError(
      409,
      'Vérité économique insuffisante pour décider ce prix',
      'pricing_market_price_truth_unavailable'
    );
  }
  if (priceKmf < variableCost) {
    throw new MarketPriceDecisionError(
      409,
      'Prix refusé : il est sous le coût variable complet du marché',
      'pricing_market_price_below_variable_cost',
      { attempted_price_kmf: priceKmf, variable_cost_kmf: variableCost, cdr_complete_kmf: cdrComplete }
    );
  }

  const base = {
    price_amount: currencyBoundary.roundToMinorUnit(localAmount, Number(market.minor_unit) || 0),
    currency: market.currency,
    price_kmf: priceKmf,
    variable_cost_kmf: roundKmf(variableCost),
    cdr_complete_kmf: roundKmf(cdrComplete),
    decision_policy_version: null,
    coverage_status: null,
    coverage_authorization: null,
    coverage_ratio: null,
    coverage_evaluated_at: null,
    coverage_period_from: null,
    coverage_period_to: null,
    decision_duration_days: null,
    effective_until: null,
  };

  if (priceKmf >= cdrComplete) {
    return { ...base, pricing_zone: 'at_or_above_cdr' };
  }

  if (!durationDays) {
    throw new MarketPriceDecisionError(
      400,
      'Une durée en jours est requise pour une décision contributive sous CDR',
      'pricing_market_price_under_cdr_duration_required'
    );
  }

  const decision = await marketDecisionPolicy.evaluateMarketDecision(market.id);
  if (decision.authorization !== 'ALLOW_NEW_UNDER_CDR_POSITION') {
    throw new MarketPriceDecisionError(
      409,
      'Prix contributif sous CDR refusé par le gate de couverture du marché',
      'pricing_market_price_under_cdr_not_authorized',
      {
        attempted_price_kmf: priceKmf,
        variable_cost_kmf: variableCost,
        cdr_complete_kmf: cdrComplete,
        decision_status: decision.decision_status,
        authorization: decision.authorization,
        reason: decision.reason,
      }
    );
  }

  const evaluatedAt = new Date(decision.evaluated_at);
  const effectiveUntil = new Date(evaluatedAt.getTime() + (durationDays * 86400000));
  return {
    ...base,
    pricing_zone: 'under_cdr_contributive',
    decision_policy_version: decision.policy && decision.policy.version,
    coverage_status: decision.decision_status,
    coverage_authorization: decision.authorization,
    coverage_ratio: decision.coverage && decision.coverage.coverage_ratio == null
      ? null
      : Number(decision.coverage.coverage_ratio),
    coverage_evaluated_at: decision.evaluated_at,
    coverage_period_from: decision.canonical_period && decision.canonical_period.from,
    coverage_period_to: decision.canonical_period && decision.canonical_period.to,
    decision_duration_days: durationDays,
    effective_until: effectiveUntil.toISOString(),
  };
}

function publicSavedPrice(row, market) {
  return {
    amount: Number(row.price_amount),
    currency: row.currency,
    minor_unit: Number(market.minor_unit) || 0,
    price_kmf_snapshot: Number(row.price_kmf),
    variable_cost_kmf: Number(row.variable_cost_kmf),
    cdr_complete_kmf: Number(row.cdr_complete_kmf),
    pricing_zone: row.pricing_zone,
    rationale: row.rationale,
    decision_policy_version: row.decision_policy_version || null,
    coverage_status: row.coverage_status || null,
    coverage_authorization: row.coverage_authorization || null,
    coverage_ratio: row.coverage_ratio == null ? null : Number(row.coverage_ratio),
    coverage_evaluated_at: row.coverage_evaluated_at || null,
    decision_duration_days: row.decision_duration_days == null ? null : Number(row.decision_duration_days),
    effective_until: row.effective_until || null,
    decided_at: row.decided_at,
  };
}

async function decidePrice({ market, productRef, priceAmount, rationale, durationDays = null, actorId = null }) {
  if (!market || !market.id || !market.code || !market.currency) {
    throw new MarketPriceDecisionError(400, 'Marché pricing résolu requis', 'pricing_market_required');
  }
  const product = await resolveProduct(productRef);
  const reason = normalizeRationale(rationale);
  const evaluated = await evaluateDecision(market, product, priceAmount, { durationDays });

  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    const { rows: currentRows } = await client.query(
      `SELECT * FROM product_market_price_decisions
        WHERE market_id = $1 AND product_id = $2 AND revoked_at IS NULL
        FOR UPDATE`,
      [market.id, product.id]
    );
    const current = currentRows[0] || null;
    const unchanged = current
      && (current.effective_until == null || new Date(current.effective_until) > new Date())
      && Number(current.price_amount) === Number(evaluated.price_amount)
      && current.currency === evaluated.currency
      && Number(current.price_kmf) === Number(evaluated.price_kmf)
      && Number(current.variable_cost_kmf) === Number(evaluated.variable_cost_kmf)
      && Number(current.cdr_complete_kmf) === Number(evaluated.cdr_complete_kmf)
      && current.pricing_zone === evaluated.pricing_zone
      && Number(current.decision_duration_days || 0) === Number(evaluated.decision_duration_days || 0)
      && String(current.rationale || '') === reason;

    if (unchanged) {
      await client.query('COMMIT');
      return {
        product_ref: product.product_ref,
        market_code: market.code,
        unchanged: true,
        market_price: publicSavedPrice(current, market),
      };
    }

    if (current) {
      await client.query(
        `UPDATE product_market_price_decisions
            SET revoked_at = now(), revoked_by = $3, revoke_reason = 'superseded_by_new_decision'
          WHERE market_id = $1 AND product_id = $2 AND revoked_at IS NULL`,
        [market.id, product.id, actorId]
      );
    }

    const { rows: [saved] } = await client.query(
      `INSERT INTO product_market_price_decisions
         (market_id, product_id, price_amount, currency, price_kmf,
          variable_cost_kmf, cdr_complete_kmf, pricing_zone, rationale, source,
          decision_policy_version, coverage_status, coverage_authorization,
          coverage_ratio, coverage_evaluated_at, coverage_period_from, coverage_period_to,
          decision_duration_days, effective_until, decided_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'canonical_market_pricing_workspace',
               $10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
       RETURNING *`,
      [
        market.id,
        product.id,
        evaluated.price_amount,
        evaluated.currency,
        evaluated.price_kmf,
        evaluated.variable_cost_kmf,
        evaluated.cdr_complete_kmf,
        evaluated.pricing_zone,
        reason,
        evaluated.decision_policy_version,
        evaluated.coverage_status,
        evaluated.coverage_authorization,
        evaluated.coverage_ratio,
        evaluated.coverage_evaluated_at,
        evaluated.coverage_period_from,
        evaluated.coverage_period_to,
        evaluated.decision_duration_days,
        evaluated.effective_until,
        actorId,
      ]
    );
    await client.query('COMMIT');
    return {
      product_ref: product.product_ref,
      market_code: market.code,
      unchanged: false,
      market_price: publicSavedPrice(saved, market),
    };
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch (_) { /* noop */ }
    throw error;
  } finally {
    client.release();
  }
}

async function resetPrice({ market, productRef, actorId = null, reason = 'reset_to_global' }) {
  if (!market || !market.id || !market.code) {
    throw new MarketPriceDecisionError(400, 'Marché pricing résolu requis', 'pricing_market_required');
  }
  const product = await resolveProduct(productRef);
  const cleanReason = String(reason || 'reset_to_global').trim().slice(0, 1000) || 'reset_to_global';
  const { rows } = await db.query(
    `UPDATE product_market_price_decisions
        SET revoked_at = now(), revoked_by = $3, revoke_reason = $4
      WHERE market_id = $1 AND product_id = $2 AND revoked_at IS NULL
      RETURNING id`,
    [market.id, product.id, actorId, cleanReason]
  );
  if (!rows.length) {
    throw new MarketPriceDecisionError(404, 'Aucun prix marché actif à réinitialiser', 'pricing_market_price_not_active');
  }
  return {
    product_ref: product.product_ref,
    market_code: market.code,
    inherited_global: true,
    global_price_kmf: Number(product.price_kmf) || 0,
  };
}

module.exports = {
  MarketPriceDecisionError,
  normalizeRationale,
  normalizeDurationDays,
  projectDecisionRow,
  resolveProduct,
  listEffectivePrices,
  evaluateDecision,
  decidePrice,
  resetPrice,
};
