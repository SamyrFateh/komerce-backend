/**
 * @komerce-arch-lite
 * @role          refinery-fr-cross-supplier-readonly-proof
 * @domain        catalog
 * @layer         tooling
 * @owner         services/catalog-enrichment.js
 * @purpose       Audit actual AliExpress and Allegro Golden source-to-French readiness without any mutation.
 * @impact-areas  catalog, sourcing, supplier-import
 */
'use strict';

const db = require('../db');
const TARGETS = Object.freeze([
  Object.freeze({ id: '3ae1db7b-856a-4ed9-9e68-6dbee7487cc2', supplier: 'AliExpress', supplierProductId: '1005012486042806' }),
  Object.freeze({ id: '9df9d206-7bf0-40b3-ae04-15f52dfb9506', supplier: 'Allegro Sandbox', supplierProductId: '7782236928' }),
]);

function providerReadiness(env) {
  const provider = String(env.CATALOG_ENRICH_PROVIDER || 'anthropic').toLowerCase().trim();
  if (!['anthropic', 'openai'].includes(provider)) {
    return { status: 'INVALID_PROVIDER_CONFIGURATION', provider };
  }
  return {
    status: String(env[provider === 'anthropic' ? 'ANTHROPIC_API_KEY' : 'OPENAI_API_KEY'] || '').trim()
      ? 'PROVIDER_KEY_PRESENT_NOT_YET_TESTED'
      : 'PROVIDER_KEY_MISSING',
    provider,
  };
}

function inspectCandidate(row, product = null) {
  const source = row.normalized_source_contract || {};
  const axes = Array.isArray(source.option_axes) ? source.option_axes : [];
  const units = Array.isArray(source.sellable_units) ? source.sellable_units : [];
  const uniqueCombos = new Set(units.map(u => JSON.stringify(
    Object.entries(u?.option_values || {}).sort(([a], [b]) => a.localeCompare(b))
  )));
  const sourceDescription = String(source.description || row.description || '').trim();
  const sourceLocale = String(source.source_locale || '').trim();
  const blockers = [];
  if (!sourceDescription) blockers.push('SOURCE_DESCRIPTION_MISSING');
  if (!sourceLocale) blockers.push('SOURCE_LOCALE_UNKNOWN');
  if (units.length === 0) blockers.push('SELLABLE_UNITS_MISSING');
  if (units.length !== uniqueCombos.size) blockers.push('VARIANT_COMBINATIONS_NOT_UNIQUE');
  if (!product) blockers.push('CATALOG_DRAFT_NOT_CREATED');
  else if (product.content_source === 'connector_raw' && !/^fr(?:[-_]|$)/i.test(sourceLocale)) {
    blockers.push('FOREIGN_RAW_SOURCE_NOT_FRENCH');
  }
  if (product && product.content_source === 'ai_enriched'
    && (!String(product.description || '').trim() || product.needs_review !== false)) {
    blockers.push('FRENCH_EDITORIAL_REVIEW_REQUIRED');
  }
  return {
    supplier: row.supplier_name,
    supplier_product_id: row.supplier_product_id,
    candidate_state: row.state,
    product_id: row.product_id,
    source: {
      product_name: String(source.product_name || row.product_name || '').slice(0, 200),
      source_locale: sourceLocale || null,
      description_present: Boolean(sourceDescription),
      description_length: sourceDescription.length,
      option_axes: axes.map(a => ({ key: a.key, values: Array.isArray(a.values) ? a.values : [] })),
      sellable_units: units.length,
      unique_variant_combinations: uniqueCombos.size,
      media_count: Array.isArray(source.media) ? source.media.length : 0,
    },
    catalog: product ? {
      content_source: product.content_source,
      needs_review: product.needs_review,
      enrichment_version: product.enrichment_version,
      description_present: Boolean(String(product.description || '').trim()),
      is_active: product.is_active,
      quality_validated: product.quality_validated,
    } : null,
    blockers,
    fr_preparation_proven: Boolean(product?.content_source === 'ai_enriched'
      && String(product?.description || '').trim() && product?.needs_review === false),
  };
}

async function run({ env = process.env, executor = db } = {}) {
  if (env.KOMERCE_ENV !== 'staging') throw new Error('REFINERY_FR_AUDIT_STAGING_ONLY');
  if (!env.DATABASE_URL) throw new Error('REFINERY_FR_AUDIT_DATABASE_REQUIRED');
  const q = await executor.getClient();
  try {
    await q.query('BEGIN TRANSACTION READ ONLY');
    const { rows } = await q.query(
      `SELECT id, supplier_name, supplier_product_id, state, product_id, product_name,
              description, normalized_source_contract
         FROM sourcing_candidates WHERE id = ANY($1::uuid[])`,
      [TARGETS.map(t => t.id)]
    );
    if (rows.length !== TARGETS.length || TARGETS.some(t =>
      !rows.some(r => r.id === t.id && r.supplier_name === t.supplier
        && String(r.supplier_product_id) === t.supplierProductId))) {
      throw new Error('REFINERY_FR_AUDIT_EXACT_TARGETS_NOT_FOUND');
    }
    const reports = [];
    for (const target of TARGETS) {
      const candidate = rows.find(r => r.id === target.id);
      let product = null;
      if (candidate.product_id) {
        const { rows: products } = await q.query(
          `SELECT id, description, content_source, needs_review, enrichment_version,
                  is_active, quality_validated
             FROM products WHERE id = $1`, [candidate.product_id]
        );
        if (products.length !== 1) throw new Error('REFINERY_FR_AUDIT_CATALOG_PRODUCT_MISSING');
        product = products[0];
      }
      reports.push(inspectCandidate(candidate, product));
    }
    await q.query('COMMIT');
    return {
      mode: 'exact-cross-supplier-fr-readiness-readonly',
      environment: 'staging', writes: false, ai_call_invoked: false,
      purchase_invoked: false, publication_performed: false,
      automatic_fr_runtime: providerReadiness(env),
      cases: reports,
    };
  } catch (error) {
    await q.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    q.release();
  }
}
if (require.main === module) {
  run().then(v => process.stdout.write(`[refinery-fr-audit] ${JSON.stringify(v)}\n`))
    .catch(e => { console.error(`[refinery-fr-audit] FAILED: ${e.stack || e}`); process.exitCode = 1; })
    .finally(() => db.pool.end());
}

module.exports = { TARGETS, providerReadiness, inspectCandidate, run };
