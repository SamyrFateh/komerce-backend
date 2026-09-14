/**
 * @komerce-arch
 * @role          sourcing-catalog-product-linkage
 * @domain        sourcing
 * @layer         service
 * @criticality   high
 * @inputs        catalog_product_id
 * @outputs       active_canonical_product_ids
 * @depends       db.js
 * @used-by       services/catalog-product-route-canary.js
 * @db-read       sourcing_candidates, sourcing_captures, sourcing_observations, sourcing_resolution_bindings, sourcing_canonical_entities
 * @db-write      none
 * @db-txn        none
 * @doctrine      docs/doctrine/DOCTRINE_CATALOG_PRODUCT_ROUTE_CANARY.md
 * @impact-areas  sourcing, catalog
 * @version       2026-09
 */
'use strict';

const db = require('../db');

async function findCanonicalProductIdsForCatalogProduct(productId, query = db.query.bind(db)) {
  const result = await query(`
    SELECT DISTINCT ce.canonical_entity_id
      FROM sourcing_candidates sc
      JOIN sourcing_captures c
        ON sc.import_id = NULLIF(c.stats->>'import_id', '')::uuid
      JOIN sourcing_observations o
        ON o.capture_id = c.capture_id
       AND o.grain::text = 'product'
       AND o.source_ref = sc.supplier_product_id
      JOIN sourcing_resolution_bindings rb
        ON rb.observation_id = o.observation_id
       AND rb.ended_at IS NULL
      JOIN sourcing_canonical_entities ce
        ON ce.canonical_entity_id = rb.canonical_entity_id
       AND ce.grain::text = 'product'
       AND ce.status = 'active'
     WHERE sc.product_id = $1
     ORDER BY ce.canonical_entity_id
  `, [productId]);
  return (result.rows || []).map((row) => row.canonical_entity_id);
}

module.exports = { findCanonicalProductIdsForCatalogProduct };
