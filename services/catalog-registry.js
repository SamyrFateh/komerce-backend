/**
 * @komerce-arch
 * @role          catalog-global-registry-read
 * @domain        catalog
 * @layer         service
 * @criticality   high
 * @inputs        authenticated catalog workspace query
 * @outputs       handed-off product registry and actionable quality signals
 * @depends       db.js
 * @used-by       services/catalog-workspace.js
 * @db-read       products, sourcing_candidates, boutique_categories, boutique_subcategories
 * @db-write      none
 * @db-txn        none
 * @doctrine      source_handoff_is_not_publication, global_catalog_not_market_scoped
 * @impact-areas  catalog, admin-dashboard
 * @version       2026-10
 */
'use strict';

const db = require('../db');

// A Sourcing candidate becomes part of the global catalog only after the
// canonical handoff. Neither KIR closure nor market authorization is a
// prerequisite for viewing or repairing that catalog record.
const REGISTRY_CTE = [
  'WITH handed AS (',
  ' SELECT p.product_ref, p.name, p.description, p.image_url,',
  '        p.category AS customs_category, p.boutique_category_key,',
  '        p.boutique_subcategory_key, p.lifecycle_status,',
  '        p.is_active, p.needs_review, p.content_source, p.source_locale,',
  '        p.updated_at, sc.candidate_ref, sc.supplier_name,',
  '        sc.supplier_product_id, sc.supplier_category,',
  '        bc.label AS boutique_category_label, bs.label AS boutique_subcategory_label,',
  '        (sc.normalized_source_contract IS NOT NULL',
  "           AND NULLIF(BTRIM(sc.supplier_name),'') IS NOT NULL",
  "           AND NULLIF(BTRIM(sc.supplier_product_id),'') IS NOT NULL) AS source_ready,",
  '        (bc.key IS NOT NULL AND bs.key IS NOT NULL) AS taxonomy_ready,',
  '        (p.description IS NOT NULL AND BTRIM(p.description) <> \'\'',
  '           AND p.needs_review IS FALSE',
  "           AND (COALESCE(p.content_source, 'connector_raw') <> 'connector_raw' OR",
  "                COALESCE(p.source_locale, '') = 'fr' OR COALESCE(p.source_locale, '') LIKE 'fr-%')) AS editorial_ready",
  '   FROM products p',
  '   JOIN LATERAL (',
  '     SELECT candidate_ref, supplier_name, supplier_product_id, supplier_category,',
  '            normalized_source_contract',
  '       FROM sourcing_candidates',
  "      WHERE product_id = p.id AND state = 'imported_to_catalog'",
  '      ORDER BY updated_at DESC NULLS LAST, created_at DESC, id DESC',
  '      LIMIT 1',
  '   ) sc ON TRUE',
  '   LEFT JOIN boutique_categories bc',
  '     ON bc.key = p.boutique_category_key AND bc.is_active = TRUE',
  '   LEFT JOIN boutique_subcategories bs',
  '     ON bs.category_key = bc.key',
  '    AND bs.key = p.boutique_subcategory_key AND bs.is_active = TRUE',
  '), marked AS (',
  ' SELECT handed.*,',
  '        CASE',
  "          WHEN lifecycle_status = 'rejected' THEN 'rejected'",
  "          WHEN NOT source_ready THEN 'source_to_normalize'",
  "          WHEN NOT taxonomy_ready THEN 'taxonomy_to_confirm'",
  "          WHEN NOT editorial_ready THEN 'editorial_to_complete'",
  "          WHEN lifecycle_status = 'candidate' THEN 'approval_pending'",
  "          WHEN is_active = TRUE AND lifecycle_status = 'active' THEN 'catalog_approved'",
  "          ELSE 'inactive'",
  '        END AS work_status',
  ' FROM handed',
  ')',
].join('\n');

function details(row) {
  const issues = [];
  if (!row.source_ready) issues.push('source_to_normalize');
  if (!row.taxonomy_ready) issues.push('taxonomy_to_confirm');
  if (!row.editorial_ready) issues.push('editorial_to_complete');
  if (row.lifecycle_status === 'candidate' && issues.length === 0) issues.push('approval_pending');
  return {
    product_ref: row.product_ref,
    name: row.name,
    image_url: row.image_url || null,
    supplier_name: row.supplier_name || null,
    supplier_product_id: row.supplier_product_id || null,
    supplier_category: row.supplier_category || null,
    candidate_ref: row.candidate_ref || null,
    customs_category: row.customs_category || null,
    boutique_category_key: row.boutique_category_key || null,
    boutique_subcategory_key: row.boutique_subcategory_key || null,
    boutique_category_label: row.boutique_category_label || null,
    boutique_subcategory_label: row.boutique_subcategory_label || null,
    lifecycle_status: row.lifecycle_status || null,
    is_active: row.is_active === true,
    needs_review: row.needs_review === true,
    work_status: row.work_status,
    issues,
    updated_at: row.updated_at || null,
  };
}

async function listRegistry(query = {}, executor = db) {
  const limit = Math.min(Math.max(parseInt(query.limit, 10) || 50, 1), 100);
  const offset = Math.max(parseInt(query.offset, 10) || 0, 0);
  const filters = [];
  const params = [];
  const addFilter = (value, sql) => {
    if (!value || !String(value).trim()) return;
    params.push(value);
    filters.push(sql.replace('?', '$' + params.length));
  };
  if (query.search && String(query.search).trim()) {
    params.push('%' + String(query.search).trim() + '%');
    const position = '$' + params.length;
    filters.push('(name ILIKE ' + position + ' OR product_ref ILIKE ' + position +
      ' OR supplier_product_id ILIKE ' + position + ')');
  }
  addFilter(query.supplier, 'supplier_name = ?');
  addFilter(query.category, 'boutique_category_key = ?');
  addFilter(query.subcategory, 'boutique_subcategory_key = ?');
  // A product can have several defects. A filter must show any matching
  // defect, not only the priority status shown on the first line.
  const statusPredicates = {
    source_to_normalize: 'NOT source_ready',
    taxonomy_to_confirm: 'NOT taxonomy_ready',
    editorial_to_complete: 'NOT editorial_ready',
    approval_pending: "lifecycle_status = 'candidate'",
    catalog_approved: "work_status = 'catalog_approved'",
    rejected: "work_status = 'rejected'",
    inactive: "work_status = 'inactive'",
  };
  if (query.status && statusPredicates[query.status]) {
    filters.push(statusPredicates[query.status]);
  }
  const where = filters.length ? ' WHERE ' + filters.join(' AND ') : '';
  const count = await executor.query(REGISTRY_CTE + '\nSELECT COUNT(*)::int AS total FROM marked' + where, params);
  const total = Number(count.rows[0]?.total) || 0;
  const rows = await executor.query(
    REGISTRY_CTE + '\nSELECT * FROM marked' + where +
    '\nORDER BY updated_at DESC NULLS LAST, product_ref ASC LIMIT $' +
    (params.length + 1) + ' OFFSET $' + (params.length + 2),
    [...params, limit, offset]
  );
  return {
    products: rows.rows.map(details),
    page: { total, limit, offset, has_previous: offset > 0,
      has_next: offset + rows.rows.length < total },
  };
}

module.exports = { listRegistry, details };
