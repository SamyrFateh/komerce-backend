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
 * @db-read       boutique_categories, boutique_subcategories
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

async function resolveActiveBoutiqueTaxonomy(q, candidate = {}) {
  const requested = boutiqueTaxonomyFromCandidate(candidate);
  if (!requested.category && !requested.subcategory) return requested;
  if (!requested.category || !requested.subcategory) {
    throw new Error('BOUTIQUE_TAXONOMY_INCOMPLETE: target_category + target_subcategory requis ensemble');
  }

  const { rows: [row] } = await q.query(
    `SELECT bc.key AS category, bs.key AS subcategory
       FROM boutique_categories bc
       JOIN boutique_subcategories bs
         ON bs.category_key=bc.key
        AND bs.key=$2
        AND bs.is_active=TRUE
      WHERE bc.is_active=TRUE
        AND bc.key=$1
      LIMIT 1`,
    [requested.category, requested.subcategory]
  );
  if (!row) {
    throw new Error(`BOUTIQUE_TAXONOMY_INVALID: ${requested.category} / ${requested.subcategory}`);
  }
  return row;
}

/**
 * Creates the inactive, unavailable catalog draft produced by the sourcing handoff flow.
 * A draft may legitimately have no market price yet; publication owns that decision.
 *
 * The caller injects the transaction client so product creation remains in the
 * same atomic unit as catalog promotion + sourcing candidate state transition.
 */
function draftStockFromCandidate(candidate) {
  const value = candidate?.stock_available;
  if (value === null || value === undefined || value === '') return 0;
  const stock = Number(value);
  return Number.isInteger(stock) && stock >= 0 ? stock : 0;
}

async function createDraftProductFromSourcingCandidate(q, {
  candidate,
  initialPrice,
}) {
  const weightKg = candidate.estimated_weight_kg || null;
  const stock = draftStockFromCandidate(candidate);
  const sourceLocale = sourceLocaleFromCandidate(candidate);
  const boutiqueTaxonomy = await resolveActiveBoutiqueTaxonomy(q, candidate);

  const prodRes = await q.query(
    `INSERT INTO products (
       name, category,
       boutique_category_key, boutique_subcategory_key,
       cost_kmf,
       price_kmf,
       stock,
       weight_kg,
       is_active, is_available, lifecycle_status,
       name_source, description_source, source_locale, content_source
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, FALSE, FALSE, 'candidate', $9, $10, $11, 'connector_raw')
     RETURNING id`,
    [
      candidate.product_name,
      candidate.komerce_category || 'autre',
      boutiqueTaxonomy.category,
      boutiqueTaxonomy.subcategory,
      candidate.purchase_price_kmf || 0,
      initialPrice == null ? null : initialPrice,
      stock,
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
  draftStockFromCandidate,
  sourceLocaleFromCandidate,
  boutiqueTaxonomyFromCandidate,
  resolveActiveBoutiqueTaxonomy,
};
