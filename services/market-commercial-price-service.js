/**
 * @komerce-arch
 * @role          market-commercial-price-decision-owner
 * @domain        market-autonomy
 * @layer         service
 * @criticality   high
 * @inputs        server_resolved_market, product_ref, local_amount, reason, actor_id, authorization_snapshot
 * @outputs       market_price_decision_projection, audited_set_reset_authorize_results
 * @depends       db.js
 * @used-by       routes/admin-pricing-workspace.js, services/market-local-price-activation-service.js
 * @db-read       products, product_market_price_drafts
 * @db-write      product_market_price_drafts, product_market_price_draft_events
 * @db-txn        owned
 * @doctrine      country_strategy_is_local, global_catalog_price_untouched, local_currency_from_server_market, authorization_distinct_from_buyer_cutover
 * @impact-areas  pricing, market, admin-dashboard
 * @version       2026-09
 */

'use strict';

const db = require('../db');

const PRICE_STATUSES = Object.freeze({
  DRAFT: 'DRAFT_PENDING_GATE',
  AUTHORIZED: 'LOCAL_AUTHORIZED_PENDING_CUTOVER',
  ACTIVE: 'LOCAL_ACTIVE',
});

class MarketCommercialPriceError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = 'MarketCommercialPriceError';
    this.status = status;
    this.code = code;
  }
}

function requireMarket(market) {
  if (!market || !market.id || !market.code || !market.currency) {
    throw new MarketCommercialPriceError(400, 'market_price_market_required', 'Marché résolu côté serveur requis.');
  }
  return market;
}

function normalizeAmount(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new MarketCommercialPriceError(400, 'market_price_invalid_amount', 'Le prix local doit être un montant strictement positif.');
  }
  return Number(amount.toFixed(4));
}

function normalizeReason(value) {
  const reason = String(value || '').trim();
  if (reason.length < 3 || reason.length > 1000) {
    throw new MarketCommercialPriceError(400, 'market_price_reason_required', 'Un motif de décision de 3 à 1000 caractères est requis.');
  }
  return reason;
}

function normalizeSource(value) {
  const source = String(value || 'market_manager').trim().slice(0, 80);
  return source || 'market_manager';
}

async function resolveProduct(executor, productRef) {
  const ref = String(productRef || '').trim();
  if (!ref) {
    throw new MarketCommercialPriceError(400, 'market_price_product_ref_required', 'product_ref requis.');
  }
  const { rows } = await executor.query(
    `SELECT id, product_ref, name, category, price_kmf, is_active
       FROM products
      WHERE product_ref = $1
      LIMIT 1`,
    [ref]
  );
  if (!rows[0] || !rows[0].is_active) {
    throw new MarketCommercialPriceError(404, 'market_price_product_not_found', 'Produit actif introuvable.');
  }
  return rows[0];
}

function projectDecision(row, market) {
  if (!row) return null;
  const status = row.decision_status || row.status || null;
  return {
    product_ref: row.product_ref,
    name: row.name || null,
    category: row.category || null,
    global_price_kmf: Number(row.global_price_kmf) || 0,
    local_price: row.local_amount == null ? null : Number(row.local_amount),
    currency: market.currency,
    market_code: market.code,
    decision_status: status,
    decision_reason: row.decision_reason || row.reason || null,
    decision_source: row.decision_source || row.source || null,
    decided_at: row.decided_at || row.updated_at || null,
    authorized_at: row.authorized_at || null,
    active_at: row.active_at || null,
    authorization_snapshot: row.authorization_snapshot || null,
    economically_authorized: status === PRICE_STATUSES.AUTHORIZED || status === PRICE_STATUSES.ACTIVE,
    commercial_mode: row.local_amount == null ? 'GLOBAL_BASE_NO_LOCAL_DECISION' : status,
    buyer_effective: status === PRICE_STATUSES.ACTIVE,
  };
}

async function listMarketPriceDrafts(market) {
  requireMarket(market);
  const { rows } = await db.query(
    `SELECT p.product_ref,
            p.name,
            p.category,
            p.price_kmf AS global_price_kmf,
            d.amount AS local_amount,
            d.status AS decision_status,
            d.reason AS decision_reason,
            d.source AS decision_source,
            d.updated_at AS decided_at,
            d.authorized_at,
            d.authorization_snapshot,
            d.active_at
       FROM products p
       LEFT JOIN product_market_price_drafts d
         ON d.product_id = p.id
        AND d.market_id = $1::uuid
      WHERE p.is_active = TRUE
      ORDER BY d.updated_at DESC NULLS LAST, p.updated_at DESC NULLS LAST, p.name ASC
      LIMIT 500`,
    [market.id]
  );
  return {
    market: { code: market.code, name: market.name, currency: market.currency },
    authority: {
      mode: 'LOCAL_MARKET_DECISION',
      buyer_effective: rows.some(row => row.decision_status === PRICE_STATUSES.ACTIVE),
      note: 'Le pays décide le prix. Le gate économique autorise séparément la décision ; seul LOCAL_ACTIVE signifie que les flux acheteur la consomment.',
    },
    products: rows.map(row => projectDecision(row, market)),
  };
}

