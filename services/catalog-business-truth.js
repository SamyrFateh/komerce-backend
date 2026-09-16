/**
 * @komerce-arch
 * @role          catalog-business-truth-projection
 * @domain        catalog
 * @layer         service
 * @criticality   high
 * @inputs        sourcing_candidates, catalog_products, active_markets
 * @outputs       sourced_ready_published_visible_business_projection
 * @depends       db.js, services/product-publication-guard.js, services/catalog-public-view.js
 * @used-by       services/catalog-workspace-live-composer.js
 * @db-read       sourcing_candidates, products, catalog_media, markets, product_market_exposure, product_market_price_drafts, product_skus, product_variants
 * @db-write      none
 * @db-txn        none
 * @doctrine      dashboard_exposes_business_truth_not_backend_states, visible_means_sellable
 * @impact-areas  catalog, boutique, admin-dashboard
 * @version       2026-09
 */
'use strict';

const db = require('../db');
const { validatePublicationUpdate } = require('./product-publication-guard');
const { publicCatalogVisibilitySql } = require('./catalog-public-view');

function number(value) {
  return Number(value) || 0;
}

async function querySourcedCount(executor = db) {
  const { rows: [row] } = await executor.query(`
    SELECT COUNT(DISTINCT COALESCE(sc.product_id::text, sc.candidate_ref))::int AS count
      FROM sourcing_candidates sc
     WHERE sc.state NOT IN ('rejected', 'archived')
  `);
  return number(row?.count);
}

async function queryReadyToPublish(executor = db) {
  const { rows } = await executor.query(`
    SELECT p.*,
           COUNT(cm.id) FILTER (WHERE cm.is_active = TRUE)::int AS catalog_media_count
      FROM products p
      LEFT JOIN catalog_media cm ON cm.product_id = p.id
     WHERE p.lifecycle_status = 'candidate'
       AND p.is_active = FALSE
     GROUP BY p.id
  `);

  return rows.reduce((count, product) => {
    const check = validatePublicationUpdate({
      before: product,
      patch: { is_active: true },
      context: { catalogMediaCount: number(product.catalog_media_count) },
    });
    return count + (check.ok ? 1 : 0);
  }, 0);
}

async function queryPublishedCount(executor = db) {
  const { rows: [row] } = await executor.query(`
    SELECT COUNT(*)::int AS count
      FROM products
     WHERE is_active = TRUE
  `);
  return number(row?.count);
}

async function queryMarketVisibility(executor = db) {
  const { rows: markets } = await executor.query(`
    SELECT id, code, name, currency
      FROM markets
     WHERE is_active = TRUE
     ORDER BY name ASC, code ASC
  `);

  const visibleSql = publicCatalogVisibilitySql('p', { marketCodeParamIndex: 1 });
  const result = [];
  for (const market of markets) {
    const { rows: [row] } = await executor.query(
      `SELECT COUNT(*)::int AS count FROM products p WHERE ${visibleSql}`,
      [market.code]
    );
    result.push({
      market_id: market.id,
      market_code: market.code,
      market_name: market.name,
      currency: market.currency,
      visible: number(row?.count),
    });
  }
  return result;
}

async function buildProjection({ executor = db } = {}) {
  const [sourced, readyToPublish, published, markets] = await Promise.all([
    querySourcedCount(executor),
    queryReadyToPublish(executor),
    queryPublishedCount(executor),
    queryMarketVisibility(executor),
  ]);

  return {
    mode: 'business_truth',
    stages: {
      sourced,
      ready_to_publish: readyToPublish,
      published,
    },
    markets,
    vocabulary: {
      sourced: 'Sourcé',
      ready_to_publish: 'Prêt à publier',
      published: 'Publié',
      visible: 'Visible',
    },
    semantics: {
      visible: 'Passe exactement le prédicat de la boutique pour ce marché et possède au moins une unité vendable.',
      checkout: 'Le checkout revalide ensuite dynamiquement stock, prix, fret et fournisseur avant paiement.',
    },
  };
}

module.exports = {
  buildProjection,
  _test: {
    querySourcedCount,
    queryReadyToPublish,
    queryPublishedCount,
    queryMarketVisibility,
  },
};