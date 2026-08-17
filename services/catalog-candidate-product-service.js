/**
 * @komerce-arch
 * @role          catalog-candidate-product-owner
 * @domain        catalog
 * @layer         service
 * @criticality   high
 * @inputs        sourcing_candidate, initial_price
 * @outputs       product_id
 * @depends       none
 * @used-by       routes/sourcing-scanner.js
 * @db-read       none
 * @db-write      products
 * @db-txn        caller_owned
 * @doctrine      docs/doctrine/DOCTRINE_CATALOGUE.md §7
 * @impact-areas  catalog, sourcing
 * @version       2026-08
 */

'use strict';

/**
 * Creates the inactive catalog draft produced by the sourcing promotion flow.
 *
 * The caller injects the transaction client so product creation remains in the
 * same atomic unit as catalog promotion + sourcing candidate state transition.
 */
async function createDraftProductFromSourcingCandidate(q, {
  candidate,
  initialPrice,
}) {
  const weightKg = candidate.estimated_weight_kg || null;

  const prodRes = await q.query(
    `INSERT INTO products (
       name, category,
       cost_kmf,
       price_kmf,
       weight_kg,
       is_active, lifecycle_status,
       name_source, description_source, source_locale, content_source
     ) VALUES ($1, $2, $3, $4, $5, FALSE, 'candidate', $6, $7, $8, 'connector_raw')
     RETURNING id`,
    [
      candidate.product_name,
      candidate.komerce_category || 'autre',
      candidate.purchase_price_kmf || 0,
      initialPrice,
      weightKg,
      candidate.product_name,
      candidate.description || null,
      'en',
    ]
  );

  return prodRes.rows[0].id;
}

module.exports = { createDraftProductFromSourcingCandidate };