async function getMarketPriceDecision(market, productRef, options = {}) {
  requireMarket(market);
  const executor = options.executor || db;
  const product = await resolveProduct(executor, productRef);
  const { rows } = await executor.query(
    `SELECT d.amount AS local_amount,
            d.currency,
            d.status AS decision_status,
            d.reason AS decision_reason,
            d.source AS decision_source,
            d.updated_at AS decided_at,
            d.authorized_at,
            d.authorization_snapshot,
            d.active_at
       FROM product_market_price_drafts d
      WHERE d.market_id = $1::uuid
        AND d.product_id = $2::uuid
      LIMIT 1`,
    [market.id, product.id]
  );
  if (!rows[0]) {
    throw new MarketCommercialPriceError(404, 'market_price_draft_not_found', 'Aucune décision locale pour ce produit.');
  }
  return {
    product,
    decision: projectDecision({
      ...rows[0],
      product_ref: product.product_ref,
      name: product.name,
      category: product.category,
      global_price_kmf: product.price_kmf,
    }, market),
  };
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

async function setMarketPriceDraft({ market, productRef, amount, reason, source, actorId }) {
  requireMarket(market);
  const localAmount = normalizeAmount(amount);
  const decisionReason = normalizeReason(reason);
  const decisionSource = normalizeSource(source);

  return withTransaction(async (client) => {
    const product = await resolveProduct(client, productRef);
    const { rows: existingRows } = await client.query(
      `SELECT amount, currency, status
         FROM product_market_price_drafts
        WHERE market_id = $1::uuid
          AND product_id = $2::uuid
        FOR UPDATE`,
      [market.id, product.id]
    );
    const existing = existingRows[0] || null;

    const { rows } = await client.query(
      `INSERT INTO product_market_price_drafts (
         market_id, product_id, amount, currency, status, reason, source, decided_by,
         authorized_at, authorization_snapshot, active_at
       ) VALUES ($1::uuid, $2::uuid, $3, $4, 'DRAFT_PENDING_GATE', $5, $6, $7::uuid, NULL, NULL, NULL)
       ON CONFLICT (market_id, product_id)
       DO UPDATE SET amount = EXCLUDED.amount,
                     currency = EXCLUDED.currency,
                     status = 'DRAFT_PENDING_GATE',
                     reason = EXCLUDED.reason,
                     source = EXCLUDED.source,
                     decided_by = EXCLUDED.decided_by,
                     authorized_at = NULL,
                     authorization_snapshot = NULL,
                     active_at = NULL,
                     updated_at = NOW()
       RETURNING amount, currency, status, reason, source, updated_at,
                 authorized_at, authorization_snapshot, active_at`,
      [market.id, product.id, localAmount, market.currency, decisionReason, decisionSource, actorId || null]
    );

    await client.query(
      `INSERT INTO product_market_price_draft_events (
         market_id, product_id, action, old_amount, new_amount, currency,
         old_status, new_status, decision_snapshot, reason, source, actor_id
       ) VALUES ($1::uuid, $2::uuid, 'SET', $3, $4, $5, $6, 'DRAFT_PENDING_GATE', NULL, $7, $8, $9::uuid)`,
      [
        market.id,
        product.id,
        existing ? existing.amount : null,
        localAmount,
        market.currency,
        existing ? existing.status : null,
        decisionReason,
        decisionSource,
        actorId || null,
      ]
    );

    return projectDecision({
      ...rows[0],
      product_ref: product.product_ref,
      name: product.name,
      category: product.category,
      global_price_kmf: product.price_kmf,
      decision_status: rows[0].status,
      decision_reason: rows[0].reason,
      decision_source: rows[0].source,
      decided_at: rows[0].updated_at,
      local_amount: rows[0].amount,
    }, market);
  });
}

async function authorizeMarketPriceDraft({ market, productRef, authorizationSnapshot, reason, source, actorId }) {
  requireMarket(market);
  const decisionReason = normalizeReason(reason);
  const decisionSource = normalizeSource(source || 'market_economic_gate');
  if (!authorizationSnapshot || typeof authorizationSnapshot !== 'object') {
    throw new MarketCommercialPriceError(400, 'market_price_authorization_snapshot_required', 'Preuve économique d’autorisation requise.');
  }

  return withTransaction(async (client) => {
    const product = await resolveProduct(client, productRef);
    const { rows: lockedRows } = await client.query(
      `SELECT amount, currency, status
         FROM product_market_price_drafts
        WHERE market_id = $1::uuid
          AND product_id = $2::uuid
        FOR UPDATE`,
      [market.id, product.id]
    );
    const current = lockedRows[0];
    if (!current) {
      throw new MarketCommercialPriceError(404, 'market_price_draft_not_found', 'Aucune décision locale à autoriser.');
    }
    if (current.status !== PRICE_STATUSES.DRAFT) {
      throw new MarketCommercialPriceError(409, 'market_price_not_pending_gate', 'La décision locale n’est plus en attente du gate.');
    }

    const { rows } = await client.query(
      `UPDATE product_market_price_drafts
          SET status = 'LOCAL_AUTHORIZED_PENDING_CUTOVER',
              authorized_at = NOW(),
              authorization_snapshot = $3::jsonb,
              decided_by = $4::uuid,
              updated_at = NOW()
        WHERE market_id = $1::uuid
          AND product_id = $2::uuid
      RETURNING amount, currency, status, reason, source, updated_at,
                authorized_at, authorization_snapshot, active_at`,
      [market.id, product.id, JSON.stringify(authorizationSnapshot), actorId || null]
    );

    await client.query(
      `INSERT INTO product_market_price_draft_events (
         market_id, product_id, action, old_amount, new_amount, currency,
         old_status, new_status, decision_snapshot, reason, source, actor_id
       ) VALUES ($1::uuid, $2::uuid, 'AUTHORIZE', $3, $3, $4,
                 $5, 'LOCAL_AUTHORIZED_PENDING_CUTOVER', $6::jsonb, $7, $8, $9::uuid)`,
      [
        market.id,
        product.id,
        current.amount,
        current.currency,
        current.status,
        JSON.stringify(authorizationSnapshot),
        decisionReason,
        decisionSource,
        actorId || null,
      ]
    );

    return projectDecision({
      ...rows[0],
      product_ref: product.product_ref,
      name: product.name,
      category: product.category,
      global_price_kmf: product.price_kmf,
      decision_status: rows[0].status,
      decision_reason: rows[0].reason,
      decision_source: rows[0].source,
      decided_at: rows[0].updated_at,
      local_amount: rows[0].amount,
    }, market);
  });
}

async function resetMarketPriceDraft({ market, productRef, reason, source, actorId }) {
  requireMarket(market);
  const decisionReason = normalizeReason(reason);
  const decisionSource = normalizeSource(source);

  return withTransaction(async (client) => {
    const product = await resolveProduct(client, productRef);
    const { rows } = await client.query(
      `DELETE FROM product_market_price_drafts
        WHERE market_id = $1::uuid
          AND product_id = $2::uuid
        RETURNING amount, currency, status, authorization_snapshot`,
      [market.id, product.id]
    );
    const previous = rows[0] || null;
    if (!previous) {
      throw new MarketCommercialPriceError(404, 'market_price_draft_not_found', 'Aucune décision locale à réinitialiser pour ce produit.');
    }

    await client.query(
      `INSERT INTO product_market_price_draft_events (
         market_id, product_id, action, old_amount, new_amount, currency,
         old_status, new_status, decision_snapshot, reason, source, actor_id
       ) VALUES ($1::uuid, $2::uuid, 'RESET', $3, NULL, $4, $5, NULL, $6::jsonb, $7, $8, $9::uuid)`,
      [
        market.id,
        product.id,
        previous.amount,
        previous.currency,
        previous.status,
        previous.authorization_snapshot == null ? null : JSON.stringify(previous.authorization_snapshot),
        decisionReason,
        decisionSource,
        actorId || null,
      ]
    );

    return {
      product_ref: product.product_ref,
      market_code: market.code,
      currency: market.currency,
      previous_local_price: Number(previous.amount),
      previous_status: previous.status,
      decision_status: 'RESET_TO_GLOBAL_BASE',
      buyer_effective: false,
    };
  });
}

module.exports = {
  PRICE_STATUSES,
  MarketCommercialPriceError,
  normalizeAmount,
  normalizeReason,
  listMarketPriceDrafts,
  getMarketPriceDecision,
  setMarketPriceDraft,
  authorizeMarketPriceDraft,
  resetMarketPriceDraft,
};
