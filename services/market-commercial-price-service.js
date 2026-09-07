/**
 * @komerce-arch
 * @role          market-commercial-price-draft-owner
 * @domain        market-autonomy
 * @layer         service
 * @criticality   high
 * @inputs        server_resolved_market, product_ref, local_amount, reason, actor_id
 * @outputs       market_price_draft_projection, audited_set_reset_results
 * @depends       db.js
 * @used-by       routes/admin-pricing-workspace.js
 * @db-read       products, product_market_price_drafts
 * @db-write      product_market_price_drafts, product_market_price_draft_events
 * @db-txn        owned
 * @doctrine      country_strategy_is_local, global_catalog_price_untouched, local_currency_from_server_market, draft_until_gate_authority
 * @impact-areas  pricing, market, admin-dashboard
 * @version       2026-09
 */

'use strict';

const db = require('../db');

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

function projectRow(row, market) {
  return {
    product_ref: row.product_ref,
    name: row.name,
    category: row.category,
    global_price_kmf: Number(row.global_price_kmf) || 0,
    local_price: row.local_amount == null ? null : Number(row.local_amount),
    currency: market.currency,
    market_code: market.code,
    decision_status: row.decision_status || null,
    decision_reason: row.decision_reason || null,
    decision_source: row.decision_source || null,
    decided_at: row.decided_at || null,
    commercial_mode: row.local_amount == null ? 'GLOBAL_BASE_NO_LOCAL_DECISION' : 'LOCAL_DRAFT_PENDING_GATE',
    buyer_effective: false,
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
            d.updated_at AS decided_at
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
    market: {
      code: market.code,
      name: market.name,
      currency: market.currency,
    },
    authority: {
      mode: 'LOCAL_DRAFT_PENDING_GATE',
      buyer_effective: false,
      note: 'Le responsable pays décide le prix local ; cette première tranche le conserve comme brouillon jusqu’au branchement du gate d’activation.',
    },
    products: rows.map(row => projectRow(row, market)),
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
      `SELECT amount, currency
         FROM product_market_price_drafts
        WHERE market_id = $1::uuid
          AND product_id = $2::uuid
        FOR UPDATE`,
      [market.id, product.id]
    );
    const existing = existingRows[0] || null;

    const { rows } = await client.query(
      `INSERT INTO product_market_price_drafts (
         market_id, product_id, amount, currency, status, reason, source, decided_by
       ) VALUES ($1::uuid, $2::uuid, $3, $4, 'DRAFT_PENDING_GATE', $5, $6, $7::uuid)
       ON CONFLICT (market_id, product_id)
       DO UPDATE SET amount = EXCLUDED.amount,
                     currency = EXCLUDED.currency,
                     status = 'DRAFT_PENDING_GATE',
                     reason = EXCLUDED.reason,
                     source = EXCLUDED.source,
                     decided_by = EXCLUDED.decided_by,
                     updated_at = NOW()
       RETURNING amount, currency, status, reason, source, updated_at`,
      [market.id, product.id, localAmount, market.currency, decisionReason, decisionSource, actorId || null]
    );

    await client.query(
      `INSERT INTO product_market_price_draft_events (
         market_id, product_id, action, old_amount, new_amount, currency, reason, source, actor_id
       ) VALUES ($1::uuid, $2::uuid, 'SET', $3, $4, $5, $6, $7, $8::uuid)`,
      [
        market.id,
        product.id,
        existing ? existing.amount : null,
        localAmount,
        market.currency,
        decisionReason,
        decisionSource,
        actorId || null,
      ]
    );

    const draft = rows[0];
    return {
      product_ref: product.product_ref,
      market_code: market.code,
      global_price_kmf: Number(product.price_kmf) || 0,
      local_price: Number(draft.amount),
      currency: draft.currency,
      decision_status: draft.status,
      reason: draft.reason,
      source: draft.source,
      decided_at: draft.updated_at,
      buyer_effective: false,
    };
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
        RETURNING amount, currency`,
      [market.id, product.id]
    );
    const previous = rows[0] || null;
    if (!previous) {
      throw new MarketCommercialPriceError(404, 'market_price_draft_not_found', 'Aucune décision locale à réinitialiser pour ce produit.');
    }

    await client.query(
      `INSERT INTO product_market_price_draft_events (
         market_id, product_id, action, old_amount, new_amount, currency, reason, source, actor_id
       ) VALUES ($1::uuid, $2::uuid, 'RESET', $3, NULL, $4, $5, $6, $7::uuid)`,
      [market.id, product.id, previous.amount, market.currency, decisionReason, decisionSource, actorId || null]
    );

    return {
      product_ref: product.product_ref,
      market_code: market.code,
      currency: market.currency,
      previous_local_price: Number(previous.amount),
      decision_status: 'RESET_TO_GLOBAL_BASE',
      buyer_effective: false,
    };
  });
}

module.exports = {
  MarketCommercialPriceError,
  normalizeAmount,
  normalizeReason,
  listMarketPriceDrafts,
  setMarketPriceDraft,
  resetMarketPriceDraft,
};