#!/usr/bin/env node
/**
 * @komerce-arch
 * @role          catalog-taxonomy-provenance-backfill
 * @domain        catalog
 * @layer         script
 * @criticality   high
 * @inputs        candidate product + latest imported_to_catalog sourcing provenance
 * @outputs       missing boutique taxonomy assignments for existing catalog candidates
 * @depends       db.js, services/catalog-product-mutation-service.js
 * @used-by       one-shot Railway operator run
 * @db-read       products, sourcing_candidates, boutique_categories, boutique_subcategories
 * @db-write-via  catalog-product-mutation-service products
 * @db-txn        one transaction in --apply mode
 * @doctrine      provenance_only, no_title_inference, boutique_taxonomy_distinct_from_legacy_category
 * @impact-areas  catalog, sourcing, boutique
 * @version       2026-10-v1
 */
'use strict';

const db = require('../db');
const productMutation = require('../services/catalog-product-mutation-service');

function parseArgs(argv = process.argv.slice(2)) {
  const out = { apply: false, expect: null, productRefs: [] };
  for (const arg of argv) {
    if (arg === '--apply') out.apply = true;
    else if (arg.startsWith('--expect=')) out.expect = Number(arg.slice('--expect='.length));
    else if (arg.startsWith('--product-ref=')) out.productRefs.push(arg.slice('--product-ref='.length).trim());
    else if (arg === '--help' || arg === '-h') out.help = true;
    else throw new Error(`Argument inconnu: ${arg}`);
  }
  if (out.expect !== null && (!Number.isInteger(out.expect) || out.expect < 0)) {
    throw new Error('--expect doit être un entier >= 0');
  }
  out.productRefs = [...new Set(out.productRefs.filter(Boolean))];
  return out;
}

async function loadCandidates(q, { productRefs = [] } = {}) {
  const params = [];
  let refFilter = '';
  if (productRefs.length) {
    params.push(productRefs);
    refFilter = ` AND p.product_ref = ANY($${params.length}::text[])`;
  }
  const { rows } = await q.query(
    `SELECT p.id,
            p.product_ref,
            p.name,
            p.category,
            p.subcategory,
            p.boutique_category_key,
            p.boutique_subcategory_key,
            sc.id AS sourcing_candidate_id,
            sc.supplier_name,
            sc.supplier_product_id,
            sc.raw_payload->'discovery'->>'segment_id' AS segment_id,
            sc.raw_payload->'discovery'->>'target_category' AS target_category,
            sc.raw_payload->'discovery'->>'target_subcategory' AS target_subcategory
       FROM products p
       JOIN LATERAL (
         SELECT candidate.*
           FROM sourcing_candidates candidate
          WHERE candidate.product_id = p.id
            AND candidate.state = 'imported_to_catalog'
          ORDER BY candidate.updated_at DESC NULLS LAST, candidate.created_at DESC
          LIMIT 1
       ) sc ON TRUE
      WHERE p.lifecycle_status = 'candidate'
        AND p.is_active = FALSE
        AND p.content_source IN ('connector_raw','ai_enriched','manual')
        AND (p.boutique_category_key IS NULL OR p.boutique_subcategory_key IS NULL)
        ${refFilter}
      ORDER BY p.product_ref`,
    params
  );
  return rows;
}

function provenanceFor(row = {}) {
  return {
    category: String(row.target_category || '').trim() || null,
    subcategory: String(row.target_subcategory || '').trim() || null,
    segment_id: String(row.segment_id || '').trim() || null,
  };
}

function conflictReason(row, provenance) {
  if (row.boutique_category_key && row.boutique_category_key !== provenance.category) {
    return 'existing_category_conflict';
  }
  if (row.boutique_subcategory_key && row.boutique_subcategory_key !== provenance.subcategory) {
    return 'existing_subcategory_conflict';
  }
  return null;
}

async function inspectCandidate(q, mutation, row) {
  const provenance = provenanceFor(row);
  if (!provenance.category || !provenance.subcategory) {
    return { row, provenance, status: 'BLOCKED', reason: 'provenance_missing' };
  }
  const conflict = conflictReason(row, provenance);
  if (conflict) return { row, provenance, status: 'BLOCKED', reason: conflict };

  try {
    const normalized = await mutation.resolveBoutiqueTaxonomy(
      q,
      provenance.category,
      provenance.subcategory
    );
    return { row, provenance, normalized, status: 'READY', reason: null };
  } catch (error) {
    return {
      row,
      provenance,
      status: 'BLOCKED',
      reason: error.code || 'taxonomy_invalid',
      error: error.message,
    };
  }
}

