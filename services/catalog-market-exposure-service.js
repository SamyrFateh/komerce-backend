/**
 * @komerce-arch
 * @role          catalog-market-exposure-service
 * @domain        catalog
 * @layer         service
 * @criticality   high
 * @inputs        product_id, market_id, exposure decision
 * @outputs       product_market_exposure read model
 * @depends       services/product-publication-guard.js
 * @used-by       services/market-delegation-catalog-service.js, services/catalog-public-view.js
 * @db-read       product_market_exposure, products, markets, catalog_media
 * @db-write      product_market_exposure
 * @db-txn        caller_transaction_preserved
 * @doctrine      writer_not_owner_boundary, catalog_stays_unique_exposure_is_projection, missing_exposure_is_disabled
 * @impact-areas  catalog, market-delegation
 * @version       2026-09
 */
'use strict';

const db = require('../db');
const { validatePublicationUpdate } = require('./product-publication-guard');

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
 * Projette tous les produits actifs du catalogue global dans le contexte d'un
 * marché. Une absence de décision explicite reste DISABLED (fail-closed), mais
 * elle est désormais visible dans le read-model afin que le Responsable pays
 * puisse prendre une décision d'exposition sans qu'une ligne pme préexiste.
 *
 * Important : cette lecture ne crée aucune ligne product_market_exposure et ne
 * modifie jamais le catalogue global. `decision_recorded=false` distingue le
 * défaut fail-closed d'un masquage explicitement décidé.
 *
 * @param {string} marketId
 * @param {object} [executor]
 * @returns {Promise<object[]>}
 */
async function listExposureForMarket(marketId, executor = db) {
  const { rows } = await executor.query(
    `SELECT p.id AS product_id,
            p.product_ref,
            p.name AS product_name,
            p.sku,
            p.category,
            p.subcategory,
            p.image_url,
            p.is_available,
            p.needs_review,
            COALESCE(pme.commercial_exposure, 'DISABLED') AS commercial_exposure,
            pme.decided_at,
            (pme.product_id IS NOT NULL) AS decision_recorded
       FROM products p
       LEFT JOIN product_market_exposure pme
         ON pme.product_id = p.id
        AND pme.market_id = $1
      WHERE p.is_active = TRUE
      ORDER BY p.name, p.product_ref`,
    [marketId]
  );
  return rows;
}


/**
 * File simple des produits prêts à être décidés par un marché.
 *
 * La complexité de Raffinerie reste côté serveur : seuls les candidats déjà
 * préparés en français et qui passeraient le guard de première publication
 * sont proposés au Responsable pays. Une décision déjà enregistrée pour ce
 * marché retire le produit de cette file.
 *
 * @param {string} marketId
 * @param {object} [executor]
 * @param {object} [options]
 * @returns {Promise<{total:number,items:object[]}>}
 */
async function listReviewCandidatesForMarket(marketId, executor = db, { limit = 100 } = {}) {
  const safeLimit = Math.min(Math.max(Number(limit) || 100, 1), 200);
  const { rows } = await executor.query(
    `SELECT p.*,
            (
              SELECT COUNT(*)::int
                FROM catalog_media cm
               WHERE cm.product_id = p.id
                 AND cm.is_active = TRUE
            ) AS active_media
       FROM products p
       LEFT JOIN product_market_exposure pme
         ON pme.product_id = p.id
        AND pme.market_id = $1
      WHERE p.lifecycle_status = 'candidate'
        AND p.is_active = FALSE
        AND p.content_source = 'manual'
        AND p.needs_review = FALSE
        AND pme.product_id IS NULL
      ORDER BY p.updated_at DESC NULLS LAST, p.created_at DESC`,
    [marketId]
  );

  const ready = rows.filter(row => validatePublicationUpdate({
    before: row,
    patch: { is_active: true },
    context: { catalogMediaCount: Number(row.active_media || 0) },
  }).ok);

  return {
    total: ready.length,
    items: ready.slice(0, safeLimit).map(row => ({
      product_id: row.id,
      product_ref: row.product_ref,
      product_name: row.name,
      description: row.description || null,
      sku: row.sku || null,
      category: row.category || null,
      subcategory: row.subcategory || null,
      image_url: row.image_url || null,
      price_kmf: row.price_kmf == null ? null : Number(row.price_kmf),
      stock: row.stock == null ? null : Number(row.stock),
      is_available: Boolean(row.is_available),
      media_count: Number(row.active_media || 0),
      updated_at: row.updated_at || null,
    })),
  };
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
  listReviewCandidatesForMarket,
  productExists,
  setExposure,
  isProductExposedForMarketCode,
};
