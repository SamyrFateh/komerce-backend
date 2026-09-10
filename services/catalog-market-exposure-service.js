/**
 * @komerce-arch
 * @role          catalog-market-exposure-service
 * @domain        catalog
 * @layer         service
 * @criticality   high
 * @inputs        product_id, market_id, exposure decision
 * @outputs       product_market_exposure read model
 * @depends       none (executor fourni par l'appelant, défaut : pool module)
 * @used-by       services/market-delegation-catalog-service.js, services/catalog-public-view.js
 * @db-read       product_market_exposure, products, markets
 * @db-write      product_market_exposure
 * @db-txn        caller_transaction_preserved
 * @doctrine      writer_not_owner_boundary, catalog_stays_unique_exposure_is_projection
 * @impact-areas  catalog, market-delegation
 * @version       2026-09
 */
'use strict';

const db = require('../db');

const EXPOSURE = Object.freeze({ ENABLED: 'ENABLED', DISABLED: 'DISABLED' });

function requireExecutor(executor) {
  if (!executor || typeof executor.query !== 'function') {
    throw new TypeError('catalog-market-exposure-service: executor.query requis');
  }
  return executor;
}

/**
 * Lit l'exposition d'un produit sur un marché. Absence de ligne = DISABLED
 * (fail-closed) — jamais un défaut implicite ENABLED.
 *
 * @param {string} productId
 * @param {string} marketId
 * @param {object} [executor]
 * @returns {Promise<'ENABLED'|'DISABLED'>}
 */
async function getExposure(productId, marketId, executor = db) {
  const { rows } = await executor.query(
    'SELECT commercial_exposure FROM product_market_exposure WHERE product_id = $1 AND market_id = $2',
    [productId, marketId]
  );
  return rows[0]?.commercial_exposure ?? EXPOSURE.DISABLED;
}

/**
 * Liste l'exposition de tous les produits déjà décidés pour un marché
 * (les produits sans ligne restent implicitement DISABLED, non listés ici —
 * l'appelant les traite comme absents/non exposés).
 *
 * @param {string} marketId
 * @param {object} [executor]
 * @returns {Promise<object[]>}
 */
async function listExposureForMarket(marketId, executor = db) {
  const { rows } = await executor.query(
    `SELECT pme.product_id, pme.commercial_exposure, pme.decided_at, p.name AS product_name, p.sku
       FROM product_market_exposure pme
       JOIN products p ON p.id = pme.product_id
      WHERE pme.market_id = $1
      ORDER BY p.name`,
    [marketId]
  );
  return rows;
}

/**
 * Vérifie que le produit existe (le catalogue est global — aucune notion de
 * "produit introuvable sur ce marché", seulement "produit introuvable").
 *
 * @param {string} productId
 * @param {object} [executor]
 * @returns {Promise<boolean>}
 */
async function productExists(productId, executor = db) {
  const { rows } = await executor.query('SELECT 1 FROM products WHERE id = $1', [productId]);
  return rows.length > 0;
}

/**
 * Décide (ou change) l'exposition d'un produit sur un marché. Upsert —
 * une ligne par (product_id, market_id), jamais de doublon, jamais d'historique
 * séparé ici (l'audit de la décision appartient à l'appelant, market-delegation).
 *
 * @param {string} productId
 * @param {string} marketId
 * @param {'ENABLED'|'DISABLED'} exposure
 * @param {string} decidedBy
 * @param {object} [executor]
 * @returns {Promise<object>}
 */
async function setExposure(productId, marketId, exposure, decidedBy, executor = db) {
  requireExecutor(executor);
  if (!EXPOSURE[exposure]) {
    throw new Error(`setExposure: exposition invalide (${exposure})`);
  }
  const exists = await productExists(productId, executor);
  if (!exists) throw new Error(`setExposure: produit introuvable (${productId})`);

  const { rows } = await executor.query(
    `INSERT INTO product_market_exposure (product_id, market_id, commercial_exposure, decided_by, decided_at, updated_at)
     VALUES ($1, $2, $3, $4, now(), now())
     ON CONFLICT (product_id, market_id)
     DO UPDATE SET commercial_exposure = EXCLUDED.commercial_exposure,
                   decided_by = EXCLUDED.decided_by,
                   decided_at = now(),
                   updated_at = now()
     RETURNING id, product_id, market_id, commercial_exposure, decided_by, decided_at`,
    [productId, marketId, exposure, decidedBy]
  );
  return rows[0];
}

/**
 * Vérifie qu'un produit est exposé (ENABLED) sur un marché donné, résolu par
 * code (ex. 'CM') plutôt que par market_id UUID — évite un aller-retour de
 * résolution séparé pour les appelants qui n'ont que le code, comme
 * routes/catalog-product-detail.js.
 *
 * @param {string} productId
 * @param {string} marketCode
 * @param {object} [executor]
 * @returns {Promise<boolean>}
 */
async function isProductExposedForMarketCode(productId, marketCode, executor = db) {
  const { rows } = await executor.query(
    `SELECT 1
       FROM product_market_exposure pme
       JOIN markets m ON m.id = pme.market_id
      WHERE pme.product_id = $1
        AND m.code = $2
        AND pme.commercial_exposure = 'ENABLED'
      LIMIT 1`,
    [productId, marketCode]
  );
  return rows.length > 0;
}

module.exports = {
  EXPOSURE,
  getExposure,
  listExposureForMarket,
  productExists,
  setExposure,
  isProductExposedForMarketCode,
};