async function postAudit(q, planned) {
  if (!planned.length) return { checked: 0, correct: 0 };
  const ids = planned.map(item => item.row.id);
  const { rows } = await q.query(
    `SELECT id, product_ref, boutique_category_key, boutique_subcategory_key
       FROM products
      WHERE id = ANY($1::uuid[])
      ORDER BY product_ref`,
    [ids]
  );
  const expected = new Map(planned.map(item => [
    item.row.id,
    [item.normalized.category, item.normalized.subcategory],
  ]));
  let correct = 0;
  for (const row of rows) {
    const pair = expected.get(row.id);
    if (pair && row.boutique_category_key === pair[0] && row.boutique_subcategory_key === pair[1]) {
      correct += 1;
    }
  }
  return { checked: planned.length, correct };
}

async function runBackfill(options = {}, rootDb = db, mutation = productMutation) {
  const client = await rootDb.getClient();
  const apply = Boolean(options.apply);
  let begun = false;
  try {
    if (apply) {
      await client.query('BEGIN');
      begun = true;
    }

    const rows = await loadCandidates(client, { productRefs: options.productRefs || [] });
    if (options.expect !== null && options.expect !== undefined && rows.length !== options.expect) {
      throw new Error(`CATALOG_TAXONOMY_BACKFILL_COUNT_MISMATCH:${rows.length}/${options.expect}`);
    }

    const inspected = [];
    for (const row of rows) {
      // eslint-disable-next-line no-await-in-loop
      inspected.push(await inspectCandidate(client, mutation, row));
    }
    const blocked = inspected.filter(item => item.status !== 'READY');
    const ready = inspected.filter(item => item.status === 'READY');

    if (apply && blocked.length) {
      throw new Error(`CATALOG_TAXONOMY_BACKFILL_BLOCKED:${JSON.stringify(blocked.map(item => ({
        product_ref: item.row.product_ref,
        reason: item.reason,
        target_category: item.provenance.category,
        target_subcategory: item.provenance.subcategory,
      })))}`);
    }

    if (apply) {
      for (const item of ready) {
        // eslint-disable-next-line no-await-in-loop
        await mutation.assignBoutiqueTaxonomy(
          client,
          item.row.id,
          item.normalized.category,
          item.normalized.subcategory
        );
      }
      const audit = await postAudit(client, ready);
      if (audit.correct !== audit.checked) {
        throw new Error(`CATALOG_TAXONOMY_BACKFILL_AUDIT_FAILED:${audit.correct}/${audit.checked}`);
      }
      await client.query('COMMIT');
      begun = false;
      return { mode: 'apply', total: rows.length, ready: ready.length, blocked, audit, inspected };
    }

    return {
      mode: 'dry-run',
      total: rows.length,
      ready: ready.length,
      blocked,
      inspected,
    };
  } catch (error) {
    if (begun) {
      try { await client.query('ROLLBACK'); } catch (_) {}
    }
    throw error;
  } finally {
    client.release();
  }
}

function printable(result) {
  return {
    mode: result.mode,
    total: result.total,
    ready: result.ready,
    blocked: result.blocked.map(item => ({
      product_ref: item.row.product_ref,
      reason: item.reason,
      target_category: item.provenance.category,
      target_subcategory: item.provenance.subcategory,
    })),
    candidates: result.inspected.map(item => ({
      product_ref: item.row.product_ref,
      supplier: item.row.supplier_name,
      segment_id: item.provenance.segment_id,
      legacy_category: item.row.category,
      boutique_category: item.provenance.category,
      boutique_subcategory: item.provenance.subcategory,
      status: item.status,
      reason: item.reason,
    })),
    ...(result.audit ? { audit: result.audit } : {}),
  };
}

async function main() {
  const options = parseArgs();
  if (options.help) {
    console.log('Usage: node scripts/catalog-taxonomy-provenance-backfill.js [--apply] [--expect=N] [--product-ref=KPR-XXXXXX]');
    console.log('Par défaut: dry-run, aucune écriture.');
    return;
  }
  const result = await runBackfill(options);
  console.log(JSON.stringify(printable(result), null, 2));
}

if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch(error => {
      console.error(`[catalog-taxonomy-provenance-backfill] FAILED: ${error.stack || error.message || error}`);
      process.exit(1);
    });
}

module.exports = {
  parseArgs,
  loadCandidates,
  provenanceFor,
  conflictReason,
  inspectCandidate,
  postAudit,
  runBackfill,
  printable,
};
