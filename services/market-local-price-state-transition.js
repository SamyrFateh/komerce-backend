/**
 * @komerce-arch
 * @role          market-local-price-active-state-transition
 * @domain        market-autonomy
 * @layer         service
 * @criticality   critical
 * @inputs        server_resolved_market, product_ref, activation_snapshot, actor_id
 * @outputs       LOCAL_ACTIVE_decision
 * @depends       db.js, services/market-commercial-price-service.js
 * @used-by       services/market-local-price-activation-service.js
 * @db-read       products, product_market_price_drafts
 * @db-write      product_market_price_drafts, product_market_price_draft_events
 * @db-txn        owned
 * @doctrine      activation_only_from_authorized_state, activation_is_audited, amount_and_currency_are_frozen_across_cutover
 * @impact-areas  market, pricing, checkout, catalog
 * @version       2026-09
 */

'use strict';

const db = require('../db');
const {
  PRICE_STATUSES,
  MarketCommercialPriceError,
  normalizeReason,
} = require('./market-commercial-price-service');

function normalizeSource(value) {
  const source = String(value || 'market_manager_activation').trim().slice(0, 80);
  return source || 'market_manager_activation';
}

async function activateMarketPriceDecision({ market, productRef, activationSnapshot, reason, source, actorId }) {
  if (!market?.id || !market?.code || !market?.currency) {
    throw new MarketCommercialPriceError(400, 'market_price_market_required', 'Marché résolu côté serveur requis.');
  }
  if (!actorId) {
    throw new MarketCommercialPriceError(400, 'market_price_actor_required', 'Acteur requis pour l’activation.');
  }
  if (!activationSnapshot || typeof activationSnapshot !== 'object') {
    throw new MarketCommercialPriceError(400, 'market_price_activation_snapshot_required', 'Preuve d’activation requise.');
  }

  const decisionReason = normalizeReason(reason || 'Activation acheteur après gate économique');
  const decisionSource = normalizeSource(source);
  const client = await db.getClient();

  try {
    await client.query('BEGIN');
    const { rows: productRows } = await client.query(
      `SELECT id, product_ref, name, category, price_kmf, is_active
         FROM products
        WHERE product_ref = $1
        LIMIT 1`,
      [String(productRef || '').trim()]
    );
    const product = productRows[0];
    if (!product || !product.is_active) {
      throw new MarketCommercialPriceError(404, 'market_price_product_not_found', 'Produit actif introuvable.');
    }

    const { rows: decisionRows } = await client.query(
      `SELECT amount, currency, status, authorization_snapshot
         FROM product_market_price_drafts
        WHERE market_id = $1::uuid AND product_id = $2::uuid
        FOR UPDATE`,
      [market.id, product.id]
    );
    const current = decisionRows[0];
    if (!current) {
      throw new MarketCommercialPriceError(404, 'market_price_draft_not_found', 'Aucune décision locale à activer.');
    }
    if (current.status === PRICE_STATUSES.ACTIVE) {
      await client.query('COMMIT');
      return {
        product_ref: product.product_ref,
        market_code: market.code,
        currency: current.currency,
        local_price: Number(current.amount),
        decision_status: current.status,
        buyer_effective: true,
        already_active: true,
      };
    }
    if (current.status !== PRICE_STATUSES.AUTHORIZED) {
      throw new MarketCommercialPriceError(409, 'market_price_not_authorized', 'Le prix local doit être autorisé économiquement avant activation.');
    }

    const snapshotAmount = Number(activationSnapshot.local_price);
    const snapshotCurrency = String(activationSnapshot.currency || '');
    if (!Number.isFinite(snapshotAmount) || snapshotAmount !== Number(current.amount) || snapshotCurrency !== current.currency) {
      throw new MarketCommercialPriceError(409, 'market_price_activation_snapshot_stale', 'La preuve d’activation ne correspond plus à la décision locale courante.');
    }
    if (activationSnapshot.activation_allowed !== true) {
      throw new MarketCommercialPriceError(409, 'market_price_activation_not_allowed', 'La preuve économique n’autorise pas l’activation.');
    }

    const { rows: updatedRows } = await client.query(
      `UPDATE product_market_price_drafts
          SET status = 'LOCAL_ACTIVE', active_at = NOW(), decided_by = $3::uuid, updated_at = NOW()
        WHERE market_id = $1::uuid AND product_id = $2::uuid
      RETURNING amount, currency, status, reason, source, updated_at,
                authorized_at, authorization_snapshot, active_at`,
      [market.id, product.id, actorId]
    );
    const updated = updatedRows[0];

    await client.query(
      `INSERT INTO product_market_price_draft_events (
         market_id, product_id, action, old_amount, new_amount, currency,
         old_status, new_status, decision_snapshot, reason, source, actor_id
       ) VALUES ($1::uuid, $2::uuid, 'ACTIVATE', $3, $3, $4,
                 $5, 'LOCAL_ACTIVE', $6::jsonb, $7, $8, $9::uuid)`,
      [market.id, product.id, current.amount, current.currency, current.status,
        JSON.stringify(activationSnapshot), decisionReason, decisionSource, actorId]
    );

    await client.query('COMMIT');
    return {
      product_ref: product.product_ref,
      name: product.name,
      category: product.category,
      global_price_kmf: Number(product.price_kmf) || 0,
      market_code: market.code,
      currency: updated.currency,
      local_price: Number(updated.amount),
      decision_status: updated.status,
      authorized_at: updated.authorized_at,
      active_at: updated.active_at,
      authorization_snapshot: updated.authorization_snapshot,
      buyer_effective: updated.status === PRICE_STATUSES.ACTIVE,
      already_active: false,
    };
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch (_) { /* preserve original */ }
    throw error;
  } finally {
    if (typeof client.release === 'function') client.release();
  }
}

module.exports = { activateMarketPriceDecision };
