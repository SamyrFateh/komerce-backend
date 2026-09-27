/**
 * @komerce-arch
 * @role          catalog-candidate-product-owner
 * @domain        catalog
 * @layer         service
 * @criticality   high
 * @inputs        sourcing_candidate, initial_price, normalized_source_contract
 * @outputs       product_id
 * @depends       none
 * @used-by       routes/sourcing-scanner.js
 * @db-read       none
 * @db-write      products
 * @db-txn        caller_owned
 * @doctrine      docs/doctrine/DOCTRINE_CATALOGUE.md §7
 * @impact-areas  catalog, sourcing
 * @version       2026-09
 */

'use strict';

function sourceLocaleFromCandidate(candidate = {}) {
  const locale = candidate?.normalized_source_contract?.source_locale;
  if (typeof locale !== 'string') return 'en';
  const normalized = locale.trim();
  return normalized || 'en';
}

function boutiqueTaxonomyFromCandidate(candidate = {}) {
  const discovery = candidate?.raw_payload?.discovery || {};
  const category = String(discovery.target_category || '').trim() || null;
  const subcategory = String(discovery.target_subcategory || '').trim() || null;
  return {
    category,
    subcategory: category ? subcategory : null,
  };
}

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
  const sourceLocale = sourceLocaleFromCandidate(candidate);
  const boutiqueTaxonomy = boutiqueTaxonomyFromCandidate(candidate);

  const prodRes = await q.query(
    `INSERT INTO products (
       name, category,
       boutique_category_key, boutique_subcategory_key,
       cost_kmf,
       price_kmf,
       weight_kg,
       is_active, lifecycle_status,
       name_source, description_source, source_locale, content_source
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, FALSE, 'candidate', $8, $9, $10, 'connector_raw')
     RETURNING id`,
    [
      candidate.product_name,
      candidate.komerce_category || 'autre',
      boutiqueTaxonomy.category,
      boutiqueTaxonomy.subcategory,
      candidate.purchase_price_kmf || 0,
      initialPrice,
      weightKg,
      candidate.product_name,
      candidate.description || null,
      sourceLocale,
    ]
  );

  return prodRes.rows[0].id;
}

module.exports = {
  createDraftProductFromSourcingCandidate,
  sourceLocaleFromCandidate,
  boutiqueTaxonomyFromCandidate,
};
