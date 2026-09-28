/**
 * @komerce-arch
 * @role          catalog-run-progress-projection
 * @domain        catalog
 * @layer         service
 * @criticality   medium
 * @inputs        promoted_product_refs
 * @outputs       run_catalog_progress, run_market_visibility
 * @depends       db.js, services/product-publication-guard.js, services/catalog-public-view.js
 * @used-by       services/import-runtime-runs.js
 * @db-read       products, catalog_media, markets, product_market_exposure, product_market_price_drafts, product_skus, product_variants
 * @db-write      none
 * @db-txn        none
 * @doctrine      dashboard_observes_server_truth, catalog_stays_unique_exposure_is_projection, visible_means_sellable
 * @impact-areas  catalog, sourcing, admin-dashboard
 * @version       2026-09
 */
'use strict';

const db = require('../db');
const { validatePublicationUpdate } = require('./product-publication-guard');
const { publicCatalogVisibilitySql } = require('./catalog-public-view');

function productProgress(product) {
  if (product.is_active === true) return { stage: 'published', reason: null };
  if (product.lifecycle_status !== 'candidate') {
    return { stage: 'other', reason: 'Produit hors préparation Catalogue' };
  }
  // Same editorial prerequisites as the market review queue. Readiness is
  // informational: publication still revalidates its guards and catalog cap.
  if (product.content_source !== 'manual' || product.needs_review !== false) {
    return { stage: 'preparing', reason: 'Préparer et revoir la fiche française' };
  }
  const check = validatePublicationUpdate({
    before: product,
    patch: { is_active: true },
    context: { catalogMediaCount: Number(product.active_media) },
  });
  return check.ok
    ? { stage: 'ready', reason: null }
    : { stage: 'preparing', reason: check.error };
}

async function readRunProgress(productRefs, executor = db) {
  const refs = [...new Set(productRefs)];
  const { rows: products } = await executor.query(`
    SELECT p.*,
           (SELECT COUNT(*)::int FROM catalog_media cm
             WHERE cm.product_id = p.id AND cm.is_active = TRUE) AS active_media
      FROM products p
     WHERE p.product_ref = ANY($1::text[])
     ORDER BY p.product_ref`, [refs]);
  const items = products.map(product => ({
    product_ref: product.product_ref,
    name: product.name,
    ...productProgress(product),
  }));
  const count = stage => items.filter(item => item.stage === stage).length;
  const catalog = {
    received: items.length,
    preparing: count('preparing'), ready: count('ready'),
    published: count('published'), other: count('other'),
    missing: refs.length - items.length,
  };
  const { rows: activeMarkets } = await executor.query(
    'SELECT code, name FROM markets WHERE is_active = TRUE ORDER BY name, code'
  );
  const markets = [];
  const exposed = new Set();
  const visible = new Set();
  const readyRefs = items.filter(item => item.stage === 'ready').map(item => item.product_ref);
  const publishedRefs = items.filter(item => item.stage === 'published').map(item => item.product_ref);
  let awaitingValidationDecisions = 0;
  let publishedUndecidedDecisions = 0;
  for (const market of activeMarkets) {
    const { rows: [counts] } = await executor.query(`
      SELECT COUNT(*) FILTER (WHERE pme.product_id IS NULL
               AND p.product_ref = ANY($3::text[]))::int AS awaiting_validation,
             COUNT(*) FILTER (WHERE pme.product_id IS NULL
               AND p.product_ref = ANY($4::text[]))::int AS published_undecided,
             COUNT(*) FILTER (WHERE pme.commercial_exposure = 'DISABLED')::int AS hidden,
             ARRAY(SELECT p2.product_ref FROM products p2
               JOIN product_market_exposure e ON e.product_id = p2.id
               JOIN markets m2 ON m2.id = e.market_id
               WHERE p2.product_ref = ANY($1::text[]) AND m2.code = $2
                 AND e.commercial_exposure = 'ENABLED') AS exposed_refs,
             ARRAY(SELECT p.product_ref FROM products p
               WHERE p.product_ref = ANY($1::text[])
                 AND ${publicCatalogVisibilitySql('p', { marketCodeParamIndex: 2 })}) AS visible_refs
        FROM products p
        LEFT JOIN product_market_exposure pme ON pme.product_id = p.id
          AND pme.market_id = (SELECT id FROM markets WHERE code = $2)
       WHERE p.product_ref = ANY($1::text[])`, [refs, market.code, readyRefs, publishedRefs]);
    counts.exposed_refs.forEach(ref => exposed.add(ref));
    counts.visible_refs.forEach(ref => visible.add(ref));
    awaitingValidationDecisions += Number(counts.awaiting_validation || 0);
    publishedUndecidedDecisions += Number(counts.published_undecided || 0);
    markets.push({
      code: market.code, name: market.name,
      awaiting_validation: counts.awaiting_validation,
      published_undecided: counts.published_undecided,
      hidden: counts.hidden,
      exposed: counts.exposed_refs.length,
      visible: counts.visible_refs.length,
    });
  }
  return {
    available: true, observed_at: new Date().toISOString(), catalog, items, markets,
    market_decisions: {
      awaiting_validation: awaitingValidationDecisions,
      published_undecided: publishedUndecidedDecisions,
    },
    exposed_products: exposed.size, visible_products: visible.size,
  };
}

module.exports = { readRunProgress };
