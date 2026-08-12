/**
 * @komerce-arch
 * @role          catalog-product-publication-guard
 * @domain        catalog
 * @layer         service
 * @criticality   high
 * @inputs        before_product_row, patch_payload
 * @outputs       validation_result, side_effects
 * @depends       db.js
 * @used-by       services/product-admin-service.js, services/catalog-approval.js
 * @db-read       none
 * @db-write      alerts
 * @db-txn        resolve_before_behavior_change
 * @doctrine      docs/doctrine/DOCTRINE_CATALOGUE.md
 * @impact-areas  catalog, product-discovery
 * @version       2026-08
 */

'use strict';

/**
 * I-SWEEP-6C — Doctrine publication catalogue + audit stock minimal.
 *
 * Sans migration DB : les mouvements de stock catalogue sont tracés dans
 * `alerts` avec une source dédiée. La publication est refusée si prix/stock
 * incohérents.
 *
 * Invariants éditoriaux de première publication :
 * - une donnée source étrangère ne devient jamais une fiche client brute ;
 * - le titre client reste court et débarrassé du bruit de provenance ;
 * - la source brute reste un fait de traçabilité, jamais une présentation.
 */

const db = require('../db');
const { createAlert } = require('../utils/alerts');
const log = require('../utils/logger').child({ module: 'product-publication-guard' });

const CLIENT_TITLE_MAX_LENGTH = 80;
const SOURCE_FILE_PATTERN = /(?:^|\s)file\s*:|\.(?:jpe?g|png|webp|gif|tiff?)(?:\s|$)/i;
const URL_PATTERN = /https?:\/\/|www\./i;

function isFrenchLocale(locale) {
  const value = String(locale || '').trim().toLowerCase().replace('_', '-');
  return value === 'fr' || value.startsWith('fr-');
}

function editorialTitleError(name) {
  const title = String(name || '').replace(/\s+/g, ' ').trim();
  if (title.length > CLIENT_TITLE_MAX_LENGTH) {
    return { code: 'title_too_long', error: `Publication refusée : titre client limité à ${CLIENT_TITLE_MAX_LENGTH} caractères` };
  }
  if (URL_PATTERN.test(title) || SOURCE_FILE_PATTERN.test(title)) {
    return { code: 'title_source_noise', error: 'Publication refusée : le titre client contient du bruit de source ou un nom de fichier' };
  }
  const acronymTokens = title.match(/\b[A-Z][A-Z0-9]{1,8}\b/g) || [];
  if (acronymTokens.length >= 4) {
    return { code: 'title_source_noise', error: 'Publication refusée : le titre client ressemble à des métadonnées de source' };
  }
  return null;
}

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

  // `q` peut être le pool OU un client transactionnel imbriqué dans l'appel
  // de product-admin-service.js / catalog-approval.js. SAVEPOINT best-effort
  // pour ne jamais empoisonner une transaction appelante si `q` en a une.
  let savepointActive = false;
  try {
    await q.query('SAVEPOINT product_stock_audit');
    savepointActive = true;
  } catch (_e) { /* q hors transaction (pool) */ }

  try {
    const row = await createAlert(q, {
      type: 'product_stock_audit',
      entityType: 'product',
      entityId: productId,
      severity: 'low',
      title: `Stock catalogue modifié pour produit ${productId}`,
      description: `old_stock=${oldValue} new_stock=${newValue} delta=${
        oldValue === null || newValue === null ? 'n/a' : newValue - oldValue
      } source=${source} actor=${JSON.stringify(actor)}${note ? ` note=${note}` : ''}`,
    });
    if (savepointActive) await q.query('RELEASE SAVEPOINT product_stock_audit').catch(() => {});
    return { inserted: true, alert_id: row.id };
  } catch (err) {
    if (savepointActive) await q.query('ROLLBACK TO SAVEPOINT product_stock_audit').catch(() => {});
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

  const firstActivation = wantsActive && before.is_active !== true;
  if (firstActivation) {
    const contentSource = patch.content_source !== undefined ? patch.content_source : before.content_source;
    const sourceLocale = patch.source_locale !== undefined ? patch.source_locale : before.source_locale;
    if (contentSource === 'connector_raw' && sourceLocale && !isFrenchLocale(sourceLocale)) {
      return {
        ok: false,
        code: 'enrichment_required',
        error: `Publication refusée : une source ${sourceLocale} doit être enrichie en français avant activation`,
      };
    }

    const editorialError = editorialTitleError(name);
    if (editorialError) return { ok: false, ...editorialError };
  }

  return { ok: true };
}

module.exports = {
  CLIENT_TITLE_MAX_LENGTH,
  auditProductStockChange,
  validatePublicationUpdate,
  _isFrenchLocale: isFrenchLocale,
  _editorialTitleError: editorialTitleError,
};
