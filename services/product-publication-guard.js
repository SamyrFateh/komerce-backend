/**
 * @komerce-arch
 * @role          catalog-product-publication-guard
 * @domain        catalog
 * @layer         service
 * @criticality   high
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       @unknown
 * @used-by       @unknown
 * @db-read       @unknown
 * @db-write      @unknown
 * @db-txn        resolve_before_behavior_change
 * @doctrine      resolve_before_behavior_change
 * @impact-areas  catalog, product-discovery
 * @version       2026-06
 */

'use strict';

/**
 * I-SWEEP-6C — Doctrine publication catalogue + audit stock minimal.
 *
 * Sans migration DB : les mouvements de stock catalogue sont tracés dans
 * `alerts` avec une source dédiée. La publication est refusée si prix/stock
 * incohérents.
 */

const db = require('../db');
const log = require('../utils/logger').child({ module: 'product-publication-guard' });

async function auditProductStockChange(q = db, {
  productId,
  oldStock,
  newStock,
  actor = null,
  source = 'product_update',
  note = null,
} = {}) {
  if (!productId) return { skipped: true, reason: 'missing_product_id' };

  const oldValue = oldStock === null || oldStock === undefined ? null : Number(oldStock);
  const newValue = newStock === null || newStock === undefined ? null : Number(newStock);

  if (oldValue === newValue) return { skipped: true, reason: 'unchanged' };

  try {
    await q.query(
      `INSERT INTO alerts (level, source, message, payload)
       VALUES ('info', 'product_stock_audit', $1, $2)`,
      [
        `Stock catalogue modifié pour produit ${productId}`,
        JSON.stringify({
          product_id: productId,
          old_stock: oldValue,
          new_stock: newValue,
          actor,
          source,
          note,
          delta: oldValue === null || newValue === null ? null : newValue - oldValue,
        }),
      ]
    );
    return { inserted: true };
  } catch (err) {
    log.warn({ err }, '[product-publication-guard] stock audit skipped:');
    return { skipped: true, reason: err.message };
  }
}

function validatePublicationUpdate({ before, patch }) {
  const wantsActive = patch.is_active !== undefined ? patch.is_active : before.is_active;
  const wantsAvailable = patch.is_available !== undefined ? patch.is_available : before.is_available;

  if (!wantsActive && !wantsAvailable) {
    return { ok: true };
  }

  const priceKmf = patch.price_kmf !== undefined ? Number(patch.price_kmf) : Number(before.price_kmf || 0);
  const stock = patch.stock !== undefined ? patch.stock : before.stock;
  const name = patch.name !== undefined ? patch.name : before.name;
  const category = patch.category !== undefined ? patch.category : before.category;

  if (!name || String(name).trim().length < 2) {
    return { ok: false, code: 'missing_name', error: 'Publication refusée : nom produit manquant' };
  }
  if (!category || String(category).trim().length < 2) {
    return { ok: false, code: 'missing_category', error: 'Publication refusée : catégorie produit manquante' };
  }
  if (!Number.isFinite(priceKmf) || priceKmf <= 0) {
    return { ok: false, code: 'invalid_price', error: 'Publication refusée : price_kmf doit être strictement positif' };
  }
  if (stock !== null && stock !== undefined) {
    const stockNumber = Number(stock);
    if (!Number.isFinite(stockNumber) || stockNumber < 0) {
      return { ok: false, code: 'invalid_stock', error: 'Publication refusée : stock doit être positif, nul ou null' };
    }
  }

  return { ok: true };
}

module.exports = { auditProductStockChange, validatePublicationUpdate };
